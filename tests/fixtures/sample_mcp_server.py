"""Minimal local stdio MCP test fixture server using the official mcp Python SDK."""

from __future__ import annotations

import asyncio
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

server = Server("agentos-fixture-mcp")


@server.list_tools()
async def handle_list_tools() -> list[Tool]:
    return [
        Tool(
            name="echo_fixture",
            description="Deterministic read-only echo tool for MCP integration tests.",
            inputSchema={
                "type": "object",
                "properties": {"message": {"type": "string"}},
                "required": ["message"],
            },
        )
    ]


@server.call_tool()
async def handle_call_tool(name: str, arguments: dict[str, Any] | None) -> list[TextContent]:
    msg = (arguments or {}).get("message", "")
    return [TextContent(type="text", text=f"echo:{name}:{msg}")]


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
