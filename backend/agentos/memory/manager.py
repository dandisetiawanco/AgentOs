from __future__ import annotations

import math
import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.errors import NotFoundError, PermissionDeniedError, ValidationFailedError
from agentos.security.redactor import REDACTED, redact_text
from agentos.storage.models import MemoryEntry

VALID_MEMORY_CATEGORIES = frozenset(
    {
        "preference",
        "task_history",
        "workspace_context",
        "workflow",
        "tool_result",
        "user_instruction",
    }
)

_TOKEN_RE = re.compile(r"[a-z0-9_]+")


def _tokenize(text: str) -> list[str]:
    return [tok for tok in _TOKEN_RE.findall(text.lower()) if len(tok) >= 2]


def _cosine_tf_score(query_tokens: list[str], doc_tokens: list[str]) -> float:
    if not query_tokens or not doc_tokens:
        return 0.0
    q_counts = Counter(query_tokens)
    d_counts = Counter(doc_tokens)
    dot = sum(q_counts[t] * d_counts[t] for t in q_counts if t in d_counts)
    if dot == 0:
        return 0.0
    q_norm = math.sqrt(sum(v * v for v in q_counts.values()))
    d_norm = math.sqrt(sum(v * v for v in d_counts.values()))
    return dot / (q_norm * d_norm)


class MemoryManager:
    """Optional local-first SQLite memory store with lightweight relevance ranking and redaction."""

    async def create(
        self,
        session: AsyncSession,
        *,
        category: str,
        title: str,
        content: str,
        tags: list[str] | None = None,
        source_task_id: str | None = None,
        workspace_id: str | None = None,
        pinned: bool = False,
        retention_days: int = 90,
        memory_enabled: bool = True,
    ) -> dict[str, Any]:
        if not memory_enabled:
            raise PermissionDeniedError(
                "Local memory is disabled in Settings. Enable memory before saving records."
            )
        if category not in VALID_MEMORY_CATEGORIES:
            raise ValidationFailedError(f"Unsupported memory category '{category}'.")

        safe_title = redact_text(title.strip())
        safe_content = redact_text(content.strip())
        if REDACTED in safe_content or REDACTED in safe_title:
            raise PermissionDeniedError(
                "Refused to store potential credential or secret material in local memory."
            )

        expires_at = None if pinned else datetime.now(UTC) + timedelta(days=max(1, retention_days))
        entry = MemoryEntry(
            id=f"mem_{uuid.uuid4().hex[:14]}",
            category=category,
            title=safe_title,
            content=safe_content,
            tags_json=[t.strip().lower() for t in (tags or []) if t.strip()][:12],
            source_task_id=source_task_id,
            workspace_id=workspace_id,
            pinned=pinned,
            expires_at=expires_at,
        )
        session.add(entry)
        await session.flush()
        return self.serialize(entry)

    async def purge_expired(self, session: AsyncSession) -> int:
        now = datetime.now(UTC)
        rows = (
            (
                await session.execute(
                    select(MemoryEntry).where(
                        MemoryEntry.pinned.is_(False),
                        MemoryEntry.expires_at.is_not(None),
                        MemoryEntry.expires_at < now,
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            await session.delete(row)
        await session.flush()
        return len(rows)

    async def search(
        self,
        session: AsyncSession,
        *,
        query: str | None = None,
        category: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        await self.purge_expired(session)
        stmt = select(MemoryEntry).order_by(desc(MemoryEntry.pinned), desc(MemoryEntry.updated_at))
        if category:
            stmt = stmt.where(MemoryEntry.category == category)
        if workspace_id:
            stmt = stmt.where(MemoryEntry.workspace_id == workspace_id)
        rows = list((await session.execute(stmt.limit(500))).scalars().all())

        if not query or not query.strip():
            return [self.serialize(r) for r in rows[:limit]]

        q_lower = query.strip().lower()
        q_tokens = _tokenize(q_lower)
        scored: list[tuple[float, MemoryEntry]] = []
        for row in rows:
            blob = f"{row.title} {row.content} {' '.join(row.tags_json)}"
            score = _cosine_tf_score(q_tokens, _tokenize(blob))
            if q_lower in blob.lower():
                score += 0.5
            if row.pinned:
                score += 0.05
            if score > 0.0:
                scored.append((score, row))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [self.serialize(row) for _, row in scored[:limit]]

    async def update(
        self,
        session: AsyncSession,
        memory_id: str,
        *,
        title: str | None = None,
        content: str | None = None,
        tags: list[str] | None = None,
        pinned: bool | None = None,
    ) -> dict[str, Any]:
        row = await session.get(MemoryEntry, memory_id)
        if row is None:
            raise NotFoundError(f"Memory entry '{memory_id}' not found.")
        if title is not None:
            safe_title = redact_text(title.strip())
            if REDACTED in safe_title:
                raise PermissionDeniedError("Refused to store potential secret in memory title.")
            row.title = safe_title
        if content is not None:
            safe_content = redact_text(content.strip())
            if REDACTED in safe_content:
                raise PermissionDeniedError("Refused to store potential secret in memory content.")
            row.content = safe_content
        if tags is not None:
            row.tags_json = [t.strip().lower() for t in tags if t.strip()][:12]
        if pinned is not None:
            row.pinned = pinned
            if pinned:
                row.expires_at = None
        await session.flush()
        return self.serialize(row)

    async def delete_one(self, session: AsyncSession, memory_id: str) -> None:
        row = await session.get(MemoryEntry, memory_id)
        if row is None:
            raise NotFoundError(f"Memory entry '{memory_id}' not found.")
        await session.delete(row)
        await session.flush()

    async def clear_all(self, session: AsyncSession) -> int:
        rows = list((await session.execute(select(MemoryEntry))).scalars().all())
        count = len(rows)
        await session.execute(delete(MemoryEntry))
        await session.flush()
        return count

    async def export_all(self, session: AsyncSession) -> dict[str, Any]:
        entries = await self.search(session, limit=500)
        return {"exported_at": datetime.now(UTC).isoformat(), "entries": entries}

    @staticmethod
    def serialize(row: MemoryEntry) -> dict[str, Any]:
        return {
            "id": row.id,
            "category": row.category,
            "title": row.title,
            "content": row.content,
            "tags": row.tags_json,
            "source_task_id": row.source_task_id,
            "workspace_id": row.workspace_id,
            "pinned": row.pinned,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
