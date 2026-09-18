export const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const uid = () =>
  globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random()}`;
export const TOOLS = [
  "Pencil",
  "Ink",
  "Watercolor",
  "Marker",
  "Airbrush",
  "Bass",
  "Drums",
  "Eraser",
  "Smudge",
  "Select",
  "Line",
  "Shape stamp",
  "Hand",
];
export const COLORS = [
  "#272b37",
  "#7b8290",
  "#f8f8ee",
  "#e65661",
  "#f3a24b",
  "#efd462",
  "#80b775",
  "#43a5a0",
  "#4b7ed5",
  "#8581cb",
  "#bc78b0",
  "#9e7056",
];
export const SCALES = {
  "C major": [0, 2, 4, 5, 7, 9, 11],
  "A minor": [0, 2, 3, 5, 7, 8, 10],
  "A minor pentatonic": [0, 3, 5, 7, 10],
  "D minor": [0, 2, 3, 5, 7, 8, 10],
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const defaults = () => ({
  id: uid(),
  version: 1,
  name: "Untitled jam",
  strokes: [],
  layers: ["Melody", "Harmony", "Bass", "Drums"].map((name, i) => ({
    id: `layer-${i}`,
    name,
    visible: true,
    mute: false,
    solo: false,
    volume: 0.8,
  })),
  bpm: 110,
  bars: 4,
  scale: "C major",
  octaves: 3,
  root: 3,
  snap: true,
  loop: true,
  pingpong: false,
  pitchShift: 0,
  master: 0.65,
  metronome: false,
  metroVolume: 0.25,
  reverb: 0.18,
  delay: 0.12,
  brightness: 0.7,
  paper: {
    type: "Grid Paper",
    color: "#faf9f3",
    grid: true,
    opacity: 0.22,
    division: 4,
    labels: true,
  },
});
export const state = {
  project: defaults(),
  tool: "Ink",
  color: COLORS[8],
  layer: "layer-0",
  brush: {
    size: 9,
    opacity: 0.9,
    hardness: 0.75,
    smoothing: 0.45,
    volume: 0.65,
    attack: 0.025,
    release: 0.18,
    strength: 0.65,
    soundSmoothing: 0.65,
    drum: "kick",
    shape: "Wave",
  },
  selected: new Set(),
  zoom: 1,
  pan: { x: 0, y: 0 },
  playing: false,
  position: 0,
  history: [],
  future: [],
  dirty: false,
};
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(type = "change") {
  for (const fn of listeners) fn(type);
}
export function snapshot() {
  return JSON.stringify(state.project);
}
export function commit(before) {
  if (before === snapshot()) return;
  state.history.push(before);
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  state.dirty = true;
  emit("edit");
}
export function change(fn) {
  const before = snapshot();
  fn();
  commit(before);
}
export function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  state.project = JSON.parse(state.history.pop());
  state.selected.clear();
  emit("edit");
}
export function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  state.project = JSON.parse(state.future.pop());
  state.selected.clear();
  emit("edit");
}
export function loadProject(p) {
  state.project = p;
  state.layer = p.layers[0].id;
  state.selected.clear();
  state.history = [];
  state.future = [];
  state.zoom = 1;
  state.pan = { x: 0, y: 0 };
  state.position = 0;
  state.dirty = false;
  emit("load");
}
export function pitches(p = state.project) {
  const root = p.scale.startsWith("A") ? 9 : p.scale.startsWith("D") ? 2 : 0;
  const base = (p.root + 1) * 12 + root;
  const result = [];
  for (let i = 0; i <= p.octaves * 12; i++)
    if (!p.snap || SCALES[p.scale].includes(i % 12)) result.push(base + i);
  return result;
}
export function pitchAt(y, p = state.project, glide = false) {
  const notes = pitches(p);
  const n = clamp(1 - y) * (notes.length - 1);
  if (!glide) return notes[Math.round(n)];
  const i = Math.floor(n);
  return (
    notes[i] + (notes[Math.min(i + 1, notes.length - 1)] - notes[i]) * (n - i)
  );
}
export function noteName(midi) {
  return (
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      Math.round(midi) % 12
    ] +
    (Math.floor(Math.round(midi) / 12) - 1)
  );
}
export function newStroke(points, tool = state.tool) {
  return {
    id: uid(),
    points,
    brush: tool,
    color: state.color,
    size: state.brush.size,
    opacity: state.brush.opacity,
    layerId: state.layer,
    sound: { ...state.brush },
  };
}
export function demo() {
  const p = defaults();
  p.name = "Daydream";
  const add = (points, brush, color, size, layer, opacity = 0.85) =>
    p.strokes.push({
      id: uid(),
      points: points.map(([x, y]) => ({ x, y, pressure: 0.65 })),
      brush,
      color,
      size,
      opacity,
      layerId: `layer-${layer}`,
      sound: {
        ...state.brush,
        attack: brush === "Watercolor" ? 0.18 : 0.03,
        release: 0.25,
        drum: "kick",
      },
    });
  const curve = (x0, x1, y, amp, n = 70) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [x0 + t * (x1 - x0), y - Math.sin(t * Math.PI * 2) * amp];
    });
  add(curve(0.06, 0.43, 0.32, 0.13), "Ink", COLORS[8], 10, 0);
  add(curve(0.51, 0.91, 0.28, 0.105), "Ink", COLORS[8], 10, 0);
  add(curve(0.1, 0.46, 0.51, 0.065), "Watercolor", COLORS[10], 29, 1, 0.36);
  add(curve(0.53, 0.88, 0.5, 0.07), "Watercolor", COLORS[10], 29, 1, 0.36);
  [
    [0.07, 0.2, 0.73],
    [0.29, 0.43, 0.67],
    [0.53, 0.67, 0.73],
    [0.77, 0.91, 0.64],
  ].forEach(([a, b, y]) =>
    add(
      [
        [a, y],
        [b, y],
      ],
      "Bass",
      COLORS[7],
      13,
      2,
    ),
  );
  for (let i = 0; i < 16; i++) {
    add([[(i + 0.5) / 16, 0.86]], "Drums", COLORS[4], 10, 3);
    p.strokes.at(-1).sound.drum =
      i % 4 === 0 ? "kick" : i % 4 === 2 ? "snare" : "closed hi-hat";
  }
  return p;
}
