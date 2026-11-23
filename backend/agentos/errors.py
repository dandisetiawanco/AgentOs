from __future__ import annotations

from typing import Any

from agentos.security.redactor import redact_value


class AgentOSError(Exception):
    """Base typed exception with user-friendly messaging and redacted diagnostics."""

    code: str = "AGENTOS_ERROR"
    http_status: int = 500
    recoverable: bool = True

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        http_status: int | None = None,
        recoverable: bool | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.user_message = str(redact_value(message))
        if code is not None:
            self.code = code
        if http_status is not None:
            self.http_status = http_status
        if recoverable is not None:
            self.recoverable = recoverable
        self.details: dict[str, Any] = redact_value(details or {})

    def to_dict(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.user_message,
                "recoverable": self.recoverable,
                "details": self.details,
            }
        }


class AuthenticationError(AgentOSError):
    code = "AUTHENTICATION_REQUIRED"
    http_status = 401
    recoverable = False


class PermissionDeniedError(AgentOSError):
    code = "PERMISSION_DENIED"
    http_status = 403
    recoverable = True


class PathSecurityError(PermissionDeniedError):
    code = "PATH_SECURITY_VIOLATION"
    http_status = 403
    recoverable = False


class ApprovalRequiredError(AgentOSError):
    code = "APPROVAL_REQUIRED"
    http_status = 409
    recoverable = True


class NotFoundError(AgentOSError):
    code = "NOT_FOUND"
    http_status = 404
    recoverable = False


class ProviderUnavailableError(AgentOSError):
    code = "PROVIDER_UNAVAILABLE"
    http_status = 503
    recoverable = True


class InvalidCredentialsError(AgentOSError):
    code = "INVALID_CREDENTIALS"
    http_status = 401
    recoverable = True


class ProviderRateLimitError(AgentOSError):
    code = "PROVIDER_RATE_LIMITED"
    http_status = 429
    recoverable = True


class UnsupportedModelError(AgentOSError):
    code = "UNSUPPORTED_MODEL"
    http_status = 400
    recoverable = True


class InvalidModelResponseError(AgentOSError):
    code = "INVALID_MODEL_RESPONSE"
    http_status = 502
    recoverable = True


class DocumentError(AgentOSError):
    code = "DOCUMENT_PROCESSING_ERROR"
    http_status = 422
    recoverable = True


class FileConflictError(AgentOSError):
    code = "FILE_CONFLICT"
    http_status = 409
    recoverable = True


class ToolExecutionError(AgentOSError):
    code = "TOOL_EXECUTION_ERROR"
    http_status = 500
    recoverable = True


class BudgetExceededError(AgentOSError):
    code = "BUDGET_EXCEEDED"
    http_status = 429
    recoverable = False


class TaskCancelledError(AgentOSError):
    code = "TASK_CANCELLED"
    http_status = 499
    recoverable = False


class OperationTimeoutError(AgentOSError):
    code = "OPERATION_TIMEOUT"
    http_status = 504
    recoverable = True


class DatabaseError(AgentOSError):
    code = "DATABASE_ERROR"
    http_status = 500
    recoverable = True


class ValidationFailedError(AgentOSError):
    code = "VALIDATION_ERROR"
    http_status = 422
    recoverable = True
