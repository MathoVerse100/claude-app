"""Language and theme preference engine (cookie-backed, HTMX-driven)."""
from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse, Response

from app.core.config import load_json
from app.core.registry import PAGE_HANDLERS
from app.core.templating import hx_trigger, is_htmx, set_pref_cookie
from app.services import config_service

router = APIRouter()


@router.post("/preferences/language")
async def set_language(request: Request, lang: str = Form(...)) -> Response:
    if lang not in config_service.supported_locales():
        return Response("Unsupported language", status_code=422)
    if not is_htmx(request):
        redirect = RedirectResponse("/", status_code=303)
        set_pref_cookie(redirect, "lang", lang)
        return redirect
    # Make the new locale visible to this request, then re-render the page the user is on.
    request.cookies[load_json("app_config")["cookies"]["lang"]] = lang
    handler = PAGE_HANDLERS.get(config_service.current_path(request), PAGE_HANDLERS["/"])
    response = await handler(request)
    context = getattr(response, "context", {}) or {}
    title = context.get("page_title") or context["t"]("meta.title") if "t" in context else None
    set_pref_cookie(response, "lang", lang)
    return hx_trigger(response, languageChanged={"lang": lang, "dir": config_service.resolve_direction(lang), "title": title})


@router.post("/preferences/theme")
async def set_theme(request: Request, theme: str = Form(...)) -> Response:
    if theme not in load_json("themes")["themes"]:
        return Response("Unsupported theme", status_code=422)
    if is_htmx(request):
        # Nothing to swap: the client updates data-theme from the event.
        response: Response = Response(status_code=204)
        hx_trigger(response, themeChanged={"theme": theme})
    else:
        response = RedirectResponse("/", status_code=303)
    set_pref_cookie(response, "theme", theme)
    return response
