from __future__ import annotations

import asyncio
import time
from typing import Any

from agentos.errors import ProviderUnavailableError
from agentos.providers.base import (
    BaseAIProvider,
    ChatMessage,
    ConnectionTestResult,
    ModelInfo,
    ProviderCapabilities,
    ProviderResponse,
    TokenUsage,
    ToolCallRequest,
    trim_messages_to_context_window,
)


class OllamaProvider(BaseAIProvider):
    provider_id = "ollama"
    display_name = "Ollama Local Models"
    capabilities = ProviderCapabilities(
        supports_tools=True,
        supports_streaming=True,
        supports_structured_output=True,
        supports_vision=False,
        requires_api_key=False,
        is_local=True,
        is_mock=False,
        max_context_tokens=32_768,
    )

    def _base(self) -> str:
        return self.base_url or "http://127.0.0.1:11434"

    async def list_models(self) -> list[ModelInfo]:
        try:
            response = await self._request_with_retry("GET", f"{self._base()}/api/tags")
        except ProviderUnavailableError as exc:
            raise ProviderUnavailableError(
                f"Ollama is not reachable at {self._base()}. Start Ollama locally or select another provider.",
                details={"provider_id": self.provider_id, "base_url": self._base()},
            ) from exc
        payload = response.json()
        return [
            ModelInfo(
                id=str(item.get("name", "")),
                name=str(item.get("name", "")),
                input_cost_per_1m_usd=0.0,
                output_cost_per_1m_usd=0.0,
            )
            for item in payload.get("models", [])
            if item.get("name")
        ]

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        models = await self.list_models()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ConnectionTestResult(
            ok=True,
            provider_id=self.provider_id,
            latency_ms=latency_ms,
            message=f"Connected to local Ollama ({len(models)} installed models).",
            discovered_models=[m.id for m in models],
        )

    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        json_mode: bool = False,
        temperature: float = 0.1,
        max_tokens: int = 2048,
        cancel_event: asyncio.Event | None = None,
    ) -> ProviderResponse:
        target_model = model or self.default_model or "llama3.2"
        trimmed = trim_messages_to_context_window(messages, self.capabilities.max_context_tokens)
        body: dict[str, Any] = {
            "model": target_model,
            "messages": [{"role": m.role, "content": m.content} for m in trimmed],
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if json_mode:
            body["format"] = "json"
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                    },
                }
                for t in tools
            ]

        response = await self._request_with_retry(
            "POST",
            f"{self._base()}/api/chat",
            json_body=body,
            cancel_event=cancel_event,
        )
        data = response.json()
        msg = data.get("message", {})
        tool_calls: list[ToolCallRequest] = []
        for idx, tc in enumerate(msg.get("tool_calls") or []):
            fn = tc.get("function", {})
            tool_calls.append(
                ToolCallRequest(
                    id=f"ollama-call-{idx}",
                    name=str(fn.get("name", "")),
                    arguments=dict(fn.get("arguments") or {}),
                )
            )
        in_tok = int(data.get("prompt_eval_count", 0))
        out_tok = int(data.get("eval_count", 0))
        return ProviderResponse(
            content=str(msg.get("content") or ""),
            model=target_model,
            provider_id=self.provider_id,
            tool_calls=tool_calls,
            usage=TokenUsage(
                input_tokens=in_tok,
                output_tokens=out_tok,
                total_tokens=in_tok + out_tok,
                estimated_cost_usd=0.0,
            ),
            finish_reason="stop",
        )
