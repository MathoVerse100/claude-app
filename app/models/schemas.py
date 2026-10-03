"""Typed shapes for responses expected from the external auth / data APIs."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: str


class SessionInfo(BaseModel):
    authenticated: bool = False
    user: str | None = None


class Kpi(BaseModel):
    key: Literal["records", "latency", "uptime"]
    value: str
    delta: str
    trend: Literal["up", "down"]


class MetricsSnapshot(BaseModel):
    range: str
    kpis: list[Kpi]
    # Bar heights as 8-100 percentages, oldest first.
    series: list[int]
