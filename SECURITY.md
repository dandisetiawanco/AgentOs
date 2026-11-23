# Security Policy

## Scope and Philosophy

AgentOS is built around local-first execution and explicit human control. No software system is impossible to compromise, and autonomous desktop tools carry real operational risk if permissions are too broad. AgentOS enforces security boundaries deterministically in application code rather than relying solely on AI model instructions.

## Security Architecture Summary

1. **Default-Deny Permissions**: Filesystem, terminal, desktop computer use, and external MCP tools are denied by default until explicitly authorized.
2. **Canonical Path & Symlink Guards**: File and document tools canonicalize every path, block system directories (`/System`, `/etc`, `/usr`, `/Library`, `/`, home root), block credential paths (`~/.ssh`, `~/.aws`, `~/Library/Keychains`, `.env`, private keys), and reject symlinks pointing outside an authorized workspace.
3. **Execution-Boundary Prompt Injection Defense**: All external content (documents, webpages, terminal output, MCP outputs) is tagged as untrusted data (`untrusted_content: true`). Risk classification, allowlists, path validation, and approval checks execute deterministically after planning and again immediately before tool invocation.
4. **OS Keychain Secret Storage**: Provider API keys are stored via OS credential storage (macOS Keychain via `keyring`) and never written to SQLite, `localStorage`, plaintext logs, screenshots, or diagnostic exports. A centralized `SecretRedactor` scrubs registered secrets and common key formats.
5. **Authenticated Localhost Backend**: The Rust Tauri bridge binds the Python backend exclusively to `127.0.0.1` on an ephemeral loopback port with a 256-bit cryptographically random session token passed over `Authorization: Bearer` headers and strict CORS/CSP rules.
6. **Restricted Terminal Execution**: Disabled by default. When enabled, uses structured `exec` argument lists (`create_subprocess_exec`, zero shell interpolation), command allowlists, permanent blocklists (`sudo`, `rm`, `sh`, `curl`, etc.), working-directory bounds, output caps, timeouts, and sanitized environment variables.
7. **External MCP Limitations**: External MCP servers run code outside AgentOS's control. They are untrusted by default, never auto-installed, run with stripped environment variables, and require explicit per-tool allowlisting. Never register unverified third-party MCP servers.
8. **Emergency Stop**: Available directly in Overview and Settings to halt active tasks and block non-read-only tool execution immediately.

## Reporting a Vulnerability

Do not open public GitHub issues for unpatched security vulnerabilities.
Report security findings privately to the maintainer:

- Maintainer: Dandi Setiawan (NGOPREK DIGITAL)
- Contact: `dandisetiawan.co@gmail.com`

Include steps to reproduce, affected version, and impact assessment. You will receive an acknowledgement and remediation timeline as soon as possible.
