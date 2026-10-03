import { test, expect } from "@playwright/test";
import { disableSavePicker, exportImageFile, regionStats } from "./helpers";
import { makeBayerDng } from "./dng";

test.describe.configure({ timeout: 120_000 });

test("DNG (Bayer RAW) is decoded with LibRaw, edited and exported at full resolution", async ({ page }) => {
  await disableSavePicker(page);
  await page.goto("/");
  await page.getByTestId("edit-photo-input").setInputFiles({ name: "test.dng", mimeType: "image/x-adobe-dng", buffer: makeBayerDng(320, 240) });
  await page.waitForURL(/\/editor\?project=/, { timeout: 60_000 });
  await expect(page.getByTestId("preview-canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("output-size")).toHaveText("320 × 240 px");
  const png = await exportImageFile(page);
  const left = await regionStats(page, png, { x: 40, y: 100, w: 60, h: 40 });
  const right = await regionStats(page, png, { x: 220, y: 100, w: 60, h: 40 });
  // Demosaiced colour: red-dominant left, blue-dominant right.
  expect(left.rgb[0]).toBeGreaterThan(left.rgb[2] + 40);
  expect(right.rgb[2]).toBeGreaterThan(right.rgb[0] + 40);
  // RAW metadata from LibRaw.
  await page.getByTestId("panel-info").click();
  await expect(page.getByText(/ProStudio/).first()).toBeVisible();
});

test("an undecodable RAW reports a clear message", async ({ page }) => {
  await page.goto("/");
  const bogus = Buffer.concat([Buffer.from("FUJIFILMCCD-RAW 0201FF383501"), Buffer.alloc(2000)]);
  await page.getByTestId("edit-photo-input").setInputFiles({ name: "broken.raf", mimeType: "image/x-fuji-raf", buffer: bogus });
  await expect(page.getByText(/could not be opened by LibRaw|could not be decoded|RAW decoder/)).toBeVisible({ timeout: 60_000 });
});

test("real camera RAW (Sony ARW) decodes at full resolution with camera metadata", async ({ page }) => {
  const fs = await import("node:fs");
  const file = "tests/fixtures/example-sony.ARW";
  test.skip(!fs.existsSync(file), "Optional fixture missing (see TESTING.md).");
  test.setTimeout(240_000);
  await disableSavePicker(page);
  await page.goto("/");
  await page.getByTestId("edit-photo-input").setInputFiles(file);
  await page.waitForURL(/\/editor\?project=/, { timeout: 180_000 });
  await expect(page.getByTestId("preview-canvas")).toBeVisible({ timeout: 180_000 });
  const size = (await page.getByTestId("output-size").innerText()).match(/(\d+) × (\d+)/)!;
  const [w, h] = [Number(size[1]), Number(size[2])];
  expect(w * h).toBeGreaterThan(10e6);
  await page.getByTestId("panel-info").click();
  await expect(page.getByText(/sony/i).first()).toBeVisible();
  const { inspectImage } = await import("./helpers");
  const jpg = await (async () => {
    await page.getByTestId("open-export").click();
    const d = page.waitForEvent("download", { timeout: 200_000 });
    await page.getByTestId("export-confirm").click();
    return fs.readFileSync((await (await d).path())!);
  })();
  const info = await inspectImage(page, jpg, { x: 0, y: 0, w: 8, h: 8 });
  expect([info.width, info.height]).toEqual([w, h]);
});

test("HEIC opens via the WebAssembly decoder where the browser has no native support", async ({ page }) => {
  const fs = await import("node:fs");
  const file = "tests/fixtures/example.heic";
  test.skip(!fs.existsSync(file), "Optional fixture missing (see TESTING.md).");
  await disableSavePicker(page);
  await page.goto("/");
  await page.getByTestId("edit-photo-input").setInputFiles(file);
  await page.waitForURL(/\/editor\?project=/, { timeout: 60_000 });
  await expect(page.getByTestId("preview-canvas")).toBeVisible({ timeout: 60_000 });
  const size = (await page.getByTestId("output-size").innerText()).match(/(\d+) × (\d+)/)!;
  const png = await exportImageFile(page);
  const { inspectImage } = await import("./helpers");
  const info = await inspectImage(page, png, { x: 0, y: 0, w: 8, h: 8 });
  expect([info.width, info.height]).toEqual([Number(size[1]), Number(size[2])]);
  expect(info.width).toBeGreaterThan(500);
});
