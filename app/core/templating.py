"""Shared Jinja2 environment and HTMX-aware response helpers."""
from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from fastapi.responses import RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from app.core.config import load_json, settings
from app.core.links import active_link, href, is_external, link_attrs

templates = Jinja2Templates(directory=str(settings.templates_dir))
templates.env.globals.update(active_link=active_link, href=href, is_external=is_external, link_attrs=link_attrs)

FULL_LAYOUT = "base.html"
SHELL_LAYOUT = "partials/shell_only.html"


def is_htmx(request: Request) -> bool:
    return request.headers.get("hx-request") == "true"


def layout_for(request: Request) -> str:
    """Full document for normal navigations, bare shell for HTMX swaps."""
    return SHELL_LAYOUT if is_htmx(request) else FULL_LAYOUT


def render(request: Request, name: str, context: dict[str, Any], status_code: int = 200) -> Response:
    response = templates.TemplateResponse(request, name, context, status_code=status_code)
    # Same URL yields a full page or a fragment: caches must key on HX-Request.
    response.headers["Vary"] = "HX-Request"
    return response


def redirect(request: Request, url: str) -> Response:
    """Send the user elsewhere: HX-Redirect for HTMX requests (a plain 303 would swap the target page into a fragment)."""
    if is_htmx(request):
        response = Response(status_code=204)
        response.headers["HX-Redirect"] = url
        return response
    return RedirectResponse(url, status_code=303)


def hx_trigger(response: Response, **events: Any) -> Response:
    response.headers["HX-Trigger"] = json.dumps(events)
    return response


def set_pref_cookie(response: Response, key: str, value: str) -> None:
    cfg = load_json("app_config")["cookies"]
    response.set_cookie(
        cfg[key],
        value,
        max_age=cfg["max_age_days"] * 86400,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )
