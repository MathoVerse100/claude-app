"""Register -> verify-by-email-code flow (DEMO). See services/registration_service.py for the rules."""
from __future__ import annotations

from fastapi import APIRouter, Form, Request
from fastapi.responses import Response

from app.core.config import load_json, settings
from app.core.registry import page_route
from app.core.templating import is_htmx, layout_for, redirect, render
from app.routers.auth import signed_in
from app.services import auth_service, config_service, email_service, registration_service
from app.services.registration_service import FlowError, Pending

router = APIRouter()
NOTICES = {"expired", "attempts", "cancelled"}


def _cookie_name() -> str:
    return load_json("app_config")["cookies"]["registration"]


def _flow_id(request: Request) -> str | None:
    return request.cookies.get(_cookie_name())


def _routes() -> dict[str, str]:
    return load_json("endpoints")["routes"]


def _clear_cookie(response: Response) -> Response:
    response.delete_cookie(_cookie_name(), path="/")
    return response


def _back_to_register(request: Request, reason: str) -> Response:
    return _clear_cookie(redirect(request, f"{_routes()['register']}?reason={reason}"))


def _mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}***@{domain}"


def _card_context(p: Pending, status_key: str | None = None, status_kind: str = "info") -> dict:
    cfg = load_json("app_config")["auth_demo"]
    return {
        "masked_email": _mask(p.email),
        "seconds_left": registration_service.seconds_left(p),
        "cooldown_left": registration_service.cooldown_left(p),
        "resends_left": registration_service.resends_left(p),
        "inbox": email_service.last_message(p.email) if cfg["show_code_on_page"] else None,
        "status_key": status_key,
        "status_kind": status_kind,
    }


def _send_code(p: Pending, code: str, t) -> None:
    minutes = load_json("app_config")["auth_demo"]["code_ttl_minutes"]
    email_service.send_verification(p.email, p.first_name, registration_service.format_code(code), minutes, t)


@page_route(router, "/register")
async def register_page(request: Request) -> Response:
    context = await config_service.build_context(request, layout=layout_for(request))
    if context["session"].authenticated:
        return redirect(request, _routes()["dashboard"])
    reason = request.query_params.get("reason")
    return render(request, "pages/register.html", {**context, "notice_key": f"register.notice_{reason}" if reason in NOTICES else None})


ERROR_SLOTS = ["first_name", "last_name", "name", "username", "email", "password", "confirm_password"]


@router.post("/auth/register")
async def register(
    request: Request,
    first_name: str = Form(""),
    last_name: str = Form(""),
    username: str = Form(""),
    email: str = Form(""),
    password: str = Form(""),
    confirm_password: str = Form(""),
) -> Response:
    """Step 1: validate, create a PENDING registration, 'email' a code. No account, no session yet."""
    context = await config_service.build_context(request)
    try:
        clean = auth_service.check_registration(first_name, last_name, username, email, password, confirm_password)
        flow_id, code, pending = registration_service.start(
            clean["first_name"], clean["last_name"], clean["username"], clean["email"],
            auth_service.hash_password(password), context["lang"],
        )
    except auth_service.RegistrationError as exc:
        # Each message is swapped in under its own field (hx-swap-oob); a summary goes to the form's alert area.
        return render(request, "partials/register_errors.html", {**context, "slots": ERROR_SLOTS, "errors": exc.errors}, status_code=422)
    except FlowError:  # too many pending registrations
        return render(request, "partials/auth_error.html", {**context, "error_key": "register.error_busy"}, status_code=503)
    _send_code(pending, code, context["t"])
    response = redirect(request, _routes()["register_verify"])
    # Session cookie (no Max-Age): never persisted by the browser. The server enforces the real lifetime.
    response.set_cookie(_cookie_name(), flow_id, httponly=True, samesite="lax", secure=settings.secure_cookies, path="/")
    return response


@page_route(router, "/register/verify")
async def verify_page(request: Request) -> Response:
    pending = registration_service.touch(_flow_id(request), page_load=True)
    if pending is None:
        return _back_to_register(request, "expired")
    context = await config_service.build_context(request, layout=layout_for(request), **_card_context(pending))
    response = render(request, "pages/register_verify.html", context)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/auth/register/verify")
async def verify(request: Request, code: str = Form("")) -> Response:
    """Step 2: the emailed one-time code creates the account and signs the user in."""
    try:
        pending = registration_service.verify(_flow_id(request), code)
    except FlowError as exc:
        if exc.code in ("expired", "attempts"):
            return _back_to_register(request, exc.code)
        context = await config_service.build_context(request, error_key="register.error_code", error_n=exc.data["left"])
        return render(request, "partials/auth_error.html", context, status_code=422)
    auth_service.create_user(pending.first_name, pending.last_name, pending.username, pending.email, pending.password_hash)
    context = await config_service.build_context(request)
    return _clear_cookie(signed_in(request, auth_service.issue_session(pending.email), _routes()["dashboard"]))


@router.post("/auth/register/resend")
async def resend(request: Request) -> Response:
    context = await config_service.build_context(request)
    try:
        code, pending = registration_service.resend(_flow_id(request))
    except FlowError as exc:
        pending = registration_service.lookup(_flow_id(request))
        if pending is None:
            return _back_to_register(request, "expired")
        key = "register.error_cooldown" if exc.code == "cooldown" else "register.error_limit"
        context.update(_card_context(pending, key, "error"))
    else:
        _send_code(pending, code, context["t"])
        context.update(_card_context(pending, "register.resent", "info"))
    return render(request, "partials/register_verify_card.html", context)


@router.post("/auth/register/cancel")
async def cancel(request: Request) -> Response:
    registration_service.cancel(_flow_id(request))
    return _back_to_register(request, "cancelled")


@router.get("/auth/register/ping")
async def ping(request: Request) -> Response:
    """Heartbeat from the open verify page. If the flow is gone, send the user back to the form."""
    if registration_service.touch(_flow_id(request)) is None:
        return _back_to_register(request, "expired")
    response = Response(status_code=204)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/auth/register/leave")
async def leave(request: Request) -> Response:
    """pagehide beacon: the page is going away (close, navigate, reload). A quick reload resumes; later loads do not."""
    registration_service.mark_leaving(_flow_id(request))
    return Response(status_code=204)
