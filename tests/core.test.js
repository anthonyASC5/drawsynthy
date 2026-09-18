import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  demo,
  pitchAt,
  state,
  change,
  undo,
  redo,
} from "../js/state.js";
import { compileNotes, timeline } from "../js/audio.js";
import { validateProject } from "../js/storage.js";
import { encodeMIDI, encodeWAV } from "../js/export.js";
import { simplify, shapeStrokes } from "../js/tools.js";
const drawing = () => {
  const p = defaults();
  p.strokes = [
    {
      id: "one",
      points: [
        { x: 0.2, y: 0.5, pressure: 0.7 },
        { x: 0.4, y: 0.3, pressure: 0.7 },
      ],
      brush: "Ink",
      color: "#4b7ed5",
      size: 10,
      opacity: 0.8,
      layerId: p.layers[0].id,
      sound: {
        volume: 0.7,
        hardness: 0.7,
        release: 0.1,
        attack: 0.025,
        drum: "kick",
        soundSmoothing: 0.65,
      },
    },
  ];
  return p;
};
test("unchanged project compiles deterministically", () => {
  const project = demo();
  assert.deepEqual(
    compileNotes(project),
    compileNotes(structuredClone(project)),
  );
});
test("moving horizontally changes timing and vertically changes pitch", () => {
  const p = drawing(),
    a = compileNotes(p)[0];
  p.strokes[0].points.forEach((q) => {
    q.x += 0.1;
    q.y -= 0.1;
  });
  const b = compileNotes(p)[0];
  assert.ok(Math.abs(b.start - a.start - 1.6) < 1e-8);
  assert.ok(b.pitch > a.pitch);
  assert.ok(Math.abs(b.duration - a.duration) < 1e-8);
});
test("continuous stroke yields one voice and its pitch curve", () => {
  const p = drawing(),
    n = compileNotes(p);
  assert.equal(n.length, 1);
  assert.equal(n[0].curve.length, 2);
  assert.equal(n[0].duration, 3.2);
});
test("paper, visibility and grid do not alter music; mute and solo do", () => {
  const p = drawing(),
    a = compileNotes(p);
  p.paper.type = "Dark Paper";
  p.paper.grid = false;
  p.layers[0].visible = false;
  assert.deepEqual(compileNotes(p), a);
  p.layers[0].mute = true;
  assert.equal(compileNotes(p).length, 0);
  p.layers[0].mute = false;
  p.layers[1].solo = true;
  assert.equal(compileNotes(p).length, 0);
});
test("thickness, pressure, opacity and duration affect sound", () => {
  const p = drawing(),
    a = compileNotes(p)[0];
  p.strokes[0].size = 20;
  p.strokes[0].opacity = 1;
  p.strokes[0].points[1].x = 0.6;
  const b = compileNotes(p)[0];
  assert.ok(b.velocity > a.velocity);
  assert.ok(b.brightness > a.brightness);
  assert.ok(b.duration > a.duration);
});
test("bass voices are monophonic in compiled forward notes", () => {
  const p = drawing();
  p.strokes[0].brush = "Bass";
  p.strokes.push({
    ...structuredClone(p.strokes[0]),
    id: "two",
    points: [
      { x: 0.3, y: 0.7 },
      { x: 0.6, y: 0.7 },
    ],
  });
  const [a, b] = compileNotes(p);
  assert.ok(a.start + a.duration <= b.start + 0.00001);
});
test("ping pong mirrors notes once into return pass", () => {
  const p = drawing();
  p.pingpong = true;
  const [a, b] = timeline(p);
  assert.equal(b.start, 32 - a.start - a.duration);
  assert.equal(b.curve.at(-1).pitch, a.curve[0].pitch);
});
test("scale increases upward and respects octave count", () => {
  const p = defaults();
  assert.equal(pitchAt(0, p) - pitchAt(1, p), 36);
  assert.ok(pitchAt(0.2, p) > pitchAt(0.8, p));
});
test("projects validate, round-trip, and reject malformed values", () => {
  const p = drawing(),
    q = validateProject(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(compileNotes(q), compileNotes(p));
  assert.throws(() => validateProject({}), /supported/);
  p.strokes[0].points[0].x = NaN;
  assert.throws(() => validateProject(p), /coordinates/);
});
test("MIDI header contains separate layer tracks and tempo", () => {
  const p = drawing(),
    bytes = encodeMIDI(p),
    text = String.fromCharCode(...bytes);
  assert.equal(text.slice(0, 4), "MThd");
  assert.equal(bytes[11], 5);
  assert.equal((text.match(/MTrk/g) || []).length, 5);
  assert.ok(bytes.some((b, i) => b === 255 && bytes[i + 1] === 81));
});
test("WAV encodes stereo PCM with edge fades", () => {
  const buffer = {
      numberOfChannels: 2,
      length: 1000,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(1000).fill(0.5),
    },
    bytes = encodeWAV(buffer),
    v = new DataView(bytes);
  assert.equal(bytes.byteLength, 4044);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(4042, true), 0);
  assert.ok(v.getInt16(2044, true) > 0);
});
test("geometry simplifies collinear points and retains bends", () => {
  assert.equal(
    simplify([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]).length,
    2,
  );
  assert.equal(
    simplify([
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ]).length,
    3,
  );
});
test("all stamp variants create valid bounded vector artwork", () => {
  for (const type of [
    "Straight line",
    "Wave",
    "Zigzag",
    "Circle",
    "Rectangle",
    "Rising melody",
    "Falling melody",
    "Chord block",
    "Drum pattern",
  ]) {
    const strokes = shapeStrokes(
      { x: 0.1, y: 0.2, pressure: 0.7 },
      { x: 0.8, y: 0.9, pressure: 0.7 },
      type,
    );
    assert.ok(strokes.length);
    assert.ok(
      strokes.every((s) =>
        s.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
      ),
    );
  }
});
test("undo and redo restore vector edits", () => {
  state.project = drawing();
  state.history = [];
  state.future = [];
  change(() => (state.project.strokes[0].points[0].y = 0.1));
  undo();
  assert.equal(state.project.strokes[0].points[0].y, 0.5);
  redo();
  assert.equal(state.project.strokes[0].points[0].y, 0.1);
});

test("zero-volume layers and marks are silent", () => {
  const p = drawing();
  p.layers[0].volume = 0;
  assert.equal(compileNotes(p).length, 0);
  p.layers[0].volume = 0.8;
  p.strokes[0].sound.volume = 0;
  assert.equal(compileNotes(p).length, 0);
});
test("vertical marks form simultaneous notes", () => {
  const p = drawing();
  p.strokes[0].points = [
    { x: 0.2, y: 0.2 },
    { x: 0.2, y: 0.8 },
  ];
  const notes = compileNotes(p);
  assert.ok(notes.length > 1);
  assert.ok(notes.every((n) => n.start === 3.2));
  assert.ok(new Set(notes.map((n) => n.pitch)).size > 1);
});
test("pressure variation survives simplification", () => {
  const points = [
    { x: 0, y: 0, pressure: 0.1 },
    { x: 0.5, y: 0.5, pressure: 1 },
    { x: 1, y: 1, pressure: 0.1 },
  ];
  assert.equal(simplify(points, 0.001).length, 3);
});

test("ping-pong hits boundary dots once and sustains through the turnaround", () => {
  const p = drawing();
  p.pingpong = true;
  p.strokes[0].points = [{ x: 1, y: 0.5 }];
  assert.equal(timeline(p).length, 1);
  p.strokes[0].points = [
    { x: 0.8, y: 0.5 },
    { x: 1, y: 0.3 },
  ];
  const notes = timeline(p);
  assert.equal(notes.length, 1);
  assert.ok(Math.abs(notes[0].duration - 6.4) < 1e-8);
  assert.equal(notes[0].curve.at(-1).pitch, notes[0].curve[0].pitch);
});
test("reverse drum dots play at the same horizontal position", () => {
  const p = drawing();
  p.pingpong = true;
  p.strokes[0].brush = "Drums";
  p.strokes[0].points = [{ x: 0.5, y: 0.5 }];
  const notes = timeline(p);
  assert.equal(notes[0].start, 8);
  assert.equal(notes[1].start, 24);
});

test("pitch shift transposes curves, clamps limits, and survives validation", () => {
  const p = drawing(),
    before = compileNotes(p);
  p.pitchShift = 12;
  const after = compileNotes(p);
  assert.equal(after[0].pitch, before[0].pitch + 12);
  assert.deepEqual(
    after[0].curve.map((q) => q.pitch),
    before[0].curve.map((q) => q.pitch + 12),
  );
  assert.equal(validateProject(p).pitchShift, 12);
  assert.equal(validateProject({ ...p, pitchShift: 999 }).pitchShift, 24);
  assert.equal(validateProject({ ...p, pitchShift: undefined }).pitchShift, 0);
  p.root = 6;
  p.octaves = 4;
  p.pitchShift = 24;
  p.strokes[0].points = [{ x: 0.2, y: 0 }];
  assert.equal(compileNotes(p)[0].pitch, 127);
  p.root = 1;
  p.pitchShift = -24;
  p.strokes[0].brush = "Bass";
  p.strokes[0].points = [{ x: 0.2, y: 1 }];
  assert.equal(compileNotes(p)[0].pitch, 0);
});

test("MIDI transposes melodic and drum note events", () => {
  const p = drawing();
  p.strokes[0].points = [{ x: 0.2, y: 0.5 }];
  function note(bytes, channel) {
    for (let i = 0; i < bytes.length - 2; i++)
      if (bytes[i] === 144 + channel) return bytes[i + 1];
    assert.fail("missing MIDI note");
  }
  const original = note(encodeMIDI(p), 0);
  p.pitchShift = -12;
  assert.equal(note(encodeMIDI(p), 0), original - 12);
  p.strokes[0].brush = "Drums";
  assert.equal(note(encodeMIDI(p), 9), 24);
});
