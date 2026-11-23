from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.agents.orchestrator import AgentOrchestrator
from agentos.api.schemas import AppSettingsPayload
from agentos.errors import NotFoundError
from agentos.storage.database import DatabaseManager
from agentos.storage.models import Workflow, WorkflowRun

logger = logging.getLogger("agentos.workflows")


class WorkflowManager:
    """Manages reusable workflows, execution runs, and in-app scheduling (active while app runs)."""

    def __init__(self, db: DatabaseManager, orchestrator: AgentOrchestrator) -> None:
        self.db = db
        self.orchestrator = orchestrator
        self._scheduler_task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def list_workflows(self, session: AsyncSession) -> list[dict[str, Any]]:
        rows = (
            (
                await session.execute(
                    select(Workflow).order_by(desc(Workflow.is_builtin), Workflow.name)
                )
            )
            .scalars()
            .all()
        )
        return [self.serialize_workflow(w) for w in rows]

    async def create_workflow(
        self, session: AsyncSession, payload: dict[str, Any]
    ) -> dict[str, Any]:
        interval = payload.get("schedule_interval_minutes")
        schedule_enabled = bool(payload.get("schedule_enabled", False)) and bool(interval)
        next_run = (
            datetime.now(UTC) + timedelta(minutes=int(interval))
            if schedule_enabled and interval
            else None
        )
        wf = Workflow(
            id=f"wf_{uuid.uuid4().hex[:12]}",
            name=str(payload["name"]).strip(),
            description=str(payload.get("description") or "").strip(),
            template_key=payload.get("template_key"),
            instruction_template=str(payload["instruction_template"]).strip(),
            workspace_id=payload.get("workspace_id") or None,
            provider_id=payload.get("provider_id") or None,
            model=payload.get("model") or None,
            schedule_enabled=schedule_enabled,
            schedule_interval_minutes=int(interval) if interval else None,
            retry_max_attempts=max(0, min(int(payload.get("retry_max_attempts", 1)), 3)),
            output_destination=payload.get("output_destination") or None,
            is_builtin=False,
            next_run_at=next_run,
        )
        session.add(wf)
        await session.flush()
        return self.serialize_workflow(wf)

    async def update_workflow(
        self, session: AsyncSession, workflow_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        wf = await session.get(Workflow, workflow_id)
        if wf is None:
            raise NotFoundError(f"Workflow '{workflow_id}' not found.")
        for field in (
            "name",
            "description",
            "instruction_template",
            "workspace_id",
            "provider_id",
            "model",
            "output_destination",
        ):
            if field in payload and payload[field] is not None:
                setattr(wf, field, payload[field])
        if "retry_max_attempts" in payload and payload["retry_max_attempts"] is not None:
            wf.retry_max_attempts = max(0, min(int(payload["retry_max_attempts"]), 3))
        if "schedule_interval_minutes" in payload:
            val = payload["schedule_interval_minutes"]
            wf.schedule_interval_minutes = int(val) if val else None
        if "schedule_enabled" in payload and payload["schedule_enabled"] is not None:
            wf.schedule_enabled = bool(payload["schedule_enabled"]) and bool(
                wf.schedule_interval_minutes
            )
            wf.next_run_at = (
                datetime.now(UTC) + timedelta(minutes=wf.schedule_interval_minutes)
                if wf.schedule_enabled and wf.schedule_interval_minutes
                else None
            )
        await session.flush()
        return self.serialize_workflow(wf)

    async def delete_workflow(self, session: AsyncSession, workflow_id: str) -> None:
        wf = await session.get(Workflow, workflow_id)
        if wf is None:
            raise NotFoundError(f"Workflow '{workflow_id}' not found.")
        await session.delete(wf)
        await session.flush()

    async def run_workflow(
        self,
        workflow_id: str,
        *,
        app_cfg: AppSettingsPayload,
        trigger: str = "manual",
    ) -> dict[str, Any]:
        async with self.db.session() as session:
            wf = await session.get(Workflow, workflow_id)
            if wf is None:
                raise NotFoundError(f"Workflow '{workflow_id}' not found.")
            run = WorkflowRun(
                id=f"wfr_{uuid.uuid4().hex[:12]}",
                workflow_id=wf.id,
                trigger=trigger,
                status="running",
            )
            session.add(run)
            wf.last_run_at = datetime.now(UTC)
            if wf.schedule_enabled and wf.schedule_interval_minutes:
                wf.next_run_at = datetime.now(UTC) + timedelta(minutes=wf.schedule_interval_minutes)
            instruction = wf.instruction_template
            if wf.output_destination:
                instruction = f"{instruction} Output destination: {wf.output_destination}."
            workspace_id = wf.workspace_id
            provider_id = wf.provider_id or app_cfg.default_provider_id
            model = wf.model or app_cfg.default_model
            run_id = run.id

        task_dict = await self.orchestrator.create_and_plan_task(
            instruction=instruction,
            app_cfg=app_cfg,
            workspace_id=workspace_id,
            provider_id=provider_id,
            model=model,
            auto_execute_read_only=True,
        )

        async with self.db.session() as session:
            run_row = await session.get(WorkflowRun, run_id)
            assert run_row is not None
            run_row.task_id = task_dict["id"]
            run_row.status = task_dict["status"]
            run_row.summary = task_dict.get("result_summary")
            if task_dict.get("error"):
                run_row.error_message = str(task_dict["error"].get("message", ""))
            if task_dict["status"] in ("completed", "failed", "cancelled"):
                run_row.completed_at = datetime.now(UTC)
            serialized_run = self.serialize_run(run_row)

        return {"run": serialized_run, "task": task_dict}

    async def list_runs(
        self, session: AsyncSession, *, workflow_id: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        stmt = select(WorkflowRun).order_by(desc(WorkflowRun.started_at)).limit(limit)
        if workflow_id:
            stmt = stmt.where(WorkflowRun.workflow_id == workflow_id)
        rows = (await session.execute(stmt)).scalars().all()
        return [self.serialize_run(r) for r in rows]

    def start_scheduler(self, get_settings_fn: Any) -> None:
        """Starts in-app scheduler loop. Runs only while AgentOS is open."""
        if self._scheduler_task is not None:
            return
        self._stop_event.clear()

        async def _loop() -> None:
            while not self._stop_event.is_set():
                try:
                    await self._tick(get_settings_fn)
                except Exception:  # noqa: BLE001
                    logger.exception("Workflow scheduler tick error")
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._stop_event.wait(), timeout=30.0)

        self._scheduler_task = asyncio.create_task(_loop(), name="agentos-workflow-scheduler")

    async def stop_scheduler(self) -> None:
        self._stop_event.set()
        if self._scheduler_task is not None:
            self._scheduler_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._scheduler_task
            self._scheduler_task = None

    async def _tick(self, get_settings_fn: Any) -> None:
        now = datetime.now(UTC)
        due_ids: list[str] = []
        async with self.db.session() as session:
            rows = (
                (
                    await session.execute(
                        select(Workflow).where(
                            Workflow.schedule_enabled.is_(True),
                            Workflow.next_run_at.is_not(None),
                        )
                    )
                )
                .scalars()
                .all()
            )
            for wf in rows:
                next_at = wf.next_run_at
                if next_at is None:
                    continue
                if next_at.tzinfo is None:
                    next_at = next_at.replace(tzinfo=UTC)
                if next_at <= now:
                    due_ids.append(wf.id)

        if not due_ids:
            return
        app_cfg = await get_settings_fn()
        for wf_id in due_ids:
            await self.run_workflow(wf_id, app_cfg=app_cfg, trigger="scheduled")

    @staticmethod
    def serialize_workflow(wf: Workflow) -> dict[str, Any]:
        return {
            "id": wf.id,
            "name": wf.name,
            "description": wf.description,
            "template_key": wf.template_key,
            "instruction_template": wf.instruction_template,
            "workspace_id": wf.workspace_id,
            "provider_id": wf.provider_id,
            "model": wf.model,
            "schedule_enabled": wf.schedule_enabled,
            "schedule_interval_minutes": wf.schedule_interval_minutes,
            "retry_max_attempts": wf.retry_max_attempts,
            "output_destination": wf.output_destination,
            "is_builtin": wf.is_builtin,
            "last_run_at": wf.last_run_at.isoformat() if wf.last_run_at else None,
            "next_run_at": wf.next_run_at.isoformat() if wf.next_run_at else None,
            "created_at": wf.created_at.isoformat() if wf.created_at else None,
        }

    @staticmethod
    def serialize_run(run: WorkflowRun) -> dict[str, Any]:
        return {
            "id": run.id,
            "workflow_id": run.workflow_id,
            "task_id": run.task_id,
            "trigger": run.trigger,
            "status": run.status,
            "summary": run.summary,
            "error_message": run.error_message,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        }
