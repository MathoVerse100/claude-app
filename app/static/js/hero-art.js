/*
 * Animated hero art: ONE full-bleed canvas behind the hero copy (<canvas data-hero-art="hero">).
 *
 *   bars    - bars along the bottom (and hanging from the top-right) that ease to new random
 *             heights at random moments while drifting sideways. Lower/dimmer behind the copy.
 *   ripples - expanding rings that make the bars bob and glow as each ring passes, so the screen
 *             itself seems to ripple. One starts every `ripple_interval_seconds`, and a click/tap
 *             on any non-interactive spot of the hero starts one under the cursor.
 *             (config/app_config.json -> hero_art)
 *
 * Seamless swaps: animation state lives here, keyed by the canvas's data-hero-art value, so when
 * HTMX replaces the DOM (e.g. a language change) the new canvas adopts the running state and is
 * painted synchronously in `htmx:afterSwap` - no blank frame, no restart.
 *
 * Colours come from the theme tokens (--c-bar / --c-bar-tip). RTL documents mirror the drawing.
 * Pauses off-screen / in background tabs; prefers-reduced-motion gets one static frame.
 * Emits `heroart:ripple` ({detail: {source: "auto"|"click"}}) on document whenever a ripple starts.
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DRIFT = 0.22;   // bar widths per second
  var EASE = 3.2;
  var TAU = Math.PI * 2;
  var MAX_AGE = 4.6;  // seconds a ripple lives
  var MAX_DROPS = 6;
  // Clicks on these never make a ripple (the user is using the page, not poking the background).
  var INTERACTIVE = 'a[href],button,input,select,textarea,label,summary,[role="button"],[role="option"],' +
    '[role="tab"],[role="listbox"],[role="dialog"],[contenteditable],[data-menu],[tabindex]:not([tabindex="-1"])';

  var charts = [];
  var colors = { bar: "150,170,190", tip: "230,240,250" };
  var art = { interval: 10, clicks: true };
  var raf = 0;
  var last = 0;
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(onIntersect) : null;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function rgba(rgb, a) { return "rgba(" + rgb + "," + a + ")"; }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return (v || fallback).split(/\s+/).join(",");
  }
  function readColors() {
    colors.bar = token("--c-bar", "150 170 190");
    colors.tip = token("--c-bar-tip", "230 240 250");
  }
  function readConfig() {
    var el = document.getElementById("hero-art-config");
    if (!el) return;
    try {
      var c = JSON.parse(el.textContent);
      if (+c.ripple_interval_seconds > 0) art.interval = +c.ripple_interval_seconds;
      if (typeof c.click_ripples === "boolean") art.clicks = c.click_ripples;
    } catch (e) { /* keep defaults */ }
  }

  /* ───────────── ripples: shared state + their effect on the bars ───────────── */
  function spawnDrop(s, x, y, strong, source) {
    s.drops.push({
      x: x, y: y, age: 0,
      amp: strong ? 1 : 0.8, k: rand(0.07, 0.09), c: rand(260, 330), sigma: rand(80, 105)
    });
    if (s.drops.length > MAX_DROPS) s.drops.shift();
    document.dispatchEvent(new CustomEvent("heroart:ripple", { detail: { source: source } }));
  }
  function ripplesUpdate(s, dt) {
    s.timer -= dt;
    if (s.timer <= 0) {
      spawnDrop(s, rand(0.1, 0.9) * s.w, rand(0.15, 0.85) * s.h, false, "auto");
      s.timer = art.interval;
    }
    for (var i = s.drops.length - 1; i >= 0; i--) {
      s.drops[i].age += dt;
      if (s.drops[i].age > MAX_AGE) s.drops.splice(i, 1);
    }
  }
  // How strongly ripples are pushing (pulse, signed) and lighting up (glow) the point (x, y).
  function rippleAt(s, x, y) {
    var pulse = 0, glow = 0;
    for (var i = 0; i < s.drops.length; i++) {
      var d = s.drops[i];
      var off = Math.hypot(x - d.x, y - d.y) - d.c * d.age; // distance from the ring front
      var env = Math.exp(-(off * off) / (2 * d.sigma * d.sigma));
      if (env < 0.01) continue;
      var life = (1 - d.age / MAX_AGE) * d.amp;
      pulse += env * life * Math.sin(d.k * off);
      glow += env * life;
    }
    return { pulse: pulse, glow: glow };
  }
  function ringsDraw(s) {
    var ctx = s.ctx;
    ctx.strokeStyle = rgba(colors.tip, 1);
    s.drops.forEach(function (d) {
      var life = 1 - d.age / MAX_AGE;
      for (var j = 0; j < 3; j++) { // a leading ring and two fainter trailing ones
        var r = d.c * d.age - j * 46;
        if (r < 2) continue;
        ctx.globalAlpha = Math.max(0, life * d.amp * (0.5 - j * 0.15));
        ctx.lineWidth = 2.2 - j * 0.6;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, 0, TAU);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  /* ───────────── bars ───────────── */
  // hf: max height as a share of the canvas at horizontal position p (0 = start edge, 1 = end edge).
  // The start side is lower and dimmer so it can sit under the headline; the end side is tall.
  var LAYERS = [
    { top: false, scale: 1,
      hf: function (p) { return 0.34 + 0.51 * smooth(0.2, 1, p); },
      alpha: function (p) { return 0.4 + 0.55 * smooth(0.1, 0.9, p); } },
    { top: true, scale: 0.5,
      hf: function (p) { return 0.4 * smooth(0.55, 1, p); },
      alpha: function (p) { return 0.5 + 0.4 * smooth(0.55, 1, p); } }
  ];
  function makeBars(count) {
    var bars = [];
    for (var i = 0; i < count + 2; i++) {
      bars.push({ u: i - 1, v: Math.random(), target: Math.random(), timer: Math.random() * 2 });
    }
    return bars;
  }
  function barsInit(s) {
    s.layers = LAYERS.map(function (L) {
      var count = Math.max(4, Math.round(s.barCount * L.scale));
      return { count: count, bars: makeBars(count) };
    });
  }
  function barsUpdate(s, dt) {
    s.layers.forEach(function (l) {
      var span = l.count + 2;
      for (var i = 0; i < l.bars.length; i++) {
        var b = l.bars[i];
        b.u -= DRIFT * dt;
        if (b.u < -1) { b.u += span; b.target = Math.random(); }
        b.timer -= dt;
        if (b.timer <= 0) { b.target = 0.08 + 0.92 * Math.random(); b.timer = rand(0.5, 2.3); }
        b.v += (b.target - b.v) * (1 - Math.exp(-EASE * dt));
      }
    });
  }
  function barsDraw(s) {
    var ctx = s.ctx, w = s.w, h = s.h, small = w < 640 ? 0.62 : 1, hasDrops = s.drops.length > 0;
    s.layers.forEach(function (l, li) {
      var L = LAYERS[li], step = w / l.count, barW = step * 0.62;
      for (var i = 0; i < l.bars.length; i++) {
        var b = l.bars[i];
        var x = b.u * step + (step - barW) / 2;
        var p = Math.min(1, Math.max(0, (x + barW / 2) / w));
        var bh = (0.06 + 0.94 * b.v) * L.hf(p) * small * h;
        if (bh < 3) continue;
        var alpha = L.alpha(p);
        if (hasDrops) { // a passing ring lifts/lowers the bar and lights it up
          var r = rippleAt(s, x + barW / 2, L.top ? bh : h - bh);
          bh = Math.min(h * 0.97, bh * Math.max(0.25, 1 + 0.55 * r.pulse));
          alpha = Math.min(1, alpha + 0.5 * r.glow);
        }
        var y = L.top ? 0 : h - bh;
        var g = ctx.createLinearGradient(0, L.top ? bh : y, 0, L.top ? 0 : h);
        g.addColorStop(0, rgba(colors.tip, 0.9));
        g.addColorStop(1, rgba(colors.bar, 0.1));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, 3); else ctx.rect(x, y, barW, bh);
        ctx.fill();
        ctx.fillStyle = rgba(colors.tip, 1);
        ctx.fillRect(x, L.top ? bh - 2 : y, barW, 2);
      }
    });
    ctx.globalAlpha = 1;
  }

  /* ───────────── charts + loop ───────────── */
  function size(s) {
    var c = s.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) { s.w = 0; return; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rtl = document.documentElement.dir === "rtl";
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    s.ctx = c.getContext("2d");
    // In RTL the whole drawing is mirrored so drift direction and the tall side flip too.
    s.ctx.setTransform(rtl ? -dpr : dpr, 0, 0, dpr, rtl ? c.width : 0, 0);
    s.w = w;
    s.h = h;
    s.rtl = rtl;
    var count = Math.max(8, Math.round(w / (w < 640 ? 22 : 34)));
    if (count !== s.barCount) { s.barCount = count; barsInit(s); }
  }
  function build(canvas, key) {
    var s = { key: key, canvas: canvas, visible: true, w: 0, barCount: 0, drops: [], timer: Math.min(art.interval, 3) };
    size(s); // creates the bar layers
    return s;
  }

  function render(s, dt) {
    if (!s.w) return;
    if (dt) { barsUpdate(s, dt); ripplesUpdate(s, dt); }
    s.ctx.clearRect(0, 0, s.w, s.h);
    barsDraw(s);
    ringsDraw(s);
  }

  function frame(ts) {
    raf = 0;
    var dt = Math.min(Math.max((ts - last) / 1000, 0), 0.05), active = false;
    last = ts;
    for (var i = 0; i < charts.length; i++) {
      if (!charts[i].w || !charts[i].visible) continue;
      active = true;
      render(charts[i], dt);
    }
    if (active && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (reduced) return;
    if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function onIntersect(entries) {
    entries.forEach(function (e) {
      charts.forEach(function (s) { if (s.canvas === e.target) s.visible = e.isIntersecting; });
    });
    kick();
  }

  function scan() {
    readConfig();
    readColors();
    document.querySelectorAll("canvas[data-hero-art]").forEach(function (c) {
      var key = c.dataset.heroArt || "hero";
      var s = charts.filter(function (x) { return x.key === key; })[0];
      if (!s) {
        s = build(c, key);
        charts.push(s);
        if (observer) observer.observe(c);
      } else if (s.canvas !== c) {            // HTMX swapped the DOM: adopt the running animation
        if (observer && s.canvas) observer.unobserve(s.canvas);
        s.canvas = c;
        if (observer) observer.observe(c);
        size(s);
      } else {
        size(s);
      }
      render(s, 0);                           // paint immediately: no blank frame
    });
    charts = charts.filter(function (s) { return s.canvas.isConnected; });
    kick();
  }

  // Click/tap on the hero background (anything that is not a control) -> ripple under the cursor.
  document.addEventListener("pointerdown", function (e) {
    if (!art.clicks || reduced || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest && e.target.closest(INTERACTIVE)) return;
    charts.forEach(function (s) {
      if (!s.w || !s.visible) return;
      var r = s.canvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      var x = e.clientX - r.left;
      spawnDrop(s, s.rtl ? s.w - x : x, e.clientY - r.top, true, "click"); // drawing space is mirrored in RTL
    });
    kick();
  });

  var timer;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(scan, 150); });
  document.addEventListener("DOMContentLoaded", scan);
  document.addEventListener("htmx:afterSwap", scan); // synchronous with the swap, before the next paint
  window.addEventListener("dataverse:theme", function () { readColors(); charts.forEach(function (s) { render(s, 0); }); kick(); });
  document.addEventListener("visibilitychange", kick);
})();
