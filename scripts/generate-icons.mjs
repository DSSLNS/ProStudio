// Renders public/icons/icon.svg to the PNG sizes the manifest needs (uses Playwright's Chromium).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, out, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const pad = maskable ? Math.round(size * 0.1) : 0;
  const bg = maskable ? "#141518" : "transparent";
  await page.setContent(
    `<html><body style="margin:0;background:${bg}"><div style="padding:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: !maskable });
}
await render(192, "public/icons/icon-192.png");
await render(512, "public/icons/icon-512.png");
await render(512, "public/icons/maskable-512.png", { maskable: true });
await render(180, "public/icons/apple-touch-icon.png", { maskable: true });
await render(32, "app/icon.png");
await browser.close();
console.log("icons generated");
