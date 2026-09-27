// This module owns project defaults, shared editor state, undo history, persistence, and
// musical transformations. Geometry and timing helpers stay independent of the DOM.
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
  "Musical Symmetry",
  "Echo Paint",
  "Rhythm Rain",
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
  // New projects start with four layers and an empty drawing. Playback, effect, and
  // paper defaults are serialized with the project so saved drawings reopen
  // consistently.
  name: "Untitled jam",
  strokes: [],
  rainClouds: [],
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
    // Transient editor state holds the active brush, selection, viewport, and history
    // stacks. Subscribers are notified through one event channel whenever those values
    // change.
    volume: 0.65,
    attack: 0.025,
    release: 0.18,
    strength: 0.65,
    soundSmoothing: 0.65,
    drum: "kick",
    shape: "Wave",
  },
  selected: new Set(),
  selectedCloud: null,
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
  // Undo and Redo replace project snapshots and clear stale mark selections. Loading
  // resets the editing session, while pitch helpers map canvas height through the chosen
  // scale.
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
  state.selectedCloud = null;
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
  // Note names format pitches for UI labels. New marks copy current brush and instrument
  // settings, and the demo builder creates normal editable strokes rather than special
  // assets.
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
// The drawing clipboard holds independent vector copies, not a bitmap. It survives
// project changes within this tab, and Copy never changes project history.
let copiedMarks = [],
  pasteCount = 0;
export function canPasteSelection() {
  return copiedMarks.length > 0;
}
export function copySelection() {
  const marks = state.project.strokes.filter((s) => state.selected.has(s.id));
  if (!marks.length) return 0;
  copiedMarks = structuredClone(marks);
  pasteCount = 0;
  return marks.length;
}
export function pasteSelection(at = null) {
  if (!copiedMarks.length) return 0;
  const project = state.project;
  const points = [...project.strokes, ...copiedMarks].reduce(
    (n, s) => n + s.points.length,
    0,
  );
  if (project.strokes.length + copiedMarks.length > 10000 || points > 500000)
    throw Error("Pasting would exceed the project's stroke or point limit.");
  let left = 1,
    right = 0,
    top = 1,
    bottom = 0;
  for (const s of copiedMarks)
    for (const p of s.points) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
  // Translate the whole group together, clamping its bounds instead of individual
  // points so pasted shapes do not flatten at the canvas edges.
  const offset = 0.025 * (pasteCount + 1);
  const dx = clamp(at ? at.x - (left + right) / 2 : offset, -left, 1 - right);
  const dy = clamp(at ? at.y - (top + bottom) / 2 : offset, -top, 1 - bottom);
  const layerId =
    project.layers.find((l) => l.id === state.layer)?.id ||
    project.layers[0].id;
  const copies = copiedMarks.map((s) => ({
    ...structuredClone(s),
    id: uid(),
    layerId,
    points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  }));
  change(() => {
    project.strokes.push(...copies);
    state.selected = new Set(copies.map((s) => s.id));
    state.tool = "Select";
  });
  pasteCount++;
  emit("tool");
  return copies.length;
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
  // The demo layers melody, harmony, bass, and percussion marks. IndexedDB stores
  // project snapshots separately from the last-opened-project setting.
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
    // Storage promises resolve when their transaction completes. Project validation then
    // checks the version, layer count, stroke limits, and ownership before accepting
    // imported data.
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
    // Layer IDs and stroke IDs must be unique. Point coordinates and sound settings are
    // normalized so malformed imports cannot inject invalid geometry or non-finite
    // synthesis values.
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
      pitchShift: num(s.pitchShift, 0, -127, 127),
      color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#4b7ed5",
      size: num(s.size, 9, 1, 80),
      opacity: num(s.opacity, 0.9, 0, 1),
      layerId: s.layerId,
      smudged: !!s.smudged,
      sound: {
        volume: num(s.sound?.volume, 0.65, 0, 1),
        attack: num(s.sound?.attack, 0.025, 0.001, 2),
        release: num(s.sound?.release, 0.18, 0.01, 2),
        hardness: num(s.sound?.hardness, 0.75, 0, 1),
        soundSmoothing: num(s.sound?.soundSmoothing, 0.65, 0, 1),
        // Validated instrument settings retain supported drum choices and safe
        // envelopes. Project timing, transposition, rain-cloud limits, and paper options
        // are constrained to supported values.
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
  if (
    data.rainClouds !== undefined &&
    (!Array.isArray(data.rainClouds) || data.rainClouds.length > 4)
  )
    throw Error("A project supports at most four rain clouds.");
  const cloudIds = new Set();
  p.rainClouds = (data.rainClouds || []).map((c) => {
    if (!c || typeof c.id !== "string" || cloudIds.has(c.id))
      throw Error("Rain cloud IDs must be unique strings.");
    cloudIds.add(c.id);
    return {
      id: c.id,
      x: num(c.x, 0.5, 0, 1),
      amount: Math.round(num(c.amount, 2, 1, 8)),
      speed: num(c.speed, 1, 0.5, 4),
      spread: num(c.spread, 0.2, 0, 1),
      division: [4, 8, 16, 32].includes(c.division) ? c.division : 8,
    };
  });
  p.bars = [1, 2, 4, 8].includes(data.bars) ? data.bars : 4;
  p.octaves = [1, 2, 3, 4].includes(data.octaves) ? data.octaves : 3;
  p.scale = SCALES[data.scale] ? data.scale : "C major";
  for (const k of ["snap", "loop", "pingpong", "metronome"])
    if (typeof data[k] === "boolean") p[k] = data[k];
  const paper = data.paper || {};
  p.paper = {
    // Paper validation preserves presentation settings. Musical-tool defaults and the
    // active mirror session remain editor state, separate from committed vector artwork.
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

// Musical transformations and deterministic rain geometry
export const MUSICAL_TOOLS = ["Musical Symmetry", "Echo Paint", "Rhythm Rain"];
export const symmetry = {
  mode: "Vertical",
  x: 0.5,
  y: 0.5,
  keep: true,
  destination: "Current Layer",
};
export const echo = {
  copies: 3,
  delay: 0.25,
  fade: 0.3,
  pitch: 0,
  separate: false,
};
export const rainDefaults = { amount: 2, speed: 1, spread: 0.2, division: 8 };
export const wrap = (n, length = 1) => ((n % length) + length) % length;

export function selectedMarks() {
  return state.project.strokes.filter((s) => state.selected.has(s.id));
}

let mirrorSession = null;
export function symmetrySourceCount() {
  return mirrorSession?.source.length || 0;
}
// Starting symmetry captures visible source marks. Updates replace that session's
// copies, enforce project limits, and preserve the source snapshot for stable axis
// adjustments.
export function startSymmetry() {
  const source = state.project.strokes.filter(
    (s) => state.project.layers.find((l) => l.id === s.layerId)?.visible,
  );
  mirrorSession = {
    project: state.project.id,
    source: structuredClone(source),
    copies: new Map(),
  };
  updateSymmetry();
}
export function updateSymmetry(record = true) {
  if (
    !mirrorSession ||
    mirrorSession.project !== state.project.id ||
    !mirrorSession.source.length
  )
    return;
  const p = state.project,
    session = mirrorSession;
  const originals = new Set(session.source.map((s) => s.id));
  const oldCopies = new Set(session.copies.values());
  const remaining = p.strokes.filter(
    (s) => !originals.has(s.id) && !oldCopies.has(s.id),
  );
  const copies = mirrorMarks(session.source);
  const existing =
    symmetry.destination === "Harmony Layer" &&
    p.layers.find((l) => l.name === "Harmony");
  if (
    symmetry.destination === "Harmony Layer" &&
    !existing &&
    p.layers.length >= 8
  )
    throw Error("Make room for a Harmony layer first (maximum eight layers).");
  const strokes = [
    ...remaining,
    ...(symmetry.keep ? structuredClone(session.source) : []),
    ...copies,
  ];
  if (
    strokes.length > 10000 ||
    strokes.reduce((n, s) => n + s.points.length, 0) > 500000
  )
    throw Error("These mirrors exceed the project's stroke or point limit.");
  // Symmetry destinations reuse or create Harmony, while generated IDs remain stable
  // across adjustments. Echo playback previews augment the project without changing its
  // saved strokes.
  const update = () => {
    let layerId = state.layer;
    if (symmetry.destination === "Harmony Layer") {
      layerId = existing?.id || uid();
      if (!existing)
        p.layers.push({
          id: layerId,
          name: "Harmony",
          visible: true,
          mute: false,
          solo: false,
          volume: 0.8,
        });
    }
    for (const s of copies) {
      if (!session.copies.has(s.id)) session.copies.set(s.id, uid());
      s.id = session.copies.get(s.id);
      s.layerId = layerId;
    }
    p.strokes = strokes;
    state.selected.clear();
  };
  if (record) change(update);
  else update();
}
subscribe((type) => {
  if (type === "load" || (type === "tool" && state.tool !== "Musical Symmetry"))
    mirrorSession = null;
});

// Echo previews use the same vector-to-note compiler as committed artwork.
// They are transient: Apply makes them part of saved projects and exports.
export function playbackProject() {
  return state.tool === "Echo Paint"
    ? {
        ...state.project,
        strokes: [...state.project.strokes, ...generatedMarks()],
      }
    : state.project;
}

export function mirrorMarks(strokes, options = symmetry) {
  // Both creates the two axis reflections and their combined reflection.
  // Reflection transforms independently flip time and pitch coordinates. Echo geometry
  // splits at loop seams so wrapped endpoints cannot draw or sound a line across the
  // full canvas.
  const axes =
    options.mode === "Both"
      ? [
          [false, true],
          [true, false],
          [true, true],
        ]
      : [[options.mode === "Horizontal", options.mode === "Vertical"]];
  return strokes.flatMap((s) =>
    axes.map(([horizontal, vertical], i) => ({
      ...structuredClone(s),
      id: `${s.id}-mirror-${i}`,
      points: s.points.map((p) => ({
        ...p,
        x: clamp(horizontal ? 2 * options.x - p.x : p.x),
        y: clamp(vertical ? 2 * options.y - p.y : p.y),
      })),
    })),
  );
}

// Split at loop seams, interpolating an endpoint on each side. Applying modulo
// to vertices alone would draw and sound a spurious line across the whole loop.
export function wrapPoints(points, offset) {
  const paths = [];
  let path = [];
  const push = () => {
    if (path.length) paths.push(path);
    path = [];
  };
  if (points.length === 1)
    return [[{ ...points[0], x: wrap(points[0].x + offset) }]];
  for (let i = 1; i < points.length; i++) {
    const a = { ...points[i - 1], x: points[i - 1].x + offset };
    const b = { ...points[i], x: points[i].x + offset };
    const cuts = [0, 1];
    for (
      let seam = Math.floor(Math.min(a.x, b.x)) + 1;
      seam < Math.max(a.x, b.x);
      seam++
    )
      cuts.push((seam - a.x) / (b.x - a.x));
    cuts.sort((x, y) => x - y);
    for (let j = 1; j < cuts.length; j++) {
      // Seam crossings interpolate position and pressure on both sides of the boundary.
      // Successive Echo copies retain brush settings while accumulating delay, fade, and
      // pitch changes.
      const cell = Math.floor(
        a.x + (b.x - a.x) * ((cuts[j - 1] + cuts[j]) / 2),
      );
      const point = (t) => ({
        ...a,
        x: clamp(a.x + (b.x - a.x) * t - cell),
        y: a.y + (b.y - a.y) * t,
        pressure:
          (a.pressure ?? 0.65) +
          ((b.pressure ?? 0.65) - (a.pressure ?? 0.65)) * t,
      });
      const start = point(cuts[j - 1]),
        end = point(cuts[j]);
      if (path.length && Math.abs(path.at(-1).x - start.x) > 0.5) push();
      if (!path.length) path.push(start);
      path.push(end);
    }
  }
  push();
  return paths;
}

export function echoMarks(strokes, project, options = echo) {
  const result = [];
  for (let i = 1; i <= options.copies; i++) {
    const fade = (1 - options.fade) ** i;
    for (const s of strokes) {
      const paths = wrapPoints(
        s.points,
        (i * options.delay) / (project.bars * 4),
      );
      paths.forEach((points, part) =>
        result.push({
          ...structuredClone(s),
          id: `${s.id}-echo-${i}-${part}`,
          points,
          opacity: s.opacity * fade,
          pitchShift: clamp((s.pitchShift || 0) + i * options.pitch, -127, 127),
          sound: { ...s.sound, volume: (s.sound.volume ?? 0.65) * fade },
        }),
      );
    }
  }
  // Generated Echo marks stay temporary until Apply. Applying checks capacity and layer
  // destinations before inserting the new editable vectors into one history transaction.
  return result;
}

export function generatedMarks() {
  const strokes = selectedMarks();
  return state.tool === "Echo Paint" ? echoMarks(strokes, state.project) : [];
}

export function applyMusicalTool() {
  const source = selectedMarks();
  if (!source.length) throw Error("Select one or more marks first.");
  const copies =
    state.tool === "Musical Symmetry" ? mirrorMarks(source) : generatedMarks();
  if (!copies.length) return;
  const p = state.project;
  const removing = state.tool === "Musical Symmetry" && !symmetry.keep;
  const remaining = removing
    ? p.strokes.filter((s) => !state.selected.has(s.id))
    : p.strokes;
  if (
    remaining.length + copies.length > 10000 ||
    copies.some((s) => s.points.length > 6000) ||
    [...remaining, ...copies].reduce((n, s) => n + s.points.length, 0) > 500000
  )
    throw Error("These copies exceed the project's stroke or point limit.");
  const layerName =
    state.tool === "Musical Symmetry"
      ? symmetry.destination === "Harmony Layer"
        ? "Harmony"
        : null
      : echo.separate
        ? "Echo"
        : null;
  const existing = layerName && p.layers.find((l) => l.name === layerName);
  if (layerName && !existing && p.layers.length >= 8)
    throw Error("Make room for a layer first (maximum eight layers).");
  change(() => {
    let layerId = state.layer;
    if (layerName) {
      layerId = existing?.id || uid();
      if (!existing)
        p.layers.push({
          id: layerId,
          name: layerName,
          visible: true,
          // Applied copies become the current selection. Rain-cloud creation and removal
          // also use project history, with a four-cloud limit and a stable ID for each
          // cloud.
          mute: false,
          solo: false,
          volume: 0.8,
        });
    }
    for (const s of copies) {
      s.id = uid();
      s.layerId =
        state.tool === "Echo Paint" && !echo.separate ? s.layerId : layerId;
    }
    p.strokes = [...remaining, ...copies];
    state.selected = new Set(copies.map((s) => s.id));
  });
  state.tool = "Select";
  emit("tool");
}

export function addRain(x = 0.5) {
  if ((state.project.rainClouds || []).length >= 4) return false;
  change(() => {
    const cloud = { id: uid(), x: clamp(x), ...rainDefaults };
    (state.project.rainClouds ??= []).push(cloud);
    state.selectedCloud = cloud.id;
  });
  emit("selection");
  return true;
}
export function removeRain() {
  change(() => {
    state.project.rainClouds = (state.project.rainClouds || []).filter(
      (c) => c.id !== state.selectedCloud,
    );
    state.selectedCloud = null;
  });
  emit("selection");
}

function randomFor(text) {
  let seed = 2166136261;
  for (const c of text) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    // Seeded randomness makes rain patterns repeatable. Collision lookup chooses only
    // the first mark below a droplet, including the contact point and interpolated
    // pressure.
    return seed / 4294967296;
  };
}

// The first geometric contact owns the droplet, including when its layer is
// muted. Hidden artwork still makes music, just like normal playhead playback.
export function rainContact(project, x) {
  let hit = null;
  for (const s of project.strokes) {
    const radius = Math.max(0.002, s.size / 1800);
    for (let i = 0; i < s.points.length; i++) {
      const a = s.points[i],
        b = s.points[i + 1] || a;
      if (x < Math.min(a.x, b.x) - radius || x > Math.max(a.x, b.x) + radius)
        continue;
      const t =
        a.x === b.x ? (a.y <= b.y ? 0 : 1) : clamp((x - a.x) / (b.x - a.x));
      const y = a.y + (b.y - a.y) * t;
      if (!hit || y < hit.y)
        hit = {
          strokeId: s.id,
          x,
          y,
          pressure:
            (a.pressure ?? 0.65) +
            ((b.pressure ?? 0.65) - (a.pressure ?? 0.65)) * t,
        };
    }
  }
  return hit;
}

export function rainPattern(project) {
  const length = project.bars * 4 * (project.pingpong ? 2 : 1),
    result = [];
  for (const cloud of project.rainClouds || []) {
    const random = randomFor(cloud.id),
      step = 4 / cloud.division;
    for (let born = 0, index = 0; born < length; born += step, index++) {
      for (let drop = 0; drop < cloud.amount; drop++) {
        const x = clamp(cloud.x + (random() - 0.5) * cloud.spread),
          size = 0.8 + random() * 0.4;
        const hit = rainContact(project, x),
          y = hit?.y ?? 1.05;
        const travel = (y + 0.04) / cloud.speed;
        // Each droplet stores its birth beat, travel time, wrapped contact beat, and
        // owning cloud. The same deterministic pattern drives animation, live notes, and
        // exported audio.
        result.push({
          id: `${cloud.id}:${index}:${drop}`,
          cloudId: cloud.id,
          born,
          travel,
          contact: born + travel,
          start: wrap(born + travel, length),
          x,
          y,
          size,
          hit,
        });
      }
    }
  }
  return result;
}
