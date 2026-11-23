from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.errors import NotFoundError, PermissionDeniedError, ValidationFailedError
from agentos.permissions.engine import BLOCKED_EXECUTABLES
from agentos.storage.models import McpServerConfig


class McpManager:
    """Optional Model Context Protocol client using the official Python mcp SDK.

    External MCP servers and discovered tools are treated as untrusted by default.
    Discovered tools are never executed automatically without explicit user allowlisting.
    """

    async def list_servers(self, session: AsyncSession) -> list[dict[str, Any]]:
        rows = (
            (await session.execute(select(McpServerConfig).order_by(McpServerConfig.name)))
            .scalars()
            .all()
        )
        return [self.serialize(row) for row in rows]

    async def create_server(
        self,
        session: AsyncSession,
        *,
        name: str,
        transport: str,
        command: list[str] | None = None,
        url: str | None = None,
        enabled: bool = False,
    ) -> dict[str, Any]:
        if transport not in ("stdio", "sse", "streamable_http"):
            raise ValidationFailedError(f"Unsupported MCP transport '{transport}'.")
        cmd_list = [c.strip() for c in (command or []) if c.strip()]
        if transport == "stdio":
            if not cmd_list:
                raise ValidationFailedError(
                    "Stdio MCP servers require a structured executable command list."
                )
            if cmd_list[0] in BLOCKED_EXECUTABLES:
                raise PermissionDeniedError(
                    f"Refusing to configure MCP server with blocked executable '{cmd_list[0]}'."
                )
        elif not url or not url.startswith(("http://", "https://")):
            raise ValidationFailedError("HTTP/SSE MCP servers require an http:// or https:// URL.")

        server = McpServerConfig(
            id=f"mcp_{uuid.uuid4().hex[:12]}",
            name=name.strip(),
            transport=transport,
            command_json=cmd_list,
            url=url.strip() if url else None,
            enabled=enabled,
            allowed_tools_json=[],
            status="configured",
            last_error=None,
        )
        session.add(server)
        await session.flush()
        return self.serialize(server)

    async def delete_server(self, session: AsyncSession, server_id: str) -> None:
        row = await session.get(McpServerConfig, server_id)
        if row is None:
            raise NotFoundError(f"MCP server '{server_id}' not found.")
        await session.delete(row)
        await session.flush()

    async def authorize_tools(
        self, session: AsyncSession, server_id: str, allowed_tools: list[str]
    ) -> dict[str, Any]:
        row = await session.get(McpServerConfig, server_id)
        if row is None:
            raise NotFoundError(f"MCP server '{server_id}' not found.")
        row.allowed_tools_json = sorted({t.strip() for t in allowed_tools if t.strip()})
        await session.flush()
        return self.serialize(row)

    async def test_and_discover(
        self,
        session: AsyncSession,
        server_id: str,
        *,
        timeout_sec: float = 10.0,
    ) -> dict[str, Any]:
        row = await session.get(McpServerConfig, server_id)
        if row is None:
            raise NotFoundError(f"MCP server '{server_id}' not found.")

        now = datetime.now(UTC)
        row.last_checked_at = now

        if row.transport != "stdio":
            row.status = "unreachable"
            row.last_error = (
                "Remote HTTP/SSE MCP discovery requires explicitly enabling the endpoint; "
                "use a local stdio MCP server for isolated schema inspection."
            )
            await session.flush()
            return {"ok": False, "status": row.status, "message": row.last_error, "tools": []}

        if not row.command_json:
            row.status = "error"
            row.last_error = "No stdio command configured."
            await session.flush()
            return {"ok": False, "status": row.status, "message": row.last_error, "tools": []}

        params = StdioServerParameters(
            command=row.command_json[0],
            args=row.command_json[1:],
            # Sanitized minimal environment so secrets never leak to external MCP servers.
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONUNBUFFERED": "1"},
        )

        async def _discover() -> list[dict[str, Any]]:
            async with (
                stdio_client(params) as (read_stream, write_stream),
                ClientSession(read_stream, write_stream) as mcp_session,
            ):
                await mcp_session.initialize()
                listed = await mcp_session.list_tools()
                return [
                    {
                        "name": t.name,
                        "description": t.description or "",
                        "input_schema": dict(t.inputSchema) if t.inputSchema else {},
                    }
                    for t in listed.tools
                ]

        try:
            discovered = await asyncio.wait_for(_discover(), timeout=timeout_sec)
            row.status = "connected"
            row.last_error = None
            await session.flush()
            return {
                "ok": True,
                "status": "connected",
                "message": (
                    f"Connected to MCP server '{row.name}' and discovered {len(discovered)} tool(s). "
                    "Discovered tools remain disabled until explicitly authorized."
                ),
                "tools": discovered,
            }
        except TimeoutError:
            row.status = "timeout"
            row.last_error = f"MCP server '{row.name}' timed out after {int(timeout_sec)}s."
            await session.flush()
            return {"ok": False, "status": row.status, "message": row.last_error, "tools": []}
        except Exception as exc:  # noqa: BLE001
            row.status = "error"
            row.last_error = str(exc)
            await session.flush()
            return {"ok": False, "status": row.status, "message": row.last_error, "tools": []}

    @staticmethod
    def serialize(row: McpServerConfig) -> dict[str, Any]:
        return {
            "id": row.id,
            "name": row.name,
            "transport": row.transport,
            "command": row.command_json,
            "url": row.url,
            "enabled": row.enabled,
            "allowed_tools": row.allowed_tools_json,
            "status": row.status,
            "last_error": row.last_error,
            "last_checked_at": row.last_checked_at.isoformat() if row.last_checked_at else None,
        }
