# Contributing to AgentOS

Thank you for contributing to AgentOS (NGOPREK DIGITAL).

## Development Requirements

- macOS 13+ (primary tested target: macOS 15.8.3 Intel `x86_64`)
- Node.js 22+ and `pnpm` 10+
- Python 3.12 (`uv` recommended)
- Rust stable toolchain (`rustc`, `cargo`, `rustfmt`, `clippy`)

## Setup

```bash
pnpm install
uv sync --directory backend --python 3.12
```

## Quality Gates

Before opening a pull request, verify all checks locally:

```bash
# Backend
cd backend
uv run ruff check agentos tests
uv run ruff format --check agentos tests
uv run mypy agentos
uv run pytest -c pyproject.toml tests ../tests/security -v

# Frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Rust bridge
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Pull Request Guidelines

- Keep pull requests focused on a single feature, defect, or security hardening item.
- Never commit API keys, `.env` files, personal files, or SQLite database files.
- Add unit or security tests covering any new tool or permission boundary.
- Update `CHANGELOG.md` and relevant documentation under `docs/`.

## License

Contributions are licensed under Apache License 2.0.
