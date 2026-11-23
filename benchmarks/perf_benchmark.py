"""Hardware performance benchmark suite for AgentOS on Intel macOS.

Measures actual backend startup latency, idle RSS memory, document processing,
tool execution latency, task execution overhead, and SQLite query latency.
"""

from __future__ import annotations

import asyncio
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import psutil
from sqlalchemy import select

from agentos.config import AgentOSSettings
from agentos.storage.database import DatabaseManager
from agentos.storage.models import AuditLog
from agentos.tools.base import ToolContext
from agentos.tools.document_tools import (
    DocGenerateInput,
    DocGenerateReportTool,
    DocReadInput,
    DocReadTool,
    ReportSection,
)
from agentos.tools.file_tools import (
    FileDuplicatesInput,
    FileDuplicatesTool,
    FileListTool,
    ListDirectoryInput,
)
from agentos.tools.system_tools import EmptyInput, SystemHealthTool


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def measure_backend_startup_and_memory(tmp: Path) -> dict[str, Any]:
    port = _free_port()
    token = "bench-session-token-1234567890abcdef"
    env = os.environ.copy()
    env["AGENTOS_SESSION_TOKEN"] = token
    env["AGENTOS_DATA_DIR"] = str(tmp / "bench_data")
    backend_dir = Path(__file__).resolve().parents[1] / "backend"

    t0 = time.perf_counter()
    proc = subprocess.Popen(
        [sys.executable, "-m", "agentos", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(backend_dir),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        base_url = f"http://127.0.0.1:{port}"
        while True:
            if proc.poll() is not None:
                raise RuntimeError(f"Backend exited early with code {proc.returncode}")
            try:
                resp = httpx.get(f"{base_url}/api/v1/health", timeout=0.5)
                if resp.status_code == 200:
                    startup_ms = round((time.perf_counter() - t0) * 1000, 1)
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.05)

        time.sleep(0.4)
        rss_mb = round(psutil.Process(proc.pid).memory_info().rss / (1024 * 1024), 2)

        # Measure end-to-end task execution overhead over HTTP
        headers = {"Authorization": f"Bearer {token}"}
        t_task = time.perf_counter()
        res = httpx.post(
            f"{base_url}/api/v1/tasks",
            headers=headers,
            json={
                "instruction": "Inspect system health diagnostics",
                "provider_id": "mock",
                "model": "mock-deterministic-v1",
            },
            timeout=10.0,
        )
        res.raise_for_status()
        task_overhead_ms = round((time.perf_counter() - t_task) * 1000, 1)

        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=8.0)
        return {
            "backend_startup_ms": startup_ms,
            "backend_idle_rss_mb": rss_mb,
            "task_execution_overhead_ms": task_overhead_ms,
        }
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)


async def measure_tools_docs_and_db(tmp: Path) -> dict[str, Any]:
    ws = tmp / "ws"
    ws.mkdir()
    for i in range(40):
        (ws / f"file_{i:02d}.txt").write_text(f"Sample line {i % 10} " * 200, encoding="utf-8")

    ctx = ToolContext(
        task_id="bench",
        step_id="bench",
        authorized_workspaces=[ws.resolve()],
        workspace_policies={str(ws.resolve()): {"read_only": False, "allow_delete": False}},
        data_dir=tmp,
        rollback_dir=tmp,
        browser_profiles_dir=tmp,
        exports_dir=tmp,
        max_file_size_bytes=25 * 1024 * 1024,
        max_screenshot_width=1600,
        terminal_enabled=False,
        terminal_allowlist=[],
        computer_use_enabled=False,
        computer_use_screen_capture=False,
        computer_use_approved_apps=[],
    )

    t0 = time.perf_counter()
    await FileListTool().execute(ListDirectoryInput(directory=str(ws)), ctx)
    file_list_ms = round((time.perf_counter() - t0) * 1000, 2)

    t0 = time.perf_counter()
    await FileDuplicatesTool().execute(FileDuplicatesInput(directory=str(ws)), ctx)
    file_dups_ms = round((time.perf_counter() - t0) * 1000, 2)

    t0 = time.perf_counter()
    await SystemHealthTool().execute(EmptyInput(), ctx)
    sys_health_ms = round((time.perf_counter() - t0) * 1000, 2)

    # Document processing across PDF, DOCX, XLSX
    doc_times: dict[str, float] = {}
    gen = DocGenerateReportTool()
    reader = DocReadTool()
    for fmt in ("pdf", "docx", "xlsx"):
        t0 = time.perf_counter()
        out_path = ws / f"bench.{fmt}"
        await gen.execute(
            DocGenerateInput(
                output_path=str(out_path),
                format=fmt,  # type: ignore[arg-type]
                title="Benchmark Document",
                sections=[ReportSection(heading="Section", body="Benchmark content " * 30)],
                table_headers=["ColA", "ColB", "ColC"],
                table_rows=[[i, f"row-{i}", i * 1.5] for i in range(25)],
            ),
            ctx,
        )
        await reader.execute(DocReadInput(path=str(out_path)), ctx)
        doc_times[f"doc_{fmt}_generate_and_parse_ms"] = round((time.perf_counter() - t0) * 1000, 2)

    # SQLite query latency (100 indexed reads)
    settings = AgentOSSettings(
        host="127.0.0.1",
        port=47896,
        session_token="db-bench-token-1234567890abcdef",
        data_dir=tmp / "db_bench",
    )
    db = DatabaseManager(settings)
    await db.initialize()
    t0 = time.perf_counter()
    for _ in range(100):
        async with db.session() as session:
            await session.execute(select(AuditLog).limit(20))
    db_100_queries_ms = round((time.perf_counter() - t0) * 1000, 2)
    await db.dispose()

    return {
        "tool_file_list_40_files_ms": file_list_ms,
        "tool_file_duplicates_40_files_ms": file_dups_ms,
        "tool_system_health_ms": sys_health_ms,
        **doc_times,
        "sqlite_100_queries_total_ms": db_100_queries_ms,
        "sqlite_avg_query_ms": round(db_100_queries_ms / 100.0, 3),
    }


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="agentos_perf_") as tmp_str:
        tmp = Path(tmp_str)
        startup_metrics = measure_backend_startup_and_memory(tmp)
        local_metrics = asyncio.run(measure_tools_docs_and_db(tmp))

    vm = psutil.virtual_memory()
    report = {
        "measured_at": datetime.now(UTC).isoformat(),
        "hardware": {
            "os": platform.system(),
            "os_version": platform.mac_ver()[0] or platform.release(),
            "arch": platform.machine(),
            "logical_cpus": psutil.cpu_count(logical=True),
            "total_ram_gb": round(vm.total / (1024**3), 2),
            "python": platform.python_version(),
        },
        "metrics": {**startup_metrics, **local_metrics},
    }

    out_dir = Path(__file__).resolve().parent / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "perf_results.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
