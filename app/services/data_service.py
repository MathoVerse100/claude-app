"""External data API placeholder: deterministic mock metrics per range."""
from __future__ import annotations

import random

from app.core.config import load_json
from app.models.schemas import Kpi, MetricsSnapshot

_POINTS = {"24h": 24, "7d": 14, "30d": 30}
_KPIS = {
    "24h": [("records", "312M", "+4.1%", "up"), ("latency", "182 ms", "-6.0%", "up"), ("uptime", "100%", "0.0%", "up")],
    "7d": [("records", "2.4B", "+12.8%", "up"), ("latency", "176 ms", "-3.2%", "up"), ("uptime", "99.99%", "+0.01%", "up")],
    "30d": [("records", "9.7B", "+18.4%", "up"), ("latency", "191 ms", "+1.5%", "down"), ("uptime", "99.97%", "-0.01%", "down")],
}


async def get_metrics(range_: str) -> MetricsSnapshot:
    if range_ not in _POINTS:
        range_ = "7d"
    rng = random.Random(f"dataverse-{range_}")
    series, level = [], 45
    for _ in range(_POINTS[range_]):
        level = min(100, max(8, level + rng.randint(-14, 18)))
        series.append(level)
    return MetricsSnapshot(
        range=range_,
        kpis=[Kpi(key=k, value=v, delta=d, trend=t) for k, v, d, t in _KPIS[range_]],
        series=series,
    )


async def load_metrics(range_: str | None = None) -> MetricsSnapshot:
    """Metrics for ``range_`` if it is a configured range, else the configured default."""
    cfg = load_json("app_config")["metrics"]
    return await get_metrics(range_ if range_ in cfg["ranges"] else cfg["default_range"])
