"""Landing page (scrollable) and its HTMX partials."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app.core.registry import page_route
from app.core.templating import layout_for, render
from app.services import config_service, data_service

router = APIRouter()


@page_route(router, "/")
async def home(request: Request) -> Response:
    """Full document on a normal request; just the shell content on HTMX swaps."""
    context = await config_service.build_context(
        request,
        layout=layout_for(request),
        metrics=await data_service.load_metrics(),
    )
    return render(request, "pages/home.html", context)


@router.get("/partials/session-cta")
async def session_cta(request: Request, variant: str = Query("hero")) -> Response:
    """Hero CTA: "Log In" when anonymous, "Go to Dashboard" with a live session."""
    context = await config_service.build_context(request, variant=variant)
    response = render(request, "partials/session_cta.html", context)
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/partials/metrics")
async def metrics_panel(request: Request, range: str = Query("7d")) -> Response:
    context = await config_service.build_context(request, metrics=await data_service.load_metrics(range))
    return render(request, "partials/metrics.html", context)
