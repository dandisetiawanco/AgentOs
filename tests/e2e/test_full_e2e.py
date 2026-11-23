"""Full-stack Playwright end-to-end verification and real screenshot capture.

Spawns the real AgentOS FastAPI backend and serves the built production React bundle,
exercises all mandatory E2E flows, verifies light/dark/mobile layouts with zero console errors,
and captures real screenshots into assets/screenshots/.
"""

from __future__ import annotations

import functools
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest
from playwright.async_api import async_playwright


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _start_backend(
    port: int, frontend_port: int, token: str, data_dir: Path
) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["AGENTOS_SESSION_TOKEN"] = token
    env["AGENTOS_DATA_DIR"] = str(data_dir)
    env["AGENTOS_CORS_ORIGINS"] = json.dumps(
        [
            f"http://127.0.0.1:{frontend_port}",
            f"http://localhost:{frontend_port}",
        ]
    )
    backend_dir = Path(__file__).resolve().parents[2] / "backend"
    proc = subprocess.Popen(
        [sys.executable, "-m", "agentos", "--host", "127.0.0.1", "--port", str(port)],
        cwd=str(backend_dir),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    deadline = time.monotonic() + 18.0
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            out, err = proc.communicate(timeout=2)
            raise RuntimeError(f"Backend exited early: {out}\n{err}")
        try:
            r = httpx.get(f"http://127.0.0.1:{port}/api/v1/health", timeout=0.8)
            if r.status_code == 200:
                return proc
        except httpx.HTTPError:
            pass
        time.sleep(0.15)
    proc.kill()
    raise RuntimeError("Timed out starting E2E backend.")


@pytest.mark.asyncio
async def test_full_stack_e2e_lifecycle_clickthrough_and_screenshots(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    dist_dir = repo_root / "apps" / "desktop" / "dist"
    assert dist_dir.is_dir(), "Build frontend first with 'pnpm build'"

    shots_dir = repo_root / "assets" / "screenshots"
    shots_dir.mkdir(parents=True, exist_ok=True)

    ws_dir = tmp_path / "e2e_workspace"
    ws_dir.mkdir()
    (ws_dir / "quarterly.csv").write_text("quarter,revenue\nQ1,120\nQ2,145\n", encoding="utf-8")
    (ws_dir / "notes.txt").write_text("AgentOS E2E fixture note.", encoding="utf-8")
    (ws_dir / "notes_dup.txt").write_text("AgentOS E2E fixture note.", encoding="utf-8")

    data_dir = tmp_path / "e2e_data"
    backend_port = _free_port()
    frontend_port = _free_port()
    token = "e2e-session-token-0123456789abcdef"

    backend_proc = _start_backend(backend_port, frontend_port, token, data_dir)

    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(dist_dir))
    http_server = ThreadingHTTPServer(("127.0.0.1", frontend_port), handler)
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    http_thread.start()

    console_errors: list[str] = []

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 820})
            await context.add_init_script(
                f"""window.__AGENTOS_TEST_CONFIG__ = {{
                    base_url: "http://127.0.0.1:{backend_port}",
                    session_token: "{token}",
                    pid: null,
                    managed_by_tauri: false
                }};"""
            )
            page = await context.new_page()
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
            )
            page.on("pageerror", lambda err: console_errors.append(str(err)))

            # 1. First launch -> Overview (Light mode)
            await page.goto(f"http://127.0.0.1:{frontend_port}/", wait_until="networkidle")
            await page.get_by_role("heading", name="AgentOS Workspace").wait_for(timeout=10000)
            await page.screenshot(path=str(shots_dir / "overview-light.png"))

            # 2. Settings -> Test mock provider + Authorize temporary workspace
            await page.get_by_role("button", name="Settings").click()
            await page.get_by_role("heading", name="Settings").wait_for()
            await page.fill("#ws-name", "E2E Fixture Workspace")
            await page.fill("#ws-path", str(ws_dir))
            await page.get_by_role("button", name="Authorize", exact=True).click()
            await page.get_by_text("E2E Fixture Workspace").wait_for(timeout=8000)
            await page.screenshot(path=str(shots_dir / "settings-providers.png"))

            # 3. Assistant -> Read-only task (duplicate detection + organization)
            await page.get_by_role("button", name="Assistant").click()
            await page.get_by_role("heading", name="Assistant").wait_for()
            await page.fill(
                "#asst-instruction",
                "Organize workspace files and detect duplicate files",
            )
            await page.get_by_role("button", name="Plan & run").click()
            await page.get_by_text("Verified complete").first.wait_for(timeout=15000)

            # 4. Assistant -> Mutating task -> Approval dialog -> Approve & execute -> Rollback
            await page.fill("#asst-instruction", "Create folder deliverables")
            await page.get_by_role("button", name="Plan & run").click()
            await page.get_by_role("heading", name="Approve sensitive execution plan").wait_for(
                timeout=10000
            )
            await page.screenshot(path=str(shots_dir / "approval-dialog.png"))
            assert not (ws_dir / "deliverables").exists()

            await page.get_by_role("button", name="Approve & execute").click()
            await page.get_by_text("Approved steps executed and verified.").wait_for(timeout=12000)
            assert (ws_dir / "deliverables").is_dir()

            # Switch to Dark mode in Settings and capture Assistant dark screenshot
            await page.get_by_role("button", name="Settings").click()
            await page.get_by_role("radio", name="Dark").click()
            await page.get_by_role("button", name="Assistant").click()
            await page.get_by_role("heading", name="Assistant").wait_for()
            await page.screenshot(path=str(shots_dir / "assistant-dark.png"))

            # Restore created folder via Rollback button
            await page.get_by_role("button", name="Restore files").click()
            await page.get_by_text("Restored 1 recorded file operation(s).").wait_for(timeout=8000)
            assert not (ws_dir / "deliverables").exists()

            # 5. Visit Tasks, Workflows, Tools, Memory, Activity
            await page.get_by_role("button", name="Tasks").click()
            await page.get_by_role("heading", name="Tasks").wait_for()
            await page.screenshot(path=str(shots_dir / "tasks-inspector.png"))

            await page.get_by_role("button", name="Workflows").click()
            await page.get_by_role("heading", name="Workflows").wait_for()

            await page.get_by_role("button", name="Tools").click()
            await page.get_by_role("heading", name="Tool Registry").wait_for()
            await page.get_by_text("file.duplicates").wait_for()

            await page.get_by_role("button", name="Memory").click()
            await page.get_by_role("heading", name="Local Memory").wait_for()
            await page.get_by_role("button", name="Add memory").click()
            await page.fill("#m-title", "E2E Preference")
            await page.fill("#m-content", "Always keep summaries concise.")
            await page.get_by_role("button", name="Save memory").click()
            await page.get_by_text("E2E Preference").wait_for(timeout=8000)

            await page.get_by_role("button", name="Activity").click()
            await page.get_by_role("heading", name="Activity & Audit Log").wait_for()
            await page.get_by_text("workspace.authorize").first.wait_for()

            # 6. Mobile / narrow viewport overflow check (390x844)
            await page.set_viewport_size({"width": 390, "height": 844})
            await page.get_by_role("button", name="Open navigation menu").wait_for()
            overflow = await page.evaluate(
                "() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
            )
            assert overflow is False, "Horizontal overflow detected at 390px mobile viewport!"

            # 7. Restart backend against same SQLite DB and verify task history survives restart
            backend_proc.send_signal(signal.SIGTERM)
            backend_proc.wait(timeout=8.0)
            backend_proc = _start_backend(backend_port, frontend_port, token, data_dir)

            await page.set_viewport_size({"width": 1280, "height": 820})
            await page.reload(wait_until="networkidle")
            await page.get_by_role("button", name="Tasks", exact=True).click()
            await page.get_by_text("Create folder deliverables").first.wait_for(timeout=10000)

            await browser.close()

        assert console_errors == [], f"Unexpected browser console errors: {console_errors}"
    finally:
        http_server.shutdown()
        http_server.server_close()
        if backend_proc.poll() is None:
            backend_proc.send_signal(signal.SIGTERM)
            try:
                backend_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                backend_proc.kill()
                backend_proc.wait(timeout=3)
