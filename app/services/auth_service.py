"""External auth API stub (login + register).

Replace the bodies with real HTTP calls (e.g. via httpx to ``settings.api_base_url``)
forwarding ``core.security.auth_headers``. The mock issues opaque ``dvt_`` tokens
that embed the e-mail so ``validate_token`` can work without any storage.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import secrets

from app.core.config import load_json
from app.models.schemas import SessionInfo, TokenResponse
from app.services import registration_service

TOKEN_PREFIX = "dvt_"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Demo only: addresses that behave as "already registered" so the error path can be tried.
DEMO_TAKEN = {"taken@example.com"}


class RegistrationError(Exception):
    """Raised by register(); `code` maps to i18n key register.error_<code>."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class LoginError(Exception):
    """`code`: invalid | unverified | unknown (-> i18n login.error / login.error_<code>)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# DEMO user store: verified registrants only, in memory (lost on restart).
_users: dict[str, dict[str, str]] = {}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_user(name: str, email: str, password_hash: str) -> None:
    _users[email] = {"name": name, "password_hash": password_hash}


async def login(email: str, password: str) -> TokenResponse:
    """Demo login. Verified registrants must use their real password; a registration that is still
    waiting for its code cannot log in; anyone else may log in with any valid email (demo) unless
    ``auth_demo.allow_unregistered_login`` is false.
    """
    email = email.strip().lower()
    if not _EMAIL.match(email) or len(password) < 6:
        raise LoginError("invalid")
    if email in _users:
        if not verify_password(password, _users[email]["password_hash"]):
            raise LoginError("invalid")
        return _issue_token(email)
    if registration_service.has_pending(email):
        raise LoginError("unverified")
    if not load_json("app_config")["auth_demo"]["allow_unregistered_login"]:
        raise LoginError("unknown")
    return _issue_token(email)


def _issue_token(email: str) -> TokenResponse:
    encoded = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
    return TokenResponse(access_token=f"{TOKEN_PREFIX}{encoded}", user=email)


issue_session = _issue_token


def check_registration(name: str, email: str, password: str, confirm: str) -> tuple[str, str]:
    """Validate the sign-up form. Returns the cleaned (name, email) or raises RegistrationError.

    Replace with your API's register call; keep the error codes: "invalid", "mismatch", "taken".
    """
    name, email = name.strip(), email.strip().lower()
    if not name or not _EMAIL.match(email) or len(password) < 6:
        raise RegistrationError("invalid")
    if password != confirm:
        raise RegistrationError("mismatch")
    if email in DEMO_TAKEN or email in _users:
        raise RegistrationError("taken")
    return name, email


async def validate_token(token: str | None) -> SessionInfo:
    if not token or not token.startswith(TOKEN_PREFIX):
        return SessionInfo()
    encoded = token[len(TOKEN_PREFIX):]
    try:
        user = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        return SessionInfo()
    return SessionInfo(authenticated=bool(_EMAIL.match(user)), user=user)
