from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from agentos.errors import OperationTimeoutError, ValidationFailedError


class RiskLevel(StrEnum):
    READ_ONLY = "READ_ONLY"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    BLOCKED = "BLOCKED"


@dataclass
class ToolContext:
    task_id: str
    step_id: str
    authorized_workspaces: list[Path]
    workspace_policies: dict[str, dict[str, bool]]  # canonical_path -> {read_only, allow_delete}
    data_dir: Path
    rollback_dir: Path
    browser_profiles_dir: Path
    exports_dir: Path
    max_file_size_bytes: int
    max_screenshot_width: int
    terminal_enabled: bool
    terminal_allowlist: list[str]
    computer_use_enabled: bool
    computer_use_screen_capture: bool
    computer_use_approved_apps: list[str]
    emergency_stop_active: bool = False
    cancel_event: asyncio.Event | None = None
    approved_step: bool = False


@dataclass
class ToolExecutionOutput:
    ok: bool
    summary: str
    data: dict[str, Any] = field(default_factory=dict)
    untrusted_content: bool = False
    rollback_record: dict[str, Any] | None = None
    artifacts: list[str] = field(default_factory=list)


@dataclass
class VerificationOutcome:
    verified: bool
    method: str
    summary: str
    details: dict[str, Any] = field(default_factory=dict)


class BaseTool(ABC):
    id: str
    name: str
    category: str
    description: str
    input_model: type[BaseModel]
    output_schema: dict[str, Any] = {"type": "object"}
    required_permissions: tuple[str, ...] = ()
    risk_level: RiskLevel = RiskLevel.READ_ONLY
    timeout_sec: int = 30
    has_side_effects: bool = False
    supports_rollback: bool = False
    verification_procedure: str = "Verify structured tool output and target state."
    platforms: tuple[str, ...] = ("darwin", "linux", "windows")

    def validate_args(self, raw_args: dict[str, Any]) -> BaseModel:
        try:
            return self.input_model.model_validate(raw_args)
        except ValidationError as exc:
            raise ValidationFailedError(
                f"Invalid arguments for tool '{self.id}': {exc.errors()[0]['msg']}",
                details={"tool_id": self.id, "errors": exc.errors()},
            ) from exc

    def preview(self, args: BaseModel, ctx: ToolContext) -> dict[str, Any]:
        return {
            "tool_id": self.id,
            "action": self.name,
            "risk_level": self.risk_level.value,
            "has_side_effects": self.has_side_effects,
            "supports_rollback": self.supports_rollback,
            "arguments": args.model_dump(),
        }

    @abstractmethod
    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput: ...

    async def verify(
        self,
        args: BaseModel,
        output: ToolExecutionOutput,
        ctx: ToolContext,
    ) -> VerificationOutcome:
        return VerificationOutcome(
            verified=output.ok,
            method=self.verification_procedure,
            summary="Verified tool returned a successful structured result."
            if output.ok
            else "Tool execution did not succeed.",
        )

    async def run_with_timeout(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        try:
            return await asyncio.wait_for(self.execute(args, ctx), timeout=float(self.timeout_sec))
        except TimeoutError as exc:
            raise OperationTimeoutError(
                f"Tool '{self.id}' timed out after {self.timeout_sec}s.",
                details={"tool_id": self.id, "timeout_sec": self.timeout_sec},
            ) from exc

    def to_metadata(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "input_schema": self.input_model.model_json_schema(),
            "output_schema": self.output_schema,
            "required_permissions": list(self.required_permissions),
            "risk_level": self.risk_level.value,
            "timeout_sec": self.timeout_sec,
            "has_side_effects": self.has_side_effects,
            "supports_rollback": self.supports_rollback,
            "verification_procedure": self.verification_procedure,
            "platforms": list(self.platforms),
        }
