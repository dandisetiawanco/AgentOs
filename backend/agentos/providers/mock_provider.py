from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

from agentos.providers.base import (
    BaseAIProvider,
    ChatMessage,
    ConnectionTestResult,
    ModelInfo,
    ProviderCapabilities,
    ProviderResponse,
    TokenUsage,
    estimate_tokens,
)


class DeterministicMockProvider(BaseAIProvider):
    """Explicitly labeled deterministic provider for automated tests and offline demos only."""

    provider_id = "mock"
    display_name = "Offline Deterministic Test Mode"
    capabilities = ProviderCapabilities(
        supports_tools=True,
        supports_streaming=True,
        supports_structured_output=True,
        supports_vision=False,
        requires_api_key=False,
        is_local=True,
        is_mock=True,
        max_context_tokens=32_768,
    )

    MODELS = [
        ModelInfo(
            id="mock-deterministic-v1",
            name="Deterministic Offline Planner (Test / Demo)",
            context_window=32_768,
            input_cost_per_1m_usd=0.0,
            output_cost_per_1m_usd=0.0,
        )
    ]

    async def list_models(self) -> list[ModelInfo]:
        return list(self.MODELS)

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        latency_ms = int((time.perf_counter() - started) * 1000)
        return ConnectionTestResult(
            ok=True,
            provider_id=self.provider_id,
            latency_ms=latency_ms,
            message="Offline deterministic test mode active. No external API calls are made.",
            discovered_models=[m.id for m in self.MODELS],
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
        if cancel_event is not None and cancel_event.is_set():
            raise asyncio.CancelledError("Mock provider cancelled.")

        user_prompt = ""
        for msg in reversed(messages):
            if msg.role == "user":
                user_prompt = msg.content
                break

        in_tokens = sum(estimate_tokens(m.content) for m in messages)

        if json_mode:
            payload = self._build_deterministic_json(user_prompt)
            content = json.dumps(payload, indent=2)
        else:
            content = (
                "[Offline Deterministic Test Mode] Prepared verified execution report for instruction: "
                f"{user_prompt[:240]}"
            )

        out_tokens = estimate_tokens(content)
        return ProviderResponse(
            content=content,
            model=model or self.default_model or "mock-deterministic-v1",
            provider_id=self.provider_id,
            usage=TokenUsage(
                input_tokens=in_tokens,
                output_tokens=out_tokens,
                total_tokens=in_tokens + out_tokens,
                estimated_cost_usd=0.0,
            ),
            finish_reason="stop",
            raw_metadata={"mock_mode": True},
        )

    @staticmethod
    def _extract_workspace_path(prompt: str) -> str:
        match = re.search(r"Authorized workspace:\s*(.+)", prompt)
        if match:
            return match.group(1).strip()
        return ""

    @staticmethod
    def _extract_instruction(prompt: str) -> str:
        match = re.search(r"User instruction:\s*(.+)", prompt)
        if match:
            return match.group(1).strip()
        return prompt.strip()

    def _build_deterministic_json(self, prompt: str) -> dict[str, Any]:
        instruction = self._extract_instruction(prompt)
        workspace = self._extract_workspace_path(prompt)
        lower = instruction.lower()

        # Check explicit unauthorized path probe (returns plan targeting requested path so PermissionEngine blocks it!)
        abs_path_match = re.search(r"(/etc/[^\s\"']+|~/\.ssh[^\s\"']*|\.\./[^\s\"']+)", instruction)
        if abs_path_match:
            target = abs_path_match.group(1)
            return {
                "intent": {
                    "category": "file_intelligence",
                    "goal": f"Inspect requested path {target}",
                    "requires_workspace": True,
                },
                "steps": [
                    {
                        "title": "Read requested file",
                        "description": f"Attempt to read {target} (subject to permission checks).",
                        "tool_id": "file.read",
                        "arguments": {"path": target},
                    }
                ],
            }

        # Check URL extraction
        url_match = re.search(r"https?://[^\s\"'<>]+", instruction)
        if url_match or any(k in lower for k in ("website", "webpage", "browser", "open url")):
            url = url_match.group(0) if url_match else "https://example.com"
            steps: list[dict[str, Any]] = [
                {
                    "title": "Extract webpage information",
                    "description": f"Open {url} in an isolated browser context and extract accessible headings and text.",
                    "tool_id": "browser.extract",
                    "arguments": {"url": url},
                }
            ]
            if "screenshot" in lower and workspace:
                steps.append(
                    {
                        "title": "Capture webpage screenshot",
                        "description": f"Save bounded screenshot of {url} to workspace.",
                        "tool_id": "browser.screenshot",
                        "arguments": {
                            "url": url,
                            "output_path": f"{workspace}/webpage_capture.png",
                        },
                    }
                )
            return {
                "intent": {
                    "category": "browser_intelligence",
                    "goal": f"Inspect public web resource {url}",
                    "requires_workspace": False,
                },
                "steps": steps,
            }

        # Terminal command
        if "terminal" in lower or "run command" in lower or "execute command" in lower:
            cmd = ["pwd"]
            if "rm -rf" in lower:
                cmd = ["rm", "-rf", "/"]
            elif "ls" in lower:
                cmd = ["ls", "-la"]
            elif "git status" in lower:
                cmd = ["git", "status", "--short"]
            return {
                "intent": {
                    "category": "terminal_intelligence",
                    "goal": "Run restricted command inside authorized workspace",
                    "requires_workspace": True,
                },
                "steps": [
                    {
                        "title": "Run restricted terminal command",
                        "description": f"Execute allowlisted command {' '.join(cmd)}.",
                        "tool_id": "terminal.run",
                        "arguments": {
                            "executable": cmd[0],
                            "args": cmd[1:],
                            "cwd": workspace or ".",
                        },
                    }
                ],
            }

        # System diagnostics
        if any(
            k in lower
            for k in ("system health", "cpu", "memory", "disk space", "diagnostics", "processes")
        ):
            steps = [
                {
                    "title": "Collect system health diagnostics",
                    "description": "Inspect OS, CPU, memory, and disk usage in read-only mode.",
                    "tool_id": "system.health",
                    "arguments": {},
                }
            ]
            if "process" in lower:
                steps.append(
                    {
                        "title": "List running processes",
                        "description": "Inspect top active processes in read-only mode.",
                        "tool_id": "system.processes",
                        "arguments": {"limit": 15},
                    }
                )
            if "large file" in lower and workspace:
                steps.append(
                    {
                        "title": "Find large files in workspace",
                        "description": "Identify largest files within the authorized workspace.",
                        "tool_id": "system.large_files",
                        "arguments": {"directory": workspace, "limit": 10},
                    }
                )
            return {
                "intent": {
                    "category": "system_intelligence",
                    "goal": "Inspect local system diagnostics",
                    "requires_workspace": False,
                },
                "steps": steps,
            }

        # Document / CSV / PDF / report (skip when instruction explicitly requests folder creation)
        if not any(k in lower for k in ("create folder", "mkdir")) and (
            any(k in lower for k in ("pdf", "csv", "docx", "xlsx", "summarize", "compare"))
            or bool(re.search(r"\breport\b", lower))
        ):
            steps = []
            if workspace:
                steps.append(
                    {
                        "title": "List workspace files",
                        "description": "Discover supported documents in the authorized workspace.",
                        "tool_id": "file.list",
                        "arguments": {"directory": workspace},
                    }
                )
            file_match = re.search(
                r"([\w./\-]+\.(?:pdf|docx|csv|xlsx|txt|md))", instruction, re.IGNORECASE
            )
            if file_match and workspace:
                rel = file_match.group(1)
                target_file = rel if rel.startswith("/") else f"{workspace}/{rel}"
                steps.append(
                    {
                        "title": f"Read document {rel}",
                        "description": f"Extract structured content from {rel}.",
                        "tool_id": "doc.read",
                        "arguments": {"path": target_file},
                    }
                )
            if ("report" in lower or "export" in lower or "generate" in lower) and workspace:
                ext = "pdf" if "pdf report" in lower else "md"
                out_path = f"{workspace}/agentos_report.{ext}"
                steps.append(
                    {
                        "title": f"Generate verified {ext.upper()} report",
                        "description": f"Write and reopen-validate {out_path}.",
                        "tool_id": "doc.generate_report",
                        "arguments": {
                            "output_path": out_path,
                            "format": ext,
                            "title": "AgentOS Verified Report",
                            "sections": [
                                {
                                    "heading": "Summary",
                                    "body": f"Generated in Offline Deterministic Test Mode for: {instruction}",
                                }
                            ],
                        },
                    }
                )
            return {
                "intent": {
                    "category": "document_intelligence",
                    "goal": "Process documents and generate verified output",
                    "requires_workspace": True,
                },
                "steps": steps
                or [
                    {
                        "title": "Collect system diagnostics",
                        "description": "No workspace selected; inspect system health instead.",
                        "tool_id": "system.health",
                        "arguments": {},
                    }
                ],
            }

        # Organize / duplicate / rename / move / copy / folder
        if any(
            k in lower
            for k in ("organize", "duplicate", "rename", "move", "copy", "create folder", "mkdir")
        ):
            steps = []
            if workspace:
                steps.append(
                    {
                        "title": "List authorized workspace",
                        "description": "Inspect files currently inside the authorized workspace.",
                        "tool_id": "file.list",
                        "arguments": {"directory": workspace},
                    }
                )
                if "duplicate" in lower or "organize" in lower:
                    steps.append(
                        {
                            "title": "Detect duplicate files by SHA-256",
                            "description": "Hash workspace files to locate exact duplicates.",
                            "tool_id": "file.duplicates",
                            "arguments": {"directory": workspace},
                        }
                    )
                if "organize" in lower:
                    steps.append(
                        {
                            "title": "Suggest workspace organization plan",
                            "description": "Propose categorized folder layout without modifying files.",
                            "tool_id": "file.suggest_organization",
                            "arguments": {"directory": workspace},
                        }
                    )
                if "create folder" in lower or "mkdir" in lower:
                    folder_match = re.search(
                        r"(?:folder|directory)\s+['\"]?([\w\-]+)['\"]?", instruction, re.IGNORECASE
                    )
                    folder_name = folder_match.group(1) if folder_match else "organized"
                    steps.append(
                        {
                            "title": f"Create folder {folder_name}",
                            "description": f"Create directory {workspace}/{folder_name}.",
                            "tool_id": "file.create_folder",
                            "arguments": {"path": f"{workspace}/{folder_name}"},
                        }
                    )
            return {
                "intent": {
                    "category": "file_intelligence",
                    "goal": "Analyze and organize authorized workspace",
                    "requires_workspace": True,
                },
                "steps": steps
                or [
                    {
                        "title": "Inspect system health",
                        "description": "Select an authorized workspace to inspect files.",
                        "tool_id": "system.health",
                        "arguments": {},
                    }
                ],
            }

        # Default safe read-only plan
        if workspace:
            return {
                "intent": {
                    "category": "file_intelligence",
                    "goal": f"Inspect workspace for instruction: {instruction[:120]}",
                    "requires_workspace": True,
                },
                "steps": [
                    {
                        "title": "List authorized workspace files",
                        "description": "Read files and folder structure in the active workspace.",
                        "tool_id": "file.list",
                        "arguments": {"directory": workspace},
                    }
                ],
            }
        return {
            "intent": {
                "category": "system_intelligence",
                "goal": f"Run safe diagnostics for: {instruction[:120]}",
                "requires_workspace": False,
            },
            "steps": [
                {
                    "title": "Inspect local system health",
                    "description": "Check OS, CPU, RAM, and disk status in read-only mode.",
                    "tool_id": "system.health",
                    "arguments": {},
                }
            ],
        }
