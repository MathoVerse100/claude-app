/*
 * Animated hero bar charts.
 * Every <canvas data-bars="N" data-anchor="top|bottom" data-env="peak|rise|fall|flat"> draws N
 * bars that (a) ease toward new random heights at random moments, so they keep rising and
 * falling, and (b) drift sideways, wrapping around so the chart is always full.
 * Colours come from the active theme tokens (--c-bar / --c-bar-tip). Charts pause when
 * off-screen or when the tab is hidden, and render a single static frame for users who
 * prefer reduced motion.
 */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DRIFT = 0.22;   // bar widths per second the chart moves left
  var EASE = 3.2;     // higher = snappier height changes
  var ENVELOPES = {   // p: 0..1 horizontal position -> max relative height
    peak: function (p) { return 0.3 + 0.7 * Math.sin(Math.PI * p); },
    rise: function (p) { return 0.25 + 0.75 * p; },
    fall: function (p) { return 1 - 0.75 * p; },
    flat: function () { return 1; }
  };

  var charts = [];
  var colors = { bar: "150,170,190", tip: "230,240,250" };
  var raf = 0;
  var last = 0;
  var observer = "IntersectionObserver" in window ? new IntersectionObserver(onIntersect) : null;

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return (v || fallback).split(/\s+/).join(",");
  }

  function readColors() {
    colors.bar = token("--c-bar", "150 170 190");
    colors.tip = token("--c-bar-tip", "230 240 250");
  }

  function size(s) {
    var c = s.canvas, w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) { s.w = 0; return; } // display:none at this breakpoint
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    s.ctx = c.getContext("2d");
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.w = w;
    s.h = h;
    s.step = w / s.count;
  }

  function build(canvas) {
    var count = Math.max(3, parseInt(canvas.dataset.bars || "14", 10));
    var s = {
      canvas: canvas,
      count: count,
      top: canvas.dataset.anchor === "top",
      env: ENVELOPES[canvas.dataset.env] || ENVELOPES.peak,
      visible: true,
      w: 0,
      bars: []
    };
    // count + 2 bars so the chart stays full while bars slide off the left edge.
    for (var i = 0; i < count + 2; i++) {
      s.bars.push({ u: i - 1, v: Math.random(), target: Math.random(), timer: Math.random() * 2 });
    }
    size(s);
    return s;
  }

  function update(s, dt) {
    var span = s.count + 2;
    for (var i = 0; i < s.bars.length; i++) {
      var b = s.bars[i];
      b.u -= DRIFT * dt;
      if (b.u < -1) { b.u += span; b.target = Math.random(); }
      b.timer -= dt;
      if (b.timer <= 0) {
        b.target = 0.08 + 0.92 * Math.random();
        b.timer = 0.5 + Math.random() * 1.8;
      }
      b.v += (b.target - b.v) * (1 - Math.exp(-EASE * dt));
    }
  }

  function draw(s) {
    var ctx = s.ctx, w = s.w, h = s.h;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    var barW = s.step * 0.62;
    for (var i = 0; i < s.bars.length; i++) {
      var b = s.bars[i];
      var x = b.u * s.step + (s.step - barW) / 2;
      var p = Math.min(1, Math.max(0, (x + barW / 2) / w));
      var bh = Math.max(4, (0.06 + 0.94 * b.v) * s.env(p) * h);
      var y = s.top ? 0 : h - bh;
      var tipY = s.top ? bh : y;
      var g = ctx.createLinearGradient(0, tipY, 0, s.top ? 0 : h);
      g.addColorStop(0, "rgba(" + colors.tip + ",0.9)");
      g.addColorStop(1, "rgba(" + colors.bar + ",0.10)");
      ctx.fillStyle = g;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, 3); else ctx.rect(x, y, barW, bh);
      ctx.fill();
      ctx.fillStyle = "rgba(" + colors.tip + ",1)";
      ctx.fillRect(x, s.top ? bh - 2 : y, barW, 2);
    }
  }

  function frame(ts) {
    raf = 0;
    var dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    var active = false;
    for (var i = 0; i < charts.length; i++) {
      var s = charts[i];
      if (!s.w || !s.visible) continue;
      active = true;
      update(s, dt);
      draw(s);
    }
    if (active && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (reduced) { charts.forEach(draw); return; }
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
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
    readColors();
    kick();
  }

  var timer;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(scan, 150); });
  document.addEventListener("DOMContentLoaded", scan);
  document.addEventListener("htmx:afterSettle", scan);          // e.g. after a language swap
  window.addEventListener("dataverse:theme", function () { readColors(); kick(); if (reduced) charts.forEach(draw); });
  document.addEventListener("visibilitychange", kick);
})();
