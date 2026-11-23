# AgentOS System Architecture

## Layer Overview

1. **Desktop Shell (`apps/desktop`)**: React 19 + TypeScript strict UI communicating over Tauri IPC for runtime bootstrap (`get_backend_config`, `restart_backend`, native folder dialogs) and authenticated loopback HTTP/SSE for all application operations.
2. **Rust Desktop Bridge (`apps/desktop/src-tauri`)**: Owns local backend lifecycle, loopback port allocation, 256-bit CSPRNG token generation, health checks, strict CSP enforcement, and clean `SIGTERM` shutdown.
3. **Python AI Backend (`backend/agentos`)**: FastAPI ASGI server executing LangGraph planning and execution graphs, enforcing `PermissionEngine` policies, running deterministic tools, persisting state in SQLite WAL via SQLAlchemy + Alembic, and storing secrets in OS Keychain via `keyring`.
4. **Shared Contracts (`packages/shared`, `packages/ui`)**: Single source of TypeScript API types, authenticated SSE/REST client, and accessible native `<dialog>` / state UI primitives. OpenAPI schema is exported to `docs/api/openapi.json` (37 endpoints).

## Task Execution Lifecycle

`created -> planning -> awaiting_approval (if MEDIUM/HIGH/side-effects) -> approved -> running -> verifying -> completed`

Tasks may transition to `paused`, `cancelled`, or `failed` cleanly at any execution boundary, with full step-level audit records and rollback journals persisted in SQLite.
