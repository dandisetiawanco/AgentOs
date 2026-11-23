# AgentOS Threat Model

## Primary Assets Protected
- User filesystem outside explicitly authorized workspaces
- API credentials stored in OS Keychain and ephemeral localhost session tokens
- Host OS stability and system directories (`/System`, `/etc`, `/usr`, `/Library`, `~/.ssh`, browser profiles)
- Sensitive applications (Keychain Access, Passwords, password managers)

## Threat Vectors and Mitigations

| Threat | Mitigation Implemented in Code |
| --- | --- |
| Directory traversal (`../`) & symlink escape | `resolve_authorized_path` canonicalizes paths, checks `relative_to(authorized_root)`, and rejects symlinks escaping workspace bounds. |
| Prompt injection via untrusted files or webpages | External tool outputs are wrapped with `untrusted_content: true`; `PermissionEngine` re-evaluates every tool call deterministically immediately before invocation. |
| Unauthorized localhost API access | Backend binds only to `127.0.0.1`; constant-time `hmac.compare_digest` Bearer verification on all non-health endpoints; strict CORS allowlist. |
| Command injection in terminal tool | Terminal tool disabled by default; uses `create_subprocess_exec` (no shell), allowlist + permanent blocklist, shell metacharacter regex rejection, cwd validation, and stripped env vars. |
| SSRF via browser tools | `validate_public_url` restricts schemes to `http`/`https` and blocks loopback, private RFC1918, link-local, and cloud metadata IPs (`169.254.169.254`). |
| Secret leakage in logs, DB, or exports | API keys live exclusively in `CredentialStore` (OS Keychain); `SecretRedactor` scrubs logs, error messages, audit events, diagnostics, and blocks secret storage in SQLite memory. |
| External MCP server compromise | External MCP servers are untrusted by default, run with minimal stripped env, and require explicit per-tool allowlisting before exposure. |
| Runaway agent loops or runaway API spend | Every task enforces `max_duration_sec`, `max_tool_calls`, `max_retries`, `max_tokens`, `max_cost_usd`, and idempotency guards against duplicate side effects. |
