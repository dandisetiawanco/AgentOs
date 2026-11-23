# Changelog

All notable changes to AgentOS are documented in this file.

## [0.1.0] - 2026-11-23

### Added
- Tauri 2 + Rust desktop shell (`apps/desktop/src-tauri`) with loopback port allocation, 256-bit CSPRNG session token authentication, strict CSP, least-privilege capabilities, and graceful SIGTERM backend shutdown.
- FastAPI + SQLite (WAL mode) + Alembic migration backend (`backend/agentos`) with OS Keychain credential storage (`keyring`) and centralized secret redaction.
- Provider-independent AI abstraction supporting Google Gemini API, OpenAI API, Anthropic API, Ollama local models, OpenAI-compatible endpoints, and an explicitly labeled Offline Deterministic Test Mode.
- LangGraph-backed agent orchestration (`IntentAnalyzer`, `ContextManager`, `TaskPlanner`, `PermissionEngine`, `StateManager`, `RecoveryManager`, `VerificationEngine`, `MemoryManager`, `AuditLogger`) with 10 typed task states and execution budgets.
- 24 strongly typed built-in tools across File Intelligence, Document Intelligence (PDF/DOCX/TXT/MD/CSV/XLSX read + reopen-verified generation), Browser Intelligence (isolated Playwright contexts), System Intelligence, Restricted Terminal (disabled by default), and macOS Computer Use capability inspection.
- Complete 8-view desktop UI (Overview, Assistant, Tasks, Workflows, Tools, Memory, Activity, Settings) supporting Light, Dark, and System themes, keyboard navigation, and WCAG AA contrast.
- Optional MCP integration via the official Python `mcp` SDK with default-untrusted explicit tool authorization.
- Reusable workflow templates with manual execution and in-app scheduling (active while AgentOS is open).
- Automated unit, integration, security, Playwright E2E, AI evaluation, and Intel macOS performance benchmark suites.
