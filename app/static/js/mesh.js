/*
 * Procedural wireframe "data tower" graphics.
 * Each <canvas data-mesh="shape" data-seed="n"> is filled with random points inside a
 * polygon, joined to their nearest neighbours, and tinted from the active theme tokens
 * (--c-mesh / --c-mesh-dot). Deterministic per seed, so every render looks identical.
 */
(function () {
  "use strict";

  // Normalised polygons (x, y in 0..1) describing each silhouette.
  var SHAPES = {
    tower: [[0.30, 0.0], [0.42, 0.0], [1.0, 1.0], [0.0, 1.0]],
    wedge: [[0.05, 0.0], [1.0, 0.0], [1.0, 0.55], [0.12, 1.0]],
    slab: [[0.0, 0.25], [1.0, 0.0], [1.0, 0.9], [0.1, 0.6]],
    ridge: [[0.0, 1.0], [0.48, 0.0], [1.0, 0.5], [0.96, 1.0]],
    shard: [[0.0, 0.1], [1.0, 0.45], [0.88, 0.92], [0.0, 1.0]]
  };

  function rngFor(seed) {
    var s = (seed * 9301 + 49297) % 233280 || 1;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function inside(poly, x, y) {
    var c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function tokenRGB(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return (v || fallback).split(/\s+/).join(",");
  }

  function draw(canvas) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // display:none at this breakpoint
    var poly = SHAPES[canvas.dataset.mesh] || SHAPES.tower;
    var rand = rngFor(parseInt(canvas.dataset.seed || "1", 10));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var count = Math.max(40, Math.min(240, Math.round((w * h) / 1500)));
    var pts = poly.map(function (p) { return [p[0] * w, p[1] * h]; });
    var guard = 0;
    while (pts.length < count && guard++ < count * 40) {
      var x = rand(), y = rand();
      // Bias toward the silhouette's edges for a crisp outline.
      if (inside(poly, x, y)) pts.push([x * w, y * h]);
    }

    var line = tokenRGB("--c-mesh", "190 200 212");
    var dot = tokenRGB("--c-mesh-dot", "160 190 215");
    var reach = Math.max(w, h) * 0.22;

    ctx.lineWidth = 0.6;
    for (var i = 0; i < pts.length; i++) {
      var near = [];
      for (var j = 0; j < pts.length; j++) {
        if (i === j) continue;
        var dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < reach) near.push([d, j]);
      }
      near.sort(function (a, b) { return a[0] - b[0]; });
      for (var k = 0; k < Math.min(4, near.length); k++) {
        ctx.strokeStyle = "rgba(" + line + "," + (0.55 - (near[k][0] / reach) * 0.4).toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[near[k][1]][0], pts[near[k][1]][1]);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(" + dot + ",0.85)";
    for (var n = 0; n < pts.length; n++) {
      ctx.beginPath();
      ctx.arc(pts[n][0], pts[n][1], n < poly.length ? 1.8 : 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAll() {
    document.querySelectorAll("canvas[data-mesh]").forEach(draw);
  }

  var timer;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(drawAll, 150);
  });
  document.addEventListener("DOMContentLoaded", drawAll);
  // Re-tint after a theme switch and re-draw after any HTMX swap (e.g. language change).
  document.body && document.body.addEventListener("themeChanged", function () { requestAnimationFrame(drawAll); });
  document.addEventListener("htmx:afterSettle", drawAll);
  window.addEventListener("dataverse:theme", drawAll);
})();
