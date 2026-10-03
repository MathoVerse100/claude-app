/*
 * Animated hero art: ONE full-bleed canvas behind the hero copy
 * (<canvas data-hero-art="hero">). Two scenes alternate with a cross-fade
 * (config/app_config.json -> hero_art):
 *
 *   bars    - bars along the bottom (and hanging from the top-right) that ease to new random
 *             heights at random moments while drifting sideways. Dimmer/lower behind the copy.
 *   ripples - the whole screen as a surface of wavy lines; random "drops" send expanding rings
 *             through it, so the screen itself appears to ripple.
 *
 * Seamless swaps: animation state lives here, keyed by the canvas's data-hero-art value, so when
 * HTMX replaces the DOM (e.g. a language change) the new canvas adopts the running state and is
 * painted synchronously in `htmx:afterSwap` - no blank frame, no restart.
 *
 * Colours come from the theme tokens (--c-bar / --c-bar-tip). RTL documents mirror the drawing.
 * Pauses off-screen / in background tabs; prefers-reduced-motion gets a single static frame.
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DRIFT = 0.22; // bar widths per second
  var EASE = 3.2;
  var TAU = Math.PI * 2;

  var charts = [];
  var colors = { bar: "150,170,190", tip: "230,240,250" };
  var art = { scenes: ["bars", "ripples"], hold: 10, fade: 1.8 };
  var scene = { i: 0, phase: "hold", t: 0, mix: 0 };
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
      var names = (c.scenes || []).filter(function (n) { return SCENES[n]; });
      if (names.length) art.scenes = names;
      art.hold = +c.hold_seconds || art.hold;
      art.fade = +c.fade_seconds || art.fade;
    } catch (e) { /* keep defaults */ }
  }

  /* ───────────── scene: bars ───────────── */
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
    s.layers = LAYERS.map(function (L) { return { count: Math.max(4, Math.round(s.barCount * L.scale)), bars: null }; });
    s.layers.forEach(function (l) { l.bars = makeBars(l.count); });
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
  function barsDraw(s, weight) {
    var ctx = s.ctx, w = s.w, h = s.h, small = w < 640 ? 0.62 : 1;
    s.layers.forEach(function (l, li) {
      var L = LAYERS[li], step = w / l.count, barW = step * 0.62;
      for (var i = 0; i < l.bars.length; i++) {
        var b = l.bars[i];
        var x = b.u * step + (step - barW) / 2;
        var p = Math.min(1, Math.max(0, (x + barW / 2) / w));
        var bh = (0.06 + 0.94 * b.v) * L.hf(p) * small * h;
        if (bh < 3) continue;
        var y = L.top ? 0 : h - bh;
        var g = ctx.createLinearGradient(0, L.top ? bh : y, 0, L.top ? 0 : h);
        g.addColorStop(0, rgba(colors.tip, 0.9));
        g.addColorStop(1, rgba(colors.bar, 0.1));
        ctx.globalAlpha = weight * L.alpha(p);
        ctx.fillStyle = g;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, 3); else ctx.rect(x, y, barW, bh);
        ctx.fill();
        ctx.fillStyle = rgba(colors.tip, 1);
        ctx.fillRect(x, L.top ? bh - 2 : y, barW, 2);
      }
    });
  }

  /* ───────────── scene: ripples ───────────── */
  var MAX_AGE = 5.5;
  function ripplesInit(s) { s.drops = []; s.dropTimer = 0; s.time = 0; }
  function spawnDrop(s) {
    s.drops.push({
      x: rand(0.05, 0.95) * s.w, y: rand(0.1, 0.9) * s.h, age: 0,
      amp: rand(24, 44) * (s.h / 900), k: rand(0.07, 0.1), c: rand(150, 210), sigma: rand(80, 110)
    });
    if (s.drops.length > 7) s.drops.shift();
  }
  function ripplesUpdate(s, dt) {
    s.time += dt;
    s.dropTimer -= dt;
    if (s.dropTimer <= 0 || !s.drops.length) { spawnDrop(s); s.dropTimer = rand(0.7, 1.8); }
    for (var i = s.drops.length - 1; i >= 0; i--) {
      s.drops[i].age += dt;
      if (s.drops[i].age > MAX_AGE) s.drops.splice(i, 1);
    }
  }
  function ripplesDraw(s, weight) {
    var ctx = s.ctx, w = s.w, h = s.h, drops = s.drops;
    var rows = Math.max(14, Math.min(34, Math.round(h / 26)));
    var gap = h / (rows + 1), stepX = 5, n = Math.ceil(w / stepX) + 1;
    var dys = new Float32Array(n);
    var swell = 3 * (h / 900);

    // faint expanding rings make each drop readable
    ctx.lineWidth = 1;
    drops.forEach(function (d) {
      var life = 1 - d.age / MAX_AGE;
      ctx.globalAlpha = weight * 0.22 * life;
      ctx.strokeStyle = rgba(colors.tip, 1);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.c * d.age, 0, TAU);
      ctx.stroke();
    });

    ctx.lineWidth = 1.3;
    for (var r = 0; r < rows; r++) {
      var y0 = gap * (r + 1), peak = 0;
      for (var xi = 0; xi < n; xi++) {
        var x = xi * stepX;
        var dy = swell * Math.sin(x * 0.012 + s.time * 0.9 + r * 0.55); // always-on gentle swell
        for (var k = 0; k < drops.length; k++) {
          var d = drops[k];
          var dx = x - d.x, ddy = y0 - d.y;
          var off = Math.sqrt(dx * dx + ddy * ddy) - d.c * d.age; // distance behind/ahead of the ring front
          var env = Math.exp(-(off * off) / (2 * d.sigma * d.sigma));
          if (env < 0.01) continue;
          dy += d.amp * env * Math.exp(-d.age / 3.2) * Math.sin(d.k * off) / (1 + Math.hypot(dx, ddy) * 0.003);
        }
        dys[xi] = dy;
        if (Math.abs(dy) > peak) peak = Math.abs(dy);
      }
      // lines the ripples are crossing glow brighter
      ctx.globalAlpha = weight * Math.min(0.9, 0.2 + peak * 0.035 / (h / 900));
      ctx.strokeStyle = rgba(r % 4 === 0 ? colors.tip : colors.bar, 1);
      ctx.beginPath();
      for (var xj = 0; xj < n; xj++) {
        if (xj === 0) ctx.moveTo(0, y0 + dys[0]); else ctx.lineTo(xj * stepX, y0 + dys[xj]);
      }
      ctx.stroke();
    }
  }

  var SCENES = {
    bars: { init: barsInit, update: barsUpdate, draw: barsDraw },
    ripples: { init: ripplesInit, update: ripplesUpdate, draw: ripplesDraw }
  };

  /* ───────────── charts, scene alternation, loop ───────────── */
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
    var count = Math.max(8, Math.round(w / (w < 640 ? 22 : 34)));
    if (count !== s.barCount) { s.barCount = count; barsInit(s); }
  }
  function build(canvas, key) {
    var s = { key: key, canvas: canvas, visible: true, w: 0, barCount: 0 };
    Object.keys(SCENES).forEach(function (n) { if (n !== "bars") SCENES[n].init(s); });
    size(s); // creates the bar layers
    return s;
  }

  function advance(dt) {
    if (art.scenes.length < 2 || reduced) return;
    scene.t += dt;
    if (scene.phase === "hold") {
      if (scene.t >= art.hold) { scene.phase = "fade"; scene.t = 0; }
    } else {
      var m = Math.min(1, scene.t / art.fade);
      scene.mix = m * m * (3 - 2 * m);
      if (scene.t >= art.fade) {
        scene.i = (scene.i + 1) % art.scenes.length;
        scene.phase = "hold"; scene.t = 0; scene.mix = 0;
      }
    }
  }
  function weights() {
    var cur = art.scenes[scene.i % art.scenes.length];
    var nxt = art.scenes[(scene.i + 1) % art.scenes.length];
    var w = {};
    w[cur] = 1 - scene.mix;
    if (scene.mix > 0) w[nxt] = (w[nxt] || 0) + scene.mix;
    return w;
  }
  function render(s, dt, w) {
    if (!s.w) return;
    s.ctx.clearRect(0, 0, s.w, s.h);
    Object.keys(w).forEach(function (name) {
      if (w[name] < 0.01) return;
      if (dt) SCENES[name].update(s, dt);
      SCENES[name].draw(s, w[name]);
    });
    s.ctx.globalAlpha = 1;
  }

  function frame(ts) {
    raf = 0;
    var dt = Math.min(Math.max((ts - last) / 1000, 0), 0.05);
    last = ts;
    advance(dt);
    var w = weights(), active = false;
    for (var i = 0; i < charts.length; i++) {
      if (!charts[i].w || !charts[i].visible) continue;
      active = true;
      render(charts[i], dt, w);
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
      render(s, 0, weights());                // paint immediately: no blank frame
    });
    charts = charts.filter(function (s) { return s.canvas.isConnected; });
    kick();
  }

  var timer;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(scan, 150); });
  document.addEventListener("DOMContentLoaded", scan);
  document.addEventListener("htmx:afterSwap", scan); // synchronous with the swap, before the next paint
  window.addEventListener("dataverse:theme", function () { readColors(); charts.forEach(function (s) { render(s, 0, weights()); }); kick(); });
  document.addEventListener("visibilitychange", kick);
})();
