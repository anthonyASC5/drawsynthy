// Original event-pattern processor. Every output event is represented by an editable
// vector fragment, so the canvas, live scheduler, WAV, and MIDI share one result.
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const wrap = (n, length) => ((n % length) + length) % length;
const EPS = 1e-9;
export const GROSS_PRESETS = [
  "Half Speed",
  "Double Time",
  "Stutter",
  "Reverse",
  "Scratch",
  "Triplet Chop",
  "Gate",
  "Pulse",
  "Random Glitch",
  "Custom",
];
export const GROSS_RATES = [32, 16, 8, 4, 2, 1];
export const GROSS_ACTIONS = ["Forward", "Reverse", "Repeat", "Mute"];
export function grossDefaults() {
  return {
    preset: "Half Speed",
    rate: 8,
    speed: 0.5,
    direction: "Forward",
    gate: 0,
    repeat: 1,
    mix: 1,
    length: 1,
    seed: 1,
    keep: false,
    steps: Array.from({ length: 16 }, (_, i) => ({
      on: true,
      position: i / 16,
      action: "Forward",
    })),
  };
}
export function normalizeGross(input = {}) {
  if (!input || typeof input !== "object") input = {};
  const d = grossDefaults();
  const num = (key, min, max) =>
    Number.isFinite(input[key]) ? clamp(input[key], min, max) : d[key];
  return {
    preset: GROSS_PRESETS.includes(input.preset) ? input.preset : d.preset,
    rate: GROSS_RATES.includes(input.rate) ? input.rate : d.rate,
    speed: [0.25, 0.5, 1, 2].includes(input.speed) ? input.speed : d.speed,
    direction: ["Forward", "Reverse", "Alternating"].includes(input.direction)
      ? input.direction
      : d.direction,
    gate: num("gate", 0, 1),
    repeat: Math.round(num("repeat", 1, 8)),
    mix: num("mix", 0, 1),
    length: input.length === 2 ? 2 : 1,
    seed: Math.round(num("seed", 0, 0xffffffff)),
    keep: input.keep === true,
    steps: d.steps.map((step, i) => {
      const s = input.steps?.[i];
      return {
        on: s?.on !== false,
        position: Number.isFinite(s?.position)
          ? clamp(s.position)
          : step.position,
        action: GROSS_ACTIONS.includes(s?.action) ? s.action : step.action,
      };
    }),
  };
}
export function grossPreset(name, previous = grossDefaults()) {
  const result = {
    ...grossDefaults(),
    rate: previous.rate,
    length: previous.length,
    mix: previous.mix,
    seed: previous.seed,
    keep: previous.keep,
    steps: previous.steps,
    preset: name,
    speed: 1,
  };
  Object.assign(
    result,
    {
      "Half Speed": { speed: 0.5 },
      "Double Time": { speed: 2 },
      Stutter: { repeat: 4 },
      Reverse: { direction: "Reverse" },
      Scratch: { direction: "Alternating" },
      "Triplet Chop": { repeat: 3 },
      Gate: { gate: 0.5 },
      Pulse: { gate: 0.25 },
    }[name] || {},
  );
  return normalizeGross(result);
}
export function grossRandom(seed) {
  let value = seed >>> 0;
  return () =>
    (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296;
}
export function randomGrossSteps(options) {
  const random = grossRandom(options.seed);
  return Array.from({ length: 16 }, () => ({
    on: random() > 0.2,
    position: Math.floor(random() * 16) / 16,
    action: GROSS_ACTIONS[Math.floor(random() * 4)],
  }));
}

// A rolling two-bar buffer is addressed in beats. Windows never cross a source
// loop seam; non-looping projects read silence outside their available history.
export function grossBeatPlan(project, input) {
  const o = normalizeGross(input),
    length = project.bars * 4,
    region = o.length * 4;
  const rate = o.rate === 1 ? 4 : 4 / o.rate;
  const random = grossRandom(o.seed),
    windows = [];
  const append = (
    start,
    end,
    source,
    speed,
    reverse,
    bufferStart,
    bufferEnd,
  ) => {
    if (end - start <= EPS) return;
    let cursor = start;
    while (cursor < end - EPS) {
      const raw = reverse
        ? source - (cursor - start) * speed
        : source + (cursor - start) * speed;
      // Reverse intervals own their right endpoint; forward intervals own their left.
      const boundary = Math.floor((raw + (reverse ? -EPS : EPS)) / length);
      const available = reverse
        ? raw - boundary * length
        : (boundary + 1) * length - raw;
      const finish = Math.min(end, cursor + available / speed);
      if (finish <= cursor + EPS) break;
      const sourceA = raw - boundary * length;
      const sourceB = reverse
        ? sourceA - (finish - cursor) * speed
        : sourceA + (finish - cursor) * speed;
      const rawEnd = reverse
        ? raw - (finish - cursor) * speed
        : raw + (finish - cursor) * speed;
      if (
        (project.loop || boundary === 0) &&
        Math.min(raw, rawEnd) >= bufferStart - EPS &&
        Math.max(raw, rawEnd) <= bufferEnd + EPS
      )
        windows.push({
          start: cursor,
          end: finish,
          from: Math.min(sourceA, sourceB),
          to: Math.max(sourceA, sourceB),
          speed,
          reverse,
        });
      cursor = finish;
    }
  };
  for (let base = 0; base < length; base += region) {
    // Include this pattern region and the preceding material, bounded to two bars.
    const bufferEnd = base + region,
      bufferStart = bufferEnd - 8;
    let index = 0;
    for (
      let local = 0;
      local < Math.min(region, length - base) - EPS;
      index++
    ) {
      const stepIndex = Math.min(15, Math.floor(((local + EPS) / region) * 16));
      const stepEnd = ((stepIndex + 1) * region) / 16;
      const slotEnd = Math.min(
        Math.min(region, length - base),
        local +
          (o.preset === "Custom" && o.steps[stepIndex].action === "Repeat"
            ? rate / Math.max(2, o.repeat)
            : rate),
        o.preset === "Custom" ? stepEnd : Infinity,
      );
      let speed = o.speed,
        reverse =
          o.direction === "Reverse" ||
          (o.direction === "Alternating" && index % 2 === 1);
      let sourceLocal = local * speed,
        on = true;
      let open = 1 - o.gate;
      if (["Stutter", "Triplet Chop"].includes(o.preset)) {
        // Repeat holds a selected-rate slice; triplets fit three slices into two rates.
        const slice = o.preset === "Triplet Chop" ? (rate * 2) / 3 : rate;
        const group = slice * o.repeat;
        sourceLocal = Math.floor((local + EPS) / group) * group * speed;
      } else if (o.repeat > 1) {
        sourceLocal = Math.floor(index / o.repeat) * rate * speed;
      }
      if (o.preset === "Pulse") open *= index % 2 ? 0.45 : 1;
      if (o.preset === "Random Glitch") {
        sourceLocal = Math.floor(random() * Math.max(1, region / rate)) * rate;
        reverse = random() > 0.5;
        on = random() > 0.2;
        speed = [0.25, 0.5, 1, 2][Math.floor(random() * 4)];
      }
      if (o.preset === "Custom") {
        const step = o.steps[stepIndex];
        on = step.on && step.action !== "Mute";
        reverse = step.action === "Reverse" ? !reverse : reverse;
        const elapsed = local - (stepIndex * region) / 16;
        sourceLocal =
          bufferStart -
          base +
          step.position * (8 - rate * speed) +
          (step.action === "Repeat"
            ? wrap(elapsed, rate / Math.max(2, o.repeat))
            : elapsed) *
            speed;
      }
      let actualEnd = slotEnd;
      if (o.preset === "Triplet Chop")
        actualEnd = Math.min(slotEnd, local + (rate * 2) / 3);
      const audibleEnd = local + (actualEnd - local) * open;
      const sourceSpan = (audibleEnd - local) * speed;
      // Read-rate wrapping repeats a compressed region without leaving the buffer.
      const position =
        o.preset === "Custom"
          ? clamp(
              sourceLocal,
              bufferStart - base,
              bufferEnd - base - sourceSpan,
            )
          : wrap(sourceLocal, region);
      const source =
        base +
        (reverse && o.preset !== "Custom"
          ? region - position
          : position + (reverse ? sourceSpan : 0));
      if (on)
        append(
          base + local,
          base + audibleEnd,
          source,
          speed,
          reverse,
          bufferStart,
          bufferEnd,
        );
      local = actualEnd;
    }
  }
  return windows;
}

// Clip polylines against half-open time intervals. Endpoint interpolation preserves
// pitch and pen pressure; zero-width intersections never retrigger a boundary note.
export function sliceGrossPath(points, left, right) {
  if (points.length === 1)
    return points[0].x >= left - EPS && points[0].x < right - EPS
      ? [[{ ...points[0] }]]
      : [];
  const paths = [];
  let current = [];
  const finish = () => {
    if (current.length) paths.push(current);
    current = [];
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x;
    let low = 0,
      high = 1;
    if (Math.abs(dx) < EPS) {
      if (a.x < left - EPS || a.x >= right - EPS) {
        finish();
        continue;
      }
    } else {
      low = Math.max(0, Math.min((left - a.x) / dx, (right - a.x) / dx));
      high = Math.min(1, Math.max((left - a.x) / dx, (right - a.x) / dx));
      if (high - low <= EPS) {
        finish();
        continue;
      }
    }
    const point = (t) => ({
      ...a,
      x: a.x + dx * t,
      y: a.y + (b.y - a.y) * t,
      pressure:
        (a.pressure ?? 0.65) +
        ((b.pressure ?? 0.65) - (a.pressure ?? 0.65)) * t,
    });
    const start = point(low),
      end = point(high);
    if (
      current.length &&
      (Math.abs(current.at(-1).x - start.x) > EPS ||
        Math.abs(current.at(-1).y - start.y) > EPS)
    )
      finish();
    if (!current.length) current.push(start);
    current.push(end);
    if (high < 1 - EPS) finish();
  }
  finish();
  return paths;
}
export function grossBeatMarks(strokes, project, input) {
  const o = normalizeGross(input),
    length = project.bars * 4,
    result = [];
  let pointCount = 0;
  const add = (stroke) => {
    pointCount += stroke.points.length;
    if (result.length >= 8000 || pointCount > 400000)
      throw Error(
        "Gross Beat is too dense. Increase Rate, reduce Repeat, or select fewer strokes.",
      );
    result.push(stroke);
  };
  if (o.mix < 1)
    for (const s of strokes)
      add({
        ...structuredClone(s),
        id: `${s.id}:gross:dry`,
        opacity: s.opacity * (1 - o.mix),
        sound: { ...s.sound, volume: (s.sound.volume ?? 0.65) * (1 - o.mix) },
      });
  if (o.mix === 0) return result;
  const bounds = strokes.map((s) => ({
    s,
    left: Math.min(...s.points.map((p) => p.x)),
    right: Math.max(...s.points.map((p) => p.x)),
  }));
  const plan = grossBeatPlan(project, o);
  plan.forEach((window, index) => {
    const left = window.from / length,
      right = window.to / length;
    for (const { s, left: min, right: max } of bounds) {
      if (max < left - EPS || min >= right - EPS) continue;
      sliceGrossPath(s.points, left, right).forEach((path, part) => {
        const points = path.map((p) => ({
          ...p,
          x: clamp(
            (window.start +
              (window.reverse
                ? window.to - p.x * length
                : p.x * length - window.from) /
                window.speed) /
              length,
          ),
        }));
        let start = Math.min(...points.map((p) => p.x)) * length;
        const extent = Math.max(...points.map((p) => p.x)) * length - start;
        // A point note remains a point, with a transformed duration; lines use their
        // editable horizontal extent directly in the note compiler.
        const natural =
          s.chop?.pointDuration ??
          (s.brush === "Drums"
            ? 0.08
            : s.brush === "Pencil"
              ? 0.12
              : s.brush === "Vox"
                ? 0.03
                : 0.2);
        const pointDuration = Math.min(
          natural / window.speed,
          window.reverse && extent < EPS
            ? start - window.start
            : window.end - start,
        );
        if (window.reverse && extent < EPS) {
          for (const point of points)
            point.x = clamp(point.x - pointDuration / length);
          start -= pointDuration;
        }
        if (pointDuration <= EPS) return;
        add({
          ...s,
          id: `${s.id}:gross:${index}:${part}`,
          points,
          opacity: s.opacity * o.mix,
          sound: { ...s.sound, volume: (s.sound.volume ?? 0.65) * o.mix },
          chop: { pointDuration },
        });
      });
    }
  });
  return result;
}
