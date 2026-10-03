"""Lookups over the JSON UI DB and the Jinja context builder."""
from __future__ import annotations

import copy
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


def _rgb(triplet: str) -> tuple[int, int, int]:
    r, g, b = (int(x) for x in triplet.split())
    return r, g, b


def _luminance(rgb: tuple[int, int, int]) -> float:
    def channel(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    hi, lo = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def resolve_themes() -> dict[str, Any]:
    """themes.json with text colours resolved (see its `text_contrast`) and a swatch for every theme."""
    themes = copy.deepcopy(load_json("themes"))
    rules = themes.get("text_contrast", {})
    on_dark, on_light = rules.get("on_dark", "255 255 255"), rules.get("on_light", "0 0 0")
    for theme in themes["themes"].values():
        tokens = theme["tokens"]
        if theme.get("text_contrast", rules.get("mode", "auto")) == "auto":
            for token, against in rules.get("apply_to", {"fg": "bg", "accent-fg": "accent"}).items():
                background = _rgb(tokens[against])
                best = max((on_dark, on_light), key=lambda c: _contrast(_rgb(c), background))
                tokens[token] = best
        theme["swatch"] = theme.get("swatch") or tokens["bg"]
    return themes


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
    """Resolve the visible text of any configurable link (card, section or button).

    Sources, most specific first:
    1. ``link.label_key``  - any i18n key (shared, translated)
    2. ``link.label``      - literal text, or a ``{"en": "...", "es": "..."}`` per-locale map
    3. ``link_label``      - copy that lives with the thing being linked, in i18n
                             (``text`` is that i18n dict, e.g. features.card.<id> or the section's namespace)
    4. ``default_key``     - the global default (common.card_link for cards, common.learn_more for sections)
    A missing or disabled (``"enabled": false``) link has no text.
    """
    default_locale = load_json("app_config")["app"]["default_locale"]

    def link_label(link: dict[str, Any] | None, text: Any = None, default_key: str = "common.card_link") -> str:
        if not link or link.get("enabled", True) is False:
            return ""
        if link.get("label_key"):
            return t(link["label_key"])
        label = link.get("label")
        if isinstance(label, dict):
            return label.get(lang) or label.get(default_locale) or next(iter(label.values()), "")
        if label:
            return str(label)
        if isinstance(text, dict) and text.get("link_label"):
            return text["link_label"]
        return t(default_key)

    return link_label


async def build_context(request: Request, **extra: Any) -> dict[str, Any]:
    """Context shared by every template: config maps, i18n, theme, session."""
    lang, theme = resolve_lang(request), resolve_theme(request)
    session = await auth_service.validate_token(get_token(request))
    context: dict[str, Any] = {
        "config": {
            "app": load_json("app_config"),
            "endpoints": load_json("endpoints"),
            "themes": resolve_themes(),
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
