from __future__ import annotations

import asyncio
import time
from typing import Any

from agentos.errors import InvalidCredentialsError
from agentos.providers.base import (
    BaseAIProvider,
    ChatMessage,
    ConnectionTestResult,
    ModelInfo,
    ProviderCapabilities,
    ProviderResponse,
    TokenUsage,
    ToolCallRequest,
    estimate_cost_usd,
    trim_messages_to_context_window,
)


class AnthropicProvider(BaseAIProvider):
    provider_id = "anthropic"
    display_name = "Anthropic API"
    capabilities = ProviderCapabilities(
        supports_tools=True,
        supports_streaming=True,
        supports_structured_output=True,
        supports_vision=True,
        requires_api_key=True,
        is_local=False,
        is_mock=False,
        max_context_tokens=200_000,
    )

    DEFAULT_MODELS = [
        ModelInfo("claude-3-5-haiku-latest", "Claude 3.5 Haiku", 200_000, 0.80, 4.00),
        ModelInfo("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet", 200_000, 3.00, 15.00),
        ModelInfo("claude-sonnet-4-20250514", "Claude Sonnet 4", 200_000, 3.00, 15.00),
    ]

    def _base(self) -> str:
        return self.base_url or "https://api.anthropic.com/v1"

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise InvalidCredentialsError(
                "Anthropic API key is not configured. Add your key in Settings -> AI Providers."
            )
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    async def list_models(self) -> list[ModelInfo]:
        if not self.api_key:
            return list(self.DEFAULT_MODELS)
        response = await self._request_with_retry(
            "GET",
            f"{self._base()}/models",
            headers=self._headers(),
        )
        payload = response.json()
        models = [
            ModelInfo(
                id=str(item.get("id", "")),
                name=str(item.get("display_name") or item.get("id", "")),
                context_window=200_000,
            )
            for item in payload.get("data", [])
            if item.get("id")
        ]
        return models or list(self.DEFAULT_MODELS)

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        models = await self.list_models()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ConnectionTestResult(
            ok=True,
            provider_id=self.provider_id,
            latency_ms=latency_ms,
            message=f"Connected to Anthropic API ({len(models)} models listed).",
            discovered_models=[m.id for m in models[:25]],
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
        target_model = model or self.default_model or "claude-3-5-haiku-latest"
        trimmed = trim_messages_to_context_window(messages, self.capabilities.max_context_tokens)
        system_blocks = [m.content for m in trimmed if m.role == "system"]
        convo = [
            {"role": "assistant" if m.role == "assistant" else "user", "content": m.content}
            for m in trimmed
            if m.role != "system"
        ]
        if json_mode:
            system_blocks.append(
                "Respond with a valid JSON object only. Do not add markdown fences."
            )

        body: dict[str, Any] = {
            "model": target_model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": convo or [{"role": "user", "content": ""}],
        }
        if system_blocks:
            body["system"] = "\n\n".join(system_blocks)
        if tools:
            body["tools"] = [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "input_schema": t.get("input_schema", {"type": "object", "properties": {}}),
                }
                for t in tools
            ]

        response = await self._request_with_retry(
            "POST",
            f"{self._base()}/messages",
            headers=self._headers(),
            json_body=body,
            cancel_event=cancel_event,
        )
        data = response.json()
        text_parts: list[str] = []
        tool_calls: list[ToolCallRequest] = []
        for block in data.get("content", []):
            btype = block.get("type")
            if btype == "text":
                text_parts.append(str(block.get("text", "")))
            elif btype == "tool_use":
                tool_calls.append(
                    ToolCallRequest(
                        id=str(block.get("id", "anthropic-tool")),
                        name=str(block.get("name", "")),
                        arguments=dict(block.get("input") or {}),
                    )
                )

        usage_raw = data.get("usage", {})
        in_tok = int(usage_raw.get("input_tokens", 0))
        out_tok = int(usage_raw.get("output_tokens", 0))
        usage = TokenUsage(
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=in_tok + out_tok,
            estimated_cost_usd=estimate_cost_usd(target_model, in_tok, out_tok),
        )
        return ProviderResponse(
            content="\n".join(text_parts).strip(),
            model=target_model,
            provider_id=self.provider_id,
            tool_calls=tool_calls,
            usage=usage,
            finish_reason=str(data.get("stop_reason") or "stop"),
        )
