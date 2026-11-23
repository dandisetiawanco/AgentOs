from __future__ import annotations

import asyncio
import platform
import shutil
import subprocess
from typing import Any

import psutil
from pydantic import BaseModel, Field

from agentos.errors import PathSecurityError, ToolExecutionError
from agentos.security.paths import resolve_authorized_path
from agentos.tools.base import BaseTool, RiskLevel, ToolContext, ToolExecutionOutput


class EmptyInput(BaseModel):
    pass


class SystemHealthTool(BaseTool):
    id = "system.health"
    name = "Inspect System Health"
    category = "system"
    description = "Inspect operating system, architecture, CPU load, memory usage, and disk space in read-only mode."
    input_model = EmptyInput
    required_permissions = ("system.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm live OS, CPU, RAM, and disk metrics were collected."

    def _run_sync(self) -> ToolExecutionOutput:
        vm = psutil.virtual_memory()
        disk = shutil.disk_usage("/")
        cpu_pct = psutil.cpu_percent(interval=0.15)
        mem_used_gb = round((vm.total - vm.available) / (1024**3), 2)
        mem_total_gb = round(vm.total / (1024**3), 2)
        disk_free_gb = round(disk.free / (1024**3), 2)
        disk_total_gb = round(disk.total / (1024**3), 2)

        health_status = "healthy"
        if vm.percent >= 90 or (disk.free / max(disk.total, 1)) < 0.08:
            health_status = "resource_pressure"

        return ToolExecutionOutput(
            ok=True,
            summary=(
                f"System {health_status}: {platform.system()} {platform.machine()}, "
                f"CPU {cpu_pct:.1f}%, RAM {mem_used_gb}/{mem_total_gb} GB ({vm.percent:.0f}%), "
                f"Disk {disk_free_gb}/{disk_total_gb} GB free."
            ),
            data={
                "status": health_status,
                "os": platform.system(),
                "os_release": platform.release(),
                "arch": platform.machine(),
                "cpu_count_logical": psutil.cpu_count(logical=True),
                "cpu_percent": cpu_pct,
                "memory_total_gb": mem_total_gb,
                "memory_used_gb": mem_used_gb,
                "memory_percent": vm.percent,
                "disk_total_gb": disk_total_gb,
                "disk_free_gb": disk_free_gb,
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        return await asyncio.to_thread(self._run_sync)


class SystemProcessesInput(BaseModel):
    limit: int = Field(default=15, ge=1, le=50)


class SystemProcessesTool(BaseTool):
    id = "system.processes"
    name = "Inspect Running Processes"
    category = "system"
    description = "List active running processes sorted by memory utilization (read-only)."
    input_model = SystemProcessesInput
    required_permissions = ("system.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm process snapshot was collected in read-only mode."

    def _run_sync(self, args: SystemProcessesInput) -> ToolExecutionOutput:
        procs: list[dict[str, Any]] = []
        for proc in psutil.process_iter(["pid", "name", "memory_percent", "status"]):
            try:
                info = proc.info
                procs.append(
                    {
                        "pid": info["pid"],
                        "name": info["name"] or "unknown",
                        "memory_percent": round(float(info.get("memory_percent") or 0.0), 2),
                        "status": str(info.get("status") or ""),
                    }
                )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        procs.sort(key=lambda p: p["memory_percent"], reverse=True)
        top = procs[: args.limit]
        return ToolExecutionOutput(
            ok=True,
            summary=f"Collected top {len(top)} running process(es) by memory usage.",
            data={"total_observed": len(procs), "processes": top},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, SystemProcessesInput)
        return await asyncio.to_thread(self._run_sync, args)


class LargeFilesInput(BaseModel):
    directory: str
    limit: int = Field(default=15, ge=1, le=100)


class SystemLargeFilesTool(BaseTool):
    id = "system.large_files"
    name = "Find Large Files in Workspace"
    category = "system"
    description = "Identify the largest files inside an authorized directory (read-only)."
    input_model = LargeFilesInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm large file scan stayed inside authorized directory."

    def _run_sync(self, args: LargeFilesInput, ctx: ToolContext) -> ToolExecutionOutput:
        root = resolve_authorized_path(args.directory, ctx.authorized_workspaces, must_exist=True)
        sized: list[tuple[int, str]] = []
        for item in root.rglob("*"):
            if item.is_symlink() or not item.is_file():
                continue
            try:
                resolved = resolve_authorized_path(str(item), ctx.authorized_workspaces)
                sized.append((resolved.stat().st_size, str(resolved)))
            except (PathSecurityError, OSError):
                continue
        sized.sort(key=lambda pair: pair[0], reverse=True)
        top = [
            {"path": p, "size_bytes": sz, "size_mb": round(sz / (1024 * 1024), 3)}
            for sz, p in sized[: args.limit]
        ]
        return ToolExecutionOutput(
            ok=True,
            summary=f"Identified top {len(top)} largest file(s) in {root.name}.",
            data={"directory": str(root), "files": top},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, LargeFilesInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)


class OpenAppInput(BaseModel):
    app_name: str = Field(min_length=1, max_length=100)


class SystemOpenAppTool(BaseTool):
    id = "system.open_app"
    name = "Open Approved Application"
    category = "system"
    description = "Launch an explicitly approved desktop application on macOS."
    input_model = OpenAppInput
    required_permissions = ("system.open_app",)
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    platforms = ("darwin",)
    verification_procedure = "Confirm macOS open launcher returned exit code 0."

    def _run_sync(self, args: OpenAppInput) -> ToolExecutionOutput:
        if platform.system() != "Darwin":
            raise ToolExecutionError("Application launcher is currently verified on macOS only.")
        proc = subprocess.run(  # noqa: S603
            ["/usr/bin/open", "-a", args.app_name],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            raise ToolExecutionError(
                f"Could not open application '{args.app_name}': {proc.stderr.strip()}"
            )
        return ToolExecutionOutput(
            ok=True,
            summary=f"Opened approved application '{args.app_name}'.",
            data={"app_name": args.app_name, "returncode": proc.returncode},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, OpenAppInput)
        return await asyncio.to_thread(self._run_sync, args)
