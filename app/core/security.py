"""Session/token helpers: the BFF only forwards the token issued by the auth API."""
from __future__ import annotations

from fastapi import Request

from app.core.config import load_json


def token_cookie_name() -> str:
    return load_json("app_config")["cookies"]["token"]


def get_token(request: Request) -> str | None:
    return request.cookies.get(token_cookie_name()) or _bearer(request)


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    return value if scheme.lower() == "bearer" and value else None


def auth_headers(token: str | None) -> dict[str, str]:
    """Headers to forward to the external API on behalf of the user."""
    return {"Authorization": f"Bearer {token}"} if token else {}
