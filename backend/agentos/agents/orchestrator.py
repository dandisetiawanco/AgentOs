from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.agents.context import ContextManager
from agentos.agents.intent import IntentAnalyzer
from agentos.agents.planner import TaskPlanner
from agentos.agents.recovery import RecoveryManager
from agentos.api.schemas import AppSettingsPayload
from agentos.config import AgentOSSettings
from agentos.errors import (
    AgentOSError,
    BudgetExceededError,
    PermissionDeniedError,
    TaskCancelledError,
)
from agentos.execution.state_manager import StateManager, TaskState
from agentos.memory.manager import MemoryManager
from agentos.observability.audit import AuditLogger
from agentos.permissions.engine import PermissionEngine
from agentos.providers.base import TokenUsage
from agentos.providers.manager import ProviderManager
from agentos.security.redactor import redact_value
from agentos.storage.database import DatabaseManager
from agentos.storage.models import Task, TaskStep, Workspace
from agentos.tools.base import RiskLevel, ToolContext
from agentos.tools.registry import ToolRegistry
from agentos.verification.engine import VerificationEngine


class PlanningGraphState(TypedDict, total=False):
    task_id: str
    instruction: str
    provider_id: str
    model: str
    workspace_id: str | None
    intent: dict[str, Any]
    context: dict[str, Any]
    plan: dict[str, Any]
    usage: dict[str, Any]
    needs_approval: bool
    blocked_reason: str | None


class AgentOrchestrator:
    """LangGraph-backed agent orchestrator enforcing permissions, budgets, and verification."""

    def __init__(
        self,
        *,
        db: DatabaseManager,
        settings: AgentOSSettings,
        providers: ProviderManager,
        registry: ToolRegistry,
        permissions: PermissionEngine,
        state_manager: StateManager,
        verification: VerificationEngine,
        memory: MemoryManager,
        audit: AuditLogger,
    ) -> None:
        self.db = db
        self.settings = settings
        self.providers = providers
        self.registry = registry
        self.permissions = permissions
        self.state = state_manager
        self.verification = verification
        self.memory = memory
        self.audit = audit
        self.intent_analyzer = IntentAnalyzer()
        self.context_manager = ContextManager(memory)
        self.planner = TaskPlanner(registry)
        self.recovery = RecoveryManager()

        self._cancel_events: dict[str, asyncio.Event] = {}
        self._executed_idempotency_keys: dict[str, set[str]] = {}
        self._emergency_stop_active: bool = False
        self._allow_localhost_browser_for_tests: bool = False

    @property
    def emergency_stop_active(self) -> bool:
        return self._emergency_stop_active

    def set_emergency_stop(self, active: bool) -> int:
        self._emergency_stop_active = active
        cancelled = 0
        if active:
            for ev in self._cancel_events.values():
                if not ev.is_set():
                    ev.set()
                    cancelled += 1
        return cancelled

    def _get_cancel_event(self, task_id: str) -> asyncio.Event:
        if task_id not in self._cancel_events:
            self._cancel_events[task_id] = asyncio.Event()
        return self._cancel_events[task_id]

    @staticmethod
    def _resolve_workspace_rows(
        rows: list[Workspace],
    ) -> tuple[list[Path], dict[str, dict[str, bool]]]:
        authorized = [Path(w.path).resolve(strict=False) for w in rows]
        policies = {
            str(Path(w.path).resolve(strict=False)): {
                "read_only": w.read_only,
                "allow_delete": w.allow_delete,
            }
            for w in rows
        }
        return authorized, policies

    async def _build_tool_context(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        step_id: str,
        app_cfg: AppSettingsPayload,
        approved_step: bool = False,
    ) -> ToolContext:
        rows = list((await session.execute(select(Workspace))).scalars().all())
        authorized, policies = await asyncio.to_thread(self._resolve_workspace_rows, rows)
        return ToolContext(
            task_id=task_id,
            step_id=step_id,
            authorized_workspaces=authorized,
            workspace_policies=policies,
            data_dir=self.settings.data_dir,
            rollback_dir=self.settings.rollback_dir,
            browser_profiles_dir=self.settings.browser_profiles_dir,
            exports_dir=self.settings.exports_dir,
            max_file_size_bytes=self.settings.max_file_size_mb * 1024 * 1024,
            max_screenshot_width=self.settings.max_screenshot_width,
            terminal_enabled=app_cfg.terminal_enabled,
            terminal_allowlist=app_cfg.terminal_allowlist,
            computer_use_enabled=app_cfg.computer_use_enabled,
            computer_use_screen_capture=app_cfg.computer_use_screen_capture,
            computer_use_approved_apps=app_cfg.computer_use_approved_apps,
            emergency_stop_active=self._emergency_stop_active,
            cancel_event=self._get_cancel_event(task_id),
            approved_step=approved_step,
        )

    async def create_and_plan_task(
        self,
        *,
        instruction: str,
        app_cfg: AppSettingsPayload,
        conversation_id: str | None = None,
        workspace_id: str | None = None,
        provider_id: str | None = None,
        model: str | None = None,
        auto_execute_read_only: bool = True,
    ) -> dict[str, Any]:
        target_provider_id = provider_id or app_cfg.default_provider_id
        target_model = model or app_cfg.default_model
        budget = {
            "max_duration_sec": app_cfg.max_duration_sec,
            "max_tool_calls": app_cfg.max_tool_calls,
            "max_retries": app_cfg.max_retries,
            "max_tokens": app_cfg.max_tokens,
            "max_cost_usd": app_cfg.max_cost_usd,
        }

        async with self.db.session() as session:
            task = await self.state.create_task(
                session,
                instruction=instruction,
                provider_id=target_provider_id,
                model=target_model,
                budget=budget,
                conversation_id=conversation_id,
                workspace_id=workspace_id,
            )
            task_id = task.id
            await self.state.transition(session, task, TaskState.PLANNING)
            await self.audit.record(
                session,
                category="task",
                action="task.created",
                actor="user",
                task_id=task_id,
                risk_level="READ_ONLY",
                summary=f"Created task: {instruction[:140]}",
            )

        # Execute the structured LangGraph planning graph.
        graph = self._compile_planning_graph(app_cfg)
        try:
            final_state = await graph.ainvoke(
                {
                    "task_id": task_id,
                    "instruction": instruction,
                    "provider_id": target_provider_id,
                    "model": target_model,
                    "workspace_id": workspace_id,
                }
            )
        except AgentOSError as exc:
            async with self.db.session() as session:
                task_row = await session.get(Task, task_id)
                if task_row is not None:
                    await self.state.transition(
                        session,
                        task_row,
                        TaskState.FAILED,
                        summary=exc.user_message,
                        error=exc.to_dict()["error"],
                    )
                    await self.audit.record(
                        session,
                        category="task",
                        action="task.plan_failed",
                        actor="agent",
                        task_id=task_id,
                        risk_level="MEDIUM",
                        outcome="failed",
                        summary=exc.user_message,
                    )
                t, steps = await self.state.get_task_with_steps(session, task_id)
                return self.state.serialize_task(t, steps)

        if final_state.get("blocked_reason"):
            async with self.db.session() as session:
                t, steps = await self.state.get_task_with_steps(session, task_id)
                return self.state.serialize_task(t, steps)

        if not final_state.get("needs_approval") and auto_execute_read_only:
            return await self.execute_task(task_id, app_cfg=app_cfg)

        async with self.db.session() as session:
            t, steps = await self.state.get_task_with_steps(session, task_id)
            return self.state.serialize_task(t, steps)

    def _compile_planning_graph(self, app_cfg: AppSettingsPayload) -> Any:
        builder: StateGraph[PlanningGraphState] = StateGraph(PlanningGraphState)

        async def node_analyze_intent(state: PlanningGraphState) -> PlanningGraphState:
            workspace_path: str | None = None
            if state.get("workspace_id"):
                async with self.db.session() as session:
                    ws = await session.get(Workspace, state["workspace_id"])
                    if ws is not None:
                        workspace_path = ws.path
            intent = self.intent_analyzer.analyze(state["instruction"], workspace_path)
            return {"intent": intent}

        async def node_retrieve_context(state: PlanningGraphState) -> PlanningGraphState:
            async with self.db.session() as session:
                ws = (
                    await session.get(Workspace, state["workspace_id"])
                    if state.get("workspace_id")
                    else None
                )
                ctx = await self.context_manager.gather(
                    session,
                    instruction=state["instruction"],
                    workspace=ws,
                    memory_enabled=app_cfg.memory_enabled,
                )
            return {"context": ctx}

        async def node_build_plan(state: PlanningGraphState) -> PlanningGraphState:
            cancel_event = self._get_cancel_event(state["task_id"])
            async with self.db.session() as session:
                provider = await self.providers.get_provider(session, state["provider_id"])
            plan, usage = await self.planner.build_plan(
                provider,
                model=state["model"],
                instruction=state["instruction"],
                intent=state.get("intent", {}),
                context=state.get("context", {}),
                max_steps=min(8, app_cfg.max_tool_calls),
                cancel_event=cancel_event,
            )
            return {"plan": plan, "usage": usage.to_dict()}

        async def node_classify_permissions(state: PlanningGraphState) -> PlanningGraphState:
            task_id = state["task_id"]
            plan = state["plan"]
            usage_dict = state.get("usage", {})
            needs_approval = False
            blocked_reason: str | None = None

            async with self.db.session() as session:
                task = await session.get(Task, task_id)
                if task is None:
                    raise TaskCancelledError("Task disappeared during planning.")
                task.intent_json = state.get("intent", {})
                task.plan_json = plan
                task.usage_json = {
                    **task.usage_json,
                    "input_tokens": usage_dict.get("input_tokens", 0),
                    "output_tokens": usage_dict.get("output_tokens", 0),
                    "total_tokens": usage_dict.get("total_tokens", 0),
                    "estimated_cost_usd": usage_dict.get("estimated_cost_usd"),
                }

                # Check token/cost planning budget immediately
                if task.usage_json["total_tokens"] > int(task.budget_json.get("max_tokens", 64000)):
                    raise BudgetExceededError("Planning exceeded task token budget.")

                tool_ctx = await self._build_tool_context(
                    session, task_id=task_id, step_id="plan", app_cfg=app_cfg
                )

                for idx, raw_step in enumerate(plan.get("steps", [])):
                    tool = self.registry.get(raw_step["tool_id"])
                    decision = self.permissions.evaluate(
                        tool,
                        raw_step.get("arguments", {}),
                        tool_ctx,
                        allow_localhost_browser=self._allow_localhost_browser_for_tests,
                    )
                    step = TaskStep(
                        id=f"stp_{uuid.uuid4().hex[:12]}",
                        task_id=task_id,
                        step_index=idx,
                        title=raw_step["title"],
                        description=raw_step.get("description", ""),
                        tool_id=tool.id,
                        arguments_json=redact_value(raw_step.get("arguments", {})),
                        risk_level=decision.risk_level.value,
                        requires_approval=decision.requires_approval,
                        approval_status=(
                            "denied"
                            if not decision.allowed
                            else ("pending" if decision.requires_approval else "not_required")
                        ),
                        status="failed" if not decision.allowed else "pending",
                        preview_json=redact_value(
                            {**decision.preview, "policy_reason": decision.reason}
                        ),
                        error_message=None if decision.allowed else decision.reason,
                    )
                    session.add(step)
                    if not decision.allowed:
                        blocked_reason = decision.reason
                        await self.audit.record(
                            session,
                            category="security",
                            action="permission.blocked",
                            actor="permission_engine",
                            task_id=task_id,
                            tool_id=tool.id,
                            risk_level=RiskLevel.BLOCKED.value,
                            outcome="blocked",
                            summary=decision.reason,
                            details={"step_index": idx, "arguments": raw_step.get("arguments", {})},
                        )
                    elif decision.requires_approval:
                        needs_approval = True

                if blocked_reason:
                    await self.state.transition(
                        session,
                        task,
                        TaskState.FAILED,
                        summary=f"Blocked by permission policy: {blocked_reason}",
                        error={"code": "PERMISSION_DENIED", "message": blocked_reason},
                    )
                elif needs_approval:
                    await self.state.transition(
                        session,
                        task,
                        TaskState.AWAITING_APPROVAL,
                        summary="Execution plan ready. Waiting for user approval on sensitive step(s).",
                    )
                    self.state.events.publish(
                        task_id,
                        "task.awaiting_approval",
                        {"task_id": task_id},
                    )
                else:
                    await self.state.transition(session, task, TaskState.APPROVED)

            return {"needs_approval": needs_approval, "blocked_reason": blocked_reason}

        builder.add_node("analyze_intent", node_analyze_intent)
        builder.add_node("retrieve_context", node_retrieve_context)
        builder.add_node("build_plan", node_build_plan)
        builder.add_node("classify_permissions", node_classify_permissions)
        builder.add_edge(START, "analyze_intent")
        builder.add_edge("analyze_intent", "retrieve_context")
        builder.add_edge("retrieve_context", "build_plan")
        builder.add_edge("build_plan", "classify_permissions")
        builder.add_edge("classify_permissions", END)
        return builder.compile()

    async def approve_task(
        self,
        task_id: str,
        *,
        approve: bool,
        app_cfg: AppSettingsPayload,
        step_ids: list[str] | None = None,
        ttl_minutes: int = 15,
    ) -> dict[str, Any]:
        async with self.db.session() as session:
            task, steps = await self.state.get_task_with_steps(session, task_id)
            if task.status != TaskState.AWAITING_APPROVAL.value:
                raise PermissionDeniedError(
                    f"Task '{task_id}' is in state '{task.status}', not awaiting_approval."
                )

            target_ids = set(step_ids) if step_ids else {s.id for s in steps if s.requires_approval}
            if not approve:
                for step in steps:
                    if step.id in target_ids:
                        step.approval_status = "denied"
                        step.status = "cancelled"
                await self.state.transition(
                    session,
                    task,
                    TaskState.CANCELLED,
                    summary="User declined approval for sensitive action(s).",
                )
                await self.audit.record(
                    session,
                    category="permission",
                    action="permission.denied_by_user",
                    actor="user",
                    task_id=task_id,
                    risk_level="MEDIUM",
                    outcome="denied",
                    summary="User rejected task execution plan.",
                )
                return self.state.serialize_task(task, steps)

            for step in steps:
                if step.requires_approval and step.id in target_ids:
                    step.approval_status = "approved"
                    tool = self.registry.get(step.tool_id)
                    for cap in tool.required_permissions or (tool.id,):
                        await self.permissions.grant_task_permission(
                            session,
                            task_id=task_id,
                            capability=cap,
                            scope=json.dumps(step.arguments_json, sort_keys=True)[:500],
                            risk_level=RiskLevel(step.risk_level),
                            ttl_minutes=ttl_minutes,
                        )
            await self.state.transition(session, task, TaskState.APPROVED)
            await self.audit.record(
                session,
                category="permission",
                action="permission.approved_by_user",
                actor="user",
                task_id=task_id,
                risk_level="MEDIUM",
                outcome="approved",
                summary=f"User approved {len(target_ids)} sensitive step(s) (TTL {ttl_minutes} min).",
            )

        return await self.execute_task(task_id, app_cfg=app_cfg)

    async def execute_task(self, task_id: str, *, app_cfg: AppSettingsPayload) -> dict[str, Any]:
        cancel_event = self._get_cancel_event(task_id)
        cancel_event.clear()
        started_monotonic = time.monotonic()

        async with self.db.session() as session:
            task, steps = await self.state.get_task_with_steps(session, task_id)
            if task.status == TaskState.AWAITING_APPROVAL.value:
                raise PermissionDeniedError(
                    "Task requires explicit user approval before execution."
                )
            if task.status in (TaskState.COMPLETED.value, TaskState.CANCELLED.value):
                return self.state.serialize_task(task, steps)
            await self.state.transition(session, task, TaskState.RUNNING)
            budget = dict(task.budget_json)

        max_duration = float(budget.get("max_duration_sec", app_cfg.max_duration_sec))
        max_tool_calls = int(budget.get("max_tool_calls", app_cfg.max_tool_calls))
        max_retries = int(budget.get("max_retries", app_cfg.max_retries))
        seen_keys = self._executed_idempotency_keys.setdefault(task_id, set())

        try:
            async with self.db.session() as session:
                task, steps = await self.state.get_task_with_steps(session, task_id)
                tool_calls_used = int(task.usage_json.get("tool_calls", 0))
                retries_used = int(task.usage_json.get("retries", 0))

            for step_idx in range(len(steps)):
                if cancel_event.is_set() or self._emergency_stop_active:
                    raise TaskCancelledError("Task cancelled by user or emergency stop.")
                if (time.monotonic() - started_monotonic) > max_duration:
                    raise BudgetExceededError(
                        f"Task exceeded max duration budget ({int(max_duration)}s)."
                    )

                async with self.db.session() as session:
                    task, current_steps = await self.state.get_task_with_steps(session, task_id)
                    step = current_steps[step_idx]
                    if step.status == "completed":
                        continue
                    if step.requires_approval and step.approval_status != "approved":
                        await self.state.transition(
                            session,
                            task,
                            TaskState.AWAITING_APPROVAL,
                            summary=f"Paused before unapproved step '{step.title}'.",
                        )
                        return self.state.serialize_task(task, current_steps)

                    tool_calls_used += 1
                    if tool_calls_used > max_tool_calls:
                        raise BudgetExceededError(
                            f"Task exceeded max tool calls budget ({max_tool_calls})."
                        )

                    tool = self.registry.get(step.tool_id)
                    idempotency_key = hashlib.sha256(
                        f"{task_id}:{step.id}:{tool.id}:{json.dumps(step.arguments_json, sort_keys=True)}".encode()
                    ).hexdigest()
                    if tool.has_side_effects and idempotency_key in seen_keys:
                        step.status = "skipped"
                        step.error_message = "Skipped duplicate side-effect invocation."
                        await session.flush()
                        continue

                    ctx = await self._build_tool_context(
                        session,
                        task_id=task_id,
                        step_id=step.id,
                        app_cfg=app_cfg,
                        approved_step=(step.approval_status == "approved"),
                    )
                    # Re-verify permissions at execution boundary right before invocation!
                    decision = self.permissions.evaluate(
                        tool,
                        step.arguments_json,
                        ctx,
                        allow_localhost_browser=self._allow_localhost_browser_for_tests,
                    )
                    if not decision.allowed:
                        raise PermissionDeniedError(decision.reason)
                    if decision.requires_approval and step.approval_status != "approved":
                        raise PermissionDeniedError(
                            f"Step '{step.title}' requires explicit user approval before execution."
                        )

                    validated_args = tool.validate_args(step.arguments_json)
                    step.status = "running"
                    step.started_at = datetime.now(UTC)
                    await session.flush()
                    self.state.events.publish(
                        task_id,
                        "step.started",
                        {
                            "task_id": task_id,
                            "step_id": step.id,
                            "title": step.title,
                            "tool_id": tool.id,
                        },
                    )

                step_t0 = time.perf_counter()
                output, attempts = await self.recovery.run_with_safe_recovery(
                    tool,
                    lambda t=tool, a=validated_args, c=ctx: t.run_with_timeout(a, c),  # type: ignore[misc]
                    max_retries=max_retries,
                    cancel_event=cancel_event,
                )
                if attempts > 1:
                    retries_used += attempts - 1
                if tool.has_side_effects and output.ok:
                    seen_keys.add(idempotency_key)

                # Deterministic verification step
                ver_outcome = await self.verification.verify_step(tool, validated_args, output, ctx)
                duration_ms = int((time.perf_counter() - step_t0) * 1000)

                async with self.db.session() as session:
                    task, current_steps = await self.state.get_task_with_steps(session, task_id)
                    step = current_steps[step_idx]
                    step.attempt_count = attempts
                    step.duration_ms = duration_ms
                    step.completed_at = datetime.now(UTC)
                    payload_data = redact_value(output.data)
                    if output.untrusted_content:
                        payload_data = {
                            "untrusted_content": True,
                            "source_tool": tool.id,
                            "data": payload_data,
                        }
                    step.result_json = {
                        "ok": output.ok,
                        "summary": output.summary,
                        "data": payload_data,
                        "artifacts": output.artifacts,
                    }
                    step.verification_json = {
                        "verified": ver_outcome.verified,
                        "method": ver_outcome.method,
                        "summary": ver_outcome.summary,
                        "details": redact_value(ver_outcome.details),
                    }
                    if output.rollback_record:
                        step.rollback_json = output.rollback_record
                        await self.state.record_rollback(
                            session,
                            task_id=task_id,
                            step_id=step.id,
                            operation_type=str(
                                output.rollback_record.get("operation_type", "move")
                            ),
                            source_path=str(output.rollback_record.get("source_path", "")),
                            target_path=str(output.rollback_record.get("target_path", "")),
                            backup_path=output.rollback_record.get("backup_path"),
                        )

                    if output.ok and ver_outcome.verified:
                        step.status = "completed"
                    else:
                        step.status = "failed"
                        step.error_message = (
                            output.summary
                            if not output.ok
                            else f"Verification failed: {ver_outcome.summary}"
                        )

                    task.usage_json = {
                        **task.usage_json,
                        "tool_calls": tool_calls_used,
                        "retries": retries_used,
                        "elapsed_sec": round(time.monotonic() - started_monotonic, 2),
                    }
                    await self.audit.record(
                        session,
                        category="tool",
                        action=f"tool.{tool.id}",
                        actor="agent",
                        task_id=task_id,
                        tool_id=tool.id,
                        risk_level=step.risk_level,
                        outcome="ok" if step.status == "completed" else "failed",
                        summary=f"{step.title}: {output.summary}",
                        details={"duration_ms": duration_ms, "verified": ver_outcome.verified},
                    )
                    self.state.events.publish(
                        task_id,
                        "step.completed" if step.status == "completed" else "step.failed",
                        {
                            "task_id": task_id,
                            "step_id": step.id,
                            "status": step.status,
                            "verified": ver_outcome.verified,
                        },
                    )

                    if step.status == "failed":
                        await self.state.transition(
                            session,
                            task,
                            TaskState.FAILED,
                            summary=step.error_message or f"Step '{step.title}' failed.",
                            error={
                                "code": "STEP_FAILED",
                                "step_id": step.id,
                                "message": step.error_message,
                            },
                        )
                        return self.state.serialize_task(task, current_steps)

            # Final verification gate: never mark task completed unless verified!
            async with self.db.session() as session:
                task, final_steps = await self.state.get_task_with_steps(session, task_id)
                await self.state.transition(session, task, TaskState.VERIFYING)
                ver_report = self.verification.evaluate_task_completion(final_steps)
                task.verification_json = ver_report
                task.usage_json = {
                    **task.usage_json,
                    "elapsed_sec": round(time.monotonic() - started_monotonic, 2),
                }
                if ver_report["verified"]:
                    step_lines = [
                        f"- {s.title}: {(s.result_json or {}).get('summary', 'Done')}"
                        for s in final_steps
                        if s.status == "completed"
                    ]
                    summary_text = (
                        f"Completed and verified {ver_report['verified_steps']} step(s).\n"
                        + "\n".join(step_lines)
                    )
                    await self.state.transition(
                        session, task, TaskState.COMPLETED, summary=summary_text
                    )
                    if app_cfg.memory_enabled:
                        with contextlib.suppress(AgentOSError):
                            await self.memory.create(
                                session,
                                category="task_history",
                                title=task.instruction[:120],
                                content=summary_text[:1000],
                                tags=[str(task.intent_json.get("category", "task"))],
                                source_task_id=task.id,
                                workspace_id=task.workspace_id,
                                retention_days=app_cfg.memory_retention_days,
                                memory_enabled=True,
                            )
                else:
                    await self.state.transition(
                        session,
                        task,
                        TaskState.FAILED,
                        summary=ver_report["reason"],
                        error={"code": "VERIFICATION_FAILED", "message": ver_report["reason"]},
                    )
                return self.state.serialize_task(task, final_steps)

        except (TaskCancelledError, asyncio.CancelledError) as exc:
            async with self.db.session() as session:
                task, steps = await self.state.get_task_with_steps(session, task_id)
                for s in steps:
                    if s.status in ("pending", "running"):
                        s.status = "cancelled"
                await self.state.transition(
                    session,
                    task,
                    TaskState.CANCELLED,
                    summary=str(exc) or "Task cancelled.",
                )
                return self.state.serialize_task(task, steps)
        except AgentOSError as exc:
            async with self.db.session() as session:
                task, steps = await self.state.get_task_with_steps(session, task_id)
                await self.state.transition(
                    session,
                    task,
                    TaskState.FAILED,
                    summary=exc.user_message,
                    error=exc.to_dict()["error"],
                )
                return self.state.serialize_task(task, steps)

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        ev = self._get_cancel_event(task_id)
        ev.set()
        async with self.db.session() as session:
            task, steps = await self.state.get_task_with_steps(session, task_id)
            if task.status not in (
                TaskState.COMPLETED.value,
                TaskState.FAILED.value,
                TaskState.CANCELLED.value,
            ):
                for step in steps:
                    if step.status in ("pending", "running"):
                        step.status = "cancelled"
                await self.state.transition(
                    session, task, TaskState.CANCELLED, summary="Cancelled by user."
                )
                await self.audit.record(
                    session,
                    category="task",
                    action="task.cancelled",
                    actor="user",
                    task_id=task_id,
                    risk_level="LOW",
                    outcome="cancelled",
                    summary="User cancelled task.",
                )
            return self.state.serialize_task(task, steps)

    async def retry_task(self, task_id: str, *, app_cfg: AppSettingsPayload) -> dict[str, Any]:
        async with self.db.session() as session:
            task, steps = await self.state.get_task_with_steps(session, task_id)
            if task.status not in (TaskState.FAILED.value, TaskState.PAUSED.value):
                raise PermissionDeniedError(f"Task in state '{task.status}' cannot be retried.")
            for step in steps:
                if step.status == "failed":
                    step.status = "pending"
                    step.error_message = None
            await self.state.transition(session, task, TaskState.APPROVED)
        return await self.execute_task(task_id, app_cfg=app_cfg)

    def build_markdown_report(self, task_dict: dict[str, Any]) -> str:
        lines = [
            f"# AgentOS Execution Report: {task_dict['id']}",
            "",
            f"- Instruction: {task_dict['instruction']}",
            f"- Status: {task_dict['status']}",
            f"- Provider: {task_dict['provider_id']} ({task_dict['model']})",
            f"- Created: {task_dict.get('created_at') or 'n/a'}",
            f"- Completed: {task_dict.get('completed_at') or 'n/a'}",
            f"- Verified: {bool((task_dict.get('verification') or {}).get('verified'))}",
            "",
            "## Summary",
            task_dict.get("result_summary") or "No summary recorded.",
            "",
            "## Steps",
        ]
        for step in task_dict.get("steps", []):
            ver = step.get("verification") or {}
            lines.append(f"### {step['step_index'] + 1}. {step['title']} (`{step['tool_id']}`)")
            lines.append(
                f"- Risk: {step['risk_level']} | Status: {step['status']} | Verified: {bool(ver.get('verified'))}"
            )
            if step.get("result"):
                lines.append(f"- Output: {step['result'].get('summary', '')}")
            if step.get("error_message"):
                lines.append(f"- Error: {step['error_message']}")
            lines.append("")
        return "\n".join(lines).strip() + "\n"


__all__ = ["AgentOrchestrator", "TokenUsage"]
