import { state, emit, subscribe, clamp } from "./state.js";
import { createGraph, timeline, soundNote, metronomeNote } from "./audio.js";
let context,
  graph,
  notes = [],
  timer,
  originTime = 0,
  originBeat = 0,
  pausedBeat = 0,
  tempo = 110,
  scheduled = new Set(),
  voices = [],
  lastTick = 0,
  generation = 0,
  lastComposition = "";
// Presentation-only changes must not restart sounding voices.
function compositionKey() {
  const p = state.project;
  return JSON.stringify({
    strokes: p.strokes,
    layers: p.layers.map(({ id, mute, solo, volume }) => ({
      id,
      mute,
      solo,
      volume,
    })),
    bpm: p.bpm,
    bars: p.bars,
    scale: p.scale,
    root: p.root,
    octaves: p.octaves,
    snap: p.snap,
    pitchShift: p.pitchShift || 0,
    pingpong: p.pingpong,
  });
}
export function audioContext() {
  return context;
}
export function transportBeat() {
  return state.playing && context
    ? originBeat + ((context.currentTime - originTime) * tempo) / 60
    : pausedBeat;
}
function length() {
  return state.project.bars * 4 * (state.project.pingpong ? 2 : 1);
}
function silence() {
  for (const v of voices) v.stop();
  voices = [];
  scheduled.clear();
}
function rebase() {
  const beat = transportBeat();
  tempo = state.project.bpm;
  originBeat = beat;
  originTime = context?.currentTime || 0;
  pausedBeat = beat;
  notes = timeline(state.project);
  lastComposition = compositionKey();
  silence();
  generation++;
  if (state.playing) tick(true);
}
export async function play() {
  if (state.playing) {
    pause();
    return;
  }
  if (!context) {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio)
      throw Error(
        "This browser does not support Web Audio. Try a current Safari, Firefox, or Chromium browser.",
      );
    context = new Audio();
    graph = createGraph(context, state.project);
  }
  await context.resume();
  if (pausedBeat >= length() && !state.project.loop) pausedBeat = 0;
  tempo = state.project.bpm;
  originBeat = pausedBeat;
  originTime = context.currentTime + 0.035;
  notes = timeline(state.project);
  lastComposition = compositionKey();
  state.playing = true;
  scheduled.clear();
  generation++;
  lastTick = context.currentTime;
  tick(true);
  timer = setInterval(tick, 25);
  emit("play");
}
export function pause() {
  if (!state.playing) return;
  pausedBeat = Math.max(0, transportBeat());
  state.playing = false;
  clearInterval(timer);
  silence();
  emit("play");
}
export function stop() {
  pause();
  silence();
  pausedBeat = 0;
  originBeat = 0;
  state.position = 0;
  emit("play");
}
// Seek in canvas coordinates; a ping-pong seek starts on the forward pass.
export function seek(position) {
  if (!Number.isFinite(position)) return;
  state.position = clamp(position);
  pausedBeat = state.position * state.project.bars * 4;
  originBeat = pausedBeat;
  tempo = state.project.bpm;
  originTime = context?.currentTime || 0;
  silence();
  generation++;
  if (state.playing) {
    notes = timeline(state.project);
    lastComposition = compositionKey();
    tick(true);
  }
  emit("seek");
}
export function seekStart() {
  seek(0);
}
function tick(resume = false) {
  if (!state.playing) return;
  const now = context.currentTime,
    beat = Math.max(0, transportBeat()),
    len = length();
  if (!state.project.loop && beat >= len) {
    stop();
    return;
  }
  if (now - lastTick > 0.4) {
    silence();
    generation++;
    resume = true;
  }
  lastTick = now;
  voices = voices.filter((v) => v.end > now);
  const horizon = beat + (0.12 * tempo) / 60,
    startCycle = Math.floor(beat / len),
    endCycle = Math.floor(horizon / len);
  for (let cycle = startCycle; cycle <= endCycle; cycle++) {
    if (cycle > 0 && !state.project.loop) break;
    for (const n of notes) {
      const begin = cycle * len + n.start,
        end = begin + n.duration,
        key = `${generation}:${cycle}:${n.id}`;
      if (scheduled.has(key)) continue;
      const atStart = begin >= beat - 0.015 && begin <= horizon,
        active = resume && begin < beat && end > beat;
      if (!atStart && !active) continue;
      scheduled.add(key);
      const offset = Math.max(0, beat - begin);
      if (n.brush === "Drums" && offset > 0.06) continue;
      const t = Math.max(
        now + 0.006,
        originTime + ((begin - originBeat) * 60) / tempo,
      );
      if (voices.length >= 32) {
        voices.shift().stop(now);
      }
      voices.push(soundNote(context, graph, n, t, 60 / tempo, offset));
    }
  }
  if (state.project.metronome) {
    for (let b = Math.ceil(beat); b <= horizon; b++) {
      const key = `${generation}:metro:${b}`;
      if (!scheduled.has(key)) {
        scheduled.add(key);
        voices.push(
          metronomeNote(
            context,
            graph,
            Math.max(now + 0.006, originTime + ((b - originBeat) * 60) / tempo),
            b % 4 === 0,
            state.project.metroVolume,
          ),
        );
      }
    }
  }
  if (scheduled.size > 4000) {
    scheduled = new Set([...scheduled].slice(-2000));
  }
}
export async function previewSound() {
  if (!context) {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    context = new Audio();
    graph = createGraph(context, state.project);
  }
  await context.resume();
  voices = voices.filter((v) => v.end > context.currentTime);
  if (voices.length >= 32) voices.shift().stop();
  const brush = [
    "Ink",
    "Pencil",
    "Watercolor",
    "Marker",
    "Airbrush",
    "Bass",
    "Drums",
  ].includes(state.tool)
    ? state.tool
    : "Ink";
  voices.push(
    soundNote(
      context,
      graph,
      {
        duration: 1,
        pitch: brush === "Bass" ? 36 : 60,
        curve: [{ beat: 0, pitch: brush === "Bass" ? 36 : 60 }],
        brush,
        velocity: state.brush.volume,
        brightness: state.brush.opacity,
        sound: state.brush,
        seed: 42,
      },
      context.currentTime + 0.01,
      60 / state.project.bpm,
    ),
  );
}
export function initTransport() {
  subscribe((type) => {
    if (type === "load") {
      stop();
      notes = timeline(state.project);
      lastComposition = compositionKey();
      if (graph) graph.update(state.project);
    } else if (type === "edit" || type === "music") {
      if (graph) graph.update(state.project);
      if (state.playing && compositionKey() !== lastComposition) rebase();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.playing) {
      silence();
      generation++;
      tick(true);
    }
  });
  const meter = [...document.querySelectorAll(".audio-meter i")];
  const samples = new Float32Array(256);
  function frame() {
    if (graph) {
      graph.analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((n, s) => n + s * s, 0) / samples.length,
      );
      const level = Math.max(
        0,
        Math.min(8, (20 * Math.log10(rms || 0.000001) + 55) / 6),
      );
      meter.forEach((led, i) => led.classList.toggle("lit", i < level));
    }
    if (state.playing) {
      const b = Math.max(0, transportBeat()),
        beats = state.project.bars * 4,
        pos = b % length();
      state.position =
        state.project.pingpong && pos > beats
          ? 1 - (pos - beats) / beats
          : pos / beats;
    }
    {
      const beats = state.project.bars * 4;
      document.querySelector("#bar-position").textContent = String(
        Math.min(
          state.project.bars,
          Math.floor((state.position * beats) / 4) + 1,
        ),
      ).padStart(2, "0");
      document.querySelector("#beat-position").textContent = String(
        (Math.min(beats - 1, Math.floor(state.position * beats)) % 4) + 1,
      ).padStart(2, "0");
    }
    requestAnimationFrame(frame);
  }
  frame();
}
