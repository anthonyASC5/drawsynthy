import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("tests/artifacts", { recursive: true });
try {
  await page.goto("http://127.0.0.1:8080");
  await page.waitForFunction(() => window.drawSynth);
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    0,
  );
  await page.evaluate(() => window.drawSynth.actions.demo());
  await page.screenshot({ path: "tests/artifacts/desktop.png" });
  assert.equal(await page.locator("#inspector").isVisible(), false);
  const initialCanvas = await page.locator("canvas").boundingBox();
  assert.ok(initialCanvas.width >= 1440 * 0.75);
  assert.ok(initialCanvas.height >= 1000 * 0.75);
  await page.locator("#close-tools").click();
  assert.ok(
    (await page.locator("canvas").boundingBox()).width > initialCanvas.width,
  );
  await page.locator("#toggle-tools").click();
  await page.locator("#full-canvas").click();
  assert.equal(await page.locator("#toolbar").isVisible(), false);
  await page.locator("#canvas-play").click();
  assert.equal(await page.evaluate(() => window.drawSynth.state.playing), true);
  await page.locator("#canvas-pause").click();
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.playing),
    false,
  );
  await page.locator("#exit-full-canvas").click();
  assert.equal(await page.locator("#palette").isVisible(), true);
  assert.equal(await page.locator("#inspector").isVisible(), false);
  assert.equal(
    await page.getByRole("button", { name: "Smudge", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Line", exact: true }).isVisible(),
    true,
  );
  const beforeSeek = await page.evaluate(
    () => window.drawSynth.state.project.strokes.length,
  );
  const ruler = page.locator("#playhead-ruler");
  const rb = await ruler.boundingBox();
  await page.mouse.move(rb.x + rb.width * 0.25, rb.y + 12);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width * 0.5, rb.y + 12, { steps: 5 });
  await page.mouse.up();
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.drawSynth.state.position)) - 0.5,
    ) < 0.01,
  );
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.playing),
    false,
  );
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#bar-position").textContent(), "03");
  await page.locator("#toolbar [data-action=play]").click();
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => window.drawSynth.state.position > 0.5));
  await ruler.click({ position: { x: rb.width * 0.25, y: 12 } });
  assert.equal(await page.evaluate(() => window.drawSynth.state.playing), true);
  assert.ok(
    Math.abs(
      (await page.evaluate(() => window.drawSynth.state.position)) - 0.25,
    ) < 0.03,
  );
  await page.locator("#toolbar [data-action=play]").click();
  await ruler.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.position),
    1 / 16,
  );
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => window.drawSynth.state.position), 1);
  await page.locator("#toolbar [data-action=stop]").click();
  assert.equal(await page.evaluate(() => window.drawSynth.state.position), 0);
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    beforeSeek,
  );
  const count = () =>
    page.evaluate(() => window.drawSynth.state.project.strokes.length);
  const original = await count();
  assert.ok(original > 10);
  await page.locator("#toolbar [data-action=play]").click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.drawSynth.state.playing), true);
  assert.ok((await page.evaluate(() => window.drawSynth.state.position)) > 0);
  await page.locator("#bpm").fill("140");
  await page.locator("#bpm").dispatchEvent("input");
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.bpm),
    140,
  );
  await page.locator("#toolbar [data-action=stop]").click();
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, {
    steps: 20,
  });
  await page.mouse.up();
  assert.equal(await count(), original + 1);
  await page.locator("#toolbar [data-action=undo]").click();
  assert.equal(await count(), original);
  await page.locator("#toolbar [data-action=redo]").click();
  assert.equal(await count(), original + 1);
  const notesBefore = await page.evaluate(async () => {
    const { compileNotes } = await import("./js/audio.js");
    return JSON.stringify(compileNotes(window.drawSynth.state.project));
  });
  await page.locator("#paper-type").selectOption("Dark Paper");
  assert.equal(
    await page.evaluate(async () => {
      const { compileNotes } = await import("./js/audio.js");
      return JSON.stringify(compileNotes(window.drawSynth.state.project));
    }),
    notesBefore,
  );
  await page.locator("#paper-type").selectOption("Grid Paper");
  await page.locator("#settings-mobile").click();
  await page.getByRole("button", { name: "Shapes", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Shape", exact: true })
    .selectOption("Chord block");
  await page.getByRole("button", { name: "Place centered" }).click();
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.selected.size),
    3,
  );
  // Moving and resizing selected vectors changes timing and pitch coordinates.
  const selectionGeometry = () =>
    page.evaluate(() =>
      window.drawSynth.state.project.strokes
        .filter((s) => window.drawSynth.state.selected.has(s.id))
        .map((s) => s.points),
    );
  const screen = async (p) =>
    page.evaluate(async (p) => {
      const { screenPoint } = await import("./js/canvas.js");
      const q = screenPoint(p),
        r = document.querySelector("canvas").getBoundingClientRect();
      return { x: q.x + r.x, y: q.y + r.y };
    }, p);
  const initialGeometry = await selectionGeometry(),
    movePoint = await screen({ x: 0.4, y: 0.4 });
  await page.mouse.move(movePoint.x, movePoint.y);
  await page.mouse.down();
  await page.mouse.move(movePoint.x + 15, movePoint.y - 12, { steps: 5 });
  await page.mouse.up();
  const movedGeometry = await selectionGeometry();
  assert.ok(movedGeometry[0][0].x > initialGeometry[0][0].x);
  assert.ok(movedGeometry[0][0].y < initialGeometry[0][0].y);
  const corner = await screen({
    x: Math.max(...movedGeometry.flat().map((p) => p.x)),
    y: Math.max(...movedGeometry.flat().map((p) => p.y)),
  });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 25, corner.y + 15, { steps: 5 });
  await page.mouse.up();
  const resizedGeometry = await selectionGeometry();
  assert.ok(
    resizedGeometry[0][1].x - resizedGeometry[0][0].x >
      movedGeometry[0][1].x - movedGeometry[0][0].x,
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  assert.equal(await count(), original + 7);
  await page.keyboard.press("Delete");
  assert.equal(await count(), original + 4);
  // Escape rolls back an unfinished stroke.
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  const beforeCancel = await count();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 130, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await count(), beforeCancel);
  await page
    .locator("details")
    .filter({ has: page.locator("#layers") })
    .locator("summary")
    .click();
  await page.locator("#add-layer").click();
  assert.equal(await page.locator(".layer").count(), 5);
  await page.locator("#layer-options").click();
  await page.getByLabel("Layer name", { exact: true }).fill("Test layer");
  await page.getByLabel("Layer name", { exact: true }).dispatchEvent("change");
  await page.locator("#dialog-close").click();
  await page.locator("#toolbar [data-action=save]").click();
  await page.getByLabel("Project name", { exact: true }).fill("Browser test");
  await page
    .locator("#dialog-body")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.waitForTimeout(850);
  const savedProject = await page.evaluate(() =>
    window.drawSynth.validateProject(window.drawSynth.state.project),
  );
  await page.reload();
  await page.waitForFunction(() => window.drawSynth);
  const freshState = await page.evaluate(async () => {
    const { defaults } = await import("./js/state.js");
    const { state } = window.drawSynth;
    return {
      project: state.project,
      defaults: { ...defaults(), id: state.project.id },
      history: state.history,
      future: state.future,
      position: state.position,
      playing: state.playing,
      dirty: state.dirty,
    };
  });
  assert.deepEqual(freshState.project, freshState.defaults);
  assert.notEqual(freshState.project.id, savedProject.id);
  assert.deepEqual(freshState.history, []);
  assert.deepEqual(freshState.future, []);
  assert.equal(freshState.position, 0);
  assert.equal(freshState.playing, false);
  assert.equal(freshState.dirty, false);
  await page.evaluate(() => window.drawSynth.actions.open());
  await page
    .locator("#dialog-body")
    .getByRole("button", { name: "Browser test", exact: true })
    .click();
  await page.waitForFunction(
    (id) => window.drawSynth.state.project.id === id,
    savedProject.id,
  );
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.name),
    "Browser test",
  );
  assert.deepEqual(
    await page.evaluate(() => window.drawSynth.state.project.strokes),
    savedProject.strokes,
  );
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.bpm),
    savedProject.bpm,
  );
  for (const [label, ext] of [
    ["Project file", ".dsy"],
    ["MIDI notes", ".mid"],
    ["WAV audio", ".wav"],
  ]) {
    await page.locator("[data-action=export]").click();
    const download = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("button", { name: new RegExp(label) }).click();
    const file = await download;
    assert.ok(file.suggestedFilename().endsWith(ext));
    await file.saveAs("tests/artifacts/" + file.suggestedFilename());
    if (ext === ".wav") {
      const data = await readFile(
        "tests/artifacts/" + file.suggestedFilename(),
      );
      assert.ok(data.length > 100000);
      assert.ok(
        data.subarray(44).some((v) => v !== 0),
        "WAV must contain audible samples",
      );
    }
    if (await page.locator("#dialog").isVisible())
      await page.locator("#dialog-close").click();
  }
  await page.locator("[data-action=export]").click();
  await page.getByRole("button", { name: /PNG image/ }).click();
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PNG" }).click();
  assert.ok((await png).suggestedFilename().endsWith(".png"));
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 850 });
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
    await page.screenshot({ path: `tests/artifacts/mobile-${width}.png` });
    assert.ok((await page.locator("canvas").boundingBox()).height > 130);
    await page.locator("#settings-mobile").click();
    assert.equal(await page.locator("#inspector").isVisible(), true);
    await page.locator("#close-settings").click();
  }
  // Noise and effects render repeatably, without requiring a physical audio device.
  const offline = await page.evaluate(async () => {
    const { createGraph, soundNote, timeline } = await import("./js/audio.js");
    const p = window.drawSynth.state.project;
    async function render() {
      const ctx = new OfflineAudioContext(2, 22050, 44100),
        graph = createGraph(ctx, p);
      const n = {
        ...timeline(p)[0],
        brush: "Airbrush",
        start: 0,
        duration: 0.25,
        seed: 123,
      };
      soundNote(ctx, graph, n, 0, 1);
      return (await ctx.startRendering()).getChannelData(0);
    }
    const a = await render(),
      b = await render();
    return {
      same: a.every((n, i) => Math.abs(n - b[i]) < 0.000001),
      maximumDifference: a.reduce(
        (m, n, i) => Math.max(m, Math.abs(n - b[i])),
        0,
      ),
      nonzero: a.some((n) => n !== 0),
    };
  });
  console.log("Offline repeatability:", offline);
  assert.equal(offline.same, true);
  assert.equal(offline.nonzero, true);
  const touchPage = await browser.newPage({
    viewport: { width: 375, height: 850 },
    hasTouch: true,
    isMobile: true,
  });
  touchPage.on("pageerror", (e) => errors.push(e.message));
  await touchPage.goto("http://127.0.0.1:8080");
  await touchPage.waitForFunction(() => window.drawSynth);
  const tb = await touchPage.locator("canvas").boundingBox(),
    touchCount = await touchPage.evaluate(
      () => window.drawSynth.state.project.strokes.length,
    );
  await touchPage.touchscreen.tap(tb.x + 100, tb.y + 100);
  assert.equal(
    await touchPage.evaluate(
      () => window.drawSynth.state.project.strokes.length,
    ),
    touchCount + 1,
  );
  const cdp = await touchPage.context().newCDPSession(touchPage);
  const cx = tb.x + tb.width / 2,
    cy = tb.y + tb.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 30, y: cy, id: 1 },
      { x: cx + 30, y: cy, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - 70, y: cy, id: 1 },
      { x: cx + 70, y: cy, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok((await touchPage.evaluate(() => window.drawSynth.state.zoom)) > 1);
  assert.equal(
    await touchPage.evaluate(
      () => window.drawSynth.state.project.strokes.length,
    ),
    touchCount + 1,
  );
  await touchPage.close();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: drawing, undo/redo, playback, tempo, paper independence, shapes, selection, layers, fresh startup, saved project reopening, all exports, and 320/375/414/768 px layouts.",
  );
} finally {
  await browser.close();
}
