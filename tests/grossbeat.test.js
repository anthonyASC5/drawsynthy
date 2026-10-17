import test from "node:test";
import assert from "node:assert/strict";
import {
  grossDefaults,
  grossPreset,
  grossBeatMarks,
  grossBeatPlan,
  normalizeGross,
  randomGrossSteps,
  GROSS_PRESETS,
} from "../grossbeat.js";
import {
  defaults,
  newStroke,
  state,
  loadProject,
  grossBeat,
  grossEditor,
  grossSource,
  grossPreview,
  updateGrossBeat,
  playbackProject,
  applyGrossBeat,
  removeGrossBeat,
  undo,
  redo,
  validateProject,
  snapshot,
} from "../state.js";
import { compileNotes, timeline } from "../audio.js";
import { encodeMIDI } from "../canvas.js";

function project(
  points = [
    { x: 0, y: 0.7 },
    { x: 0.0625, y: 0.3 },
  ],
) {
  const p = defaults();
  p.bars = 2;
  p.strokes = [
    { ...newStroke(points, "Marker"), id: "source", layerId: p.layers[0].id },
  ];
  return p;
}
function processed(p, preset, options = {}) {
  return {
    ...p,
    strokes: grossBeatMarks(p.strokes, p, {
      ...grossPreset(preset),
      ...options,
    }),
  };
}
const sum = (notes) => notes.reduce((n, note) => n + note.duration, 0);
const events = (p) =>
  timeline(p).map(({ start, duration, pitch, curve, velocity }) => ({
    start,
    duration,
    pitch,
    curve,
    velocity,
  }));
function setup(keep = false) {
  state.tool = "Select";
  loadProject(project());
  state.tool = "Gross Beat";
  grossEditor.target = "auto";
  Object.assign(grossBeat, grossPreset("Stutter"), { keep });
  updateGrossBeat();
}

test("all presets are deterministic beat-domain transforms with a two-bar buffer", () => {
  const p = project([
    { x: 0, y: 0.7 },
    { x: 1, y: 0.3 },
  ]);
  p.bars = 8;
  for (const preset of GROSS_PRESETS) {
    const options = grossPreset(preset);
    assert.deepEqual(
      grossBeatMarks(p.strokes, p, options),
      grossBeatMarks(p.strokes, { ...p, bpm: 190 }, options),
      preset,
    );
    const plan = grossBeatPlan(p, options);
    assert.ok(plan.length > 0, preset);
    for (const w of plan) {
      assert.ok(w.start >= 0 && w.end <= 32 + 1e-8 && w.end > w.start);
      assert.ok(w.from >= -1e-8 && w.to <= 32 + 1e-8);
      assert.ok(w.to - w.from <= 8 + 1e-8);
    }
  }
});
test("Half Speed doubles duration and preserves the source pitch heights", () => {
  const p = project();
  const wet = processed(p, "Half Speed");
  assert.equal(sum(compileNotes(wet)), 2 * sum(compileNotes(p)));
  assert.equal(
    Math.max(...wet.strokes.flatMap((s) => s.points.map((p) => p.x))),
    0.125,
  );
  assert.deepEqual(
    [
      Math.min(...wet.strokes.flatMap((s) => s.points.map((p) => p.y))),
      Math.max(...wet.strokes.flatMap((s) => s.points.map((p) => p.y))),
    ],
    [0.3, 0.7],
  );
});
test("Double Time compresses and repeats a pattern", () => {
  const p = project();
  const notes = compileNotes(processed(p, "Double Time"));
  assert.deepEqual(
    notes.map((n) => n.start),
    [0, 2],
  );
  assert.deepEqual(
    notes.map((n) => n.duration),
    [0.25, 0.25],
  );
});
test("Reverse flips pitch curves and reverses point-event duration at the region edge", () => {
  const p = project();
  const [note] = compileNotes(processed(p, "Reverse"));
  assert.equal(note.start, 3.5);
  assert.equal(note.duration, 0.5);
  assert.equal(note.curve[0].pitch, compileNotes(p)[0].curve.at(-1).pitch);
  const [dot] = compileNotes(processed(project([{ x: 0, y: 0.6 }]), "Reverse"));
  assert.equal(dot.start, 3.8);
  assert.ok(Math.abs(dot.duration - 0.2) < 1e-8);
});
test("Stutter repeats selected-rate slices; triplets divide two rates in three", () => {
  const p = project();
  assert.deepEqual(
    compileNotes(processed(p, "Stutter")).map((n) => n.start),
    [0, 0.5, 1, 1.5],
  );
  const notes = compileNotes(processed(p, "Triplet Chop"));
  assert.equal(notes.length, 3);
  notes.forEach((n, i) => {
    assert.ok(Math.abs(n.start - i / 3) < 1e-8);
    assert.ok(Math.abs(n.duration - 1 / 3) < 1e-8);
  });
});
test("slice boundary dots are owned once and clipping preserves pitch interpolation", () => {
  const p = project([{ x: 0.0625, y: 0.4 }]);
  assert.equal(compileNotes(processed(p, "Gate", { gate: 0 })).length, 1);
  const path = project([
    { x: 0, y: 1 },
    { x: 0.125, y: 0 },
  ]);
  const notes = compileNotes(processed(path, "Gate", { gate: 0 }));
  assert.equal(notes.length, 2);
  assert.equal(notes[0].curve.at(-1).pitch, notes[1].curve[0].pitch);
  assert.ok(notes.every((n) => n.duration === 0.5));
});
test("Gate mutes its cut portion and chopped notes retain timing with Melody on", () => {
  const p = project();
  const gate = processed(p, "Gate");
  assert.equal(sum(compileNotes(gate)), sum(compileNotes(p)) / 2);
  assert.equal(processed(p, "Gate", { gate: 1 }).strokes.length, 0);
  assert.deepEqual(events(gate), events({ ...gate, melody: true }));
});
test("Mix has exact dry and wet endpoints and does not mutate sources", () => {
  const p = project(),
    before = structuredClone(p);
  const dry = processed(p, "Reverse", { mix: 0 });
  assert.deepEqual(events(dry), events(p));
  const mixed = processed(p, "Reverse", { mix: 0.5 });
  assert.equal(mixed.strokes.length, 2);
  assert.ok(
    mixed.strokes.every(
      (s) => s.sound.volume === p.strokes[0].sound.volume / 2,
    ),
  );
  assert.deepEqual(p, before);
});
test("Custom supports disabled, reverse, repeat and mute steps within rolling history", () => {
  const p = project([
    { x: 0, y: 0.7 },
    { x: 1, y: 0.3 },
  ]);
  const options = grossPreset("Custom");
  options.length = 2;
  options.steps.forEach((s) => {
    s.on = false;
  });
  options.steps[0] = { on: true, position: 0, action: "Reverse" };
  options.steps[1] = { on: true, position: 0, action: "Repeat" };
  options.steps[2] = { on: true, position: 0, action: "Mute" };
  const plan = grossBeatPlan(p, options);
  assert.equal(plan[0].reverse, true);
  assert.equal(plan.length, 3);
  assert.deepEqual(
    plan.slice(1).map((w) => w.from),
    [0, 0],
  );
  assert.ok(plan.every((w) => w.end <= 1));
  const noHistory = grossPreset("Custom");
  noHistory.steps.forEach((s) => {
    s.position = 0;
  });
  assert.ok(
    grossBeatPlan({ ...p, loop: false }, noHistory).length <
      grossBeatPlan(p, noHistory).length,
  );
});
test("seeded glitch and custom randomization are repeatable and variable", () => {
  const p = project([
    { x: 0, y: 0.8 },
    { x: 1, y: 0.2 },
  ]);
  assert.deepEqual(
    processed(p, "Random Glitch"),
    processed(p, "Random Glitch"),
  );
  assert.notDeepEqual(
    processed(p, "Random Glitch", { seed: 1 }),
    processed(p, "Random Glitch", { seed: 2 }),
  );
  assert.deepEqual(
    randomGrossSteps({ seed: 7 }),
    randomGrossSteps({ seed: 7 }),
  );
});
test("preview replaces its source without altering project or Undo history", () => {
  setup();
  const before = snapshot();
  assert.equal(grossSource().length, 1);
  assert.equal(grossPreview().marks.length, 4);
  assert.equal(playbackProject().strokes.length, 4);
  assert.equal(snapshot(), before);
  assert.equal(state.history.length, 0);
  state.selected = new Set(["source"]);
  grossEditor.target = "selection";
  updateGrossBeat();
  assert.equal(grossSource().length, 1);
  state.selected.clear();
  updateGrossBeat();
  assert.equal(grossSource().length, 0);
  assert.throws(applyGrossBeat, /Select drawing or choose a layer/);
});
test("Apply and Remove each form one Undo action and restore editable source", () => {
  setup();
  const original = structuredClone(state.project.strokes);
  applyGrossBeat();
  const effectId = state.project.grossBeatEffects[0].id;
  assert.equal(state.history.length, 1);
  assert.equal(state.project.strokes.length, 4);
  assert.equal(state.selected.size, 4);
  const applied = snapshot();
  undo();
  assert.deepEqual(state.project.strokes, original);
  redo();
  assert.equal(snapshot(), applied);
  state.project.strokes[0].points[0].y = 0.1;
  removeGrossBeat(effectId);
  assert.equal(state.history.length, 2);
  assert.deepEqual(state.project.strokes, original);
  undo();
  assert.equal(state.project.grossBeatEffects.length, 1);
  redo();
  assert.deepEqual(state.project.strokes, original);
});
test("Keep Original retains the original and removal restores only one source", () => {
  setup(true);
  applyGrossBeat();
  assert.equal(state.project.strokes.length, 5);
  assert.equal(state.project.strokes[0].id, "source");
  removeGrossBeat();
  assert.equal(state.project.strokes.length, 1);
  assert.equal(state.project.strokes[0].id, "source");
});
test("saved options, archives, editable chops, MIDI and notes survive project validation", () => {
  setup();
  grossBeat.seed = 17;
  grossBeat.steps[3].action = "Mute";
  applyGrossBeat();
  const p = state.project;
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(events(restored), events(p));
  assert.equal(restored.grossBeat.seed, 17);
  assert.equal(restored.grossBeat.steps[3].action, "Mute");
  assert.equal(restored.grossBeatEffects[0].source[0].id, "source");
  assert.deepEqual(encodeMIDI(restored), encodeMIDI(p));
  loadProject(restored);
  assert.equal(grossBeat.seed, 17);
  removeGrossBeat();
  assert.equal(state.project.strokes[0].id, "source");
});
test("nested effects restore in dependency order and missing layers have a restore destination", () => {
  setup();
  applyGrossBeat();
  const first = state.project.grossBeatEffects[0].id;
  updateGrossBeat();
  applyGrossBeat();
  assert.throws(() => removeGrossBeat(first), /newer/);
  removeGrossBeat();
  removeGrossBeat(first);
  assert.equal(state.project.strokes[0].id, "source");
  setup();
  applyGrossBeat();
  state.project.layers.shift();
  state.project.strokes = [];
  const restored = validateProject(JSON.parse(snapshot()));
  loadProject(restored);
  removeGrossBeat();
  assert.equal(state.project.strokes[0].layerId, restored.layers[0].id);
});
test("malformed settings are bounded and dense transforms fail atomically", () => {
  assert.deepEqual(normalizeGross(null), grossDefaults());
  const settings = normalizeGross({
    speed: Infinity,
    repeat: 100,
    gate: -2,
    steps: [{ position: Infinity, action: "bad" }],
  });
  assert.equal(settings.repeat, 8);
  assert.equal(settings.gate, 0);
  assert.equal(settings.steps.length, 16);
  setup();
  const p = state.project;
  p.strokes = Array.from({ length: 10001 }, (_, i) => ({
    ...p.strokes[0],
    id: `s-${i}`,
  }));
  const before = snapshot();
  assert.throws(applyGrossBeat, /dense|limit/);
  assert.equal(snapshot(), before);
  assert.equal(state.history.length, 0);
});
