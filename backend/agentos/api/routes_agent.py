from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from agentos.api.schemas import AppSettingsPayload
from agentos.errors import NotFoundError
from agentos.security.auth import require_session_auth
from agentos.storage.models import Conversation, Message
from agentos.tools.computer_use import inspect_computer_use_capabilities


class ConversationCreateReq(BaseModel):
    title: str = "New Session"
    workspace_id: str | None = None
    provider_id: str = "mock"
    model: str = "mock-deterministic-v1"


class TaskCreateReq(BaseModel):
    instruction: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = None
    workspace_id: str | None = None
    provider_id: str | None = None
    model: str | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    auto_execute_read_only: bool = True


class TaskApproveReq(BaseModel):
    approve: bool
    step_ids: list[str] | None = None
    ttl_minutes: int = Field(default=15, ge=1, le=120)


class MemoryCreateReq(BaseModel):
    category: Literal[
        "preference",
        "task_history",
        "workspace_context",
        "workflow",
        "tool_result",
        "user_instruction",
    ]
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(min_length=1, max_length=10000)
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False


class MemoryUpdateReq(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    pinned: bool | None = None


class WorkflowCreateReq(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    instruction_template: str = Field(min_length=1, max_length=8000)
    workspace_id: str | None = None
    provider_id: str | None = None
    model: str | None = None
    schedule_enabled: bool = False
    schedule_interval_minutes: int | None = Field(default=None, ge=1, le=10080)
    retry_max_attempts: int = Field(default=1, ge=0, le=3)
    output_destination: str | None = None


class WorkflowUpdateReq(BaseModel):
    name: str | None = None
    description: str | None = None
    instruction_template: str | None = None
    workspace_id: str | None = None
    provider_id: str | None = None
    model: str | None = None
    schedule_enabled: bool | None = None
    schedule_interval_minutes: int | None = Field(default=None, ge=1, le=10080)
    retry_max_attempts: int | None = Field(default=None, ge=0, le=3)
    output_destination: str | None = None


class McpServerCreateReq(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    transport: Literal["stdio", "sse", "streamable_http"] = "stdio"
    command: list[str] = Field(default_factory=list)
    url: str | None = None
    enabled: bool = False


class McpAuthorizeReq(BaseModel):
    allowed_tools: list[str] = Field(default_factory=list)


class EmergencyStopReq(BaseModel):
    active: bool


def build_agent_router(load_settings_fn: Any) -> APIRouter:
    router = APIRouter(dependencies=[Depends(require_session_auth)])

    @router.get("/api/v1/tools", tags=["tools"])
    async def list_tools(request: Request, category: str | None = None) -> dict[str, Any]:
        registry = request.app.state.registry
        return {"tools": registry.list_metadata(category=category)}

    @router.get("/api/v1/conversations", tags=["conversations"])
    async def list_conversations(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        async with db.session() as session:
            rows = (
                (
                    await session.execute(
                        select(Conversation).order_by(desc(Conversation.updated_at)).limit(50)
                    )
                )
                .scalars()
                .all()
            )
        return {
            "conversations": [
                {
                    "id": c.id,
                    "title": c.title,
                    "workspace_id": c.workspace_id,
                    "provider_id": c.provider_id,
                    "model": c.model,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                    "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                }
                for c in rows
            ]
        }

    @router.post("/api/v1/conversations", tags=["conversations"])
    async def create_conversation(request: Request, req: ConversationCreateReq) -> dict[str, Any]:
        db = request.app.state.db
        async with db.session() as session:
            conv = Conversation(
                id=f"cnv_{uuid.uuid4().hex[:12]}",
                title=req.title.strip() or "New Session",
                workspace_id=req.workspace_id,
                provider_id=req.provider_id,
                model=req.model,
            )
            session.add(conv)
        return {
            "conversation": {
                "id": conv.id,
                "title": conv.title,
                "workspace_id": conv.workspace_id,
                "provider_id": conv.provider_id,
                "model": conv.model,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
                "messages": [],
            }
        }

    @router.get("/api/v1/conversations/{conversation_id}", tags=["conversations"])
    async def get_conversation(request: Request, conversation_id: str) -> dict[str, Any]:
        db = request.app.state.db
        async with db.session() as session:
            conv = await session.get(Conversation, conversation_id)
            if conv is None:
                raise NotFoundError(f"Conversation '{conversation_id}' not found.")
            msgs = (
                (
                    await session.execute(
                        select(Message)
                        .where(Message.conversation_id == conversation_id)
                        .order_by(Message.created_at)
                    )
                )
                .scalars()
                .all()
            )
        return {
            "conversation": {
                "id": conv.id,
                "title": conv.title,
                "workspace_id": conv.workspace_id,
                "provider_id": conv.provider_id,
                "model": conv.model,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
                "messages": [
                    {
                        "id": m.id,
                        "conversation_id": m.conversation_id,
                        "role": m.role,
                        "content": m.content,
                        "task_id": m.task_id,
                        "attachments": m.attachments_json,
                        "created_at": m.created_at.isoformat() if m.created_at else None,
                    }
                    for m in msgs
                ],
            }
        }

    @router.get("/api/v1/tasks", tags=["tasks"])
    async def list_tasks(
        request: Request, status: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        db = request.app.state.db
        state_manager = request.app.state.state_manager
        async with db.session() as session:
            tasks = await state_manager.list_tasks(session, status=status, limit=limit)
        return {"tasks": tasks}

    @router.post("/api/v1/tasks", tags=["tasks"])
    async def create_task(request: Request, req: TaskCreateReq) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        app_cfg: AppSettingsPayload = await load_settings_fn(db)

        conv_id = req.conversation_id
        if conv_id:
            async with db.session() as session:
                conv = await session.get(Conversation, conv_id)
                if conv is not None:
                    session.add(
                        Message(
                            id=f"msg_{uuid.uuid4().hex[:12]}",
                            conversation_id=conv_id,
                            role="user",
                            content=req.instruction.strip(),
                            attachments_json=req.attachments,
                        )
                    )

        task_dict = await orchestrator.create_and_plan_task(
            instruction=req.instruction,
            app_cfg=app_cfg,
            conversation_id=conv_id,
            workspace_id=req.workspace_id,
            provider_id=req.provider_id,
            model=req.model,
            auto_execute_read_only=req.auto_execute_read_only,
        )

        if conv_id:
            async with db.session() as session:
                session.add(
                    Message(
                        id=f"msg_{uuid.uuid4().hex[:12]}",
                        conversation_id=conv_id,
                        role="assistant",
                        content=task_dict.get("result_summary")
                        or f"Task {task_dict['id']} is now {task_dict['status']}.",
                        task_id=task_dict["id"],
                        attachments_json=[],
                    )
                )
        return {"task": task_dict}

    @router.get("/api/v1/tasks/{task_id}", tags=["tasks"])
    async def get_task(request: Request, task_id: str) -> dict[str, Any]:
        db = request.app.state.db
        state_manager = request.app.state.state_manager
        async with db.session() as session:
            task, steps = await state_manager.get_task_with_steps(session, task_id)
            return {"task": state_manager.serialize_task(task, steps)}

    @router.post("/api/v1/tasks/{task_id}/approve", tags=["tasks"])
    async def approve_task(request: Request, task_id: str, req: TaskApproveReq) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        task_dict = await orchestrator.approve_task(
            task_id,
            approve=req.approve,
            app_cfg=app_cfg,
            step_ids=req.step_ids,
            ttl_minutes=req.ttl_minutes,
        )
        return {"task": task_dict}

    @router.post("/api/v1/tasks/{task_id}/execute", tags=["tasks"])
    async def execute_task(request: Request, task_id: str) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        task_dict = await orchestrator.execute_task(task_id, app_cfg=app_cfg)
        return {"task": task_dict}

    @router.post("/api/v1/tasks/{task_id}/cancel", tags=["tasks"])
    async def cancel_task(request: Request, task_id: str) -> dict[str, Any]:
        orchestrator = request.app.state.orchestrator
        task_dict = await orchestrator.cancel_task(task_id)
        return {"task": task_dict}

    @router.post("/api/v1/tasks/{task_id}/retry", tags=["tasks"])
    async def retry_task(request: Request, task_id: str) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        task_dict = await orchestrator.retry_task(task_id, app_cfg=app_cfg)
        return {"task": task_dict}

    @router.post("/api/v1/tasks/{task_id}/rollback", tags=["tasks"])
    async def rollback_task(request: Request, task_id: str) -> dict[str, Any]:
        db = request.app.state.db
        state_manager = request.app.state.state_manager
        audit = request.app.state.audit
        async with db.session() as session:
            result: dict[str, Any] = await state_manager.rollback_task(session, task_id)
            await audit.record(
                session,
                category="file",
                action="task.rollback",
                actor="user",
                task_id=task_id,
                risk_level="MEDIUM",
                summary=f"Restored {result['restored_count']} recorded file operation(s).",
                details=result,
            )
        return result

    @router.get("/api/v1/tasks/{task_id}/report", tags=["tasks"])
    async def export_task_report(request: Request, task_id: str) -> dict[str, Any]:
        db = request.app.state.db
        state_manager = request.app.state.state_manager
        orchestrator = request.app.state.orchestrator
        async with db.session() as session:
            task, steps = await state_manager.get_task_with_steps(session, task_id)
            serialized = state_manager.serialize_task(task, steps)
        md = orchestrator.build_markdown_report(serialized)
        return {"filename": f"agentos-{task_id}-report.md", "markdown": md}

    @router.get("/api/v1/tasks/{task_id}/events", tags=["tasks"])
    async def stream_task_events(request: Request, task_id: str) -> StreamingResponse:
        state_manager = request.app.state.state_manager
        queue = state_manager.events.subscribe(task_id)

        async def _event_gen() -> AsyncIterator[str]:
            try:
                yield f"event: connected\ndata: {json.dumps({'task_id': task_id})}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        evt = await asyncio.wait_for(queue.get(), timeout=15.0)
                        yield f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\n\n"
                    except TimeoutError:
                        yield ": keepalive\n\n"
            finally:
                state_manager.events.unsubscribe(task_id, queue)

        return StreamingResponse(_event_gen(), media_type="text/event-stream")

    # Memory endpoints
    @router.get("/api/v1/memory", tags=["memory"])
    async def list_memory(
        request: Request,
        category: str | None = None,
        query: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        async with db.session() as session:
            entries = await memory.search(session, query=query, category=category, limit=limit)
        return {"entries": entries}

    @router.post("/api/v1/memory", tags=["memory"])
    async def create_memory(request: Request, req: MemoryCreateReq) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        async with db.session() as session:
            entry = await memory.create(
                session,
                category=req.category,
                title=req.title,
                content=req.content,
                tags=req.tags,
                pinned=req.pinned,
                retention_days=app_cfg.memory_retention_days,
                memory_enabled=app_cfg.memory_enabled,
            )
        return {"entry": entry}

    @router.patch("/api/v1/memory/{memory_id}", tags=["memory"])
    async def update_memory(
        request: Request, memory_id: str, req: MemoryUpdateReq
    ) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        async with db.session() as session:
            entry = await memory.update(
                session,
                memory_id,
                title=req.title,
                content=req.content,
                tags=req.tags,
                pinned=req.pinned,
            )
        return {"entry": entry}

    @router.delete("/api/v1/memory/{memory_id}", tags=["memory"])
    async def delete_memory(request: Request, memory_id: str) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        async with db.session() as session:
            await memory.delete_one(session, memory_id)
        return {"deleted": True}

    @router.delete("/api/v1/memory", tags=["memory"])
    async def clear_memory(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        audit = request.app.state.audit
        async with db.session() as session:
            count = await memory.clear_all(session)
            await audit.record(
                session,
                category="memory",
                action="memory.clear_all",
                actor="user",
                risk_level="MEDIUM",
                summary=f"Cleared {count} local memory record(s).",
            )
        return {"deleted_count": count}

    @router.get("/api/v1/memory/export", tags=["memory"])
    async def export_memory(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        memory = request.app.state.memory
        async with db.session() as session:
            result: dict[str, Any] = await memory.export_all(session)
            return result

    # Workflow endpoints
    @router.get("/api/v1/workflows", tags=["workflows"])
    async def list_workflows(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        async with db.session() as session:
            return {"workflows": await workflows.list_workflows(session)}

    @router.post("/api/v1/workflows", tags=["workflows"])
    async def create_workflow(request: Request, req: WorkflowCreateReq) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        async with db.session() as session:
            wf = await workflows.create_workflow(session, req.model_dump())
        return {"workflow": wf}

    @router.patch("/api/v1/workflows/{workflow_id}", tags=["workflows"])
    async def update_workflow(
        request: Request, workflow_id: str, req: WorkflowUpdateReq
    ) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        async with db.session() as session:
            wf = await workflows.update_workflow(
                session, workflow_id, req.model_dump(exclude_none=True)
            )
        return {"workflow": wf}

    @router.delete("/api/v1/workflows/{workflow_id}", tags=["workflows"])
    async def delete_workflow(request: Request, workflow_id: str) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        async with db.session() as session:
            await workflows.delete_workflow(session, workflow_id)
        return {"deleted": True}

    @router.post("/api/v1/workflows/{workflow_id}/run", tags=["workflows"])
    async def run_workflow(request: Request, workflow_id: str) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        result: dict[str, Any] = await workflows.run_workflow(
            workflow_id, app_cfg=app_cfg, trigger="manual"
        )
        return result

    @router.get("/api/v1/workflow-runs", tags=["workflows"])
    async def list_workflow_runs(
        request: Request, workflow_id: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        db = request.app.state.db
        workflows = request.app.state.workflows
        async with db.session() as session:
            return {
                "runs": await workflows.list_runs(session, workflow_id=workflow_id, limit=limit)
            }

    # MCP endpoints
    @router.get("/api/v1/mcp/servers", tags=["mcp"])
    async def list_mcp_servers(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        mcp_manager = request.app.state.mcp
        async with db.session() as session:
            return {"servers": await mcp_manager.list_servers(session)}

    @router.post("/api/v1/mcp/servers", tags=["mcp"])
    async def create_mcp_server(request: Request, req: McpServerCreateReq) -> dict[str, Any]:
        db = request.app.state.db
        mcp_manager = request.app.state.mcp
        audit = request.app.state.audit
        async with db.session() as session:
            server = await mcp_manager.create_server(
                session,
                name=req.name,
                transport=req.transport,
                command=req.command,
                url=req.url,
                enabled=req.enabled,
            )
            await audit.record(
                session,
                category="mcp",
                action="mcp.server.add",
                actor="user",
                risk_level="HIGH",
                summary=f"Registered external MCP server '{req.name}' ({req.transport}); tools untrusted by default.",
            )
        return {"server": server}

    @router.delete("/api/v1/mcp/servers/{server_id}", tags=["mcp"])
    async def delete_mcp_server(request: Request, server_id: str) -> dict[str, Any]:
        db = request.app.state.db
        mcp_manager = request.app.state.mcp
        async with db.session() as session:
            await mcp_manager.delete_server(session, server_id)
        return {"deleted": True}

    @router.post("/api/v1/mcp/servers/{server_id}/test", tags=["mcp"])
    async def test_mcp_server(request: Request, server_id: str) -> dict[str, Any]:
        db = request.app.state.db
        mcp_manager = request.app.state.mcp
        async with db.session() as session:
            result: dict[str, Any] = await mcp_manager.test_and_discover(session, server_id)
            return result

    @router.put("/api/v1/mcp/servers/{server_id}/authorize", tags=["mcp"])
    async def authorize_mcp_tools(
        request: Request, server_id: str, req: McpAuthorizeReq
    ) -> dict[str, Any]:
        db = request.app.state.db
        mcp_manager = request.app.state.mcp
        audit = request.app.state.audit
        async with db.session() as session:
            server = await mcp_manager.authorize_tools(session, server_id, req.allowed_tools)
            await audit.record(
                session,
                category="mcp",
                action="mcp.tools.authorize",
                actor="user",
                risk_level="HIGH",
                summary=f"Authorized {len(req.allowed_tools)} tool(s) for MCP server '{server['name']}'.",
                details={"server_id": server_id, "allowed_tools": req.allowed_tools},
            )
        return {"server": server}

    # Computer use capabilities & emergency stop
    @router.get("/api/v1/computer-use/capabilities", tags=["computer_use"])
    async def computer_use_capabilities(request: Request) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        app_cfg: AppSettingsPayload = await load_settings_fn(db)
        return inspect_computer_use_capabilities(
            app_cfg, emergency_stop_active=orchestrator.emergency_stop_active
        )

    @router.post("/api/v1/computer-use/emergency-stop", tags=["computer_use"])
    async def emergency_stop(request: Request, req: EmergencyStopReq) -> dict[str, Any]:
        db = request.app.state.db
        orchestrator = request.app.state.orchestrator
        audit = request.app.state.audit
        cancelled = orchestrator.set_emergency_stop(req.active)
        async with db.session() as session:
            await audit.record(
                session,
                category="security",
                action="emergency_stop.toggle",
                actor="user",
                risk_level="HIGH",
                summary=(
                    f"Emergency stop activated ({cancelled} active task signal(s) cancelled)."
                    if req.active
                    else "Emergency stop cleared by user."
                ),
            )
        return {"emergency_stop_active": req.active, "cancelled_tasks": cancelled}

    return router
