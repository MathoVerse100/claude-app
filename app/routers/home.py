"""Landing page, HTMX partials and the language / theme preference engine."""
from __future__ import annotations

from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import RedirectResponse, Response

from app.core.config import load_json
from app.core.templating import hx_trigger, is_htmx, layout_for, render, set_pref_cookie
from app.services import config_service, data_service

router = APIRouter()


async def _home_context(request: Request, metrics_range: str | None = None) -> dict:
    cfg = load_json("app_config")["metrics"]
    if metrics_range not in cfg["ranges"]:
        metrics_range = cfg["default_range"]
    metrics = await data_service.get_metrics(metrics_range)
    return await config_service.build_context(
        request,
        layout=layout_for(request),
        metrics=metrics,
        metrics_range=metrics_range,
    )


@router.get("/")
async def home(request: Request) -> Response:
    """Full document on a normal request; just the shell content on HTMX swaps."""
    return render(request, "pages/home.html", await _home_context(request))


@router.get("/partials/session-cta")
async def session_cta(request: Request, variant: str = Query("hero")) -> Response:
    """Hero CTA: "Log In" when anonymous, "Go to Dashboard" with a live session."""
    context = await config_service.build_context(request, variant=variant)
    response = render(request, "partials/session_cta.html", context)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/partials/metrics")
async def metrics_panel(request: Request, range: str = Query("7d")) -> Response:
    context = await _home_context(request, range)
    return render(request, "partials/metrics.html", context)


@router.post("/preferences/language")
async def set_language(request: Request, lang: str = Form(...)) -> Response:
    supported = config_service.supported_locales()
    if lang not in supported:
        return Response("Unsupported language", status_code=422)
    # Make the new locale visible to this request's context before rendering.
    request.cookies[load_json("app_config")["cookies"]["lang"]] = lang
    if not is_htmx(request):
        redirect = RedirectResponse("/", status_code=303)
        set_pref_cookie(redirect, "lang", lang)
        return redirect
    context = await _home_context(request)
    response = render(request, "pages/home.html", context)
    set_pref_cookie(response, "lang", lang)
    return hx_trigger(response, languageChanged={"lang": lang, "title": context["t"]("meta.title")})


@router.post("/preferences/theme")
async def set_theme(request: Request, theme: str = Form(...)) -> Response:
    if theme not in load_json("themes")["themes"]:
        return Response("Unsupported theme", status_code=422)
    request.cookies[load_json("app_config")["cookies"]["theme"]] = theme
    if not is_htmx(request):
        redirect = RedirectResponse("/", status_code=303)
        set_pref_cookie(redirect, "theme", theme)
        return redirect
    context = await config_service.build_context(request)
    response = render(request, "components/theme_pill.html", context)
    set_pref_cookie(response, "theme", theme)
    return hx_trigger(response, themeChanged={"theme": theme})
