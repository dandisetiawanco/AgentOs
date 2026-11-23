from __future__ import annotations

import hmac

from fastapi import Header, Request

from agentos.errors import AuthenticationError


def verify_bearer_token(expected_token: str, authorization: str | None) -> None:
    if not authorization:
        raise AuthenticationError("Missing Authorization header.")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthenticationError("Authorization header must use Bearer scheme.")
    provided = parts[1].strip()
    if not provided or not hmac.compare_digest(provided, expected_token):
        raise AuthenticationError("Invalid session token.")


async def require_session_auth(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    expected: str = request.app.state.settings.session_token
    verify_bearer_token(expected, authorization)
