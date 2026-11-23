from __future__ import annotations

import asyncio
import ctypes
import ctypes.util
import platform
import subprocess
from typing import Any

from PIL import Image
from pydantic import BaseModel

from agentos.api.schemas import AppSettingsPayload
from agentos.errors import ToolExecutionError
from agentos.security.paths import resolve_authorized_path
from agentos.tools.base import (
    BaseTool,
    RiskLevel,
    ToolContext,
    ToolExecutionOutput,
    VerificationOutcome,
)


def _check_macos_accessibility() -> bool | None:
    if platform.system() != "Darwin":
        return None
    try:
        lib_path = ctypes.util.find_library("ApplicationServices")
        if not lib_path:
            return None
        lib = ctypes.cdll.LoadLibrary(lib_path)
        lib.AXIsProcessTrusted.restype = ctypes.c_bool
        return bool(lib.AXIsProcessTrusted())
    except Exception:  # noqa: BLE001
        return None


def _check_macos_screen_recording() -> bool | None:
    if platform.system() != "Darwin":
        return None
    try:
        lib_path = ctypes.util.find_library("CoreGraphics")
        if not lib_path:
            return None
        lib = ctypes.cdll.LoadLibrary(lib_path)
        if hasattr(lib, "CGPreflightScreenCaptureAccess"):
            lib.CGPreflightScreenCaptureAccess.restype = ctypes.c_bool
            return bool(lib.CGPreflightScreenCaptureAccess())
        return None
    except Exception:  # noqa: BLE001
        return None


def inspect_computer_use_capabilities(
    app_cfg: AppSettingsPayload,
    *,
    emergency_stop_active: bool = False,
) -> dict[str, Any]:
    system_name = platform.system()
    arch = platform.machine()
    supported = system_name == "Darwin"
    accessibility = _check_macos_accessibility()
    screen_recording = _check_macos_screen_recording()

    notes: list[str] = []
    if not supported:
        notes.append(
            f"Desktop control adapter has only been verified on macOS Intel so far; '{system_name}' is marked unavailable."
        )
    else:
        if accessibility is False:
            notes.append(
                "macOS Accessibility permission is not granted. Enable AgentOS under System Settings -> Privacy & Security -> Accessibility."
            )
        if screen_recording is False:
            notes.append(
                "macOS Screen Recording permission is not granted. Enable AgentOS under System Settings -> Privacy & Security -> Screen & System Audio Recording."
            )
    if not app_cfg.computer_use_enabled:
        notes.append("Desktop computer use is disabled by default in AgentOS Security Settings.")
    if not app_cfg.computer_use_screen_capture:
        notes.append(
            "Screen capture is separately disabled by default. Continuous recording is never enabled."
        )

    return {
        "platform": system_name,
        "arch": arch,
        "supported": supported,
        "accessibility_granted": accessibility,
        "screen_recording_granted": screen_recording,
        "enabled_in_settings": app_cfg.computer_use_enabled,
        "screen_capture_enabled": app_cfg.computer_use_screen_capture,
        "continuous_recording": False,
        "approved_apps": list(app_cfg.computer_use_approved_apps),
        "emergency_stop_active": emergency_stop_active,
        "notes": notes,
    }


class EmptyInput(BaseModel):
    pass


class ComputerListWindowsTool(BaseTool):
    id = "computer.list_windows"
    name = "Inspect Visible Desktop Windows"
    category = "computer_use"
    description = "Inspect visible macOS application window titles (excluding sensitive password/keychain apps)."
    input_model = EmptyInput
    required_permissions = ("computer.inspect",)
    risk_level = RiskLevel.MEDIUM
    platforms = ("darwin",)
    verification_procedure = (
        "Confirm macOS window query completed without violating sensitive app filters."
    )

    def _run_sync(self) -> ToolExecutionOutput:
        if platform.system() != "Darwin":
            raise ToolExecutionError("Window inspection is currently available on macOS only.")
        if _check_macos_accessibility() is False:
            raise ToolExecutionError(
                "macOS Accessibility permission is required to inspect application windows."
            )
        script = (
            'tell application "System Events" to get name of every application process '
            "whose visible is true"
        )
        proc = subprocess.run(  # noqa: S603
            ["/usr/bin/osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode != 0:
            raise ToolExecutionError(
                f"Could not inspect visible applications: {proc.stderr.strip()}"
            )
        raw_apps = [name.strip() for name in proc.stdout.split(",") if name.strip()]
        filtered = [
            name
            for name in raw_apps
            if name.lower() not in {"keychain access", "passwords", "1password", "bitwarden"}
        ]
        return ToolExecutionOutput(
            ok=True,
            summary=f"Observed {len(filtered)} visible non-sensitive desktop application(s).",
            data={"applications": filtered},
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        return await asyncio.to_thread(self._run_sync)


class DesktopScreenshotInput(BaseModel):
    output_path: str


class ComputerScreenshotTool(BaseTool):
    id = "computer.screenshot"
    name = "Capture Authorized Desktop Screenshot"
    category = "computer_use"
    description = (
        "Capture a single bounded screenshot on macOS when both desktop control and screen capture "
        "are explicitly authorized. Continuous recording is never enabled."
    )
    input_model = DesktopScreenshotInput
    required_permissions = ("computer.screen_capture", "file.write")
    risk_level = RiskLevel.HIGH
    has_side_effects = True
    supports_rollback = True
    platforms = ("darwin",)
    verification_procedure = "Confirm captured PNG exists and conforms to max screenshot width."

    def _run_sync(self, args: DesktopScreenshotInput, ctx: ToolContext) -> ToolExecutionOutput:
        if platform.system() != "Darwin":
            raise ToolExecutionError(
                "Desktop screenshot capture is currently available on macOS only."
            )
        if _check_macos_screen_recording() is False:
            raise ToolExecutionError(
                "macOS Screen Recording permission is not granted. Authorize AgentOS in System Settings."
            )
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        target.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.run(  # noqa: S603
            ["/usr/sbin/screencapture", "-x", str(target)],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if proc.returncode != 0 or not target.exists():
            raise ToolExecutionError(f"Desktop screenshot failed: {proc.stderr.strip()}")

        # Downscale to configured max width to conserve memory/disk on Intel Macs.
        with Image.open(target) as img:
            w, h = img.size
            if w > ctx.max_screenshot_width:
                new_h = int(h * (ctx.max_screenshot_width / w))
                resized = img.resize((ctx.max_screenshot_width, new_h), Image.Resampling.LANCZOS)
                resized.save(target, format="PNG")
                w, h = ctx.max_screenshot_width, new_h

        size = target.stat().st_size
        return ToolExecutionOutput(
            ok=True,
            summary=f"Captured authorized desktop screenshot '{target.name}' ({w}x{h}, {size} bytes).",
            data={"output_path": str(target), "width": w, "height": h, "size_bytes": size},
            artifacts=[str(target)],
            rollback_record={
                "operation_type": "copy",
                "source_path": str(target),
                "target_path": str(target),
            },
        )

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, DesktopScreenshotInput)
        return await asyncio.to_thread(self._run_sync, args, ctx)

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, DesktopScreenshotInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        ok = await asyncio.to_thread(lambda: target.is_file() and target.stat().st_size > 100)
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary=f"Verified screenshot image at {target}."
            if ok
            else "Screenshot missing or empty.",
        )
