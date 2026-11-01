import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import pkg from "./package.json";
import { libraryFiles, PAGE, SCRATCH_GUI_VERSION } from "./install";

test("the library is every file its items name by MD5, once", () => {
  const sprite = "0123456789abcdef0123456789abcdef";
  const sound = "fedcba9876543210fedcba9876543210";
  expect(
    libraryFiles([
      {
        md5ext: `${sprite}.svg`,
        costumes: [{ assetId: sprite, dataFormat: "svg" }],
        sounds: [{ md5ext: `${sound}.wav` }],
      },
      { assetId: "not-a-hash", dataFormat: "png" },
      { md5ext: "../../etc/passwd" },
    ]),
  ).toEqual([`${sprite}.svg`, `${sound}.wav`]);
});

test("the page is what a host serves, and links its source", async () => {
  expect((await readdir(PAGE)).toSorted()).toEqual([
    "SOURCE.txt",
    "fullscreen.svg",
    "host.css",
    "host.js",
    "index.html",
    "logo.svg",
  ]);
  const html = await Bun.file(join(PAGE, "index.html")).text();
  expect(html).toContain('href="./SOURCE.txt"');
  expect(html).toContain('src="./scratch-gui-standalone.js"');
  expect(html).toContain('src="./host.js"');
});

test("the source notice names this release and the editor it runs", async () => {
  const notice = await Bun.file(join(PAGE, "SOURCE.txt")).text();
  expect(notice).toContain(`Farida Studio ${pkg.version}`);
  expect(notice).toContain(
    `https://github.com/salamaashoush/farida-studio/tree/v${pkg.version}`,
  );
  expect(notice).toContain(`@scratch/scratch-gui ${SCRATCH_GUI_VERSION}`);
  expect(notice).toContain("https://www.gnu.org/licenses/agpl-3.0.html");
});

test("the studio answers only its framer, at the origin it was given", async () => {
  const host = await Bun.file(join(PAGE, "host.js")).text();
  expect(host).toContain(
    "if (event.source !== window.parent || event.origin !== parentOrigin) return;",
  );
  expect(host).toContain("window.parent.postMessage(");
  expect(host).not.toMatch(/postMessage\([^)]*"\*"/);
});
