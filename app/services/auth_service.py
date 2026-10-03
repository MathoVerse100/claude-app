"""External auth API stub (login + register).

Replace the bodies with real HTTP calls (e.g. via httpx to ``settings.api_base_url``)
forwarding ``core.security.auth_headers``. The mock issues opaque ``dvt_`` tokens
that embed the e-mail so ``validate_token`` can work without any storage.
"""
from __future__ import annotations

import base64
import binascii
import re

from app.models.schemas import SessionInfo, TokenResponse

TOKEN_PREFIX = "dvt_"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Demo only: addresses that behave as "already registered" so the error path can be tried.
DEMO_TAKEN = {"taken@example.com"}


class RegistrationError(Exception):
    """Raised by register(); `code` maps to i18n key register.error_<code>."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def login(email: str, password: str) -> TokenResponse | None:
    email = email.strip()
    if not _EMAIL.match(email) or len(password) < 6:
        return None
    return _issue_token(email)


def _issue_token(email: str) -> TokenResponse:
    encoded = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
    return TokenResponse(access_token=f"{TOKEN_PREFIX}{encoded}", user=email)


async def register(name: str, email: str, password: str, confirm: str) -> TokenResponse:
    """Demo sign-up: validates, then signs the new user in. Nothing is stored.

    Replace with a call to your API's register endpoint; keep raising RegistrationError(code)
    for the cases the form can explain: "invalid", "mismatch", "taken".
    """
    name, email = name.strip(), email.strip().lower()
    if not name or not _EMAIL.match(email) or len(password) < 6:
        raise RegistrationError("invalid")
    if password != confirm:
        raise RegistrationError("mismatch")
    if email in DEMO_TAKEN:
        raise RegistrationError("taken")
    return _issue_token(email)


async def validate_token(token: str | None) -> SessionInfo:
    if not token or not token.startswith(TOKEN_PREFIX):
        return SessionInfo()
    encoded = token[len(TOKEN_PREFIX):]
    try:
        user = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        return SessionInfo()
    return SessionInfo(authenticated=bool(_EMAIL.match(user)), user=user)
