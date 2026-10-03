"""Pydantic settings and the JSON "UI DB" loader."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DATAVERSE_", env_file=".env", extra="ignore")

    config_dir: Path = BASE_DIR / "config"
    templates_dir: Path = BASE_DIR / "templates"
    static_dir: Path = BASE_DIR / "static"
    # Base URL of the external auth/data API (unused while services are mocked).
    api_base_url: str = "http://localhost:9000"
    # Set to true behind HTTPS so cookies are only sent over secure transport.
    secure_cookies: bool = False


settings = Settings()

# name -> (mtime, parsed). Re-reads a file only when it changes on disk, so
# editing the JSON "UI DB" is picked up without restarting the server.
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def load_json(name: str) -> dict[str, Any]:
    path = settings.config_dir / f"{name}.json"
    mtime = path.stat().st_mtime
    cached = _cache.get(name)
    if cached and cached[0] == mtime:
        return cached[1]
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    _cache[name] = (mtime, data)
    return data
