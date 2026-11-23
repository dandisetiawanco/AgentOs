from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agentos.errors import ProviderUnavailableError
from agentos.providers.anthropic_provider import AnthropicProvider
from agentos.providers.base import BaseAIProvider, ConnectionTestResult, ModelInfo
from agentos.providers.gemini import GeminiProvider
from agentos.providers.mock_provider import DeterministicMockProvider
from agentos.providers.ollama_provider import OllamaProvider
from agentos.providers.openai_provider import OpenAICompatibleProvider, OpenAIProvider
from agentos.security.keychain import CredentialStore
from agentos.storage.models import ProviderConfig

PROVIDER_CLASSES: dict[str, type[BaseAIProvider]] = {
    "mock": DeterministicMockProvider,
    "gemini": GeminiProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "ollama": OllamaProvider,
    "openai_compatible": OpenAICompatibleProvider,
}


class ProviderManager:
    """Resolves configured AI providers, injects Keychain secrets, and exposes capability metadata."""

    def __init__(self, credential_store: CredentialStore) -> None:
        self.credentials = credential_store

    def secret_key_name(self, provider_id: str) -> str:
        return f"provider:{provider_id}:api_key"

    async def list_provider_statuses(self, session: AsyncSession) -> list[dict[str, Any]]:
        rows = (
            (await session.execute(select(ProviderConfig).order_by(ProviderConfig.id)))
            .scalars()
            .all()
        )
        result: list[dict[str, Any]] = []
        for row in rows:
            cls = PROVIDER_CLASSES.get(row.id)
            if cls is None:
                continue
            caps = cls.capabilities
            has_key = self.credentials.has_secret(self.secret_key_name(row.id))
            hint = self.credentials.masked_hint(self.secret_key_name(row.id))
            ready = row.enabled and (not caps.requires_api_key or has_key)
            result.append(
                {
                    "id": row.id,
                    "display_name": row.display_name,
                    "enabled": row.enabled,
                    "base_url": row.base_url,
                    "default_model": row.default_model,
                    "timeout_sec": row.timeout_sec,
                    "max_retries": row.max_retries,
                    "has_api_key": has_key,
                    "api_key_hint": hint,
                    "ready": ready,
                    "capabilities": {
                        "supports_tools": caps.supports_tools,
                        "supports_streaming": caps.supports_streaming,
                        "supports_structured_output": caps.supports_structured_output,
                        "supports_vision": caps.supports_vision,
                        "requires_api_key": caps.requires_api_key,
                        "is_local": caps.is_local,
                        "is_mock": caps.is_mock,
                        "max_context_tokens": caps.max_context_tokens,
                    },
                }
            )
        return result

    async def get_provider(self, session: AsyncSession, provider_id: str) -> BaseAIProvider:
        row = await session.get(ProviderConfig, provider_id)
        if row is None or provider_id not in PROVIDER_CLASSES:
            raise ProviderUnavailableError(f"Unknown provider '{provider_id}'.")
        if not row.enabled:
            raise ProviderUnavailableError(
                f"Provider '{row.display_name}' is disabled. Enable it in Settings -> AI Providers."
            )
        cls = PROVIDER_CLASSES[provider_id]
        api_key = self.credentials.get_secret(self.secret_key_name(provider_id))
        return cls(
            api_key=api_key,
            base_url=row.base_url,
            default_model=row.default_model,
            timeout_sec=row.timeout_sec,
            max_retries=row.max_retries,
        )

    async def test_provider(self, session: AsyncSession, provider_id: str) -> ConnectionTestResult:
        provider = await self.get_provider(session, provider_id)
        return await provider.test_connection()

    async def discover_models(self, session: AsyncSession, provider_id: str) -> list[ModelInfo]:
        provider = await self.get_provider(session, provider_id)
        return await provider.list_models()
