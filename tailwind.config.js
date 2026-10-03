/** Tailwind build config. Colour tokens come from the same themes.json the server uses,
 *  exposed as CSS variables (see base.html), so themes stay config-driven. */
const themes = require("./app/config/themes.json");

const tokens = Object.keys(themes.themes[themes.default].tokens);
const colors = Object.fromEntries(tokens.map((k) => [k, `rgb(var(--c-${k}) / <alpha-value>)`]));

module.exports = {
  content: ["./app/templates/**/*.html", "./app/static/js/*.js"],
  theme: { extend: { colors, fontFamily: { sans: themes.typography.sans } } },
};
