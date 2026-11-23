# Architecture Decision Records (ADRs)

## ADR-001: Python 3.12.16 as Backend Runtime
- Status: Accepted
- Context: The development machine has Python 3.9.6, 3.11.15, 3.12.16, 3.13.18, 3.14.7, and 3.15.2 installed, with `python3` defaulting to 3.15.2. Prebuilt wheels for native dependencies (Pydantic core, SQLAlchemy/greenlet, Playwright, cryptography, lxml, psutil) are mature and widely tested on Python 3.12 across macOS x86_64, macOS arm64, Windows, and Linux.
- Decision: Pin backend virtual environment to Python 3.12 (`>=3.12,<3.14`) via `uv` (`uv venv --python 3.12`) and `pyproject.toml`.
- Consequences: Eliminates build-from-source failures on Intel macOS 8 GB RAM while staying on a long-supported Python release.

## ADR-002: Tauri 2 + Rust Desktop Shell on Intel macOS
- Status: Accepted
- Context: The primary machine is a 2019 Intel MacBook Pro with 8 GB RAM. Electron bundles Chromium and typically consumes 250-400+ MB idle memory. Tauri 2 uses macOS native WKWebView and a lightweight Rust bridge.
- Decision: Install stable Rust locally via `rustup` (authorized by user) and build the desktop application using Tauri 2 (`tauri = "2"`), React, TypeScript (strict), Vite, and Tailwind CSS.
- Consequences: Lower memory footprint on 8 GB Intel hardware, native OS Keychain and process lifecycle integration, strict Tauri capability boundaries, and clean cross-platform CI matrix structure.

## ADR-003: Authenticated Localhost Backend Lifecycle
- Status: Accepted
- Context: The Python AI backend must communicate with the Tauri frontend without exposing unauthenticated endpoints to other local processes or browsers.
- Decision: On startup, the Rust desktop bridge selects an available loopback port on `127.0.0.1`, generates a 256-bit cryptographically random session token passed via environment variable (`AGENTOS_SESSION_TOKEN`) to the spawned backend process, verifies readiness via `/api/v1/health`, and passes the runtime connection config (`baseUrl`, `token`) to the frontend exclusively via a Tauri IPC command (`get_backend_config`). All mutating and data endpoints require `Authorization: Bearer <token>` and strict CORS restricted to the Tauri webview origin (plus explicit localhost dev origin during development). On app exit, the Rust bridge sends SIGTERM, waits up to 5 seconds, and force-terminates if needed to prevent orphaned processes.
- Consequences: Prevents port collisions, unauthorized localhost access, and orphaned background processes.

## ADR-004: Execution-Boundary Prompt Injection Defense
- Status: Accepted
- Context: Model prompts alone cannot reliably prevent prompt injection from untrusted web pages, documents, or command output.
- Decision: Enforce all authorization, path canonicalization, risk classification, tool argument schema validation, command allowlisting, and approval gates inside deterministic Python code (`PermissionEngine` and `ExecutionEngine`) after planning and before every tool call. Untrusted content ingested by tools is wrapped in structured data envelopes and never allowed to mutate permissions, workspace lists, or approval states.
- Consequences: Even a compromised or adversarial model response cannot bypass directory boundaries, risk gates, or blocked commands.

## ADR-005: SQLite Persistence with Explicit Alembic Migrations
- Status: Accepted
- Context: AgentOS is local-first and must persist tasks, execution steps, approvals, audit logs, memory entries, workflows, and provider/workspace settings across restarts without external database servers.
- Decision: Use SQLite in WAL mode (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`) via SQLAlchemy 2 async/sync engine with explicit Alembic migration scripts under `backend/migrations/`.
- Consequences: Zero external database dependencies, safe concurrent reads during SSE streaming, and backward-compatible schema migrations.

## ADR-006: LangGraph Orchestration with Deterministic Budget and Verification Guards
- Status: Accepted
- Context: Agent workflows must follow a structured, observable, resumable lifecycle with typed states and verifiable completion.
- Decision: Use LangGraph (`langgraph`) for the structured agent state graph (`analyze_intent -> retrieve_context -> build_plan -> classify_risk -> await_approval -> execute_step -> verify_step -> recover_or_finalize`), backed by our SQLite `StateManager` so tasks survive restarts, support pause/resume/cancel, and strictly enforce execution budgets (`max_duration_sec`, `max_tool_calls`, `max_retries`, `max_tokens`, `max_cost_usd`).
- Consequences: Combines standard graph orchestration with deterministic state persistence and budget enforcement.

## ADR-007: Keychain-First Secret Management
- Status: Accepted
- Context: Raw API keys must never be stored in plaintext config files, SQLite, localStorage, logs, or screenshots.
- Decision: Store user-supplied provider API keys in macOS Keychain via Python `keyring` (falling back to an explicitly warned ephemeral in-memory vault only in headless CI environments without a keychain daemon, never writing raw keys to SQLite or disk). Apply a centralized `SecretRedactor` to all logs, error payloads, SSE streams, and exported diagnostic reports.
- Consequences: Meets local-first security expectations on macOS without exposing credentials in project or database files.

## ADR-008: Monorepo Structure at Repository Root
- Status: Accepted
- Context: The project workspace root was empty; placing the repository root directly in the workspace avoids an unnecessary extra nesting directory.
- Decision: Initialize the Git repository directly at the workspace root (`AgentOs/`) following the planned directory structure (`apps/desktop`, `packages/shared`, `packages/ui`, `backend`, `tests`, `benchmarks`, `docs`, `scripts`, `assets`, `.github`).
- Consequences: Cleaner developer workflow and direct alignment with IDE workspace root.
