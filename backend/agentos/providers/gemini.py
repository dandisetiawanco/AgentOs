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


class GeminiProvider(BaseAIProvider):
    provider_id = "gemini"
    display_name = "Google Gemini API"
    capabilities = ProviderCapabilities(
        supports_tools=True,
        supports_streaming=True,
        supports_structured_output=True,
        supports_vision=True,
        requires_api_key=True,
        is_local=False,
        is_mock=False,
        max_context_tokens=1_000_000,
    )

    DEFAULT_MODELS = [
        ModelInfo("gemini-2.5-flash", "Gemini 2.5 Flash", 1_000_000, 0.15, 0.60),
        ModelInfo("gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000, 1.25, 10.00),
        ModelInfo("gemini-2.0-flash", "Gemini 2.0 Flash", 1_000_000, 0.10, 0.40),
    ]

    def _base(self) -> str:
        return self.base_url or "https://generativelanguage.googleapis.com/v1beta"

    def _require_key(self) -> str:
        if not self.api_key:
            raise InvalidCredentialsError(
                "Google Gemini API key is not configured. Add your key in Settings -> AI Providers."
            )
        return self.api_key

    async def list_models(self) -> list[ModelInfo]:
        if not self.api_key:
            return list(self.DEFAULT_MODELS)
        response = await self._request_with_retry(
            "GET",
            f"{self._base()}/models",
            headers={"x-goog-api-key": self._require_key()},
        )
        payload = response.json()
        models: list[ModelInfo] = []
        for item in payload.get("models", []):
            methods = item.get("supportedGenerationMethods", [])
            if "generateContent" not in methods:
                continue
            raw_name = str(item.get("name", ""))
            model_id = raw_name.removeprefix("models/")
            if not model_id:
                continue
            models.append(
                ModelInfo(
                    id=model_id,
                    name=str(item.get("displayName") or model_id),
                    context_window=item.get("inputTokenLimit"),
                )
            )
        return models or list(self.DEFAULT_MODELS)

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        self._require_key()
        models = await self.list_models()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ConnectionTestResult(
            ok=True,
            provider_id=self.provider_id,
            latency_ms=latency_ms,
            message=f"Connected to Google Gemini API ({len(models)} models available).",
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
        key = self._require_key()
        target_model = model or self.default_model or "gemini-2.5-flash"
        trimmed = trim_messages_to_context_window(messages, self.capabilities.max_context_tokens)

        system_parts: list[dict[str, str]] = []
        contents: list[dict[str, Any]] = []
        for msg in trimmed:
            if msg.role == "system":
                system_parts.append({"text": msg.content})
            else:
                role = "model" if msg.role == "assistant" else "user"
                contents.append({"role": role, "parts": [{"text": msg.content}]})

        body: dict[str, Any] = {
            "contents": contents or [{"role": "user", "parts": [{"text": ""}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        if system_parts:
            body["systemInstruction"] = {"parts": system_parts}
        if tools:
            declarations = [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                }
                for t in tools
            ]
            body["tools"] = [{"functionDeclarations": declarations}]

        response = await self._request_with_retry(
            "POST",
            f"{self._base()}/models/{target_model}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json_body=body,
            cancel_event=cancel_event,
        )
        data = response.json()
        candidates = data.get("candidates", [])
        text_chunks: list[str] = []
        tool_calls: list[ToolCallRequest] = []
        finish_reason = "stop"

        if candidates:
            candidate = candidates[0]
            finish_reason = str(candidate.get("finishReason", "STOP")).lower()
            parts = candidate.get("content", {}).get("parts", [])
            for idx, part in enumerate(parts):
                if "text" in part:
                    text_chunks.append(str(part["text"]))
                elif "functionCall" in part:
                    fn = part["functionCall"]
                    tool_calls.append(
                        ToolCallRequest(
                            id=f"gemini-call-{idx}",
                            name=str(fn.get("name", "")),
                            arguments=dict(fn.get("args", {})),
                        )
                    )

        usage_meta = data.get("usageMetadata", {})
        in_tok = int(usage_meta.get("promptTokenCount", 0))
        out_tok = int(usage_meta.get("candidatesTokenCount", 0))
        tot_tok = int(usage_meta.get("totalTokenCount", in_tok + out_tok))
        usage = TokenUsage(
            input_tokens=in_tok,
            output_tokens=out_tok,
            total_tokens=tot_tok,
            estimated_cost_usd=estimate_cost_usd(target_model, in_tok, out_tok),
        )
        return ProviderResponse(
            content="\n".join(text_chunks).strip(),
            model=target_model,
            provider_id=self.provider_id,
            tool_calls=tool_calls,
            usage=usage,
            finish_reason=finish_reason,
        )
