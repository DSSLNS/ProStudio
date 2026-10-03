import { test, expect } from "@playwright/test";

test("web app manifest is valid", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toContain("ProStudio");
  expect(m.short_name).toBe("ProStudio");
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/");
  expect(m.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  expect(m.shortcuts.length).toBeGreaterThanOrEqual(2);
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("service worker installs and the app shell works offline", async ({ page, context, browserName }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Reload so the page is controlled by the service worker and all assets are cached.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.goto("/editor");
  await page.goto("/");
  // Playwright's WebKit cannot reload while offline under a service worker ("internal error");
  // the SW install/control above is still verified there. Offline reload is checked in Chromium.
  test.skip(browserName === "webkit", "Offline reload is not supported by Playwright's WebKit build.");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "PROSTUDIO" })).toBeVisible();
  await expect(page.getByText(/Offline — local editing/)).toBeVisible();
  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "Edit a photo" })).toBeVisible();
  await context.setOffline(false);
});
