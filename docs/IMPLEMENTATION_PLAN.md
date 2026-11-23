# AgentOS Implementation Plan

Project: AgentOS (Intelligence that takes action)
Organization: NGOPREK DIGITAL
Author: Dandi Setiawan
Target Primary Machine: MacBook Pro 2019 (Intel Core i5-8279U, x86_64, 8 GB RAM, macOS 15.8.3)

## Phase 0: Environment Audit and Repository Setup
- Audit OS, CPU architecture, RAM, disk space, Xcode, Node.js, pnpm, Python, uv, SQLite, Playwright cache, Git, and Rust availability.
- Install Rust stable toolchain via `rustup` locally into `~/.cargo` and `~/.rustup` (user-authorized).
- Initialize isolated Git repository at the workspace root (`AgentOs/`).
- Establish monorepo layout, `.gitignore`, `.env.example`, Apache 2.0 `LICENSE`, architecture decisions, implementation plan, build state, and validation report.

## Phase 1: Application Foundation
- Scaffold pnpm workspace (`apps/desktop`, `packages/shared`, `packages/ui`) with Vite, React 19, TypeScript strict mode, Tailwind CSS v4, accessible UI primitives, and Lucide icons.
- Scaffold Tauri 2 Rust desktop bridge (`apps/desktop/src-tauri`) with strict CSP, capability restrictions, single-instance backend lifecycle manager, localhost port allocation, ephemeral bearer token handshake, health probe, and graceful shutdown.
- Scaffold Python 3.12 backend (`backend/agentos`) using `uv`, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic explicit migrations, and SQLite (WAL mode + foreign keys + indexes).
- Implement OS credential storage (`keyring` with macOS Keychain backend and redacted API handling).
- Implement typed API contract generation/export (`packages/shared` schemas matched against backend OpenAPI schema).
- Implement provider abstraction layer (Google Gemini, OpenAI, Anthropic, Ollama local, OpenAI-compatible custom endpoint, plus explicitly labeled deterministic Mock provider for tests and offline demos).
- Verify backend start/stop, frontend build, Rust check, and Tauri desktop launch.

## Phase 2: Agent Core
- Implement typed task state machine (`created`, `planning`, `awaiting_approval`, `approved`, `running`, `paused`, `verifying`, `completed`, `failed`, `cancelled`) persisted in SQLite.
- Implement execution budgets (max duration, max tool calls, max retries, max tokens, optional spending limit) and anti-loop / duplicate side-effect guards.
- Implement strongly typed `ToolRegistry` with input/output schemas, permissions, risk levels, timeouts, side-effect metadata, verification procedures, rollback metadata, and platform compatibility.
- Implement `PermissionEngine` (`READ_ONLY`, `LOW`, `MEDIUM`, `HIGH`, `BLOCKED`), default-deny directory controls, canonical path resolution, symlink escape prevention, capability-based per-task and time-limited grants, operation previews, network restrictions, secrets redaction, and prompt-injection execution-boundary enforcement.
- Implement `IntentAnalyzer`, `ContextManager`, `TaskPlanner`, `ExecutionEngine`, `StateManager`, `RecoveryManager`, `VerificationEngine`, `MemoryManager`, and `AuditLogger`, orchestrated with LangGraph where compatible (or deterministic typed graph runner documented in ADR).

## Phase 3: Functional Tools
- File Intelligence: list authorized directories, search files, read text/docs, inspect metadata, detect duplicates by SHA-256 hash, suggest folder organization, preview changes, rename/move/copy/create folders with approval, and restore supported operations from rollback journal.
- Document Intelligence: read PDF, DOCX, TXT, Markdown, CSV, XLSX; summarize/extract/compare; generate Markdown, PDF, DOCX, CSV, and XLSX with automatic reopen validation.
- Browser Intelligence: Playwright isolated persistent/ephemeral browser contexts, open/navigate/extract/inspect/summarize/screenshot/export, explicit confirmation before form submission or transmitting information, no CAPTCHA or auth bypass.
- System Intelligence: read-only OS info, CPU/memory/disk health, authorized running processes, large file discovery in authorized workspaces, open explicitly approved applications.
- Terminal Intelligence: disabled by default; structured executable + arg list (no shell interpolation), command allowlist, working directory bounds, timeouts, output caps, sanitized environment, explicit approval, full audit logging.

## Phase 4: Complete User Experience
- Build desktop-native UI across all 8 views: Overview, Assistant, Tasks, Workflows, Tools, Memory, Activity, Settings.
- Support Light, Dark, and System themes, keyboard navigation, accessible contrast (WCAG AA checked), reduced-motion preferences, and responsive desktop/narrow layouts.
- Implement Assistant workspace with natural-language input, provider/model selector, workspace selector, conversation history, file attachments, structured execution plan preview, inline permission approval dialog, live SSE task progress, emergency stop/cancel button, verified results viewer, and exportable execution report.
- Implement Task inspector, Workflow management, Tool catalog, Memory controls (CRUD, search, export, retention, disable toggle), Activity audit log timeline, and Settings (providers, Keychain credentials, local models, workspaces, memory, security, theme, diagnostics, about).
- Verify zero dead controls and real empty/loading/error states on every view.

## Phase 5: Optional Advanced Capabilities
- Implement optional MCP integration using the official Python `mcp` SDK: user-configured servers, connection testing, tool discovery, schema inspection, default-untrusted authorization, cancellation, status, and error reporting.
- Implement macOS-first Computer Use adapter with capability detection (Accessibility / Screen Recording checks), open approved apps, window inspection, authorized screenshot capture (excluding password/sensitive apps, no continuous recording by default), emergency stop control, and clear unavailability states on untested platforms.
- Implement reusable Workflows with built-in templates, manual execution, in-app scheduler (clearly documented as active only while AgentOS is running), history, pause/cancel, permission review, retry policies, and output destinations.

## Phase 6: Hardening
- Run unit tests (pytest, vitest, cargo test), integration tests, security tests (traversal, symlink escape, prompt injection, command injection, secret leakage, auth bypass, malformed docs), and Playwright E2E tests against temporary fixtures.
- Build and run the AI quality evaluation suite (`benchmarks/`) covering all 8 required scenarios plus actual performance benchmarks on this Intel Mac.
- Inspect real runtime behavior, fix all verified defects, and re-run affected checks.

## Phase 7: Release Preparation
- Finalize all documentation (README with Mermaid architecture diagram and real screenshots, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG, ROADMAP, THIRD_PARTY_NOTICES, docs/*).
- Configure GitHub Actions CI/CD workflows (lint, typecheck, tests, security/secret scans, cross-platform build matrix).
- Run clean production builds (`pnpm build`, `tauri build`) and record exact build artifacts and validation results.
