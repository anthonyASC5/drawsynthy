import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.audioEvents = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this);
      for (const method of ["start", "stop"]) {
        const original = oscillator[method].bind(oscillator);
        oscillator[method] = (...args) => {
          window.audioEvents.push({
            method,
            pitch: oscillator.frequency.value,
          });
          return original(...args);
        };
      }
      const target = oscillator.frequency.setTargetAtTime.bind(
        oscillator.frequency,
      );
      oscillator.frequency.setTargetAtTime = (pitch, ...args) => {
        window.audioEvents.push({ method: "pitch", pitch });
        return target(pitch, ...args);
      };
      return oscillator;
    };
  });
  await page.goto("http://127.0.0.1:8080");
  await page.waitForFunction(() => window.drawSynth);
  const starts = () =>
    page.evaluate(() => audioEvents.filter((e) => e.method === "start").length);
  for (const brush of [
    "Pencil",
    "Ink",
    "Watercolor",
    "Marker",
    "Bass",
    "Drums",
    "Vox",
  ]) {
    const before = await starts();
    await page.locator(`[data-tool="${brush}"]`).click();
    await page.waitForFunction(
      (n) => audioEvents.filter((e) => e.method === "start").length > n,
      before,
    );
  }
  await page.locator('[data-tool="Pencil"]').click();
  const box = await page.locator("#drawing").boundingBox();
  const before = await starts();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.waitForFunction(
    (n) => audioEvents.filter((e) => e.method === "start").length > n,
    before,
  );
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.25, {
    steps: 10,
  });
  const pitches = await page.evaluate(() =>
    audioEvents.filter((e) => e.method === "pitch").map((e) => e.pitch),
  );
  assert.ok(pitches.at(-1) > pitches[0], "drawing higher raises live pitch");
  const stops = await page.evaluate(
    () => audioEvents.filter((e) => e.method === "stop").length,
  );
  await page.mouse.up();
  assert.ok(
    (await page.evaluate(
      () => audioEvents.filter((e) => e.method === "stop").length,
    )) > stops,
    "release stops the drawing voice",
  );
  await page.locator('[data-tool="Select"]').click();
  const editing = await starts();
  await page.locator("#drawing").click({ position: { x: 200, y: 200 } });
  assert.equal(await starts(), editing, "editing tools stay silent");
  const transport = await page.evaluate(async () => {
    const audio = await import("/audio.js");
    audio.seek(0.5);
    await audio.play();
    const sought = audio.transportBeat();
    audio.pause();
    const paused = audio.transportBeat();
    await audio.play();
    const restarted = audio.transportBeat();
    audio.pause();
    audio.seek(0.25);
    await audio.play();
    const explicitSeek = audio.transportBeat();
    audio.stop();
    return {
      sought,
      paused,
      restarted,
      explicitSeek,
      beats: window.drawSynth.state.project.bars * 4,
    };
  });
  assert.ok(Math.abs(transport.sought - transport.beats / 2) < 0.2);
  assert.ok(transport.paused > transport.beats / 2 - 0.2);
  assert.ok(Math.abs(transport.restarted) < 0.2, "Play after Pause restarts");
  assert.ok(
    Math.abs(transport.explicitSeek - transport.beats / 4) < 0.2,
    "explicit paused seek is honored",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Live audio passed: all brush previews, drawing pitch, release, silent editing, restart after pause, and explicit seeking.",
  );
} finally {
  await browser.close();
}
