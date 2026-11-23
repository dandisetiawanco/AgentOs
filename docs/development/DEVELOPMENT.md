# Developer Guide

## Monorepo Layout

- `apps/desktop`: React 19 + TypeScript + Tailwind CSS v4 frontend and `src-tauri/` Rust bridge
- `packages/shared`: Shared TypeScript contracts and authenticated `AgentOSClient`
- `packages/ui`: Accessible reusable UI primitives (`ModalDialog`, `Button`, `Badge`, `States`, `Logo`)
- `backend`: Isolated Python 3.12 FastAPI + LangGraph + SQLAlchemy + Alembic backend (`uv`)
- `tests`: Integration (`tests/integration`), security (`tests/security`), Playwright E2E (`tests/e2e`), and test fixtures (`tests/fixtures`)
- `benchmarks`: AI quality evaluation framework (`ai_eval.py`) and Intel macOS performance benchmarks (`perf_benchmark.py`)
- `scripts`: Icon generation (`generate_icons.py`) and OpenAPI export (`export_openapi.py`)

## Common Commands

```bash
# Refresh OpenAPI schema after API changes
cd backend && uv run python ../scripts/export_openapi.py

# Regenerate desktop icons
cd backend && uv run python ../scripts/generate_icons.py

# Build production macOS desktop bundle (.app and .dmg)
export PATH="$HOME/.cargo/bin:$PATH"
pnpm build:tauri
```

## Signing and Notarization (macOS Release)

Production builds produced locally without an Apple Developer certificate are ad-hoc signed for local testing only. For public macOS distribution, set Tauri signing environment variables (`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) before running `pnpm build:tauri`.
