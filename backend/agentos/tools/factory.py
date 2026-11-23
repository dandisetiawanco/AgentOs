from __future__ import annotations

from agentos.tools.browser_tools import (
    BrowserExportTool,
    BrowserExtractTool,
    BrowserFillFormTool,
    BrowserScreenshotTool,
)
from agentos.tools.document_tools import DocCompareTool, DocGenerateReportTool, DocReadTool
from agentos.tools.file_tools import (
    FileCopyTool,
    FileCreateFolderTool,
    FileDuplicatesTool,
    FileListTool,
    FileMetadataTool,
    FileMoveTool,
    FileReadTool,
    FileRenameTool,
    FileSearchTool,
    FileSuggestOrganizationTool,
)
from agentos.tools.registry import ToolRegistry
from agentos.tools.system_tools import (
    SystemHealthTool,
    SystemLargeFilesTool,
    SystemOpenAppTool,
    SystemProcessesTool,
)
from agentos.tools.terminal_tools import TerminalRunTool


def create_default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    for tool in (
        # File Intelligence
        FileListTool(),
        FileSearchTool(),
        FileReadTool(),
        FileMetadataTool(),
        FileDuplicatesTool(),
        FileSuggestOrganizationTool(),
        FileCreateFolderTool(),
        FileRenameTool(),
        FileMoveTool(),
        FileCopyTool(),
        # Document Intelligence
        DocReadTool(),
        DocCompareTool(),
        DocGenerateReportTool(),
        # Browser Intelligence
        BrowserExtractTool(),
        BrowserScreenshotTool(),
        BrowserFillFormTool(),
        BrowserExportTool(),
        # System Intelligence
        SystemHealthTool(),
        SystemProcessesTool(),
        SystemLargeFilesTool(),
        SystemOpenAppTool(),
        # Terminal Intelligence (disabled by default via PermissionEngine)
        TerminalRunTool(),
    ):
        registry.register(tool)
    return registry
