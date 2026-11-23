from __future__ import annotations

import sys
from pathlib import Path

from agentos.api.app import create_app
from agentos.config import AgentOSSettings
from httpx import ASGITransport, AsyncClient


async def test_workflows_mcp_and_computer_use_endpoints(tmp_path: Path) -> None:
    ws_dir = tmp_path / "adv_ws"
    ws_dir.mkdir()
    (ws_dir / "note.md").write_text("# Hello\nSample note for workflow test.\n", encoding="utf-8")

    settings = AgentOSSettings(
        host="127.0.0.1",
        port=47892,
        session_token="adv-test-token-1234567890abcdef",
        data_dir=tmp_path / "adv_data",
    )
    app = create_app(settings=settings, force_memory_keychain=True)
    headers = {"Authorization": f"Bearer {settings.session_token}"}

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            # 1. Authorize workspace and run built-in workflow manually
            ws_res = await client.post(
                "/api/v1/workspaces",
                headers=headers,
                json={"name": "Adv Fixture", "path": str(ws_dir)},
            )
            assert ws_res.status_code == 200
            ws_id = ws_res.json()["workspace"]["id"]

            wfs = (await client.get("/api/v1/workflows", headers=headers)).json()["workflows"]
            assert len(wfs) >= 7

            # Create custom workflow & execute it
            created_wf = await client.post(
                "/api/v1/workflows",
                headers=headers,
                json={
                    "name": "Fixture Workspace Scan",
                    "description": "Lists workspace files",
                    "instruction_template": "List files and detect duplicate files in workspace",
                    "workspace_id": ws_id,
                    "schedule_enabled": True,
                    "schedule_interval_minutes": 60,
                },
            )
            assert created_wf.status_code == 200
            wf_id = created_wf.json()["workflow"]["id"]
            assert created_wf.json()["workflow"]["next_run_at"] is not None

            run_res = await client.post(f"/api/v1/workflows/{wf_id}/run", headers=headers)
            assert run_res.status_code == 200
            assert run_res.json()["task"]["status"] == "completed"
            assert run_res.json()["run"]["status"] == "completed"

            runs = (
                await client.get(f"/api/v1/workflow-runs?workflow_id={wf_id}", headers=headers)
            ).json()["runs"]
            assert len(runs) == 1

            # 2. MCP server registration, blocked command rejection, real SDK discovery, explicit authorization
            bad_mcp = await client.post(
                "/api/v1/mcp/servers",
                headers=headers,
                json={"name": "bad", "transport": "stdio", "command": ["sudo", "rm"]},
            )
            assert bad_mcp.status_code == 403

            fixture_script = (
                Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "sample_mcp_server.py"
            )
            mcp_res = await client.post(
                "/api/v1/mcp/servers",
                headers=headers,
                json={
                    "name": "fixture-echo",
                    "transport": "stdio",
                    "command": [sys.executable, str(fixture_script)],
                    "enabled": True,
                },
            )
            assert mcp_res.status_code == 200
            srv_id = mcp_res.json()["server"]["id"]
            assert mcp_res.json()["server"]["allowed_tools"] == []

            test_mcp = await client.post(f"/api/v1/mcp/servers/{srv_id}/test", headers=headers)
            assert test_mcp.status_code == 200
            body = test_mcp.json()
            assert body["ok"] is True
            assert any(t["name"] == "echo_fixture" for t in body["tools"])

            auth_mcp = await client.put(
                f"/api/v1/mcp/servers/{srv_id}/authorize",
                headers=headers,
                json={"allowed_tools": ["echo_fixture"]},
            )
            assert auth_mcp.status_code == 200
            assert auth_mcp.json()["server"]["allowed_tools"] == ["echo_fixture"]

            # 3. Computer use capability inspection & emergency stop toggle
            caps = (await client.get("/api/v1/computer-use/capabilities", headers=headers)).json()
            assert caps["continuous_recording"] is False
            assert caps["enabled_in_settings"] is False
            assert caps["emergency_stop_active"] is False

            stop_on = await client.post(
                "/api/v1/computer-use/emergency-stop",
                headers=headers,
                json={"active": True},
            )
            assert stop_on.status_code == 200
            assert stop_on.json()["emergency_stop_active"] is True

            stop_off = await client.post(
                "/api/v1/computer-use/emergency-stop",
                headers=headers,
                json={"active": False},
            )
            assert stop_off.status_code == 200
            assert stop_off.json()["emergency_stop_active"] is False
