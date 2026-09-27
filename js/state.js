
// Project state and history
export const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export const uid = () =>
  globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random()}`;
export const TOOLS = [
  "Pencil",
  "Ink",
  "Watercolor",
  "Marker",
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

// Project storage and validation
let dbPromise;
function database() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("draw-synth", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("projects", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function transaction(store, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      req = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function saveProject(project) {
  const copy = structuredClone(project);
  copy.updatedAt = Date.now();
  await transaction("projects", "readwrite", (s) => s.put(copy));
  await transaction("settings", "readwrite", (s) => s.put(copy.id, "last"));
  return copy;
}
export function listProjects() {
  return transaction("projects", "readonly", (s) => s.getAll());
}
export function removeProject(id) {
  return transaction("projects", "readwrite", (s) => s.delete(id));
}
export async function restoreProject() {
  const id = await transaction("settings", "readonly", (s) => s.get("last"));
  if (!id) return null;
  const p = await transaction("projects", "readonly", (s) => s.get(id));
  return p ? validateProject(p) : null;
}
export function validateProject(data) {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.strokes) ||
    !Array.isArray(data.layers) ||
    data.layers.length < 1 ||
    data.layers.length > 8
  )
    throw Error("This is not a supported Draw Synth project.");
  if (data.strokes.length > 10000)
    throw Error("This project exceeds the 10,000 stroke limit.");
  const p = defaults(),
    num = (v, d, min, max) =>
      typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : d;
  p.id = typeof data.id === "string" ? data.id : p.id;
  p.name = String(data.name || "Untitled jam").slice(0, 80);
  p.layers = data.layers.map((l, i) => ({
    id: String(l.id || `layer-${i}`),
    name: String(l.name || `Layer ${i + 1}`).slice(0, 40),
    visible: l.visible !== false,
    mute: !!l.mute,
    solo: !!l.solo,
    volume: num(l.volume, 0.8, 0, 1),
  }));
  if (new Set(p.layers.map((l) => l.id)).size !== p.layers.length)
    throw Error("Layer IDs must be unique.");
  const ids = new Set();
  let total = 0;
  p.strokes = data.strokes.map((s) => {
    if (
      !Array.isArray(s.points) ||
      !s.points.length ||
      s.points.length > 6000 ||
      !p.layers.some((l) => l.id === s.layerId)
    )
      throw Error("A stroke contains invalid points or a missing layer.");
    total += s.points.length;
    if (total > 500000) throw Error("This project has too many points.");
    const id = String(s.id);
    if (ids.has(id)) throw Error("Stroke IDs must be unique.");
    ids.add(id);
    return {
      id,
      points: s.points.map((q) => {
        if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
          throw Error("Invalid stroke coordinates.");
        return {
          x: clamp(q.x),
          y: clamp(q.y),
          pressure: num(q.pressure, 0.65, 0.01, 1),
        };
      }),
      brush: TOOLS.slice(0, 6).includes(s.brush) ? s.brush : "Ink",
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#4b7ed5",
      size: num(s.size, 9, 1, 80),
      opacity: num(s.opacity, 0.9, 0.01, 1),
      layerId: s.layerId,
      smudged: !!s.smudged,
      sound: {
        volume: num(s.sound?.volume, 0.65, 0, 1),
        attack: num(s.sound?.attack, 0.025, 0.001, 2),
        release: num(s.sound?.release, 0.18, 0.01, 2),
        hardness: num(s.sound?.hardness, 0.75, 0, 1),
        soundSmoothing: num(s.sound?.soundSmoothing, 0.65, 0, 1),
        drum: ["kick", "snare", "closed hi-hat", "open hi-hat"].includes(
          s.sound?.drum,
        )
          ? s.sound.drum
          : "kick",
      },
    };
  });
  for (const [key, min, max] of [
    ["bpm", 40, 240],
    ["root", 1, 6],
    ["master", 0, 1],
    ["metroVolume", 0, 1],
    ["reverb", 0, 1],
    ["delay", 0, 1],
    ["brightness", 0, 1],
  ])
    p[key] = num(data[key], p[key], min, max);
  p.pitchShift = Math.round(num(data.pitchShift, 0, -24, 24));
  p.bars = [1, 2, 4, 8].includes(data.bars) ? data.bars : 4;
  p.octaves = [1, 2, 3, 4].includes(data.octaves) ? data.octaves : 3;
  p.scale = SCALES[data.scale] ? data.scale : "C major";
  for (const k of ["snap", "loop", "pingpong", "metronome"])
    if (typeof data[k] === "boolean") p[k] = data[k];
  const paper = data.paper || {};
  p.paper = {
    type: [
      "Grid Paper",
      "Graph Paper",
      "Staff Paper",
      "Blank Paper",
      "Dark Paper",
    ].includes(paper.type)
      ? paper.type
      : "Grid Paper",
    color: /^#[0-9a-f]{6}$/i.test(paper.color) ? paper.color : "#faf9f3",
    grid: paper.grid !== false,
    labels: paper.labels !== false,
    opacity: num(paper.opacity, 0.22, 0, 1),
    division: [1, 2, 4].includes(paper.division) ? paper.division : 4,
  };
  return p;
}
