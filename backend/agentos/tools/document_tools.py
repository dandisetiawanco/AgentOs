from __future__ import annotations

import asyncio
import csv
import difflib
from pathlib import Path
from typing import Any, Literal

import openpyxl
from docx import Document as DocxDocument
from pydantic import BaseModel, Field
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from agentos.errors import DocumentError
from agentos.security.paths import resolve_authorized_path
from agentos.tools.base import (
    BaseTool,
    RiskLevel,
    ToolContext,
    ToolExecutionOutput,
    VerificationOutcome,
)


def parse_document_sync(path: Path, max_bytes: int) -> dict[str, Any]:
    if not path.is_file():
        raise DocumentError(f"Document '{path}' does not exist.")
    size = path.stat().st_size
    if size > max_bytes:
        raise DocumentError(f"Document '{path.name}' exceeds size limit ({max_bytes} bytes).")

    ext = path.suffix.lower()
    try:
        if ext in (".txt", ".md", ".markdown"):
            text = path.read_text(encoding="utf-8", errors="replace")
            lines = text.splitlines()
            return {
                "format": ext.lstrip("."),
                "text": text[:40000],
                "line_count": len(lines),
                "word_count": len(text.split()),
            }

        if ext == ".pdf":
            reader = PdfReader(str(path))
            pages = [(page.extract_text() or "").strip() for page in reader.pages]
            joined = "\n\n".join(pages)
            return {
                "format": "pdf",
                "page_count": len(pages),
                "text": joined[:40000],
                "word_count": len(joined.split()),
            }

        if ext == ".docx":
            doc = DocxDocument(str(path))
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            joined = "\n".join(paragraphs)
            return {
                "format": "docx",
                "paragraph_count": len(paragraphs),
                "table_count": len(doc.tables),
                "text": joined[:40000],
                "word_count": len(joined.split()),
            }

        if ext == ".csv":
            with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
                reader_csv = list(csv.reader(handle))
            headers = reader_csv[0] if reader_csv else []
            data_rows = reader_csv[1:] if len(reader_csv) > 1 else []
            return {
                "format": "csv",
                "headers": headers,
                "row_count": len(data_rows),
                "column_count": len(headers),
                "sample_rows": data_rows[:25],
            }

        if ext == ".xlsx":
            wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
            try:
                sheets: dict[str, Any] = {}
                for sheet_name in wb.sheetnames[:10]:
                    ws = wb[sheet_name]
                    rows = [list(row) for row in ws.iter_rows(max_row=30, values_only=True)]
                    headers = [str(c) if c is not None else "" for c in rows[0]] if rows else []
                    sheets[sheet_name] = {
                        "headers": headers,
                        "sample_rows": rows[1:26] if len(rows) > 1 else [],
                        "row_count_sampled": max(0, len(rows) - 1),
                    }
                return {"format": "xlsx", "sheet_names": wb.sheetnames, "sheets": sheets}
            finally:
                wb.close()

        raise DocumentError(f"Unsupported document extension '{ext}'.")
    except DocumentError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise DocumentError(
            f"Malformed or unreadable {ext} document '{path.name}': {exc}",
            details={"path": str(path)},
        ) from exc


class DocReadInput(BaseModel):
    path: str


class DocReadTool(BaseTool):
    id = "doc.read"
    name = "Read Structured Document"
    category = "document"
    description = "Read and extract structured text or tabular data from PDF, DOCX, TXT, Markdown, CSV, or XLSX."
    input_model = DocReadInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm document parsed cleanly without format errors."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, DocReadInput)
        target = resolve_authorized_path(args.path, ctx.authorized_workspaces, must_exist=True)
        parsed = await asyncio.to_thread(parse_document_sync, target, ctx.max_file_size_bytes)
        return ToolExecutionOutput(
            ok=True,
            summary=f"Extracted {parsed['format'].upper()} document '{target.name}'.",
            untrusted_content=True,
            data={"path": str(target), **parsed},
        )


class DocCompareInput(BaseModel):
    path_a: str
    path_b: str


class DocCompareTool(BaseTool):
    id = "doc.compare"
    name = "Compare Two Documents"
    category = "document"
    description = "Compare text extracted from two authorized documents and return a structured unified diff."
    input_model = DocCompareInput
    required_permissions = ("file.read",)
    risk_level = RiskLevel.READ_ONLY
    verification_procedure = "Confirm both documents parsed and diff statistics were computed."

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, DocCompareInput)
        a = resolve_authorized_path(args.path_a, ctx.authorized_workspaces, must_exist=True)
        b = resolve_authorized_path(args.path_b, ctx.authorized_workspaces, must_exist=True)
        parsed_a = await asyncio.to_thread(parse_document_sync, a, ctx.max_file_size_bytes)
        parsed_b = await asyncio.to_thread(parse_document_sync, b, ctx.max_file_size_bytes)
        lines_a = str(parsed_a.get("text", "")).splitlines()
        lines_b = str(parsed_b.get("text", "")).splitlines()
        diff_lines = list(
            difflib.unified_diff(lines_a, lines_b, fromfile=a.name, tofile=b.name, lineterm="")
        )
        added = sum(1 for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++"))
        removed = sum(1 for ln in diff_lines if ln.startswith("-") and not ln.startswith("---"))
        return ToolExecutionOutput(
            ok=True,
            summary=f"Compared '{a.name}' and '{b.name}': +{added} / -{removed} line changes.",
            untrusted_content=True,
            data={
                "path_a": str(a),
                "path_b": str(b),
                "identical": len(diff_lines) == 0,
                "lines_added": added,
                "lines_removed": removed,
                "diff_preview": "\n".join(diff_lines[:150]),
            },
        )


class ReportSection(BaseModel):
    heading: str
    body: str


class DocGenerateInput(BaseModel):
    output_path: str
    format: Literal["md", "pdf", "docx", "csv", "xlsx"] = "md"
    title: str = "AgentOS Report"
    sections: list[ReportSection] = Field(default_factory=list)
    table_headers: list[str] = Field(default_factory=list)
    table_rows: list[list[Any]] = Field(default_factory=list)


class DocGenerateReportTool(BaseTool):
    id = "doc.generate_report"
    name = "Generate and Validate Report"
    category = "document"
    description = "Generate a Markdown, PDF, DOCX, CSV, or XLSX file in an authorized workspace and validate it by reopening."
    input_model = DocGenerateInput
    required_permissions = ("file.write",)
    risk_level = RiskLevel.MEDIUM
    has_side_effects = True
    supports_rollback = True
    verification_procedure = "Reopen and parse generated output file to verify format integrity."

    def _write_sync(self, args: DocGenerateInput, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        if args.format == "md":
            lines = [f"# {args.title}", ""]
            for sec in args.sections:
                lines.append(f"## {sec.heading}")
                lines.append(sec.body)
                lines.append("")
            if args.table_headers:
                lines.append("| " + " | ".join(args.table_headers) + " |")
                lines.append("| " + " | ".join("---" for _ in args.table_headers) + " |")
                for row in args.table_rows:
                    lines.append("| " + " | ".join(str(c) for c in row) + " |")
                lines.append("")
            target.write_text("\n".join(lines), encoding="utf-8")
            return

        if args.format == "pdf":
            styles = getSampleStyleSheet()
            story: list[Any] = [Paragraph(args.title, styles["Title"]), Spacer(1, 12)]
            for sec in args.sections:
                story.append(Paragraph(sec.heading, styles["Heading2"]))
                story.append(Paragraph(sec.body.replace("\n", "<br/>"), styles["BodyText"]))
                story.append(Spacer(1, 8))
            doc = SimpleDocTemplate(str(target), pagesize=letter)
            doc.build(story)
            return

        if args.format == "docx":
            doc_word = DocxDocument()
            doc_word.add_heading(args.title, level=1)
            for sec in args.sections:
                doc_word.add_heading(sec.heading, level=2)
                doc_word.add_paragraph(sec.body)
            if args.table_headers:
                table = doc_word.add_table(rows=1, cols=len(args.table_headers))
                for idx, header in enumerate(args.table_headers):
                    table.rows[0].cells[idx].text = str(header)
                for row_data in args.table_rows:
                    row_cells = table.add_row().cells
                    for idx, val in enumerate(row_data[: len(args.table_headers)]):
                        row_cells[idx].text = str(val)
            doc_word.save(str(target))
            return

        if args.format == "csv":
            with target.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                if args.table_headers:
                    writer.writerow(args.table_headers)
                for row in args.table_rows:
                    writer.writerow(row)
            return

        if args.format == "xlsx":
            wb = openpyxl.Workbook()
            ws = wb.active
            assert ws is not None
            ws.title = "Report"
            if args.table_headers:
                ws.append(args.table_headers)
            for row in args.table_rows:
                ws.append(row)
            wb.save(str(target))
            wb.close()

    async def execute(self, args: BaseModel, ctx: ToolContext) -> ToolExecutionOutput:
        assert isinstance(args, DocGenerateInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        await asyncio.to_thread(self._write_sync, args, target)
        size = await asyncio.to_thread(lambda: target.stat().st_size)
        return ToolExecutionOutput(
            ok=True,
            summary=f"Generated {args.format.upper()} file '{target.name}' ({size} bytes).",
            data={"output_path": str(target), "format": args.format, "size_bytes": size},
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
        assert isinstance(args, DocGenerateInput)
        target = resolve_authorized_path(args.output_path, ctx.authorized_workspaces)
        try:
            reopened = await asyncio.to_thread(parse_document_sync, target, ctx.max_file_size_bytes)
            return VerificationOutcome(
                verified=True,
                method=self.verification_procedure,
                summary=f"Reopened and validated {args.format.upper()} file '{target.name}'.",
                details={"format": reopened["format"], "path": str(target)},
            )
        except Exception as exc:  # noqa: BLE001
            return VerificationOutcome(
                verified=False,
                method=self.verification_procedure,
                summary=f"Failed to reopen generated file: {exc}",
            )
