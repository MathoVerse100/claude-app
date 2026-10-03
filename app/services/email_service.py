"""Outgoing email. DEMO implementation: nothing is sent.

The message is written to the server log (logger ``dataverse.mail``) and kept in a small in-memory
outbox so the verify page can show it when ``auth_demo.show_code_on_page`` is on. Replace
``send_verification`` with a real SMTP / provider call later and turn that flag off.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

log = logging.getLogger("dataverse.mail")
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("[demo mail] %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False

_outbox: dict[str, dict[str, str]] = {}


def send_verification(to: str, name: str, code: str, minutes: int, t: Callable[..., Any]) -> None:
    message = {
        "to": to,
        "subject": t("email.verify_subject"),
        "body": t("email.verify_body", name=name, code=code, minutes=minutes),
    }
    _outbox[to] = message
    log.info("to=%s subject=%r body=%r", to, message["subject"], message["body"])


def last_message(to: str) -> dict[str, str] | None:
    return _outbox.get(to)
