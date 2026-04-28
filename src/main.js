import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createAmbientPad } from "./audio.js";

// Always start at the top on refresh
history.scrollRestoration = "manual";
window.scrollTo(0, 0);

// ── Text scramble ────────────────────────────────────────
// Cycles random chars on each character position before resolving to the
// final glyph — gives the loader brand a "decoding" feel.
class TextScramble {
  constructor(el) {
    this.el = el;
    this.chars = "abcdefghijklmnopqrstuvwxyz!.-_/=+*#0123456789";
    this.frame = 0;
    this.queue = [];
    this.raf = null;
    this.update = this.update.bind(this);
  }

  setText(newText) {
    const len = newText.length;
    this.queue = Array.from({ length: len }, (_, i) => ({
      to: newText[i],
      start: Math.floor(Math.random() * 12),
      end: Math.floor(Math.random() * 12) + 14 + (i * 1.2) | 0,
      char: "",
    }));
    this.frame = 0;
    cancelAnimationFrame(this.raf);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.update();
    });
  }

  get running() {
    return this.raf !== null;
  }

  // Snap to the final text immediately — used on pointerdown so a click during
  // a scramble doesn't lose its target when innerHTML mutates between mousedown
  // and mouseup (the spans the click landed on get replaced mid-gesture).
  finish() {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
    this.el.textContent = this.queue.map((q) => q.to).join("");
    if (this.resolve) this.resolve();
  }

  update() {
    let out = "";
    let done = 0;
    for (const q of this.queue) {
      if (this.frame >= q.end) {
        done++;
        out += q.to === " " ? " " : q.to;
      } else if (this.frame >= q.start) {
        if (!q.char || Math.random() < 0.3) {
          q.char = this.chars[Math.floor(Math.random() * this.chars.length)];
        }
        out += `<span class="scramble-glyph">${q.char}</span>`;
      } else {
        out += q.to === " " ? " " : "·";
      }
    }
    this.el.innerHTML = out;
    if (done === this.queue.length) {
      this.el.textContent = this.queue.map((q) => q.to).join("");
      this.raf = null;
      this.resolve();
    } else {
      this.frame++;
      this.raf = requestAnimationFrame(this.update);
    }
  }
}

const canvas = document.getElementById("scene");
const loaderEl = document.getElementById("loader");
const loaderBar = loaderEl.querySelector(".loader__bar span");
const progressBar = document.getElementById("progress-bar");
const sections = Array.from(document.querySelectorAll(".section"));
const audioBtn = document.getElementById("audio-toggle");
const themeBtn = document.getElementById("theme-toggle");
const modeOptions = Array.from(document.querySelectorAll(".mode-switch__option"));
const topbarEl   = document.querySelector(".topbar");

// ── Renderer ────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;

// ── Scene & camera ──────────────────────────────────────
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  35,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0.4, 2.6);
camera.lookAt(0, 0, 0);

// Studio environment for PBR reflections (metal/leather)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// ── Lights ──────────────────────────────────────────────
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(2.5, 3.5, 2.5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xffb37a, 0.7);
rimLight.position.set(-3, 1.5, -2);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xffd5a8, 0.5, 8);
fillLight.position.set(-1.5, 0.5, 2);
scene.add(fillLight);

// ── Model group ─────────────────────────────────────────
const modelGroup = new THREE.Group();
scene.add(modelGroup);

let model = null;
// Cylinder009 is a Group whose origin is at the disc center; rotating it
// spins the reel without disturbing the static face plate.
let reelGroup = null;
const REEL_IDLE_SPEED  = 0.004;   // ambient slow drift
const REEL_PLAY_SPEED  = 0.045;   // recording / playback
const REEL_BOOST_SPEED = 0.18;    // rocker fast-forward / rewind
const REEL_BOOST_MS    = 1200;    // how long a rocker boost lasts

// ── Theme ───────────────────────────────────────────────
let currentTheme = "dark";
const DECAL_MATS = new Set(["decals", "lum-decals"]);

function tintForTheme(theme, baseColor) {
  const lum =
    baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  if (theme === "light") {
    const mult = lum > 0.05 ? 0.012 + (1 - lum) * 0.04 : 1;
    return baseColor.clone().multiplyScalar(mult);
  }
  const mult = 1 - lum * 0.58;
  return baseColor.clone().multiplyScalar(mult);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;

  if (model) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mat = child.material;
      const base = mat.userData.baseColor;
      const matName = mat.name || "";
      const isDecal = DECAL_MATS.has(matName);

      if (base && mat.color) {
        if (matName === "orange") {
          mat.color.setHex(0x0e0e0e);
        } else if (theme === "light" && matName === "decals") {
          mat.color.setHex(0xffffff);
        } else if (theme === "light" && matName === "lum-decals") {
          mat.color.copy(base);
        } else {
          mat.color.copy(tintForTheme(theme, base));
        }
      }

      if (mat.emissive) {
        const baseE  = mat.userData.baseEmissive;
        const baseEI = mat.userData.baseEmissiveIntensity ?? 1;
        if (theme === "light" && matName === "decals") {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.7;
        } else if (baseE) {
          mat.emissive.copy(baseE);
          mat.emissiveIntensity = baseEI;
        }
      }

      const baseR = mat.userData.baseRoughness ?? 0.5;
      const baseM = mat.userData.baseMetalness ?? 0;
      if (theme === "light") {
        if (isDecal) {
          mat.roughness = baseR;
          mat.metalness = baseM;
          mat.envMapIntensity = 0.4;
        } else {
          mat.roughness = Math.min(1, baseR + 0.7);
          mat.metalness = Math.max(0, baseM - 0.5);
          mat.envMapIntensity = 0.04;
        }
      } else {
        mat.roughness = baseR;
        mat.metalness = Math.min(1, baseM + 0.1);
        mat.envMapIntensity = 0.85;
      }
    });
  }

  if (theme === "light") {
    ambient.intensity = 0.45;
    keyLight.intensity = 0.55;
    rimLight.intensity = 0.18;
    rimLight.color.setHex(0xffffff);
    fillLight.intensity = 0.12;
    renderer.toneMappingExposure = 0.82;
  } else {
    ambient.intensity = 0.18;
    keyLight.intensity = 1.1;
    rimLight.intensity = 0.7;
    rimLight.color.setHex(0xffb37a);
    fillLight.intensity = 0.5;
    renderer.toneMappingExposure = 0.78;
  }

  themeBtn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
  // Label shows the action (where you'll go), not the current state.
  const themeLabel = themeBtn.querySelector(".topbar__toggle-label");
  if (themeLabel) themeLabel.textContent = theme === "light" ? "dark" : "light";

}

const gltfLoader = new GLTFLoader();
gltfLoader.load(
  "/assets/teenage-engineering.glb",
  (gltf) => {
    model = gltf.scene;

    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    const pivot = new THREE.Group();
    pivot.add(model);
    const maxDim     = Math.max(size.x, size.y, size.z);
    const targetSize = 1.5;
    pivot.scale.setScalar(targetSize / maxDim);

    // Stand the device upright in portrait: working face (+Y in GLB) toward
    // +Z (camera), long axis vertical.
    pivot.rotation.x = Math.PI / 2;

    // Cache base PBR properties once so we can re-derive theme-specific
    // tints without compounding mutations.
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mat = child.material;
      if (mat.color) mat.userData.baseColor = mat.color.clone();
      if (mat.emissive) {
        mat.userData.baseEmissive          = mat.emissive.clone();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity ?? 1;
      }
      mat.userData.baseRoughness = mat.roughness ?? 0.5;
      mat.userData.baseMetalness = mat.metalness ?? 0;
    });

    applyTheme(currentTheme);

    // Collect the lum-decals material — its emissiveIntensity is the record LED.
    // Multiple meshes may share this Three.js material object; one ref suffices.
    model.traverse((child) => {
      if (
        child.isMesh &&
        child.material &&
        child.material.name === "lum-decals"
      ) {
        ledMaterial = child.material;
      }
    });

    reelGroup = model.getObjectByName("Cylinder009");

    modelGroup.add(pivot);

    // Stamp data-text on all narrative text nodes — the ::after pseudo-element
    // reads this via content: attr(data-text) to render an identical white overlay.
    sections.forEach((s) => {
      s.querySelectorAll(".title, .tagline, .body").forEach((el) => {
        el.dataset.text = el.textContent.trim();
      });
    });

    finishLoading();
  },
  (xhr) => {
    if (xhr.lengthComputable) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      loaderBar.style.width = `${pct}%`;
    }
  },
  (err) => {
    console.error("GLB load error:", err);
    loaderEl.querySelector(".loader__brand").textContent = "load failed";
  },
);

// ── Loader sequence ─────────────────────────────────────
const LOADER_MIN_BAR_MS = 1700;
const BRAND_HOLD_MS     = 3100;
const loaderStart       = performance.now();

const loaderBrand    = loaderEl.querySelector(".loader__brand");
const scrambler      = new TextScramble(loaderBrand);
const topbarBrand    = document.querySelector(".topbar__brand");
const topbarScrambler = new TextScramble(topbarBrand);

topbarBrand.addEventListener("mouseenter", () => {
  if (!topbarScrambler.running) topbarScrambler.setText("teenage engineering");
});
topbarBrand.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Scramble on hover for topbar controls.
// Width is locked before the animation so the button doesn't resize.
// pointerdown calls finish() so a click during the scramble doesn't lose its
// target — innerHTML mutations between mousedown and mouseup would otherwise
// leave the click event with mismatched targets and the browser drops the click.
function addHoverScramble(el) {
  const s    = new TextScramble(el);
  const text = el.textContent.trim();
  el.addEventListener("mouseenter", () => {
    if (s.running) return;
    el.style.minWidth = el.offsetWidth + "px";
    s.setText(text).then(() => { el.style.minWidth = ""; });
  });
  el.addEventListener("pointerdown", () => {
    if (s.running) {
      s.finish();
      el.style.minWidth = "";
    }
  });
}
document.querySelectorAll(".mode-switch__option").forEach(addHoverScramble);

// Toggle pills: listen on the outer button so the scramble fires as soon as
// the pointer enters the pill border — not only when it reaches the label text.
document.querySelectorAll(".topbar__toggle").forEach((btn) => {
  const label = btn.querySelector(".topbar__toggle-label");
  if (!label) return;
  const s = new TextScramble(label);
  btn.addEventListener("mouseenter", () => {
    if (s.running) return;
    // Read label text at hover time so the scramble reflects the current
    // label value (e.g. "dark" after switching to light mode).
    const current = label.textContent.trim();
    label.style.minWidth = label.offsetWidth + "px";
    s.setText(current).then(() => { label.style.minWidth = ""; });
  });
  // Same target-stability fix as addHoverScramble: snap to final text on
  // pointerdown so the click event isn't dropped due to span churn.
  btn.addEventListener("pointerdown", () => {
    if (s.running) {
      s.finish();
      label.style.minWidth = "";
    }
  });
});

function finishLoading() {
  loaderBar.style.width = "100%";
  const elapsed = performance.now() - loaderStart;
  const barWait = Math.max(1150, LOADER_MIN_BAR_MS - elapsed);
  setTimeout(() => {
    loaderEl.classList.add("is-revealed");
    scrambler.setText("teenage engineering");
    setTimeout(() => {
      loaderEl.classList.add("is-hidden");
      sections[0].classList.add("is-active");
      topbarScrambler.setText("teenage engineering");
    }, BRAND_HOLD_MS);
  }, barWait);
}

// ── Keyframes (one per section) ─────────────────────────
const keyframes = [
  {
    // 0% — front view, model right of frame, hero text left
    camPos:  new THREE.Vector3(-0.55, 0, 3.1),
    camLook: new THREE.Vector3(-0.55, 0, 0),
    rot:     new THREE.Euler(0, 0, 0),
  },
  {
    // 20% — gentle rotation right, model left of frame, text right
    camPos:  new THREE.Vector3(0.55, 0, 3.0),
    camLook: new THREE.Vector3(0.55, 0, 0),
    rot:     new THREE.Euler(0, Math.PI / 7, 0),
  },
  {
    // 40% — close zoom on the screen (top of the device) + dial
    camPos:  new THREE.Vector3(-0.5, 0.45, 2.0),
    camLook: new THREE.Vector3(-0.5, 0.4, 0),
    rot:     new THREE.Euler(-0.12, Math.PI / 16, 0),
  },
  {
    // 60% — device nearly flat, top edge (TRRS jacks + USB-C) faces camera
    camPos:  new THREE.Vector3(0.55, 0.4, 2.4),
    camLook: new THREE.Vector3(0.55, 0.1, 0),
    rot:     new THREE.Euler(Math.PI / 2, Math.PI, 0),
  },
  {
    // 80% — view from below, "Designed in Stockholm"
    camPos:  new THREE.Vector3(0, -0.85, 2.6),
    camLook: new THREE.Vector3(0, 0, 0),
    rot:     new THREE.Euler(0.4, Math.PI * 1.35, 0),
  },
  {
    // 100% — return to front, slightly above and zoomed out, CTA below
    camPos:  new THREE.Vector3(0, 0.3, 4.2),
    camLook: new THREE.Vector3(0, -0.2, 0),
    rot:     new THREE.Euler(0, Math.PI * 2, 0),
  },
];

// ── Scroll driver ───────────────────────────────────────
let scrollProgress = 0;
const targetCamPos  = new THREE.Vector3().copy(keyframes[0].camPos);
const targetCamLook = new THREE.Vector3().copy(keyframes[0].camLook);
const targetRot     = new THREE.Euler().copy(keyframes[0].rot);
const currentCamLook = new THREE.Vector3().copy(keyframes[0].camLook);
const currentRot     = new THREE.Euler().copy(keyframes[0].rot);
const LERP = 0.07;

// ── Text contrast via raycasting clip-path (light mode) ──────────────────────
// Coarse scan locates the bracket containing the device edge; binary refinement
// then narrows it to sub-pixel precision. Results are lerped frame-to-frame so
// the inversion trails the device smoothly without visible stepping.
const _ndcRay        = new THREE.Vector2();
const _prevClips     = new WeakMap(); // el      → { l, r }
const _sectionSeenAt = new WeakMap(); // section → timestamp of last is-active frame
const COARSE         = 16;    // initial horizontal probes per direction
const REFINE         = 5;     // binary-search steps after bracket found
const CLIP_LERP      = 0.12;  // convergence speed — matches camera lerp feel
const FADE_MS        = 650;   // slightly longer than the CSS 0.6s opacity transition

function _rayHit(xViewport, ndcY) {
  _ndcRay.set((xViewport / window.innerWidth) * 2 - 1, ndcY);
  raycaster.setFromCamera(_ndcRay, camera);
  return raycaster.intersectObject(model, true).length > 0;
}

function _findEdge(rect, ndcY, fromLeft) {
  const step = 1 / COARSE;
  let edgeFrac = fromLeft ? 1 : 0; // sentinel: device not found in range
  for (let i = 0; i < COARSE; i++) {
    const frac = fromLeft ? (i + 0.5) * step : 1 - (i + 0.5) * step;
    if (_rayHit(rect.left + rect.width * frac, ndcY)) {
      edgeFrac = frac;
      break;
    }
  }
  if (edgeFrac === (fromLeft ? 1 : 0)) return edgeFrac; // not found

  // Binary refinement between the last miss and the first hit
  let lo = fromLeft ? Math.max(0, edgeFrac - step) : edgeFrac;
  let hi = fromLeft ? edgeFrac : Math.min(1, edgeFrac + step);
  for (let j = 0; j < REFINE; j++) {
    const mid = (lo + hi) * 0.5;
    if (_rayHit(rect.left + rect.width * mid, ndcY)) {
      if (fromLeft) hi = mid; else lo = mid;
    } else {
      if (fromLeft) lo = mid; else hi = mid;
    }
  }
  return fromLeft ? hi : lo;
}

function updateDeviceClip() {
  if (currentTheme !== "light" || !model) return;
  const now = performance.now();
  sections.forEach((section) => {
    const active = section.classList.contains("is-active");
    if (active) _sectionSeenAt.set(section, now);
    // Keep processing for FADE_MS after is-active is removed so the clip
    // continues to update through the full CSS opacity fade-out.
    const last = _sectionSeenAt.get(section) ?? -Infinity;
    if (!active && now - last > FADE_MS) return;
    section.querySelectorAll("[data-text]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;

      const ndcY = -((rect.top + rect.height * 0.5) / window.innerHeight) * 2 + 1;

      const rawL = rect.width * _findEdge(rect, ndcY, true);
      const rawR = rect.width * (1 - _findEdge(rect, ndcY, false));

      // Lerp toward target — smooths discrete steps and camera motion
      const prev = _prevClips.get(el) ?? { l: rawL, r: rawR };
      const l = prev.l + (rawL - prev.l) * CLIP_LERP;
      const r = prev.r + (rawR - prev.r) * CLIP_LERP;
      _prevClips.set(el, { l, r });

      el.style.setProperty(
        "--device-clip",
        `inset(0px ${r.toFixed(2)}px 0px ${l.toFixed(2)}px)`,
      );
    });
  });
}

// ── Interactive (explore) mode ──────────────────────────
let interactiveMode = false;
const explorePose = {
  camPos:  new THREE.Vector3(0, 0, 2.6),
  camLook: new THREE.Vector3(0, 0, 0),
};
let exploreYaw   = 0;
let explorePitch = 0;

// ── Device state machine ─────────────────────────────────
// Mirrors the real TP-7 transport behavior:
//   IDLE      → reel slow-idle, LED off
//   ARMED     → reel stops, LED slow-flash (1 Hz) — ready to record
//   RECORDING → reel fast, LED solid bright — capturing audio
//   PLAYING   → reel fast, LED off — playing back
const DS = Object.freeze({ IDLE: 0, ARMED: 1, RECORDING: 2, PLAYING: 3 });
let deviceState    = DS.IDLE;
let padGain        = 0.55;     // master volume 0–1; user-adjustable with +/−
let reelBoostUntil = 0;        // timestamp: rocker boost ends here
let reelDragging   = false;    // user is manually spinning the disc

// LED: the lum-decals material's emissiveIntensity drives the record lamp.
let ledMaterial   = null;
let ledFlashTimer = null;
let ledFlashPhase = false;

function setLedIntensity(v) {
  if (ledMaterial) ledMaterial.emissiveIntensity = v;
}

function stopLedFlash() {
  if (ledFlashTimer) { clearInterval(ledFlashTimer); ledFlashTimer = null; }
}

// hz = full blink cycles per second (each cycle = one on + one off interval)
function startLedFlash(hz = 1) {
  stopLedFlash();
  ledFlashPhase = false;
  setLedIntensity(0);
  ledFlashTimer = setInterval(() => {
    ledFlashPhase = !ledFlashPhase;
    setLedIntensity(ledFlashPhase ? 2.5 : 0);
  }, 1000 / (hz * 2));
}

// Central state-transition function — only place that mutates deviceState.
function transitionState(next) {
  if (deviceState === next) return;
  deviceState = next;
  stopLedFlash();

  switch (next) {
    case DS.IDLE:
      setLedIntensity(0);
      if (audioOn) {
        pad.stop();
        audioOn = false;
        audioBtn.setAttribute("aria-pressed", "false");
      }
      break;

    case DS.ARMED:
      // Keep audio running if it was already on; just flash the LED.
      startLedFlash(1);
      break;

    case DS.RECORDING:
      setLedIntensity(3.0); // bright solid red
      if (!audioOn) {
        pad.start().then(() => pad.setGain(padGain));
        audioOn = true;
        audioBtn.setAttribute("aria-pressed", "true");
      }
      break;

    case DS.PLAYING:
      setLedIntensity(0);
      if (!audioOn) {
        pad.start().then(() => pad.setGain(padGain));
        audioOn = true;
        audioBtn.setAttribute("aria-pressed", "true");
      }
      break;
  }
}

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

window.addEventListener("scroll", readScroll, { passive: true });

function smoothstep(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function updateTargets(progress) {
  if (interactiveMode) {
    targetCamPos.copy(explorePose.camPos);
    targetCamLook.copy(explorePose.camLook);
    targetRot.set(explorePitch, exploreYaw, 0);
    return;
  }

  const segCount = keyframes.length - 1;
  const scaled   = progress * segCount;
  const i        = Math.min(segCount - 1, Math.floor(scaled));
  const t        = smoothstep(scaled - i);

  const a = keyframes[i];
  const b = keyframes[i + 1];

  targetCamPos.lerpVectors(a.camPos, b.camPos, t);
  targetCamLook.lerpVectors(a.camLook, b.camLook, t);
  targetRot.set(
    a.rot.x + (b.rot.x - a.rot.x) * t,
    a.rot.y + (b.rot.y - a.rot.y) * t,
    a.rot.z + (b.rot.z - a.rot.z) * t,
  );
}

function updateSections(progress) {
  const n    = sections.length;
  const step = 1 / (n - 1);

  let activeIndex = Math.round(progress / step);
  activeIndex = Math.max(0, Math.min(n - 1, activeIndex));

  const center = activeIndex * step;
  const within = Math.abs(progress - center) <= step * 0.4;

  sections.forEach((s, i) => {
    s.classList.toggle("is-active", within && i === activeIndex);
  });
}

function updateProgressBar(progress) {
  progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
}

// ── Animation loop ──────────────────────────────────────
function tick() {
  updateTargets(scrollProgress);

  camera.position.lerp(targetCamPos, LERP);
  currentCamLook.lerp(targetCamLook, LERP);
  camera.lookAt(currentCamLook);

  currentRot.x += (targetRot.x - currentRot.x) * LERP;
  currentRot.y += (targetRot.y - currentRot.y) * LERP;
  currentRot.z += (targetRot.z - currentRot.z) * LERP;
  modelGroup.rotation.copy(currentRot);

  // Reel speed depends on device state + temporary rocker boost
  if (reelGroup && !reelDragging) {
    const boosted = performance.now() < reelBoostUntil;
    let speed;
    if (deviceState === DS.ARMED) {
      speed = 0; // tape pauses while armed / cued
    } else if (deviceState === DS.RECORDING || deviceState === DS.PLAYING) {
      speed = boosted ? REEL_BOOST_SPEED : REEL_PLAY_SPEED;
    } else {
      speed = boosted ? REEL_BOOST_SPEED : REEL_IDLE_SPEED;
    }
    reelGroup.rotation.y += speed;
  }

  updateSections(scrollProgress);
  updateProgressBar(scrollProgress);

  renderer.render(scene, camera);
  updateDeviceClip();

  // Cursor update — RAF-throttled so raycasts don't back up the event queue
  if (interactiveMode && model && !dragging && !reelDragging) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((_mouseX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((_mouseY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    // Merge reel + model hits into one sorted list so an interactive mesh
    // anywhere in the stack wins, even if the body shell is in front of it.
    const allHits = [
      ...(reelGroup ? raycaster.intersectObject(reelGroup, true) : []),
      ...raycaster.intersectObject(model, true),
    ].sort((a, b) => a.distance - b.distance);

    if (allHits.length === 0) {
      canvas.style.cursor = "";
    } else if (allHits.some((h) => INTERACTIVE_MESH_NAMES.has(h.object.name))) {
      canvas.style.cursor = "pointer";
    } else {
      canvas.style.cursor = "grab";
    }
  }

  requestAnimationFrame(tick);
}
tick();

// ── Resize ──────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// ── Audio ────────────────────────────────────────────────
const pad = createAmbientPad();
let audioOn = false;

themeBtn.addEventListener("click", () => {
  applyTheme(currentTheme === "light" ? "dark" : "light");
});

let _savedScrollY = 0; // scroll position held while explore mode is active

function setMode(mode) {
  const next = mode === "explore";
  if (next === interactiveMode) return;
  interactiveMode = next;

  // ── Visual state first — button responds at the same frame as the click,
  //    before any layout-triggering DOM work (overflow, scrollTo, classList).
  modeOptions.forEach((opt) =>
    opt.classList.toggle("is-active", opt.dataset.mode === mode),
  );

  if (interactiveMode) {
    // ── Entering explore ────────────────────────────────────
    // Freeze the viewport before toggling the class so scrollY is still valid.
    _savedScrollY = window.scrollY;
    // Lock scroll on <html> too — body-only overflow:hidden can still scroll
    // in some browsers when the scroll root is the document element.
    document.documentElement.style.overflow = "hidden";
    document.body.classList.add("is-interactive");
    // Snap device to neutral front pose
    exploreYaw   = 0;
    explorePitch = 0;
  } else {
    // ── Leaving explore ─────────────────────────────────────
    document.body.classList.remove("is-interactive");
    document.documentElement.style.overflow = "";
    // Restore the exact scroll position the user was at before exploring,
    // then sync scrollProgress so the camera snaps back correctly.
    window.scrollTo(0, _savedScrollY);
    readScroll();
    canvas.style.cursor = "";
    transitionState(DS.IDLE);
  }
}

// pointerdown fires on initial press (not on release like click) — makes the
// switch feel instant, like a hardware toggle. The canvas pointerdown handler
// never fires here: the canvas is not an ancestor of these buttons, so events
// don't bubble to it regardless.
modeOptions.forEach((opt) =>
  opt.addEventListener("pointerdown", () => setMode(opt.dataset.mode)),
);

// ── Device interaction mesh map ─────────────────────────
// Mesh names were identified by inspecting the loaded GLB at runtime.
// Transport buttons each have a base + cap mesh that move together.
const BUTTON_GROUPS = {
  rec:    { meshes: ["Cube002", "Cube009", "Plane005"], action: "rec" },
  play:   { meshes: ["Cube003", "Cube010"],             action: "play" },
  stop:   { meshes: ["Cube004", "Cube011"],             action: "stop" },
  plus:   { meshes: ["Cylinder003"],                    action: "plus" },
  minus:  { meshes: ["Cylinder002"],                    action: "minus" },
  rocker: { meshes: ["Cube001_1", "Cube001_2"],         action: "rocker" },
  knob:   { meshes: ["Cylinder_1", "Cylinder_2", "Cylinder_3", "Cylinder_4"], action: "knob" },
};
const PRESS_DEPTH   = 0.012;
const PRESS_DOWN_MS = 80;
const PRESS_UP_MS   = 180;
const VOL_STEP      = 0.12;
const VOL_MIN       = 0.05;
const VOL_MAX       = 0.90;

// Flat set of all interactive mesh names — used for cursor detection.
const INTERACTIVE_MESH_NAMES = new Set(
  Object.values(BUTTON_GROUPS).flatMap((g) => g.meshes),
);

function buttonGroupForMesh(name) {
  for (const [key, group] of Object.entries(BUTTON_GROUPS)) {
    if (group.meshes.includes(name)) return key;
  }
  return null;
}

function meshesForGroup(key) {
  if (!model) return [];
  const names = BUTTON_GROUPS[key].meshes;
  const out   = [];
  model.traverse((o) => { if (o.isMesh && names.includes(o.name)) out.push(o); });
  return out;
}

// Short press-depth animation: translate down then bounce back.
// Local −Y maps to "into the device face" after the pivot's x = π/2 rotation.
function pressButton(key) {
  const meshes = meshesForGroup(key);
  if (!meshes.length) return;
  meshes.forEach((m) => {
    if (m.userData.baseY === undefined) m.userData.baseY = m.position.y;
  });
  const start = performance.now();
  const total = PRESS_DOWN_MS + PRESS_UP_MS;
  function step(now) {
    const t = now - start;
    let offset;
    if (t >= total) {
      offset = 0;
    } else if (t < PRESS_DOWN_MS) {
      offset = -PRESS_DEPTH * (t / PRESS_DOWN_MS);
    } else {
      const u = (t - PRESS_DOWN_MS) / PRESS_UP_MS;
      offset = -PRESS_DEPTH * (1 - u * u);
    }
    meshes.forEach((m) => (m.position.y = m.userData.baseY + offset));
    if (t < total) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Knob: rotate ±30° then spring back — tactile sense of a click-detent turn.
function animateKnob(direction) {
  const meshes = meshesForGroup("knob");
  if (!meshes.length) return;
  meshes.forEach((m) => {
    if (m.userData.knobBaseZ === undefined) m.userData.knobBaseZ = m.rotation.z;
  });
  const PEAK    = (Math.PI / 6) * direction;
  const HALF_MS = 160;
  const start   = performance.now();
  function step(now) {
    const t     = Math.min(1, (now - start) / (HALF_MS * 2));
    // Triangle wave with smooth ends: ramp to PEAK at t=0.5, return at t=1
    const phase = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
    const ease  = phase * phase * (3 - 2 * phase); // smoothstep
    meshes.forEach((m) => (m.rotation.z = m.userData.knobBaseZ + PEAK * ease));
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      meshes.forEach((m) => (m.rotation.z = m.userData.knobBaseZ));
    }
  }
  requestAnimationFrame(step);
}

function changeVolume(delta) {
  padGain = Math.max(VOL_MIN, Math.min(VOL_MAX, padGain + delta));
  if (audioOn) pad.setGain(padGain);
}

// Full TP-7 state machine:
//   REC    IDLE→ARMED, ARMED→IDLE (cancel), RECORDING→IDLE (stop rec), PLAYING→ARMED
//   PLAY   IDLE→PLAYING, ARMED→RECORDING, RECORDING→PLAYING, PLAYING→IDLE
//   STOP   any→IDLE
//   +/−    volume up / down
//   ROCKER turbo-boost reel for REEL_BOOST_MS
//   KNOB   visual rotate + small volume nudge
function handleButtonAction(key) {
  const action = BUTTON_GROUPS[key].action;
  switch (action) {
    case "rec":
      switch (deviceState) {
        case DS.IDLE:      transitionState(DS.ARMED);     break;
        case DS.ARMED:     transitionState(DS.IDLE);      break; // cancel arm
        case DS.RECORDING: transitionState(DS.IDLE);      break; // stop recording
        case DS.PLAYING:   transitionState(DS.ARMED);     break; // cue next take
      }
      break;

    case "play":
      switch (deviceState) {
        case DS.IDLE:      transitionState(DS.PLAYING);   break;
        case DS.ARMED:     transitionState(DS.RECORDING); break; // start recording
        case DS.RECORDING: transitionState(DS.PLAYING);   break; // stop rec, monitor
        case DS.PLAYING:   transitionState(DS.IDLE);      break; // stop
      }
      break;

    case "stop":
      transitionState(DS.IDLE);
      break;

    case "plus":
      changeVolume(+VOL_STEP);
      break;

    case "minus":
      changeVolume(-VOL_STEP);
      break;

    case "rocker":
      // Boost reel speed (fast-forward / rewind feel) for a short burst
      reelBoostUntil = performance.now() + REEL_BOOST_MS;
      break;

    case "knob":
      animateKnob(+1);
      changeVolume(+VOL_STEP * 0.5);
      break;
  }
}

// ── Raycaster ────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc       = new THREE.Vector2();

// ── Unified pointer state ────────────────────────────────
let dragging      = false;
let lastPointerX  = 0;
let lastPointerY  = 0;
let pointerDownAt = { x: 0, y: 0, t: 0 };

canvas.addEventListener("pointerdown", (e) => {
  if (!interactiveMode) return;
  // Never absorb clicks that land inside the topbar — those belong to the
  // UI controls (mode-switch, theme, audio). Without this guard, a miss by
  // a few pixels below the pill would setPointerCapture on the canvas and
  // silently swallow the subsequent pointerup, making the button feel broken.
  if (topbarEl && e.clientY <= topbarEl.getBoundingClientRect().bottom) return;
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };

  // Reel hit-test takes priority — hitting the disc starts a manual spin.
  if (reelGroup && model) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(reelGroup, true).length > 0) {
      reelDragging = true;
      lastPointerX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }
  }

  // Standard device-rotation drag
  dragging     = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
});

canvas.addEventListener("pointermove", (e) => {
  if (reelDragging) {
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    if (reelGroup) reelGroup.rotation.y += dx * 0.04;
    return;
  }
  if (!dragging) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  exploreYaw  += dx * 0.006;
  // Clamp pitch so the user can tilt but not flip the model.
  explorePitch = Math.max(-0.7, Math.min(0.7, explorePitch + dy * 0.005));
});

function endDrag(e) {
  reelDragging = false;
  dragging     = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  if (interactiveMode) canvas.style.cursor = "grab";
}

canvas.addEventListener("pointerup", (e) => {
  const wasReel = reelDragging;
  endDrag(e);

  // Tap-to-click: only trigger if the pointer barely moved AND was brief.
  if (!interactiveMode || !model || wasReel) return;
  const dx = e.clientX - pointerDownAt.x;
  const dy = e.clientY - pointerDownAt.y;
  const dt = performance.now() - pointerDownAt.t;
  if (Math.hypot(dx, dy) > 6 || dt > 350) return;

  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  // Check all hits (not just hits[0]) so body-shell geometry doesn't block
  // clicks on the button meshes underneath it.
  const hits = raycaster.intersectObject(model, true);
  const hit = hits.find((h) => buttonGroupForMesh(h.object.name));
  if (!hit) return;

  const key = buttonGroupForMesh(hit.object.name);
  pressButton(key);
  handleButtonAction(key);
});

canvas.addEventListener("pointercancel", endDrag);

// ── Hover cursor ─────────────────────────────────────────
// pointer  → hovering an interactive button
// grab     → hovering the device body or reel (draggable)
// grabbing → actively dragging (set on pointerdown, cleared on endDrag)
//
// Raycasting is throttled to one per RAF tick (in tick()) rather than running
// on every mousemove event (100+ /sec). This keeps the event queue clear so
// click events on the mode-switch buttons fire immediately.
let _mouseX = 0;
let _mouseY = 0;
canvas.addEventListener("mousemove", (e) => {
  _mouseX = e.clientX;
  _mouseY = e.clientY;
});

// ── Top-bar audio toggle ─────────────────────────────────
// Acts as a direct override / kill-switch independent of device state.
// Turning it OFF also resets the device to IDLE so the LED clears.
audioBtn.addEventListener("click", async () => {
  if (audioOn) {
    pad.stop();
    audioOn = false;
    // Collapse device to IDLE so LED / reel also reset
    stopLedFlash();
    setLedIntensity(0);
    deviceState = DS.IDLE;
  } else {
    await pad.start();
    pad.setGain(padGain);
    audioOn = true;
  }
  audioBtn.setAttribute("aria-pressed", audioOn ? "true" : "false");
});

// ── Lock toggle button widths ────────────────────────────
// Measure each pill at its initial (widest) state once fonts are loaded,
// then set min-width so the button never shrinks when the label changes
// (e.g. "light" → "dark" on the theme toggle).
document.fonts.ready.then(() => {
  document.querySelectorAll(".topbar__toggle").forEach((btn) => {
    btn.style.minWidth = btn.getBoundingClientRect().width + "px";
  });
});

readScroll();
