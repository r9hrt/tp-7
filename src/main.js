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
renderer.toneMappingExposure = 1.05;

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
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(2.5, 3.5, 2.5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xfff0e8, 0.6);
rimLight.position.set(-3, 1.5, -2);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xffe5d1, 0.7, 8);
fillLight.position.set(-1.5, 0.5, 2);
scene.add(fillLight);

// ── Model group ─────────────────────────────────────────
const modelGroup = new THREE.Group();
scene.add(modelGroup);

let model = null;

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

    // Stand the device up: working face (+Y in GLB) toward +Z (camera).
    // Then rotate around Y so the device's long axis runs left-right (landscape).
    pivot.rotation.x = Math.PI / 2;
    pivot.rotation.y = Math.PI / 2;

    model.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.envMapIntensity = 0.9;
      }
    });

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
// Camera offset-x pushes the model off-center so overlay text has room.
// Working face is already pointing at +Z (see pivot.rotation.x above), so
// rot.y rotates around the device's vertical axis like turning it in hand.
const keyframes = [
  {
    // 0% — front view, model right of frame, hero text left
    camPos: new THREE.Vector3(-0.4, 0.05, 2.3),
    camLook: new THREE.Vector3(-0.4, 0, 0),
    rot: new THREE.Euler(0, 0, 0),
  },
  {
    // 20% — gentle rotation right, model left of frame, text right
    camPos: new THREE.Vector3(0.55, 0.05, 2.2),
    camLook: new THREE.Vector3(0.55, 0, 0),
    rot: new THREE.Euler(0, Math.PI / 7, 0),
  },
  {
    // 40% — close zoom on the screen + transport keys
    camPos: new THREE.Vector3(-0.35, 0.1, 1.4),
    camLook: new THREE.Vector3(-0.35, 0.1, 0),
    rot: new THREE.Euler(-0.18, Math.PI / 14, 0),
  },
  {
    // 60% — back of the device (connectors, materials)
    camPos: new THREE.Vector3(0.5, 0.05, 2.2),
    camLook: new THREE.Vector3(0.5, 0, 0),
    rot: new THREE.Euler(0, Math.PI, 0),
  },
  {
    // 80% — view from below, "Designed in Stockholm"
    camPos: new THREE.Vector3(0, -0.55, 2.0),
    camLook: new THREE.Vector3(0, 0.05, 0),
    rot: new THREE.Euler(0.5, Math.PI * 1.4, 0),
  },
  {
    // 100% — return to front, centered, CTA
    camPos: new THREE.Vector3(0, 0, 2.8),
    camLook: new THREE.Vector3(0, 0, 0),
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
  const n = sections.length;
  const step = 1 / (n - 1);
  const halfWindow = step * 0.55;

  sections.forEach((s, i) => {
    const center = i * step;
    const dist = Math.abs(progress - center);
    s.classList.toggle("is-active", dist <= halfWindow);
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
