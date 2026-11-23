from __future__ import annotations

import asyncio
import json
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


class OpenAIProvider(BaseAIProvider):
    provider_id = "openai"
    display_name = "OpenAI API"
    capabilities = ProviderCapabilities(
        supports_tools=True,
        supports_streaming=True,
        supports_structured_output=True,
        supports_vision=True,
        requires_api_key=True,
        is_local=False,
        is_mock=False,
        max_context_tokens=128_000,
    )

    DEFAULT_MODELS = [
        ModelInfo("gpt-4o-mini", "GPT-4o Mini", 128_000, 0.15, 0.60),
        ModelInfo("gpt-4o", "GPT-4o", 128_000, 2.50, 10.00),
        ModelInfo("gpt-4.1-mini", "GPT-4.1 Mini", 1_000_000, 0.40, 1.60),
        ModelInfo("gpt-4.1", "GPT-4.1", 1_000_000, 2.00, 8.00),
    ]

    def _base(self) -> str:
        return self.base_url or "https://api.openai.com/v1"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.capabilities.requires_api_key and not self.api_key:
            raise InvalidCredentialsError(
                f"{self.display_name} API key is not configured. Add your key in Settings -> AI Providers."
            )
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def list_models(self) -> list[ModelInfo]:
        if self.capabilities.requires_api_key and not self.api_key:
            return list(self.DEFAULT_MODELS)
        response = await self._request_with_retry(
            "GET",
            f"{self._base()}/models",
            headers=self._headers(),
        )
        payload = response.json()
        models: list[ModelInfo] = []
        for item in payload.get("data", []):
            mid = str(item.get("id", ""))
            if not mid:
                continue
            models.append(ModelInfo(id=mid, name=mid))
        models.sort(key=lambda m: m.id)
        return models or list(self.DEFAULT_MODELS)

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        models = await self.list_models()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ConnectionTestResult(
            ok=True,
            provider_id=self.provider_id,
            latency_ms=latency_ms,
            message=f"Connected to {self.display_name} ({len(models)} models listed).",
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
        target_model = model or self.default_model or "gpt-4o-mini"
        trimmed = trim_messages_to_context_window(messages, self.capabilities.max_context_tokens)
        body: dict[str, Any] = {
            "model": target_model,
            "messages": [{"role": m.role, "content": m.content} for m in trimmed],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
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
            f"{self._base()}/chat/completions",
            headers=self._headers(),
            json_body=body,
            cancel_event=cancel_event,
        )
        data = response.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {})
        content = str(msg.get("content") or "")
        tool_calls: list[ToolCallRequest] = []
        for idx, tc in enumerate(msg.get("tool_calls") or []):
            fn = tc.get("function", {})
            raw_args = fn.get("arguments", "{}")
            try:
                parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
            except json.JSONDecodeError:
                parsed_args = {}
            tool_calls.append(
                ToolCallRequest(
                    id=str(tc.get("id") or f"openai-call-{idx}"),
                    name=str(fn.get("name") or ""),
                    arguments=parsed_args if isinstance(parsed_args, dict) else {},
                )
            )
        usage_raw = data.get("usage", {})
        in_tok = int(usage_raw.get("prompt_tokens", 0))
        out_tok = int(usage_raw.get("completion_tokens", 0))
        tot_tok = int(usage_raw.get("total_tokens", in_tok + out_tok))
        usage = TokenUsage(
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=tot_tok,
            estimated_cost_usd=estimate_cost_usd(
                target_model, in_tok, out_tok, is_local=self.capabilities.is_local
            ),
        )
        return ProviderResponse(
            content=content,
            model=target_model,
            provider_id=self.provider_id,
            tool_calls=tool_calls,
            usage=usage,
            finish_reason=str(choice.get("finish_reason") or "stop"),
        )


class OpenAICompatibleProvider(OpenAIProvider):
    provider_id = "openai_compatible"
    display_name = "OpenAI-Compatible Endpoint"
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
    DEFAULT_MODELS = [ModelInfo("local-model", "Custom Endpoint Model", 32_768, None, None)]

    def _base(self) -> str:
        return self.base_url or "http://127.0.0.1:8080/v1"
