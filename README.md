# Farida Studio

The Scratch editor as a page that a learning platform frames. The platform
hands it a project, asks for it back, and keeps it; the studio talks to no
project server, no account and none of Scratch's services. It is the coding
studio of [Farida LMS](https://faridalms.com), published on its own because
it is built on the Scratch editor, which is under the AGPL.

- `page/`: the page a host serves (`index.html`, `host.js`, `host.css`,
  the logo, and `SOURCE.txt`, the notice its Source link opens).
- `install.ts`: puts the page, the Scratch editor (`@scratch/scratch-gui`
  15.3.0, pinned by checksum, unmodified) and its library of sprites,
  backdrops and sounds (about 1,350 files, 60 MB) into one directory.
- `dev.ts`: the studio framed by another site, to try it.

## Trying it

Needs [Bun](https://bun.sh) 1.4.

```sh
bun install
bun run dev    # then open http://127.0.0.1:4100
```

The demo frames the studio from another site and keeps the project in
`localStorage`; Save, reload, and it comes back.

## Using it

Add it as a dependency straight from GitHub, pinned to a release:

```sh
bun add github:salamaashoush/farida-studio#v1.1.0
bunx farida-studio vendor/studio   # page/, editor/, library/
```

Serve that directory from a host of its own, another site from your
application's, since the studio runs whatever project it is handed:

- `/studio/<file>`: `page/<file>` when it is one of the page's files,
  `library/<md5>.<ext>` for the library, otherwise `editor/<file>`.
- `/chunks/...` and `/static/...` at the root: `editor/...`. The editor's
  bundle was built to sit at the root of its host and asks there for the
  code it loads late and the pictures it shows.
- A Content-Security-Policy that lets it reach only its own host keeps
  everything a child makes on your side:

  ```
  default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  media-src 'self' data: blob:; connect-src 'self' data: blob:;
  font-src 'self' data:; worker-src 'self' blob:; object-src 'none';
  base-uri 'none'; form-action 'none'
  ```

  It also blocks the Text to Speech and Translate extensions, which call
  Scratch's services.

Frame it with the framing page's origin:

```html
<iframe
  src="https://studio.example.net/studio/?parent=https%3A%2F%2Fschool.example.com&locale=ar"
  sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
  allow="autoplay; camera; microphone; fullscreen"
></iframe>
```

Chrome warns that a frame with both `allow-scripts` and `allow-same-origin`
can escape its sandbox. It can only when it has the same origin as the page
around it, which is why the studio must be on another site: that is the
boundary. It keeps its own origin for the storage and workers the editor
needs.

- `parent` (required): the framing page's origin. The studio answers only
  messages from its parent window at that origin, and sends only to it.
- `locale`: `en` (default) or `ar`, which also turns the page right to left.
- `mode=player`: the stage alone, scaled to the frame, for showing a
  finished project.

## Messages

Both ways over `postMessage`. The framing page sends
`{ source: "farida", type, ... }`:

- `load`, with `project` (an `.sb3` as an `ArrayBuffer`, or `null` for a new
  one). Send it after `ready`.
- `save`, with `id`: the studio answers `saved` with the same `id`.
- `start` and `stop`: the green flag and the stop sign.

The studio sends `{ source: "farida-scratch", type, ... }`:

- `ready`: the editor is up; send `load`.
- `loaded`, or `error` with `code: "load_failed"`.
- `changed`: the project changed. It comes at once for the first change of
  a run and again a second after the run pauses, so a page can save when
  editing settles and on closing.
- `saved`, with `id`, `project` (the `.sb3`) and `thumbnail` (a PNG of the
  stage, or `null`), both `ArrayBuffer`s transferred to the page.

## Licence

GNU Affero General Public License, version 3 only ([LICENSE](LICENSE)).
Copyright (C) 2026 Salama Ashoush.

Whoever runs a changed copy for other people over a network must offer them
its source: change `page/SOURCE.txt` to say where it is.

The Scratch editor is also under the AGPL; this studio runs it unmodified
([scratch-editor](https://github.com/scratchfoundation/scratch-editor)).
Scratch is a trademark of the Scratch Foundation, which does not endorse
this studio, so the studio shows its own logo in the editor's menu bar. The
library's sprites, backdrops and sounds are Scratch's, under Creative
Commons Attribution-ShareAlike 2.0.
