import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createAmbientPad } from "./audio.js";

const canvas = document.getElementById("scene");
const loaderEl = document.getElementById("loader");
const loaderBar = loaderEl.querySelector(".loader__bar span");
const progressBar = document.getElementById("progress-bar");
const sections = Array.from(document.querySelectorAll(".section"));
const audioBtn = document.getElementById("audio-toggle");
const themeBtn = document.getElementById("theme-toggle");
const modeBtn = document.getElementById("mode-toggle");

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

// ── Theme ───────────────────────────────────────────────
// Dark mode tints the white body toward warm graphite (so it sits in a black
// scene). Light mode pushes the body to near-black so the device reads as a
// solid dark object on a light page. Per-material original colors are cached
// at load time, so each tint is computed from the BASE color, not compounded.
let currentTheme = "dark";

function tintForTheme(theme, baseColor) {
  const lum =
    baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
  if (theme === "light") {
    // Crush almost every base color to near-black so the device reads as a
    // dark silhouette on the cream background. Pure-black parts stay black.
    const mult = lum > 0.05 ? 0.05 + (1 - lum) * 0.1 : 1;
    return baseColor.clone().multiplyScalar(mult);
  }
  // Dark mode: whites → graphite, darks unchanged
  const mult = 1 - lum * 0.58;
  return baseColor.clone().multiplyScalar(mult);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;

  // Re-derive material colors AND PBR knobs from cached base values. In light
  // mode we crank roughness up + add metalness offset only slightly, and we
  // drop envMapIntensity hard so the metallic body doesn't reflect the studio
  // env back as bright highlights — that's what kept it looking white before.
  if (model) {
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mat = child.material;
      const base = mat.userData.baseColor;
      if (base && mat.color) {
        mat.color.copy(tintForTheme(theme, base));
      }
      const baseR = mat.userData.baseRoughness ?? 0.5;
      const baseM = mat.userData.baseMetalness ?? 0;
      if (theme === "light") {
        mat.roughness = Math.min(1, baseR + 0.45);
        mat.metalness = Math.max(0, baseM - 0.3);
        mat.envMapIntensity = 0.12;
      } else {
        mat.roughness = baseR;
        mat.metalness = Math.min(1, baseM + 0.1);
        mat.envMapIntensity = 0.85;
      }
    });
  }

  // Lighting: in light mode the warm rim reads orange against a cream bg, and
  // the dark device needs a softer key + extra ambient to keep edges visible.
  if (theme === "light") {
    ambient.intensity = 0.65;
    keyLight.intensity = 0.7;
    rimLight.intensity = 0.25;
    rimLight.color.setHex(0xffffff);
    fillLight.intensity = 0.18;
    renderer.toneMappingExposure = 1.0;
  } else {
    ambient.intensity = 0.18;
    keyLight.intensity = 1.1;
    rimLight.intensity = 0.7;
    rimLight.color.setHex(0xffb37a);
    fillLight.intensity = 0.5;
    renderer.toneMappingExposure = 0.78;
  }

  themeBtn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
  themeBtn.querySelector(".theme-toggle__label").textContent =
    theme === "light" ? "DARK" : "LIGHT";
}

const gltfLoader = new GLTFLoader();
gltfLoader.load(
  "/assets/teenage-engineering.glb",
  (gltf) => {
    model = gltf.scene;

    // Wrap the model in a pivot so we can center vertices then scale uniformly
    // around the origin without the offset/scale ordering bug.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    const pivot = new THREE.Group();
    pivot.add(model);
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 1.5;
    pivot.scale.setScalar(targetSize / maxDim);

    // Stand the device upright in portrait: working face (+Y in GLB) toward
    // +Z (camera), long axis vertical.
    pivot.rotation.x = Math.PI / 2;

    // Cache base PBR properties once, so we can re-derive theme-specific
    // tints/material settings without compounding mutations.
    model.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mat = child.material;
      if (mat.color) {
        mat.userData.baseColor = mat.color.clone();
      }
      mat.userData.baseRoughness = mat.roughness ?? 0.5;
      mat.userData.baseMetalness = mat.metalness ?? 0;
    });

    applyTheme(currentTheme);

    modelGroup.add(pivot);
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
    loaderEl.querySelector(".loader__label").textContent = "LOAD FAILED";
  },
);

function finishLoading() {
  loaderBar.style.width = "100%";
  setTimeout(() => {
    loaderEl.classList.add("is-hidden");
    sections[0].classList.add("is-active");
  }, 250);
}

// ── Keyframes (one per section) ─────────────────────────
// Each keyframe drives camera (pos + look) and the model group rotation.
// Camera offset-x is also used to push the model off-center so overlay text
// has room — that's what makes Apple-style product pages feel composed.
// Each keyframe drives camera (pos + look) and the model group rotation.
// Device is portrait: long axis vertical, working face at +Z, so rot.y spins
// it around its own vertical (like turning the device in your hand) and
// rot.x tilts the top toward / away from camera.
const keyframes = [
  {
    // 0% — front view, model right of frame, hero text left
    camPos: new THREE.Vector3(-0.55, 0, 3.1),
    camLook: new THREE.Vector3(-0.55, 0, 0),
    rot: new THREE.Euler(0, 0, 0),
  },
  {
    // 20% — gentle rotation right, model left of frame, text right
    camPos: new THREE.Vector3(0.55, 0, 3.0),
    camLook: new THREE.Vector3(0.55, 0, 0),
    rot: new THREE.Euler(0, Math.PI / 7, 0),
  },
  {
    // 40% — close zoom on the screen (top of the device) + dial
    camPos: new THREE.Vector3(-0.5, 0.45, 2.0),
    camLook: new THREE.Vector3(-0.5, 0.4, 0),
    rot: new THREE.Euler(-0.12, Math.PI / 16, 0),
  },
  {
    // 60% — side panel with connectors (USB-C + 3.5mm jacks 1/2/3)
    camPos: new THREE.Vector3(0.55, 0, 2.4),
    camLook: new THREE.Vector3(0.55, 0, 0),
    rot: new THREE.Euler(0, -Math.PI / 2.05, 0),
  },
  {
    // 80% — view from below, "Designed in Stockholm"
    camPos: new THREE.Vector3(0, -0.85, 2.6),
    camLook: new THREE.Vector3(0, 0, 0),
    rot: new THREE.Euler(0.4, Math.PI * 1.35, 0),
  },
  {
    // 100% — return to front, slightly above and zoomed out, CTA below
    camPos: new THREE.Vector3(0, 0.3, 4.2),
    camLook: new THREE.Vector3(0, 0.1, 0),
    rot: new THREE.Euler(0, Math.PI * 2, 0),
  },
];

// ── Scroll driver ───────────────────────────────────────
let scrollProgress = 0;
const targetCamPos = new THREE.Vector3().copy(keyframes[0].camPos);
const targetCamLook = new THREE.Vector3().copy(keyframes[0].camLook);
const targetRot = new THREE.Euler().copy(keyframes[0].rot);

const currentCamLook = new THREE.Vector3().copy(keyframes[0].camLook);
const currentRot = new THREE.Euler().copy(keyframes[0].rot);

const LERP = 0.07;

// ── Interactive (explore) mode ──────────────────────────
// In explore mode, scroll-driven keyframes are bypassed: the camera holds a
// hero pose centered on the device, and the model's rotation is driven by
// pointer drag. Lets the user inspect the device freely. Subsequent work will
// add raycaster-driven control interactions on top of this.
let interactiveMode = false;
const explorePose = {
  camPos: new THREE.Vector3(0, 0, 2.6),
  camLook: new THREE.Vector3(0, 0, 0),
};
let exploreYaw = 0;
let explorePitch = 0;

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
  const scaled = progress * segCount;
  const i = Math.min(segCount - 1, Math.floor(scaled));
  const t = smoothstep(scaled - i);

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
  // Pick the single section nearest to the current scroll progress and only
  // activate that one — so two overlay texts never share the screen.
  const n = sections.length;
  const step = 1 / (n - 1);

  let activeIndex = Math.round(progress / step);
  activeIndex = Math.max(0, Math.min(n - 1, activeIndex));

  // Add a small dead-band near each section's center so the text holds put,
  // and fades cleanly during the transition between adjacent keyframes.
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

  updateSections(scrollProgress);
  updateProgressBar(scrollProgress);

  renderer.render(scene, camera);
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

// ── Ambient audio ───────────────────────────────────────
const pad = createAmbientPad();
let audioOn = false;

themeBtn.addEventListener("click", () => {
  applyTheme(currentTheme === "light" ? "dark" : "light");
});

modeBtn.addEventListener("click", () => {
  interactiveMode = !interactiveMode;
  document.body.classList.toggle("is-interactive", interactiveMode);
  modeBtn.setAttribute("aria-pressed", interactiveMode ? "true" : "false");
  modeBtn.querySelector(".mode-toggle__label").textContent = interactiveMode
    ? "BACK"
    : "EXPLORE";
  if (interactiveMode) {
    // Snap rotation state to a clean front pose so the device "settles" facing
    // the user when entering interactive mode, regardless of scroll position.
    exploreYaw = 0;
    explorePitch = 0;
  }
});

// Pointer drag → rotate device in interactive mode. Capture the pointer so a
// drag that wanders off the canvas still tracks until release.
let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener("pointerdown", (e) => {
  if (!interactiveMode) return;
  dragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  exploreYaw += dx * 0.006;
  // Clamp pitch so the user can tilt up/down a bit without flipping the model.
  explorePitch = Math.max(-0.7, Math.min(0.7, explorePitch + dy * 0.005));
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch (_) {}
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ── Device interactions ─────────────────────────────────
// In explore mode, a click on the canvas fires a raycast against the device.
// If the hit mesh is part of one of the three transport buttons at the bottom
// of the device, we play a short press animation (translate the button down
// then bounce back) and route the press to the audio engine. Mesh names below
// were identified by inspecting the loaded GLB at runtime — record/play/stop
// each consist of a base + cap mesh that move together.
// Mesh names mapped to controls. The bottom transport trio (rec/play/stop)
// each has a base + cap mesh that move together. Side controls (rocker, +/-,
// knob) get press feedback only; their audio behavior would need real
// scrubbing/level controls that the synthesized pad doesn't expose.
const BUTTON_GROUPS = {
  rec: { meshes: ["Cube002", "Cube009", "Plane005"], action: "rec" },
  play: { meshes: ["Cube003", "Cube010"], action: "play" },
  stop: { meshes: ["Cube004", "Cube011"], action: "stop" },
  plus: { meshes: ["Cylinder003"], action: "plus" },
  minus: { meshes: ["Cylinder002"], action: "minus" },
  rocker: { meshes: ["Cube001_1", "Cube001_2"], action: "rocker" },
  knob: {
    meshes: ["Cylinder_1", "Cylinder_2", "Cylinder_3", "Cylinder_4"],
    action: "knob",
  },
  reel: {
    meshes: ["Cylinder001", "Cylinder011", "Cylinder011_1"],
    action: "reel",
  },
};
const PRESS_DEPTH = 0.012;
const PRESS_DOWN_MS = 80;
const PRESS_UP_MS = 180;

function buttonGroupForMesh(name) {
  for (const [key, group] of Object.entries(BUTTON_GROUPS)) {
    if (group.meshes.includes(name)) return key;
  }
  return null;
}

function meshesForGroup(key) {
  if (!model) return [];
  const names = BUTTON_GROUPS[key].meshes;
  const out = [];
  model.traverse((o) => {
    if (o.isMesh && names.includes(o.name)) out.push(o);
  });
  return out;
}

function pressButton(key) {
  const meshes = meshesForGroup(key);
  if (meshes.length === 0) return;
  // Cache the resting Y position once per mesh so repeated presses always
  // animate from the same baseline regardless of in-flight animations.
  meshes.forEach((m) => {
    if (m.userData.baseY === undefined) m.userData.baseY = m.position.y;
  });
  const start = performance.now();
  const total = PRESS_DOWN_MS + PRESS_UP_MS;
  // Local -Y on the model after the pivot's x=π/2 rotation maps to world -Z,
  // i.e. INTO the device — exactly the press direction we want.
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

function setAudio(on) {
  if (on === audioOn) return;
  if (on) pad.start();
  else pad.stop();
  audioOn = on;
  audioBtn.setAttribute("aria-pressed", audioOn ? "true" : "false");
  audioBtn.querySelector(".audio-toggle__label").textContent = audioOn
    ? "SOUND ON"
    : "SOUND OFF";
}

function handleButtonAction(key) {
  const action = BUTTON_GROUPS[key].action;
  // Audio engine is just on/off — map controls to that vocabulary:
  //   rec / play / + → start the pad
  //   stop / -        → stop the pad
  //   rocker / knob / reel → press feedback only
  if (action === "rec" || action === "play" || action === "plus") {
    setAudio(true);
  } else if (action === "stop" || action === "minus") {
    setAudio(false);
  }
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointerDownAt = { x: 0, y: 0, t: 0 };

canvas.addEventListener("pointerdown", (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});

canvas.addEventListener("pointerup", (e) => {
  if (!interactiveMode || !model) return;
  const dx = e.clientX - pointerDownAt.x;
  const dy = e.clientY - pointerDownAt.y;
  const dt = performance.now() - pointerDownAt.t;
  // Treat as a click only if the pointer barely moved AND the press was brief
  // — anything bigger is interpreted as a rotate drag and ignored.
  if (Math.hypot(dx, dy) > 6 || dt > 350) return;

  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(model, true);
  if (hits.length === 0) return;

  const key = buttonGroupForMesh(hits[0].object.name);
  if (!key) return;
  pressButton(key);
  handleButtonAction(key);
});

audioBtn.addEventListener("click", async () => {
  if (!audioOn) {
    await pad.start();
    audioOn = true;
    audioBtn.setAttribute("aria-pressed", "true");
    audioBtn.querySelector(".audio-toggle__label").textContent = "SOUND ON";
  } else {
    pad.stop();
    audioOn = false;
    audioBtn.setAttribute("aria-pressed", "false");
    audioBtn.querySelector(".audio-toggle__label").textContent = "SOUND OFF";
  }
});

readScroll();
