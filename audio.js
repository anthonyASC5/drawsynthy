// Audio is compiled from vector geometry and shared project settings. Live playback and
// exports consume the same deterministic note representation.
import {
  pitchAt,
  pitches,
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
    // A Vox mark is one sustained gesture, including folds and vertical marks.
    if (stroke.brush === "Vox") segments = [stroke.points];
    // Vertical marks intersect several pitches at once: turn those into a chord.
    segments = segments.flatMap((segment) => {
      const xs = segment.map((p) => p.x),
        ys = segment.map((p) => p.y);
      if (
        !vertical ||
        Math.max(...ys) - Math.min(...ys) < 0.015 ||
        ["Bass", "Vox"].includes(stroke.brush)
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
      const duration = Math.max(
        stroke.chop
          ? end - start > 0.000001
            ? 0
            : stroke.chop.pointDuration
          : stroke.brush === "Vox"
            ? 0.03
            : minDuration,
        end - start,
      );
      // Each note combines canvas pitch, brush range, and transposition, then clamps to
      // MIDI limits. Pressure, thickness, layer gain, and opacity shape its sound.
      const pitch = (p) =>
        clamp(
          pitchAt(p.y, project, !!stroke.smudged || stroke.brush === "Vox") +
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
        ...(stroke.chop ? { chopped: true } : {}),
        color: stroke.color,
        velocity: clamp(
          (stroke.sound.volume ?? 0.65) *
            (0.3 + stroke.size / 28) *
            (0.35 + avgPressure) *
            layer.volume,
          0.008,
          0.85,
        ),
        breathiness: 1 - clamp(stroke.opacity),
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
      breathiness: 1 - clamp(stroke.opacity),
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
    return arrangeMelody(
      arrangeNotes([...notes, ...compileRainNotes(project)]),
      project,
    );
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
  return arrangeMelody(
    arrangeNotes([...result, ...compileRainNotes(project)]),
    project,
  );
}
// Turn busy artwork into a rhythmic lead and bass rather than a pile of voices.
// The original vectors remain editable; live playback, WAV, and MIDI share this pass.
function arrangeMelody(notes, project) {
  if (project.melody !== true) return notes;
  const length = project.bars * 4 * (project.pingpong ? 2 : 1);
  const result = notes.filter((n) => n.brush === "Vox" || n.chopped);
  const scale = pitches(project);
  const scaleClasses = new Set(scale.map((pitch) => pitch % 12));
  const release = Math.min(0.04, (60 / project.bpm) * 0.08);
  function sample(note, beat) {
    const curve = note.curve;
    const local = Math.max(0, beat - note.start);
    let low = 0,
      high = curve.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (curve[middle].beat <= local) low = middle;
      else high = middle - 1;
    }
    const a = curve[low],
      b = curve[Math.min(low + 1, curve.length - 1)];
    return (
      a.pitch +
      (b.pitch - a.pitch) * clamp((local - a.beat) / (b.beat - a.beat || 1))
    );
  }
  for (const bass of [false, true]) {
    const pool = notes.filter(
      (n) =>
        !n.chopped &&
        !["Drums", "Vox"].includes(n.brush) &&
        (n.brush === "Bass") === bass,
    );
    let previous = null,
      previousId = null;
    for (let start = 0; start < length; start += 0.5) {
      let chosen = null,
        best = -Infinity,
        chosenPitch = 0;
      for (const note of pool) {
        if (note.start >= start + 0.5 || note.start + note.duration <= start)
          continue;
        const drawn = sample(note, Math.max(note.start, start + 0.25));
        // Preserve the drawing's scale degree and transposition within one octave.
        const center =
          scale[Math.floor(scale.length / 2)] +
          (note.pitchShift || 0) -
          (bass ? 24 : 0);
        const bottom = Math.round(center) - 6;
        let pitch = Math.round(drawn);
        pitch = bottom + ((((pitch - bottom) % 12) + 12) % 12);
        if (project.snap) {
          const allowed = Array.from(
            { length: 12 },
            (_, i) => bottom + i,
          ).filter(
            (p) =>
              p >= 0 &&
              p <= 127 &&
              scaleClasses.has((((p - (note.pitchShift || 0)) % 12) + 12) % 12),
          );
          if (allowed.length)
            pitch = allowed.reduce((best, p) =>
              Math.abs(p - pitch) < Math.abs(best - pitch) ? p : best,
            );
        }
        pitch = clamp(pitch, 0, 127);
        const score =
          note.velocity +
          (note.id === previousId ? 0.12 : 0) -
          (previous === null ? 0 : Math.abs(pitch - previous) * 0.01);
        if (score > best) {
          best = score;
          chosen = note;
          chosenPitch = pitch;
        }
      }
      if (!chosen) {
        previous = null;
        previousId = null;
        continue;
      }
      previous = chosenPitch;
      previousId = chosen.id;
      result.push({
        ...chosen,
        id: `melody:${bass ? "bass" : "lead"}:${start}:${chosen.id}`,
        start,
        duration: Math.min(0.4, length - start),
        extent: 0,
        pitch: chosenPitch,
        curve: [{ beat: 0, pitch: chosenPitch }],
        velocity: Math.min(chosen.velocity, bass ? 0.55 : 0.5),
        sound: {
          ...chosen.sound,
          attack: Math.min(chosen.sound.attack ?? 0.012, 0.025),
          release,
        },
      });
    }
  }
  // Keep percussion, but merge repeated hits of the same kit piece on a sixteenth.
  const drums = new Map();
  for (const note of notes.filter((n) => n.brush === "Drums" && !n.chopped)) {
    const start = Math.min(length - 0.25, Math.round(note.start * 4) / 4);
    const key = `${start}:${note.sound.drum}`;
    if ((drums.get(key)?.velocity ?? -1) < note.velocity)
      drums.set(key, {
        ...note,
        id: `melody:drum:${key}`,
        start,
        duration: 0.08,
        extent: 0,
      });
  }
  return [...result, ...drums.values()].sort((a, b) => a.start - b.start);
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
// A shared, deterministic soft-clipping curve gives Ink its retro grit in both
// live playback and offline WAV rendering.
const inkDrive = Float32Array.from(
  { length: 2048 },
  (_, i) => Math.tanh(2.8 * ((2 * i) / 2047 - 1)) / Math.tanh(2.8),
);
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
  wet.gain.value = p.delay * 0.38 * (p.melody ? 0.45 : 1);
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
  reverb.gain.value = p.reverb * 0.45 * (p.melody ? 0.5 : 1);
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
      wet.gain.setTargetAtTime(p.delay * 0.38 * (p.melody ? 0.45 : 1), t, 0.03);
      reverb.gain.setTargetAtTime(
        p.reverb * 0.45 * (p.melody ? 0.5 : 1),
        t,
        0.03,
      );
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
// Parallel resonances approximate a singing vocal tract. All excitation is generated
// here: a harmonic glottal source, a low fundamental, and seeded breath noise.
export const VOWEL_FORMANTS = Object.freeze({
  Ooh: [325, 700, 2530],
  Oh: [450, 800, 2830],
  Ah: [800, 1150, 2900],
  Ay: [500, 1750, 2450],
  Ee: [270, 2290, 3010],
});
export function curvePitch(note, beat) {
  const curve = note.curve || [{ beat: 0, pitch: note.pitch }];
  let low = 0,
    high = curve.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (curve[mid].beat <= beat) low = mid;
    else high = mid - 1;
  }
  const a = curve[low],
    b = curve[Math.min(low + 1, curve.length - 1)];
  return (
    a.pitch +
    (b.pitch - a.pitch) * clamp((beat - a.beat) / (b.beat - a.beat || 1))
  );
}
function soundVox(context, graph, n, time, secondsPerBeat, offset) {
  const start = Math.max(time, context.currentTime);
  const remaining = Math.max(0.001, (n.duration - offset) * secondsPerBeat);
  const sound = n.sound || {};
  const release = n.chopped
    ? Math.min(0.008, remaining * 0.25)
    : clamp(sound.release ?? 0.18, 0.01, 2);
  const duration = n.chopped ? remaining - release : remaining;
  const attack = Math.min(
    clamp(sound.attack ?? 0.04, 0.001, 2),
    duration * 0.45,
  );
  const depth = clamp(sound.vocalDepth ?? 0.7);
  const breath = clamp(n.breathiness ?? 0.1);
  const nodes = [],
    sources = [];
  const make = (node) => {
    nodes.push(node);
    return node;
  };
  const output = make(context.createGain());
  const level = n.velocity * 0.6;
  output.gain.setValueAtTime(0, start);
  output.gain.linearRampToValueAtTime(level, start + attack);
  output.gain.setValueAtTime(level, start + duration);
  output.gain.linearRampToValueAtTime(0, start + duration + release);
  output.connect(graph.input);

  const tract = make(context.createGain());
  const glottis = make(context.createOscillator());
  glottis.type = "sawtooth";
  const voiced = make(context.createGain());
  voiced.gain.value = 0.65 * (1 - breath * 0.65);
  glottis.connect(voiced);
  voiced.connect(tract);
  const fundamental = make(context.createOscillator());
  fundamental.type = "sine";
  const body = make(context.createGain());
  body.gain.value = 0.08 + depth * 0.12;
  fundamental.connect(body);
  body.connect(output);

  const noise = make(context.createBufferSource());
  const buffer = context.createBuffer(
    1,
    context.sampleRate,
    context.sampleRate,
  );
  const data = buffer.getChannelData(0),
    random = rng(n.seed || 42);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;
  const air = make(context.createGain());
  air.gain.value = breath * 0.48;
  noise.connect(air);
  air.connect(tract);

  const vowel = VOWEL_FORMANTS[sound.vowel] || VOWEL_FORMANTS.Ooh;
  vowel.forEach((hz, i) => {
    const filter = make(context.createBiquadFilter());
    filter.type = "bandpass";
    filter.frequency.value = Math.min(
      context.sampleRate * 0.45,
      hz * clamp(sound.formant ?? 1, 0.5, 2),
    );
    filter.Q.value = [5, 8, 10][i] * (0.65 + depth * 0.7);
    const mix = make(context.createGain());
    mix.gain.value = [1.5, 0.8, 0.4][i] * (0.6 + depth * 0.6);
    tract.connect(filter);
    filter.connect(mix);
    mix.connect(output);
  });
  const vibrato = make(context.createOscillator());
  vibrato.frequency.value = clamp(sound.vibratoSpeed ?? 5, 0.1, 12);
  const vibratoGain = make(context.createGain());
  vibratoGain.gain.value = clamp(sound.vibratoAmount ?? 0.15) * 100;
  vibrato.connect(vibratoGain);
  for (const oscillator of [glottis, fundamental]) {
    vibratoGain.connect(oscillator.detune);
    oscillator.frequency.setValueAtTime(
      frequency(curvePitch(n, offset)),
      start,
    );
    for (const p of n.curve || [])
      if (p.beat > offset && p.beat <= n.duration)
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency(p.pitch),
          start + (p.beat - offset) * secondsPerBeat,
        );
  }
  // Independent left/right taps use the same BPM as the transport, with no feedback.
  const delayAmount = clamp(sound.stereoDelay ?? 0.15);
  for (const [pan, beats] of [
    [-0.8, 0.5],
    [0.8, 0.75],
  ]) {
    const delay = make(context.createDelay(2));
    delay.delayTime.value = secondsPerBeat * beats;
    const wet = make(context.createGain());
    wet.gain.value = delayAmount * 0.4;
    const panner = make(context.createStereoPanner());
    panner.pan.value = pan;
    output.connect(delay);
    delay.connect(wet);
    wet.connect(panner);
    panner.connect(graph.input);
  }
  sources.push(glottis, fundamental, noise, vibrato);
  let activeUntil = start + duration;
  const end = start + duration + release;
  sources.forEach((source) => {
    source.start(start);
    source.stop(end + 0.025);
  });
  // A silent clock source retains the delay taps until their tails have drained.
  const cleanup = context.createOscillator();
  cleanup.start(start);
  cleanup.stop(end + secondsPerBeat * 0.75 + 0.05);
  cleanup.onended = () => {
    nodes.forEach((node) => node.disconnect());
    cleanup.disconnect();
  };
  return {
    end,
    vox: true,
    setPitch(pitch, t = context.currentTime) {
      n.pitch = pitch;
      n.curve = [{ beat: 0, pitch }];
      for (const oscillator of [glottis, fundamental]) {
        oscillator.frequency.cancelScheduledValues(t);
        oscillator.frequency.setTargetAtTime(frequency(pitch), t, 0.012);
      }
    },
    activity(now) {
      if (now < start || now >= activeUntil) return null;
      return {
        vowel: sound.vowel || "Ooh",
        pitch: curvePitch(n, offset + (now - start) / secondsPerBeat),
        volume: n.velocity,
      };
    },
    stop(t = context.currentTime) {
      activeUntil = t;
      output.gain.cancelScheduledValues(t);
      output.gain.setTargetAtTime(0, t, 0.009);
      sources.forEach((source) => {
        try {
          source.stop(t + 0.05);
        } catch {}
      });
      cleanup.stop(t + secondsPerBeat * 0.75 + 0.1);
    },
  };
}
export function voxActivity() {
  if (!context) return null;
  return (
    [...voices, ...(drawingVoice ? [drawingVoice] : [])]
      .filter((v) => v.vox)
      .map((v) => v.activity(context.currentTime))
      .filter(Boolean)
      .sort((a, b) => b.volume - a.volume)[0] || null
  );
}
export function soundNote(context, graph, n, time, secondsPerBeat, offset = 0) {
  if (n.brush === "Vox")
    return soundVox(context, graph, n, time, secondsPerBeat, offset);
  const start = Math.max(time, context.currentTime),
    remaining = Math.max(0.008, (n.duration - offset) * secondsPerBeat),
    sound = n.sound || {},
    drum = n.brush === "Drums",
    pencil = n.brush === "Pencil",
    ink = n.brush === "Ink";
  const shiftRatio = 2 ** ((n.pitchShift || 0) / 12);
  const basePitch = clamp(n.pitch - (n.pitchShift || 0), 0, 127);
  let duration = remaining;
  if (drum)
    duration =
      sound.drum === "open hi-hat" ? 0.42 : sound.drum === "kick" ? 0.24 : 0.15;
  // Per-note gain envelopes apply attack, sustain or pluck decay, and release. The brush
  // and drum type choose the oscillator or seeded-noise source.
  const release = n.chopped
    ? Math.min(0.008, remaining * 0.25)
    : drum
      ? 0.045
      : clamp(sound.release ?? 0.18, 0.015, 2);
  if (n.chopped)
    duration = Math.max(0.001, Math.min(duration, remaining - release));
  const gain = context.createGain(),
    filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 350 + n.brightness * 10500;
  filter.Q.value = ink ? 1.15 : 0.4;
  if (ink) {
    const cutoff = Math.min(
      context.sampleRate * 0.45,
      900 + n.brightness * 5500,
    );
    filter.frequency.setValueAtTime(cutoff, start);
    filter.frequency.setTargetAtTime(
      Math.max(450, cutoff * 0.42),
      start + 0.018,
      0.12,
    );
  }
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
  const level =
    n.velocity * (n.brush === "Watercolor" ? 0.5 : ink ? 0.24 : 0.28);
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
  const nodes = [],
    auxiliaries = [];
  let source;
  let voiceInput = filter;
  if (ink) {
    const drive = context.createWaveShaper();
    drive.curve = inkDrive;
    drive.oversample = "2x";
    drive.connect(filter);
    voiceInput = drive;
    auxiliaries.push(drive);
  }
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
      // Two slightly detuned saws and a quiet square sub make a thick, buzzy
      // lead. All oscillators follow the same pitch curve, including after seeking.
      const oscillators = [source];
      if (ink) {
        source.detune.value = -7;
        const second = context.createOscillator(),
          sub = context.createOscillator();
        second.type = "sawtooth";
        second.detune.value = 7;
        sub.type = "square";
        sub.detune.value = -1200;
        oscillators.push(second, sub);
        oscillators.forEach((oscillator, i) => {
          const mix = context.createGain();
          mix.gain.value = i === 2 ? 0.16 : 0.42;
          oscillator.connect(mix);
          mix.connect(voiceInput);
          auxiliaries.push(mix);
        });
        nodes.push(second, sub);
      }
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
      for (const oscillator of oscillators) {
        oscillator.frequency.setValueAtTime(frequency(initial), start);
        for (const p of curve)
          if (p.beat > offset && p.beat <= n.duration)
            // Frequency automation follows the remaining pitch curve after a seek.
            // Finished live voices disconnect, and stopped voices fade briefly to prevent
            // clicks.
            oscillator.frequency.linearRampToValueAtTime(
              frequency(p.pitch),
              start + (p.beat - offset) * secondsPerBeat,
            );
      }
    }
  }
  if (!ink) source.connect(filter);
  nodes.push(source);
  for (const oscillator of nodes) {
    oscillator.start(start);
    oscillator.stop(start + duration + release + 0.025);
  }
  source.onended = () => {
    if (typeof context.startRendering === "function") return;
    for (const node of [...nodes, ...auxiliaries]) node.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  return {
    end: start + duration + release,
    setPitch(pitch, t = context.currentTime) {
      if (drum) return;
      for (const node of nodes) {
        node.frequency.cancelScheduledValues(t);
        node.frequency.setTargetAtTime(frequency(pitch), t, 0.012);
      }
    },
    stop(t = context.currentTime) {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.009);
        for (const node of nodes) node.stop(t + 0.05);
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
  restartOnPlay = false,
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
    melody: p.melody,
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
export function transportBeat() {
  return state.playing && context
    ? originBeat + ((context.currentTime - originTime) * tempo) / 60
    : pausedBeat;
}
function length() {
  return state.project.bars * 4 * (state.project.pingpong ? 2 : 1);
}
function silence() {
  stopDrawingSound();
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
  await readyAudio();
  if (restartOnPlay || (pausedBeat >= length() && !state.project.loop)) {
    pausedBeat = 0;
    state.position = 0;
  }
  restartOnPlay = false;
  tempo = state.project.bpm;
  originBeat = pausedBeat;
  // Pause keeps its visual position; the next Play restarts unless explicitly sought.
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
  restartOnPlay = true;
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
  restartOnPlay = false;
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
async function readyAudio() {
  if (!context) {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) throw Error("This browser does not support Web Audio.");
    context = new Audio();
    graph = createGraph(context, state.project);
  }
  await context.resume();
}

let drawingVoice = null,
  drawingStroke = null,
  drawingRequest = 0,
  latestDrawingNote = null,
  previewVoice = null,
  previewRequest = 0;

export function stopDrawingSound() {
  drawingRequest++;
  drawingVoice?.stop();
  drawingVoice = null;
  drawingStroke = null;
}

export async function previewDrawingSound(stroke, point) {
  // Compile one contact point so live drawing matches pitch, pressure, layer gain,
  // transposition, and mute/solo rules used by the saved stroke.
  const [note] = compileNotes(
    {
      ...state.project,
      strokes: [{ ...stroke, points: [point] }],
    },
    false,
  );
  if (!note) {
    stopDrawingSound();
    return;
  }
  latestDrawingNote = note;
  if (drawingStroke === stroke.id && stroke.brush !== "Drums") {
    drawingVoice?.setPitch(note.pitch);
    return;
  }
  stopDrawingSound();
  drawingStroke = stroke.id;
  const request = drawingRequest;
  await readyAudio();
  if (request !== drawingRequest) return;
  const liveNote = latestDrawingNote;
  drawingVoice = soundNote(
    context,
    graph,
    {
      ...liveNote,
      duration: stroke.brush === "Drums" ? liveNote.duration : 3600,
    },
    context.currentTime + 0.006,
    60 / state.project.bpm,
  );
}

export async function previewSound() {
  const request = ++previewRequest;
  await readyAudio();
  if (request !== previewRequest) return;
  previewVoice?.stop();
  voices = voices.filter((v) => v.end > context.currentTime);
  if (voices.length >= 32) voices.shift().stop();
  const brush = [
    "Ink",
    "Pencil",
    "Watercolor",
    "Marker",
    "Bass",
    "Drums",
    "Vox",
  ].includes(state.tool)
    ? state.tool
    : "Ink";
  voices.push(
    (previewVoice = soundNote(
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
        breathiness: 1 - state.brush.opacity,
        sound: state.brush,
        seed: 42,
      },
      context.currentTime + 0.01,
      60 / state.project.bpm,
    )),
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
        "layer",
        "tool",
        "selection",
      ].includes(type)
    ) {
      if (graph) graph.update(state.project);
      if (state.playing && compositionKey() !== lastComposition) rebase();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopDrawingSound();
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
