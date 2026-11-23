from __future__ import annotations

import ipaddress
import re
import socket
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.errors import PathSecurityError
from agentos.security.paths import resolve_authorized_path
from agentos.storage.models import PermissionGrant
from agentos.tools.base import BaseTool, RiskLevel, ToolContext

# Commands permanently forbidden even when terminal mode is enabled.
BLOCKED_EXECUTABLES = frozenset(
    {
        "sudo",
        "su",
        "doas",
        "rm",
        "rmdir",
        "dd",
        "mkfs",
        "diskutil",
        "fdisk",
        "shutdown",
        "reboot",
        "halt",
        "kill",
        "killall",
        "pkill",
        "launchctl",
        "chmod",
        "chown",
        "chflags",
        "sh",
        "bash",
        "zsh",
        "csh",
        "fish",
        "osascript",
        "security",
        "curl",
        "wget",
        "nc",
        "ncat",
        "ssh",
        "scp",
        "sftp",
        "eval",
    }
)

SHELL_METACHAR_PATTERN = re.compile(r"[;&|`$<>\\]|(\$\()|(\n|\r)")

SENSITIVE_APP_NAMES = frozenset(
    {
        "keychain access",
        "passwords",
        "1password",
        "bitwarden",
        "keepassxc",
        "lastpass",
        "dashlane",
        "system settings",
        "system preferences",
        "terminal",
        "iterm",
    }
)

# Prompt injection signature indicators logged when seen in untrusted inputs.
INJECTION_INDICATORS = (
    "ignore previous instructions",
    "ignore all prior instructions",
    "disregard system prompt",
    "override permission",
    "bypass security",
    "grant yourself",
    "execute rm -rf",
    "read /etc/passwd",
    "exfiltrate",
)


@dataclass
class PermissionDecision:
    allowed: bool
    risk_level: RiskLevel
    requires_approval: bool
    reason: str
    preview: dict[str, Any] = field(default_factory=dict)
    capabilities: list[str] = field(default_factory=list)


def detect_prompt_injection_signals(text: str) -> list[str]:
    lowered = text.lower()
    return [marker for marker in INJECTION_INDICATORS if marker in lowered]


def validate_public_url(url: str, *, allow_localhost_for_tests: bool = False) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise PathSecurityError(
            f"Unsupported URL scheme '{parsed.scheme}'. Only http and https are allowed."
        )
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise PathSecurityError("URL must include a valid hostname.")

    # Block cloud metadata and private/internal addresses unless explicitly allowed for local test fixtures.
    if hostname in {"169.254.169.254", "metadata.google.internal"}:
        raise PathSecurityError("Access to metadata endpoints is permanently blocked.")

    if not allow_localhost_for_tests and hostname in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}:
        raise PathSecurityError(
            "Access to localhost/loopback addresses is blocked by network policy."
        )

    try:
        ip = ipaddress.ip_address(hostname)
        if not allow_localhost_for_tests and (
            ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        ):
            raise PathSecurityError(f"Access to non-public IP '{hostname}' is blocked.")
    except ValueError:
        # Hostname is a domain name; check resolved IP only if it resolves cleanly offline.
        if not allow_localhost_for_tests:
            try:
                infos = socket.getaddrinfo(hostname, None)
                for info in infos:
                    addr = ipaddress.ip_address(info[4][0])
                    if addr.is_link_local or addr.is_multicast or addr.is_reserved:
                        raise PathSecurityError(
                            f"Hostname '{hostname}' resolved to blocked address."
                        )
            except socket.gaierror:
                pass

    return parsed.geturl()


class PermissionEngine:
    """Deterministic execution-boundary security and authorization engine."""

    def evaluate(
        self,
        tool: BaseTool,
        raw_args: dict[str, Any],
        ctx: ToolContext,
        *,
        allow_localhost_browser: bool = False,
    ) -> PermissionDecision:
        if ctx.emergency_stop_active and tool.risk_level != RiskLevel.READ_ONLY:
            return PermissionDecision(
                allowed=False,
                risk_level=RiskLevel.BLOCKED,
                requires_approval=False,
                reason="Emergency stop is active. Resume operations before executing actions.",
            )

        validated = tool.validate_args(raw_args)
        args_dict = validated.model_dump()
        preview = tool.preview(validated, ctx)
        risk = tool.risk_level

        # 1. File / Document path checks
        path_fields = (
            "path",
            "directory",
            "source_path",
            "destination_path",
            "output_path",
            "path_a",
            "path_b",
            "cwd",
        )
        for field_name in path_fields:
            raw_val = args_dict.get(field_name)
            if isinstance(raw_val, str) and raw_val.strip():
                try:
                    resolved = resolve_authorized_path(raw_val, ctx.authorized_workspaces)
                except PathSecurityError as exc:
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason=exc.user_message,
                        preview=preview,
                    )

                if (
                    tool.has_side_effects
                    and field_name in ("path", "destination_path", "output_path", "source_path")
                    and self._is_path_read_only(resolved, ctx)
                ):
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason=f"Workspace containing '{resolved}' is configured as read-only.",
                        preview=preview,
                    )

        # 2. Terminal policy enforcement
        if tool.id == "terminal.run":
            if not ctx.terminal_enabled:
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason="Terminal access is disabled by default. Enable restricted terminal access in Settings -> Security.",
                    preview=preview,
                )
            executable = str(args_dict.get("executable", "")).strip()
            exe_base = Path(executable).name
            if not executable or "/" in executable or "\\" in executable:
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason="Executable must be a bare allowlisted command name without path separators.",
                    preview=preview,
                )
            if exe_base in BLOCKED_EXECUTABLES:
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason=f"Command '{exe_base}' is permanently blocked by security policy.",
                    preview=preview,
                )
            if exe_base not in ctx.terminal_allowlist:
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason=f"Command '{exe_base}' is not in the configured terminal allowlist.",
                    preview=preview,
                )
            cmd_args = args_dict.get("args") or []
            for arg in cmd_args:
                arg_str = str(arg)
                if SHELL_METACHAR_PATTERN.search(arg_str):
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason=f"Blocked shell metacharacters detected in argument '{arg_str}'.",
                        preview=preview,
                    )
                if ".." in arg_str or arg_str.startswith(
                    ("/etc", "/System", "/usr", "/Library", "~/.ssh")
                ):
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason=f"Blocked sensitive or traversal path argument '{arg_str}'.",
                        preview=preview,
                    )
            return PermissionDecision(
                allowed=True,
                risk_level=RiskLevel.HIGH,
                requires_approval=True,
                reason=f"Allowlisted terminal command '{exe_base}' requires explicit user approval.",
                preview=preview,
                capabilities=list(tool.required_permissions),
            )

        # 3. Browser URL & form submission checks
        if tool.category == "browser":
            raw_url = args_dict.get("url")
            if isinstance(raw_url, str):
                try:
                    validate_public_url(raw_url, allow_localhost_for_tests=allow_localhost_browser)
                except PathSecurityError as exc:
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason=exc.user_message,
                        preview=preview,
                    )
            if tool.id == "browser.fill_form" and args_dict.get("submit", False):
                return PermissionDecision(
                    allowed=True,
                    risk_level=RiskLevel.HIGH,
                    requires_approval=True,
                    reason="Submitting a web form transmits external data and requires explicit confirmation.",
                    preview=preview,
                    capabilities=list(tool.required_permissions),
                )

        # 4. Computer use / app launch checks
        if tool.category == "computer_use" or tool.id == "system.open_app":
            app_name = str(args_dict.get("app_name", "")).strip()
            if app_name and app_name.lower() in SENSITIVE_APP_NAMES:
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason=f"Sensitive application '{app_name}' cannot be automated or captured.",
                    preview=preview,
                )
            if (
                tool.id in ("system.open_app", "computer.open_app")
                and app_name not in ctx.computer_use_approved_apps
            ):
                return PermissionDecision(
                    allowed=False,
                    risk_level=RiskLevel.BLOCKED,
                    requires_approval=False,
                    reason=f"Application '{app_name}' is not in the approved applications list.",
                    preview=preview,
                )
            if tool.category == "computer_use":
                if not ctx.computer_use_enabled:
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason="Desktop computer use is disabled by default. Authorize it in Settings -> Security.",
                        preview=preview,
                    )
                if tool.id == "computer.screenshot" and not ctx.computer_use_screen_capture:
                    return PermissionDecision(
                        allowed=False,
                        risk_level=RiskLevel.BLOCKED,
                        requires_approval=False,
                        reason="Screen capture requires separate authorization in Settings -> Security.",
                        preview=preview,
                    )

        # 5. General risk -> approval gate
        requires_approval = risk in (RiskLevel.MEDIUM, RiskLevel.HIGH) or tool.has_side_effects
        reason = (
            f"Operation '{tool.name}' ({risk.value}) requires explicit user approval before execution."
            if requires_approval
            else f"Read-only / low-risk operation '{tool.name}' authorized within scope."
        )
        return PermissionDecision(
            allowed=True,
            risk_level=risk,
            requires_approval=requires_approval,
            reason=reason,
            preview=preview,
            capabilities=list(tool.required_permissions),
        )

    @staticmethod
    def _is_path_read_only(resolved: Path, ctx: ToolContext) -> bool:
        for root_str, policy in ctx.workspace_policies.items():
            root = Path(root_str).resolve(strict=False)
            try:
                resolved.relative_to(root)
                return bool(policy.get("read_only", False))
            except ValueError:
                continue
        return True

    async def grant_task_permission(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        capability: str,
        scope: str,
        risk_level: RiskLevel,
        ttl_minutes: int = 15,
    ) -> PermissionGrant:
        grant = PermissionGrant(
            id=f"prm_{uuid.uuid4().hex[:12]}",
            task_id=task_id,
            capability=capability,
            scope=scope,
            risk_level=risk_level.value,
            granted_by="user",
            expires_at=datetime.now(UTC) + timedelta(minutes=max(1, min(ttl_minutes, 120))),
            revoked=False,
        )
        session.add(grant)
        await session.flush()
        return grant

    async def has_valid_grant(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        capability: str,
    ) -> bool:
        now = datetime.now(UTC)
        rows = (
            (
                await session.execute(
                    select(PermissionGrant).where(
                        PermissionGrant.task_id == task_id,
                        PermissionGrant.capability == capability,
                        PermissionGrant.revoked.is_(False),
                    )
                )
            )
            .scalars()
            .all()
        )
        for grant in rows:
            if grant.expires_at is None:
                return True
            exp = grant.expires_at
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=UTC)
            if exp > now:
                return True
        return False
