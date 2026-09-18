import {
  state,
  newStroke,
  clamp,
  uid,
  snapshot,
  commit,
  emit,
  change,
  pitchAt,
  noteName,
} from "./state.js";
import {
  canvasElement,
  canvasPoint,
  screenPoint,
  setPreview,
  invalidate,
  bounds,
  view,
  resetPaper,
} from "./canvas.js";
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
