## Summary
Describe what changed and why.

## Security & Permission Impact
- [ ] No new default-allow filesystem, network, or terminal capabilities introduced.
- [ ] All mutating or external operations enforce explicit user approval and audit logging.
- [ ] No API keys, tokens, or personal data included in commits or logs.

## Verification Checklist
- [ ] Backend `ruff check`, `mypy`, `pytest` pass
- [ ] Frontend `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass
- [ ] Rust `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` pass
