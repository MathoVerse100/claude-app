from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import auth, home, pages, preferences, registration

app = FastAPI(title="DataVerse", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
app.include_router(home.router)
app.include_router(pages.router)
app.include_router(preferences.router)
app.include_router(registration.router)
app.include_router(auth.router)
