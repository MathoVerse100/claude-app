"""Isolated navbar pages: About, Stories, News and Contacts."""
from __future__ import annotations

import re

from fastapi import APIRouter, Form, Request
from fastapi.responses import Response

from app.core.registry import page_route
from app.core.templating import layout_for, render
from app.services import config_service, data_service

router = APIRouter()
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def _page(request: Request, page_id: str, **extra) -> Response:
    context = await config_service.build_context(request, layout=layout_for(request), page_id=page_id, **extra)
    t = context["t"]
    context["page_title"] = f"{t(f'pages.{page_id}.doc')} · {t('brand.name')}"
    return render(request, f"pages/{page_id}.html", context)


@page_route(router, "/about")
async def about(request: Request) -> Response:
    return await _page(request, "about")


@page_route(router, "/stories")
async def stories(request: Request) -> Response:
    return await _page(request, "stories")


@page_route(router, "/news")
async def news(request: Request) -> Response:
    return await _page(request, "news", metrics=await data_service.load_metrics())


@page_route(router, "/contacts")
async def contacts(request: Request) -> Response:
    return await _page(request, "contacts")


@router.post("/contacts/send")
async def contact_send(
    request: Request, name: str = Form(""), email: str = Form(""), message: str = Form("")
) -> Response:
    """Mock inbox: validates the form and confirms; wire to a real API in services/."""
    name, email, message = name.strip(), email.strip(), message.strip()
    ok = bool(name and message and _EMAIL.match(email))
    context = await config_service.build_context(request, ok=ok, name=name)
    return render(request, "partials/contact_result.html", context, status_code=200 if ok else 422)
