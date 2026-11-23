# Third-Party Notices

AgentOS is licensed under the Apache License, Version 2.0.
It builds upon open-source software packages, each governed by its respective license:

## Desktop & Frontend (npm / pnpm)
- React & React DOM (MIT License)
- TypeScript (Apache-2.0 License)
- Vite & Vitest (MIT License)
- Tailwind CSS (MIT License)
- Lucide React Icons (ISC License)
- Tauri JS API & Plugins (Apache-2.0 / MIT Dual License)
- ESLint & Prettier (MIT License)

## Rust Desktop Bridge (Cargo)
- Tauri v2, wry, tao, tauri-plugin-dialog (Apache-2.0 / MIT Dual License)
- serde, serde_json (Apache-2.0 / MIT Dual License)
- getrandom (Apache-2.0 / MIT Dual License)
- ureq (Apache-2.0 / MIT Dual License)
- libc (Apache-2.0 / MIT Dual License)

## Python Backend (PyPI)
- FastAPI & Starlette (MIT / BSD-3-Clause)
- Uvicorn (BSD-3-Clause)
- Pydantic & Pydantic Settings (MIT License)
- SQLAlchemy & Alembic (MIT License)
- aiosqlite (MIT License)
- LangGraph & LangChain Core (MIT License)
- httpx (BSD-3-Clause)
- Playwright for Python (Apache-2.0 License)
- Model Context Protocol Python SDK (`mcp`) (MIT License)
- keyring (MIT License)
- psutil (BSD-3-Clause)
- pypdf (BSD-3-Clause)
- python-docx (MIT License)
- openpyxl (MIT License)
- ReportLab (BSD-3-Clause)
- Pillow (MIT-CMU License)
- Ruff, Mypy, Pytest, pip-audit (MIT / Apache-2.0 Licenses)

Full lockfiles (`pnpm-lock.yaml`, `backend/uv.lock`, `apps/desktop/src-tauri/Cargo.lock`) pin exact versions and transitive dependency graphs.
