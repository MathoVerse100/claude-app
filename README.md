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

`app/services/auth_service.py` stands in for the external auth API. Everything here is in memory and resets on restart.

**Login** (`/login`): a verified registrant must use their real password; a registration still waiting for its code
cannot log in; anyone else may log in with any valid email + 6+ character password
(`auth_demo.allow_unregistered_login: false` in `app_config.json` makes that "registered users only").

**Register** is two steps, and the person is **not a user until step 2**:

1. `/register`: first name, last name, username, email, password, confirmation. This creates only a *pending* registration and
   "emails" a secret one-time code (8 characters, `XXXX-XXXX`). No account, no session. Rules, all checked at once with a
   message under each field:
   - **Username** (case-sensitive, unique, never used before): at least 3 characters (`username_min_length`, max
     `username_max_length` = 32), English letters, digits 0-9, dashes and underscores only, no spaces. `Ana` and `ana` are
     different usernames.
   - **Email**: valid and unique (compared case-insensitively).
   - **First + last name**: each may repeat on its own, but the *pair* must be unique (compared ignoring case and extra spaces).
   - **Password**: 6+ characters, confirmed.
   A pending registration reserves its username and name pair until it expires or is cancelled.
   Demo values that are "already used": email `taken@example.com`, usernames `taken_user` and `admin`, name `Taken User`.
2. `/register/verify`: type the code. Correct -> the account is created and the user is signed in.

The code expires after **15 minutes** (`code_ttl_minutes`), allows 5 wrong tries, can be resent (3 times, 30 s apart; a new
code kills the old one) and works once. Only a hash is stored, and the flow is bound to a **session cookie** (`dv_reg`) so the
code is useless in another browser.

**Closing the page ends the registration**, however much of the 15 minutes is left. The open verify page pings the server
every 15 s and sends a `pagehide` beacon when it goes away. Loading the page again more than `rejoin_grace_seconds` (5 s)
after that - e.g. reopening the tab with Ctrl+Shift+T - finds the registration gone and sends the user back to the form with a
notice. A reload within the grace window resumes. If no beacon arrives (browser crash/kill), loading the page fails once the
page has been silent for `heartbeat_timeout_seconds` (120 s). Leaving the verify page for any other page also cancels it.

**Email** is a demo: the message is logged to the server console (`[demo mail] ...`) and, while `show_code_on_page` is true,
shown in a "Demo inbox" box on the verify page. For real email, replace `send_verification()` in
`app/services/email_service.py` and set `show_code_on_page` to false.

All knobs are in `app_config.json` -> `auth_demo`. Swap the function bodies for real HTTP calls when your API is ready
(`check_registration()` should keep raising `RegistrationError("invalid" | "mismatch" | "taken")`).
