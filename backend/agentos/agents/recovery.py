from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from agentos.errors import OperationTimeoutError, ProviderUnavailableError, ToolExecutionError
from agentos.tools.base import BaseTool

T = TypeVar("T")


class RecoveryManager:
    """Attempts bounded safe retries ONLY for transient failures on non-side-effect operations."""

    async def run_with_safe_recovery(
        self,
        tool: BaseTool,
        action: Callable[[], Awaitable[T]],
        *,
        max_retries: int,
        cancel_event: asyncio.Event | None = None,
    ) -> tuple[T, int]:
        # Never blindly retry external or mutating side effects.
        allowed_retries = 0 if tool.has_side_effects else max(0, min(max_retries, 3))
        attempts = 0

        while True:
            attempts += 1
            try:
                result = await action()
                return result, attempts
            except (OperationTimeoutError, ProviderUnavailableError, ToolExecutionError) as exc:
                if not exc.recoverable or attempts > allowed_retries:
                    raise
                delay = min(4.0, 0.4 * (2 ** (attempts - 1)))
                if cancel_event is not None:
                    try:
                        await asyncio.wait_for(cancel_event.wait(), timeout=delay)
                        raise asyncio.CancelledError("Task cancelled during recovery backoff.")
                    except TimeoutError:
                        pass
                else:
                    await asyncio.sleep(delay)
