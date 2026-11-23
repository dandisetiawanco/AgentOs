from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from agentos.config import AgentOSSettings
from agentos.errors import DatabaseError
from agentos.storage.models import Base, ProviderConfig, Workflow


def _configure_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
    finally:
        cursor.close()


class DatabaseManager:
    """Manages SQLite engine, Alembic migrations, sessions, and seed defaults."""

    def __init__(self, settings: AgentOSSettings) -> None:
        self.settings = settings
        self.engine: AsyncEngine = create_async_engine(
            settings.database_url,
            echo=False,
            future=True,
            connect_args={"timeout": 15},
        )
        event.listen(self.engine.sync_engine, "connect", _configure_sqlite_pragmas)
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            bind=self.engine,
            expire_on_commit=False,
            class_=AsyncSession,
        )

    def run_migrations(self) -> None:
        """Apply explicit Alembic migrations up to head."""
        self.settings.ensure_directories()
        backend_root = Path(__file__).resolve().parents[2]
        alembic_ini = backend_root / "alembic.ini"
        migrations_dir = backend_root / "migrations"
        if not alembic_ini.exists() or not migrations_dir.exists():
            raise DatabaseError("Alembic migration configuration is missing.")
        cfg = Config(str(alembic_ini))
        cfg.set_main_option("script_location", str(migrations_dir))
        cfg.set_main_option("sqlalchemy.url", self.settings.sync_database_url)
        try:
            command.upgrade(cfg, "head")
        except Exception as exc:  # noqa: BLE001
            raise DatabaseError(
                f"Database migration failed: {exc}",
                details={"db_path": str(self.settings.db_path)},
            ) from exc

    async def initialize(self) -> None:
        self.run_migrations()
        await self.seed_defaults()

    async def verify_health(self) -> dict[str, Any]:
        async with self.session() as session:
            result = await session.execute(text("SELECT 1"))
            val: Any = result.scalar_one()
            mode: Any = (await session.execute(text("PRAGMA journal_mode;"))).scalar_one()
            return {
                "ok": val == 1,
                "journal_mode": str(mode),
                "db_path": str(self.settings.db_path),
            }

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.session_factory() as db_session:
            try:
                yield db_session
                await db_session.commit()
            except Exception:
                await db_session.rollback()
                raise

    async def seed_defaults(self) -> None:
        default_providers = [
            ProviderConfig(
                id="mock",
                display_name="Offline Deterministic Test Mode",
                enabled=self.settings.allow_mock_provider,
                base_url=None,
                default_model="mock-deterministic-v1",
                timeout_sec=15,
                max_retries=0,
                extra_json={"offline_demo": True},
            ),
            ProviderConfig(
                id="gemini",
                display_name="Google Gemini API",
                enabled=True,
                base_url="https://generativelanguage.googleapis.com/v1beta",
                default_model="gemini-2.5-flash",
                timeout_sec=60,
                max_retries=2,
                extra_json={},
            ),
            ProviderConfig(
                id="openai",
                display_name="OpenAI API",
                enabled=True,
                base_url="https://api.openai.com/v1",
                default_model="gpt-4o-mini",
                timeout_sec=60,
                max_retries=2,
                extra_json={},
            ),
            ProviderConfig(
                id="anthropic",
                display_name="Anthropic API",
                enabled=True,
                base_url="https://api.anthropic.com/v1",
                default_model="claude-3-5-haiku-latest",
                timeout_sec=60,
                max_retries=2,
                extra_json={},
            ),
            ProviderConfig(
                id="ollama",
                display_name="Ollama Local Models",
                enabled=True,
                base_url=self.settings.ollama_base_url,
                default_model="llama3.2",
                timeout_sec=120,
                max_retries=1,
                extra_json={"local": True},
            ),
            ProviderConfig(
                id="openai_compatible",
                display_name="OpenAI-Compatible Endpoint",
                enabled=False,
                base_url=self.settings.openai_compat_base_url or "http://127.0.0.1:8080/v1",
                default_model="local-model",
                timeout_sec=60,
                max_retries=2,
                extra_json={},
            ),
        ]

        builtin_workflows = [
            Workflow(
                id="wf-organize-workspace",
                name="Organize Authorized Workspace",
                description="Inspect files, find content duplicates by SHA-256 hash, and propose a grouped folder structure for review.",
                template_key="organize_workspace",
                instruction_template="Analyze the authorized workspace, detect duplicate files using content hashes, and suggest a folder organization plan.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-summarize-docs",
                name="Summarize Document Collection",
                description="Read supported PDF, DOCX, Markdown, and text documents in a workspace and generate a verified Markdown summary report.",
                template_key="summarize_documents",
                instruction_template="Read documents in the authorized workspace and generate a verified Markdown summary report.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-analyze-csv",
                name="Analyze CSV Dataset",
                description="Inspect CSV columns, row statistics, and data quality, then write a structured report.",
                template_key="analyze_csv",
                instruction_template="Analyze the CSV datasets in the authorized workspace and produce a structured summary report.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-weekly-report",
                name="Weekly Project Report",
                description="Review workspace files, recent modifications, and system health to compile a weekly status report.",
                template_key="weekly_report",
                instruction_template="Inspect workspace files and system health diagnostics, then generate a weekly project status report in Markdown.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-monitor-changes",
                name="Monitor Local Project Changes",
                description="Scan an authorized project folder for recently updated files and large artifacts.",
                template_key="monitor_changes",
                instruction_template="List workspace files, inspect metadata and large files, and report recent local project changes.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-repo-docs",
                name="Generate Repository Documentation",
                description="Scan code and markdown files in an authorized repository and produce an architecture overview draft.",
                template_key="repo_docs",
                instruction_template="Inspect files in the authorized repository and generate a verified Markdown documentation summary.",
                is_builtin=True,
            ),
            Workflow(
                id="wf-web-collect",
                name="Collect Approved Public Web Info",
                description="Open an explicitly provided public URL in an isolated browser session, extract structured content, and export findings.",
                template_key="web_collect",
                instruction_template="Open the approved public webpage, extract its accessible headings and summary, and export the collected information.",
                is_builtin=True,
            ),
        ]

        async with self.session() as session:
            for provider in default_providers:
                existing = await session.get(ProviderConfig, provider.id)
                if existing is None:
                    session.add(provider)
            for wf in builtin_workflows:
                existing_wf = await session.get(Workflow, wf.id)
                if existing_wf is None:
                    session.add(wf)

    async def dispose(self) -> None:
        await self.engine.dispose()


__all__ = ["Base", "DatabaseManager"]
