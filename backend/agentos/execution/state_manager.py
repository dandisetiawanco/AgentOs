from __future__ import annotations

import asyncio
import shutil
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.errors import NotFoundError, ValidationFailedError
from agentos.storage.models import RollbackRecord, Task, TaskStep


class TaskState(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    RUNNING = "running"
    PAUSED = "paused"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


ALLOWED_TRANSITIONS: dict[TaskState, frozenset[TaskState]] = {
    TaskState.CREATED: frozenset({TaskState.PLANNING, TaskState.CANCELLED, TaskState.FAILED}),
    TaskState.PLANNING: frozenset(
        {
            TaskState.AWAITING_APPROVAL,
            TaskState.APPROVED,
            TaskState.RUNNING,
            TaskState.FAILED,
            TaskState.CANCELLED,
        }
    ),
    TaskState.AWAITING_APPROVAL: frozenset(
        {TaskState.APPROVED, TaskState.CANCELLED, TaskState.FAILED, TaskState.PAUSED}
    ),
    TaskState.APPROVED: frozenset(
        {TaskState.RUNNING, TaskState.PAUSED, TaskState.CANCELLED, TaskState.FAILED}
    ),
    TaskState.RUNNING: frozenset(
        {
            TaskState.AWAITING_APPROVAL,
            TaskState.PAUSED,
            TaskState.VERIFYING,
            TaskState.FAILED,
            TaskState.CANCELLED,
        }
    ),
    TaskState.PAUSED: frozenset(
        {TaskState.RUNNING, TaskState.APPROVED, TaskState.AWAITING_APPROVAL, TaskState.CANCELLED}
    ),
    TaskState.VERIFYING: frozenset({TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.COMPLETED: frozenset(),
    TaskState.FAILED: frozenset({TaskState.PLANNING, TaskState.APPROVED, TaskState.RUNNING}),
    TaskState.CANCELLED: frozenset({TaskState.PLANNING}),
}


def validate_transition(current: TaskState, target: TaskState) -> None:
    if current == target:
        return
    allowed = ALLOWED_TRANSITIONS.get(current, frozenset())
    if target not in allowed:
        raise ValidationFailedError(
            f"Illegal task state transition from '{current.value}' to '{target.value}'."
        )


class TaskEventBus:
    """In-memory pub/sub broker for streaming real-time task SSE events."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def subscribe(self, task_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=128)
        self._subscribers[task_id].add(queue)
        return queue

    def unsubscribe(self, task_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        if task_id in self._subscribers:
            self._subscribers[task_id].discard(queue)
            if not self._subscribers[task_id]:
                self._subscribers.pop(task_id, None)

    def publish(self, task_id: str, event_name: str, data: dict[str, Any]) -> None:
        payload = {"event": event_name, "data": data, "timestamp": datetime.now(UTC).isoformat()}
        for queue in list(self._subscribers.get(task_id, ())):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop oldest event under slow consumers so execution never stalls.
                try:
                    queue.get_nowait()
                    queue.put_nowait(payload)
                except asyncio.QueueEmpty:
                    pass


class StateManager:
    """Persists typed task states, execution steps, and rollback journals in SQLite."""

    def __init__(self, event_bus: TaskEventBus | None = None) -> None:
        self.events = event_bus or TaskEventBus()

    async def create_task(
        self,
        session: AsyncSession,
        *,
        instruction: str,
        provider_id: str,
        model: str,
        budget: dict[str, Any],
        conversation_id: str | None = None,
        workspace_id: str | None = None,
    ) -> Task:
        task = Task(
            id=f"tsk_{uuid.uuid4().hex[:14]}",
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            instruction=instruction.strip(),
            status=TaskState.CREATED.value,
            provider_id=provider_id,
            model=model,
            intent_json={},
            plan_json={},
            budget_json=budget,
            usage_json={
                "tool_calls": 0,
                "retries": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": None,
                "elapsed_sec": 0.0,
            },
            verification_json={},
        )
        session.add(task)
        await session.flush()
        self.events.publish(task.id, "task.created", {"task_id": task.id, "status": task.status})
        return task

    async def transition(
        self,
        session: AsyncSession,
        task: Task,
        target: TaskState,
        *,
        summary: str | None = None,
        error: dict[str, Any] | None = None,
    ) -> Task:
        current = TaskState(task.status)
        validate_transition(current, target)
        task.status = target.value
        now = datetime.now(UTC)
        if target == TaskState.RUNNING and task.started_at is None:
            task.started_at = now
        if target in (TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED):
            task.completed_at = now
        if summary is not None:
            task.result_summary = summary
        if error is not None:
            task.error_json = error
        task.updated_at = now
        await session.flush()
        self.events.publish(
            task.id,
            "task.status",
            {"task_id": task.id, "status": task.status, "summary": task.result_summary},
        )
        return task

    async def get_task_with_steps(
        self, session: AsyncSession, task_id: str
    ) -> tuple[Task, list[TaskStep]]:
        task = await session.get(Task, task_id)
        if task is None:
            raise NotFoundError(f"Task '{task_id}' not found.")
        steps = list(
            (
                await session.execute(
                    select(TaskStep)
                    .where(TaskStep.task_id == task_id)
                    .order_by(TaskStep.step_index)
                )
            )
            .scalars()
            .all()
        )
        return task, steps

    async def list_tasks(
        self,
        session: AsyncSession,
        *,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        stmt = select(Task).order_by(desc(Task.created_at)).limit(max(1, min(limit, 200)))
        if status:
            stmt = stmt.where(Task.status == status)
        rows = (await session.execute(stmt)).scalars().all()
        results: list[dict[str, Any]] = []
        for task in rows:
            steps = list(
                (
                    await session.execute(
                        select(TaskStep)
                        .where(TaskStep.task_id == task.id)
                        .order_by(TaskStep.step_index)
                    )
                )
                .scalars()
                .all()
            )
            results.append(self.serialize_task(task, steps))
        return results

    async def record_rollback(
        self,
        session: AsyncSession,
        *,
        task_id: str,
        step_id: str,
        operation_type: str,
        source_path: str,
        target_path: str,
        backup_path: str | None = None,
    ) -> RollbackRecord:
        record = RollbackRecord(
            id=f"rbk_{uuid.uuid4().hex[:12]}",
            task_id=task_id,
            step_id=step_id,
            operation_type=operation_type,
            source_path=source_path,
            target_path=target_path,
            backup_path=backup_path,
            restored=False,
        )
        session.add(record)
        await session.flush()
        return record

    @staticmethod
    def _apply_rollback_record(rec: RollbackRecord) -> dict[str, Any] | None:
        src = Path(rec.source_path)
        dst = Path(rec.target_path)
        if rec.operation_type in ("move", "rename") and dst.exists() and not src.exists():
            src.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(dst), str(src))
            return {"id": rec.id, "operation": rec.operation_type, "restored_to": str(src)}
        if rec.operation_type == "copy" and dst.exists() and dst.is_file():
            dst.unlink()
            return {"id": rec.id, "operation": "copy", "removed_copy": str(dst)}
        if (
            rec.operation_type == "create_folder"
            and dst.exists()
            and dst.is_dir()
            and not any(dst.iterdir())
        ):
            dst.rmdir()
            return {"id": rec.id, "operation": "create_folder", "removed_dir": str(dst)}
        return None

    async def rollback_task(self, session: AsyncSession, task_id: str) -> dict[str, Any]:
        records = list(
            (
                await session.execute(
                    select(RollbackRecord)
                    .where(RollbackRecord.task_id == task_id, RollbackRecord.restored.is_(False))
                    .order_by(desc(RollbackRecord.created_at))
                )
            )
            .scalars()
            .all()
        )
        restored_items: list[dict[str, Any]] = []
        for rec in records:
            restored = await asyncio.to_thread(self._apply_rollback_record, rec)
            if restored is not None:
                rec.restored = True
                restored_items.append(restored)
        await session.flush()
        return {"restored_count": len(restored_items), "details": restored_items}

    @staticmethod
    def serialize_step(step: TaskStep) -> dict[str, Any]:
        return {
            "id": step.id,
            "task_id": step.task_id,
            "step_index": step.step_index,
            "title": step.title,
            "description": step.description,
            "tool_id": step.tool_id,
            "arguments": step.arguments_json,
            "risk_level": step.risk_level,
            "requires_approval": step.requires_approval,
            "approval_status": step.approval_status,
            "status": step.status,
            "preview": step.preview_json,
            "result": step.result_json,
            "verification": step.verification_json,
            "rollback": step.rollback_json,
            "error_message": step.error_message,
            "attempt_count": step.attempt_count,
            "duration_ms": step.duration_ms,
            "started_at": step.started_at.isoformat() if step.started_at else None,
            "completed_at": step.completed_at.isoformat() if step.completed_at else None,
        }

    @classmethod
    def serialize_task(cls, task: Task, steps: list[TaskStep]) -> dict[str, Any]:
        return {
            "id": task.id,
            "conversation_id": task.conversation_id,
            "workspace_id": task.workspace_id,
            "instruction": task.instruction,
            "intent": task.intent_json,
            "status": task.status,
            "provider_id": task.provider_id,
            "model": task.model,
            "plan": task.plan_json,
            "budget": task.budget_json,
            "usage": task.usage_json,
            "result_summary": task.result_summary,
            "verification": task.verification_json,
            "error": task.error_json,
            "steps": [cls.serialize_step(s) for s in steps],
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        }
