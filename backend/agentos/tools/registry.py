from __future__ import annotations

from typing import Any

from agentos.errors import NotFoundError
from agentos.tools.base import BaseTool


class ToolRegistry:
    """Strongly typed deterministic registry of all built-in and approved tools."""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        if tool.id in self._tools:
            raise ValueError(f"Duplicate tool registration: {tool.id}")
        self._tools[tool.id] = tool

    def get(self, tool_id: str) -> BaseTool:
        tool = self._tools.get(tool_id)
        if tool is None:
            raise NotFoundError(f"Tool '{tool_id}' is not registered.")
        return tool

    def has(self, tool_id: str) -> bool:
        return tool_id in self._tools

    def list_tools(self, category: str | None = None) -> list[BaseTool]:
        tools = list(self._tools.values())
        if category:
            tools = [t for t in tools if t.category == category]
        return sorted(tools, key=lambda t: (t.category, t.id))

    def list_metadata(self, category: str | None = None) -> list[dict[str, Any]]:
        return [t.to_metadata() for t in self.list_tools(category=category)]

    def to_provider_schemas(self) -> list[dict[str, Any]]:
        return [
            {
                "name": t.id,
                "description": f"[{t.risk_level.value}] {t.description}",
                "input_schema": t.input_model.model_json_schema(),
            }
            for t in self.list_tools()
        ]
