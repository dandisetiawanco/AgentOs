from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from agentos.memory.manager import MemoryManager
from agentos.storage.models import Workspace


class ContextManager:
    """Assembles bounded workspace and memory context for the task planner."""

    def __init__(self, memory: MemoryManager) -> None:
        self.memory = memory

    async def gather(
        self,
        session: AsyncSession,
        *,
        instruction: str,
        workspace: Workspace | None,
        memory_enabled: bool,
        max_memory_items: int = 5,
    ) -> dict[str, Any]:
        memories: list[dict[str, Any]] = []
        if memory_enabled:
            memories = await self.memory.search(
                session,
                query=instruction,
                workspace_id=workspace.id if workspace else None,
                limit=max_memory_items,
            )
            if len(memories) < max_memory_items:
                global_mems = await self.memory.search(
                    session,
                    query=instruction,
                    category="user_instruction",
                    limit=max_memory_items - len(memories),
                )
                seen = {m["id"] for m in memories}
                for item in global_mems:
                    if item["id"] not in seen:
                        memories.append(item)

        return {
            "workspace": {
                "id": workspace.id,
                "name": workspace.name,
                "path": workspace.path,
                "read_only": workspace.read_only,
            }
            if workspace
            else None,
            "memories": [
                {"category": m["category"], "title": m["title"], "content": m["content"][:300]}
                for m in memories
            ],
        }
