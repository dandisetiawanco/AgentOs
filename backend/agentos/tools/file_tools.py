from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import shutil
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agentos.errors import FileConflictError, PathSecurityError, ToolExecutionError
from agentos.security.paths import resolve_authorized_path
from agentos.tools.base import (
    BaseTool,
    RiskLevel,
    ToolContext,
    ToolExecutionOutput,
    VerificationOutcome,
)


def _sha256_file(path: Path, chunk_size: int = 65536) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


class ListDirectoryInput(BaseModel):
    directory: str
    recursive: bool = False
    max_entries: int = Field(default=200, ge=1, le=1000)


class FileListTool(BaseTool):
    id = "file.list"
    name = "List Authorized Directory"
    category = "file"
    description = "List files and folders inside an authorized workspace directory."
    input_model = ListDirectoryInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm directory exists and returned entry count is valid."

    def _run_sync(self, args: ListDirectoryInput, ctx: ToolContext) -> ToolExecutionOutput:
        target = resolve_authorized_path(args.directory, ctx.authorized_workspaces, must_exist=True)
        if not target.is_dir():
            raise ToolExecutionError(f"'{target}' is not a directory.")

        iterator = target.rglob("*") if args.recursive else target.iterdir()
        entries: list[dict[str, Any]] = []
        for item in sorted(iterator):
            if len(entries) >= args.max_entries:
                break
            try:
                stat = item.stat()
            except OSError:
                continue
            entries.append(
                {
                    "name": item.name,
                    "path": str(item),
                    "is_dir": item.is_dir(),
                    "size_bytes": stat.st_size if item.is_file() else 0,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                }
            )
        return ToolExecutionOutput(
            ok=True,
            summary=f"Listed {len(entries)} item(s) in {target.name}.",
            data={"directory": str(target), "count": len(entries), "entries": entries},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, ListDirectoryInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class FileSearchInput(BaseModel):
    directory: str
    pattern: str = "*"
    content_contains: str | None = None
    max_results: int = Field(default=100, ge=1, le=500)


class FileSearchTool(BaseTool):
    id = "file.search"
    name = "Search Workspace Files"
    category = "file"
    description = "Search files by filename glob and optional text content inside an authorized directory."
    input_model = FileSearchInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm search completed inside authorized workspace boundaries."

    def _run_sync(self, args: FileSearchInput, ctx: ToolContext) -> ToolExecutionOutput:
        root = resolve_authorized_path(args.directory, ctx.authorized_workspaces, must_exist=True)
        matches: list[dict[str, Any]] = []
        needle = args.content_contains.lower() if args.content_contains else None

        for path in sorted(root.rglob(args.pattern)):
            if len(matches) >= args.max_results:
                break
            if path.is_symlink() or not path.is_file():
                continue
            try:
                resolved = resolve_authorized_path(str(path), ctx.authorized_workspaces)
                size = resolved.stat().st_size
            except (PathSecurityError, OSError):
                continue
            if needle:
                if size > min(ctx.max_file_size_bytes, 2 * 1024 * 1024):
                    continue
                try:
                    text = resolved.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                if needle not in text.lower():
                    continue
            matches.append({"name": resolved.name, "path": str(resolved), "size_bytes": size})

        return ToolExecutionOutput(
            ok=True,
            summary=f"Found {len(matches)} matching file(s) for '{args.pattern}'.",
            data={"directory": str(root), "pattern": args.pattern, "matches": matches},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileSearchInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class FileReadInput(BaseModel):
    path: str
    max_chars: int = Field(default=20000, ge=100, le=100000)


class FileReadTool(BaseTool):
    id = "file.read"
    name = "Read File Content"
    category = "file"
    description = "Read text content from an authorized file within configured size limits."
    input_model = FileReadInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm file was read cleanly and content length recorded."

    def _run_sync(self, args: FileReadInput, ctx: ToolContext) -> ToolExecutionOutput:
        target = resolve_authorized_path(args.path, ctx.authorized_workspaces, must_exist=True)
        if not target.is_file():
            raise ToolExecutionError(f"'{target}' is not a regular file.")
        size = target.stat().st_size
        if size > ctx.max_file_size_bytes:
            raise ToolExecutionError(
                f"File '{target.name}' ({size} bytes) exceeds limit ({ctx.max_file_size_bytes} bytes)."
            )
        text = target.read_text(encoding="utf-8", errors="replace")
        truncated = len(text) > args.max_chars
        return ToolExecutionOutput(
            ok=True,
            summary=f"Read {min(len(text), args.max_chars)} characters from {target.name}.",
            untrusted_content=True,
            data={
                "path": str(target),
                "size_bytes": size,
                "truncated": truncated,
                "content": text[: args.max_chars],
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileReadInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class FileMetadataInput(BaseModel):
    path: str
    include_hash: bool = True


class FileMetadataTool(BaseTool):
    id = "file.metadata"
    name = "Inspect File Metadata"
    category = "file"
    description = "Inspect size, timestamps, MIME type, and SHA-256 digest of an authorized file."
    input_model = FileMetadataInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm file metadata and optional SHA-256 digest were computed."

    def _run_sync(self, args: FileMetadataInput, ctx: ToolContext) -> ToolExecutionOutput:
        target = resolve_authorized_path(args.path, ctx.authorized_workspaces, must_exist=True)
        stat = target.stat()
        mime_type, _ = mimetypes.guess_type(target.name)
        digest = _sha256_file(target) if args.include_hash and target.is_file() else None
        return ToolExecutionOutput(
            ok=True,
            summary=f"Inspected metadata for {target.name} ({stat.st_size} bytes).",
            data={
                "path": str(target),
                "name": target.name,
                "is_dir": target.is_dir(),
                "size_bytes": stat.st_size,
                "mime_type": mime_type or "application/octet-stream",
                "sha256": digest,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileMetadataInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class FileDuplicatesInput(BaseModel):
    directory: str


class FileDuplicatesTool(BaseTool):
    id = "file.duplicates"
    name = "Detect Duplicate Files"
    category = "file"
    description = "Detect exact duplicate files in an authorized directory using SHA-256 content hashes."
    input_model = FileDuplicatesInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm duplicate groups share identical size and SHA-256 hash."

    def _run_sync(self, args: FileDuplicatesInput, ctx: ToolContext) -> ToolExecutionOutput:
        root = resolve_authorized_path(args.directory, ctx.authorized_workspaces, must_exist=True)
        by_size: dict[int, list[Path]] = defaultdict(list)
        total_files = 0
        for item in root.rglob("*"):
            if item.is_symlink() or not item.is_file():
                continue
            try:
                resolved = resolve_authorized_path(str(item), ctx.authorized_workspaces)
                size = resolved.stat().st_size
            except (PathSecurityError, OSError):
                continue
            if size <= ctx.max_file_size_bytes:
                by_size[size].append(resolved)
                total_files += 1

        duplicate_groups: list[dict[str, Any]] = []
        for size, candidates in by_size.items():
            if len(candidates) < 2:
                continue
            by_hash: dict[str, list[str]] = defaultdict(list)
            for path in candidates:
                by_hash[_sha256_file(path)].append(str(path))
            for digest, paths in by_hash.items():
                if len(paths) >= 2:
                    duplicate_groups.append(
                        {"sha256": digest, "size_bytes": size, "files": sorted(paths)}
                    )

        return ToolExecutionOutput(
            ok=True,
            summary=f"Scanned {total_files} file(s); found {len(duplicate_groups)} duplicate group(s).",
            data={
                "directory": str(root),
                "scanned_files": total_files,
                "duplicate_groups": duplicate_groups,
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileDuplicatesInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class SuggestOrgInput(BaseModel):
    directory: str


class FileSuggestOrganizationTool(BaseTool):
    id = "file.suggest_organization"
    name = "Suggest Folder Organization"
    category = "file"
    description = "Analyze files in an authorized directory and propose a categorized folder structure without moving files."
    input_model = SuggestOrgInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm non-mutating organization plan was produced."

    CATEGORY_MAP: dict[str, str] = {
        ".pdf": "Documents",
        ".docx": "Documents",
        ".doc": "Documents",
        ".txt": "Notes",
        ".md": "Notes",
        ".csv": "Data",
        ".xlsx": "Data",
        ".json": "Data",
        ".png": "Images",
        ".jpg": "Images",
        ".jpeg": "Images",
        ".svg": "Images",
        ".py": "Code",
        ".ts": "Code",
        ".tsx": "Code",
        ".rs": "Code",
        ".zip": "Archives",
    }

    def _run_sync(self, args: SuggestOrgInput, ctx: ToolContext) -> ToolExecutionOutput:
        root = resolve_authorized_path(args.directory, ctx.authorized_workspaces, must_exist=True)
        proposals: list[dict[str, str]] = []
        bucket_counts: dict[str, int] = defaultdict(int)
        for item in sorted(root.iterdir()):
            if item.is_symlink() or not item.is_file():
                continue
            folder = self.CATEGORY_MAP.get(item.suffix.lower(), "Misc")
            bucket_counts[folder] += 1
            proposals.append(
                {
                    "source": str(item),
                    "proposed_destination": str(root / folder / item.name),
                    "category": folder,
                }
            )
        return ToolExecutionOutput(
            ok=True,
            summary=f"Proposed organization for {len(proposals)} top-level file(s) across {len(bucket_counts)} folder(s).",
            data={
                "directory": str(root),
                "folders": dict(bucket_counts),
                "proposals": proposals,
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, SuggestOrgInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class CreateFolderInput(BaseModel):
    path: str


class FileCreateFolderTool(BaseTool):
    id = "file.create_folder"
    name = "Create Folder"
    category = "file"
    description = "Create a new directory inside an authorized writable workspace."
    input_model = CreateFolderInput
    required_permissions = ("file.write",)
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm the directory exists on disk after creation."

    def _run_sync(self, args: CreateFolderInput, ctx: ToolContext) -> ToolExecutionOutput:
        target = resolve_authorized_path(args.path, ctx.authorized_workspaces)
        if target.exists():
            raise FileConflictError(f"Path '{target}' already exists.")
        target.mkdir(parents=True, exist_ok=False)
        return ToolExecutionOutput(
            ok=True,
            summary=f"Created folder '{target.name}'.",
            data={"path": str(target)},
            rollback_record={
                "operation_type": "create_folder",
                "source_path": str(target),
                "target_path": str(target),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, CreateFolderInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, CreateFolderInput)
        target = resolve_authorized_path(args.path, ctx.authorized_workspaces)
        ok = await asyncio.to_thread(target.is_dir)
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary=f"Verified directory exists at {target}." if ok else f"Directory missing at {target}.",
        )


class FileTransferInput(BaseModel):
    source_path: str
    destination_path: str


class FileRenameTool(BaseTool):
    id = "file.rename"
    name = "Rename File"
    category = "file"
    description = "Rename an authorized file within its workspace without overwriting existing targets."
    input_model = FileTransferInput
    required_permissions = ("file.write",)
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm renamed target exists and previous path no longer exists."

    def _run_sync(self, args: FileTransferInput, ctx: ToolContext) -> ToolExecutionOutput:
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces, must_exist=True)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        if dst.exists():
            raise FileConflictError(f"Destination '{dst}' already exists.")
        src.rename(dst)
        return ToolExecutionOutput(
            ok=True,
            summary=f"Renamed '{src.name}' to '{dst.name}'.",
            data={"source_path": str(src), "destination_path": str(dst)},
            rollback_record={
                "operation_type": "rename",
                "source_path": str(src),
                "target_path": str(dst),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileTransferInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, FileTransferInput)
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        ok = await asyncio.to_thread(lambda: dst.exists() and not src.exists())
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary="Verified file rename completed cleanly." if ok else "File rename verification failed.",
        )


class FileMoveTool(BaseTool):
    id = "file.move"
    name = "Move File"
    category = "file"
    description = "Move an authorized file to another path inside an authorized writable workspace."
    input_model = FileTransferInput
    required_permissions = ("file.write",)
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm destination exists with matching SHA-256 and source was moved."

    def _run_sync(self, args: FileTransferInput, ctx: ToolContext) -> ToolExecutionOutput:
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces, must_exist=True)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        if dst.exists():
            raise FileConflictError(f"Destination '{dst}' already exists.")
        before_hash = _sha256_file(src) if src.is_file() else None
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return ToolExecutionOutput(
            ok=True,
            summary=f"Moved '{src.name}' to '{dst}'.",
            data={"source_path": str(src), "destination_path": str(dst), "sha256": before_hash},
            rollback_record={
                "operation_type": "move",
                "source_path": str(src),
                "target_path": str(dst),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileTransferInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, FileTransferInput)
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        expected_hash = output.data.get("sha256")

        def _check() -> bool:
            if not dst.exists() or src.exists():
                return False
            if expected_hash and dst.is_file():
                return bool(_sha256_file(dst) == expected_hash)
            return True

        ok = await asyncio.to_thread(_check)
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary="Verified moved file integrity via SHA-256." if ok else "Move verification failed.",
        )


class FileCopyTool(BaseTool):
    id = "file.copy"
    name = "Copy File"
    category = "file"
    description = "Copy an authorized file to a new destination inside an authorized workspace."
    input_model = FileTransferInput
    required_permissions = ("file.read", "file.write")
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm source and copied file share identical SHA-256 digest."

    def _run_sync(self, args: FileTransferInput, ctx: ToolContext) -> ToolExecutionOutput:
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces, must_exist=True)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        if not src.is_file():
            raise ToolExecutionError(f"Source '{src}' is not a regular file.")
        if dst.exists():
            raise FileConflictError(f"Destination '{dst}' already exists.")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        digest = _sha256_file(dst)
        return ToolExecutionOutput(
            ok=True,
            summary=f"Copied '{src.name}' to '{dst.name}'.",
            data={"source_path": str(src), "destination_path": str(dst), "sha256": digest},
            rollback_record={
                "operation_type": "copy",
                "source_path": str(src),
                "target_path": str(dst),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, FileTransferInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, FileTransferInput)
        src = resolve_authorized_path(args.source_path, ctx.authorized_workspaces)
        dst = resolve_authorized_path(args.destination_path, ctx.authorized_workspaces)
        ok = await asyncio.to_thread(
            lambda: src.is_file() and dst.is_file() and _sha256_file(src) == _sha256_file(dst)
        )
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary="Verified copied file SHA-256 matches source." if ok else "Copy integrity check failed.",
        )
