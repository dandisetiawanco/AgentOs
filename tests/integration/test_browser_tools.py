from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from agentos.tools.base import ToolContext
from agentos.tools.browser_tools import (
    BrowserExportInput,
    BrowserExportTool,
    BrowserExtractInput,
    BrowserExtractTool,
    BrowserFillFormInput,
    BrowserFillFormTool,
    BrowserScreenshotInput,
    BrowserScreenshotTool,
)


class _FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        html = """<!doctype html>
        <html lang="en">
          <head><title>AgentOS Local Fixture</title></head>
          <body>
            <h1>AgentOS Test Fixture</h1>
            <h2>Section Alpha</h2>
            <p>Verified local fixture content for Playwright isolation testing.</p>
            <form id="sample-form">
              <label for="note">Note</label>
              <input id="note" name="note" type="text" />
              <button id="submit-btn" type="button" onclick="document.title='Submitted'">Submit</button>
            </form>
            <a href="/next">Next Page</a>
          </body>
        </html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


@pytest.mark.asyncio
async def test_browser_intelligence_isolated_playwright_session(tmp_path: Path) -> None:
    server = HTTPServer(("127.0.0.1", 0), _FixtureHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    ws = tmp_path / "browser_ws"
    ws.mkdir()
    ctx = ToolContext(
        task_id="tsk_browser",
        step_id="stp_browser",
        authorized_workspaces=[ws.resolve()],
        workspace_policies={str(ws.resolve()): {"read_only": False, "allow_delete": False}},
        data_dir=ws,
        rollback_dir=ws,
        browser_profiles_dir=ws,
        exports_dir=ws,
        max_file_size_bytes=10 * 1024 * 1024,
        max_screenshot_width=1280,
        terminal_enabled=False,
        terminal_allowlist=[],
        computer_use_enabled=False,
        computer_use_screen_capture=False,
        computer_use_approved_apps=[],
    )

    url = f"http://127.0.0.1:{port}/"
    try:
        extract = await BrowserExtractTool().execute(BrowserExtractInput(url=url), ctx)
        assert extract.ok is True
        assert extract.untrusted_content is True
        assert extract.data["title"] == "AgentOS Local Fixture"
        assert len(extract.data["headings"]) == 2

        shot_path = ws / "capture.png"
        shot_tool = BrowserScreenshotTool()
        shot_args = BrowserScreenshotInput(url=url, output_path=str(shot_path))
        shot_out = await shot_tool.execute(shot_args, ctx)
        assert shot_out.ok is True
        ver = await shot_tool.verify(shot_args, shot_out, ctx)
        assert ver.verified is True

        export_path = ws / "page_export.md"
        exp = await BrowserExportTool().execute(
            BrowserExportInput(url=url, output_path=str(export_path), format="md"), ctx
        )
        assert exp.ok is True
        assert "AgentOS Test Fixture" in export_path.read_text(encoding="utf-8")

        filled = await BrowserFillFormTool().execute(
            BrowserFillFormInput(
                url=url,
                fields={"#note": "approved value"},
                submit_selector="#submit-btn",
                submit=True,
            ),
            ctx,
        )
        assert filled.ok is True
        assert filled.data["submitted"] is True
    finally:
        server.shutdown()
        server.server_close()
