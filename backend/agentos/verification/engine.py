from __future__ import annotations

from typing import Any

from agentos.storage.models import TaskStep
from agentos.tools.base import BaseTool, ToolContext, ToolExecutionOutput, VerificationOutcome


class VerificationEngine:
    """Deterministically verifies tool execution outcomes before any task may be marked completed."""

    async def verify_step(
        self,
        tool: BaseTool,
        validated_args: Any,
        output: ToolExecutionOutput,
        ctx: ToolContext,
    ) -> VerificationOutcome:
        if not output.ok:
            return VerificationOutcome(
                verified=False,
                method=tool.verification_procedure,
                summary=f"Step failed before verification: {output.summary}",
            )
        return await tool.verify(validated_args, output, ctx)

    @staticmethod
    def evaluate_task_completion(steps: list[TaskStep]) -> dict[str, Any]:
        if not steps:
            return {
                "verified": False,
                "reason": "No executable steps were produced or verified.",
                "checked_steps": 0,
                "verified_steps": 0,
            }

        checked = 0
        verified_count = 0
        unverified_titles: list[str] = []

        for step in steps:
            if step.status == "skipped":
                continue
            checked += 1
            ver = step.verification_json or {}
            if step.status == "completed" and bool(ver.get("verified")):
                verified_count += 1
            else:
                unverified_titles.append(step.title)

        all_verified = checked > 0 and verified_count == checked
        return {
            "verified": all_verified,
            "checked_steps": checked,
            "verified_steps": verified_count,
            "unverified_steps": unverified_titles,
            "reason": (
                f"All {verified_count} executed steps passed deterministic verification."
                if all_verified
                else f"Verification incomplete: {len(unverified_titles)} step(s) unverified or failed."
            ),
        }
