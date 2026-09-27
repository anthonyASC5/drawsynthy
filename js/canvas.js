import {
  state,
  subscribe,
  pitches,
  noteName,
  clamp,
  newStroke,
  uid,
  snapshot,
  commit,
  emit,
  change,
  pitchAt,
} from "./state.js";
import {
  seek,
} from "./audio.js";

// Canvas rendering
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

// Drawing tools and geometry
let action = null,
  pointers = new Map(),
  gesture = null;
// Iterative Ramer–Douglas–Peucker keeps long pen gestures off the call stack.
export function simplify(points, tolerance = 0.001) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length),
    stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = 1;
  while (stack.length) {
    const [first, last] = stack.pop(),
      a = points[first],
      b = points[last],
      dx = b.x - a.x,
      dy = b.y - a.y;
    let max = tolerance,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i],
        t = clamp(
          ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
        );
      const d = Math.max(
        Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy),
        Math.abs(
          (p.pressure ?? 0.65) -
            ((a.pressure ?? 0.65) +
              ((b.pressure ?? 0.65) - (a.pressure ?? 0.65)) * t),
        ) * 0.004,
      );
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
export function shapeStrokes(a, b, type = state.brush.shape) {
  const points = [],
    x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x),
    y0 = Math.min(a.y, b.y),
    y1 = Math.max(a.y, b.y),
    w = x1 - x0,
    h = y1 - y0;
  const pt = (x, y) => ({ x: clamp(x), y: clamp(y), pressure: 0.65 });
  const make = (ps, tool = "Ink") => newStroke(ps, tool);
  if (type === "Chord block")
    return [0, 0.5, 1].map((t) =>
      make([pt(x0, y0 + h * t), pt(x1, y0 + h * t)], "Marker"),
    );
  if (type === "Drum pattern")
    return Array.from({ length: 8 }, (_, i) => {
      const s = make([pt(x0 + (w * i) / 8, y0 + h * (i % 2))], "Drums");
      s.sound.drum =
        i % 4 === 0 ? "kick" : i % 2 === 0 ? "snare" : "closed hi-hat";
      return s;
    });
  if (type === "Rising melody" || type === "Falling melody")
    return Array.from({ length: 6 }, (_, i) => {
      const y = y0 + h * (type === "Rising melody" ? 1 - i / 5 : i / 5);
      return make(
        [pt(x0 + (w * i) / 6, y), pt(x0 + (w * (i + 0.75)) / 6, y)],
        "Pencil",
      );
    });
  if (type === "Rectangle")
    return [make([pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)])];
  if (type === "Straight line") return [make([a, b])];
  const n = type === "Zigzag" ? 9 : 100;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (type === "Circle")
      points.push(
        pt(
          x0 + w / 2 + (Math.cos(t * Math.PI * 2) * w) / 2,
          y0 + h / 2 + (Math.sin(t * Math.PI * 2) * h) / 2,
        ),
      );
    else
      points.push(
        pt(
          x0 + w * t,
          y0 +
            h *
              (type === "Zigzag"
                ? i % 2
                : 0.5 - Math.sin(t * Math.PI * 4) * 0.5),
        ),
      );
  }
  return [make(points)];
}
function distance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function erase(p) {
  const r = state.brush.size / 900;
  state.project.strokes = state.project.strokes.filter(
    (s) =>
      s.layerId !== state.layer ||
      !s.points.some(
        (q, i) => distance(p, q, s.points[i + 1] || q) < r + s.size / 1800,
      ),
  );
  invalidate();
}
function smudge(p, prev) {
  const r = state.brush.size / 500;
  for (const s of state.project.strokes) {
    if (s.layerId !== state.layer) continue;
    let touched = false;
    s.points = s.points.map((q) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > r) return q;
      touched = true;
      const f = (1 - d / r) * state.brush.strength;
      return {
        ...q,
        x: clamp(q.x + (p.x - prev.x) * f),
        y: clamp(q.y + (p.y - prev.y) * f),
      };
    });
    if (touched) {
      s.smudged = true;
      s.sound.soundSmoothing = state.brush.soundSmoothing;
    }
  }
  invalidate();
}
export function deleteSelection() {
  change(
    () =>
      (state.project.strokes = state.project.strokes.filter(
        (s) => !state.selected.has(s.id),
      )),
  );
  state.selected.clear();
  emit("selection");
}
export function duplicateSelection() {
  change(() => {
    const copies = state.project.strokes
      .filter((s) => state.selected.has(s.id))
      .map((s) => ({
        ...structuredClone(s),
        id: uid(),
        points: s.points.map((p) => ({
          ...p,
          x: clamp(p.x + 0.025),
          y: clamp(p.y + 0.025),
        })),
      }));
    state.project.strokes.push(...copies);
    state.selected = new Set(copies.map((s) => s.id));
  });
}
export function cancelAction() {
  if (action) {
    state.project = JSON.parse(action.before);
    action = null;
    setPreview(null);
    emit();
  }
  pointers.clear();
  gesture = null;
}
export function placeCentered() {
  change(() => {
    const strokes = shapeStrokes(
      { x: 0.3, y: 0.3, pressure: 0.65 },
      { x: 0.7, y: 0.65, pressure: 0.65 },
      state.tool === "Line" ? "Straight line" : state.brush.shape,
    );
    state.project.strokes.push(...strokes);
    state.selected = new Set(strokes.map((s) => s.id));
  });
  state.tool = "Select";
  emit("tool");
}
export function initTools() {
  const canvas = canvasElement();
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (action) {
        state.project = JSON.parse(action.before);
        action = null;
        setPreview(null);
      }
      const [a, b] = [...pointers.values()];
      gesture = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: state.zoom,
        pan: { ...state.pan },
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      return;
    }
    if (pointers.size > 1) return;
    const p = canvasPoint(e);
    action = {
      before: snapshot(),
      start: p,
      last: p,
      raw: { x: e.clientX, y: e.clientY },
      pan: { ...state.pan },
      tool: state.tool,
    };
    if (
      ["Select", "Hand", "Eraser", "Smudge", "Line", "Shape stamp"].includes(
        state.tool,
      )
    ) {
      if (state.tool === "Eraser") erase(p);
      if (state.tool === "Select") {
        const selected = state.project.strokes.filter((s) =>
            state.selected.has(s.id),
          ),
          b = bounds(selected);
        action.original = structuredClone(selected);
        if (
          b &&
          p.x >= b.x - 0.02 &&
          p.x <= b.right + 0.02 &&
          p.y >= b.y - 0.02 &&
          p.y <= b.bottom + 0.02
        ) {
          action.mode =
            Math.hypot(
              (p.x - b.right) * view.width,
              (p.y - b.bottom) * view.height,
            ) < 16
              ? "resize"
              : "move";
          action.bounds = b;
        } else {
          state.selected.clear();
          action.mode = "box";
          emit("selection");
        }
      }
      return;
    }
    const stroke = newStroke([p]);
    action.stroke = stroke;
    state.project.strokes.push(stroke);
    invalidate();
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = canvasPoint(e);
    document.querySelector("#status-pointer").textContent =
      `Beat ${(p.x * state.project.bars * 4 + 1).toFixed(1)} · ${noteName(pitchAt(p.y))}`;
    if (pointers.has(e.pointerId))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture && pointers.size >= 2) {
      const [a, b] = [...pointers.values()],
        cx = (a.x + b.x) / 2,
        cy = (a.y + b.y) / 2;
      state.zoom = clamp(
        (gesture.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.distance,
        1,
        4,
      );
      state.pan.x = clamp(
        gesture.pan.x + (cx - gesture.center.x) / view.width,
        1 - state.zoom,
        0,
      );
      state.pan.y = clamp(
        gesture.pan.y + (cy - gesture.center.y) / view.height,
        1 - state.zoom,
        0,
      );
      resetPaper();
      emit("view");
      return;
    }
    if (!action || !pointers.has(e.pointerId)) return;
    const tool = action.tool;
    if (tool === "Hand") {
      state.pan.x = clamp(
        action.pan.x + (e.clientX - action.raw.x) / view.width,
        1 - state.zoom,
        0,
      );
      state.pan.y = clamp(
        action.pan.y + (e.clientY - action.raw.y) / view.height,
        1 - state.zoom,
        0,
      );
      resetPaper();
      emit("view");
    } else if (tool === "Eraser") erase(p);
    else if (tool === "Smudge") smudge(p, action.last);
    else if (tool === "Select") {
      if (action.mode === "box")
        setPreview({ rect: { a: action.start, b: p } });
      else {
        const dx = p.x - action.start.x,
          dy = p.y - action.start.y,
          b = action.bounds;
        for (const original of action.original) {
          const s = state.project.strokes.find((s) => s.id === original.id);
          s.points = original.points.map((q) => ({
            ...q,
            x: clamp(
              action.mode === "move"
                ? q.x + dx
                : b.x +
                    (q.x - b.x) *
                      Math.max(
                        0.05,
                        (b.right - b.x + dx) / Math.max(0.001, b.right - b.x),
                      ),
            ),
            y: clamp(
              action.mode === "move"
                ? q.y + dy
                : b.y +
                    (q.y - b.y) *
                      Math.max(
                        0.05,
                        (b.bottom - b.y + dy) / Math.max(0.001, b.bottom - b.y),
                      ),
            ),
          }));
        }
        invalidate();
      }
    } else if (tool === "Line" || tool === "Shape stamp") {
      const shapes = shapeStrokes(
        action.start,
        p,
        tool === "Line" ? "Straight line" : state.brush.shape,
      );
      setPreview({ strokes: shapes });
    } else if (action.stroke) {
      if (tool === "Drums") {
        if (Math.hypot(p.x - action.last.x, p.y - action.last.y) > 0.018) {
          state.project.strokes.push(newStroke([p], "Drums"));
          action.last = p;
        }
        return;
      }
      if (action.stroke.points.length < 6000) {
        const prev = action.stroke.points.at(-1),
          f = 1 - state.brush.smoothing * 0.8;
        if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.0006)
          action.stroke.points.push({
            ...p,
            x: prev.x + (p.x - prev.x) * f,
            y: prev.y + (p.y - prev.y) * f,
          });
      }
      invalidate();
    }
    action.last = p;
  });
  const finish = (e) => {
    pointers.delete(e.pointerId);
    if (gesture) {
      if (!pointers.size) gesture = null;
      action = null;
      return;
    }
    if (!action) return;
    const p = canvasPoint(e);
    if (action.tool === "Select" && action.mode === "box") {
      const a = action.start,
        x0 = Math.min(a.x, p.x),
        x1 = Math.max(a.x, p.x),
        y0 = Math.min(a.y, p.y),
        y1 = Math.max(a.y, p.y);
      for (const s of state.project.strokes) {
        if (!state.project.layers.find((l) => l.id === s.layerId)?.visible)
          continue;
        if (
          s.points.some((q, i) =>
            Math.abs(p.x - a.x) < 0.008
              ? distance(p, q, s.points[i + 1] || q) < 0.015
              : q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1,
          )
        )
          state.selected.add(s.id);
      }
      emit("selection");
    } else if (action.tool === "Line" || action.tool === "Shape stamp") {
      const strokes = shapeStrokes(
        action.start,
        p,
        action.tool === "Line" ? "Straight line" : state.brush.shape,
      );
      state.project.strokes.push(...strokes);
      state.selected = new Set(strokes.map((s) => s.id));
      state.tool = "Select";
      emit("tool");
    } else if (action.stroke && action.stroke.brush !== "Drums") {
      action.stroke.points = simplify(action.stroke.points, 0.00065);
    }
    const before = action.before;
    action = null;
    setPreview(null);
    commit(before);
    invalidate();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => cancelAction());
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      state.zoom = clamp(state.zoom * (e.deltaY > 0 ? 0.9 : 1.1), 1, 4);
      state.pan.x = clamp(state.pan.x, 1 - state.zoom, 0);
      state.pan.y = clamp(state.pan.y, 1 - state.zoom, 0);
      emit("view");
    },
    { passive: false },
  );
}

// Image import
// Marching squares detects grayscale threshold crossings and joins them into
// contours. Shared grid-edge keys keep adjacent cells connected exactly.
export function extractContours(
  data,
  width,
  height,
  { threshold = 128, invert = false, detail = 50, aspect = 1 } = {},
) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = data[i * 4 + 3] / 255;
    const v =
      (data[i * 4] * 0.2126 +
        data[i * 4 + 1] * 0.7152 +
        data[i * 4 + 2] * 0.0722) *
        a +
      255 * (1 - a);
    gray[i] = invert ? 255 - v : v;
  }
  const nodes = new Map(),
    links = [];
  function node(key, x, y) {
    if (!nodes.has(key)) nodes.set(key, { x, y, edges: [] });
    return nodes.get(key);
  }
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const hits = [];
      for (let e = 0; e < 4; e++) {
        const [ax, ay] = corners[e],
          [bx, by] = corners[(e + 1) % 4];
        const a = gray[ay * width + ax],
          b = gray[by * width + bx];
        if (a < threshold === b < threshold) continue;
        const t = (threshold - a) / (b - a);
        const key =
          ay === by
            ? `h${Math.min(ax, bx)},${ay}`
            : `v${ax},${Math.min(ay, by)}`;
        hits.push(node(key, ax + (bx - ax) * t, ay + (by - ay) * t));
      }
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const edge = { a: hits[i], b: hits[i + 1], used: false };
        edge.a.edges.push(edge);
        edge.b.edges.push(edge);
        links.push(edge);
      }
    }
  const imageAspect = (width - 1) / (height - 1);
  const fitW = Math.min(1, imageAspect / aspect),
    fitH = Math.min(1, aspect / imageAspect);
  const contours = [];
  function trace(start, first) {
    const points = [];
    let current = start,
      edge = first;
    while (edge && !edge.used) {
      points.push({ x: current.x, y: current.y });
      edge.used = true;
      current = edge.a === current ? edge.b : edge.a;
      edge = current.edges.find((e) => !e.used);
    }
    points.push({ x: current.x, y: current.y });
    const length = points
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y),
        0,
      );
    if (length < 3 + (100 - detail) * 0.08) return;
    const reduced = simplify(points, 0.35 + (100 - detail) * 0.025);
    contours.push(
      reduced.map((p) => ({
        x: (1 - fitW) / 2 + (p.x / (width - 1)) * fitW,
        y: (1 - fitH) / 2 + (p.y / (height - 1)) * fitH,
        pressure: 0.65,
      })),
    );
  }
  for (const n of nodes.values())
    if (n.edges.length === 1 && !n.edges[0].used) trace(n, n.edges[0]);
  for (const e of links) if (!e.used) trace(e.a, e);
  if (contours.length > 2000)
    throw Error("Too many contours. Lower Detail or adjust Edge Threshold.");
  return contours;
}

export async function processImage(file, options) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("Choose a PNG, JPG, or WebP image.");
  if (file.size > 30 * 1024 * 1024)
    throw Error("Choose an image smaller than 30 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const limit = Math.round(160 + options.detail * 4);
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(bitmap.width * scale));
    canvas.height = Math.max(2, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const contours = extractContours(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      options,
    );
    // Retain straight simplified geometry while adding handles for local smudging.
    return contours.map((points) => {
      const sampled = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const steps = Math.max(
          1,
          Math.ceil(Math.hypot((b.x - a.x) * options.aspect, b.y - a.y) / 0.01),
        );
        for (let j = 1; j <= steps; j++)
          sampled.push({
            x: a.x + ((b.x - a.x) * j) / steps,
            y: a.y + ((b.y - a.y) * j) / steps,
            pressure: 0.65,
          });
      }
      return sampled;
    });
  } catch (error) {
    throw Error(
      error.message.startsWith("Too many")
        ? error.message
        : "This image could not be processed. Try another PNG, JPG, or WebP file.",
    );
  } finally {
    bitmap?.close();
  }
}

// Playhead interaction
export function initSeeking() {
  const canvas = canvasElement();
  const ruler = document.createElement("div");
  ruler.id = "playhead-ruler";
  ruler.tabIndex = 0;
  ruler.setAttribute("role", "slider");
  ruler.setAttribute("aria-label", "Playhead position");
  ruler.setAttribute("aria-valuemin", "0");
  ruler.setAttribute("aria-valuemax", "100");
  ruler.title =
    "Click or drag to seek. Arrow keys move one beat; Home returns to the start.";
  canvas.parentElement.append(ruler);
  let pointer = null;
  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    seek(
      ((e.clientX - rect.left - view.left) / view.width - state.pan.x) /
        state.zoom,
    );
  };
  ruler.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    ruler.focus();
    ruler.setPointerCapture(pointer);
    move(e);
    e.preventDefault();
  });
  ruler.addEventListener("pointermove", (e) => {
    if (e.pointerId === pointer) move(e);
  });
  ruler.addEventListener("pointerup", (e) => {
    if (e.pointerId === pointer) {
      move(e);
      pointer = null;
    }
  });
  ruler.addEventListener("lostpointercapture", () => {
    pointer = null;
  });
  ruler.addEventListener("pointercancel", () => {
    pointer = null;
  });
  ruler.addEventListener("keydown", (e) => {
    const step = (e.shiftKey ? 4 : 1) / (state.project.bars * 4);
    const positions = {
      ArrowLeft: state.position - step,
      ArrowDown: state.position - step,
      ArrowRight: state.position + step,
      ArrowUp: state.position + step,
      Home: 0,
      End: 1,
    };
    if (e.key in positions) {
      e.preventDefault();
      e.stopPropagation();
      seek(positions[e.key]);
    }
  });
  function update() {
    ruler.setAttribute(
      "aria-valuenow",
      String(Math.round(state.position * 1000) / 10),
    );
    ruler.setAttribute(
      "aria-valuetext",
      `Beat ${(state.position * state.project.bars * 4 + 1).toFixed(1)}`,
    );
    requestAnimationFrame(update);
  }
  update();
}
