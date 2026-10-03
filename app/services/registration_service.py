"""Pending registrations (DEMO, in memory, single process).

Registering does NOT create a user. It creates a *pending* registration plus a secret one-time
code that is emailed. The account only exists once the code is entered.

While pending it also reserves its username and name pair. It dies when ANY of these happens:
  * its code is older than ``code_ttl_minutes``;
  * too many wrong codes (``max_attempts``);
  * the verify page is closed - a pagehide beacon marks it "leaving", and loading the page again
    after ``rejoin_grace_seconds`` (e.g. Ctrl+Shift+T) finds it gone, however much of the TTL is
    left. A reload within the grace window is allowed. If no beacon arrives (crash, kill), the
    page loads strictly only while the page has pinged within ``heartbeat_timeout_seconds``.
Only a hash of the code is kept. The browser holds an unguessable flow id in a *session* cookie, so
the code alone is useless on another browser.
"""
from __future__ import annotations

import hashlib
import hmac
import math
import secrets
import time
from dataclasses import dataclass

from app.core.config import load_json

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
_MAX_PENDING = 2000
_now = time.time  # tests replace this clock


def _cfg() -> dict:
    return load_json("app_config")["auth_demo"]


class FlowError(Exception):
    """`code`: expired | attempts | invalid | cooldown | limit | busy."""

    def __init__(self, code: str, **data: int) -> None:
        super().__init__(code)
        self.code = code
        self.data = data


@dataclass
class Pending:
    first_name: str
    last_name: str
    username: str
    email: str
    password_hash: str
    lang: str
    code_hash: str
    expires_at: float
    last_seen: float
    last_sent: float
    leaving_at: float | None = None
    attempts: int = 0
    resends: int = 0


_flows: dict[str, Pending] = {}
_by_email: dict[str, str] = {}
_by_username: dict[str, str] = {}               # exact (case-sensitive) username -> flow key
_by_pair: dict[tuple[str, str], str] = {}       # normalised (first, last) -> flow key


def name_pair(first: str, last: str) -> tuple[str, str]:
    """Normalised (first, last) used for the "combination must be unique" rule: trimmed, single-spaced, case-insensitive."""
    return " ".join(first.split()).casefold(), " ".join(last.split()).casefold()


def _key(flow_id: str) -> str:
    return hashlib.sha256(flow_id.encode()).hexdigest()


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def normalize_code(code: str) -> str:
    return "".join(c for c in code.upper() if c.isalnum())


def format_code(code: str) -> str:
    return "-".join(code[i:i + 4] for i in range(0, len(code), 4))


def _new_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(int(_cfg()["code_length"])))


def _drop(key: str) -> None:
    p = _flows.pop(key, None)
    if p is None:
        return
    for index, k in ((_by_email, p.email), (_by_username, p.username), (_by_pair, name_pair(p.first_name, p.last_name))):
        if index.get(k) == key:
            del index[k]


def _purge(now: float) -> None:
    cfg = _cfg()
    silent_limit = 3 * cfg["heartbeat_timeout_seconds"]  # tolerate frozen background tabs
    for key, p in list(_flows.items()):
        if now >= p.expires_at or now - p.last_seen > silent_limit:
            _drop(key)


def start(first_name: str, last_name: str, username: str, email: str, password_hash: str, lang: str) -> tuple[str, str, Pending]:
    """Create (or replace) the pending registration for ``email``. Returns (flow_id, code, pending)."""
    now = _now()
    _purge(now)
    if len(_flows) >= _MAX_PENDING:
        raise FlowError("busy")
    if email in _by_email:
        _drop(_by_email[email])
    flow_id, code = secrets.token_urlsafe(32), _new_code()
    p = Pending(first_name, last_name, username, email, password_hash, lang, _hash_code(code),
                expires_at=now + _cfg()["code_ttl_minutes"] * 60, last_seen=now, last_sent=now)
    key = _key(flow_id)
    _flows[key] = p
    _by_email[email] = key
    _by_username[username] = key
    _by_pair[name_pair(first_name, last_name)] = key
    return flow_id, code, p


def lookup(flow_id: str | None, *, strict_load: bool = False) -> Pending | None:
    """The live pending registration, or None. `strict_load` is for loading the verify PAGE."""
    if not flow_id:
        return None
    now = _now()
    _purge(now)
    key = _key(flow_id)
    p = _flows.get(key)
    if p is None:
        return None
    if strict_load:
        cfg = _cfg()
        left_the_page = p.leaving_at is not None and now - p.leaving_at > cfg["rejoin_grace_seconds"]
        went_silent = now - p.last_seen > cfg["heartbeat_timeout_seconds"]
        if left_the_page or went_silent:
            _drop(key)
            return None
    return p


def touch(flow_id: str | None, *, page_load: bool = False) -> Pending | None:
    """Record that the verify page is alive. A ping proves life, so it also clears 'leaving'."""
    p = lookup(flow_id, strict_load=page_load)
    if p is not None:
        p.last_seen, p.leaving_at = _now(), None
    return p


def mark_leaving(flow_id: str | None) -> None:
    if flow_id and (p := _flows.get(_key(flow_id))):
        p.leaving_at = _now()


def verify(flow_id: str | None, code: str) -> Pending:
    p = lookup(flow_id)
    if p is None:
        raise FlowError("expired")
    cfg = _cfg()
    if hmac.compare_digest(_hash_code(normalize_code(code)), p.code_hash) and normalize_code(code):
        _drop(_key(flow_id))  # one-time: consumed
        return p
    p.attempts += 1
    left = cfg["max_attempts"] - p.attempts
    if left <= 0:
        _drop(_key(flow_id))
        raise FlowError("attempts")
    raise FlowError("invalid", left=left)


def resend(flow_id: str | None) -> tuple[str, Pending]:
    """Issue a fresh code (the old one stops working) and restart the TTL."""
    p = lookup(flow_id)
    if p is None:
        raise FlowError("expired")
    cfg, now = _cfg(), _now()
    wait = math.ceil(p.last_sent + cfg["resend_cooldown_seconds"] - now)
    if wait > 0:
        raise FlowError("cooldown", wait=wait)
    if p.resends >= cfg["max_resends"]:
        raise FlowError("limit")
    code = _new_code()
    p.code_hash, p.expires_at, p.last_sent = _hash_code(code), now + cfg["code_ttl_minutes"] * 60, now
    p.attempts, p.resends = 0, p.resends + 1
    return code, p


def cancel(flow_id: str | None) -> None:
    if flow_id:
        _drop(_key(flow_id))


def username_reserved(username: str, except_email: str | None = None) -> bool:
    """A pending registration holds its username until it expires, so nobody else can take it meanwhile."""
    _purge(_now())
    key = _by_username.get(username)
    return key is not None and _flows[key].email != except_email


def pair_reserved(pair: tuple[str, str], except_email: str | None = None) -> bool:
    _purge(_now())
    key = _by_pair.get(pair)
    return key is not None and _flows[key].email != except_email


def has_pending(email: str) -> bool:
    _purge(_now())
    return email in _by_email


def seconds_left(p: Pending) -> int:
    return max(0, math.ceil(p.expires_at - _now()))


def cooldown_left(p: Pending) -> int:
    return max(0, math.ceil(p.last_sent + _cfg()["resend_cooldown_seconds"] - _now()))


def resends_left(p: Pending) -> int:
    return max(0, _cfg()["max_resends"] - p.resends)
