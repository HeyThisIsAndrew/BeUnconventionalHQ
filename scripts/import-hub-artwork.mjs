#!/usr/bin/env node
/*
  IMPORT A FOLDER OF HUB ARTWORK IN ONE GO.

  Point it at a directory of per-brand folders and it uploads every image to
  Sanity (the asset host every existing hub already uses) and writes the refs
  into src/data/videos.json. It is the Local CMS's per-hub, per-image flow done
  in a single pass, and unlike that flow it can be re-run.

    node scripts/import-hub-artwork.mjs "~/Downloads/Featured Brands"
    node scripts/import-hub-artwork.mjs "~/Downloads/Featured Brands" --execute

  Dry-run by default, like scripts/sync-youtube.mjs: it prints the folder to
  hub match and the role it would give each file, and touches nothing until
  --execute. Needs SANITY_WRITE_TOKEN in .env, same as the CMS's own uploader.

  It only ever FILLS the three artwork fields. It never deletes a hub, never
  edits copy, colour or keywords, and by default never overwrites artwork a
  hub already has (pass --replace for that).
*/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@sanity/client';

const SANITY_PROJECT_ID = 'nqnrjfqu';
const SANITY_DATASET = 'production';
const DATA = path.resolve(process.cwd(), 'src/data/videos.json');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/* Recommended minimums. Under these the art shows its own pixels on a 3x
   phone, which is the whole reason the hubs looked unfinished. */
const MIN_LOGO = 512;
const MIN_HERO_W = 1920;

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const replace = args.includes('--replace');
const root = args.find((a) => !a.startsWith('--'));

if (!root) {
  console.error('Usage: node scripts/import-hub-artwork.mjs "<folder>" [--execute] [--replace]');
  process.exit(1);
}
const dir = path.resolve(root.replace(/^~(?=$|\/)/, os.homedir()));
if (!fs.existsSync(dir)) {
  console.error(`No such folder: ${dir}`);
  process.exit(1);
}

/* ── Reading a size without an image library ───────────────────────────────
   Enough of each header to get width and height. Used for the dry run and to
   decide which file is the mark and which is the key art; after upload the
   ref itself carries the real dimensions. */
function imageSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(65536);
  const read = fs.readSync(fd, buf, 0, 65536, 0);
  fs.closeSync(fd);
  const b = buf.subarray(0, read);

  // PNG: IHDR is always first.
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  // WebP (VP8X / VP8 / VP8L).
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: walk the segments to the first frame header.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ── Matching a folder name to a hub ──────────────────────────────────────
   Loose on purpose: "HBO Max", "hbo-max" and "hbomax" are the same folder to
   a person. Anything that does NOT match is reported, never guessed at. */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const docs = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
const hubs = docs.filter((d) => d._type === 'featuredBrand' && d.slug?.current);

/* Folder names a person would plausibly use that no rule below would catch. */
const ALIASES = { max: 'hbo-max', hbo: 'hbo-max', wb: 'warner-bros', ps: 'playstation' };

function findHub(folder) {
  const n = norm(folder);
  const bySlug = (slug) => hubs.find((h) => h.slug.current === slug);

  if (ALIASES[n]) return bySlug(ALIASES[n]) ?? null;

  const exact =
    hubs.find((h) => norm(h.slug.current) === n) || hubs.find((h) => norm(h.title) === n);
  if (exact) return exact;

  /*
    A prefix match only counts when it is UNAMBIGUOUS. "Disney+" -> disney-plus
    is obvious and useful; a two-letter folder that fits three hubs is a coin
    flip, and putting the wrong brand's art on a hub is worse than reporting it
    and letting a person say which.
  */
  if (n.length < 3) return null;
  const near = hubs.filter(
    (h) => norm(h.slug.current).startsWith(n) || n.startsWith(norm(h.slug.current)),
  );
  return near.length === 1 ? near[0] : null;
}

/* ── Which file is which ──────────────────────────────────────────────────
   The filename wins when it says so. Otherwise shape decides: a mark is
   roughly square or taller than wide, key art is wide. */
function roleOf(file, size) {
  const n = path.basename(file).toLowerCase();
  if (/backdrop|plate/.test(n)) return 'backdrop';
  if (/logo|mark|wordmark|icon/.test(n)) return 'logo';
  if (/hero|key ?art|keyart|banner|cover|still/.test(n)) return 'heroImage';
  if (!size) return null;
  return size.w / size.h >= 1.4 ? 'heroImage' : 'logo';
}

const folders = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();

if (!folders.length) {
  console.error(`No brand folders inside ${dir}`);
  process.exit(1);
}

console.log(`\n${execute ? 'IMPORTING' : 'DRY RUN'} from ${dir}`);
console.log(`${folders.length} folder(s), ${hubs.length} hubs in videos.json\n`);

const plan = [];
const unmatched = [];
const warnings = [];

for (const folder of folders) {
  const hub = findHub(folder);
  if (!hub) { unmatched.push(folder); continue; }

  const files = fs
    .readdirSync(path.join(dir, folder), { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith('.'))
    .map((e) => path.join(dir, folder, e.name));

  if (!files.length) { warnings.push(`${folder}: no images`); continue; }

  const picks = {};
  for (const file of files) {
    const size = imageSize(file);
    const role = roleOf(file, size);
    if (!role) { warnings.push(`${folder}/${path.basename(file)}: unreadable, skipped`); continue; }
    /* First file wins a role; extras become backdrops rather than being lost. */
    if (picks[role]) {
      if (!picks.backdrop) picks.backdrop = { file, size };
      else warnings.push(`${folder}/${path.basename(file)}: no role left, skipped`);
      continue;
    }
    picks[role] = { file, size };
  }

  for (const [role, pick] of Object.entries(picks)) {
    const { w, h } = pick.size ?? {};
    if (role === 'logo' && w && Math.max(w, h) < MIN_LOGO) {
      warnings.push(`${folder}: logo is ${w}x${h}, under the ${MIN_LOGO}px minimum`);
    }
    if (role !== 'logo' && w && w < MIN_HERO_W) {
      warnings.push(`${folder}: ${role} is ${w}x${h}, under ${MIN_HERO_W}px wide`);
    }
  }

  plan.push({ folder, hub, picks });
}

for (const { folder, hub, picks } of plan) {
  const already = [];
  if (hub.logo) already.push('logo');
  if (hub.heroImage) already.push('hero');
  const held = already.length && !replace ? `  (keeping existing ${already.join(' + ')})` : '';
  console.log(`  ${folder}  ->  ${hub.slug.current}${held}`);
  for (const [role, pick] of Object.entries(picks)) {
    const s = pick.size ? `${pick.size.w}x${pick.size.h}` : '?';
    console.log(`      ${role.padEnd(10)} ${path.basename(pick.file)}  ${s}`);
  }
}

if (unmatched.length) {
  console.log(`\n  NOT MATCHED to any hub (nothing done with these):`);
  for (const f of unmatched) console.log(`      ${f}`);
  console.log(`  Hub names are: ${hubs.map((h) => h.slug.current).join(', ')}`);
}
if (warnings.length) {
  console.log('\n  WARNINGS:');
  for (const w of warnings) console.log(`      ${w}`);
}

if (!execute) {
  console.log('\nDry run. Nothing was uploaded and videos.json is untouched.');
  console.log('Re-run with --execute to import, --replace to overwrite artwork a hub already has.\n');
  process.exit(0);
}

const token = process.env.SANITY_WRITE_TOKEN;
if (!token) {
  console.error('\nSANITY_WRITE_TOKEN is not set. Put it in .env (see .env.example) and re-run.');
  process.exit(1);
}
const client = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  token,
  apiVersion: '2024-03-01',
  useCdn: false,
});

let uploaded = 0;
let failed = 0;

for (const { folder, hub, picks } of plan) {
  for (const [role, pick] of Object.entries(picks)) {
    const has = role === 'backdrop' ? (hub.backdrops ?? []).length > 0 : !!hub[role];
    if (has && !replace) continue;
    try {
      const asset = await client.assets.upload('image', fs.createReadStream(pick.file), {
        filename: path.basename(pick.file),
      });
      /* Shapes match the hubs that already work: logo as a full image object,
         heroImage and backdrops as bare refs. urlFor() reads both. */
      if (role === 'logo') hub.logo = { _type: 'image', asset: { _ref: asset._id, _type: 'reference' } };
      else if (role === 'heroImage') hub.heroImage = asset._id;
      else hub.backdrops = [asset._id];
      uploaded += 1;
      console.log(`  ok  ${hub.slug.current} ${role}  ${asset._id}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED  ${folder} ${role}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/* Write through a temp file so an interrupted run cannot leave a half-written
   videos.json behind — the same move the Local CMS middleware makes. */
if (uploaded) {
  const tmp = `${DATA}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(docs, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, DATA);
}

console.log(`\n${failed ? '!' : 'Done.'} ${uploaded} image(s) imported, ${failed} failed.`);
console.log(uploaded ? 'src/data/videos.json updated. Review with `git diff`, then commit.\n' : 'Nothing to write.\n');
process.exit(failed ? 1 : 0);
