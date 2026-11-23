from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
    version: str
    uptime_sec: float
    database: dict[str, Any]


class AppSettingsPayload(BaseModel):
    theme: Literal["system", "light", "dark"] = "system"
    default_provider_id: str = "mock"
    default_model: str = "mock-deterministic-v1"
    memory_enabled: bool = True
    memory_retention_days: int = Field(default=90, ge=1, le=3650)
    terminal_enabled: bool = False
    terminal_allowlist: list[str] = Field(
        default_factory=lambda: ["ls", "pwd", "cat", "head", "tail", "wc", "git", "python3", "node"]
    )
    computer_use_enabled: bool = False
    computer_use_screen_capture: bool = False
    computer_use_approved_apps: list[str] = Field(
        default_factory=lambda: ["Finder", "TextEdit", "Calculator", "Notes", "Preview"]
    )
    max_duration_sec: int = Field(default=300, ge=10, le=3600)
    max_tool_calls: int = Field(default=25, ge=1, le=100)
    max_retries: int = Field(default=2, ge=0, le=5)
    max_tokens: int = Field(default=64000, ge=1000, le=500000)
    max_cost_usd: float = Field(default=1.0, ge=0.0, le=50.0)


class ProviderUpdateRequest(BaseModel):
    enabled: bool | None = None
    base_url: str | None = None
    default_model: str | None = None
    timeout_sec: int | None = Field(default=None, ge=5, le=300)
    max_retries: int | None = Field(default=None, ge=0, le=5)


class ProviderCredentialRequest(BaseModel):
    api_key: str = Field(min_length=4, max_length=512)


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    path: str = Field(min_length=1, max_length=1024)
    read_only: bool = False
    allow_delete: bool = False


class WorkspaceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    read_only: bool | None = None
    allow_delete: bool | None = None


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    path: str
    read_only: bool
    allow_delete: bool
    exists: bool
    created_at: str | None = None
