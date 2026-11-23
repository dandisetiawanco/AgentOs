from __future__ import annotations

import asyncio
import json
import random
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from agentos.errors import (
    InvalidCredentialsError,
    OperationTimeoutError,
    ProviderRateLimitError,
    ProviderUnavailableError,
    TaskCancelledError,
)


@dataclass(frozen=True)
class ProviderCapabilities:
    supports_tools: bool = True
    supports_streaming: bool = True
    supports_structured_output: bool = True
    supports_vision: bool = False
    requires_api_key: bool = True
    is_local: bool = False
    is_mock: bool = False
    max_context_tokens: int = 128000


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    context_window: int | None = None
    input_cost_per_1m_usd: float | None = None
    output_cost_per_1m_usd: float | None = None


@dataclass
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float | None = None

    def add(self, other: TokenUsage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.total_tokens += other.total_tokens
        if other.estimated_cost_usd is not None:
            self.estimated_cost_usd = (self.estimated_cost_usd or 0.0) + other.estimated_cost_usd

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "estimated_cost_usd": round(self.estimated_cost_usd, 6)
            if self.estimated_cost_usd is not None
            else None,
        }


@dataclass
class ChatMessage:
    role: str  # system | user | assistant | tool
    content: str
    tool_call_id: str | None = None
    name: str | None = None


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ProviderResponse:
    content: str
    model: str
    provider_id: str
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: str = "stop"
    raw_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StreamChunk:
    delta: str
    done: bool = False
    usage: TokenUsage | None = None


@dataclass
class ConnectionTestResult:
    ok: bool
    provider_id: str
    latency_ms: int
    message: str
    discovered_models: list[str] = field(default_factory=list)


# Known published list pricing (USD per 1M tokens) as of reference release; None when unknown.
KNOWN_PRICING_PER_1M: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash": (0.15, 0.60),
    "gemini-2.5-pro": (1.25, 10.00),
    "gemini-2.0-flash": (0.10, 0.40),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "claude-3-5-haiku-latest": (0.80, 4.00),
    "claude-3-7-sonnet-latest": (3.00, 15.00),
    "claude-sonnet-4-20250514": (3.00, 15.00),
}


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // 4)


def estimate_cost_usd(
    model: str, input_tokens: int, output_tokens: int, *, is_local: bool = False
) -> float | None:
    if is_local:
        return 0.0
    pricing = KNOWN_PRICING_PER_1M.get(model)
    if pricing is None:
        return None
    in_rate, out_rate = pricing
    return round((input_tokens / 1_000_000) * in_rate + (output_tokens / 1_000_000) * out_rate, 6)


def trim_messages_to_context_window(
    messages: list[ChatMessage],
    max_input_tokens: int,
) -> list[ChatMessage]:
    """Preserves system instructions and most recent turns within the model's context budget."""
    if not messages:
        return []
    system_msgs = [m for m in messages if m.role == "system"]
    non_system = [m for m in messages if m.role != "system"]
    budget = max(512, max_input_tokens)
    used = sum(estimate_tokens(m.content) for m in system_msgs)
    kept_reversed: list[ChatMessage] = []
    for msg in reversed(non_system):
        tokens = estimate_tokens(msg.content)
        if kept_reversed and used + tokens > budget:
            break
        kept_reversed.append(msg)
        used += tokens
    kept_reversed.reverse()
    return system_msgs + kept_reversed


class BaseAIProvider(ABC):
    provider_id: str
    display_name: str
    capabilities: ProviderCapabilities

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str = "",
        timeout_sec: int = 60,
        max_retries: int = 2,
    ) -> None:
        self.api_key = api_key
        self.base_url = (base_url or "").rstrip("/")
        self.default_model = default_model
        self.timeout_sec = max(5, timeout_sec)
        self.max_retries = max(0, min(5, max_retries))

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]: ...

    @abstractmethod
    async def test_connection(self) -> ConnectionTestResult: ...

    @abstractmethod
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
    ) -> ProviderResponse: ...

    async def stream(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float = 0.1,
        max_tokens: int = 2048,
        cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[StreamChunk]:
        response = await self.complete(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            cancel_event=cancel_event,
        )
        yield StreamChunk(delta=response.content, done=True, usage=response.usage)

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        cancel_event: asyncio.Event | None = None,
    ) -> httpx.Response:
        attempt = 0
        last_error: Exception | None = None
        timeout = httpx.Timeout(self.timeout_sec, connect=min(15.0, float(self.timeout_sec)))

        async with httpx.AsyncClient(timeout=timeout) as client:
            while attempt <= self.max_retries:
                if cancel_event is not None and cancel_event.is_set():
                    raise TaskCancelledError("AI provider request was cancelled.")
                try:
                    response = await client.request(
                        method,
                        url,
                        headers=headers,
                        params=params,
                        json=json_body,
                    )
                except httpx.TimeoutException as exc:
                    last_error = OperationTimeoutError(
                        f"Provider '{self.display_name}' timed out after {self.timeout_sec}s."
                    )
                    if attempt >= self.max_retries:
                        raise last_error from exc
                except httpx.ConnectError as exc:
                    last_error = ProviderUnavailableError(
                        f"Could not connect to {self.display_name}. Check your network or endpoint URL.",
                        details={"provider_id": self.provider_id},
                    )
                    if attempt >= self.max_retries:
                        raise last_error from exc
                except httpx.HTTPError as exc:
                    last_error = ProviderUnavailableError(
                        f"HTTP transport error talking to {self.display_name}: {exc}",
                        details={"provider_id": self.provider_id},
                    )
                    if attempt >= self.max_retries:
                        raise last_error from exc
                else:
                    if response.status_code in (401, 403):
                        raise InvalidCredentialsError(
                            f"Authentication failed for {self.display_name}. Verify your API key in Settings.",
                            details={
                                "provider_id": self.provider_id,
                                "status_code": response.status_code,
                            },
                        )
                    if response.status_code == 429:
                        retry_after = response.headers.get("retry-after")
                        delay = (
                            float(retry_after)
                            if retry_after and retry_after.isdigit()
                            else (2.0**attempt)
                        )
                        last_error = ProviderRateLimitError(
                            f"{self.display_name} rate limit reached. Wait a moment or reduce concurrency.",
                            details={"provider_id": self.provider_id, "retry_after": retry_after},
                        )
                        if attempt >= self.max_retries:
                            raise last_error
                        await self._sleep_cancellable(min(delay, 10.0), cancel_event)
                        attempt += 1
                        continue
                    if response.status_code >= 500:
                        last_error = ProviderUnavailableError(
                            f"{self.display_name} returned server error {response.status_code}.",
                            details={
                                "provider_id": self.provider_id,
                                "status_code": response.status_code,
                            },
                        )
                        if attempt >= self.max_retries:
                            raise last_error
                    elif response.status_code >= 400:
                        snippet = response.text[:300]
                        raise ProviderUnavailableError(
                            f"{self.display_name} rejected the request (HTTP {response.status_code}): {snippet}",
                            details={
                                "provider_id": self.provider_id,
                                "status_code": response.status_code,
                            },
                        )
                    else:
                        return response

                backoff = min(8.0, (0.75 * (2**attempt)) + random.uniform(0.05, 0.3))  # noqa: S311
                await self._sleep_cancellable(backoff, cancel_event)
                attempt += 1

        if last_error is not None:
            raise last_error
        raise ProviderUnavailableError(f"{self.display_name} request failed.")

    @staticmethod
    async def _sleep_cancellable(seconds: float, cancel_event: asyncio.Event | None) -> None:
        if cancel_event is None:
            await asyncio.sleep(seconds)
            return
        try:
            await asyncio.wait_for(cancel_event.wait(), timeout=seconds)
            raise TaskCancelledError("AI provider retry cancelled.")
        except TimeoutError:
            return


def safe_parse_json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        parsed = json.loads(stripped)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(stripped[start : end + 1])
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
        return None
