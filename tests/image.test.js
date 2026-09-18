import test from "node:test";
import assert from "node:assert/strict";
import { extractContours } from "../js/image-import.js";
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
