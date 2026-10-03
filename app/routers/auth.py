"""Login / logout and the (placeholder) application core behind the CTA."""
from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse, Response

from app.core.config import load_json, settings
from app.core.security import token_cookie_name
from app.core.registry import page_route
from app.core.templating import is_htmx, layout_for, render
from app.services import auth_service, config_service

router = APIRouter()


@page_route(router, "/login")
async def login_page(request: Request) -> Response:
    context = await config_service.build_context(request, layout=layout_for(request))
    if context["session"].authenticated:
        return RedirectResponse(context["config"]["endpoints"]["routes"]["dashboard"], status_code=303)
    return render(request, "pages/login.html", context)


@router.post("/auth/login")
async def login(request: Request, email: str = Form(...), password: str = Form(...)) -> Response:
    token = await auth_service.login(email, password)
    context = await config_service.build_context(request)
    dashboard = context["config"]["endpoints"]["routes"]["dashboard"]
    if token is None:
        return render(request, "partials/login_error.html", context, status_code=422)
    response = Response(status_code=204) if is_htmx(request) else RedirectResponse(dashboard, status_code=303)
    if is_htmx(request):
        response.headers["HX-Redirect"] = dashboard
    response.set_cookie(
        token_cookie_name(),
        token.access_token,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )
    return response


@router.post("/auth/logout")
async def logout(request: Request) -> Response:
    home = load_json("endpoints")["routes"]["home"]
    response = Response(status_code=204) if is_htmx(request) else RedirectResponse(home, status_code=303)
    if is_htmx(request):
        response.headers["HX-Redirect"] = home
    response.delete_cookie(token_cookie_name(), path="/")
    return response


@page_route(router, "/dashboard")
async def dashboard(request: Request) -> Response:
    context = await config_service.build_context(request, layout=layout_for(request))
    if not context["session"].authenticated:
        return RedirectResponse(context["config"]["endpoints"]["routes"]["login"], status_code=303)
    return render(request, "pages/dashboard.html", context)
