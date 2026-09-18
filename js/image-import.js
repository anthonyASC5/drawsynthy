import { simplify } from "./tools.js";

// Marching squares detects grayscale threshold crossings and joins them into
// contours. Shared grid-edge keys keep adjacent cells connected exactly.
export function extractContours(
  data,
  width,
  height,
  { threshold = 128, invert = false, detail = 50, aspect = 1 } = {},
) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const a = data[i * 4 + 3] / 255;
    const v =
      (data[i * 4] * 0.2126 +
        data[i * 4 + 1] * 0.7152 +
        data[i * 4 + 2] * 0.0722) *
        a +
      255 * (1 - a);
    gray[i] = invert ? 255 - v : v;
  }
  const nodes = new Map(),
    links = [];
  function node(key, x, y) {
    if (!nodes.has(key)) nodes.set(key, { x, y, edges: [] });
    return nodes.get(key);
  }
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const hits = [];
      for (let e = 0; e < 4; e++) {
        const [ax, ay] = corners[e],
          [bx, by] = corners[(e + 1) % 4];
        const a = gray[ay * width + ax],
          b = gray[by * width + bx];
        if (a < threshold === b < threshold) continue;
        const t = (threshold - a) / (b - a);
        const key =
          ay === by
            ? `h${Math.min(ax, bx)},${ay}`
            : `v${ax},${Math.min(ay, by)}`;
        hits.push(node(key, ax + (bx - ax) * t, ay + (by - ay) * t));
      }
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const edge = { a: hits[i], b: hits[i + 1], used: false };
        edge.a.edges.push(edge);
        edge.b.edges.push(edge);
        links.push(edge);
      }
    }
  const imageAspect = (width - 1) / (height - 1);
  const fitW = Math.min(1, imageAspect / aspect),
    fitH = Math.min(1, aspect / imageAspect);
  const contours = [];
  function trace(start, first) {
    const points = [];
    let current = start,
      edge = first;
    while (edge && !edge.used) {
      points.push({ x: current.x, y: current.y });
      edge.used = true;
      current = edge.a === current ? edge.b : edge.a;
      edge = current.edges.find((e) => !e.used);
    }
    points.push({ x: current.x, y: current.y });
    const length = points
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y),
        0,
      );
    if (length < 3 + (100 - detail) * 0.08) return;
    const reduced = simplify(points, 0.35 + (100 - detail) * 0.025);
    contours.push(
      reduced.map((p) => ({
        x: (1 - fitW) / 2 + (p.x / (width - 1)) * fitW,
        y: (1 - fitH) / 2 + (p.y / (height - 1)) * fitH,
        pressure: 0.65,
      })),
    );
  }
  for (const n of nodes.values())
    if (n.edges.length === 1 && !n.edges[0].used) trace(n, n.edges[0]);
  for (const e of links) if (!e.used) trace(e.a, e);
  if (contours.length > 2000)
    throw Error("Too many contours. Lower Detail or adjust Edge Threshold.");
  return contours;
}

export async function processImage(file, options) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw Error("Choose a PNG, JPG, or WebP image.");
  if (file.size > 30 * 1024 * 1024)
    throw Error("Choose an image smaller than 30 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const limit = Math.round(160 + options.detail * 4);
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(bitmap.width * scale));
    canvas.height = Math.max(2, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const contours = extractContours(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
      options,
    );
    // Retain straight simplified geometry while adding handles for local smudging.
    return contours.map((points) => {
      const sampled = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const steps = Math.max(
          1,
          Math.ceil(Math.hypot((b.x - a.x) * options.aspect, b.y - a.y) / 0.01),
        );
        for (let j = 1; j <= steps; j++)
          sampled.push({
            x: a.x + ((b.x - a.x) * j) / steps,
            y: a.y + ((b.y - a.y) * j) / steps,
            pressure: 0.65,
          });
      }
      return sampled;
    });
  } catch (error) {
    throw Error(
      error.message.startsWith("Too many")
        ? error.message
        : "This image could not be processed. Try another PNG, JPG, or WebP file.",
    );
  } finally {
    bitmap?.close();
  }
}
