from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from agentos.api.app import create_app
from agentos.config import AgentOSSettings
from agentos.errors import PathSecurityError
from agentos.security.paths import resolve_authorized_path, validate_workspace_root
from agentos.security.redactor import global_redactor, redact_text, redact_value


@pytest.fixture
def temp_settings(tmp_path: Path) -> AgentOSSettings:
    return AgentOSSettings(
        host="127.0.0.1",
        port=47899,
        session_token="test-session-token-1234567890abcdef",
        data_dir=tmp_path / "agentos_data",
    )


async def test_health_and_auth_enforcement(temp_settings: AgentOSSettings) -> None:
    app = create_app(settings=temp_settings, force_memory_keychain=True)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            health = await client.get("/api/v1/health")
            assert health.status_code == 200
            body = health.json()
            assert body["status"] == "ok"
            assert body["database"]["ok"] is True

            unauth = await client.get("/api/v1/settings")
            assert unauth.status_code == 401

            bad_auth = await client.get(
                "/api/v1/settings",
                headers={"Authorization": "Bearer wrong-token"},
            )
            assert bad_auth.status_code == 401

            headers = {"Authorization": f"Bearer {temp_settings.session_token}"}
            boot = await client.get("/api/v1/system/bootstrap", headers=headers)
            assert boot.status_code == 200
            assert boot.json()["app"]["name"] == "AgentOS"
            assert len(boot.json()["providers"]) >= 6


async def test_provider_credentials_and_redaction(temp_settings: AgentOSSettings) -> None:
    app = create_app(settings=temp_settings, force_memory_keychain=True)
    secret_key = "sk-live-supersecretkey-9876543210"
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        headers = {"Authorization": f"Bearer {temp_settings.session_token}"}
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            set_res = await client.put(
                "/api/v1/providers/openai/credential",
                headers=headers,
                json={"api_key": secret_key},
            )
            assert set_res.status_code == 200
            assert set_res.json()["has_api_key"] is True
            assert secret_key not in set_res.text

            diag = await client.get("/api/v1/diagnostics/export", headers=headers)
            assert diag.status_code == 200
            assert secret_key not in diag.text
            assert temp_settings.session_token not in diag.text

            test_mock = await client.post("/api/v1/providers/mock/test", headers=headers)
            assert test_mock.status_code == 200
            assert test_mock.json()["ok"] is True

            del_res = await client.delete("/api/v1/providers/openai/credential", headers=headers)
            assert del_res.status_code == 200
            assert del_res.json()["has_api_key"] is False


async def test_workspace_authorization_and_path_security(
    temp_settings: AgentOSSettings,
    tmp_path: Path,
) -> None:
    ws_dir = tmp_path / "safe_workspace"
    ws_dir.mkdir()
    outside_file = tmp_path / "secret.txt"
    outside_file.write_text("top-secret", encoding="utf-8")
    escape_link = ws_dir / "escape_link.txt"
    escape_link.symlink_to(outside_file)

    canonical = validate_workspace_root(str(ws_dir))
    assert canonical == ws_dir.resolve()

    with pytest.raises(PathSecurityError):
        validate_workspace_root("/etc")

    with pytest.raises(PathSecurityError):
        resolve_authorized_path(str(ws_dir / ".." / "secret.txt"), [canonical])

    with pytest.raises(PathSecurityError):
        resolve_authorized_path(str(escape_link), [canonical])

    app = create_app(settings=temp_settings, force_memory_keychain=True)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        headers = {"Authorization": f"Bearer {temp_settings.session_token}"}
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            created = await client.post(
                "/api/v1/workspaces",
                headers=headers,
                json={"name": "Safe Fixture", "path": str(ws_dir), "read_only": False},
            )
            assert created.status_code == 200
            ws_id = created.json()["workspace"]["id"]

            blocked = await client.post(
                "/api/v1/workspaces",
                headers=headers,
                json={"name": "System Etc", "path": "/etc", "read_only": True},
            )
            assert blocked.status_code == 403

            listed = await client.get("/api/v1/workspaces", headers=headers)
            assert any(w["id"] == ws_id for w in listed.json()["workspaces"])


def test_secret_redactor_scrubs_patterns() -> None:
    global_redactor.register("custom-secret-value-123456")
    assert "custom-secret-value-123456" not in redact_text("leak custom-secret-value-123456 here")
    assert "AIzaSyA1234567890123456789012345" not in redact_text(
        "key AIzaSyA1234567890123456789012345"
    )
    scrubbed = redact_value(
        {"api_key": "should-hide", "nested": {"authorization": "Bearer abcdef12345678901234"}}
    )
    assert scrubbed["api_key"] == "[REDACTED]"
    assert scrubbed["nested"]["authorization"] == "[REDACTED]"
