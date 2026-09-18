import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
  assert.equal(await page.evaluate(() => window.drawSynth.state.playing), true);
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
