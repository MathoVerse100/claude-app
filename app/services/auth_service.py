"""External auth API stub.

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


async def login(email: str, password: str) -> TokenResponse | None:
    email = email.strip()
    if not _EMAIL.match(email) or len(password) < 6:
        return None
    encoded = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
    return TokenResponse(access_token=f"{TOKEN_PREFIX}{encoded}", user=email)


async def validate_token(token: str | None) -> SessionInfo:
    if not token or not token.startswith(TOKEN_PREFIX):
        return SessionInfo()
    encoded = token[len(TOKEN_PREFIX):]
    try:
        user = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        return SessionInfo()
    return SessionInfo(authenticated=bool(_EMAIL.match(user)), user=user)
