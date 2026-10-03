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
# Demo only: values that behave as "already used" so every uniqueness error can be tried.
DEMO_TAKEN = {"taken@example.com"}
DEMO_TAKEN_USERNAMES = {"taken_user", "admin"}
DEMO_TAKEN_NAMES = {("taken", "user")}
_USERNAME = re.compile(r"[A-Za-z0-9_-]+")  # English letters, digits 0-9, dash, underscore. No spaces. Case-sensitive.


class RegistrationError(Exception):
    """Raised by check_registration(). `errors` maps a form slot to an error key, e.g.
    {"username": "username_taken"} -> i18n register.errors.username_taken. Slots: first_name, last_name,
    name (the first+last pair), username, email, password, confirm_password."""

    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__(errors)
        self.errors = errors


class LoginError(Exception):
    """`code`: invalid | unverified | unknown (-> i18n login.error / login.error_<code>)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# DEMO user store: verified registrants only, in memory (lost on restart).
_users: dict[str, dict[str, str]] = {}  # keyed by email


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_user(first_name: str, last_name: str, username: str, email: str, password_hash: str) -> None:
    _users[email] = {"first_name": first_name, "last_name": last_name, "username": username, "password_hash": password_hash}


def username_taken(username: str) -> bool:
    """Case-sensitive: "Ana" and "ana" are different usernames."""
    return username in DEMO_TAKEN_USERNAMES or any(u["username"] == username for u in _users.values())


def name_pair_taken(pair: tuple[str, str]) -> bool:
    """Each name may repeat; the first+last COMBINATION may not."""
    return pair in DEMO_TAKEN_NAMES or any(registration_service.name_pair(u["first_name"], u["last_name"]) == pair for u in _users.values())


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


def check_registration(first_name: str, last_name: str, username: str, email: str, password: str, confirm: str) -> dict[str, str]:
    """Validate the whole sign-up form at once. Returns the cleaned values or raises RegistrationError
    listing every problem (slot -> error key).

    Rules: first and last name required (their COMBINATION must be unique); username >= 3 characters,
    English letters / digits / dash / underscore only, no spaces, case-sensitive, unique; email unique;
    password >= 6 and confirmed. Replace with your API's register call keeping the same error keys.
    """
    cfg = load_json("app_config")["auth_demo"]
    first, last, username, email = first_name.strip(), last_name.strip(), username.strip(), email.strip().lower()
    errors: dict[str, str] = {}
    for slot, value in (("first_name", first), ("last_name", last)):
        if not value:
            errors[slot] = f"{slot}_required"
        elif len(value) > cfg["name_max_length"]:
            errors[slot] = f"{slot}_long"
    if not errors.get("first_name") and not errors.get("last_name"):
        pair = registration_service.name_pair(first, last)
        if name_pair_taken(pair) or registration_service.pair_reserved(pair, except_email=email):
            errors["name"] = "name_taken"
    if not username:
        errors["username"] = "username_required"
    elif len(username) < cfg["username_min_length"]:
        errors["username"] = "username_short"
    elif len(username) > cfg["username_max_length"]:
        errors["username"] = "username_long"
    elif not _USERNAME.fullmatch(username):
        errors["username"] = "username_chars"
    elif username_taken(username) or registration_service.username_reserved(username, except_email=email):
        errors["username"] = "username_taken"
    if not _EMAIL.match(email):
        errors["email"] = "email_invalid"
    elif email in DEMO_TAKEN or email in _users:
        errors["email"] = "email_taken"
    if len(password) < 6:
        errors["password"] = "password_short"
    elif password != confirm:
        errors["confirm_password"] = "confirm_mismatch"
    if errors:
        raise RegistrationError(errors)
    return {"first_name": first, "last_name": last, "username": username, "email": email}


async def validate_token(token: str | None) -> SessionInfo:
    if not token or not token.startswith(TOKEN_PREFIX):
        return SessionInfo()
    encoded = token[len(TOKEN_PREFIX):]
    try:
        user = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode()
    except (binascii.Error, UnicodeDecodeError):
        return SessionInfo()
    return SessionInfo(authenticated=bool(_EMAIL.match(user)), user=user)
