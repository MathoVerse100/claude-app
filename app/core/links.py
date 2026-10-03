"""Resolve configurable link targets ({route|href}) from the JSON UI DB."""
from __future__ import annotations

from typing import Any, Mapping

from markupsafe import Markup, escape

from app.core.config import load_json


def is_external(url: str | None) -> bool:
    return bool(url) and url.startswith(("http://", "https://", "//"))


def active_link(link: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    """The link if it exists and is not switched off (`"enabled": false`); else None (so it is not rendered)."""
    if not link or link.get("enabled", True) is False:
        return None
    return link


def href(link: Mapping[str, Any] | None) -> str:
    """`{"route": "about"}` -> endpoints.routes.about; `{"href": "..."}` -> literal."""
    if not link:
        return "#"
    if link.get("route"):
        return load_json("endpoints")["routes"].get(link["route"], "#")
    return link.get("href") or "#"


def link_attrs(link: Mapping[str, Any] | None) -> Markup:
    """Ready-to-use ` href="..."` (+ target/rel for external links) attribute string."""
    url = href(link)
    attrs = f'href="{escape(url)}"'
    if is_external(url) or (link or {}).get("external"):
        attrs += ' target="_blank" rel="noopener noreferrer"'
    return Markup(attrs)
