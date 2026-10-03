import type { Page } from "@playwright/test";

/** Force the download fallback (headless Chromium can't drive the native Save dialog). */
export async function disableSavePicker(page: Page) {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
}

/** Count getUserMedia calls so tests can assert the camera isn't requested prematurely. */
export async function trackGetUserMedia(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __gumCalls: number };
    w.__gumCalls = 0;
    const md = navigator.mediaDevices;
    if (!md) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      w.__gumCalls++;
      return orig(c);
    };
  });
}

/**
 * Generate a test JPEG in the browser: a colourful gradient with a mid-grey
 * patch at (100..200, 100..200). Returns the encoded bytes.
 */
export async function makeTestJpeg(page: Page, width: number, height: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h]) => {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#203060");
      g.addColorStop(0.5, "#c08040");
      g.addColorStop(1, "#40a060");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#808080";
      ctx.fillRect(100, 100, 100, 100);
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.95 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    [width, height] as const,
  );
  return Buffer.from(b64, "base64");
}

/** Decode image bytes in the page and return dimensions + mean colour of a region. */
export async function inspectImage(page: Page, bytes: Buffer, region?: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(
    async ([b64, r]) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8]));
      const reg = r ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
      const c = new OffscreenCanvas(reg.w, reg.h);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
      const d = ctx.getImageData(0, 0, reg.w, reg.h).data;
      let rs = 0,
        gs = 0,
        bs = 0,
        as = 0;
      for (let i = 0; i < d.length; i += 4) {
        rs += d[i];
        gs += d[i + 1];
        bs += d[i + 2];
        as += d[i + 3];
      }
      const n = d.length / 4;
      return { width: bmp.width, height: bmp.height, mean: [rs / n, gs / n, bs / n], alpha: as / n };
    },
    [bytes.toString("base64"), region ?? null] as const,
  );
}

export async function importImage(page: Page, bytes: Buffer, name = "test.jpg") {
  await page.goto("/");
  await page.getByTestId("edit-photo-input").setInputFiles({ name, mimeType: "image/jpeg", buffer: bytes });
  await page.waitForURL(/\/editor\?project=/);
  await page.getByTestId("preview-canvas").waitFor({ state: "visible" });
}

/** A flat-colour JPEG (predictable pixel maths for compositing tests). */
export async function makeFlatJpeg(page: Page, width: number, height: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h, c]) => {
      const cv = new OffscreenCanvas(w as number, h as number);
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = c as string;
      ctx.fillRect(0, 0, w as number, h as number);
      const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 1 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    [width, height, color] as const,
  );
  return Buffer.from(b64, "base64");
}

/** A flat-colour PNG (for adding image layers). */
export async function makeFlatPng(page: Page, width: number, height: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h, c]) => {
      const cv = new OffscreenCanvas(w as number, h as number);
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = c as string;
      ctx.fillRect(0, 0, w as number, h as number);
      const blob = await cv.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    [width, height, color] as const,
  );
  return Buffer.from(b64, "base64");
}

/** Open the export dialog, choose a format (default PNG for exact pixels) and return the file bytes. */
export async function exportImageFile(page: Page, format: "PNG" | "JPEG" = "PNG"): Promise<Buffer> {
  await page.getByTestId("open-export").click();
  const dialog = page.getByTestId("export-dialog");
  await dialog.waitFor();
  if (format === "PNG") {
    await page.getByTestId("export-format").click();
    await page.getByRole("option", { name: /PNG/ }).click();
  }
  const download = page.waitForEvent("download");
  await dialog.getByTestId("export-confirm").click();
  const d = await download;
  const fs = await import("node:fs");
  return fs.readFileSync((await d.path())!);
}

/** Two-tone JPEG: left half `left`, right half `right`. */
export async function makeSplitJpeg(page: Page, width: number, height: number, left: string, right: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h, l, r]) => {
      const cv = new OffscreenCanvas(w as number, h as number);
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = l as string;
      ctx.fillRect(0, 0, (w as number) / 2, h as number);
      ctx.fillStyle = r as string;
      ctx.fillRect((w as number) / 2, 0, (w as number) / 2, h as number);
      const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 1 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    [width, height, left, right] as const,
  );
  return Buffer.from(b64, "base64");
}

/** Drag on the displayed image between two points given as fractions of its size. */
export async function dragOnImage(page: Page, x0: number, y0: number, x1: number, y1: number, modifiers: ("Shift" | "Alt")[] = []) {
  const box = (await page.getByTestId("preview-canvas").boundingBox())!;
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (x0 + ((x1 - x0) * i) / 10), box.y + box.height * (y0 + ((y1 - y0) * i) / 10));
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

export async function clickOnImage(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("preview-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

export type SceneCmd =
  | { fill: string; rect: [number, number, number, number] }
  | { fill: string; circle: [number, number, number] }
  | { checker: [number, number, number, number, number]; a: string; b: string }
  | { specks: number; color: string }
  | { blur: number }
  | { noise: number };

/** Lossless PNG scene drawn from simple JSON commands (no eval — the app's CSP forbids it). */
export async function makeScene(page: Page, width: number, height: number, background: string, cmds: SceneCmd[]): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ([w, h, bg, list]) => {
      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      for (const c of list as Record<string, unknown>[]) {
        if ("rect" in c) {
          ctx.fillStyle = c.fill as string;
          const [x, y, rw, rh] = c.rect as number[];
          ctx.fillRect(x, y, rw, rh);
        } else if ("circle" in c) {
          ctx.fillStyle = c.fill as string;
          const [cx, cy, r] = c.circle as number[];
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        } else if ("checker" in c) {
          const [x, y, cw, ch, cell] = c.checker as number[];
          for (let yy = y; yy < y + ch; yy += cell)
            for (let xx = x; xx < x + cw; xx += cell) {
              ctx.fillStyle = ((xx - x) / cell + (yy - y) / cell) % 2 === 0 ? (c.a as string) : (c.b as string);
              ctx.fillRect(xx, yy, cell, cell);
            }
        } else if ("specks" in c) {
          ctx.fillStyle = c.color as string;
          for (let i = 0; i < (c.specks as number); i++) ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 2, 2);
        } else if ("noise" in c) {
          // Additive Gaussian noise (Box–Muller), sigma in 0..255 units.
          const img = ctx.getImageData(0, 0, w, h);
          for (let i = 0; i < img.data.length; i += 4) {
            const g = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()) * (c.noise as number);
            for (let k = 0; k < 3; k++) img.data[i + k] = img.data[i + k] + g;
          }
          ctx.putImageData(img, 0, 0);
        } else if ("blur" in c) {
          const t = new OffscreenCanvas(w, h);
          const tc = t.getContext("2d")!;
          tc.filter = `blur(${c.blur}px)`;
          tc.drawImage(cv, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(t, 0, 0);
        }
      }
      const blob = await cv.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    [width, height, background, cmds] as const,
  );
  return Buffer.from(b64, "base64");
}

/** Mean and standard deviation of luma in a region of an encoded image. */
export async function regionStats(page: Page, bytes: Buffer, r: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(
    async ([b64, reg]) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8]));
      const c = new OffscreenCanvas(reg.w, reg.h);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, reg.x, reg.y, reg.w, reg.h, 0, 0, reg.w, reg.h);
      const d = ctx.getImageData(0, 0, reg.w, reg.h).data;
      const ys: number[] = [];
      let rs = 0, gs = 0, bs = 0;
      for (let i = 0; i < d.length; i += 4) {
        ys.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
        rs += d[i];
        gs += d[i + 1];
        bs += d[i + 2];
      }
      const n = ys.length;
      const mean = ys.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      return { mean, std, min: Math.min(...ys), rgb: [rs / n, gs / n, bs / n] };
    },
    [bytes.toString("base64"), r] as const,
  );
}
