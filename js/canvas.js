import { state, subscribe, pitches, noteName, clamp } from "./state.js";
let canvas,
  ctx,
  paperCache,
  dirty = true,
  rect = { width: 100, height: 100 },
  preview = null;
export const view = { left: 37, top: 27, width: 1, height: 1 };
export function canvasElement() {
  return canvas;
}
export function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(
      ((e.clientX - r.left - view.left) / view.width - state.pan.x) /
        state.zoom,
    ),
    y: clamp(
      ((e.clientY - r.top - view.top) / view.height - state.pan.y) / state.zoom,
    ),
    pressure: e.pointerType === "pen" ? clamp(e.pressure, 0.05, 1) : 0.65,
  };
}
export function screenPoint(p) {
  return {
    x: view.left + (p.x * state.zoom + state.pan.x) * view.width,
    y: view.top + (p.y * state.zoom + state.pan.y) * view.height,
  };
}
export function setPreview(p) {
  preview = p;
  dirty = true;
}
export function invalidate() {
  dirty = true;
}
export function bounds(strokes) {
  const pts = strokes.flatMap((s) => s.points);
  if (!pts.length) return null;
  return {
    x: Math.min(...pts.map((p) => p.x)),
    y: Math.min(...pts.map((p) => p.y)),
    right: Math.max(...pts.map((p) => p.x)),
    bottom: Math.max(...pts.map((p) => p.y)),
  };
}
function paper(
  c,
  w,
  h,
  p,
  { grid = true, texture = true, zoom = state.zoom, pan = state.pan } = {},
) {
  const dark = p.paper.type === "Dark Paper";
  c.fillStyle = dark ? "#202737" : p.paper.color;
  c.fillRect(0, 0, w, h);
  if (texture) {
    c.fillStyle = dark ? "#ffffff09" : "#29251509";
    for (let i = 0; i < Math.min((w * h) / 150, 6000); i++) {
      const x = (i * 137.513) % w,
        y = (i * 63.731) % h;
      c.fillRect(x, y, 1, 1);
    }
  }
  if (grid && p.paper.grid) {
    c.save();
    c.globalAlpha = p.paper.opacity;
    c.strokeStyle = dark ? "#c4cee8" : "#8a96a4";
    c.lineWidth = 0.65;
    const beats = p.bars * 4,
      cols =
        p.paper.type === "Graph Paper" ? beats * 4 : beats * p.paper.division;
    if (p.paper.type !== "Blank Paper") {
      for (let i = 0; i <= cols; i++) {
        const x = ((i / cols) * zoom + pan.x) * w;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
      }
      const n =
        p.paper.type === "Graph Paper"
          ? Math.round(h / (w / cols))
          : pitches(p).length - 1;
      for (let i = 0; i <= n; i++) {
        const y = ((i / n) * zoom + pan.y) * h;
        if (p.paper.type === "Staff Paper" && i % 7 > 4) continue;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
    }
    c.globalAlpha = Math.min(1, p.paper.opacity * 1.8);
    c.lineWidth = 1;
    for (let i = 0; i <= p.bars; i++) {
      const x = ((i / p.bars) * zoom + pan.x) * w;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    c.restore();
  }
}
function drawStroke(c, s, w, h, pan = state.pan, zoom = state.zoom) {
  const points = s.points;
  if (!points.length) return;
  c.save();
  c.globalAlpha = s.opacity;
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.lineCap = "round";
  c.lineJoin = "round";
  const size = s.size * (w / 900) * zoom;
  const coords = (p) => ({
    x: (p.x * zoom + pan.x) * w,
    y: (p.y * zoom + pan.y) * h,
  });
  if (s.brush === "Airbrush") {
    const spray = [];
    for (let k = 0; k < points.length; k++) {
      const a = coords(points[Math.max(0, k - 1)]),
        b = coords(points[k]),
        steps = Math.min(
          150,
          Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3)),
        );
      for (let j = 0; j < steps && spray.length < 3000; j++)
        spray.push({
          x: a.x + ((b.x - a.x) * j) / steps,
          y: a.y + ((b.y - a.y) * j) / steps,
        });
    }
    for (let i = 0; i < spray.length; i++) {
      const p = spray[i];
      for (let j = 0; j < 9; j++) {
        const a = (i * 7 + j) * 2.39996,
          r = Math.sqrt(((i * 17 + j * 31) % 97) / 97) * size * 1.3;
        c.globalAlpha = s.opacity * 0.2;
        c.beginPath();
        c.arc(
          p.x + Math.cos(a) * r,
          p.y + Math.sin(a) * r,
          0.7 + size * 0.035,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    }
  } else {
    if (s.brush === "Watercolor") {
      c.globalAlpha = s.opacity * 0.6;
      c.shadowColor = s.color;
      c.shadowBlur = size * (1 - (s.sound.hardness ?? 0.75)) * 0.8;
    }
    if (points.length === 1) {
      const p = coords(points[0]);
      c.beginPath();
      c.arc(p.x, p.y, Math.max(2, size / 2), 0, Math.PI * 2);
      c.fill();
      if (s.brush === "Drums") {
        c.globalAlpha = 0.65;
        c.strokeStyle = "#fff";
        c.lineWidth = 1;
        c.beginPath();
        c.arc(p.x, p.y, Math.max(1, size / 2 - 2), 0, Math.PI * 2);
        c.stroke();
      }
    }
    for (let i = 1; i < points.length; i++) {
      const a = coords(points[i - 1]),
        b = coords(points[i]);
      c.lineWidth = Math.max(
        0.8,
        size * (0.45 + (points[i].pressure ?? 0.65) * 0.85),
      );
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
  }
  c.restore();
}
export function renderArtwork(c, w, h, options = {}) {
  const p = state.project;
  paper(c, w, h, p, {
    ...options,
    zoom: options.zoom || 1,
    pan: options.pan || { x: 0, y: 0 },
  });
  for (const layer of [...p.layers].reverse())
    if (layer.visible)
      for (const s of p.strokes)
        if (s.layerId === layer.id)
          drawStroke(
            c,
            s,
            w,
            h,
            options.pan || { x: 0, y: 0 },
            options.zoom || 1,
          );
}
function render() {
  const { width: w, height: h } = rect;
  ctx.clearRect(0, 0, w, h);
  if (!paperCache) {
    paperCache = document.createElement("canvas");
    paperCache.width = w;
    paperCache.height = h;
    const c = paperCache.getContext("2d");
    c.fillStyle = "#e8e8df";
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(view.left, view.top);
    paper(c, view.width, view.height, state.project);
    c.restore();
    c.font = "9px Tahoma";
    c.fillStyle = "#67707c";
    c.textAlign = "center";
    const beats = state.project.bars * 4;
    for (let i = 0; i < beats; i++) {
      const x =
        view.left + ((i / beats) * state.zoom + state.pan.x) * view.width;
      if (x >= view.left && x <= w)
        c.fillText(i % 4 === 0 ? `${Math.floor(i / 4) + 1}` : "·", x + 5, 17);
    }
    if (state.project.paper.labels) {
      const notes = pitches();
      c.textAlign = "right";
      for (let i = 0; i < notes.length; i++) {
        const y =
          view.top +
          ((1 - i / (notes.length - 1)) * state.zoom + state.pan.y) *
            view.height;
        if (y < view.top || y > h) continue;
        if (notes.length > 20 && i % 2) continue;
        c.fillText(noteName(notes[i]), 29, y + 3);
      }
    }
  }
  ctx.drawImage(paperCache, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(view.left, view.top, view.width, view.height);
  ctx.clip();
  ctx.translate(view.left, view.top);
  for (const layer of [...state.project.layers].reverse())
    if (layer.visible)
      for (const s of state.project.strokes)
        if (s.layerId === layer.id) drawStroke(ctx, s, view.width, view.height);
  if (state.playing) {
    const x = (state.position * state.zoom + state.pan.x) * view.width;
    ctx.fillStyle = "#4161c313";
    ctx.fillRect(x - 11, 0, 22, view.height);
    for (const s of state.project.strokes) {
      if (!state.project.layers.find((l) => l.id === s.layerId)?.visible)
        continue;
      let pt =
        s.points.length === 1 &&
        Math.abs(s.points[0].x - state.position) < 0.012
          ? s.points[0]
          : null;
      for (let i = 1; !pt && i < s.points.length; i++) {
        const a = s.points[i - 1],
          b = s.points[i];
        if (
          state.position >= Math.min(a.x, b.x) &&
          state.position <= Math.max(a.x, b.x)
        ) {
          const t = (state.position - a.x) / (b.x - a.x || 1);
          pt = { x: state.position, y: a.y + (b.y - a.y) * t };
        }
      }
      if (pt) {
        const q = {
          x: (pt.x * state.zoom + state.pan.x) * view.width,
          y: (pt.y * state.zoom + state.pan.y) * view.height,
        };
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = s.color;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(4, s.size / 2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.strokeStyle = "#274fbf";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, view.height);
    ctx.stroke();
  }
  ctx.restore();
  const selected = state.project.strokes.filter((s) =>
    state.selected.has(s.id),
  );
  const b = bounds(selected);
  if (b) {
    const a = screenPoint(b),
      z = screenPoint({ x: b.right, y: b.bottom });
    ctx.strokeStyle = "#1c48b5";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(a.x - 4, a.y - 4, z.x - a.x + 8, z.y - a.y + 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.fillRect(z.x - 4, z.y - 4, 8, 8);
    ctx.strokeRect(z.x - 4, z.y - 4, 8, 8);
  }
  if (preview) {
    if (preview.strokes) {
      ctx.save();
      ctx.translate(view.left, view.top);
      preview.strokes.forEach((s) =>
        drawStroke(ctx, s, view.width, view.height),
      );
      ctx.restore();
    } else if (preview.points) {
      ctx.save();
      ctx.translate(view.left, view.top);
      drawStroke(ctx, preview, view.width, view.height);
      ctx.restore();
    } else if (preview.rect) {
      const a = screenPoint(preview.rect.a),
        b = screenPoint(preview.rect.b);
      ctx.strokeStyle = "#1c48b5";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
  }
  {
    const x = screenPoint({ x: state.position, y: 0 }).x;
    if (x >= view.left && x <= view.left + view.width) {
      ctx.strokeStyle = "#274fbf";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, view.top);
      ctx.lineTo(x, view.top + view.height);
      ctx.stroke();
      ctx.fillStyle = "#274fbf";
      ctx.beginPath();
      ctx.moveTo(x - 4, 19);
      ctx.lineTo(x + 4, 19);
      ctx.lineTo(x, 26);
      ctx.fill();
    }
  }
}
export function resetPaper() {
  paperCache = null;
  dirty = true;
}
export function initCanvas() {
  canvas = document.querySelector("#drawing");
  ctx = canvas.getContext("2d");
  new ResizeObserver(() => {
    rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.width = Math.max(1, rect.width - view.left - 12);
    view.height = Math.max(1, rect.height - view.top - 23);
    resetPaper();
  }).observe(canvas);
  subscribe((t) => {
    dirty = true;
    if (["edit", "load", "view", "change"].includes(t)) paperCache = null;
  });
  function frame() {
    if (dirty || state.playing) {
      render();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  frame();
}
