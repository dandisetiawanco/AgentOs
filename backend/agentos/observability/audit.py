from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.security.redactor import redact_text, redact_value
from agentos.storage.models import AuditLog


class AuditLogger:
    """Writes and queries immutable, secret-redacted audit events in SQLite."""

    async def record(
        self,
        session: AsyncSession,
        *,
        category: str,
        action: str,
        summary: str,
        actor: str = "system",
        task_id: str | None = None,
        tool_id: str | None = None,
        risk_level: str = "READ_ONLY",
        outcome: str = "ok",
        details: dict[str, Any] | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            id=f"aud_{uuid.uuid4().hex[:16]}",
            category=category,
            action=action,
            actor=actor,
            task_id=task_id,
            tool_id=tool_id,
            risk_level=risk_level,
            outcome=outcome,
            summary=redact_text(summary),
            details_json=redact_value(details or {}),
        )
        session.add(entry)
        await session.flush()
        return entry

    async def list_events(
        self,
        session: AsyncSession,
        *,
        category: str | None = None,
        risk_level: str | None = None,
        task_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        stmt = select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(max(1, min(limit, 500)))
        if category:
            stmt = stmt.where(AuditLog.category == category)
        if risk_level:
            stmt = stmt.where(AuditLog.risk_level == risk_level)
        if task_id:
            stmt = stmt.where(AuditLog.task_id == task_id)
        rows = (await session.execute(stmt)).scalars().all()
        return [
            {
                "id": row.id,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
                "category": row.category,
                "action": row.action,
                "actor": row.actor,
                "task_id": row.task_id,
                "tool_id": row.tool_id,
                "risk_level": row.risk_level,
                "outcome": row.outcome,
                "summary": row.summary,
                "details": row.details_json,
            }
            for row in rows
        ]
