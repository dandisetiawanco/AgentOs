from __future__ import annotations

import asyncio
import json
from typing import Literal

from playwright.async_api import async_playwright
from pydantic import BaseModel, Field

from agentos.errors import ToolExecutionError
from agentos.security.paths import resolve_authorized_path
from agentos.tools.base import (
    BaseTool,
    RiskLevel,
    ToolContext,
    ToolExecutionOutput,
    VerificationOutcome,
)

CAPTCHA_MARKERS = (
    "recaptcha",
    "hcaptcha",
    "turnstile",
    "verify you are human",
    "bot detection",
    "access denied",
)


class BrowserExtractInput(BaseModel):
    url: str
    max_text_chars: int = Field(default=12000, ge=500, le=50000)


class BrowserExtractTool(BaseTool):
    id = "browser.extract"
    name = "Inspect & Extract Public Webpage"
    category = "browser"
    description = (
        "Open a public URL in an isolated headless Playwright browser context and extract "
        "its title, accessible headings, links, and text without bypassing CAPTCHAs or auth."
    )
    input_model = BrowserExtractInput
    required_permissions = ("browser.read",)
    risk_level = RiskLevel.LOW
    timeout_sec = 40
    verification_procedure = "Confirm page loaded with HTTP < 400 and extracted structured DOM data."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, BrowserExtractInput)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                java_script_enabled=True,
                accept_downloads=False,
            )
            page = await context.new_page()
            try:
                response = await page.goto(args.url, wait_until="domcontentloaded", timeout=20000)
                status = response.status if response else 0
                title = await page.title()
                body_text = await page.inner_text("body")
                lower_body = body_text.lower()
                detected_gate = next((m for m in CAPTCHA_MARKERS if m in lower_body), None)
                if detected_gate:
                    return ToolExecutionOutput(
                        ok=False,
                        summary=f"Stopped: target page presented an access/bot gate ('{detected_gate}'). AgentOS never bypasses CAPTCHAs or access controls.",
                        untrusted_content=True,
                        data={"url": page.url, "status": status, "gate_detected": detected_gate},
                    )
                headings = await page.eval_on_selector_all(
                    "h1, h2, h3",
                    "els => els.slice(0, 30).map(e => ({tag: e.tagName.toLowerCase(), text: (e.innerText || '').trim()}))",
                )
                links = await page.eval_on_selector_all(
                    "a[href]",
                    "els => els.slice(0, 25).map(e => ({text: (e.innerText || '').trim().slice(0, 120), href: e.href}))",
                )
                clean_text = " ".join(body_text.split())[: args.max_text_chars]
                return ToolExecutionOutput(
                    ok=status < 400 if status else True,
                    summary=f"Extracted '{title or args.url}' ({len(headings)} headings, {len(clean_text)} chars).",
                    untrusted_content=True,
                    data={
                        "url": page.url,
                        "status": status,
                        "title": title,
                        "headings": headings,
                        "links": links,
                        "text_excerpt": clean_text,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                raise ToolExecutionError(f"Browser extraction failed for '{args.url}': {exc}") from exc
            finally:
                await context.close()
                await browser.close()


class BrowserScreenshotInput(BaseModel):
    url: str
    output_path: str
    full_page: bool = False


class BrowserScreenshotTool(BaseTool):
    id = "browser.screenshot"
    name = "Capture Webpage Screenshot"
    category = "browser"
    description = "Capture a bounded PNG screenshot of a webpage in an isolated browser context."
    input_model = BrowserScreenshotInput
    required_permissions = ("browser.read", "file.write")
    risk_level = RiskLevel.MEDIUM
    timeout_sec = 40
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm saved PNG file exists and is non-empty."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, BrowserScreenshotInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        await asyncio.to_thread(lambda: target.parent.mkdir(parents=True, exist_ok=True))

        width = min(1280, ctx.max_screenshot_width)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": width, "height": 800})
            page = await context.new_page()
            try:
                await page.goto(args.url, wait_until="domcontentloaded", timeout=20000)
                await page.screenshot(path=str(target), full_page=args.full_page)
            except Exception as exc:  # noqa: BLE001
                raise ToolExecutionError(f"Browser screenshot failed: {exc}") from exc
            finally:
                await context.close()
                await browser.close()

        size = await asyncio.to_thread(lambda: target.stat().st_size)
        return ToolExecutionOutput(
            ok=size > 0,
            summary=f"Saved webpage screenshot to '{target.name}' ({size} bytes).",
            data={"url": args.url, "output_path": str(target), "size_bytes": size},
            artifacts=[str(target)],
            rollback_record={
                "operation_type": "copy",
                "source_path": str(target),
                "target_path": str(target),
            },
        )

    async def verify(
        self, args: BaseModel, output: ToolExecutionOutput, ctx: ToolContext
    ) -> VerificationOutcome:
        assert isinstance(args, BrowserScreenshotInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        ok = await asyncio.to_thread(lambda: target.is_file() and target.stat().st_size > 100)
        return VerificationOutcome(
            verified=ok,
            method=self.verification_procedure,
            summary=f"Verified PNG screenshot at {target}." if ok else "Screenshot file invalid or missing.",
        )


class BrowserFillFormInput(BaseModel):
    url: str
    fields: dict[str, str] = Field(default_factory=dict)
    submit_selector: str | None = None
    submit: bool = False


class BrowserFillFormTool(BaseTool):
    id = "browser.fill_form"
    name = "Fill Approved Web Form"
    category = "browser"
    description = "Fill explicitly approved form fields in an isolated browser context. Submitting requires HIGH approval."
    input_model = BrowserFillFormInput
    required_permissions = ("browser.interact",)
    risk_level = RiskLevel.HIGH
    timeout_sec = 45
    has_side_effects = True
    verification_procedure = "Confirm specified selectors accepted input values."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, BrowserFillFormInput)
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1280, "height": 800})
            page = await context.new_page()
            try:
                await page.goto(args.url, wait_until="domcontentloaded", timeout=20000)
                filled: list[str] = []
                for selector, value in args.fields.items():
                    # Never fill password fields programmatically.
                    input_type = await page.eval_on_selector(
                        selector, "el => (el.getAttribute('type') || '').toLowerCase()"
                    )
                    if input_type == "password":
                        raise ToolExecutionError("Refusing to fill password input fields.")
                    await page.fill(selector, value)
                    filled.append(selector)
                submitted = False
                if args.submit and args.submit_selector:
                    await page.click(args.submit_selector)
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                    submitted = True
                return ToolExecutionOutput(
                    ok=True,
                    summary=f"Filled {len(filled)} field(s) on {page.url} (submitted={submitted}).",
                    untrusted_content=True,
                    data={"url": page.url, "filled_selectors": filled, "submitted": submitted},
                )
            except ToolExecutionError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise ToolExecutionError(f"Browser form interaction failed: {exc}") from exc
            finally:
                await context.close()
                await browser.close()


class BrowserExportInput(BaseModel):
    url: str
    output_path: str
    format: Literal["json", "md"] = "md"


class BrowserExportTool(BaseTool):
    id = "browser.export"
    name = "Export Extracted Webpage Data"
    category = "browser"
    description = "Extract accessible content from a webpage and save it as verified JSON or Markdown in an authorized workspace."
    input_model = BrowserExportInput
    required_permissions = ("browser.read", "file.write")
    risk_level = RiskLevel.MEDIUM
    timeout_sec = 45
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Confirm exported file exists and is non-empty."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, BrowserExportInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        extractor = BrowserExtractTool()
        extracted = await extractor.execute(BrowserExtractInput(url=args.url), ctx)
        if not extracted.ok:
            return extracted

        def _save() -> int:
            target.parent.mkdir(parents=True, exist_ok=True)
            if args.format == "json":
                target.write_text(json.dumps(extracted.data, indent=2), encoding="utf-8")
            else:
                headings = extracted.data.get("headings") or []
                lines = [
                    f"# {extracted.data.get('title') or args.url}",
                    "",
                    f"Source URL: {extracted.data.get('url')}",
                    "",
                    "## Headings",
                ]
                for h in headings:
                    lines.append(f"- ({h.get('tag')}) {h.get('text')}")
                lines.extend(["", "## Extracted Text", str(extracted.data.get("text_excerpt", ""))])
                target.write_text("\n".join(lines), encoding="utf-8")
            return target.stat().st_size

        size = await asyncio.to_thread(_save)
        return ToolExecutionOutput(
            ok=size > 0,
            summary=f"Exported webpage data to '{target.name}' ({size} bytes).",
            untrusted_content=True,
            data={"output_path": str(target), "size_bytes": size, "title": extracted.data.get("title")},
            artifacts=[str(target)],
            rollback_record={
                "operation_type": "copy",
                "source_path": str(target),
                "target_path": str(target),
            },
        )
