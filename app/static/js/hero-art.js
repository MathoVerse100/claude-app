/*
 * Animated hero art. Every <canvas data-bars="N" data-anchor="top|bottom" data-env="peak|rise|fall|flat">
 * hosts two scenes that alternate with a cross-fade (config/app_config.json -> hero_art):
 *
 *   bars  - N bars that ease to new random heights at random moments and drift sideways.
 *   waves - a cartesian grid with axes and curves built from an alternating sin/cos base term
 *           plus randomly chosen extra functions (tanh, triangle, sawtooth, sinc, gauss, ...)
 *           whose amplitudes rise and fall at random and which are swapped out over time.
 *
 * Colours come from the active theme tokens (--c-bar / --c-bar-tip). RTL documents mirror the
 * drawing. Scenes pause when off-screen or when the tab is hidden; users who prefer reduced
 * motion get one static frame.
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DRIFT = 0.22; // bar widths per second
  var EASE = 3.2;
  var ENVELOPES = {
    peak: function (p) { return 0.3 + 0.7 * Math.sin(Math.PI * p); },
    rise: function (p) { return 0.25 + 0.75 * p; },
    fall: function (p) { return 1 - 0.75 * p; },
    flat: function () { return 1; }
  };

  var charts = [];
  var colors = { bar: "150,170,190", tip: "230,240,250" };
  var art = { scenes: ["bars", "waves"], hold: 10, fade: 1.8 };
  var scene = { i: 0, phase: "hold", t: 0, mix: 0 };
  var raf = 0;
  var last = 0;
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(onIntersect) : null;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function rgba(rgb, a) { return "rgba(" + rgb + "," + a + ")"; }

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
      if (c.scenes && c.scenes.length) art.scenes = c.scenes.filter(function (n) { return SCENES[n]; });
      if (!art.scenes.length) art.scenes = ["bars"];
      art.hold = +c.hold_seconds || art.hold;
      art.fade = +c.fade_seconds || art.fade;
    } catch (e) { /* keep defaults */ }
  }

  /* ───────────── scene: bars ───────────── */
  function barsInit(s) {
    s.bars = [];
    // count + 2 bars so the chart stays full while bars slide off one edge.
    for (var i = 0; i < s.count + 2; i++) {
      s.bars.push({ u: i - 1, v: Math.random(), target: Math.random(), timer: Math.random() * 2 });
    }
  }
  function barsUpdate(s, dt) {
    var span = s.count + 2;
    for (var i = 0; i < s.bars.length; i++) {
      var b = s.bars[i];
      b.u -= DRIFT * dt;
      if (b.u < -1) { b.u += span; b.target = Math.random(); }
      b.timer -= dt;
      if (b.timer <= 0) { b.target = 0.08 + 0.92 * Math.random(); b.timer = rand(0.5, 2.3); }
      b.v += (b.target - b.v) * (1 - Math.exp(-EASE * dt));
    }
  }
  function barsDraw(s) {
    var ctx = s.ctx, w = s.w, h = s.h, step = w / s.count, barW = step * 0.62;
    for (var i = 0; i < s.bars.length; i++) {
      var b = s.bars[i];
      var x = b.u * step + (step - barW) / 2;
      var p = Math.min(1, Math.max(0, (x + barW / 2) / w));
      var bh = Math.max(4, (0.06 + 0.94 * b.v) * s.env(p) * h);
      var y = s.top ? 0 : h - bh;
      var tipY = s.top ? bh : y;
      var g = ctx.createLinearGradient(0, tipY, 0, s.top ? 0 : h);
      g.addColorStop(0, rgba(colors.tip, 0.9));
      g.addColorStop(1, rgba(colors.bar, 0.1));
      ctx.fillStyle = g;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, 3); else ctx.rect(x, y, barW, bh);
      ctx.fill();
      ctx.fillStyle = rgba(colors.tip, 1);
      ctx.fillRect(x, s.top ? bh - 2 : y, barW, 2);
    }
  }

  /* ───────────── scene: waves on a cartesian grid ───────────── */
  var TAU = Math.PI * 2;
  // Each function maps (theta, u) -> roughly [-1, 1]; u is the grid x coordinate.
  var FN = {
    sin: function (t) { return Math.sin(t); },
    cos: function (t) { return Math.cos(t); },
    tanhSin: function (t) { return Math.tanh(2.2 * Math.sin(t)); },
    absSin: function (t) { return 2 * Math.abs(Math.sin(t / 2)) - 1; },
    triangle: function (t) { return (2 / Math.PI) * Math.asin(Math.sin(t)); },
    saw: function (t) { return 2 * (t / TAU - Math.floor(t / TAU + 0.5)); },
    sinc: function (t, u) { var x = u * 2; return Math.abs(x) < 1e-3 ? 1 : Math.sin(x * 2) / (x * 2) * 1.6 - 0.2; },
    gauss: function (t, u) { return 2 * Math.exp(-u * u * 0.5) - 1; },
    tanClip: function (t) { return Math.max(-1, Math.min(1, Math.tan(t / 2) * 0.25)); },
    decaySin: function (t, u) { return Math.sin(t * 1.5) * Math.exp(-Math.abs(u) * 0.35) * 1.4; },
    parabola: function (t, u) { return 1 - 0.18 * u * u; }
  };
  var FN_NAMES = Object.keys(FN).filter(function (n) { return n !== "sin" && n !== "cos"; });

  function newTerm() {
    return { fn: pick(FN_NAMES), amp: 0, target: rand(0.2, 0.6), freq: rand(0.4, 2.2), phase: rand(0, TAU), speed: rand(-1.4, 1.4), timer: rand(3, 8) };
  }
  function wavesInit(s) {
    s.curves = [];
    for (var i = 0; i < 3; i++) {
      s.curves.push({
        k: rand(0.6, 1.6), ph: rand(0, TAU), speed: rand(0.4, 1.3) * (Math.random() < 0.5 ? -1 : 1),
        altPhase: rand(0, TAU), altSpeed: rand(0.3, 0.9), m: 0.5,           // m sweeps sin <-> cos
        amp: rand(0.3, 1), ampT: rand(0.3, 1), ampTimer: rand(0.6, 2.5),
        off: 0, offT: rand(-0.25, 0.25), offTimer: rand(1.5, 4),            // vertical bob
        terms: [newTerm(), newTerm()],
        alpha: 0.9 - i * 0.25
      });
    }
  }
  function wavesUpdate(s, dt) {
    for (var i = 0; i < s.curves.length; i++) {
      var c = s.curves[i];
      c.ph += c.speed * dt;
      c.altPhase += c.altSpeed * dt;
      c.m = 0.5 + 0.5 * Math.sin(c.altPhase);
      c.ampTimer -= dt;
      if (c.ampTimer <= 0) { c.ampT = rand(0.15, 1); c.ampTimer = rand(0.6, 2.8); } // up and down at random
      c.amp += (c.ampT - c.amp) * (1 - Math.exp(-2.4 * dt));
      c.offTimer -= dt;
      if (c.offTimer <= 0) { c.offT = rand(-0.3, 0.3); c.offTimer = rand(1.5, 4.5); }
      c.off += (c.offT - c.off) * (1 - Math.exp(-1.6 * dt));
      for (var j = 0; j < c.terms.length; j++) {
        var t = c.terms[j];
        t.phase += t.speed * dt;
        t.amp += (t.target - t.amp) * (1 - Math.exp(-2 * dt));
        t.timer -= dt;
        if (t.timer <= 0) {
          if (t.target > 0) { t.target = 0; t.timer = 1.6; }          // fade the old function out...
          else { c.terms[j] = newTerm(); }                            // ...then swap in a new random one
        }
      }
    }
  }
  function curveY(c, u) {
    var th = c.k * u + c.ph;
    var y = c.amp * (Math.sin(th) * (1 - c.m) + Math.cos(th) * c.m);
    var norm = c.amp;
    for (var j = 0; j < c.terms.length; j++) {
      var t = c.terms[j];
      y += t.amp * FN[t.fn](t.freq * u + t.phase, u);
      norm += t.amp;
    }
    return y / Math.max(1, norm);
  }
  function wavesDraw(s) {
    var ctx = s.ctx, w = s.w, h = s.h;
    var cell = Math.max(22, Math.min(w, h) / 5), cx = w / 2, cy = h / 2, x, y;

    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(colors.bar, 0.12);
    ctx.beginPath();
    for (x = cx % cell; x <= w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (y = cy % cell; y <= h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    ctx.strokeStyle = rgba(colors.bar, 0.4); // axes + tick marks
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    for (x = cx % cell; x <= w; x += cell) { ctx.moveTo(x, cy - 4); ctx.lineTo(x, cy + 4); }
    for (y = cy % cell; y <= h; y += cell) { ctx.moveTo(cx - 4, y); ctx.lineTo(cx + 4, y); }
    ctx.stroke();

    var scale = h * 0.4;
    for (var i = 0; i < s.curves.length; i++) {
      var c = s.curves[i];
      var g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, rgba(colors.tip, 0));
      g.addColorStop(0.18, rgba(colors.tip, c.alpha));
      g.addColorStop(0.82, rgba(colors.tip, c.alpha));
      g.addColorStop(1, rgba(colors.tip, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = i === 0 ? 2.2 : 1.5;
      ctx.beginPath();
      for (var px = 0; px <= w; px += 3) {
        var p = px / w;
        var yy = cy - (curveY(c, (px - cx) / cell) + c.off) * scale * (0.5 + 0.5 * s.env(p));
        if (px === 0) ctx.moveTo(px, yy); else ctx.lineTo(px, yy);
      }
      ctx.stroke();
      if (i === 0) { // sample points where the lead curve crosses the vertical grid lines
        ctx.fillStyle = rgba(colors.tip, 1);
        for (x = cx % cell; x <= w; x += cell) {
          var py = cy - (curveY(c, (x - cx) / cell) + c.off) * scale * (0.5 + 0.5 * s.env(x / w));
          ctx.beginPath(); ctx.arc(x, py, 2.4, 0, TAU); ctx.fill();
        }
      }
    }
  }

  var SCENES = {
    bars: { init: barsInit, update: barsUpdate, draw: barsDraw },
    waves: { init: wavesInit, update: wavesUpdate, draw: wavesDraw }
  };

  /* ───────────── charts, scene alternation, loop ───────────── */
  function size(s) {
    var c = s.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) { s.w = 0; return; } // display:none at this breakpoint
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rtl = document.documentElement.dir === "rtl";
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    s.ctx = c.getContext("2d");
    // In RTL the whole drawing is mirrored so drift direction and envelopes flip too.
    s.ctx.setTransform(rtl ? -dpr : dpr, 0, 0, dpr, rtl ? c.width : 0, 0);
    s.w = w;
    s.h = h;
  }
  function build(canvas) {
    var s = {
      canvas: canvas,
      count: Math.max(3, parseInt(canvas.dataset.bars || "14", 10)),
      top: canvas.dataset.anchor === "top",
      env: ENVELOPES[canvas.dataset.env] || ENVELOPES.peak,
      visible: true,
      w: 0
    };
    Object.keys(SCENES).forEach(function (n) { SCENES[n].init(s); });
    size(s);
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
      s.ctx.globalAlpha = w[name];
      SCENES[name].draw(s);
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
    if (reduced) { var w = weights(); charts.forEach(function (s) { render(s, 0.5, w); }); return; }
    if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function onIntersect(entries) {
    entries.forEach(function (e) {
      charts.forEach(function (s) { if (s.canvas === e.target) s.visible = e.isIntersecting; });
    });
    kick();
  }

  function scan() {
    charts = charts.filter(function (s) {
      if (s.canvas.isConnected) return true;
      if (observer) observer.unobserve(s.canvas);
      return false;
    });
    document.querySelectorAll("canvas[data-bars]").forEach(function (c) {
      var existing = charts.filter(function (s) { return s.canvas === c; })[0];
      if (existing) { size(existing); return; }
      charts.push(build(c));
      if (observer) observer.observe(c);
    });
    readConfig();
    readColors();
    kick();
  }

  var timer;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(scan, 150); });
  document.addEventListener("DOMContentLoaded", scan);
  document.addEventListener("htmx:afterSettle", scan); // e.g. after a language swap (dir may have changed)
  window.addEventListener("dataverse:theme", function () { readColors(); kick(); });
  document.addEventListener("visibilitychange", kick);
})();
