from __future__ import annotations

from pathlib import Path

import pytest
from agentos.errors import DocumentError, FileConflictError
from agentos.permissions.engine import PermissionEngine
from agentos.tools.base import RiskLevel, ToolContext
from agentos.tools.document_tools import (
    DocCompareInput,
    DocCompareTool,
    DocGenerateInput,
    DocGenerateReportTool,
    DocReadInput,
    DocReadTool,
    ReportSection,
)
from agentos.tools.factory import create_default_registry
from agentos.tools.file_tools import (
    CreateFolderInput,
    FileCopyTool,
    FileCreateFolderTool,
    FileDuplicatesInput,
    FileDuplicatesTool,
    FileListTool,
    FileMetadataInput,
    FileMetadataTool,
    FileMoveTool,
    FileReadInput,
    FileReadTool,
    FileRenameTool,
    FileSearchInput,
    FileSearchTool,
    FileSuggestOrganizationTool,
    FileTransferInput,
    ListDirectoryInput,
    SuggestOrgInput,
)
from agentos.tools.system_tools import (
    EmptyInput,
    LargeFilesInput,
    SystemHealthTool,
    SystemLargeFilesTool,
    SystemProcessesInput,
    SystemProcessesTool,
)
from agentos.tools.terminal_tools import TerminalRunInput, TerminalRunTool


def _make_ctx(ws: Path, *, terminal_enabled: bool = False) -> ToolContext:
    canonical = ws.resolve()
    return ToolContext(
        task_id="tsk_tools",
        step_id="stp_tools",
        authorized_workspaces=[canonical],
        workspace_policies={str(canonical): {"read_only": False, "allow_delete": False}},
        data_dir=canonical,
        rollback_dir=canonical,
        browser_profiles_dir=canonical,
        exports_dir=canonical,
        max_file_size_bytes=10 * 1024 * 1024,
        max_screenshot_width=1280,
        terminal_enabled=terminal_enabled,
        terminal_allowlist=["pwd", "ls", "python3"],
        computer_use_enabled=False,
        computer_use_screen_capture=False,
        computer_use_approved_apps=["Calculator"],
    )


def test_default_registry_contains_all_categories() -> None:
    registry = create_default_registry()
    tools = registry.list_tools()
    categories = {t.category for t in tools}
    assert {"file", "document", "browser", "system", "terminal"}.issubset(categories)
    assert len(tools) >= 22


async def test_file_intelligence_tools_end_to_end(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    ctx = _make_ctx(ws)

    f1 = ws / "notes.txt"
    f2 = ws / "notes_dup.txt"
    f3 = ws / "data.csv"
    f1.write_text("AgentOS local file fixture alpha", encoding="utf-8")
    f2.write_text("AgentOS local file fixture alpha", encoding="utf-8")
    f3.write_text("item,count\napple,3\n", encoding="utf-8")

    listed = await FileListTool().execute(ListDirectoryInput(directory=str(ws)), ctx)
    assert listed.ok and listed.data["count"] == 3

    searched = await FileSearchTool().execute(
        FileSearchInput(directory=str(ws), pattern="*.txt", content_contains="alpha"), ctx
    )
    assert len(searched.data["matches"]) == 2

    read_out = await FileReadTool().execute(FileReadInput(path=str(f1)), ctx)
    assert read_out.untrusted_content is True
    assert "alpha" in read_out.data["content"]

    meta = await FileMetadataTool().execute(FileMetadataInput(path=str(f1)), ctx)
    assert len(meta.data["sha256"]) == 64

    dups = await FileDuplicatesTool().execute(FileDuplicatesInput(directory=str(ws)), ctx)
    assert len(dups.data["duplicate_groups"]) == 1
    assert len(dups.data["duplicate_groups"][0]["files"]) == 2

    org = await FileSuggestOrganizationTool().execute(SuggestOrgInput(directory=str(ws)), ctx)
    assert org.data["folders"]["Notes"] == 2
    assert org.data["folders"]["Data"] == 1

    # Folder creation, copy, rename, move + conflict guard + verification
    new_dir = ws / "archive"
    mk_tool = FileCreateFolderTool()
    mk_out = await mk_tool.execute(CreateFolderInput(path=str(new_dir)), ctx)
    assert (await mk_tool.verify(CreateFolderInput(path=str(new_dir)), mk_out, ctx)).verified

    copy_tool = FileCopyTool()
    copy_args = FileTransferInput(source_path=str(f1), destination_path=str(ws / "copied.txt"))
    copy_out = await copy_tool.execute(copy_args, ctx)
    assert (await copy_tool.verify(copy_args, copy_out, ctx)).verified

    with pytest.raises(FileConflictError):
        await copy_tool.execute(copy_args, ctx)

    ren_tool = FileRenameTool()
    ren_args = FileTransferInput(
        source_path=str(ws / "copied.txt"), destination_path=str(ws / "renamed.txt")
    )
    ren_out = await ren_tool.execute(ren_args, ctx)
    assert (await ren_tool.verify(ren_args, ren_out, ctx)).verified

    mv_tool = FileMoveTool()
    mv_args = FileTransferInput(
        source_path=str(ws / "renamed.txt"), destination_path=str(new_dir / "moved.txt")
    )
    mv_out = await mv_tool.execute(mv_args, ctx)
    assert (await mv_tool.verify(mv_args, mv_out, ctx)).verified


async def test_document_intelligence_generate_reopen_compare_and_malformed(tmp_path: Path) -> None:
    ws = tmp_path / "docs_ws"
    ws.mkdir()
    ctx = _make_ctx(ws)
    gen = DocGenerateReportTool()
    reader = DocReadTool()

    for fmt in ("md", "pdf", "docx", "csv", "xlsx"):
        out_path = ws / f"sample.{fmt}"
        args = DocGenerateInput(
            output_path=str(out_path),
            format=fmt,  # type: ignore[arg-type]
            title="Quarterly Summary",
            sections=[ReportSection(heading="Overview", body="Revenue reached steady baseline.")],
            table_headers=["Metric", "Value"],
            table_rows=[["Tasks", 12], ["Verified", 12]],
        )
        out = await gen.execute(args, ctx)
        assert out.ok
        ver = await gen.verify(args, out, ctx)
        assert ver.verified, f"Verification failed for format {fmt}: {ver.summary}"

        read_res = await reader.execute(DocReadInput(path=str(out_path)), ctx)
        assert read_res.ok
        assert read_res.data["format"] == fmt

    # Compare two text documents
    a = ws / "v1.md"
    b = ws / "v2.md"
    a.write_text("line one\nline two\n", encoding="utf-8")
    b.write_text("line one\nline two updated\nline three\n", encoding="utf-8")
    cmp_out = await DocCompareTool().execute(DocCompareInput(path_a=str(a), path_b=str(b)), ctx)
    assert cmp_out.data["identical"] is False
    assert cmp_out.data["lines_added"] >= 1

    # Malformed PDF produces typed DocumentError
    bad_pdf = ws / "corrupt.pdf"
    bad_pdf.write_bytes(b"not a real pdf binary header")
    with pytest.raises(DocumentError):
        await reader.execute(DocReadInput(path=str(bad_pdf)), ctx)


async def test_system_and_restricted_terminal_tools(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = tmp_path / "sys_ws"
    ws.mkdir()
    (ws / "big.bin").write_bytes(b"x" * 4096)
    ctx_disabled = _make_ctx(ws, terminal_enabled=False)

    health = await SystemHealthTool().execute(EmptyInput(), ctx_disabled)
    assert health.ok and health.data["memory_total_gb"] > 0

    procs = await SystemProcessesTool().execute(SystemProcessesInput(limit=5), ctx_disabled)
    assert procs.ok and len(procs.data["processes"]) >= 1

    large = await SystemLargeFilesTool().execute(
        LargeFilesInput(directory=str(ws), limit=5), ctx_disabled
    )
    assert large.data["files"][0]["size_bytes"] == 4096

    # Terminal disabled by default via PermissionEngine
    perm = PermissionEngine()
    term_tool = TerminalRunTool()
    blocked_default = perm.evaluate(
        term_tool, {"executable": "pwd", "args": [], "cwd": str(ws)}, ctx_disabled
    )
    assert blocked_default.allowed is False
    assert blocked_default.risk_level == RiskLevel.BLOCKED

    # Even when enabled, forbidden commands and shell metacharacters are blocked
    ctx_enabled = _make_ctx(ws, terminal_enabled=True)
    blocked_rm = perm.evaluate(
        term_tool, {"executable": "rm", "args": ["-rf", "/"], "cwd": str(ws)}, ctx_enabled
    )
    assert blocked_rm.allowed is False

    blocked_inject = perm.evaluate(
        term_tool, {"executable": "ls", "args": ["; whoami"], "cwd": str(ws)}, ctx_enabled
    )
    assert blocked_inject.allowed is False

    allowed_pwd = perm.evaluate(
        term_tool, {"executable": "pwd", "args": [], "cwd": str(ws)}, ctx_enabled
    )
    assert allowed_pwd.allowed is True
    assert allowed_pwd.requires_approval is True
    assert allowed_pwd.risk_level == RiskLevel.HIGH

    # Execute allowlisted command and verify secret environment variables are stripped
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-must-not-leak-to-child")
    res = await term_tool.execute(
        TerminalRunInput(
            executable="python3",
            args=["-c", "import os; print(os.environ.get('OPENAI_API_KEY', 'CLEAN'))"],
            cwd=str(ws),
        ),
        ctx_enabled,
    )
    assert res.ok is True
    assert res.data["stdout"].strip() == "CLEAN"
