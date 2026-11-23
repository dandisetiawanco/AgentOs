from __future__ import annotations

import asyncio
import logging
import platform
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from agentos import APP_NAME, APP_TAGLINE, AUTHOR, ORG_NAME, SCHEMA_VERSION, __version__
from agentos.api.schemas import (
    AppSettingsPayload,
    HealthResponse,
    ProviderCredentialRequest,
    ProviderUpdateRequest,
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)
from agentos.config import AgentOSSettings
from agentos.errors import AgentOSError, NotFoundError
from agentos.observability.audit import AuditLogger
from agentos.observability.logging import configure_logging
from agentos.providers.manager import ProviderManager
from agentos.security.auth import require_session_auth
from agentos.security.keychain import CredentialStore
from agentos.security.paths import validate_workspace_root
from agentos.security.redactor import global_redactor, redact_text, redact_value
from agentos.storage.database import DatabaseManager
from agentos.storage.models import AppSetting, ProviderConfig, Task, Workspace

logger = logging.getLogger("agentos.api")


async def load_app_settings(db: DatabaseManager) -> AppSettingsPayload:
    async with db.session() as session:
        row = await session.get(AppSetting, "core")
        if row is None:
            payload = AppSettingsPayload()
            session.add(
                AppSetting(
                    key="core",
                    value_json=payload.model_dump(),
                    schema_version=SCHEMA_VERSION,
                )
            )
            return payload
        return AppSettingsPayload.model_validate(row.value_json)


def create_app(
    settings: AgentOSSettings | None = None,
    *,
    force_memory_keychain: bool = False,
) -> FastAPI:
    runtime_settings = settings or AgentOSSettings()
    runtime_settings.ensure_loopback_policy()
    global_redactor.register(runtime_settings.session_token)

    db = DatabaseManager(runtime_settings)
    credentials = CredentialStore(force_memory=force_memory_keychain)
    providers = ProviderManager(credentials)
    audit = AuditLogger()
    started_at = time.monotonic()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime_settings.ensure_directories()
        configure_logging(runtime_settings.log_level, runtime_settings.logs_dir)
        await db.initialize()
        await load_app_settings(db)
        logger.info("AgentOS backend ready on %s:%s", runtime_settings.host, runtime_settings.port)
        yield
        await db.dispose()
        logger.info("AgentOS backend shut down cleanly.")

    app = FastAPI(
        title=APP_NAME,
        version=__version__,
        description=f"{APP_NAME}: {APP_TAGLINE}",
        lifespan=lifespan,
    )
    app.state.settings = runtime_settings
    app.state.db = db
    app.state.credentials = credentials
    app.state.providers = providers
    app.state.audit = audit
    app.state.started_at = started_at

    app.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(AgentOSError)
    async def handle_agentos_error(_request: Request, exc: AgentOSError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=exc.to_dict())

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled backend exception")
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": redact_text(f"Unexpected backend error: {exc}"),
                    "recoverable": True,
                    "details": {},
                }
            },
        )

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        db_health = await db.verify_health()
        return HealthResponse(
            status="ok",
            app=APP_NAME,
            version=__version__,
            uptime_sec=round(time.monotonic() - started_at, 2),
            database=db_health,
        )

    @app.get(
        "/api/v1/system/bootstrap",
        dependencies=[Depends(require_session_auth)],
        tags=["system"],
    )
    async def bootstrap() -> dict[str, Any]:
        app_cfg = await load_app_settings(db)
        async with db.session() as session:
            provider_list = await providers.list_provider_statuses(session)
            ws_count = (await session.execute(select(func.count(Workspace.id)))).scalar_one()
            task_count = (await session.execute(select(func.count(Task.id)))).scalar_one()
        return {
            "app": {
                "name": APP_NAME,
                "tagline": APP_TAGLINE,
                "version": __version__,
                "organization": ORG_NAME,
                "author": AUTHOR,
                "platform": platform.system(),
                "arch": platform.machine(),
                "python_version": platform.python_version(),
            },
            "keychain": {
                "backend": credentials.status.backend_name,
                "persistent": credentials.status.persistent,
                "warning": credentials.status.warning,
            },
            "settings": app_cfg.model_dump(),
            "providers": provider_list,
            "counts": {
                "workspaces": int(ws_count),
                "tasks": int(task_count),
            },
        }

    @app.get(
        "/api/v1/settings",
        response_model=AppSettingsPayload,
        dependencies=[Depends(require_session_auth)],
        tags=["settings"],
    )
    async def get_settings() -> AppSettingsPayload:
        return await load_app_settings(db)

    @app.put(
        "/api/v1/settings",
        response_model=AppSettingsPayload,
        dependencies=[Depends(require_session_auth)],
        tags=["settings"],
    )
    async def update_settings(payload: AppSettingsPayload) -> AppSettingsPayload:
        async with db.session() as session:
            row = await session.get(AppSetting, "core")
            if row is None:
                row = AppSetting(
                    key="core",
                    value_json=payload.model_dump(),
                    schema_version=SCHEMA_VERSION,
                )
                session.add(row)
            else:
                row.value_json = payload.model_dump()
                row.schema_version = SCHEMA_VERSION
            await audit.record(
                session,
                category="settings",
                action="settings.update",
                actor="user",
                risk_level="LOW",
                summary="Updated application settings.",
                details={
                    "theme": payload.theme,
                    "default_provider_id": payload.default_provider_id,
                    "terminal_enabled": payload.terminal_enabled,
                    "memory_enabled": payload.memory_enabled,
                },
            )
        return payload

    @app.get(
        "/api/v1/providers",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def list_providers() -> dict[str, Any]:
        async with db.session() as session:
            items = await providers.list_provider_statuses(session)
        return {"providers": items}

    @app.put(
        "/api/v1/providers/{provider_id}",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def update_provider(provider_id: str, req: ProviderUpdateRequest) -> dict[str, Any]:
        async with db.session() as session:
            row = await session.get(ProviderConfig, provider_id)
            if row is None:
                raise NotFoundError(f"Provider '{provider_id}' not found.")
            if req.enabled is not None:
                row.enabled = req.enabled
            if req.base_url is not None:
                row.base_url = req.base_url.strip() or None
            if req.default_model is not None and req.default_model.strip():
                row.default_model = req.default_model.strip()
            if req.timeout_sec is not None:
                row.timeout_sec = req.timeout_sec
            if req.max_retries is not None:
                row.max_retries = req.max_retries
            await audit.record(
                session,
                category="provider",
                action="provider.configure",
                actor="user",
                risk_level="LOW",
                summary=f"Updated provider configuration for {row.display_name}.",
                details={"provider_id": provider_id, "default_model": row.default_model},
            )
            items = await providers.list_provider_statuses(session)
        matched = next(p for p in items if p["id"] == provider_id)
        return {"provider": matched}

    @app.put(
        "/api/v1/providers/{provider_id}/credential",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def set_provider_credential(
        provider_id: str, req: ProviderCredentialRequest
    ) -> dict[str, Any]:
        async with db.session() as session:
            row = await session.get(ProviderConfig, provider_id)
            if row is None:
                raise NotFoundError(f"Provider '{provider_id}' not found.")
            credentials.set_secret(providers.secret_key_name(provider_id), req.api_key)
            await audit.record(
                session,
                category="security",
                action="provider.credential.set",
                actor="user",
                risk_level="MEDIUM",
                summary=f"Stored API credential for {row.display_name} in {credentials.status.backend_name}.",
                details={
                    "provider_id": provider_id,
                    "keychain_persistent": credentials.status.persistent,
                },
            )
        return {
            "provider_id": provider_id,
            "has_api_key": True,
            "api_key_hint": credentials.masked_hint(providers.secret_key_name(provider_id)),
        }

    @app.delete(
        "/api/v1/providers/{provider_id}/credential",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def delete_provider_credential(provider_id: str) -> dict[str, Any]:
        async with db.session() as session:
            row = await session.get(ProviderConfig, provider_id)
            if row is None:
                raise NotFoundError(f"Provider '{provider_id}' not found.")
            credentials.delete_secret(providers.secret_key_name(provider_id))
            await audit.record(
                session,
                category="security",
                action="provider.credential.delete",
                actor="user",
                risk_level="MEDIUM",
                summary=f"Removed API credential for {row.display_name}.",
                details={"provider_id": provider_id},
            )
        return {"provider_id": provider_id, "has_api_key": False}

    @app.post(
        "/api/v1/providers/{provider_id}/test",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def test_provider(provider_id: str) -> dict[str, Any]:
        async with db.session() as session:
            result = await providers.test_provider(session, provider_id)
            await audit.record(
                session,
                category="provider",
                action="provider.test",
                actor="user",
                risk_level="READ_ONLY",
                outcome="ok" if result.ok else "failed",
                summary=result.message,
                details={"provider_id": provider_id, "latency_ms": result.latency_ms},
            )
        return {
            "ok": result.ok,
            "provider_id": result.provider_id,
            "latency_ms": result.latency_ms,
            "message": result.message,
            "discovered_models": result.discovered_models,
        }

    @app.get(
        "/api/v1/providers/{provider_id}/models",
        dependencies=[Depends(require_session_auth)],
        tags=["providers"],
    )
    async def discover_provider_models(provider_id: str) -> dict[str, Any]:
        async with db.session() as session:
            models = await providers.discover_models(session, provider_id)
        return {
            "provider_id": provider_id,
            "models": [
                {
                    "id": m.id,
                    "name": m.name,
                    "context_window": m.context_window,
                    "input_cost_per_1m_usd": m.input_cost_per_1m_usd,
                    "output_cost_per_1m_usd": m.output_cost_per_1m_usd,
                }
                for m in models
            ],
        }

    @app.get(
        "/api/v1/workspaces",
        dependencies=[Depends(require_session_auth)],
        tags=["workspaces"],
    )
    async def list_workspaces() -> dict[str, Any]:
        async with db.session() as session:
            rows = (
                (await session.execute(select(Workspace).order_by(Workspace.created_at)))
                .scalars()
                .all()
            )
        return {
            "workspaces": [
                WorkspaceResponse(
                    id=w.id,
                    name=w.name,
                    path=w.path,
                    read_only=w.read_only,
                    allow_delete=w.allow_delete,
                    exists=await asyncio.to_thread(Path(w.path).exists),
                    created_at=w.created_at.isoformat() if w.created_at else None,
                ).model_dump()
                for w in rows
            ]
        }

    @app.post(
        "/api/v1/workspaces",
        dependencies=[Depends(require_session_auth)],
        tags=["workspaces"],
    )
    async def create_workspace(req: WorkspaceCreateRequest) -> dict[str, Any]:
        canonical = validate_workspace_root(req.path)
        async with db.session() as session:
            existing = (
                await session.execute(select(Workspace).where(Workspace.path == str(canonical)))
            ).scalar_one_or_none()
            if existing is not None:
                return {
                    "workspace": WorkspaceResponse(
                        id=existing.id,
                        name=existing.name,
                        path=existing.path,
                        read_only=existing.read_only,
                        allow_delete=existing.allow_delete,
                        exists=True,
                        created_at=existing.created_at.isoformat() if existing.created_at else None,
                    ).model_dump()
                }
            ws = Workspace(
                id=f"ws_{uuid.uuid4().hex[:12]}",
                name=req.name.strip(),
                path=str(canonical),
                read_only=req.read_only,
                allow_delete=req.allow_delete,
            )
            session.add(ws)
            await audit.record(
                session,
                category="workspace",
                action="workspace.authorize",
                actor="user",
                risk_level="MEDIUM",
                summary=f"Authorized workspace '{ws.name}' at {ws.path}.",
                details={"workspace_id": ws.id, "read_only": ws.read_only},
            )
        return {
            "workspace": WorkspaceResponse(
                id=ws.id,
                name=ws.name,
                path=ws.path,
                read_only=ws.read_only,
                allow_delete=ws.allow_delete,
                exists=True,
                created_at=ws.created_at.isoformat() if ws.created_at else None,
            ).model_dump()
        }

    @app.patch(
        "/api/v1/workspaces/{workspace_id}",
        dependencies=[Depends(require_session_auth)],
        tags=["workspaces"],
    )
    async def update_workspace(workspace_id: str, req: WorkspaceUpdateRequest) -> dict[str, Any]:
        async with db.session() as session:
            ws = await session.get(Workspace, workspace_id)
            if ws is None:
                raise NotFoundError(f"Workspace '{workspace_id}' not found.")
            if req.name is not None:
                ws.name = req.name.strip()
            if req.read_only is not None:
                ws.read_only = req.read_only
            if req.allow_delete is not None:
                ws.allow_delete = req.allow_delete
            await audit.record(
                session,
                category="workspace",
                action="workspace.update",
                actor="user",
                risk_level="LOW",
                summary=f"Updated workspace permissions for '{ws.name}'.",
                details={
                    "workspace_id": ws.id,
                    "read_only": ws.read_only,
                    "allow_delete": ws.allow_delete,
                },
            )
        return {
            "workspace": WorkspaceResponse(
                id=ws.id,
                name=ws.name,
                path=ws.path,
                read_only=ws.read_only,
                allow_delete=ws.allow_delete,
                exists=await asyncio.to_thread(Path(ws.path).exists),
                created_at=ws.created_at.isoformat() if ws.created_at else None,
            ).model_dump()
        }

    @app.delete(
        "/api/v1/workspaces/{workspace_id}",
        dependencies=[Depends(require_session_auth)],
        tags=["workspaces"],
    )
    async def delete_workspace(workspace_id: str) -> dict[str, Any]:
        async with db.session() as session:
            ws = await session.get(Workspace, workspace_id)
            if ws is None:
                raise NotFoundError(f"Workspace '{workspace_id}' not found.")
            name, path_str = ws.name, ws.path
            await session.delete(ws)
            await audit.record(
                session,
                category="workspace",
                action="workspace.revoke",
                actor="user",
                risk_level="MEDIUM",
                summary=f"Revoked authorization for workspace '{name}' ({path_str}).",
                details={"workspace_id": workspace_id},
            )
        return {"deleted": True, "workspace_id": workspace_id}

    @app.get(
        "/api/v1/audit",
        dependencies=[Depends(require_session_auth)],
        tags=["audit"],
    )
    async def get_audit_logs(
        category: str | None = None,
        risk_level: str | None = None,
        task_id: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        async with db.session() as session:
            events = await audit.list_events(
                session,
                category=category,
                risk_level=risk_level,
                task_id=task_id,
                limit=limit,
            )
        return {"events": events}

    @app.get(
        "/api/v1/diagnostics/export",
        dependencies=[Depends(require_session_auth)],
        tags=["system"],
    )
    async def export_diagnostics() -> dict[str, Any]:
        db_health = await db.verify_health()
        app_cfg = await load_app_settings(db)
        async with db.session() as session:
            provider_list = await providers.list_provider_statuses(session)
            recent_audit = await audit.list_events(session, limit=50)
        redacted: dict[str, Any] = redact_value(
            {
                "app": {"name": APP_NAME, "version": __version__, "org": ORG_NAME},
                "runtime": {
                    "os": platform.system(),
                    "release": platform.release(),
                    "arch": platform.machine(),
                    "python": platform.python_version(),
                    "uptime_sec": round(time.monotonic() - started_at, 2),
                },
                "database": db_health,
                "keychain": {
                    "backend": credentials.status.backend_name,
                    "persistent": credentials.status.persistent,
                },
                "settings": app_cfg.model_dump(),
                "providers": provider_list,
                "recent_audit": recent_audit,
            }
        )
        return redacted

    return app
