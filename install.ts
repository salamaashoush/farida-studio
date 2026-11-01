#!/usr/bin/env bun
/**
 * Puts together everything a host serves the studio from, in one directory:
 *
 *   <dir>/page     this package's page (index.html, host.js, SOURCE.txt, ...)
 *   <dir>/editor   the Scratch editor as published in `@scratch/scratch-gui`,
 *                  pinned by version and checksum, unmodified
 *   <dir>/library  every sprite, costume, backdrop and sound its library
 *                  offers, so a running studio never asks Scratch's servers
 *
 *   farida-studio <dir>
 *
 * The page is copied every run. The editor is fetched only when the pinned
 * version is not already there, and the library only for files that are
 * missing, so a cached directory makes this quick.
 *
 * Scratch's asset service publishes no rate limits and answers from a CDN
 * cache; four requests at a time, backing off on 429, 5xx and a dropped
 * connection (honouring Retry-After), keeps this a polite one-off.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

export const SCRATCH_GUI_VERSION = "15.3.0";
const EDITOR = `https://registry.npmjs.org/@scratch/scratch-gui/-/scratch-gui-${SCRATCH_GUI_VERSION}.tgz`;
const SHA512 =
  "Iaa4Su+CA8pnZiGmBuN6ezLwNK06cfnH9zmVVKdPxRbGWbOTHGcIZ92C2gsvi51ArbKfPwcHboTQC4N3vs+maQ==";
const ASSETS = "https://cdn.assets.scratch.mit.edu/internalapi/asset";
const CONCURRENCY = 4;
const ATTEMPTS = 5;

/** The page this package ships, beside this file. */
export const PAGE = new URL("./page/", import.meta.url).pathname;

async function fetchEditor(out: string): Promise<string> {
  const editor = join(out, "editor");
  const stamp = join(out, "VERSION");
  if (
    existsSync(stamp) &&
    readFileSync(stamp, "utf8").trim() === SCRATCH_GUI_VERSION
  )
    return editor;
  const response = await fetch(EDITOR);
  if (!response.ok) throw new Error(`${EDITOR} answered ${response.status}`);
  const tarball = new Uint8Array(await response.arrayBuffer());
  const sum = createHash("sha512").update(tarball).digest("base64");
  if (sum !== SHA512)
    throw new Error(
      `scratch-gui ${SCRATCH_GUI_VERSION}: the tarball hashes to ${sum}`,
    );

  const unpacked = join(out, "package");
  await rm(stamp, { force: true });
  await rm(editor, { recursive: true, force: true });
  await rm(unpacked, { recursive: true, force: true });
  // The page loads the standalone bundle. Its source maps double the size,
  // and the other bundle and the type declarations are for building on the
  // editor as a package.
  await new Bun.Archive(tarball).extract(out, {
    glob: [
      "package/dist/**",
      "!**/*.map",
      "!package/dist/types/**",
      "!package/dist/scratch-gui.js*",
    ],
  });
  await rename(join(unpacked, "dist"), editor);
  await rm(unpacked, { recursive: true, force: true });
  await writeFile(stamp, `${SCRATCH_GUI_VERSION}\n`);
  console.log(`scratch-gui ${SCRATCH_GUI_VERSION} in ${editor}`);
  return editor;
}

interface Asset {
  md5ext?: string;
  assetId?: string;
  dataFormat?: string;
}
export interface LibraryItem extends Asset {
  costumes?: Asset[];
  sounds?: Asset[];
}

const fileOf = (asset: Asset) =>
  asset.md5ext ??
  (asset.assetId && asset.dataFormat
    ? `${asset.assetId}.${asset.dataFormat}`
    : null);

/** Every file the library's items name, each named by its MD5. */
export function libraryFiles(items: readonly LibraryItem[]): string[] {
  const files = new Set<string>();
  for (const item of items)
    for (const asset of [
      item,
      ...(item.costumes ?? []),
      ...(item.sounds ?? []),
    ]) {
      const file = fileOf(asset);
      if (file && /^[0-9a-f]{32}\.[a-z0-9]+$/.test(file)) files.add(file);
    }
  return [...files].toSorted();
}

async function editorLibrary(editor: string): Promise<string[]> {
  const items: LibraryItem[] = [];
  for (const name of ["backdrops", "costumes", "sounds", "sprites"])
    items.push(
      ...(JSON.parse(
        await readFile(join(editor, "libraries", `${name}.json`), "utf8"),
      ) as LibraryItem[]),
    );
  return libraryFiles(items);
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Keeps a file only when its bytes match the MD5 it is named by. */
async function fetchOne(library: string, file: string): Promise<void> {
  const target = join(library, file);
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${ASSETS}/${file}/get/`).catch(() => null);
    if (response?.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const md5 = createHash("md5").update(bytes).digest("hex");
      if (md5 !== file.slice(0, 32))
        throw new Error(`${file}: the bytes hash to ${md5}`);
      await writeFile(`${target}.part`, bytes);
      await rename(`${target}.part`, target);
      return;
    }
    const retry =
      !response || response.status === 429 || response.status >= 500;
    if (!retry || attempt === ATTEMPTS)
      throw new Error(
        `${file}: ${response ? `HTTP ${response.status}` : "no answer"}`,
      );
    const after = Number(response?.headers.get("retry-after"));
    await pause(
      Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 500,
    );
  }
}

async function fetchLibrary(out: string, editor: string): Promise<void> {
  const library = join(out, "library");
  await mkdir(library, { recursive: true });
  const present = new Set(await readdir(library));
  const missing = (await editorLibrary(editor)).filter(
    (file) => !present.has(file),
  );
  if (!missing.length) return;
  let next = 0;
  let done = 0;
  const failed: string[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < missing.length) {
        const file = missing[next++];
        if (!file) break;
        try {
          await fetchOne(library, file);
        } catch (error) {
          failed.push(error instanceof Error ? error.message : String(error));
        }
        done += 1;
        if (done % 100 === 0) console.log(`${done} of ${missing.length}`);
      }
    }),
  );
  if (failed.length) throw new Error(failed.join("\n"));
  console.log(`scratch library: ${missing.length} files into ${library}`);
}

export async function install(dir: string): Promise<void> {
  const out = resolve(dir);
  await mkdir(out, { recursive: true });
  await rm(join(out, "page"), { recursive: true, force: true });
  await cp(PAGE, join(out, "page"), { recursive: true });
  const editor = await fetchEditor(out);
  await fetchLibrary(out, editor);
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: farida-studio <dir>");
    process.exit(2);
  }
  await install(dir);
}
