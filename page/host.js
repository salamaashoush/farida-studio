// The studio inside Farida's frame. Farida's page owns the project: it sends
// one in, asks for it back, and stores it; the studio never talks to any
// project server. Messages are accepted only from the parent window, and only
// when it is the origin named in the `parent` parameter.

const {
  EditorState,
  createStandaloneRoot,
  setAppElement,
  ScratchStorage,
  buildDefaultProject,
  requestProjectUpload,
  onLoadedProject,
  defaultProjectId,
  setFullScreen,
} = window.GUI;

const params = new URLSearchParams(window.location.search);
const parentOrigin = params.get("parent");
const player = params.get("mode") === "player";
const locale = params.get("locale") === "ar" ? "ar" : "en";
const CHANGE_QUIET_MS = 1000;

/** Library sprites, costumes and sounds, which the studio serves itself. */
const libraryUrl = (assetId, dataFormat) =>
  new URL(`./library/${assetId}.${dataFormat}`, window.location.href).href;

class FaridaStorage {
  scratchStorage = new ScratchStorage();

  constructor() {
    this.cacheDefaultProject();
    const { AssetType } = this.scratchStorage;
    this.scratchStorage.addWebStore(
      [AssetType.ImageVector, AssetType.ImageBitmap, AssetType.Sound],
      (asset) => libraryUrl(asset.assetId, asset.dataFormat),
    );
  }

  cacheDefaultProject() {
    for (const asset of buildDefaultProject(this.translator)) {
      this.scratchStorage.builtinHelper._store(
        this.scratchStorage.AssetType[asset.assetType],
        this.scratchStorage.DataFormat[asset.dataFormat],
        asset.data,
        asset.id,
      );
    }
  }

  setTranslatorFunction(translator) {
    this.translator = translator;
    this.cacheDefaultProject();
  }

  getLibraryAssetUrl(assetId, dataFormat) {
    return libraryUrl(assetId, dataFormat);
  }

  setProjectHost() {}
  setProjectToken() {}
  setProjectMetadata() {}
  setAssetHost() {}
  setBackpackHost() {}

  saveProject() {
    return Promise.reject(new Error("Farida stores this project"));
  }
}

const storage = new FaridaStorage();
// A player shows the stage alone, scaled to the frame, as a full screen does.
const state = new EditorState(
  { locale, isPlayerOnly: player, isFullScreen: player },
  () => ({ storage }),
);

document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
if (player) document.body.classList.add("player");
const sourceLink = document.querySelector(".source");
if (sourceLink && locale === "ar") sourceLink.textContent = "الشيفرة المصدرية";

const target = document.getElementById("studio");
setAppElement(target);
createStandaloneRoot(state, target).render({
  projectId: defaultProjectId,
  onClickLogo: () => {},
  isRtl: locale === "ar",
  canSave: false,
  canShare: false,
  canRemix: false,
  canCreateCopy: false,
  canEditTitle: false,
  canUseCloud: false,
  canChangeLanguage: false,
  canManageFiles: false,
  enableCommunity: false,
  showComingSoon: false,
  backpackVisible: false,
  hideTutorialProjects: true,
  menuBarHidden: player,
});

// The menu bar draws Scratch's logo whatever `logo` says, and Scratch's marks
// may not promote a derived studio, so the image is swapped wherever it shows.
const LOGO = new URL("./logo.svg", window.location.href).href;
function brand() {
  const image = document.getElementById("logo_img");
  if (!image || image.src === LOGO) return;
  image.src = LOGO;
  image.alt = "Studio";
}

// A player's layout is always Scratch's full screen, so its button always
// shows "exit". It shows "enter" until the browser's own full screen is on.
// The flag and stop are labelled buttons; the full-screen control is the
// one focusable button whose label sits on its image instead.
const ENTER_FULL_SCREEN = new URL("./fullscreen.svg", window.location.href)
  .href;
const enterLabel = locale === "ar" ? "ملء الشاشة" : "Full screen";
let exitIcon = null;
let exitLabel = "";
function fullScreenButton() {
  if (!player) return;
  const image = target.querySelector(
    "button[data-focusable]:not([aria-label]) img",
  );
  if (!image) return;
  if (image.src !== ENTER_FULL_SCREEN && image.src !== exitIcon) {
    exitIcon = image.src;
    exitLabel = image.alt;
  }
  const [src, label] = document.fullscreenElement
    ? [exitIcon, exitLabel]
    : [ENTER_FULL_SCREEN, enterLabel];
  if (!src || image.src === src) return;
  image.src = src;
  image.alt = label;
  image.title = label;
}
document.addEventListener("fullscreenchange", fullScreenButton);

new MutationObserver(() => {
  brand();
  fullScreenButton();
}).observe(target, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["src"],
});

const gui = () => state.store.getState().scratchGui;
const vm = () => gui().vm;

function post(message, transfer = []) {
  if (!parentOrigin || window.parent === window) return;
  window.parent.postMessage(
    { source: "farida-scratch", ...message },
    parentOrigin,
    transfer,
  );
}

/** Resolves once the editor shows a project and nothing is loading. */
function settled() {
  return new Promise((resolve) => {
    const check = () => {
      const { loadingState } = gui().projectState;
      if (loadingState === "SHOWING_WITHOUT_ID") {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = state.store.subscribe(check);
    check();
  });
}

let loading = false;
let quiet = 0;

async function load(project) {
  await settled();
  if (!project) {
    post({ type: "loaded" });
    return;
  }
  loading = true;
  state.store.dispatch(requestProjectUpload(gui().projectState.loadingState));
  try {
    await vm().loadProject(project);
    state.store.dispatch(
      onLoadedProject("LOADING_VM_FILE_UPLOAD", false, true),
    );
    post({ type: "loaded" });
  } catch {
    state.store.dispatch(
      onLoadedProject("LOADING_VM_FILE_UPLOAD", false, false),
    );
    post({ type: "error", code: "load_failed" });
  } finally {
    loading = false;
  }
}

function snapshot() {
  return new Promise((resolve) => {
    const renderer = vm().renderer;
    if (!renderer) return resolve(null);
    renderer.requestSnapshot((dataUrl) =>
      fetch(dataUrl)
        .then((response) => response.arrayBuffer())
        .then(resolve, () => resolve(null)),
    );
  });
}

async function save(id) {
  const [project, thumbnail] = await Promise.all([
    vm()
      .saveProjectSb3()
      .then((blob) => blob.arrayBuffer()),
    snapshot(),
  ]);
  post(
    { type: "saved", id, project, thumbnail },
    thumbnail ? [project, thumbnail] : [project],
  );
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  const message = event.data;
  if (!message || message.source !== "farida") return;
  if (message.type === "load") void load(message.project ?? null);
  else if (message.type === "save") void save(String(message.id));
  // As the stage's own flag does: the runtime starts, then the flag.
  else if (message.type === "start") {
    vm().start();
    vm().greenFlag();
  } else if (message.type === "stop") vm().stopAll();
});

// A player fills its frame with Scratch's full-screen layout; leaving it
// would shrink the stage to its editing size in one corner of the frame. So
// the player's full-screen button keeps that layout and takes the frame in
// and out of the browser's own full screen instead. Browsers that refuse
// (an iPhone allows it only for video) leave the stage as it was.
let relaying = false;
if (player) {
  state.store.subscribe(() => {
    if (relaying || gui().mode.isFullScreen) return;
    state.store.dispatch(setFullScreen(true));
    if (document.fullscreenElement) void document.exitFullscreen();
    else if ("requestFullscreen" in document.documentElement)
      void document.documentElement.requestFullscreen().catch(() => {});
  });
  // Scratch sizes a full-screen stage from the window only when its layout
  // changes, so when the window itself changes (the browser's full screen, a
  // turned tablet) the layout is left and taken again.
  window.addEventListener("resize", () => {
    relaying = true;
    state.store.dispatch(setFullScreen(false));
    state.store.dispatch(setFullScreen(true));
    relaying = false;
  });
}

void settled().then(() => {
  // The page saves a while after it last heard of a change, and on closing
  // only if it heard of one. So the first of a run of changes is told at
  // once, or a studio closed straight after it would keep nothing, and the
  // run is told again once it pauses, which is when the wait should start.
  vm().on("PROJECT_CHANGED", () => {
    if (loading || player) return;
    if (!quiet) post({ type: "changed" });
    window.clearTimeout(quiet);
    quiet = window.setTimeout(() => {
      quiet = 0;
      post({ type: "changed" });
    }, CHANGE_QUIET_MS);
  });
  post({ type: "ready" });
});
