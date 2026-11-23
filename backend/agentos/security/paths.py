from __future__ import annotations

import os
from pathlib import Path

from agentos.errors import PathSecurityError

# Sensitive system and credential directories that must never be authorized as workspaces.
FORBIDDEN_PREFIXES: tuple[str, ...] = (
    "/System",
    "/etc",
    "/private/etc",
    "/private/var/db",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/var/root",
    "/dev",
    "/proc",
    "/sys",
    "/Windows",
    "C:\\Windows",
)

FORBIDDEN_HOME_RELATIVE: tuple[str, ...] = (
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".config/gcloud",
    ".npmrc",
    ".pypirc",
    "Library/Keychains",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Firefox",
    "Library/Cookies",
    "Library/Mail",
    "Library/Messages",
)


def canonicalize_path(raw_path: str) -> Path:
    if not raw_path or "\x00" in raw_path:
        raise PathSecurityError("Path contains invalid characters.")
    expanded = os.path.expanduser(raw_path.strip())
    try:
        resolved = Path(expanded).resolve(strict=False)
    except OSError as exc:
        raise PathSecurityError(f"Could not resolve path '{raw_path}': {exc}") from exc
    return resolved


def is_forbidden_system_path(path: Path) -> str | None:
    resolved = path.resolve(strict=False)
    resolved_str = str(resolved)

    if resolved == Path("/"):
        return "Root filesystem '/' cannot be accessed."

    home = Path.home().resolve(strict=False)
    if resolved == home:
        return "Entire home directory cannot be authorized; select a specific project or documents subfolder."

    for prefix in FORBIDDEN_PREFIXES:
        prefix_path = Path(prefix).resolve(strict=False)
        if resolved == prefix_path or prefix_path in resolved.parents:
            return f"System directory '{prefix}' is permanently blocked."

    for rel in FORBIDDEN_HOME_RELATIVE:
        blocked = (home / rel).resolve(strict=False)
        if resolved == blocked or blocked in resolved.parents:
            return f"Sensitive credential or browser path '~/{rel}' is permanently blocked."

    # Block common credential filenames anywhere
    name_lower = resolved.name.lower()
    if name_lower in {".env", ".env.local", "id_rsa", "id_ed25519", "known_hosts", "keychain.db"}:
        return f"Credential file '{resolved.name}' is blocked by security policy."
    if (
        name_lower.endswith((".pem", ".p12", ".pfx", ".key", ".kdbx"))
        and "test" not in resolved_str.lower()
    ):
        return f"Private key or vault file '{resolved.name}' is blocked by security policy."

    return None


def validate_workspace_root(raw_path: str) -> Path:
    resolved = canonicalize_path(raw_path)
    if not resolved.exists():
        raise PathSecurityError(f"Directory '{resolved}' does not exist.")
    if not resolved.is_dir():
        raise PathSecurityError(f"Path '{resolved}' is not a directory.")
    if Path(os.path.expanduser(raw_path)).is_symlink():
        # Follow canonical target, then still enforce forbidden check
        pass
    reason = is_forbidden_system_path(resolved)
    if reason:
        raise PathSecurityError(reason)
    return resolved


def resolve_authorized_path(
    raw_path: str,
    authorized_roots: list[Path],
    *,
    must_exist: bool = False,
) -> Path:
    """Resolves a path canonically and blocks directory traversal or symlink escapes."""
    if not authorized_roots:
        raise PathSecurityError(
            "No authorized workspaces are configured. Authorize a directory in Settings -> Workspaces."
        )
    candidate = canonicalize_path(raw_path)

    # Also verify no intermediate symlink escapes the authorized root.
    reason = is_forbidden_system_path(candidate)
    if reason:
        raise PathSecurityError(reason)

    matched_root: Path | None = None
    for root in authorized_roots:
        canonical_root = root.resolve(strict=False)
        try:
            candidate.relative_to(canonical_root)
            matched_root = canonical_root
            break
        except ValueError:
            continue

    if matched_root is None:
        raise PathSecurityError(
            f"Access denied: '{candidate}' is outside all authorized workspace directories."
        )

    if must_exist and not candidate.exists():
        raise PathSecurityError(f"Target path '{candidate}' does not exist.")

    # Verify symlink target cannot escape if path itself is a symlink
    raw_expanded = Path(os.path.expanduser(raw_path.strip()))
    if raw_expanded.is_symlink():
        real_target = raw_expanded.resolve(strict=False)
        try:
            real_target.relative_to(matched_root)
        except ValueError as exc:
            raise PathSecurityError(
                f"Symlink escape blocked: '{raw_path}' points outside workspace '{matched_root}'."
            ) from exc

    return candidate
