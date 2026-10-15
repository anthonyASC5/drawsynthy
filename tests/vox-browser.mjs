import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:8080");
  await page.waitForFunction(() => window.drawSynth);
  await page.locator('[data-tool="Vox"]').click();
  await page.locator("#settings-mobile").click();
  assert.equal(await page.locator(".vox-singer").isVisible(), true);
  for (const name of [
    "Formant",
    "Vocal Depth",
    "Vibrato Amount",
    "Vibrato Speed",
    "Attack",
    "Release",
    "Volume",
    "Stereo Delay",
  ])
    assert.equal(
      await page.getByRole("slider", { name, exact: true }).count(),
      1,
    );
  const mouth = page.locator(".vox-mouth");
  await page.getByLabel("Vowel", { exact: true }).selectOption("Ee");
  await page.waitForTimeout(50);
  assert.equal(Number(await mouth.getAttribute("rx")), 8.8);
  await page.getByLabel("Vowel", { exact: true }).selectOption("Ah");
  await page.locator("#settings-mobile").click();
  // Draw through the real pointer path, then exercise the shared transport.
  const canvas = await page.locator("#drawing").boundingBox();
  await page.mouse.move(
    canvas.x + canvas.width * 0.2,
    canvas.y + canvas.height * 0.6,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width * 0.7,
    canvas.y + canvas.height * 0.3,
    { steps: 30 },
  );
  await page.mouse.up();
  assert.equal(
    await page.evaluate(() => window.drawSynth.state.project.strokes[0].brush),
    "Vox",
  );
  await page.evaluate(async () => {
    const { seek, play } = await import("/audio.js");
    seek(0.4);
    await play();
  });
  await page.waitForTimeout(150);
  const activity = await page.evaluate(async () =>
    (await import("/audio.js")).voxActivity(),
  );
  assert.equal(activity.vowel, "Ah");
  assert.ok(Number.isFinite(activity.pitch));
  // Change the actual Properties controls while crossing the existing line.
  await page.locator("#settings-mobile").click();
  await page.getByLabel("Vowel", { exact: true }).selectOption("Ee");
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(
      async () => (await import("/audio.js")).voxActivity()?.vowel,
    ),
    "Ee",
  );
  for (const [label, key, value, scale] of [
    ["Formant", "formant", 1.6, 1],
    ["Vocal Depth", "vocalDepth", 90, 100],
    ["Vibrato Amount", "vibratoAmount", 70, 100],
    ["Vibrato Speed", "vibratoSpeed", 8, 1],
    ["Attack", "attack", 0.15, 1],
    ["Release", "release", 0.5, 1],
    ["Volume", "volume", 45, 100],
    ["Stereo Delay", "stereoDelay", 60, 100],
  ]) {
    await page
      .getByRole("slider", { name: label, exact: true })
      .evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    assert.equal(
      await page.evaluate(
        (key) => window.drawSynth.state.project.strokes[0].sound[key],
        key,
      ),
      value / scale,
    );
  }
  await page.locator("#settings-mobile").click();
  await page.evaluate(() => window.drawSynth.actions.pause());
  assert.equal(
    await page.evaluate(async () => (await import("/audio.js")).voxActivity()),
    null,
  );
  await page.locator("#settings-mobile").click();
  await mkdir("tests/artifacts", { recursive: true });
  await page.waitForTimeout(100);
  await page.screenshot({ path: "tests/artifacts/vox.png" });
  await page.locator('[data-tool="Ink"]').click();
  assert.equal(await page.locator(".vox-singer").count(), 0);
  // Exercise the real save and download paths with the painted Vox mark.
  await page.evaluate(async () => {
    const { state, saveProject, listProjects, validateProject } =
      await import("/state.js");
    await saveProject(state.project);
    const saved = (await listProjects()).find((p) => p.id === state.project.id);
    if (validateProject(saved).strokes[0].brush !== "Vox")
      throw Error("Vox save lost its brush");
  });
  for (const [fn, extension] of [
    ["exportWAV", ".wav"],
    ["exportMIDI", ".mid"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(async (fn) => (await import("/canvas.js"))[fn](), fn);
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith(extension));
    assert.equal(await download.failure(), null);
  }
  const rendered = await page.evaluate(async () => {
    const { soundNote } = await import("/audio.js");
    async function render(vowel, breathiness = 0.1, offset = 0) {
      const context = new OfflineAudioContext(2, 44100, 44100);
      const input = context.createGain();
      input.connect(context.destination);
      const voice = soundNote(
        context,
        { input },
        {
          brush: "Vox",
          duration: 0.5,
          velocity: 0.5,
          breathiness,
          pitch: 55,
          curve: [
            { beat: 0, pitch: 55 },
            { beat: 0.5, pitch: 67 },
          ],
          sound: {
            vowel,
            formant: 1,
            vocalDepth: 0.7,
            attack: 0.02,
            release: 0.15,
            stereoDelay: 0.5,
          },
        },
        0,
        1,
        offset,
      );
      const seekPitch = voice.activity(0)?.pitch;
      const buffer = await context.startRendering();
      const left = buffer.getChannelData(0),
        right = buffer.getChannelData(1);
      let energy = 0,
        tail = 0,
        stereo = 0;
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i])) throw Error("Nonfinite Vox sample");
        energy += left[i] ** 2;
        if (i > 23000 && i < 28000) tail += left[i] ** 2;
        stereo += Math.abs(left[i] - right[i]);
      }
      return {
        energy,
        tail,
        stereo,
        seekPitch,
        samples: Array.from(left.slice(5000, 5010)),
      };
    }
    return {
      ah: await render("Ah"),
      ee: await render("Ee"),
      breath: await render("Ah", 0.9),
      seek: await render("Ooh", 0.1, 0.25),
    };
  });
  assert.ok(rendered.ah.energy > 0.001);
  assert.ok(rendered.ah.tail > 0);
  assert.ok(rendered.ah.stereo > 0);
  assert.notDeepEqual(rendered.ah.samples, rendered.ee.samples);
  assert.notDeepEqual(rendered.ah.samples, rendered.breath.samples);
  assert.equal(rendered.seek.seekPitch, 61);
  assert.deepEqual(errors, []);
  console.log(
    "Vox browser checks passed: controls, drawing, singer, transport, seek, offline voice, vowels, breath, release, stereo.",
  );
} finally {
  await browser.close();
}
