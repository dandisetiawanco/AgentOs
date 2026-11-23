from __future__ import annotations

import re
import threading
from typing import Any

REDACTED = "[REDACTED]"

# Patterns matching common provider API keys, bearer tokens, and private keys.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{16,}"),
    re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*['\"]?([^\s'\",;]{8,})['\"]?"),
    re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
        re.MULTILINE,
    ),
)

_SENSITIVE_KEY_NAMES = frozenset(
    {
        "api_key",
        "apikey",
        "authorization",
        "password",
        "passwd",
        "secret",
        "token",
        "session_token",
        "access_token",
        "refresh_token",
        "private_key",
        "credential",
        "credentials",
    }
)


class SecretRedactor:
    """Thread-safe registry that scrubs registered secrets and token patterns from outputs."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._registered: set[str] = set()

    def register(self, secret: str | None) -> None:
        if secret and len(secret.strip()) >= 8:
            with self._lock:
                self._registered.add(secret.strip())

    def unregister(self, secret: str | None) -> None:
        if secret:
            with self._lock:
                self._registered.discard(secret.strip())

    def clear(self) -> None:
        with self._lock:
            self._registered.clear()

    def redact_text(self, text: str) -> str:
        result = text
        with self._lock:
            registered_snapshot = sorted(self._registered, key=len, reverse=True)
        for secret in registered_snapshot:
            if secret in result:
                result = result.replace(secret, REDACTED)

        for pattern in _SECRET_PATTERNS:
            if pattern.groups == 1:
                result = pattern.sub(rf"\1{REDACTED}", result)
            elif pattern.groups >= 2:
                result = pattern.sub(rf"\1={REDACTED}", result)
            else:
                result = pattern.sub(REDACTED, result)
        return result

    def redact_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact_text(value)
        if isinstance(value, dict):
            cleaned: dict[Any, Any] = {}
            for key, item in value.items():
                key_lower = str(key).lower().replace("-", "_")
                if key_lower in _SENSITIVE_KEY_NAMES and item:
                    cleaned[key] = REDACTED
                else:
                    cleaned[key] = self.redact_value(item)
            return cleaned
        if isinstance(value, list):
            return [self.redact_value(item) for item in value]
        if isinstance(value, tuple):
            return tuple(self.redact_value(item) for item in value)
        return value


global_redactor = SecretRedactor()


def redact_text(text: str) -> str:
    return global_redactor.redact_text(text)


def redact_value(value: Any) -> Any:
    return global_redactor.redact_value(value)
