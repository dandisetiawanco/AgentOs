from __future__ import annotations

import re
from typing import Any

from agentos.permissions.engine import detect_prompt_injection_signals


class IntentAnalyzer:
    """Classifies user instructions into structured operational intents and security signals."""

    def analyze(self, instruction: str, workspace_path: str | None = None) -> dict[str, Any]:
        text = instruction.strip()
        lower = text.lower()
        injection_signals = detect_prompt_injection_signals(text)

        category = "general"
        if any(
            k in lower
            for k in ("pdf", "docx", "csv", "xlsx", "report", "document", "summarize", "compare")
        ):
            category = "document_intelligence"
        elif re.search(r"https?://", text) or any(
            k in lower for k in ("website", "webpage", "browser", "screenshot", "url")
        ):
            category = "browser_intelligence"
        elif any(k in lower for k in ("terminal", "command", "shell", "git status")):
            category = "terminal_intelligence"
        elif any(
            k in lower
            for k in (
                "cpu",
                "memory",
                "disk",
                "process",
                "system health",
                "diagnostics",
                "large file",
            )
        ):
            category = "system_intelligence"
        elif any(
            k in lower
            for k in (
                "file",
                "folder",
                "workspace",
                "duplicate",
                "rename",
                "move",
                "copy",
                "organize",
            )
        ):
            category = "file_intelligence"
        elif any(k in lower for k in ("open app", "window", "screen capture")):
            category = "computer_use"

        requires_workspace = category in (
            "file_intelligence",
            "document_intelligence",
            "terminal_intelligence",
        )
        return {
            "category": category,
            "goal": text[:200],
            "requires_workspace": requires_workspace,
            "has_workspace": bool(workspace_path),
            "injection_signals": injection_signals,
        }
