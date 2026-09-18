import { state } from "./state.js";
import { timeline, createGraph, soundNote, metronomeNote } from "./audio.js";
import { renderArtwork } from "./canvas.js";
export function download(data, name, type) {
  const url = URL.createObjectURL(
    data instanceof Blob ? data : new Blob([data], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function exportJSON() {
  download(
    JSON.stringify(state.project, null, 2),
    `${state.project.name}.dsy`,
    "application/json",
  );
}
export function exportPNG(grid = true, texture = true) {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1000;
  renderArtwork(canvas.getContext("2d"), 1800, 1000, { grid, texture });
  canvas.toBlob((blob) =>
    download(blob, `${state.project.name}.png`, "image/png"),
  );
}
export function encodeWAV(buffer) {
  const channels = buffer.numberOfChannels,
    length = buffer.length,
    bytes = new ArrayBuffer(44 + length * channels * 2),
    view = new DataView(bytes);
  const string = (at, s) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  string(0, "RIFF");
  view.setUint32(4, 36 + length * channels * 2, true);
  string(8, "WAVE");
  string(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  string(36, "data");
  view.setUint32(40, length * channels * 2, true);
  let offset = 44;
  const data = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let i = 0; i < length; i++) {
    const fade = Math.min(
      1,
      i / (buffer.sampleRate * 0.008),
      (length - 1 - i) / (buffer.sampleRate * 0.015),
    );
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i] * fade));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return bytes;
}
export async function exportWAV(progress = () => {}) {
  const p = structuredClone(state.project),
    beats = p.bars * 4 * (p.pingpong ? 2 : 1),
    spb = 60 / p.bpm,
    rate = 44100,
    Offline =
      globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline)
    throw Error("Offline audio rendering is unavailable in this browser.");
  const context = new Offline(2, Math.ceil(beats * spb * rate), rate),
    graph = createGraph(context, p);
  const notes = timeline(p);
  let active = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i],
      time = n.start * spb;
    active = active.filter((v) => v.end > time);
    if (active.length >= 32) active.shift().stop(time);
    active.push(soundNote(context, graph, n, time, spb));
    if (i % 200 === 0)
      progress(Math.round((i / Math.max(1, notes.length)) * 30));
  }
  if (p.metronome)
    for (let b = 0; b < beats; b++)
      metronomeNote(context, graph, b * spb, b % 4 === 0, p.metroVolume);
  progress(40);
  const buffer = await context.startRendering();
  progress(90);
  download(encodeWAV(buffer), `${p.name}.wav`, "audio/wav");
  progress(100);
}
function variable(n) {
  const bytes = [n & 127];
  while ((n >>= 7)) bytes.unshift((n & 127) | 128);
  return bytes;
}
const ascii = (s) => [...s].map((c) => c.charCodeAt(0) & 255),
  u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255],
  u16 = (n) => [(n >>> 8) & 255, n & 255];
export function encodeMIDI(p) {
  const notes = timeline(p),
    ppq = 480,
    tracks = [];
  function track(events) {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    let prev = 0,
      bytes = [];
    for (const e of events) {
      bytes.push(...variable(e.tick - prev), ...e.data);
      prev = e.tick;
    }
    bytes.push(0, 255, 47, 0);
    return [...ascii("MTrk"), ...u32(bytes.length), ...bytes];
  }
  const tempo = Math.round(60000000 / p.bpm);
  tracks.push(
    track([
      {
        tick: 0,
        order: 0,
        data: [
          255,
          81,
          3,
          (tempo >>> 16) & 255,
          (tempo >>> 8) & 255,
          tempo & 255,
        ],
      },
      { tick: 0, order: 1, data: [255, 88, 4, 4, 2, 24, 8] },
    ]),
  );
  p.layers.forEach((layer, index) => {
    const name = ascii(layer.name),
      events = [
        {
          tick: 0,
          order: -2,
          data: [255, 3, ...variable(name.length), ...name],
        },
        { tick: 0, order: -1, data: [192 + index, 80] },
      ];
    for (const n of notes.filter((n) => n.layerId === layer.id)) {
      const drum = n.brush === "Drums",
        channel = drum ? 9 : index;
      const parts = drum
        ? [
            {
              beat: 0,
              pitch:
                { kick: 36, snare: 38, "closed hi-hat": 42, "open hi-hat": 46 }[
                  n.sound.drum
                ] || 36,
            },
          ]
        : n.curve;
      const simplified = [];
      for (const q of parts) {
        const pitch = Math.max(
          0,
          Math.min(127, Math.round(q.pitch + (drum ? p.pitchShift || 0 : 0))),
        );
        if (!simplified.length || simplified.at(-1).pitch !== pitch)
          simplified.push({ ...q, pitch });
      }
      for (let i = 0; i < simplified.length; i++) {
        const q = simplified[i],
          end = i + 1 < simplified.length ? simplified[i + 1].beat : n.duration,
          startTick = Math.round((n.start + q.beat) * ppq),
          endTick = Math.max(startTick + 1, Math.round((n.start + end) * ppq));
        events.push(
          {
            tick: startTick,
            order: 1,
            data: [
              144 + channel,
              q.pitch,
              Math.max(1, Math.round(n.velocity * 127)),
            ],
          },
          { tick: endTick, order: 0, data: [128 + channel, q.pitch, 0] },
        );
      }
    }
    tracks.push(track(events));
  });
  return new Uint8Array([
    ...ascii("MThd"),
    0,
    0,
    0,
    6,
    0,
    1,
    ...u16(tracks.length),
    ...u16(ppq),
    ...tracks.flat(),
  ]);
}
export function exportMIDI() {
  download(
    encodeMIDI(state.project),
    `${state.project.name}.mid`,
    "audio/midi",
  );
}
