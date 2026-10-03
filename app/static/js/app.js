/* HTMX glue: theme + language events fired by the server via HX-Trigger. */
(function () {
  "use strict";

  // htmx 2 skips swapping 4xx responses by default; allow 422 so form errors render.
  document.addEventListener("htmx:beforeSwap", function (e) {
    if (e.detail.xhr.status === 422) {
      e.detail.shouldSwap = true;
      e.detail.isError = false;
    }
  });

  document.addEventListener("themeChanged", function (e) {
    var theme = e.detail && e.detail.theme;
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    var bg = getComputedStyle(document.documentElement).getPropertyValue("--c-bg").trim().split(/\s+/);
    if (meta && bg.length === 3) {
      meta.content = "#" + bg.map(function (n) { return ("0" + (+n).toString(16)).slice(-2); }).join("");
    }
    // Sync every theme dropdown (desktop + drawer) without a re-render.
    document.querySelectorAll('[data-menu="theme"]').forEach(function (menu) {
      menu.querySelectorAll("[role=option]").forEach(function (opt) {
        var on = opt.dataset.value === theme;
        opt.setAttribute("aria-selected", on ? "true" : "false");
        if (on) menu.querySelector(".menu-current").textContent = opt.dataset.label;
      });
    });
    window.dispatchEvent(new Event("dataverse:theme"));
  });

  document.addEventListener("languageChanged", function (e) {
    var d = e.detail || {};
    if (d.lang) document.documentElement.lang = d.lang;
    if (d.title) document.title = d.title;
  });
})();
