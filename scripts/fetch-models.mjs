// Downloads the optional AI models into public/models/<id>/ and verifies SHA-256.
// Usage: npm run models            (all)
//        npm run models -- u2netp  (some)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

const manifest = JSON.parse(readFileSync("ai/models.json", "utf8"));
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const ids = wanted.length ? wanted : Object.keys(manifest);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const id of ids) {
  const m = manifest[id];
  if (!m) throw new Error(`Unknown model id: ${id}`);
  const dir = join("public/models", id);
  mkdirSync(dir, { recursive: true });
  const missing = m.files.filter((f) => {
    const p = join(dir, f.name);
    return !existsSync(p) || sha(readFileSync(p)) !== f.sha256;
  });
  if (!missing.length) {
    console.log(`✓ ${id} already installed`);
    continue;
  }
  console.log(`↓ ${id} — ${m.name} (${m.license})`);
  const archive = m.archive ? unzipSync(new Uint8Array(await download(m.archive))) : null;
  for (const f of missing) {
    const data = archive ? Buffer.from(archive[f.archivePath] ?? []) : await download(f.url);
    const got = sha(data);
    if (got !== f.sha256) throw new Error(`Checksum mismatch for ${id}/${f.name}: ${got}`);
    writeFileSync(join(dir, f.name), data);
    console.log(`  ✓ ${f.name} (${(data.length / 1e6).toFixed(1)} MB, sha256 ok)`);
  }
}
