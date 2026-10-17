import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const panel = page.locator("#tool-settings");
  const control = (name) => panel.getByLabel(name, { exact: true });
  const button = (name) => panel.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:8080");
  await page.waitForFunction(() => window.drawSynth);
  const tools = await page
    .locator("#tools [data-tool]")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.tool));
  assert.equal(tools[tools.indexOf("Vox") + 1], "Gross Beat");
  await page.locator('[data-tool="Gross Beat"]').click();
  assert.ok(
    (await panel.textContent()).includes("Select drawing or choose a layer."),
  );
  assert.equal(await button("Apply").isDisabled(), true);
  assert.equal(await panel.locator(".gross-step").count(), 16);
  const fixture = async () =>
    page.evaluate(async () => {
      const s = await import("/state.js");
      const p = s.defaults();
      p.bars = 2;
      p.strokes = [
        {
          ...s.newStroke(
            [
              { x: 0, y: 0.7 },
              { x: 0.0625, y: 0.3 },
            ],
            "Marker",
          ),
          id: "source",
          layerId: p.layers[0].id,
        },
        {
          ...s.newStroke([{ x: 0.25, y: 0.6 }], "Pencil"),
          id: "other",
          layerId: p.layers[1].id,
        },
      ];
      s.loadProject(p);
      s.grossEditor.target = "auto";
      s.updateGrossBeat();
      s.emit("selection");
    });
  await fixture();
  assert.equal(await control("Preset").locator("option").count(), 10);
  for (const preset of [
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
  ]) {
    await control("Preset").selectOption(preset);
    const preview = await page.evaluate(async () => {
      const s = await import("/state.js");
      return {
        count: s.grossPreview().marks.length,
        history: s.state.history.length,
        saved: s.state.project.strokes.length,
      };
    });
    assert.equal(preview.saved, 2);
    assert.equal(preview.history, 0);
  }
  await control("Preset").selectOption("Stutter");
  await button("Preview").click();
  assert.equal(await page.evaluate(() => window.drawSynth.state.playing), true);
  await page.evaluate(() => window.drawSynth.actions.stop());
  await button("Apply").click();
  const applied = await page.evaluate(() =>
    JSON.parse(JSON.stringify(window.drawSynth.state.project)),
  );
  assert.equal(applied.grossBeatEffects.length, 1);
  assert.equal(applied.strokes.length, 5);
  assert.equal(applied.grossBeatEffects[0].source[0].id, "source");
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.history.length),
    1,
  );
  await page.evaluate(() => window.drawSynth.actions.undo());
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    2,
  );
  await page.evaluate(() => window.drawSynth.actions.redo());
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    5,
  );
  // Exercise actual JSON export and project validation/opening.
  const download = page.waitForEvent("download");
  await page.evaluate(async () => (await import("/canvas.js")).exportJSON());
  const file = await download;
  const exported = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(exported.grossBeatEffects[0].settings.preset, "Stutter");
  await page.evaluate(async (data) => {
    const s = await import("/state.js");
    s.loadProject(s.validateProject(data));
  }, exported);
  await button("Remove Effect").click();
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    2,
  );
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.history.length),
    1,
  );
  await page.evaluate(() => window.drawSynth.actions.undo());
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes.length),
    5,
  );
  // Grid interactions use mouse, context menu, keyboard, dropdown, and drag paths.
  await fixture();
  await button("Clear").click();
  assert.equal(
    await panel.locator('.gross-step[aria-pressed="false"]').count(),
    16,
  );
  await panel.locator('[data-step="0"]').click();
  assert.equal(await control("Preset").inputValue(), "Custom");
  assert.equal(
    await panel.locator('[data-step="0"]').getAttribute("aria-pressed"),
    "true",
  );
  await control("Step action").selectOption("Repeat");
  await panel.locator('[data-step="0"]').click({ button: "right" });
  assert.equal(await control("Step action").inputValue(), "Mute");
  await panel.locator('[data-step="0"]').focus();
  await page.keyboard.press("ArrowUp");
  assert.ok(
    Number(await control("Playback position (%) value").inputValue()) > 0,
  );
  const cell = panel.locator('[data-step="1"]');
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 35, { steps: 5 });
  await page.mouse.up();
  assert.ok(
    await page.evaluate(
      async () => (await import("/state.js")).grossBeat.steps[1].position > 0.3,
    ),
  );
  await button("Randomize").click();
  const firstSeed = Number(await control("Seed").inputValue());
  await button("Regenerate Seed").click();
  assert.equal(Number(await control("Seed").inputValue()), firstSeed + 1);
  await button("Reset").click();
  assert.equal(await control("Preset").inputValue(), "Half Speed");
  assert.equal(
    await page.evaluate(
      async () => (await import("/state.js")).grossEditor.preview,
    ),
    false,
  );
  // Select-only processing excludes all other marks; Keep Original retains source.
  await control("Process").selectOption("selection");
  assert.equal(await button("Apply").isDisabled(), true);
  await page.evaluate(async () => {
    const s = await import("/state.js");
    s.state.selected = new Set(["other"]);
    s.emit("selection");
  });
  await control("Preset").selectOption("Reverse");
  await control("Keep Original").check();
  await button("Apply").click();
  assert.equal(
    await page.evaluate(
      () =>
        window.drawSynth.state.project.strokes.filter((s) => s.id === "other")
          .length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(
      () => window.drawSynth.state.project.grossBeatEffects[0].source[0].id,
    ),
    "other",
  );
  // Original vectors remain editable through existing Select/Move/Delete/history paths.
  await page.locator('[data-tool="Select"]').click();
  await button("Delete").click();
  await page.evaluate(() => window.drawSynth.actions.undo());
  await page.locator('[data-tool="Gross Beat"]').click();
  await button("Remove Effect").click();
  // Render the exact same note timeline twice, and measure the actual gate gap.
  const audio = await page.evaluate(async () => {
    const { defaults, newStroke } = await import("/state.js");
    const { grossBeatMarks, grossPreset } = await import("/grossbeat.js");
    const { timeline, createGraph, soundNote } = await import("/audio.js");
    const p = defaults();
    p.bars = 1;
    p.delay = p.reverb = 0;
    const source = {
      ...newStroke(
        [
          { x: 0, y: 0.5 },
          { x: 1, y: 0.5 },
        ],
        "Marker",
      ),
      id: "audio-source",
      layerId: p.layers[0].id,
    };
    p.strokes = grossBeatMarks([source], p, grossPreset("Gate"));
    const notes = timeline(p),
      spb = 60 / p.bpm,
      rate = 24000;
    const render = async () => {
      const c = new OfflineAudioContext(2, rate, rate),
        graph = createGraph(c, p);
      for (const n of notes)
        if (n.start * spb < 1) soundNote(c, graph, n, n.start * spb, spb);
      return (await c.startRendering()).getChannelData(0);
    };
    const a = await render(),
      b = await render();
    const energy = (start, end) =>
      a
        .slice(Math.floor(start * rate), Math.floor(end * rate))
        .reduce((n, v) => n + v * v, 0);
    const altered = timeline({ ...p, bpm: 185 });
    return {
      audible: energy(0.03, 0.1),
      gap: energy(0.18, 0.24),
      same: a.every((v, i) => v === b[i]),
      beatStable: JSON.stringify(notes) === JSON.stringify(altered),
    };
  });
  assert.ok(audio.audible > 0.00001);
  assert.ok(audio.gap < audio.audible * 0.001, JSON.stringify(audio));
  assert.ok(audio.same && audio.beatStable);
  await mkdir("tests/artifacts", { recursive: true });
  await control("Preset").selectOption("Custom");
  await panel.locator(".gross-grid").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "tests/artifacts/gross-beat-desktop.png" });
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.equal(
      await page.locator('[data-tool="Gross Beat"]').isVisible(),
      true,
    );
    assert.equal(await panel.locator(".gross-step").count(), 16);
  }
  await page.screenshot({ path: "tests/artifacts/gross-beat-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Gross Beat browser checks passed: tool order, presets, layer/selection scope, preview, Apply/Remove, Undo/Redo, JSON round-trip, step interactions, editable output, deterministic audio, gate silence, BPM changes, responsive layouts.",
  );
} finally {
  await browser.close();
}
