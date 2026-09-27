// The interface connects project state, drawing, and audio to the existing Windows-style
// controls. Event handlers delegate edits to shared history helpers.
import {
  state,
  TOOLS,
  COLORS,
  SCALES,
  defaults,
  demo,
  uid,
  subscribe,
  emit,
  change,
  undo,
  redo,
  loadProject,
  clamp,
  newStroke,
  snapshot,
  commit,
  saveProject,
  listProjects,
  removeProject,
  validateProject,
  MUSICAL_TOOLS,
  symmetry,
  echo,
  rainDefaults,
  selectedMarks,
  applyMusicalTool,
  addRain,
  removeRain,
  startSymmetry,
  updateSymmetry,
  symmetrySourceCount,
  copySelection,
  pasteSelection,
  canPasteSelection,
} from "./state.js";
import {
  initSeeking,
  processImage,
  initCanvas,
  resetPaper,
  view,
  initTools,
  deleteSelection,
  duplicateSelection,
  cancelAction,
  placeCentered,
  canvasPoint,
  // Export actions live with canvas rendering, so the interface uses the same drawing
  // and audio data for downloads as it does for playback.
  exportJSON,
  exportPNG,
  exportWAV,
  exportMIDI,
} from "./canvas.js";
import {
  initTransport,
  play,
  pause,
  stop,
  seekStart,
  previewSound,
} from "./audio.js";

const $ = (s) => document.querySelector(s),
  el = (tag, attrs = {}, text) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs))
      if (k === "class") e.className = v;
      else e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  };
const PAPER = [
  "Grid Paper",
  "Graph Paper",
  "Staff Paper",
  "Blank Paper",
  "Dark Paper",
];
const paths = [
  "M5 19 8 12 18 2 22 6 12 16 5 19ZM8 12l4 4M17 3l4 4",
  "M5 20 8 10 15 3 21 9 14 17 5 20ZM8 10l6 7M8 16l5-5M16 4l4 4",
  "M7 18c-4-3 1-6 3-8L16 2l5 4-9 10c-1 6-6 7-9 4 3 0 3-1 4-2Z",
  "M4 18 8 11 17 2 22 7 12 17 4 18ZM8 11l4 6M4 18l-1 3 5-1",
  "M4 16h4V8h4v13h4V3h4v13",
  "M4 9c0-5 17-5 17 0v9c0 5-17 5-17 0ZM4 9c0 5 17 5 17 0M6 3l15 9M20 2 6 13",
  "M3 15 13 3l9 8-10 11H9ZM7 10l9 8M12 22h11",
  "M3 19c4-9 6 3 10-5s7-6 9-11M5 5c2-3 6-3 8 0M3 10h5",
  "M3 3h4m3 0h4m3 0h4v4m0 3v4m0 3v4h-4m-3 0h-4m-3 0H3v-4m0-3v-4m0-3V3",
  "M4 20 20 4M3 18v3h3M18 3h3v3",
  "M3 13 8 3l5 10ZM14 12h8v9h-8M3 18a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  "M5 12V7c0-3 3-3 3 0v5-8c0-3 3-3 3 0v8-6c0-3 3-3 3 0v6-3c0-3 3-3 3 0v8c0 6-9 7-12 2l-3-5c-2-4 2-5 4-2",
];
const hints = {
  // Each tool has a short interaction hint. Guarded button handlers report failures in
  // the status bar and a dialog instead of leaving an unhandled rejection.
  "Musical Symmetry":
    "Mirrors are created automatically. Move the axes to adjust your harmony.",
  "Echo Paint":
    "Select marks to repeat them with delay, fade, and pitch changes.",
  "Rhythm Rain": "Place clouds above your marks. Press Play to hear the rain.",
  Pencil: "Small lines, little plucks. Try a constellation of notes.",
  Ink: "Draw a melody. Up is higher, right is later.",
  Watercolor: "Wash in a soft, slow pad. Overlap marks for a chord.",
  Marker: "Broad strokes make warm, sustained tones.",
  Bass: "Low-end color. The next bass mark takes over the note.",
  Drums: "Tap for a beat, or drag a trail of drum dots.",
  Eraser: "Erase whole marks on the active layer. Undo brings them back.",
  Smudge: "Push the paint around. The music follows.",
  Select:
    "Drag a box to select. Drag artwork to move; bottom-right handle resizes.",
  Line: "Drag from start to end. Select to reposition or resize.",
  "Shape stamp": "Drag to size your shape. Then move or resize it with Select.",
  Hand: "Drag to pan a zoomed canvas. Use two fingers to pan and zoom.",
};
let autosaveTimer,
  saveSerial = Promise.resolve(),
  lastSaveError = false;
function message(text) {
  $("#status-message").textContent = text;
}
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(error);
      message(error.message);
      showDialog("Something needs attention", (body) => {
        body.append(el("p", {}, error.message));
        button(body, "OK", closeDialog);
      });
    }
  };
}
function button(parent, text, fn, attrs = {}) {
  const b = el("button", attrs, text);
  b.addEventListener("click", guard(fn));
  parent.append(b);
  return b;
}
// Reusable checkbox, select, and range builders give Properties controls consistent
// labels and callbacks without repeating their DOM setup.
function checkbox(parent, text, value, fn) {
  const label = el("label", { class: "check" }),
    input = el("input", { type: "checkbox" });
  input.checked = value;
  input.addEventListener("change", () => fn(input.checked));
  label.append(input, document.createTextNode(text));
  parent.append(label);
  return input;
}
function select(parent, text, values, value, fn) {
  const label = el("label", { class: "control" }, text),
    input = el("select", { "aria-label": text });
  for (const option of values) {
    const [v, name] = Array.isArray(option) ? option : [option, option];
    input.append(el("option", { value: v }, name));
  }
  input.value = value;
  input.addEventListener("change", () => fn(input.value));
  label.append(input);
  parent.append(label);
  return input;
}
function range(parent, text, value, min, max, step, fn) {
  const label = el("div", { class: "control" }),
    top = el("div", { class: "control-top" }),
    name = el("label", {}, text),
    id = "control-" + uid(),
    number = el("input", {
      type: "number",
      min,
      max,
      step,
      value,
      "aria-label": text + " value",
    }),
    slider = el("input", {
      type: "range",
      min,
      max,
      step,
      value,
      id,
      "aria-label": text,
    });
  name.htmlFor = id;
  // A range control keeps its number field and slider in sync, clamps values to the
  // allowed interval, and forwards only finite input to its owner.
  top.append(name, number);
  label.append(top, slider);
  parent.append(label);
  const update = (e) => {
    if (!Number.isFinite(e.target.valueAsNumber)) return;
    const n = clamp(e.target.valueAsNumber, min, max);
    number.value = n;
    slider.value = n;
    fn(n);
  };
  slider.addEventListener("input", update);
  number.addEventListener("change", update);
  return slider;
}
function more(parent, label) {
  const d = el("details", { class: "secondary-settings" });
  d.append(el("summary", {}, label));
  const c = el("div", { class: "settings-content" });
  d.append(c);
  parent.append(d);
  return c;
}
function projectSet(key, value) {
  change(() => (state.project[key] = value));
}
function paperSet(key, value) {
  change(() => (state.project.paper[key] = value));
  resetPaper();
}
function selectTool(tool) {
  const continuing = state.tool === tool && symmetrySourceCount() > 0;
  state.tool = tool;
  if (tool === "Musical Symmetry" && !continuing) startSymmetry();
  const preset = {
    Pencil: [3, 0.008, 0.12],
    Ink: [9, 0.025, 0.18],
    Watercolor: [29, 0.25, 0.65],
    Marker: [20, 0.05, 0.25],
    Bass: [14, 0.02, 0.16],
    Drums: [12, 0.003, 0.08],
  };
  if (preset[tool]) {
    [state.brush.size, state.brush.attack, state.brush.release] = preset[tool];
    // Tool changes apply brush presets, open the relevant Properties section, and update
    // toolbar labels and icons without modifying existing marks.
    if (tool === "Watercolor") state.brush.opacity = 0.4;
    else state.brush.opacity = 0.9;
  }
  $("#tool-settings").parentElement.open = true;
  emit("tool");
}
function toolLabel(name) {
  const sounds = {
    Pencil: "soft pluck",
    Ink: "synth lead",
    Watercolor: "soft pad",
    Marker: "warm tone",
    Bass: "low synth",
    Drums: "percussion",
  };
  return sounds[name]
    ? `${name} (${sounds[name]})`
    : { "Shape stamp": "Shapes", Hand: "Pan" }[name] || name;
}
function renderTools() {
  const container = $("#tools");
  TOOLS.forEach((name, i) => {
    if (name === "Smudge") return;
    const label = toolLabel(name);
    const b = button(container, "", () => selectTool(name), {
      class: "tool-button",
      title: label,
      "aria-label": label,
      "data-tool": name,
      "aria-pressed": name === state.tool,
    });
    const icons = {
      "Musical Symmetry":
        '<path d="M12 2v21M3 5h5v15H3l4-7ZM21 5h-5v15h5l-4-7Z"/>',
      "Echo Paint":
        '<path d="M3 5h18"/><path opacity=".6" d="M5 12h16"/><path opacity=".3" d="M7 19h14"/>',
      "Rhythm Rain":
        '<path d="M6 15C0 15 0 7 6 7C6 0 17 0 18 7C25 5 26 15 20 15ZM7 18l-2 4m9-4-2 4m9-4-2 4"/>',
    };
    b.innerHTML = `<svg viewBox="0 0 25 25" aria-hidden="true">${icons[name] || `<path d="${paths[i]}"/>`}</svg><span>${label}</span>`;
  });
}
function musicalSettings(p) {
  if (state.tool === "Rhythm Rain") {
    const clouds = state.project.rainClouds || [];
    // Rain Properties targets the selected cloud, or the defaults for the next cloud.
    // Placement is limited to four clouds and each cloud can be selected by name.
    const cloud = clouds.find((c) => c.id === state.selectedCloud);
    p.append(
      el(
        "p",
        {},
        "Click above the canvas to place a cloud. Drag it sideways. Rain falls while playing.",
      ),
    );
    p.append(el("small", {}, `${clouds.length} of 4 clouds placed`));
    const add = button(p, "Place rain centered", () => addRain());
    add.disabled = clouds.length >= 4;
    if (clouds.length)
      select(
        p,
        "Selected cloud",
        [
          ["", "Choose a cloud"],
          ...clouds.map((c, i) => [c.id, `Cloud ${i + 1}`]),
        ],
        cloud?.id || "",
        (v) => {
          state.selectedCloud = v || null;
          emit("selection");
        },
      );
    const settings = cloud || rainDefaults;
    const set = (key, value) => {
      const current = state.project.rainClouds.find(
        (c) => c.id === state.selectedCloud,
      );
      if (current) change(() => (current[key] = value));
      else rainDefaults[key] = value;
    };
    const control = (key, label, min, max, step, scale = 1) => {
      let before = null;
      const slider = range(
        p,
        label,
        Math.round(settings[key] * scale * 100) / 100,
        min,
        max,
        step,
        (n) => {
          const value = key === "amount" ? Math.round(n) : n / scale;
          // Slider drags update the current cloud during the gesture and commit one
          // history snapshot when it finishes, allowing a single Undo to restore the
          // settings.
          const current = state.project.rainClouds.find(
            (c) => c.id === state.selectedCloud,
          );
          if (before !== null && current) {
            current[key] = value;
            emit("rain-preview");
          } else set(key, value);
        },
      );
      slider.addEventListener("pointerdown", () => {
        if (cloud) before = snapshot();
      });
      const finish = () => {
        if (before === null) return;
        const previous = before;
        before = null;
        commit(previous);
      };
      slider.addEventListener("pointerup", finish);
      slider.addEventListener("lostpointercapture", finish);
      slider.addEventListener("pointercancel", finish);
    };
    if (!cloud)
      p.append(
        el("small", {}, "These settings will be used for your next cloud."),
      );
    if (cloud) control("x", "Cloud position (%)", 0, 100, 1, 100);
    control("amount", "Rain Amount", 1, 8, 1);
    control("speed", "Fall Speed", 0.5, 4, 0.1);
    control("spread", "Spread (%)", 0, 100, 1, 100);
    select(
      p,
      "Rhythm division",
      [4, 8, 16, 32].map((n) => [String(n), `1/${n} note`]),
      String(settings.division),
      (v) => set("division", +v),
    );
    const remove = button(p, "Remove Rain", removeRain);
    remove.disabled = !cloud;
    return;
  }
  const immediate = state.tool === "Musical Symmetry";
  const count = immediate ? symmetrySourceCount() : selectedMarks().length;
  // Symmetry edits playable copies immediately; Echo displays and plays temporary copies
  // until Apply. The explanatory text distinguishes these two workflows.
  p.append(
    el(
      "p",
      {},
      immediate
        ? count
          ? "Mirrors are already on the canvas and play with your drawing. Adjust them below."
          : "Draw some marks, then press Musical Symmetry to mirror them automatically."
        : count
          ? `${count} mark${count === 1 ? "" : "s"} selected. Press Play to hear the echoes. Apply keeps them in your drawing.`
          : "Select one or more marks before applying this tool.",
    ),
  );
  if (!immediate) button(p, "Select marks", () => selectTool("Select"));
  const options = state.tool === "Musical Symmetry" ? symmetry : echo;
  const set = (key, value) => {
    options[key] = value;
    if (immediate) updateSymmetry();
    emit("musical-preview");
  };
  if (state.tool === "Musical Symmetry") {
    select(
      p,
      "Mirror mode",
      ["Vertical", "Horizontal", "Both"],
      symmetry.mode,
      (v) => {
        set("mode", v);
        toolSettings();
      },
    );
    if (symmetry.mode !== "Horizontal")
      range(
        p,
        "Horizontal axis (%)",
        Math.round(symmetry.y * 100),
        0,
        100,
        1,
        (n) => set("y", n / 100),
      );
    if (symmetry.mode !== "Vertical")
      // Symmetry axes can be positioned numerically or by dragging. Destination and Keep
      // Original control which editable strokes survive the transformation.
      range(
        p,
        "Vertical axis (%)",
        Math.round(symmetry.x * 100),
        0,
        100,
        1,
        (n) => set("x", n / 100),
      );
    p.append(
      el(
        "small",
        {},
        "Drag on the canvas to move the axes. Vertical changes pitch; Horizontal reverses timing. Both adds three reflections.",
      ),
    );
    checkbox(p, "Keep Original", symmetry.keep, (v) => set("keep", v));
    select(
      p,
      "Destination",
      ["Current Layer", "Harmony Layer"],
      symmetry.destination,
      (v) => set("destination", v),
    );
  } else {
    range(p, "Copies", echo.copies, 1, 8, 1, (n) => set("copies", n));
    select(
      p,
      "Delay",
      [
        ["0.0625", "1/16 beat"],
        ["0.125", "1/8 beat"],
        ["0.25", "1/4 beat"],
        ["0.5", "1/2 beat"],
      ],
      String(echo.delay),
      (v) => set("delay", +v),
    );
    range(p, "Fade (%)", echo.fade * 100, 0, 100, 1, (n) =>
      set("fade", n / 100),
    );
    range(p, "Pitch Change (semitones)", echo.pitch, -12, 12, 1, (n) =>
      set("pitch", n),
    );
    checkbox(p, "Separate Layer", echo.separate, (v) => set("separate", v));
    // Echo settings accumulate delay, pitch shift, and fade for successive copies. Apply
    // commits them; Done leaves symmetry copies available to normal selection.
    p.append(
      el(
        "small",
        {},
        "Fade and pitch change accumulate with each copy. Echoes wrap at the loop edge.",
      ),
    );
  }
  if (immediate) {
    button(p, "Done", () => selectTool("Select"));
    return;
  }
  const apply = button(
    p,
    state.tool === "Musical Symmetry" ? "Apply Symmetry" : "Apply Echoes",
    applyMusicalTool,
  );
  apply.disabled = !count;
}
function toolSettings() {
  const p = $("#tool-settings");
  p.replaceChildren();
  $("#tool-name").textContent = toolLabel(state.tool);
  if (MUSICAL_TOOLS.includes(state.tool)) {
    musicalSettings(p);
    return;
  }
  const brush = (key, label, min, max, step = 1, scale = 1) =>
    range(p, label, state.brush[key] * scale, min, max, step, (n) => {
      state.brush[key] = n / scale;
      emit("brush");
    });
  if (state.tool === "Select") {
    p.append(
      el(
        "p",
        {},
        `${state.selected.size} mark${state.selected.size === 1 ? "" : "s"} selected`,
      ),
    );
    button(p, "Copy", actions.copySelection);
    button(p, "Paste", () => actions.pasteSelection());
    button(p, "Duplicate", duplicateSelection);
    button(p, "Delete", deleteSelection);
    // Selection controls can move marks between layers. Pan, Eraser, and Smudge get
    // their own Properties instead of irrelevant sound or brush controls.
    select(
      p,
      "Move to layer",
      state.project.layers.map((l) => [l.id, l.name]),
      state.layer,
      (v) =>
        change(() => {
          state.project.strokes
            .filter((s) => state.selected.has(s.id))
            .forEach((s) => (s.layerId = v));
          state.layer = v;
        }),
    );
    return;
  }
  if (state.tool === "Hand") {
    p.append(
      el(
        "p",
        {},
        "Zoom in, then drag to explore. Two fingers pan and zoom on touch screens.",
      ),
    );
    button(p, "Fit canvas", () => setZoom(1));
    return;
  }
  brush("size", state.tool === "Smudge" ? "Smudge size" : "Size", 1, 80);
  if (state.tool === "Eraser") {
    p.append(
      el("small", {}, "Removes intersecting marks on the active layer."),
    );
    return;
  }
  if (state.tool === "Smudge") {
    brush("strength", "Strength", 1, 100, 1, 100);
    brush("soundSmoothing", "Sound smoothing", 0, 100, 1, 100);
    return;
  }
  brush("opacity", "Opacity", 5, 100, 1, 100);
  if (state.tool === "Drums")
    // Drum sounds and shape presets use the same stroke data as freehand drawing.
    // Additional envelope controls configure the instrument carried by new marks.
    select(
      p,
      "Drum sound",
      ["kick", "snare", "closed hi-hat", "open hi-hat"],
      state.brush.drum,
      (v) => (state.brush.drum = v),
    );
  if (state.tool === "Shape stamp")
    select(
      p,
      "Shape",
      [
        "Straight line",
        "Wave",
        "Zigzag",
        "Circle",
        "Rectangle",
        "Rising melody",
        "Falling melody",
        "Chord block",
        "Drum pattern",
      ],
      state.brush.shape,
      (v) => (state.brush.shape = v),
    );
  if (state.tool === "Line" || state.tool === "Shape stamp")
    button(p, "Place centered", placeCentered);
  const extra = more(p, "Brush & envelope");
  for (const [key, label, min, max, step, scale] of [
    ["hardness", "Hardness", 0, 100, 1, 100],
    ["smoothing", "Smoothing", 0, 100, 1, 100],
    ["volume", "Note volume", 0, 100, 1, 100],
    ["attack", "Attack (seconds)", 0.001, 2, 0.01, 1],
    ["release", "Release (seconds)", 0.01, 2, 0.01, 1],
  ])
    range(
      extra,
      label,
      state.brush[key] * scale,
      min,
      max,
      step,
      (n) => (state.brush[key] = n / scale),
    );
  // The pitch knob transposes the composition in semitones. Its pointer, output, reset
  // behavior, and history snapshot stay tied to the project pitch value.
  button(extra, "♫ Preview sound", previewSound);
}
function pitchControl(parent) {
  const group = el("div", { class: "pitch-control" });
  const label = el("span", { id: "pitch-label" }, "Pitch");
  const knob = el("div", {
    id: "pitch-knob",
    class: "pitch-knob",
    role: "slider",
    tabindex: "0",
    "aria-labelledby": "pitch-label",
    "aria-valuemin": -24,
    "aria-valuemax": 24,
    "aria-describedby": "pitch-help",
  });
  knob.append(el("span", { class: "pitch-pointer", "aria-hidden": true }));
  const output = el("output", { id: "pitch-value" });
  const help = el(
    "small",
    { id: "pitch-help" },
    "Drag or use arrow keys. Double-click to reset.",
  );
  const set = (value) =>
    projectSet("pitchShift", Math.round(clamp(value, -24, 24)));
  let drag;
  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = {
      y: e.clientY,
      value: state.project.pitchShift || 0,
      before: snapshot(),
    };
    knob.focus();
    knob.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (drag) {
      state.project.pitchShift = Math.round(
        clamp(drag.value + (drag.y - e.clientY) / 3, -24, 24),
      );
      emit("music");
    }
  });
  knob.addEventListener("pointerup", () => {
    // Finishing a knob drag commits one edit; cancellation restores its starting value.
    // Keyboard controls offer semitone steps, octave steps, and range endpoints.
    if (drag) commit(drag.before);
    drag = null;
  });
  knob.addEventListener("pointercancel", () => {
    if (drag) {
      state.project.pitchShift = drag.value;
      emit("music");
    }
    drag = null;
  });
  knob.addEventListener("dblclick", () => set(0));
  knob.addEventListener("keydown", (e) => {
    const value = state.project.pitchShift || 0;
    const values = {
      ArrowUp: value + 1,
      ArrowRight: value + 1,
      ArrowDown: value - 1,
      ArrowLeft: value - 1,
      PageUp: value + 12,
      PageDown: value - 12,
      Home: -24,
      End: 24,
      Enter: 0,
      " ": 0,
    };
    if (e.key in values) {
      e.preventDefault();
      e.stopPropagation();
      set(values[e.key]);
    }
  });
  group.append(label, knob, output, help);
  parent.append(group);
  syncPitch();
}
function syncPitch() {
  const knob = $("#pitch-knob");
  if (!knob) return;
  const value = state.project.pitchShift || 0;
  const label = `${value > 0 ? "+" : ""}${value} semitones`;
  knob.setAttribute("aria-valuenow", value);
  knob.setAttribute("aria-valuetext", label);
  knob.style.setProperty("--pitch-angle", `${(value / 24) * 135}deg`);
  $("#pitch-value").textContent = label;
}
// Sound Properties exposes scale, pitch range, effects, and metronome settings. These
// project edits drive the shared live and export audio configuration.
function soundSettings() {
  const p = $("#sound-settings");
  p.replaceChildren();
  pitchControl(p);
  select(p, "Scale", Object.keys(SCALES), state.project.scale, (v) =>
    projectSet("scale", v),
  );
  checkbox(p, "Snap to scale", state.project.snap, (v) =>
    projectSet("snap", v),
  );
  checkbox(p, "Ping-pong loop", state.project.pingpong, (v) =>
    projectSet("pingpong", v),
  );
  const extra = more(p, "Range, effects & metronome");
  select(
    extra,
    "Octave range",
    [1, 2, 3, 4].map((n) => [n, `${n} octave${n > 1 ? "s" : ""}`]),
    state.project.octaves,
    (v) => projectSet("octaves", +v),
  );
  select(extra, "Root octave", [1, 2, 3, 4, 5, 6], state.project.root, (v) =>
    projectSet("root", +v),
  );
  for (const [key, label] of [
    ["reverb", "Reverb"],
    ["delay", "Delay"],
    ["brightness", "Filter brightness"],
    ["master", "Master volume"],
    ["metroVolume", "Metronome volume"],
  ])
    range(extra, label, Math.round(state.project[key] * 100), 0, 100, 1, (n) =>
      projectSet(key, n / 100),
    );
  checkbox(extra, "Metronome", state.project.metronome, (v) =>
    projectSet("metronome", v),
  );
}
function paperSettings() {
  const p = $("#paper-settings");
  p.replaceChildren();
  select(p, "Paper type", PAPER, state.project.paper.type, (v) =>
    paperSet("type", v),
  );
  // Paper controls only change presentation: background, grid opacity, division, and
  // labels. Layer rows separately expose visibility, selection, mute, and solo.
  const row = el("label", { class: "setting-row" }, "Background color"),
    color = el("input", {
      type: "color",
      value: state.project.paper.color,
      "aria-label": "Paper background color",
    });
  color.oninput = () => paperSet("color", color.value);
  row.append(color);
  p.append(row);
  checkbox(p, "Show grid", state.project.paper.grid, (v) =>
    paperSet("grid", v),
  );
  range(p, "Grid opacity", state.project.paper.opacity * 100, 0, 100, 1, (n) =>
    paperSet("opacity", n / 100),
  );
  select(
    p,
    "Grid size",
    [
      [1, "Quarter notes"],
      [2, "Eighth notes"],
      [4, "Sixteenth notes"],
    ],
    state.project.paper.division,
    (v) => paperSet("division", +v),
  );
  checkbox(p, "Pitch labels", state.project.paper.labels, (v) =>
    paperSet("labels", v),
  );
}
function renderLayers() {
  const p = $("#layers");
  p.replaceChildren();
  state.project.layers.forEach((layer, i) => {
    const row = el("div", {
      class: "layer" + (layer.id === state.layer ? " active" : ""),
    });
    row.style.setProperty("--swatch", COLORS[[8, 10, 7, 4][i % 4]]);
    button(
      row,
      layer.visible ? "◉" : "○",
      () => change(() => (layer.visible = !layer.visible)),
      {
        class: "layer-toggle",
        title: layer.visible ? "Hide layer" : "Show layer",
        // Visibility affects the artwork display, while mute and solo affect sound.
        // Selecting a layer changes the destination for newly painted marks.
        "aria-label": `Toggle ${layer.name} visibility`,
        "aria-pressed": !layer.visible,
      },
    );
    row.append(el("span", { class: "layer-chip" }));
    button(
      row,
      layer.name,
      () => {
        state.layer = layer.id;
        emit("layer");
      },
      { class: "layer-name", "aria-label": `Select ${layer.name} layer` },
    );
    button(row, "M", () => change(() => (layer.mute = !layer.mute)), {
      class: "layer-toggle",
      title: "Mute",
      "aria-label": `Mute ${layer.name}`,
      "aria-pressed": layer.mute,
    });
    button(row, "S", () => change(() => (layer.solo = !layer.solo)), {
      class: "layer-toggle",
      title: "Solo",
      "aria-label": `Solo ${layer.name}`,
      "aria-pressed": layer.solo,
    });
    p.append(row);
  });
  $("#layer-count").textContent = `${state.project.layers.length} / 8`;
  $("#add-layer").disabled = state.project.layers.length >= 8;
}
function layerDialog() {
  const layer = state.project.layers.find((l) => l.id === state.layer);
  showDialog("Layer properties", (body) => {
    const label = el("label", { class: "control" }, "Layer name"),
      name = el("input", { type: "text", value: layer.name, maxlength: 40 });
    label.append(name);
    body.append(label);
    name.onchange = () =>
      change(() => (layer.name = name.value.trim() || "Layer"));
    range(body, "Layer volume", layer.volume * 100, 0, 100, 1, (n) =>
      change(() => (layer.volume = n / 100)),
    );
    const actions = el("div", { class: "dialog-actions" });
    const move = (d) => {
      // Layer reordering and duplication run inside project history. Duplicates receive
      // new IDs, and deleting a layer also removes its owned strokes.
      change(() => {
        const i = state.project.layers.indexOf(layer),
          target = clamp(i + d, 0, state.project.layers.length - 1);
        state.project.layers.splice(i, 1);
        state.project.layers.splice(target, 0, layer);
      });
      closeDialog();
    };
    button(actions, "↑ Up", () => move(-1));
    button(actions, "↓ Down", () => move(1));
    button(actions, "Duplicate", () => {
      if (state.project.layers.length >= 8) {
        message("Eight layers maximum.");
        return;
      }
      change(() => {
        const copy = { ...layer, id: uid(), name: layer.name + " copy" };
        state.project.layers.push(copy);
        state.project.strokes.push(
          ...state.project.strokes
            .filter((s) => s.layerId === layer.id)
            .map((s) => ({
              ...structuredClone(s),
              id: uid(),
              layerId: copy.id,
            })),
        );
        state.layer = copy.id;
      });
      closeDialog();
    });
    button(actions, "Delete", () => {
      if (state.project.layers.length === 1) {
        message("Keep at least one layer.");
        return;
      }
      change(() => {
        state.project.layers = state.project.layers.filter(
          (l) => l.id !== layer.id,
        );
        state.project.strokes = state.project.strokes.filter(
          (s) => s.layerId !== layer.id,
        );
        state.layer = state.project.layers[0].id;
      });
      // Zoom changes only the viewport. The central sync routine then refreshes controls
      // from state and opens musical-tool Properties when the tool changes.
      closeDialog();
    });
    body.append(actions);
  });
}
function setZoom(n) {
  state.zoom = clamp(n, 1, 4);
  state.pan.x = clamp(state.pan.x, 1 - state.zoom, 0);
  state.pan.y = clamp(state.pan.y, 1 - state.zoom, 0);
  emit("view");
}
function sync(type) {
  const p = state.project;
  if (
    state.selectedCloud &&
    !p.rainClouds?.some((c) => c.id === state.selectedCloud)
  )
    state.selectedCloud = null;
  if (type === "tool" && MUSICAL_TOOLS.includes(state.tool)) {
    $("#inspector").hidden = false;
    $("#settings-mobile").setAttribute("aria-expanded", "true");
    $("#tool-settings").parentElement.open = true;
  }
  syncPitch();
  if (!p.layers.some((l) => l.id === state.layer)) state.layer = p.layers[0].id;
  $("#window-title").textContent = `Draw Synth — ${p.name}`;
  $("#document-name").textContent = p.name + ".dsy";
  $("#dirty-indicator").hidden = !state.dirty;
  $("#canvas-meta").textContent =
    `${p.bars} BAR${p.bars > 1 ? "S" : ""} · ${p.scale.toUpperCase()}`;
  $("#canvas-welcome").hidden = !!p.strokes.length;
  $("#paper-type").value = p.paper.type;
  $("#quick-grid").checked = p.paper.grid;
  for (const id of ["bpm", "bpm-range"])
    if (document.activeElement !== $("#" + id)) $("#" + id).value = p.bpm;
  $("#bars").value = p.bars;
  $("#pingpong").checked = p.pingpong;
  $("#metronome").checked = p.metronome;
  $("#master").value = Math.round(p.master * 100);
  $("#master-number").value = Math.round(p.master * 100);
  $("#master-value").textContent = Math.round(p.master * 100) + "%";
  $("#loop-button").setAttribute("aria-pressed", p.loop);
  $("#status-tool").textContent = "✎ " + state.tool;
  $("#status-size").textContent = state.brush.size + " px";
  $("#status-zoom").textContent = Math.round(state.zoom * 100) + "%";
  // State synchronization updates toolbar selection, swatches, brush preview, and
  // Undo/Redo availability so separate controls reflect the same project.
  $("#zoom-reset").textContent = Math.round(state.zoom * 100) + "%";
  $("#drawing-tip").textContent = hints[state.tool];
  $("#brush-preview-label").textContent = state.brush.size + " px";
  $("#brush-preview-dot").style.width = state.brush.size + "px";
  $("#brush-preview-dot").style.height = state.brush.size + "px";
  $("#brush-preview-dot").style.background = state.color;
  $("#custom-color").value = state.color;
  $("#drawing").style.cursor = state.tool === "Hand" ? "grab" : "crosshair";
  document.querySelectorAll(".tool-button").forEach((b, i) => {
    b.classList.toggle("active", b.dataset.tool === state.tool);
    b.setAttribute("aria-pressed", b.dataset.tool === state.tool);
  });
  document.querySelectorAll(".swatch").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === state.color);
    b.setAttribute("aria-pressed", b.dataset.color === state.color);
  });
  document
    .querySelectorAll("[data-action=undo]")
    .forEach((b) => (b.disabled = !state.history.length));
  document
    .querySelectorAll("[data-action=redo]")
    .forEach((b) => (b.disabled = !state.future.length));
  document.body.classList.toggle("is-playing", state.playing);
  document
    .querySelectorAll(".play-label")
    .forEach((e) => (e.textContent = state.playing ? "Pause" : "Play"));
  $("#canvas-play").disabled = state.playing;
  $("#canvas-pause").disabled = !state.playing;
  $("#playing-status").textContent = state.playing
    ? "PLAYING YOUR DRAWING"
    : state.position
      ? "PAUSED"
      : "READY TO PLAY";
  $("#audio-state").textContent = state.playing
    ? "AUDIO ACTIVE"
    : "AUDIO STANDBY";
  if (!state.position) {
    $("#bar-position").textContent = "01";
    $("#beat-position").textContent = "01";
  }
  if (["tool", "selection", "load", "init"].includes(type)) toolSettings();
  // Properties rebuild only when necessary, avoiding replacement of a focused input
  // during editing. Project edits also schedule local autosave.
  if (
    type === "edit" &&
    MUSICAL_TOOLS.includes(state.tool) &&
    !document.activeElement?.closest("#tool-settings")
  )
    toolSettings();
  if (["edit", "layer", "load", "init"].includes(type)) renderLayers();
  if (["load", "init"].includes(type)) {
    soundSettings();
    paperSettings();
  }
  if (type === "edit") {
    scheduleSave();
  }
}
function showDialog(title, build) {
  $("#dialog-title").textContent = title;
  const body = $("#dialog-body");
  body.replaceChildren();
  build(body);
  if (!$("#dialog").open) $("#dialog").showModal();
}
function closeDialog() {
  $("#dialog").close();
}
async function saveCurrent(silent = false) {
  const project = structuredClone(state.project);
  saveSerial = saveSerial.catch(() => {}).then(() => saveProject(project));
  await saveSerial;
  if (JSON.stringify(state.project) === JSON.stringify(project)) {
    state.dirty = false;
    $("#dirty-indicator").hidden = true;
  }
  if (!silent) message("Saved on this device.");
  lastSaveError = false;
}
function scheduleSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(
    () =>
      saveCurrent(true).catch((error) => {
        if (!lastSaveError)
          message(
            "Auto-save unavailable. Use Export → Project to keep a file.",
          );
        // Autosave is debounced and serialized; project switching waits for the previous
        // save. Naming and duplicate checks prevent accidental overwrite in the saved-
        // project list.
        lastSaveError = true;
        console.warn(error);
      }),
    650,
  );
}
async function switchProject(project) {
  clearTimeout(autosaveTimer);
  try {
    await saveCurrent(true);
  } catch {}
  stop();
  loadProject(project);
  scheduleSave();
}
function newProject() {
  return switchProject(defaults());
}
function renameDialog() {
  showDialog("Save project", (body) => {
    const label = el("label", { class: "control" }, "Project name"),
      input = el("input", {
        type: "text",
        value: state.project.name,
        maxlength: 80,
      });
    label.append(input);
    body.append(label);
    body.append(
      el(
        "p",
        {},
        "Your work saves automatically on this device. Export a project file to keep a portable copy.",
      ),
    );
    const actions = el("div", { class: "dialog-actions" });
    button(actions, "Cancel", closeDialog);
    button(actions, "Save", async () => {
      change(() => (state.project.name = input.value.trim() || "Untitled jam"));
      await saveCurrent();
      closeDialog();
    });
    body.append(actions);
  });
}
// The Open dialog lists local projects by recency and offers import and deletion.
// Loading a drawing goes through the shared project-switching path.
async function openDialog() {
  const projects = await listProjects();
  showDialog("Open a drawing", (body) => {
    body.append(el("p", {}, "Saved on this device"));
    if (!projects.length)
      body.append(
        el(
          "p",
          {},
          "No saved drawings yet. Import a Draw Synth project file below.",
        ),
      );
    for (const project of projects.sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    )) {
      const row = el("div", { class: "project-entry" });
      button(row, project.name, async () => {
        await switchProject(validateProject(project));
        closeDialog();
      });
      button(
        row,
        "Delete",
        async () => {
          await removeProject(project.id);
          if (project.id === state.project.id) {
            clearTimeout(autosaveTimer);
            stop();
            loadProject(defaults());
          }
          await openDialog();
        },
        { "aria-label": `Delete ${project.name}` },
      );
      body.append(row);
    }
    const actions = el("div", { class: "dialog-actions" });
    button(actions, "Import project…", () => $("#file-input").click());
    button(actions, "Close", closeDialog);
    body.append(actions);
  });
}
function exportDialog() {
  showDialog("Export your drawing", (body) => {
    body.append(el("h2", {}, "Let it out into the world."));
    // Export choices dispatch project, PNG, MIDI, or WAV generation. WAV rendering
    // reports progress while the offline audio engine prepares the download.
    body.append(el("p", {}, "One drawing. A few ways to share it."));
    const options = el("div", { class: "export-options" });
    const add = (title, desc, fn) => {
      const b = button(options, "", fn);
      b.append(el("b", {}, title), el("small", {}, desc));
    };
    add("WAV audio", "One complete loop · stereo", async () => {
      showDialog("Rendering your loop…", (body) => {
        body.append(
          el(
            "p",
            {},
            "Turning paint into sound. Longer loops can take a moment.",
          ),
        );
        body.append(
          el("progress", {
            id: "render-progress",
            max: 100,
            value: 0,
            "aria-label": "Audio rendering progress",
          }),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await exportWAV((n) => {
        const progress = $("#render-progress");
        if (progress) progress.value = n;
      });
      closeDialog();
      message("WAV exported. Your loop is ready.");
    });
    add("MIDI notes", "Separate tracks for every layer", () => {
      exportMIDI();
      message(
        "MIDI exported. Notes and timing included; brush sounds are not.",
      );
    });
    add("PNG image", "A picture of your music", () => {
      showDialog("Export artwork", (body) => {
        let grid = true,
          texture = true;
        checkbox(body, "Include grid", true, (v) => (grid = v));
        checkbox(body, "Include paper texture", true, (v) => (texture = v));
        button(body, "Save PNG", () => {
          // PNG can omit paper details; MIDI describes notes rather than brush timbre.
          // The image-import dialog initializes tracing options and its preview
          // controls.
          exportPNG(grid, texture);
          closeDialog();
        });
      });
    });
    add("Project file", "Editable .dsy / JSON", () => {
      exportJSON();
      message("Project file exported.");
    });
    body.append(
      options,
      el(
        "p",
        {},
        "MIDI contains notes, velocity, tempo, and layer tracks. Brush timbres and effects live in the WAV and project file.",
      ),
    );
  });
}
function imageDialog() {
  showDialog("Import Image", (body) => {
    let file,
      contours = null,
      revision = 0;
    const options = {
      detail: 50,
      threshold: 128,
      invert: false,
      aspect: view.width / view.height,
    };
    body.append(
      el(
        "p",
        {},
        "Convert image contours to editable lines. Processing stays in this browser.",
      ),
    );
    const input = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      hidden: "",
      id: "image-file",
    });
    body.append(input);
    // Image import keeps the chosen filename, raster preview, and tracing settings
    // together. The preview canvas uses the drawing area's aspect ratio.
    const filename = el(
      "span",
      { class: "image-filename" },
      "No image selected",
    );
    button(body, "Choose Image", () => input.click());
    body.append(filename);
    const status = el(
      "p",
      { role: "status", id: "image-status" },
      "Choose an image, then Preview.",
    );
    const preview = el("canvas", {
      id: "image-preview",
      width: 480,
      height: Math.round(480 / options.aspect),
      "aria-label": "Vector contour preview",
      hidden: "",
    });
    const invalidate = () => {
      revision++;
      contours = null;
      preview.hidden = true;
      importButton.disabled = true;
      status.textContent = "Click Preview to update the contours.";
    };
    range(body, "Detail", 50, 0, 100, 1, (value) => {
      options.detail = value;
      invalidate();
    });
    range(body, "Edge Threshold", 128, 1, 254, 1, (value) => {
      options.threshold = value;
      invalidate();
    });
    checkbox(body, "Invert", false, (value) => {
      options.invert = value;
      invalidate();
    });
    body.append(preview, status);
    const controls = el("div", { class: "dialog-actions" });
    body.append(controls);
    const previewButton = button(
      controls,
      "Preview",
      async () => {
        // A revision counter discards stale image-processing results when options
        // change. Buttons stay disabled until usable contours are available for import.
        const current = ++revision;
        contours = null;
        importButton.disabled = true;
        previewButton.disabled = true;
        status.textContent = "Processing image…";
        try {
          const result = await processImage(file, options);
          if (
            current !== revision ||
            !body.contains(status) ||
            !$("#dialog").open
          )
            return;
          if (!result.length)
            throw Error(
              "No visible contours found. Adjust Edge Threshold or try another image.",
            );
          contours = result;
          const ctx = preview.getContext("2d");
          ctx.clearRect(0, 0, preview.width, preview.height);
          ctx.strokeStyle = state.color;
          ctx.lineWidth = 1;
          for (const points of contours) {
            ctx.beginPath();
            points.forEach((p, i) =>
              ctx[i ? "lineTo" : "moveTo"](
                p.x * preview.width,
                p.y * preview.height,
              ),
            );
            ctx.stroke();
          }
          preview.hidden = false;
          importButton.disabled = false;
          status.textContent = `${contours.length} editable lines. Ready to import.`;
        } catch (error) {
          if (current === revision) status.textContent = error.message;
        } finally {
          previewButton.disabled = !file;
        }
      },
      { disabled: "" },
    );
    // Import checks layer, stroke, and point limits before adding any artwork. All
    // contours are inserted as editable Ink marks in one history transaction.
    const importButton = button(
      controls,
      "Import",
      () => {
        if (!contours) return;
        const project = state.project;
        const points =
          project.strokes.reduce((n, s) => n + s.points.length, 0) +
          contours.reduce((n, c) => n + c.length, 0);
        if (project.layers.length >= 8) {
          status.textContent =
            "All 8 layers are in use. Remove a layer before importing an image.";
          return;
        }
        if (
          project.strokes.length + contours.length > 10000 ||
          points > 500000 ||
          contours.some((c) => c.length > 6000)
        ) {
          status.textContent =
            "These contours exceed the project limits. Lower Detail and preview again.";
          return;
        }
        change(() => {
          const id = uid();
          project.layers.push({
            id,
            name: "Image",
            visible: true,
            mute: false,
            solo: false,
            volume: 0.8,
          });
          state.layer = id;
          const strokes = contours.map((points) => ({
            ...newStroke(points, "Ink"),
            size: 3,
            opacity: 0.9,
          }));
          project.strokes.push(...strokes);
          state.selected = new Set(strokes.map((s) => s.id));
        });
        setZoom(1);
        selectTool("Select");
        closeDialog();
        // After import, the new marks are selected for movement or recoloring.
        // Unsupported image types and processing failures produce useful status
        // messages.
        message(
          "Image imported. Select to move or resize; choose a color to recolor.",
        );
      },
      { disabled: "" },
    );
    button(controls, "Cancel", closeDialog);
    input.addEventListener("change", () => {
      file = input.files[0];
      invalidate();
      filename.textContent = file?.name || "No image selected";
      previewButton.disabled = !file;
      if (
        file &&
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      ) {
        status.textContent = "Choose a PNG, JPG, or WebP image.";
        previewButton.disabled = true;
      }
    });
  });
}
function paintColor(color) {
  state.color = color;
  if (state.tool === "Select" && state.selected.size)
    change(() => {
      state.project.strokes
        .filter((s) => state.selected.has(s.id))
        .forEach((s) => (s.color = color));
    });
  emit("brush");
}
function helpDialog() {
  showDialog("Welcome to Draw Synth", (body) => {
    body.append(el("h2", {}, "If you can doodle, you can play."));
    body.append(
      el(
        "p",
        {},
        "Draw on the paper, then press Play. Left to right is time; bottom to top is pitch. Each brush is a different instrument. Thicker marks are louder, opaque marks are brighter, and longer marks last longer.",
      ),
    );
    // Help explains drawing and playback controls. The shared action table supplies the
    // same operations to menus, toolbar buttons, and keyboard shortcuts.
    body.append(
      el(
        "p",
        {},
        "Click or drag the top canvas ruler to move the playhead. Draw over another mark to make a chord. Select a group to move it, or drag its bottom-right handle to resize. Shapes can also be placed from the keyboard.",
      ),
    );
    const shortcuts = el("div", { class: "shortcut-list" });
    for (const [key, desc] of [
      ["Space", "Play / pause"],
      ["Enter", "Return to start"],
      ["B / E", "Brush / eraser"],
      ["L / V / H", "Line / select / pan"],
      ["[ / ]", "Brush size"],
      ["⌘ or Ctrl + Z", "Undo"],
      ["+ Shift + Z", "Redo"],
      ["⌘ or Ctrl + S", "Save"],
      ["Delete", "Delete selected"],
      ["Escape", "Cancel / close"],
    ]) {
      shortcuts.append(el("kbd", {}, key), el("span", {}, desc));
    }
    body.append(
      shortcuts,
      el(
        "p",
        {},
        "On a tablet: one finger paints; two fingers pan and zoom. Sound starts after you press Play. Save is local to this browser; export a project file for backup.",
      ),
    );
    button(body, "Let’s draw", closeDialog);
  });
}
// Clipboard commands share status feedback across shortcuts, Properties, and menus.
// Copy preserves the selection; Paste selects the new editable marks on the active layer.
const actions = {
  copySelection: () => {
    const count = copySelection();
    message(
      count
        ? `${count} mark${count === 1 ? "" : "s"} copied.`
        : "Select marks to copy first.",
    );
  },
  pasteSelection: (at = null) => {
    const count = pasteSelection(at);
    message(
      count
        ? `${count} mark${count === 1 ? "" : "s"} pasted on the current layer.`
        : "Copy some marks first.",
    );
  },
  new: newProject,
  open: openDialog,
  save: renameDialog,
  undo,
  redo,
  play,
  pause,
  stop,
  loop: () => projectSet("loop", !state.project.loop),
  export: exportDialog,
  import: () => $("#file-input").click(),
  // Project duplication gets a new identity; deletion coordinates pending saves.
  // Selection and zoom actions operate on shared state rather than separate UI copies.
  duplicate: async () => {
    const p = structuredClone(state.project);
    p.id = uid();
    p.name += " copy";
    await switchProject(p);
    await saveCurrent();
  },
  deleteProject: async () => {
    const id = state.project.id;
    clearTimeout(autosaveTimer);
    await saveSerial.catch(() => {});
    await removeProject(id);
    stop();
    loadProject(defaults());
    message("Project deleted. A new drawing is ready.");
  },
  selectAll: () => {
    state.selected = new Set(state.project.strokes.map((s) => s.id));
    selectTool("Select");
  },
  duplicateSelection,
  deleteSelection,
  clear: () => change(() => (state.project.strokes = [])),
  zoomIn: () => setZoom(state.zoom + 0.25),
  zoomOut: () => setZoom(state.zoom - 0.25),
  zoomReset: () => setZoom(1),
  contrast: () => {
    document.body.classList.toggle("high-contrast");
    localStorage.setItem(
      "draw-synth-contrast",
      document.body.classList.contains("high-contrast"),
    );
  },
  settings: () => togglePanel("inspector", "settings-mobile"),
  preview: previewSound,
  help: helpDialog,
  about: () =>
    showDialog("About Draw Synth", (b) => {
      // The menu definitions group File, Edit, View, Sound, and Help commands with their
      // shortcut labels, keeping the Windows-style menu layout declarative.
      b.append(
        el("h2", {}, "Draw Synth 1.0"),
        el(
          "p",
          {},
          "A tiny paint studio with a musical imagination. Made with HTML Canvas, Web Audio, and a love for the desktop era. No account, no uploads, no backend.",
        ),
      );
      button(b, "Close", closeDialog);
    }),
  demo: () => switchProject(demo()),
};
function menus() {
  const definitions = {
    File: [
      ["New drawing", "new", "Ctrl/⌘ N"],
      ["Open project…", "open", ""],
      ["Save project…", "save", "Ctrl/⌘ S"],
      ["Duplicate project", "duplicate", ""],
      ["Import project…", "import", ""],
      ["Export…", "export", ""],
      ["Delete project", "deleteProject", ""],
    ],
    Edit: [
      ["Undo", "undo", "⌘ Z"],
      ["Redo", "redo", "⇧ ⌘ Z"],
      ["Select all", "selectAll", "⌘ A"],
      ["Copy", "copySelection", "Ctrl/⌘ C"],
      ["Paste", "pasteSelection", "Ctrl/⌘ V"],
      ["Duplicate selection", "duplicateSelection", ""],
      ["Delete selection", "deleteSelection", "⌫"],
      ["Clear drawing", "clear", ""],
    ],
    View: [
      ["Zoom in", "zoomIn", ""],
      ["Zoom out", "zoomOut", ""],
      ["Fit canvas", "zoomReset", ""],
      ["High contrast", "contrast", ""],
      ["Properties window", "settings", ""],
    ],
    Sound: [
      ["Play / pause", "play", "Space"],
      ["Stop", "stop", ""],
      ["Loop on / off", "loop", ""],
      ["Preview brush", "preview", ""],
    ],
    // Menus close each other when opened and dispatch the same action handlers as the
    // toolbar. Panel dragging stores pointer offsets to avoid jumping on pickup.
    Help: [
      ["How to play", "help", ""],
      ["Load demo drawing", "demo", ""],
      ["About Draw Synth", "about", ""],
    ],
  };
  for (const [name, items] of Object.entries(definitions)) {
    const menu = el("div", { class: "menu" }),
      list = el("div", { class: "menu-list", hidden: "" });
    const toggle = button(
      menu,
      name,
      () => {
        const hidden = list.hidden;
        closeMenus();
        list.hidden = !hidden;
        toggle.setAttribute("aria-expanded", hidden);
      },
      { "aria-expanded": false, "aria-haspopup": true },
    );
    items.forEach(([text, action, key]) => {
      const b = button(list, "", () => {
        closeMenus();
        return actions[action]();
      });
      b.append(el("span", {}, text), el("small", {}, key));
    });
    menu.append(list);
    $("#menubar").append(menu);
  }
}
function closeMenus() {
  document.querySelectorAll(".menu-list").forEach((e) => (e.hidden = true));
  document
    .querySelectorAll(".menu>button")
    .forEach((e) => e.setAttribute("aria-expanded", "false"));
}
// The canvas menu uses the same commands as keyboard shortcuts and Properties.
// Keep the right-click position for Paste without moving or clearing the selection.
function selectionMenu() {
  const canvas = $("#drawing");
  const menu = el("div", {
    id: "selection-menu",
    class: "menu-list canvas-menu",
    role: "menu",
    "aria-label": "Selection actions",
    hidden: "",
  });
  let at = null;
  const run = (fn) => () => {
    closeMenus();
    fn();
    canvas.focus({ preventScroll: true });
  };
  const copy = button(menu, "Copy", run(actions.copySelection), {
    role: "menuitem",
  });
  const paste = button(
    menu,
    "Paste",
    run(() => actions.pasteSelection(at)),
    { role: "menuitem" },
  );
  document.body.append(menu);
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeMenus();
    at = canvasPoint(e);
    copy.disabled = !state.project.strokes.some((s) =>
      state.selected.has(s.id),
    );
    paste.disabled = !canPasteSelection();
    menu.hidden = false;
    menu.style.left = `${clamp(e.clientX, 0, innerWidth - menu.offsetWidth)}px`;
    menu.style.top = `${clamp(e.clientY, 0, innerHeight - menu.offsetHeight)}px`;
    (copy.disabled ? paste : copy).focus();
  });
  // Arrow keys move between available commands; Escape restores canvas focus.
  menu.addEventListener("keydown", (e) => {
    if (["Enter", " "].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      document.activeElement?.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      canvas.focus();
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
      const next =
        buttons.indexOf(document.activeElement) +
        (e.key === "ArrowDown" ? 1 : -1);
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
  });
  window.addEventListener("resize", closeMenus);
}
function draggable() {
  document.querySelectorAll("[data-drag]").forEach((handle) => {
    let drag;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || innerWidth < 850) return;
      const panel = $("#" + handle.dataset.drag),
        r = panel.getBoundingClientRect();
      drag = { panel, dx: e.clientX - r.left, dy: e.clientY - r.top };
      // Dragging a panel switches it to a bounded floating position. Double-clicking its
      // title restores docking; full-canvas mode independently controls surrounding
      // chrome.
      panel.style.width = r.width + "px";
      panel.style.height = r.height + "px";
      panel.style.position = "fixed";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      panel.style.zIndex = "25";
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.panel.style.left =
        clamp(e.clientX - drag.dx, 0, innerWidth - drag.panel.offsetWidth) +
        "px";
      drag.panel.style.top =
        clamp(e.clientY - drag.dy, 0, innerHeight - 60) + "px";
    });
    handle.addEventListener("pointerup", () => (drag = null));
    handle.addEventListener("dblclick", () =>
      $("#" + handle.dataset.drag).removeAttribute("style"),
    );
  });
}
function togglePanel(id, control) {
  const panel = $("#" + id);
  panel.hidden = !panel.hidden;
  $("#" + control).setAttribute("aria-expanded", String(!panel.hidden));
}
function fullCanvas(enabled) {
  closeMenus();
  document.body.classList.toggle("full-canvas", enabled);
  $("#full-canvas").setAttribute("aria-pressed", String(enabled));
  (enabled ? $("#exit-full-canvas") : $("#full-canvas")).focus();
}
function bind() {
  document.querySelectorAll("[data-action]").forEach((b) =>
    b.addEventListener(
      "click",
      guard(() => actions[b.dataset.action]()),
    ),
  );
  $("#help-top").onclick = helpDialog;
  $("#import-image").onclick = imageDialog;
  $("#toggle-tools").onclick = () => togglePanel("palette", "toggle-tools");
  $("#close-tools").onclick = $("#toggle-tools").onclick;
  $("#full-canvas").onclick = () => fullCanvas(true);
  // Binding connects playback, dialogs, panel toggles, and fullscreen controls. Color
  // buttons reuse the same recoloring path as the custom-color input.
  $("#exit-full-canvas").onclick = () => fullCanvas(false);
  $("#canvas-play").onclick = guard(() => {
    if (!state.playing) return play();
  });
  $("#canvas-pause").onclick = pause;
  $("#dialog-close").onclick = closeDialog;
  $("#dialog").addEventListener("click", (e) => {
    if (e.target === $("#dialog")) closeDialog();
  });
  $("#settings-mobile").onclick = actions.settings;
  $("#close-settings").onclick = actions.settings;
  $("#fullscreen").onclick = guard(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    else message("Fullscreen is unavailable in this browser.");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeMenus();
  });
  PAPER.forEach((type) =>
    $("#paper-type").append(el("option", { value: type }, type)),
  );
  $("#paper-type").onchange = (e) => {
    paperSet("type", e.target.value);
    paperSettings();
  };
  $("#quick-grid").onchange = (e) => {
    paperSet("grid", e.target.checked);
    paperSettings();
  };
  $("#zoom-in").onclick = actions.zoomIn;
  $("#zoom-out").onclick = actions.zoomOut;
  $("#zoom-reset").onclick = actions.zoomReset;
  COLORS.forEach((color, i) => {
    const b = button(
      $("#colors"),
      "",
      () => {
        paintColor(color);
      },
      {
        class: "swatch",
        "aria-label": `Paint ${["charcoal", "gray", "white", "coral", "orange", "yellow", "green", "teal", "blue", "violet", "pink", "brown"][i]}`,
        // Palette changes update the selected marks or current paint color. Tempo, loop
        // length, ping-pong, metronome, and master-volume inputs write project settings.
        "aria-pressed": state.color === color,
      },
    );
    b.style.setProperty("--swatch", color);
    b.dataset.color = color;
  });
  $("#custom-color").oninput = (e) => {
    paintColor(e.target.value);
  };
  for (const id of ["bpm", "bpm-range"])
    $("#" + id).oninput = (e) => {
      if (Number.isFinite(e.target.valueAsNumber))
        projectSet("bpm", clamp(e.target.valueAsNumber, 40, 240));
    };
  $("#bpm").onchange = () => ($("#bpm").value = state.project.bpm);
  $("#bars").onchange = (e) => {
    stop();
    projectSet("bars", +e.target.value);
  };
  $("#pingpong").onchange = (e) => {
    stop();
    projectSet("pingpong", e.target.checked);
  };
  $("#metronome").onchange = (e) => projectSet("metronome", e.target.checked);
  for (const id of ["master", "master-number"])
    $("#" + id).oninput = (e) => {
      if (Number.isFinite(e.target.valueAsNumber))
        projectSet("master", clamp(e.target.valueAsNumber / 100));
    };
  let taps = [];
  $("#tap-tempo").onclick = () => {
    const t = performance.now();
    if (t - (taps.at(-1) || 0) > 2000) taps = [];
    taps.push(t);
    taps = taps.slice(-5);
    if (taps.length > 1)
      projectSet(
        "bpm",
        clamp(Math.round(60000 / ((t - taps[0]) / (taps.length - 1))), 40, 240),
      );
    // Tap tempo derives BPM from recent taps. Layer creation and project import enforce
    // limits before the keyboard handler routes global application shortcuts.
    message(
      taps.length === 1
        ? "Tap a few more times…"
        : `Tempo: ${state.project.bpm} BPM`,
    );
  };
  $("#add-layer").onclick = () => {
    if (state.project.layers.length >= 8) return;
    change(() => {
      const id = uid();
      state.project.layers.push({
        id,
        name: `Layer ${state.project.layers.length + 1}`,
        visible: true,
        mute: false,
        solo: false,
        volume: 0.8,
      });
      state.layer = id;
    });
  };
  $("#layer-options").onclick = layerDialog;
  $("#file-input").onchange = guard(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 30000000)
        throw Error("Project files must be smaller than 30 MB.");
      const p = validateProject(JSON.parse(await file.text()));
      p.id = uid();
      await switchProject(p);
      closeDialog();
      message("Project imported.");
    } finally {
      e.target.value = "";
    }
  });
  document.addEventListener(
    "keydown",
    guard(async (e) => {
      if (e.key === "Escape") {
        closeMenus();
        cancelAction();
        if ($("#dialog").open) closeDialog();
        else if (document.body.classList.contains("full-canvas"))
          // Shortcuts are ignored while typing in inputs or dialogs. Space controls
          // playback, Enter seeks, and editing shortcuts reuse the same undoable actions
          // as buttons.
          fullCanvas(false);
        return;
      }
      if (
        e.target.closest(
          "input,select,textarea,[contenteditable]:not([contenteditable=false])",
        ) ||
        $("#dialog").open
      )
        return;
      const cmd = e.ctrlKey || e.metaKey,
        key = e.key.toLowerCase();
      if (cmd && ["z", "s", "a", "n", "d", "c", "v"].includes(key)) {
        e.preventDefault();
        if (key === "c") actions.copySelection();
        if (key === "v") actions.pasteSelection();
        if (key === "z") e.shiftKey ? redo() : undo();
        if (key === "s") renameDialog();
        if (key === "a") actions.selectAll();
        if (key === "n") await newProject();
        if (key === "d") duplicateSelection();
        return;
      }
      // Unmodified keys remain available for playback and drawing tools after
      // clipboard shortcuts have been handled outside text-editing controls.
      if (e.code === "Space") {
        e.preventDefault();
        await play();
      } else if (e.key === "Enter") {
        e.preventDefault();
        seekStart();
      } else if (["Delete", "Backspace"].includes(e.key)) {
        e.preventDefault();
        deleteSelection();
      } else if (key === "[" || key === "]") {
        state.brush.size = clamp(
          state.brush.size + (key === "]" ? 1 : -1),
          1,
          80,
        );
        emit("tool");
      } else if (
        { b: "Ink", e: "Eraser", l: "Line", v: "Select", h: "Hand" }[key]
      )
        selectTool(
          { b: "Ink", e: "Eraser", l: "Line", v: "Select", h: "Hand" }[key],
        );
    }),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.dirty) saveCurrent(true).catch(() => {});
  });
  draggable();
}
// Startup creates controls and installs drawing, seeking, transport, and state listeners
// before loading a blank project. A small public handle supports browser checks.
async function init() {
  renderTools();
  menus();
  bind();
  initCanvas();
  initTools();
  selectionMenu();
  initSeeking();
  initTransport();
  subscribe(sync);
  loadProject(defaults());
  try {
    if (localStorage.getItem("draw-synth-contrast") === "true")
      document.body.classList.add("high-contrast");
  } catch {}
  sync("init");
  window.drawSynth = { state, actions, validateProject };
}
init().catch((error) => {
  console.error(error);
  message("Could not start Draw Synth: " + error.message);
});
