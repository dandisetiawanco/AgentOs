# AgentOS Roadmap

## v0.1.0 (Initial Public Release - Completed on macOS Intel)
- Local-first Tauri 2 desktop shell + authenticated FastAPI Python backend
- 6 AI provider adapters (Gemini, OpenAI, Anthropic, Ollama, OpenAI-compatible, Offline Deterministic Test Mode)
- Default-deny Permission Engine, Keychain credential vault, prompt-injection execution-boundary enforcement
- 24 deterministic tools across File, Document, Browser, System, Restricted Terminal, and macOS Computer Use
- Local SQLite persistence with Alembic migrations, Memory controls, Audit log, Workflows, and MCP SDK discovery

## v0.2.0 (Planned)
- Bundled standalone Python sidecar runtime (PyInstaller / Nuitka) inside macOS `.dmg`, Windows MSI, and Linux AppImage installers so end users do not need Python or `uv` installed
- Apple Silicon (`aarch64-apple-darwin`), Windows 11, and Ubuntu 24.04 runtime verification and signed/notarized macOS releases
- Live streaming token output in the Assistant transcript for remote providers
- Extended MCP tool invocation directly inside LangGraph multi-step plans with per-call approval previews

## v0.3.0 (Planned)
- Optional local lightweight vector index for memory retrieval without requiring large downloads
- Native platform background scheduler service (macOS `launchd` user agent with explicit user opt-in)
- Expanded interactive Accessibility tree element inspection on macOS
