import { defaults, SCALES, TOOLS, clamp } from "./state.js";
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
      brush: TOOLS.slice(0, 7).includes(s.brush) ? s.brush : "Ink",
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
