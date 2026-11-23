from __future__ import annotations

import asyncio
import os
import shutil

from pydantic import BaseModel, Field

from agentos.errors import OperationTimeoutError, ToolExecutionError
from agentos.security.paths import resolve_authorized_path
from agentos.security.redactor import redact_text
from agentos.tools.base import BaseTool, RiskLevel, ToolContext, ToolExecutionOutput

SAFE_ENV_KEYS = frozenset({"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "USER"})
MAX_OUTPUT_BYTES = 65536


class TerminalRunInput(BaseModel):
    executable: str = Field(min_length=1, max_length=64)
    args: list[str] = Field(default_factory=list, max_length=20)
    cwd: str
    timeout_sec: int = Field(default=15, ge=1, le=60)


class TerminalRunTool(BaseTool):
    id = "terminal.run"
    name = "Run Restricted Allowlisted Command"
    category = "terminal"
    description = (
        "Execute an explicitly allowlisted command with structured arguments inside an authorized workspace. "
        "Disabled by default; no shell interpolation or privilege escalation."
    )
    input_model = TerminalRunInput
    required_permissions = ("terminal.exec",)
    risk_level = RiskLevel.HIGH
    timeout_sec = 60
    has_side_effects = True
    verification_procedure = (
        "Confirm structured subprocess terminated cleanly and captured bounded output."
    )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, TerminalRunInput)
        cwd_path = resolve_authorized_path(args.cwd, ctx.authorized_workspaces, must_exist=True)
        resolved_exe = await asyncio.to_thread(shutil.which, args.executable)
        if not resolved_exe:
            raise ToolExecutionError(
                f"Allowlisted command '{args.executable}' is not installed on PATH."
            )

        # Strip all sensitive credentials and custom tokens from child environment.
        sanitized_env = {k: v for k, v in os.environ.items() if k in SAFE_ENV_KEYS}

        proc = await asyncio.create_subprocess_exec(
            resolved_exe,
            *args.args,
            cwd=str(cwd_path),
            env=sanitized_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            raw_out, raw_err = await asyncio.wait_for(
                proc.communicate(),
                timeout=float(min(args.timeout_sec, self.timeout_sec)),
            )
        except TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise OperationTimeoutError(
                f"Command '{args.executable}' exceeded timeout ({args.timeout_sec}s)."
            ) from exc

        stdout_text = redact_text(raw_out[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace"))
        stderr_text = redact_text(raw_err[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace"))
        truncated = len(raw_out) > MAX_OUTPUT_BYTES or len(raw_err) > MAX_OUTPUT_BYTES

        return ToolExecutionOutput(
            ok=proc.returncode == 0,
            summary=f"Executed '{args.executable}' in {cwd_path.name} (exit code {proc.returncode}).",
            untrusted_content=True,
            data={
                "executable": args.executable,
                "args": args.args,
                "cwd": str(cwd_path),
                "returncode": proc.returncode,
                "stdout": stdout_text,
                "stderr": stderr_text,
                "truncated": truncated,
            },
        )
