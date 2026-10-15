import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  state,
  newStroke,
  setVoxSound,
  validateProject,
  mirrorMarks,
  echoMarks,
  symmetry,
  echo,
  loadProject,
  change,
  undo,
  redo,
} from "../state.js";
import { compileNotes, timeline, curvePitch } from "../audio.js";
import { encodeMIDI } from "../canvas.js";

function drawing() {
  const p = defaults();
  p.strokes = [
    {
      ...newStroke(
        [
          { x: 0.1, y: 0.7, pressure: 0.65 },
          { x: 0.3, y: 0.35, pressure: 0.65 },
          { x: 0.7, y: 0.5, pressure: 0.65 },
        ],
        "Vox",
      ),
      layerId: p.layers[0].id,
      size: 8,
    },
  ];
  return p;
}
test("Vox compiles one sustained voice, including folds and vertical marks", () => {
  const p = drawing(),
    s = p.strokes[0];
  let [n] = compileNotes(p);
  assert.equal(compileNotes(p).length, 1);
  assert.equal(n.start, 1.6);
  assert.ok(Math.abs(n.duration - 9.6) < 1e-8);
  assert.ok(curvePitch(n, 1) > n.pitch);
  p.pitchShift = 7;
  assert.equal(compileNotes(p)[0].pitch, n.pitch + 7);
  s.points.push({ x: 0.2, y: 0.4 });
  assert.equal(compileNotes(p).length, 1);
  s.points = [
    { x: 0.4, y: 0.1 },
    { x: 0.4, y: 0.9 },
  ];
  assert.equal(compileNotes(p).length, 1);
});
test("Vox thickness controls volume and opacity controls breath", () => {
  const p = drawing(),
    s = p.strokes[0],
    original = compileNotes(p)[0];
  s.size *= 2;
  assert.ok(compileNotes(p)[0].velocity > original.velocity);
  s.opacity = 0.15;
  assert.ok(compileNotes(p)[0].breathiness > original.breathiness);
  s.sound.volume = 0;
  assert.equal(compileNotes(p).length, 0);
});
test("Vox survives save validation, transformations, layers, and history", () => {
  const p = validateProject(drawing()),
    s = p.strokes[0];
  Object.assign(s.sound, {
    vowel: "Ee",
    formant: 1.4,
    vocalDepth: 0.4,
    vibratoAmount: 0.3,
    vibratoSpeed: 6,
    stereoDelay: 0.7,
  });
  assert.deepEqual(
    timeline(validateProject(JSON.parse(JSON.stringify(p)))),
    timeline(p),
  );
  symmetry.mode = "Vertical";
  symmetry.x = 0.5;
  const mirror = mirrorMarks([s])[0];
  assert.equal(mirror.brush, "Vox");
  assert.deepEqual(mirror.sound, s.sound);
  echo.copies = 2;
  echo.delay = 0.25;
  echo.pitch = 3;
  assert.ok(
    echoMarks([s], p).every((c) => c.brush === "Vox" && c.sound.vowel === "Ee"),
  );
  p.layers[0].mute = true;
  assert.equal(timeline(p).length, 0);
  p.layers[0].mute = false;
  loadProject(p);
  change(() => (state.project.strokes[0].points[0].y = 0.2));
  undo();
  assert.equal(state.project.strokes[0].points[0].y, 0.7);
  redo();
  assert.equal(state.project.strokes[0].points[0].y, 0.2);
  s.sound.formant = Infinity;
  s.sound.vowel = "bad";
  const valid = validateProject(p).strokes[0].sound;
  assert.equal(valid.formant, 1);
  assert.equal(valid.vowel, "Ooh");
});
test("Vox sustains in Melody mode and through a ping-pong turnaround", () => {
  const p = drawing();
  p.melody = true;
  assert.equal(timeline(p).length, 1);
  p.pingpong = true;
  p.strokes[0].points.at(-1).x = 1;
  const [n] = timeline(p);
  assert.equal(timeline(p).length, 1);
  assert.equal(n.duration, (16 - n.start) * 2);
});
test("Vox MIDI includes one sustained note and continuous pitch bend messages", () => {
  const bytes = encodeMIDI(drawing());
  // First spare channel is 4; layer channels remain available to other brushes.
  assert.ok(bytes.some((b, i) => b === 148 && bytes[i + 1] === 64));
  assert.ok(bytes.filter((b) => b === 228).length > 50);
  assert.ok(bytes.some((b, i) => b === 132 && bytes[i + 1] === 64));
});

test("Vox controls edit existing voices, preserve other brushes, and support history", () => {
  const p = drawing();
  p.strokes.push({
    ...structuredClone(p.strokes[0]),
    id: "other-vox",
    layerId: "layer-1",
  });
  p.strokes.push({ ...structuredClone(p.strokes[0]), id: "ink", brush: "Ink" });
  loadProject(p);
  const original = structuredClone(p.strokes);
  setVoxSound("vowel", "Ee");
  assert.equal(state.brush.vowel, "Ee");
  assert.equal(state.project.strokes[0].sound.vowel, "Ee");
  assert.equal(state.project.strokes[1].sound.vowel, "Ee");
  assert.deepEqual(state.project.strokes[2], original[2]);
  undo();
  assert.deepEqual(state.project.strokes, original);
  redo();
  assert.equal(state.project.strokes[0].sound.vowel, "Ee");
  state.selected = new Set(["other-vox"]);
  for (const [key, value] of Object.entries({
    formant: 1.7,
    vocalDepth: 0.8,
    vibratoAmount: 0.6,
    vibratoSpeed: 8,
    attack: 0.2,
    release: 0.8,
    volume: 0.4,
    stereoDelay: 0.9,
  })) {
    setVoxSound(key, value);
    assert.equal(state.project.strokes[1].sound[key], value);
    assert.equal(state.project.strokes[0].sound[key], original[0].sound[key]);
    assert.equal(state.brush[key], value);
  }
  const saved = validateProject(JSON.parse(JSON.stringify(state.project)));
  assert.equal(saved.strokes[1].sound.formant, 1.7);
  assert.equal(
    timeline(saved).find((n) => n.layerId === "layer-1").sound.formant,
    1.7,
  );
});
