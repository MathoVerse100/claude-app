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
