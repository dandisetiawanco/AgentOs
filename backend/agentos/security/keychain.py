from __future__ import annotations

import contextlib
import logging
from dataclasses import dataclass

import keyring
from keyring.errors import KeyringError, NoKeyringError

from agentos.security.redactor import global_redactor

logger = logging.getLogger(__name__)

KEYCHAIN_SERVICE = "id.ngoprekdigital.agentos"


@dataclass(frozen=True)
class KeychainStatus:
    backend_name: str
    persistent: bool
    warning: str | None = None


class CredentialStore:
    """Stores provider API keys in OS credential storage (macOS Keychain) with zero disk fallback."""

    def __init__(self, service_name: str = KEYCHAIN_SERVICE, *, force_memory: bool = False) -> None:
        self._service_name = service_name
        self._memory_fallback: dict[str, str] = {}
        self._use_memory = force_memory
        self._status = self._detect_backend(force_memory=force_memory)

    def _detect_backend(self, *, force_memory: bool) -> KeychainStatus:
        if force_memory:
            return KeychainStatus(
                backend_name="ephemeral_memory",
                persistent=False,
                warning="Using ephemeral in-memory secret vault (test mode).",
            )
        try:
            backend = keyring.get_keyring()
            backend_name = f"{backend.__class__.__module__}.{backend.__class__.__name__}"
            if "fail" in backend_name.lower() or "null" in backend_name.lower():
                self._use_memory = True
                return KeychainStatus(
                    backend_name="ephemeral_memory",
                    persistent=False,
                    warning="OS Keychain unavailable; secrets are kept in memory for this session only.",
                )
            return KeychainStatus(backend_name=backend_name, persistent=True)
        except Exception as exc:  # noqa: BLE001
            self._use_memory = True
            logger.warning("Keychain detection fell back to ephemeral memory: %s", exc)
            return KeychainStatus(
                backend_name="ephemeral_memory",
                persistent=False,
                warning="OS Keychain unavailable; secrets are kept in memory for this session only.",
            )

    @property
    def status(self) -> KeychainStatus:
        return self._status

    def set_secret(self, key_name: str, secret_value: str) -> None:
        cleaned = secret_value.strip()
        if not cleaned:
            raise ValueError("Secret value must not be empty.")
        global_redactor.register(cleaned)
        if self._use_memory:
            self._memory_fallback[key_name] = cleaned
            return
        try:
            keyring.set_password(self._service_name, key_name, cleaned)
        except (KeyringError, NoKeyringError) as exc:
            logger.warning("Keychain write failed (%s); switching to ephemeral memory.", exc)
            self._use_memory = True
            self._status = KeychainStatus(
                backend_name="ephemeral_memory",
                persistent=False,
                warning="OS Keychain write failed; secrets are stored in memory for this session only.",
            )
            self._memory_fallback[key_name] = cleaned

    def get_secret(self, key_name: str) -> str | None:
        if self._use_memory:
            value = self._memory_fallback.get(key_name)
        else:
            try:
                value = keyring.get_password(self._service_name, key_name)
            except (KeyringError, NoKeyringError):
                value = self._memory_fallback.get(key_name)
        if value:
            global_redactor.register(value)
        return value

    def delete_secret(self, key_name: str) -> None:
        existing = self.get_secret(key_name)
        if existing:
            global_redactor.unregister(existing)
        self._memory_fallback.pop(key_name, None)
        if not self._use_memory:
            with contextlib.suppress(KeyringError, NoKeyringError):
                keyring.delete_password(self._service_name, key_name)

    def has_secret(self, key_name: str) -> bool:
        return bool(self.get_secret(key_name))

    def masked_hint(self, key_name: str) -> str | None:
        value = self.get_secret(key_name)
        if not value:
            return None
        if len(value) <= 6:
            return "••••"
        return f"••••{value[-4:]}"
