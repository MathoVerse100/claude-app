# DataVerse UI

Server-driven landing site: FastAPI + Jinja2 + HTMX + Alpine, styled with Tailwind. All copy, themes,
routes, cards and link targets live in `app/config/*.json` (the "UI DB").

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload        # http://127.0.0.1:8000
```

## Front-end build (only when you change templates/classes or theme tokens)

Tailwind is compiled locally (no CDN) and HTMX/Alpine are vendored, so the app has no runtime
third-party script dependencies. The compiled output is committed, so running the server needs no Node.

```bash
npm install
npm run build        # vendors htmx/alpine + compiles app/static/css/tailwind.css
npm run watch:css    # rebuild CSS on change
```

Config highlights: `app_config.json` (locales + `dir`, `direction.force`, `hero_art.ripple_interval_seconds` / `click_ripples`), `home.json` (home
sections and link targets), `cards.json` (cards and optional links), `themes.json` (palettes), `i18n.json`.

## Links (cards, sections, hero button)

Every link uses one format, in `app/config/cards.json` (per card) and `app/config/home.json` (per section, plus the
hero's secondary button). Each is **pluggable** (add a `link`) and **removable** (delete it, or set `"enabled": false`):

```json
"link": {"route": "news",            // or "href": "https://..." (+ "external": true for a new tab)
         "label": {"en": "Read the news", "es": "Leer las noticias"},   // or a string, or "label_key": "some.i18n.key"
         "icon": "arrow",            // any icon name, or false for none
         "enabled": true}
```

Text order: `label_key` -> `label` -> the item's own `link_label` in `i18n.json` (e.g. `how.link_label` for a section,
`features.card.<id>.link_label` for a card) -> the default (`common.learn_more` for sections, `common.card_link` for cards).

## Card links

Each card in `app/config/cards.json` can have its own optional `link`:

```json
{"id": "realtime", "icon": "bolt",
 "link": {"route": "news",                       // or "href": "https://..." (+ "external": true)
          "label": {"en": "Read the news", "es": "Leer las noticias"},  // or a plain string, or "label_key": "some.i18n.key"
          "icon": "arrow"}}                       // any icon name, or false for none
```

Label order: `label_key` -> `label` -> the card's own `link_label` in `i18n.json` -> `common.card_link`.

## Theme colours

In `app/config/themes.json`:

- `swatch` - the circle shown for a theme in the dropdown (RGB triplet; defaults to the theme's `bg`).
- `text_contrast` - with `"mode": "auto"` the text colours (`fg`, and `accent-fg` on accent buttons) are chosen
  from `on_dark` / `on_light` by contrast against the background they sit on, so dark screens always get white
  text and light screens black, even for new themes. Set `"mode": "manual"` (globally, or per theme with
  `"text_contrast": "manual"`) to use the literal values in `tokens` instead.

## Demo auth

`app/services/auth_service.py` is a stand-in for the external auth API. **Login** accepts any valid email + a 6+ character
password. **Register** (`/register`) asks for name, email, password and confirmation, validates them, and signs the new
user in; nothing is stored (`taken@example.com` simulates an existing account). Session = `HttpOnly` cookie `dv_token`.
Swap the function bodies for real HTTP calls when your API is ready; `register()` should keep raising
`RegistrationError("invalid" | "mismatch" | "taken")` so the form can explain what went wrong.
