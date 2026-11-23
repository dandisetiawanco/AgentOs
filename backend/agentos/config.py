from __future__ import annotations

import secrets
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def default_data_dir() -> Path:
    home = Path.home()
    mac_support = home / "Library" / "Application Support"
    if mac_support.exists():
        return mac_support / "AgentOS"
    return home / ".agentos"


class AgentOSSettings(BaseSettings):
    """Runtime configuration for the local AgentOS backend."""

    model_config = SettingsConfigDict(
        env_prefix="AGENTOS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = Field(default="127.0.0.1")
    port: int = Field(default=47821, ge=1024, le=65535)
    allow_non_loopback: bool = Field(default=False)
    session_token: str = Field(default_factory=lambda: secrets.token_hex(32))
    data_dir: Path = Field(default_factory=default_data_dir)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    allow_mock_provider: bool = True
    ollama_base_url: str = "http://127.0.0.1:11434"
    openai_compat_base_url: str = ""

    # Resource caps tuned for 8 GB Intel macOS hardware.
    max_file_size_mb: int = Field(default=25, ge=1, le=250)
    max_screenshot_width: int = Field(default=1600, ge=640, le=3840)
    cache_limit_mb: int = Field(default=100, ge=10, le=1000)
    max_concurrent_tools: int = Field(default=2, ge=1, le=8)

    # Default per-task execution budgets.
    default_max_duration_sec: int = Field(default=300, ge=10, le=3600)
    default_max_tool_calls: int = Field(default=25, ge=1, le=100)
    default_max_retries: int = Field(default=2, ge=0, le=5)
    default_max_tokens: int = Field(default=64000, ge=1000, le=500000)
    default_max_cost_usd: float = Field(default=1.0, ge=0.0, le=50.0)

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
        ]
    )

    @field_validator("host")
    @classmethod
    def validate_loopback_host(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Host must not be empty.")
        return stripped

    def ensure_loopback_policy(self) -> None:
        loopback_hosts = {"127.0.0.1", "localhost", "::1"}
        if self.host not in loopback_hosts and not self.allow_non_loopback:
            raise ValueError(
                f"Refusing to bind non-loopback host '{self.host}' without "
                "AGENTOS_ALLOW_NON_LOOPBACK=true."
            )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "agentos.db"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.db_path}"

    @property
    def sync_database_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    @property
    def browser_profiles_dir(self) -> Path:
        return self.data_dir / "browser_profiles"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def rollback_dir(self) -> Path:
        return self.data_dir / "rollback"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    def ensure_directories(self) -> None:
        for directory in (
            self.data_dir,
            self.browser_profiles_dir,
            self.exports_dir,
            self.rollback_dir,
            self.logs_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)
