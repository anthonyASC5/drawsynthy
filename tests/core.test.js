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
  validateProject,
  loadProject,
  mirrorMarks,
  echoMarks,
  wrapPoints,
  symmetry,
  echo,
  applyMusicalTool,
  addRain,
  removeRain,
  rainPattern,
  rainContact,
  startSymmetry,
  updateSymmetry,
  playbackProject,
  copySelection,
  pasteSelection,
} from "../js/state.js";
import { compileNotes, timeline } from "../js/audio.js";
import {
  encodeMIDI,
  encodeWAV,
  simplify,
  shapeStrokes,
  extractContours,
} from "../js/canvas.js";

// Composition, history, and export tests
{
  test("copy/paste preserves independent vector and sound settings in one undoable edit", () => {
    loadProject(demo());
    const original = structuredClone(state.project.strokes[0]);
    state.selected = new Set([original.id]);
    assert.equal(copySelection(), 1);
    assert.equal(state.history.length, 0);
    state.project.strokes[0].color = "#ff0000";
    state.layer = "layer-1";
    const before = state.project.strokes.length;
    assert.equal(pasteSelection(), 1);
    const copy = state.project.strokes.at(-1);
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.color, original.color);
    assert.deepEqual(copy.sound, original.sound);
    assert.equal(copy.brush, original.brush);
    assert.equal(copy.layerId, "layer-1");
    assert.deepEqual(state.selected, new Set([copy.id]));
    assert.equal(state.history.length, 1);
    undo();
    assert.equal(state.project.strokes.length, before);
    redo();
    assert.equal(state.project.strokes.length, before + 1);
    loadProject(defaults());
    assert.equal(pasteSelection({ x: 1, y: 1 }), 1);
    const pasted = state.project.strokes[0];
    assert.equal(pasted.layerId, state.project.layers[0].id);
    const width = (s) =>
      Math.max(...s.points.map((p) => p.x)) -
      Math.min(...s.points.map((p) => p.x));
    assert.ok(Math.abs(width(pasted) - width(original)) < 1e-9);
    assert.ok(
      pasted.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
    );
    assert.doesNotThrow(() => validateProject(state.project));
  });
  test("paste refuses an overfull project without partial edits", () => {
    loadProject(demo());
    state.selected = new Set([state.project.strokes[0].id]);
    copySelection();
    state.project.strokes = Array.from({ length: 10000 }, (_, i) => ({
      ...state.project.strokes[0],
      id: String(i),
      points: [{ x: 0.5, y: 0.5 }],
    }));
    assert.throws(() => pasteSelection(), /limit/);
    assert.equal(state.project.strokes.length, 10000);
    assert.equal(state.history.length, 0);
    loadProject(defaults());
  });
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
    assert.equal(
      validateProject({ ...p, pitchShift: undefined }).pitchShift,
      0,
    );
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
}

// Image tracing tests
{
  function rectangle() {
    const width = 80,
      height = 40,
      data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 10; y < 30; y++)
      for (let x = 20; x < 60; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    return { data, width, height };
  }
  test("contours simplify into bounded connected vectors with aspect fitting", () => {
    const { data, width, height } = rectangle();
    const lines = extractContours(data, width, height, {
      aspect: 1,
      detail: 50,
      threshold: 128,
    });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].length >= 4 && lines[0].length < 15);
    assert.deepEqual(lines[0][0], lines[0].at(-1));
    const pts = lines.flat();
    assert.ok(pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
    const dx =
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const dy =
      Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    assert.ok(Math.abs(dx / dy - 2) < 0.15);
  });
  test("uniform images yield no contours; transparent pixels composite onto white", () => {
    assert.deepEqual(
      extractContours(new Uint8ClampedArray(20 * 20 * 4), 20, 20),
      [],
    );
  });
  test("invert changes threshold crossings for intermediate tones", () => {
    const { data, width, height } = rectangle();
    for (let i = 0; i < data.length; i += 4)
      if (data[i] === 0) data[i] = data[i + 1] = data[i + 2] = 100;
    assert.equal(
      extractContours(data, width, height, { threshold: 80 }).length,
      0,
    );
    assert.ok(
      extractContours(data, width, height, { threshold: 80, invert: true })
        .length > 0,
    );
  });
}

// Musical tool and rain tests
{
  function drawing() {
    const p = defaults();
    p.strokes = [
      {
        id: "line",
        brush: "Ink",
        color: "#4b7ed5",
        size: 10,
        opacity: 0.8,
        layerId: p.layers[0].id,
        sound: {
          volume: 0.7,
          hardness: 0.7,
          attack: 0.025,
          release: 0.18,
          soundSmoothing: 0.65,
          drum: "snare",
        },
        points: [
          { x: 0.2, y: 0.3, pressure: 0.6 },
          { x: 0.6, y: 0.4, pressure: 0.8 },
        ],
      },
    ];
    return p;
  }
  test("Symmetry immediately mirrors visible artwork without selection; settings replace its copies", () => {
    loadProject(drawing());
    state.tool = "Musical Symmetry";
    Object.assign(symmetry, {
      mode: "Vertical",
      x: 0.5,
      y: 0.5,
      keep: true,
      destination: "Current Layer",
    });
    startSymmetry();
    assert.equal(state.selected.size, 0);
    assert.equal(state.project.strokes.length, 2);
    assert.equal(compileNotes(state.project).length, 2);
    assert.equal(state.history.length, 1);
    symmetry.mode = "Both";
    updateSymmetry();
    assert.equal(state.project.strokes.length, 4);
    const ids = state.project.strokes.map((s) => s.id);
    symmetry.y = 0.4;
    updateSymmetry();
    assert.deepEqual(
      state.project.strokes.map((s) => s.id),
      ids,
    );
    undo();
    assert.equal(state.project.strokes.length, 4);
    undo();
    assert.equal(state.project.strokes.length, 2);
    undo();
    assert.equal(state.project.strokes.length, 1);
    redo();
    assert.equal(state.project.strokes.length, 2);
  });
  test("Echo previews participate in playback without modifying saved artwork", () => {
    loadProject(drawing());
    state.tool = "Echo Paint";
    state.selected.add("line");
    Object.assign(echo, {
      copies: 3,
      delay: 0.5,
      fade: 0.3,
      pitch: 2,
      separate: false,
    });
    const preview = playbackProject();
    assert.equal(state.project.strokes.length, 1);
    assert.equal(compileNotes(preview).length, 4);
    assert.equal(state.history.length, 0);
    state.tool = "Ink";
    assert.equal(playbackProject(), state.project);
  });
  test("slightly tilted and hand-drawn vertical lines play a simultaneous chord", () => {
    for (const points of [
      [
        { x: 0.5, y: 0.2 },
        { x: 0.502, y: 0.8 },
      ],
      [
        { x: 0.5, y: 0.2 },
        { x: 0.501, y: 0.4 },
        { x: 0.499, y: 0.6 },
        { x: 0.5, y: 0.8 },
      ],
    ]) {
      const p = drawing();
      p.strokes[0].points = points;
      const notes = compileNotes(p);
      assert.ok(notes.length > 1 && notes.length <= 16);
      assert.equal(new Set(notes.map((n) => n.start)).size, 1);
      assert.ok(notes.every((n) => n.duration >= 0.2));
    }
  });
  function cloud(p, options = {}) {
    p.rainClouds.push({
      id: "repeatable-cloud",
      x: 0.4,
      amount: 2,
      speed: 1,
      spread: 0,
      division: 8,
      ...options,
    });
  }

  test("symmetry reflects each requested axis, preserves instruments and clamps bounds", () => {
    const p = drawing(),
      s = p.strokes[0];
    const vertical = mirrorMarks([s], { mode: "Vertical", x: 0.5, y: 0.5 })[0];
    assert.deepEqual(
      vertical.points.map((p) => p.x),
      [0.2, 0.6],
    );
    assert.deepEqual(
      vertical.points.map((p) => p.y),
      [0.7, 0.6],
    );
    assert.deepEqual(vertical.sound, s.sound);
    assert.equal(vertical.brush, s.brush);
    assert.equal(vertical.color, s.color);
    const horizontal = mirrorMarks([s], {
      mode: "Horizontal",
      x: 0.5,
      y: 0.5,
    })[0];
    assert.deepEqual(
      horizontal.points.map((p) => p.x),
      [0.8, 0.4],
    );
    p.strokes = [s, horizontal];
    const [original, reverse] = compileNotes(p);
    assert.equal(reverse.pitch, original.curve.at(-1).pitch);
    assert.equal(reverse.curve.at(-1).pitch, original.pitch);
    const both = mirrorMarks([s], { mode: "Both", x: 0, y: 1 });
    assert.equal(both.length, 3);
    assert.ok(
      both.every((s) =>
        s.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
      ),
    );
  });

  test("apply symmetry atomically replaces originals and routes editable vectors to Harmony", () => {
    loadProject(drawing());
    state.selected.add("line");
    state.tool = "Musical Symmetry";
    Object.assign(symmetry, {
      mode: "Both",
      x: 0.5,
      y: 0.5,
      keep: false,
      destination: "Harmony Layer",
    });
    const before = structuredClone(state.project);
    applyMusicalTool();
    assert.equal(state.history.length, 1);
    assert.equal(state.project.strokes.length, 3);
    assert.ok(
      state.project.strokes.every(
        (s) => s.layerId === "layer-1" && s.id !== "line",
      ),
    );
    assert.equal(new Set(state.project.strokes.map((s) => s.id)).size, 3);
    assert.equal(state.tool, "Select");
    undo();
    assert.deepEqual(state.project, before);
    redo();
    assert.equal(state.project.strokes.length, 3);
  });

  test("empty selection and full layer capacity cannot partially mutate a project", () => {
    loadProject(drawing());
    state.tool = "Echo Paint";
    assert.throws(() => applyMusicalTool(), /Select/);
    state.selected.add("line");
    echo.separate = true;
    while (state.project.layers.length < 8)
      state.project.layers.push({
        ...state.project.layers[0],
        id: String(state.project.layers.length),
        name: "Other",
      });
    const before = JSON.stringify(state.project);
    assert.throws(() => applyMusicalTool(), /layer/);
    assert.equal(JSON.stringify(state.project), before);
    assert.equal(state.history.length, 0);
  });

  test("echo timing, exponential fade and exact semitone changes reach compiled notes", () => {
    const p = drawing(),
      s = p.strokes[0];
    p.strokes = [
      s,
      ...echoMarks([s], p, { copies: 3, delay: 0.5, fade: 0.25, pitch: 1 }),
    ];
    const notes = compileNotes(p);
    assert.equal(notes.length, 4);
    for (let i = 1; i <= 3; i++) {
      assert.ok(Math.abs(notes[i].start - notes[0].start - i * 0.5) < 1e-9);
      assert.equal(notes[i].pitch, notes[0].pitch + i);
      assert.ok(
        Math.abs(notes[i].velocity / notes[0].velocity - 0.75 ** i) < 1e-9,
      );
      assert.equal(p.strokes[i].opacity, s.opacity * 0.75 ** i);
      assert.equal(p.strokes[i].brush, s.brush);
    }
    const loaded = validateProject(JSON.parse(JSON.stringify(p)));
    assert.deepEqual(timeline(loaded), timeline(p));
  });

  test("echo loop seams interpolate and split forward, reversed and turning paths without bridges", () => {
    for (const points of [
      [
        { x: 0.9, y: 0.2 },
        { x: 1, y: 0.6 },
      ],
      [
        { x: 1, y: 0.6 },
        { x: 0.9, y: 0.2 },
      ],
      [
        { x: 0.9, y: 0.2 },
        { x: 1, y: 0.6 },
        { x: 0.9, y: 0.8 },
      ],
    ]) {
      const paths = wrapPoints(points, 0.05);
      assert.ok(paths.length >= 2);
      assert.ok(paths.every((path) => path.every((p) => p.x >= 0 && p.x <= 1)));
      assert.ok(
        paths.every(
          (path) =>
            Math.max(...path.map((p) => p.x)) -
              Math.min(...path.map((p) => p.x)) <
            0.051,
        ),
      );
    }
    const p = drawing();
    p.strokes[0].points = [
      { x: 0.98, y: 0.5 },
      { x: 1, y: 0.5 },
    ];
    p.strokes = echoMarks(p.strokes, p, {
      copies: 1,
      delay: 0.25,
      fade: 0,
      pitch: 0,
    });
    assert.equal(p.strokes.length, 2);
    assert.ok(compileNotes(p).every((n) => n.duration <= 0.26));
  });

  test("100% faded echoes remain editable and silent; pitch changes clamp to MIDI limits", () => {
    const p = drawing();
    p.strokes = echoMarks(p.strokes, p, {
      copies: 8,
      delay: 0.5,
      fade: 1,
      pitch: 12,
    });
    assert.equal(p.strokes.length, 8);
    assert.equal(compileNotes(p).length, 0);
    assert.ok(
      validateProject(p).strokes.every(
        (s) => s.opacity === 0 && s.sound.volume === 0,
      ),
    );
    for (const s of p.strokes) s.sound.volume = 0.5;
    assert.ok(compileNotes(p).every((n) => n.pitch >= 0 && n.pitch <= 127));
  });

  test("rain contacts the first mark only and inherits its instrument, layer and contact pitch", () => {
    const p = drawing();
    cloud(p);
    p.strokes.push({
      ...structuredClone(p.strokes[0]),
      id: "underneath",
      brush: "Drums",
      points: [
        { x: 0.2, y: 0.8 },
        { x: 0.6, y: 0.8 },
      ],
    });
    assert.equal(rainContact(p, 0.4).strokeId, "line");
    const notes = timeline(p).filter((n) => n.rain);
    assert.equal(notes.length, 64);
    assert.equal(new Set(notes.map((n) => n.id)).size, notes.length);
    assert.ok(
      notes.every(
        (n) =>
          n.brush === "Ink" &&
          n.layerId === "layer-0" &&
          n.pitch === pitchAt(0.35, p),
      ),
    );
    assert.ok(new Set(notes.map((n) => n.velocity)).size > 1);
    p.layers[0].mute = true;
    assert.equal(timeline(p).length, 0);
  });

  test("rain patterns are repeatable, beat-synchronized and survive tempo and serialization changes", () => {
    const p = drawing();
    cloud(p, { spread: 0.2, division: 32 });
    const pattern = rainPattern(p);
    assert.deepEqual(rainPattern(structuredClone(p)), pattern);
    assert.ok(pattern.every((d) => d.born % 0.125 === 0));
    p.bpm = 220;
    assert.deepEqual(rainPattern(p), pattern);
    assert.deepEqual(timeline(validateProject(p)), timeline(p));
    assert.ok(pattern.every((d) => d.start >= 0 && d.start < 16));
    const original = timeline(p);
    p.layers[0].visible = false;
    assert.deepEqual(timeline(p), original);
  });

  test("non-looping rain excludes late contacts and ping-pong emits throughout both passes", () => {
    const p = drawing();
    p.bars = 1;
    cloud(p, { speed: 0.5 });
    const loopNotes = timeline(p).filter((n) => n.rain);
    p.loop = false;
    const once = timeline(p).filter((n) => n.rain);
    assert.ok(once.length < loopNotes.length);
    assert.ok(once.every((n) => n.start >= 0.7 && n.start < 4));
    p.loop = true;
    p.pingpong = true;
    const twice = timeline(p).filter((n) => n.rain);
    assert.equal(twice.length, loopNotes.length * 2);
    assert.ok(twice.some((n) => n.start > 4));
    assert.equal(new Set(twice.map((n) => n.id)).size, twice.length);
  });

  test("adding and removing clouds support one-step undo/redo and enforce four-cloud maximum", () => {
    loadProject(drawing());
    for (let i = 0; i < 4; i++) assert.equal(addRain(0.2 * i), true);
    assert.equal(addRain(0.9), false);
    assert.equal(state.history.length, 4);
    removeRain();
    assert.equal(state.project.rainClouds.length, 3);
    undo();
    assert.equal(state.project.rainClouds.length, 4);
    redo();
    assert.equal(state.project.rainClouds.length, 3);
    assert.throws(
      () =>
        validateProject({ ...state.project, rainClouds: Array(5).fill({}) }),
      /four/,
    );
    assert.throws(
      () =>
        validateProject({
          ...state.project,
          rainClouds: [{ id: "x" }, { id: "x" }],
        }),
      /unique/,
    );
    assert.deepEqual(
      validateProject({ ...drawing(), rainClouds: undefined }).rainClouds,
      [],
    );
  });

  // Parse MIDI events, rather than mistaking note bytes inside metadata for notes.
  function midiNotes(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      notes = [];
    let at = 14;
    const variable = () => {
      let n = 0,
        b;
      do {
        b = bytes[at++];
        n = (n << 7) | (b & 127);
      } while (b & 128);
      return n;
    };
    while (at < bytes.length) {
      const end = at + 8 + view.getUint32(at + 4);
      at += 8;
      let tick = 0;
      while (at < end) {
        tick += variable();
        const status = bytes[at++];
        if (status === 255) {
          at++;
          const size = variable();
          at += size;
        } else if ((status & 240) === 192) at++;
        else {
          const pitch = bytes[at++],
            velocity = bytes[at++];
          if ((status & 240) === 144) notes.push({ tick, pitch, velocity });
        }
      }
    }
    return notes.sort(
      (a, b) => a.tick - b.tick || a.pitch - b.pitch || a.velocity - b.velocity,
    );
  }
  test("drum echoes preserve the kit and export per-copy semitone changes", () => {
    const p = drawing();
    p.strokes[0].brush = "Drums";
    p.strokes[0].points = [{ x: 0.25, y: 0.5 }];
    p.pitchShift = -2;
    p.strokes.push(
      ...echoMarks(p.strokes, p, {
        copies: 2,
        delay: 0.25,
        fade: 0.2,
        pitch: 3,
      }),
    );
    assert.deepEqual(
      midiNotes(encodeMIDI(p)).map((n) => n.pitch),
      [36, 39, 42],
    );
    assert.ok(timeline(p).every((n) => n.sound.drum === "snare"));
  });
  test("MIDI contains precisely the shared live timeline's echo and rain note onsets", () => {
    const p = drawing();
    p.strokes[0].points.forEach((q) => (q.y = 0.5));
    p.strokes.push(
      ...echoMarks(p.strokes, p, {
        copies: 2,
        delay: 0.25,
        fade: 0.3,
        pitch: 2,
      }),
    );
    cloud(p);
    const expected = timeline(p)
      .map((n) => ({
        tick: Math.round(n.start * 480),
        pitch: Math.round(n.pitch),
        velocity: Math.max(1, Math.round(n.velocity * 127)),
      }))
      .sort(
        (a, b) =>
          a.tick - b.tick || a.pitch - b.pitch || a.velocity - b.velocity,
      );
    assert.deepEqual(midiNotes(encodeMIDI(p)), expected);
  });
}
