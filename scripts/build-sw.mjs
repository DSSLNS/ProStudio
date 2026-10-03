// Stamps a unique cache version into the service worker so each deploy gets fresh caches.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = `${pkg.version}-${Date.now().toString(36)}`;
const template = readFileSync(join(root, "scripts/sw.template.js"), "utf8");
writeFileSync(join(root, "public/sw.js"), template.replace("__BUILD_VERSION__", version));
console.log(`[build-sw] public/sw.js stamped with version ${version}`);
