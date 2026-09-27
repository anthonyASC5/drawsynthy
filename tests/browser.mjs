import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

// Drawing, playback, project, and export browser checks
{
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
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.playing),
      true,
    );
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
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.playing),
      true,
    );
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
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.playing),
      true,
    );
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
    await page
      .getByRole("button", { name: "Ink (synth lead)", exact: true })
      .click();
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
    await page
      .getByLabel("Layer name", { exact: true })
      .dispatchEvent("change");
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
      const { createGraph, soundNote, timeline } =
        await import("./js/audio.js");
      const p = window.drawSynth.state.project;
      async function render() {
        const ctx = new OfflineAudioContext(2, 22050, 44100),
          graph = createGraph(ctx, p);
        const n = {
          ...timeline(p)[0],
          brush: "Drums",
          sound: { ...timeline(p)[0].sound, drum: "snare" },
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
    assert.ok(
      (await touchPage.evaluate(() => window.drawSynth.state.zoom)) > 1,
    );
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
}

// Image import and pitch browser checks
{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:8080");
    await page.waitForFunction(() => window.drawSynth);
    await page.locator("#settings-mobile").click();
    await page
      .locator("details")
      .filter({ has: page.locator("#sound-settings") })
      .locator("summary")
      .first()
      .click();
    const knob = page.locator("#pitch-knob");
    await knob.focus();
    await page.keyboard.press("PageUp");
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.project.pitchShift),
      12,
    );
    await knob.dblclick();
    assert.equal(await knob.getAttribute("aria-valuenow"), "0");
    await knob.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowUp");
    assert.equal(await knob.getAttribute("aria-valuenow"), "24");
    await page.locator("#toolbar [data-action=undo]").click();
    assert.equal(await knob.getAttribute("aria-valuenow"), "0");
    await page.locator("#toolbar [data-action=play]").click();
    const knobBox = await knob.boundingBox();
    const historyBefore = await page.evaluate(
      () => window.drawSynth.state.history.length,
    );
    await page.mouse.move(knobBox.x + 22, knobBox.y + 22);
    await page.mouse.down();
    await page.mouse.move(knobBox.x + 22, knobBox.y - 14, { steps: 12 });
    await page.mouse.up();
    assert.equal(await knob.getAttribute("aria-valuenow"), "12");
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      historyBefore + 1,
    );
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.playing),
      true,
    );
    await page.locator("#toolbar [data-action=undo]").click();
    assert.equal(await knob.getAttribute("aria-valuenow"), "0");
    await page.locator("#toolbar [data-action=stop]").click();
    // Generate actual raster files locally, then exercise each supported decoder.
    const images = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 80;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 160, 80);
      ctx.fillStyle = "black";
      ctx.fillRect(30, 20, 100, 40);
      return ["image/png", "image/jpeg", "image/webp"].map((type) => ({
        type,
        data: c.toDataURL(type).split(",")[1],
      }));
    });
    for (const { type, data } of images) {
      await page.locator("#import-image").click();
      await page.locator("#image-file").setInputFiles({
        name: "rectangle." + type.split("/")[1],
        mimeType: type,
        buffer: Buffer.from(data, "base64"),
      });
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.waitForFunction(() =>
        document
          .querySelector("#image-status")
          .textContent.includes("Ready to import"),
      );
      await page.getByRole("button", { name: "Import", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => window.drawSynth.state.project.layers.at(-1).name,
        ),
        "Image",
      );
      assert.ok(
        await page.evaluate(() => window.drawSynth.state.selected.size > 0),
      );
      await page
        .getByRole("button", { name: "Paint coral", exact: true })
        .click();
      assert.ok(
        await page.evaluate(() =>
          window.drawSynth.state.project.strokes
            .filter((s) => window.drawSynth.state.selected.has(s.id))
            .every((s) => s.color === "#e65661"),
        ),
      );
      await page.locator("#toolbar [data-action=play]").click();
      assert.equal(
        await page.evaluate(() => window.drawSynth.state.playing),
        true,
      );
      await page.locator("#toolbar [data-action=stop]").click();
    }
    await page.locator("#import-image").click();
    await page.locator("#image-file").setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("invalid"),
    });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#image-status")
        .textContent.includes("could not be processed"),
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Import", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    // An offline oscillator should double its zero-crossing frequency at +12.
    const ratio = await page.evaluate(async () => {
      const { defaults } = await import("./js/state.js");
      const { timeline, soundNote } = await import("./js/audio.js");
      const p = defaults();
      p.strokes = [
        {
          id: "pitch-test",
          layerId: p.layers[0].id,
          brush: "Pencil",
          size: 9,
          opacity: 0.8,
          points: [
            { x: 0, y: 0.5 },
            { x: 0.9, y: 0.5 },
          ],
          sound: { volume: 0.65, attack: 0.01, release: 0.05 },
        },
      ];
      async function render(shift) {
        p.pitchShift = shift;
        const ctx = new OfflineAudioContext(1, 44100, 44100);
        const input = ctx.createGain();
        input.connect(ctx.destination);
        soundNote(ctx, { input }, timeline(p)[0], 0, 0.1);
        const samples = (await ctx.startRendering()).getChannelData(0);
        let count = 0;
        for (let i = 4410; i < 22050; i++)
          if (samples[i - 1] < 0 && samples[i] >= 0) count++;
        return count;
      }
      return (await render(12)) / (await render(0));
    });
    assert.ok(ratio > 1.95 && ratio < 2.05);
    await page.screenshot({ path: "tests/artifacts/image-pitch.png" });
    assert.deepEqual(errors, []);
    console.log(
      "Image PNG/JPG/WebP, vector import/recolor/playback, invalid images, Pitch keyboard/reset/undo/limits, and offline octave shift passed.",
    );
  } finally {
    await browser.close();
  }
}

// Symmetry, echo, and rain browser checks
{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tool = (name) => page.locator(`#tools [data-tool="${name}"]`);
  const count = () =>
    page.evaluate(() => window.drawSynth.state.project.strokes.length);
  const cloudCount = () =>
    page.evaluate(() => window.drawSynth.state.project.rainClouds.length);
  const number = async (label, n) => {
    const input = page.getByRole("spinbutton", {
      name: `${label} value`,
      exact: true,
    });
    await input.fill(String(n));
    await input.press("Tab");
  };
  const undo = () => page.locator("#toolbar [data-action=undo]").click();
  const redo = () => page.locator("#toolbar [data-action=redo]").click();
  async function fixture() {
    await page.evaluate(async () => {
      const { defaults, loadProject, newStroke } =
        await import("./js/state.js");
      const p = defaults();
      p.bars = 1;
      p.strokes = [
        newStroke(
          [
            { x: 0.15, y: 0.55, pressure: 0.65 },
            { x: 0.85, y: 0.55, pressure: 0.65 },
          ],
          "Ink",
        ),
      ];
      loadProject(p);
    });
  }
  try {
    await page.goto("http://127.0.0.1:8080");
    await page.waitForFunction(() => window.drawSynth);
    const names = await page
      .locator("#tools button")
      .evaluateAll((buttons) => buttons.map((b) => b.dataset.tool));
    assert.deepEqual(names.slice(names.indexOf("Hand") + 1), [
      "Musical Symmetry",
      "Echo Paint",
      "Rhythm Rain",
    ]);
    for (const name of names.slice(-3)) {
      assert.ok(await tool(name).locator("svg path").count());
      assert.equal(await tool(name).locator("span").textContent(), name);
    }
    await tool("Musical Symmetry").click();
    assert.equal(await page.locator("#inspector").isVisible(), true);
    assert.equal(
      await page
        .getByRole("button", { name: "Apply Symmetry", exact: true })
        .count(),
      0,
    );
    await tool("Echo Paint").click();
    assert.equal(
      await page
        .getByRole("button", { name: "Apply Echoes", exact: true })
        .isDisabled(),
      true,
    );
    await fixture();
    await tool("Musical Symmetry").click();
    assert.equal(
      await count(),
      2,
      "mirror created without selecting or applying",
    );
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      1,
    );
    await undo();
    assert.equal(await count(), 1);
    await redo();
    assert.equal(await count(), 2);
    await page.getByLabel("Mirror mode", { exact: true }).selectOption("Both");
    await page
      .getByLabel("Destination", { exact: true })
      .selectOption("Harmony Layer");
    const box = await page.locator("#drawing").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4, {
      steps: 4,
    });
    await page.mouse.up();
    assert.equal(
      await count(),
      4,
      "settings replace mirrors instead of multiplying them",
    );
    assert.equal(
      await page.evaluate(() =>
        window.drawSynth.state.project.strokes
          .slice(1)
          .every((s) => s.layerId === "layer-1"),
      ),
      true,
    );
    const mirroredAudio = await page.evaluate(async () => {
      const { compileNotes, soundNote, createGraph } =
        await import("./js/audio.js");
      const p = structuredClone(window.drawSynth.state.project);
      p.strokes = p.strokes.slice(1);
      const ctx = new OfflineAudioContext(1, 88200, 44100),
        graph = createGraph(ctx, p);
      for (const n of compileNotes(p))
        soundNote(ctx, graph, n, (n.start * 60) / p.bpm, 60 / p.bpm);
      return (await ctx.startRendering())
        .getChannelData(0)
        .some((x) => Math.abs(x) > 1e-5);
    });
    assert.equal(
      mirroredAudio,
      true,
      "mirrored marks alone produce audible samples",
    );
    await mkdir("/tmp/draw-synth-musical", { recursive: true });
    await page.screenshot({ path: "/tmp/draw-synth-musical/symmetry.png" });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.tool),
      "Select",
    );

    await fixture();
    await page.evaluate(() => window.drawSynth.actions.selectAll());
    await tool("Echo Paint").click();
    await number("Copies", 3);
    await number("Pitch Change (semitones)", 2);
    await page
      .locator("#tool-settings")
      .getByLabel("Delay", { exact: true })
      .selectOption("0.5");
    await page.getByLabel("Separate Layer", { exact: true }).check();
    await page.screenshot({ path: "/tmp/draw-synth-musical/echo.png" });
    const expectedPreviewNotes = await page.evaluate(async () => {
      const { playbackProject } = await import("./js/state.js");
      const { timeline } = await import("./js/audio.js");
      const original = AudioContext.prototype.createOscillator;
      window.testOscillators = 0;
      window.restoreOscillators = () => {
        AudioContext.prototype.createOscillator = original;
      };
      AudioContext.prototype.createOscillator = function (...args) {
        window.testOscillators++;
        return original.apply(this, args);
      };
      return timeline(playbackProject()).length;
    });
    assert.ok(expectedPreviewNotes > 1);
    await page.locator("#toolbar [data-action=play]").click();
    await page.waitForTimeout(1450);
    assert.ok(
      (await page.evaluate(() => window.testOscillators)) >=
        expectedPreviewNotes,
      "live scheduler starts the echo preview voices before Apply",
    );
    await page.locator("#toolbar [data-action=stop]").click();
    await page.evaluate(() => window.restoreOscillators());
    await page
      .getByRole("button", { name: "Apply Echoes", exact: true })
      .click();
    assert.ok(
      (await count()) >= 4,
      "wrapped echoes can produce multiple editable pieces",
    );
    assert.equal(
      await page.evaluate(
        () => window.drawSynth.state.project.layers.at(-1).name,
      ),
      "Echo",
    );
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      1,
    );
    const echoes = await count();
    await undo();
    assert.equal(await count(), 1);
    await redo();
    assert.equal(await count(), echoes);

    await fixture();
    await tool("Rhythm Rain").click();
    assert.equal(await page.locator("#rain-strip").isVisible(), true);
    await page.locator("#drawing").click({ position: { x: 200, y: 200 } });
    assert.equal(await cloudCount(), 1);
    assert.equal(await count(), 1, "rain placement must not paint a stroke");
    await undo();
    assert.equal(await cloudCount(), 0);
    const strip = await page.locator("#rain-strip").boundingBox();
    await page.mouse.click(strip.x + strip.width * 0.4, strip.y + 20);
    assert.equal(await cloudCount(), 1);
    assert.equal(
      await page.locator('.rain-cloud[aria-pressed="true"]').count(),
      1,
    );
    const firstX = await page.evaluate(
      () => window.drawSynth.state.project.rainClouds[0].x,
    );
    const cb = await page.locator(".rain-cloud").boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2 + 100, cb.y + cb.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    assert.ok(
      (await page.evaluate(
        () => window.drawSynth.state.project.rainClouds[0].x,
      )) > firstX,
    );
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      2,
    );
    await undo();
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.project.rainClouds[0].x),
      firstX,
    );
    await redo();
    const sliderHistory = await page.evaluate(
      () => window.drawSynth.state.history.length,
    );
    const spread = await page
      .getByRole("slider", { name: "Spread (%)", exact: true })
      .boundingBox();
    await page.mouse.move(
      spread.x + spread.width * 0.2,
      spread.y + spread.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      spread.x + spread.width * 0.6,
      spread.y + spread.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      sliderHistory + 1,
    );
    await undo();
    assert.equal(
      await page.evaluate(
        () => window.drawSynth.state.project.rainClouds[0].spread,
      ),
      0.2,
    );
    await number("Rain Amount", 4);
    await number("Fall Speed", 2);
    await number("Spread (%)", 30);
    await page
      .getByLabel("Rhythm division", { exact: true })
      .selectOption("16");
    assert.equal(
      await page.evaluate(
        () => window.drawSynth.state.project.rainClouds[0].division,
      ),
      16,
    );
    await undo();
    assert.equal(
      await page.evaluate(
        () => window.drawSynth.state.project.rainClouds[0].division,
      ),
      8,
    );
    await redo();
    for (let i = 0; i < 3; i++)
      await page
        .getByRole("button", { name: "Place rain centered", exact: true })
        .click();
    assert.equal(await cloudCount(), 4);
    assert.equal(
      await page
        .getByRole("button", { name: "Place rain centered", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Remove Rain", exact: true })
      .click();
    assert.equal(await cloudCount(), 3);
    await undo();
    assert.equal(await cloudCount(), 4);
    await redo();
    assert.equal(await cloudCount(), 3);
    await page.locator(".rain-cloud").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    assert.equal(await cloudCount(), 2);
    await undo();
    assert.equal(await cloudCount(), 3);

    await page.locator("#toolbar [data-action=play]").click();
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.playing),
      true,
    );
    await page.screenshot({ path: "/tmp/draw-synth-musical/rain.png" });
    await page.locator("#toolbar [data-action=play]").click();
    const beat = await page.evaluate(async () =>
      (await import("./js/audio.js")).transportBeat(),
    );
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(async () =>
        (await import("./js/audio.js")).transportBeat(),
      ),
      beat,
    );
    await page.locator("#toolbar [data-action=stop]").click();

    const rendered = await page.evaluate(async () => {
      const { timeline, soundNote, createGraph } =
        await import("./js/audio.js");
      const { validateProject } = await import("./js/state.js");
      const p = window.drawSynth.state.project;
      const notes = timeline(p).filter((n) => n.rain);
      const render = async () => {
        const context = new OfflineAudioContext(1, 88200, 44100),
          graph = createGraph(context, p);
        for (const n of notes)
          soundNote(context, graph, n, (n.start * 60) / p.bpm, 60 / p.bpm);
        return (await context.startRendering()).getChannelData(0);
      };
      const a = await render(),
        b = await render();
      const events = (project) =>
        timeline(project).map(
          ({ id, start, duration, pitch, velocity, brush, layerId }) => ({
            id,
            start,
            duration,
            pitch,
            velocity,
            brush,
            layerId,
          }),
        );
      return {
        count: notes.length,
        audible: a.some((x) => Math.abs(x) > 1e-5),
        same: a.every((x, i) => Math.abs(x - b[i]) < 1e-6),
        roundtrip:
          JSON.stringify(
            events(validateProject(JSON.parse(JSON.stringify(p)))),
          ) === JSON.stringify(events(p)),
      };
    });
    console.log("Rain audio:", rendered);
    assert.ok(
      rendered.count > 0 &&
        rendered.audible &&
        rendered.same &&
        rendered.roundtrip,
    );
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.ok((await page.locator("canvas").boundingBox()).height > 130);
      assert.equal(await tool("Rhythm Rain").isVisible(), true);
    }
    assert.deepEqual(errors, []);
    console.log(
      "Musical tools passed: toolbar order, controls, selection gates, previews, axes, vector copies, layers, undo/redo, cloud placement/drag/limits/keyboard, pause, deterministic rain audio, responsive layouts.",
    );
  } finally {
    await browser.close();
  }
}

// Selection clipboard shortcuts and the canvas context menu.
{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const count = () =>
    page.evaluate(() => window.drawSynth.state.project.strokes.length);
  try {
    await page.goto("http://127.0.0.1:8080");
    await page.waitForFunction(() => window.drawSynth);
    const canvas = page.locator("#drawing");
    const menu = page.locator("#selection-menu");
    await canvas.click({ button: "right", position: { x: 200, y: 200 } });
    assert.equal(await menu.isVisible(), true);
    assert.equal(
      await menu
        .getByRole("menuitem", { name: "Copy", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await menu
        .getByRole("menuitem", { name: "Paste", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.drawSynth.actions.demo();
    });
    await page.waitForFunction(
      () => window.drawSynth.state.project.strokes.length > 0,
    );
    await page.evaluate(() => window.drawSynth.actions.selectAll());
    const original = await count();
    await canvas.focus();
    await page.keyboard.press("Meta+c");
    assert.equal(await count(), original);
    await page.keyboard.press("Meta+v");
    assert.equal(await count(), original * 2);
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.selected.size),
      original,
    );
    await page.keyboard.press("Meta+z");
    assert.equal(await count(), original);
    await page.keyboard.press("Meta+Shift+z");
    assert.equal(await count(), original * 2);
    await page.evaluate(() => window.drawSynth.actions.selectAll());
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    assert.equal(await count(), original * 4);
    await page.keyboard.press("Control+z");
    assert.equal(await count(), original * 2);
    // Shortcuts in editable fields keep native text behavior and never paste artwork.
    await page.locator("#bpm").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Meta+c");
    await page.keyboard.press("Meta+v");
    assert.equal(await count(), original * 2);
    await page.evaluate(() => window.drawSynth.actions.selectAll());
    await canvas.click({ button: "right", position: { x: 300, y: 200 } });
    await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
    assert.equal(await menu.isVisible(), false);
    const history = await page.evaluate(
      () => window.drawSynth.state.history.length,
    );
    await canvas.click({ button: "right", position: { x: 650, y: 450 } });
    await menu.getByRole("menuitem", { name: "Paste", exact: true }).click();
    assert.equal(await count(), original * 4);
    assert.equal(
      await page.evaluate(() => window.drawSynth.state.history.length),
      history + 1,
    );
    assert.equal(
      await page.evaluate(() =>
        window.drawSynth.state.project.strokes.every((s) =>
          s.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
        ),
      ),
      true,
    );
    await canvas.click({ button: "right", position: { x: 250, y: 200 } });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(
      await count(),
      original * 6,
      "context-menu Paste also works from the keyboard",
    );
    await canvas.click({ button: "right", position: { x: 200, y: 200 } });
    await page.keyboard.press("Escape");
    assert.equal(await menu.isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      "Copy/paste passed: Command and Control shortcuts, text input exclusion, context menu, keyboard navigation, editable vectors, and Undo/Redo.",
    );
  } finally {
    await browser.close();
  }
}
