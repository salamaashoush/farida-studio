/**
 * The studio as a host would run it, for trying it out: the studio on one
 * site, a page that frames it on another, and the project kept by that
 * page (in localStorage), as a learning platform keeps it.
 *
 *   bun dev.ts      then open http://127.0.0.1:4100
 */
import { join, resolve, sep } from "node:path";

import { install } from "./install";

const DIR = resolve(".studio");
const STUDIO = "http://localhost:4101";
const FRAMER = "http://127.0.0.1:4100";
const ROOTED = /^\/(?:chunks|static)\//;

await install(DIR);
const editor = join(DIR, "editor");

/** The studio's files, and the editor's at the host's root, as it asks. */
async function studio(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const rooted = ROOTED.test(path);
  if (!rooted && !path.startsWith("/studio/"))
    return new Response(null, { status: 404 });
  const name = decodeURIComponent(path.slice(rooted ? 1 : 8)) || "index.html";
  const library = /^library\/([0-9a-f]{32}\.[a-z0-9]+)$/.exec(name)?.[1];
  const pages = join(DIR, "page");
  const page = resolve(pages, name);
  const target = library
    ? join(DIR, "library", library)
    : page.startsWith(pages + sep) && (await Bun.file(page).exists())
      ? page
      : resolve(editor, name);
  if (!library && !target.startsWith(pages + sep) && !target.startsWith(editor + sep))
    return new Response(null, { status: 404 });
  const file = Bun.file(target);
  return (await file.exists())
    ? new Response(file)
    : new Response(null, { status: 404 });
}

const FRAME = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Studio, framed</title>
    <style>
      body { margin: 0; font: 14px system-ui, sans-serif; display: grid; grid-template-rows: auto 1fr; height: 100vh; }
      nav { display: flex; gap: 8px; padding: 8px; align-items: center; }
      iframe { border: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <nav>
      <button id="save">Save</button>
      <button id="start">Green flag</button>
      <button id="stop">Stop</button>
      <label><input id="player" type="checkbox" /> Player</label>
      <label><input id="arabic" type="checkbox" /> Arabic</label>
      <span id="said"></span>
    </nav>
    <iframe
      id="studio"
      title="Studio"
      allow="autoplay; camera; microphone; fullscreen"
      sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
    ></iframe>
    <script type="module">
      const STUDIO = ${JSON.stringify(STUDIO)};
      const frame = document.getElementById("studio");
      const said = document.getElementById("said");
      const send = (message, transfer = []) =>
        frame.contentWindow.postMessage({ source: "farida", ...message }, STUDIO, transfer);
      const kept = () => {
        const text = localStorage.getItem("project");
        return text ? Uint8Array.fromBase64(text).buffer : null;
      };
      function open() {
        said.textContent = "";
        const query = new URLSearchParams({ parent: location.origin });
        if (document.getElementById("player").checked) query.set("mode", "player");
        if (document.getElementById("arabic").checked) query.set("locale", "ar");
        frame.src = STUDIO + "/studio/?" + query;
      }
      addEventListener("message", (event) => {
        if (event.origin !== STUDIO || event.data?.source !== "farida-scratch") return;
        const message = event.data;
        said.textContent = message.type;
        if (message.type === "ready") send({ type: "load", project: kept() });
        if (message.type === "saved")
          localStorage.setItem("project", new Uint8Array(message.project).toBase64());
      });
      document.getElementById("save").onclick = () => send({ type: "save", id: crypto.randomUUID() });
      document.getElementById("start").onclick = () => send({ type: "start" });
      document.getElementById("stop").onclick = () => send({ type: "stop" });
      document.getElementById("player").onchange = open;
      document.getElementById("arabic").onchange = open;
      open();
    </script>
  </body>
</html>`;

Bun.serve({ port: 4101, hostname: "localhost", fetch: studio });
Bun.serve({
  port: 4100,
  hostname: "127.0.0.1",
  fetch: () =>
    new Response(FRAME, { headers: { "content-type": "text/html" } }),
});
console.log(`Open ${FRAMER}; the studio is at ${STUDIO}/studio/`);
