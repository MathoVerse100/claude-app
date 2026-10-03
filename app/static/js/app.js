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

  // The server re-renders the page in the new language and announces its direction so the
  // whole document mirrors (dir comes from config/app_config.json -> locales[].dir / direction.force).
  document.addEventListener("languageChanged", function (e) {
    var d = e.detail || {};
    if (d.lang) document.documentElement.lang = d.lang;
    if (d.dir) document.documentElement.dir = d.dir;
    if (d.title) document.title = d.title;
  });

  // The swap replaces the dropdown that had focus; hand focus to its replacement (keyboard/screen-reader users).
  document.addEventListener("htmx:afterSwap", function (e) {
    if (e.detail.target && e.detail.target.id === "app-shell" && e.detail.requestConfig.path.indexOf("/preferences/language") === 0) {
      var btn = document.querySelector('[data-menu="language"] button');
      if (btn && btn.offsetParent !== null) btn.focus({ preventScroll: true });
    }
  });

  // Registration step 2: tell the server when this page goes away. A reload comes straight back (allowed);
  // closing the tab and reopening it later (Ctrl+Shift+T) finds the registration gone. See registration_service.
  window.addEventListener("pagehide", function () {
    var flow = document.querySelector("[data-register-flow]");
    if (flow && navigator.sendBeacon) navigator.sendBeacon(flow.dataset.leaveUrl);
  });

  // Dropdown behaviour shared by the language and theme selectors (keyboard + focus management).
  document.addEventListener("alpine:init", function () {
    // Counts down `seconds` (from when the page was rendered). At zero it optionally hits `expireUrl`,
    // so the server can redirect an expired flow back to the form.
    window.Alpine.data("countdown", function (seconds, expireUrl) {
      return {
        left: seconds,
        end: 0,
        timer: null,
        init: function () {
          var self = this;
          this.end = Date.now() + seconds * 1000;
          this.timer = setInterval(function () { self.tick(); }, 1000);
        },
        tick: function () {
          this.left = Math.max(0, Math.ceil((this.end - Date.now()) / 1000));
          if (this.left === 0) {
            clearInterval(this.timer);
            if (expireUrl && window.htmx) window.htmx.ajax("GET", expireUrl, { swap: "none" });
          }
        },
        get text() {
          return Math.floor(this.left / 60) + ":" + ("0" + (this.left % 60)).slice(-2);
        },
        destroy: function () { clearInterval(this.timer); }
      };
    });

    window.Alpine.data("selectMenu", function () {
      return {
        open: false,
        options: function () { return Array.prototype.slice.call(this.$refs.list.querySelectorAll('[role="option"]')); },
        show: function () {
          var self = this;
          this.open = true;
          this.$nextTick(function () {
            var o = self.options();
            var current = o.filter(function (x) { return x.getAttribute("aria-selected") === "true"; })[0];
            (current || o[0]).focus();
          });
        },
        hide: function (returnFocus) {
          this.open = false;
          if (returnFocus !== false) this.$refs.button.focus();
        },
        move: function (step) {
          var o = this.options();
          var i = o.indexOf(document.activeElement);
          o[(i + step + o.length) % o.length].focus();
        },
        edge: function (last) {
          var o = this.options();
          o[last ? o.length - 1 : 0].focus();
        }
      };
    });
  });
})();
