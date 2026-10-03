"""Registry of full-page GET handlers, keyed by path.

The language switcher re-renders whichever page the user is on (taken from the
``HX-Current-URL`` header) by calling that page's handler, so every page keeps
working with in-place HTMX swaps.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import Response

PageHandler = Callable[[Request], Awaitable[Response]]
PAGE_HANDLERS: dict[str, PageHandler] = {}


def page_route(router: APIRouter, path: str):
    """Register ``path`` as a GET route and make it re-renderable by the preference engine."""

    def decorator(fn: PageHandler) -> PageHandler:
        PAGE_HANDLERS[path] = fn
        return router.get(path)(fn)

    return decorator
