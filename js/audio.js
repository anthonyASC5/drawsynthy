// Audio is compiled from vector geometry and shared project settings. Live playback and
// exports consume the same deterministic note representation.
import {
  pitchAt,
  clamp,
  state,
  emit,
  subscribe,
  rainPattern,
  playbackProject,
} from "./state.js";

// Audio synthesis
export function compileNotes(project, includeRain = true) {
  const beats = project.bars * 4,
    notes = [],
    strokeIndex = new Map(project.strokes.map((s) => [s.id, s])),
    solo = project.layers.some((l) => l.solo);
  for (const stroke of project.strokes) {
    const layer = project.layers.find((l) => l.id === stroke.layerId);
    if (
      !layer ||
      layer.mute ||
      layer.volume === 0 ||
      stroke.sound.volume === 0 ||
      (solo && !layer.solo) ||
      !stroke.points.length
    )
      continue;
    const xs = stroke.points.map((p) => p.x),
      ys = stroke.points.map((p) => p.y);
    const vertical =
      Math.max(...xs) - Math.min(...xs) <=
        Math.max(0.0025, stroke.size / 1800) &&
      Math.max(...ys) - Math.min(...ys) >= 0.015;
    let segments = [],
      current = [stroke.points[0]],
      direction = 0;
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i],
        prev = stroke.points[i - 1],
        d = Math.sign(p.x - prev.x);
      if (!vertical && d && direction && d !== direction) {
        segments.push(current);
        current = [prev];
      }
      current.push(p);
      // Stroke direction changes split phrases into monotonic segments. Nearly vertical
      // strokes become simultaneous pitches, tolerating small horizontal pointer jitter.
      if (d) direction = d;
    }
    segments.push(current);
    // Vertical marks intersect several pitches at once: turn those into a chord.
    segments = segments.flatMap((segment) => {
      const xs = segment.map((p) => p.x),
        ys = segment.map((p) => p.y);
      if (
        !vertical ||
        Math.max(...ys) - Math.min(...ys) < 0.015 ||
        stroke.brush === "Bass"
      )
        return [segment];
      const top = Math.min(...ys),
        bottom = Math.max(...ys),
        count = Math.min(
          16,
          Math.max(
            2,
            Math.round(
              Math.abs(pitchAt(top, project) - pitchAt(bottom, project)),
            ) + 1,
          ),
        );
      const x = xs.reduce((n, x) => n + x, 0) / xs.length;
      return Array.from({ length: count }, (_, i) => [
        { ...segment[0], x, y: top + ((bottom - top) * i) / (count - 1) },
      ]);
    });
    for (let si = 0; si < segments.length; si++) {
      let points = [...segments[si]].sort((a, b) => a.x - b.x);
      const start = points[0].x * beats,
        end = points.at(-1).x * beats,
        minDuration =
          stroke.brush === "Drums"
            ? 0.08
            : stroke.brush === "Pencil"
              ? 0.12
              : 0.2;
      const duration = Math.max(minDuration, end - start);
      // Each note combines canvas pitch, brush range, and transposition, then clamps to
      // MIDI limits. Pressure, thickness, layer gain, and opacity shape its sound.
      const pitch = (p) =>
        clamp(
          pitchAt(p.y, project, !!stroke.smudged) +
            (stroke.brush === "Bass" ? -24 : 0) +
            (stroke.pitchShift || 0) +
            (project.pitchShift || 0),
          0,
          127,
        );
      if (end - start < 0.002 && points.length > 1) {
        points = [points[Math.floor(points.length / 2)]];
      }
      const avgPressure =
        points.reduce((n, p) => n + (p.pressure ?? 0.65), 0) / points.length;
      notes.push({
        id: `${stroke.id}-${si}`,
        layerId: layer.id,
        start: Math.min(start, beats - 0.005),
        duration: Math.min(duration, beats - start || 0.005),
        extent: Math.max(0, end - start),
        pitch: pitch(points[0]),
        curve: points.map((p) => ({
          beat: Math.max(0, p.x * beats - start),
          pitch: pitch(p),
        })),
        pitchShift: (project.pitchShift || 0) + (stroke.pitchShift || 0),
        brush: stroke.brush,
        color: stroke.color,
        velocity: clamp(
          (stroke.sound.volume ?? 0.65) *
            (0.3 + stroke.size / 28) *
            (0.35 + avgPressure) *
            layer.volume,
          0.008,
          0.85,
        ),
        brightness: clamp(stroke.opacity * (stroke.sound.hardness ?? 0.75)),
        sound: stroke.sound,
        seed: hash(stroke.id),
      });
    }
  }
  for (const n of notes) {
    const stroke = strokeIndex.get(n.id.slice(0, n.id.lastIndexOf("-")));
    if (stroke?.smudged && n.curve.length > 2) {
      // Smudged curves blend neighboring pitches for smoother motion. Note arrangement
      // sorts onsets and keeps Bass monophonic across overlapping bass marks.
      const original = n.curve.map((p) => p.pitch),
        strength = stroke.sound.soundSmoothing ?? 0.65;
      n.curve.forEach((p, i) => {
        const average =
          (original[Math.max(0, i - 1)] +
            original[i] * 2 +
            original[Math.min(original.length - 1, i + 1)]) /
          4;
        p.pitch = p.pitch * (1 - strength) + average * strength;
      });
      n.pitch = n.curve[0].pitch;
    }
  }
  if (includeRain) notes.push(...compileRainNotes(project));
  return arrangeNotes(notes);
}
function arrangeNotes(notes) {
  notes.sort((a, b) => a.start - b.start);
  const bass = notes.filter((n) => n.brush === "Bass");
  for (let i = 0; i < bass.length - 1; i++)
    bass[i].duration = Math.min(
      bass[i].duration,
      Math.max(0.005, bass[i + 1].start - bass[i].start),
    );
  return notes;
}
export function compileRainNotes(project) {
  if (!project.rainClouds?.length) return [];
  const strokes = new Map(project.strokes.map((s) => [s.id, s]));
  const length = project.bars * 4 * (project.pingpong ? 2 : 1);
  const notes = [];
  const solo = project.layers.some((l) => l.solo);
  for (const drop of rainPattern(project)) {
    if (!drop.hit || (!project.loop && drop.contact >= length)) continue;
    const stroke = strokes.get(drop.hit.strokeId),
      layer = project.layers.find((l) => l.id === stroke.layerId);
    if (
      !layer ||
      layer.mute ||
      layer.volume === 0 ||
      stroke.sound.volume === 0 ||
      (solo && !layer.solo)
    )
      continue;
    const shift = (project.pitchShift || 0) + (stroke.pitchShift || 0);
    // Rain notes inherit the first contacted mark's pitch, instrument, and layer
    // settings. Droplet size adjusts velocity while muted or non-solo layers stay
    // silent.
    const pitch = clamp(
      pitchAt(drop.y, project, !!stroke.smudged) +
        (stroke.brush === "Bass" ? -24 : 0) +
        shift,
      0,
      127,
    );
    notes.push({
      id: `rain:${drop.id}`,
      layerId: layer.id,
      start: drop.start,
      duration: Math.min(
        stroke.brush === "Drums" ? 0.08 : 0.2,
        length - drop.start,
      ),
      extent: 0,
      pitch,
      curve: [{ beat: 0, pitch }],
      pitchShift: shift,
      brush: stroke.brush,
      color: stroke.color,
      sound: stroke.sound,
      velocity: clamp(
        (stroke.sound.volume ?? 0.65) *
          (0.3 + stroke.size / 28) *
          (0.35 + drop.hit.pressure) *
          layer.volume *
          drop.size,
        0.008,
        0.85,
      ),
      brightness: clamp(stroke.opacity * (stroke.sound.hardness ?? 0.75)),
      seed: hash(drop.id),
      rain: { cloudId: drop.cloudId, x: drop.x, y: drop.y },
    });
  }
  return notes;
}
export function timeline(project) {
  const notes = compileNotes(project, false);
  if (!project.pingpong)
    return arrangeNotes([...notes, ...compileRainNotes(project)]);
  const beats = project.bars * 4;
  const result = [];
  for (const n of notes) {
    // Ping-pong playback reverses the pitch curve and onset positions. Boundary notes
    // are handled specially so the turnaround does not strike the same point twice.
    const extent = Math.min(n.extent, n.duration);
    const reverseCurve = [...n.curve]
      .reverse()
      .map((p) => ({ beat: Math.max(0, extent - p.beat), pitch: p.pitch }));
    // A point at either boundary is struck once per turnaround.
    if (extent < 0.002 && (n.start < 0.005 || n.start >= beats - 0.006)) {
      result.push(n);
      continue;
    }
    // Keep a continuous stroke sounding as the playhead turns around at its end.
    if (n.start + extent >= beats - 0.001) {
      result.push({
        ...n,
        duration: extent * 2,
        curve: [
          ...n.curve,
          ...reverseCurve
            .slice(1)
            .map((p) => ({ ...p, beat: p.beat + extent })),
        ],
      });
      continue;
    }
    result.push(n, {
      ...n,
      id: n.id + "-reverse",
      start: beats * 2 - (n.start + extent),
      pitch: reverseCurve[0]?.pitch ?? n.pitch,
      curve: reverseCurve,
    });
  }
  return arrangeNotes([...result, ...compileRainNotes(project)]);
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
// MIDI pitches become oscillator frequencies. The shared audio graph provides filtering,
// compression, master gain, delay, reverb, and an analyser for metering.
const frequency = (m) => 440 * 2 ** ((m - 69) / 12);
export function createGraph(context, p) {
  const input = context.createGain(),
    master = context.createGain(),
    compressor = context.createDynamicsCompressor(),
    filter = context.createBiquadFilter(),
    analyser = context.createAnalyser();
  analyser.fftSize = 256;
  filter.type = "lowpass";
  filter.frequency.value = 500 + p.brightness * 14500;
  compressor.threshold.value = -16;
  compressor.knee.value = 20;
  compressor.ratio.value = 5;
  master.gain.value = p.master * 0.55;
  input.connect(filter);
  filter.connect(compressor);
  compressor.connect(master);
  master.connect(analyser);
  analyser.connect(context.destination);
  const delay = context.createDelay(2),
    feedback = context.createGain(),
    wet = context.createGain();
  delay.delayTime.value = (60 / p.bpm) * 0.75;
  feedback.gain.value = 0.25;
  wet.gain.value = p.delay * 0.38;
  filter.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(compressor);
  const convolver = context.createConvolver(),
    reverb = context.createGain(),
    impulse = context.createBuffer(
      2,
      Math.floor(context.sampleRate * 1.4),
      context.sampleRate,
    ),
    random = rng(7859);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < data.length; i++)
      data[i] = (random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
  }
  convolver.buffer = impulse;
  reverb.gain.value = p.reverb * 0.45;
  // Effects reconnect through the compressor, and graph parameters can change smoothly
  // during playback. Explicit disconnection releases every node when a graph is retired.
  filter.connect(convolver);
  convolver.connect(reverb);
  reverb.connect(compressor);
  return {
    input,
    analyser,
    master,
    filter,
    delay,
    wet,
    reverb,
    update(p) {
      const t = context.currentTime;
      master.gain.setTargetAtTime(p.master * 0.55, t, 0.02);
      filter.frequency.setTargetAtTime(500 + p.brightness * 14500, t, 0.025);
      delay.delayTime.setTargetAtTime((60 / p.bpm) * 0.75, t, 0.03);
      wet.gain.setTargetAtTime(p.delay * 0.38, t, 0.03);
      reverb.gain.setTargetAtTime(p.reverb * 0.45, t, 0.03);
    },
    disconnect() {
      input.disconnect();
      master.disconnect();
      analyser.disconnect();
      filter.disconnect();
      delay.disconnect();
      feedback.disconnect();
      wet.disconnect();
      convolver.disconnect();
      reverb.disconnect();
      compressor.disconnect();
    },
  };
}
export function soundNote(context, graph, n, time, secondsPerBeat, offset = 0) {
  const start = Math.max(time, context.currentTime),
    remaining = Math.max(0.008, (n.duration - offset) * secondsPerBeat),
    sound = n.sound || {},
    drum = n.brush === "Drums",
    pencil = n.brush === "Pencil";
  const shiftRatio = 2 ** ((n.pitchShift || 0) / 12);
  const basePitch = clamp(n.pitch - (n.pitchShift || 0), 0, 127);
  let duration = remaining;
  if (drum)
    duration =
      sound.drum === "open hi-hat" ? 0.42 : sound.drum === "kick" ? 0.24 : 0.15;
  // Per-note gain envelopes apply attack, sustain or pluck decay, and release. The brush
  // and drum type choose the oscillator or seeded-noise source.
  const release = drum ? 0.045 : clamp(sound.release ?? 0.18, 0.015, 2);
  const gain = context.createGain(),
    filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 350 + n.brightness * 10500;
  filter.Q.value = 0.4;
  filter.connect(gain);
  gain.connect(graph.input);
  const attack = drum
    ? 0.003
    : pencil
      ? 0.004
      : Math.max(
          0.008,
          sound.attack ?? (n.brush === "Watercolor" ? 0.2 : 0.025),
        );
  const level = n.velocity * (n.brush === "Watercolor" ? 0.5 : 0.28);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(
    level,
    start + Math.min(attack, duration * 0.45),
  );
  if (pencil) {
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, level * 0.22),
      start + duration,
    );
  } else gain.gain.setValueAtTime(level, start + duration);
  gain.gain.linearRampToValueAtTime(0, start + duration + release);
  const nodes = [];
  let source;
  const noise = drum && sound.drum !== "kick";
  if (noise) {
    source = context.createBufferSource();
    const b = context.createBuffer(
        1,
        Math.ceil((duration + release + 0.05) * context.sampleRate),
        context.sampleRate,
      ),
      data = b.getChannelData(0),
      random = rng(n.seed || 23);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
    b.getChannelData(0).set(data);
    source.buffer = b;
    filter.type = sound.drum === "snare" ? "bandpass" : "highpass";
    // Noise is filtered differently for snare and hi-hat, while pitched brushes select a
    // waveform. Kick drums use a falling oscillator frequency for their transient.
    filter.frequency.value = Math.min(
      context.sampleRate / 2,
      ((sound.drum === "snare" ? 1500 : 5200) +
        frequency(basePitch) * 0.45 +
        n.brightness * 600) *
        shiftRatio,
    );
    filter.Q.value = 0.7;
  } else {
    source = context.createOscillator();
    source.type =
      n.brush === "Bass"
        ? "sawtooth"
        : n.brush === "Marker"
          ? "triangle"
          : n.brush === "Ink"
            ? "sawtooth"
            : "sine";
    if (drum) {
      source.frequency.setValueAtTime(
        (100 + frequency(basePitch) * 0.06) * shiftRatio,
        start,
      );
      source.frequency.exponentialRampToValueAtTime(
        38 * shiftRatio,
        start + 0.17,
      );
    } else {
      const curve = n.curve || [{ beat: 0, pitch: n.pitch }];
      let initial = curve[0].pitch;
      for (let i = 0; i < curve.length; i++) {
        if (curve[i].beat <= offset) initial = curve[i].pitch;
        else {
          const previous = curve[Math.max(0, i - 1)];
          const t = clamp(
            (offset - previous.beat) / (curve[i].beat - previous.beat || 1),
          );
          initial = previous.pitch + (curve[i].pitch - previous.pitch) * t;
          break;
        }
      }
      source.frequency.setValueAtTime(frequency(initial), start);
      for (const p of curve)
        if (p.beat > offset && p.beat <= n.duration)
          // Frequency automation follows the remaining pitch curve after a seek.
          // Finished live voices disconnect, and stopped voices fade briefly to prevent
          // clicks.
          source.frequency.linearRampToValueAtTime(
            frequency(p.pitch),
            start + (p.beat - offset) * secondsPerBeat,
          );
    }
  }
  source.connect(filter);
  source.start(start);
  source.stop(start + duration + release + 0.025);
  nodes.push(source);
  source.onended = () => {
    if (typeof context.startRendering === "function") return;
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  return {
    end: start + duration + release,
    stop(t = context.currentTime) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.009);
        source.stop(t + 0.05);
      } catch {}
    },
  };
}
export function metronomeNote(context, graph, time, accent, volume) {
  return soundNote(
    context,
    graph,
    {
      duration: 0.04,
      pitch: accent ? 96 : 89,
      curve: [{ beat: 0, pitch: accent ? 96 : 89 }],
      brush: "Pencil",
      brightness: 1,
      velocity: volume,
      // Metronome notes share the synth envelope path. Transport state tracks the audio-
      // clock origin, scheduled note keys, active voices, and composition changes.
      sound: { release: 0.02 },
    },
    time,
    0.5,
  );
}

// Playback and transport
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
  const p = playbackProject();
  return JSON.stringify({
    strokes: p.strokes,
    rainClouds: p.rainClouds,
    loop: p.loop,
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
  // The transport derives beats from AudioContext time rather than animation frames.
  // Rebasing recompiles edited music and resets scheduling at the current beat.
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
  notes = timeline(playbackProject());
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
  // Play starts the scheduler from the paused beat; Pause preserves that beat and
  // silences voices. Stop also resets the playhead to the beginning.
  originTime = context.currentTime + 0.035;
  notes = timeline(playbackProject());
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
    notes = timeline(playbackProject());
    lastComposition = compositionKey();
    tick(true);
  }
  emit("seek");
}
export function seekStart() {
  // The scheduler looks ahead using audio time and stops non-looping playback at its
  // end. Generation and cycle keys prevent notes from being scheduled twice.
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
    // Metronome hits use their own scheduling keys, and the scheduled-key cache is
    // bounded. Instrument preview creates a short voice from the current brush settings.
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
        // Preview notes use the same voice implementation as composition playback. State
        // subscriptions recompile relevant edits, including audible Echo previews.
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
      notes = timeline(playbackProject());
      lastComposition = compositionKey();
      if (graph) graph.update(state.project);
    } else if (
      [
        "edit",
        "music",
        "change",
        "musical-preview",
        "tool",
        "selection",
      ].includes(type)
    ) {
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
      // Animation frames update the meter and playhead from the audio clock. Ping-pong
      // position folds the return pass back across the canvas while sound scheduling
      // stays continuous.
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
