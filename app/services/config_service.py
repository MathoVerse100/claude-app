"""Lookups over the JSON UI DB and the Jinja context builder."""
from __future__ import annotations

from datetime import datetime
from urllib.parse import urlparse
from typing import Any, Callable

from fastapi import Request

from app.core.config import load_json
from app.core.security import get_token
from app.services import auth_service

_MISSING = object()


def _lookup(tree: Any, dotted: str) -> Any:
    node = tree
    for part in dotted.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return _MISSING
    return node


def make_translator(lang: str) -> Callable[..., Any]:
    """Return ``t(key, **fmt)`` resolving dotted keys with default-locale fallback."""
    i18n = load_json("i18n")
    default = load_json("app_config")["app"]["default_locale"]
    primary, fallback = i18n.get(lang, {}), i18n.get(default, {})

    def t(key: str, **fmt: Any) -> Any:
        value = _lookup(primary, key)
        if value is _MISSING:
            value = _lookup(fallback, key)
        if value is _MISSING:
            return key
        if fmt and isinstance(value, str):
            return value.format(**fmt)
        return value

    return t


def supported_locales() -> list[str]:
    return [loc["code"] for loc in load_json("app_config")["app"]["locales"]]


def resolve_lang(request: Request) -> str:
    cfg = load_json("app_config")
    supported = supported_locales()
    cookie = request.cookies.get(cfg["cookies"]["lang"])
    if cookie in supported:
        return cookie
    for chunk in request.headers.get("accept-language", "").split(","):
        code = chunk.split(";")[0].strip().lower()[:2]
        if code in supported:
            return code
    return cfg["app"]["default_locale"]


def resolve_direction(lang: str) -> str:
    """Text direction for ``lang``: the config-wide override wins, then the locale's own `dir`."""
    cfg = load_json("app_config")
    forced = (cfg.get("direction") or {}).get("force")
    if forced in ("ltr", "rtl"):
        return forced
    for loc in cfg["app"]["locales"]:
        if loc["code"] == lang and loc.get("dir") in ("ltr", "rtl"):
            return loc["dir"]
    return (cfg.get("direction") or {}).get("default", "ltr")


def resolve_theme(request: Request) -> str:
    themes = load_json("themes")
    cookie = request.cookies.get(load_json("app_config")["cookies"]["theme"])
    return cookie if cookie in themes["themes"] else themes["default"]


def current_path(request: Request) -> str:
    """Path the user is looking at; for HTMX calls that is the page that issued them."""
    if request.headers.get("hx-request") == "true":
        url = request.headers.get("hx-current-url")
        if url:
            return urlparse(url).path or "/"
    return request.url.path


def make_link_label(lang: str, t: Callable[..., Any]) -> Callable[..., str]:
    """Resolve the text of a card's link, most specific source first:

    1. ``link.label_key``   - any i18n key (shared across cards, translated)
    2. ``link.label``       - literal text, or a ``{"en": "...", "es": "..."}`` per-locale map
    3. ``link_label``       - per-card copy in i18n (e.g. features.card.<id>.link_label)
    4. ``common.card_link`` - the global default
    """
    default = load_json("app_config")["app"]["default_locale"]

    def link_label(link: dict[str, Any] | None, card_text: Any = None) -> str:
        if not link:
            return ""
        if link.get("label_key"):
            return t(link["label_key"])
        label = link.get("label")
        if isinstance(label, dict):
            return label.get(lang) or label.get(default) or next(iter(label.values()), "")
        if label:
            return str(label)
        if isinstance(card_text, dict) and card_text.get("link_label"):
            return card_text["link_label"]
        return t("common.card_link")

    return link_label


async def build_context(request: Request, **extra: Any) -> dict[str, Any]:
    """Context shared by every template: config maps, i18n, theme, session."""
    lang, theme = resolve_lang(request), resolve_theme(request)
    session = await auth_service.validate_token(get_token(request))
    context: dict[str, Any] = {
        "config": {
            "app": load_json("app_config"),
            "endpoints": load_json("endpoints"),
            "themes": load_json("themes"),
            "home": load_json("home"),
            "cards": load_json("cards"),
        },
        "t": (t := make_translator(lang)),
        "link_label": make_link_label(lang, t),
        "lang": lang,
        "dir": resolve_direction(lang),
        "theme": theme,
        "session": session,
        "current_path": current_path(request),
        "year": datetime.now().year,
    }
    context.update(extra)
    return context
