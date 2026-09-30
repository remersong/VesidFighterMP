// 3D "paper puppet" view. The fighters are still drawn by the 2D renderer,
// each onto its own transparent card, and the cards stand in a Three.js
// scene: a floating platform, lighting and real cast shadows, and a camera
// that frames both fighters like Smash. Turning around flips the card like
// a sheet of paper. Gameplay is untouched -- the sim is still 2D (x/y) and
// this only changes how a frame is presented.
//
// Loaded as an ES module (Three.js ships as modules), so it arrives after
// the classic scripts; Game.render falls back to the 2D renderer until
// window.Renderer3D exists.

import * as THREE from 'three';

const S = 1 / 100; // game pixels -> 3D units
const toX = (gx) => (gx - CANVAS_WIDTH / 2) * S;
const toY = (gy) => (GROUND_Y - gy) * S;

// Each card covers this much game space around its fighter, with the
// fighter's feet at (CARD_W / 2, FEET_Y). Sized for the biggest case
// (Robert transformed, ~300px tall) plus auras and the block shield.
const CARD_W = 800;
const CARD_H = 680;
const FEET_Y = 580;
const CARD_RES = 1.25; // texture pixels per game pixel
const FLIP_SECONDS = 0.14;

const STORAGE_KEY = 'vf_view3d';

const overlay = document.getElementById('game-canvas');
const canvas = document.createElement('canvas');
canvas.id = 'game-canvas-3d';
overlay.parentNode.insertBefore(canvas, overlay);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 200);

function resize() {
  const w = canvas.clientWidth || CANVAS_WIDTH;
  const h = canvas.clientHeight || CANVAS_HEIGHT;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
}
new ResizeObserver(resize).observe(canvas);

// ---- Environment ----

function gradientTexture(stops, w = 4, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) grad.addColorStop(t, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

scene.background = gradientTexture([[0, '#140a22'], [0.55, '#3a2160'], [1, '#6b3fa0']]);
scene.fog = new THREE.Fog('#3a2458', 16, 60);

scene.add(new THREE.HemisphereLight('#c9b6ff', '#1c1030', 1.1));

const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
sun.position.set(-3, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -5, near: 1, far: 30 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const rim = new THREE.DirectionalLight('#b48cff', 1.2);
rim.position.set(5, 3, -8);
scene.add(rim);

// Platform: same footprint as the 2D stage (edges are where you fall off).
const PLAT_W = (STAGE_RIGHT_EDGE - STAGE_LEFT_EDGE) * S;
const PLAT_X = toX((STAGE_LEFT_EDGE + STAGE_RIGHT_EDGE) / 2);
const PLAT_DEPTH = 3.4;
const PLAT_Z = -0.5;
const PLAT_THICK = 0.55;

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5a4d7a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = 'rgba(20,10,40,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (let y = 0; y <= 128; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.setLineDash([10, 10]);
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 128); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const sideMat = new THREE.MeshStandardMaterial({ color: '#3c3354', roughness: 0.9 });
const topMat = new THREE.MeshStandardMaterial({ map: tileTexture(), roughness: 0.8 });
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(PLAT_W, PLAT_THICK, PLAT_DEPTH),
  [sideMat, sideMat, topMat, sideMat, sideMat, sideMat],
);
platform.position.set(PLAT_X, -PLAT_THICK / 2, PLAT_Z);
platform.receiveShadow = true;
scene.add(platform);

// Glowing trim along the front and side edges.
const trimMat = new THREE.MeshStandardMaterial({ color: '#b3a3e0', emissive: '#6a4fb0', emissiveIntensity: 0.9, roughness: 0.4 });
const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(PLAT_W + 0.08, 0.07, 0.07), trimMat);
frontTrim.position.set(PLAT_X, -0.02, PLAT_Z + PLAT_DEPTH / 2);
scene.add(frontTrim);
for (const side of [-1, 1]) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, PLAT_DEPTH), trimMat);
  t.position.set(PLAT_X + side * (PLAT_W / 2 + 0.02), -0.02, PLAT_Z);
  scene.add(t);
}

// Rocky underside so it reads as a floating island.
const rockMat = new THREE.MeshStandardMaterial({ color: '#2a2140', roughness: 1, flatShading: true });
const underside = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.12, 1, 7, 3), rockMat);
underside.scale.set(PLAT_W * 0.5, 2.6, PLAT_DEPTH * 0.5);
underside.position.set(PLAT_X, -PLAT_THICK - 1.3, PLAT_Z);
scene.add(underside);

// Distant floating islands for parallax.
function addIsland(x, y, z, s) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.25, 7), new THREE.MeshStandardMaterial({ color: '#4b3f6b', roughness: 0.9, flatShading: true }));
  const bottom = new THREE.Mesh(new THREE.ConeGeometry(1, 1.8, 7), rockMat);
  bottom.rotation.x = Math.PI;
  bottom.position.y = -1.02;
  g.add(top, bottom);
  g.position.set(x, y, z);
  g.scale.setScalar(s);
  g.userData.bob = Math.random() * Math.PI * 2;
  g.userData.baseY = y;
  scene.add(g);
  return g;
}
// Kept low and far so they sit around the horizon, clear of the HUD.
const islands = [
  addIsland(-13, 0.2, -24, 1.5),
  addIsland(14, 1.2, -30, 1.9),
  addIsland(-3, 2.2, -42, 1.6),
  addIsland(8, -2.2, -18, 0.9),
  addIsland(-20, -1.8, -34, 1.7),
];

// Stars.
{
  const n = 500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const r = 70 + Math.random() * 20;
    pos[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
    pos[i * 3 + 1] = Math.cos(phi) * r * 0.6 + 5;
    pos[i * 3 + 2] = -Math.abs(Math.sin(theta) * Math.sin(phi) * r) - 20;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.25, fog: false, transparent: true, opacity: 0.8 })));
}

// Glowing orbs drifting behind the stage (the 2D version's "crowd dots").
const orbs = [];
{
  const orbGeo = new THREE.SphereGeometry(0.12, 12, 8);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? '#d9c7ff' : '#ffd98a', transparent: true, opacity: 0.55 }));
    m.position.set((Math.random() - 0.5) * 26, Math.random() * 7 + 0.5, -6 - Math.random() * 10);
    m.userData.phase = Math.random() * Math.PI * 2;
    m.userData.baseY = m.position.y;
    scene.add(m);
    orbs.push(m);
  }
}

// ---- Fighter cards ----

function makeCard(z) {
  const c = document.createElement('canvas');
  c.width = Math.round(CARD_W * CARD_RES);
  c.height = Math.round(CARD_H * CARD_RES);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W * S, CARD_H * S),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.castShadow = true;
  // Cast the silhouette, not the whole rectangle.
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  mesh.renderOrder = 2;
  scene.add(mesh);

  // Soft contact shadow under the feet.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;
  scene.add(blob);

  return { canvas: c, ctx: c.getContext('2d'), tex, mesh, blob, z, rotY: 0 };
}

const cards = { p1: makeCard(0.03), p2: makeCard(-0.03) };

function updateCard(card, f, dt) {
  const { ctx, canvas: c } = card;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(CARD_RES, 0, 0, CARD_RES, (CARD_W / 2 - f.x) * CARD_RES, (FEET_Y - f.y) * CARD_RES);
  Renderer.drawFighter(ctx, f, { card: true });
  card.tex.needsUpdate = true;

  // Paper flip: rotate toward the facing side instead of snapping.
  const target = f.facing > 0 ? 0 : Math.PI;
  const step = (Math.PI / FLIP_SECONDS) * dt;
  const diff = target - card.rotY;
  card.rotY = Math.abs(diff) <= step ? target : card.rotY + Math.sign(diff) * step;

  const m = card.mesh;
  m.visible = true;
  m.position.set(toX(f.x), toY(f.y - FEET_Y + CARD_H / 2), card.z);
  m.rotation.y = card.rotY;

  const overStage = f.x > STAGE_LEFT_EDGE && f.x < STAGE_RIGHT_EDGE;
  const height = Math.max(0, GROUND_Y - f.y) * S;
  const k = Math.max(0.25, 1 - height / 2.4);
  card.blob.visible = overStage && f.y <= GROUND_Y + 1;
  card.blob.position.set(toX(f.x), 0.004, card.z);
  card.blob.scale.set(f.width * S * 0.42 * k, f.width * S * 0.16 * k, 1);
  card.blob.material.opacity = 0.38 * k;
}

// ---- Projectiles + particles sheet ----
// One transparent sheet spanning the arena, just in front of the cards.
// Drawn by the existing 2D effect code in plain game coordinates.
const FX_PAD = 200; // extra room below the canvas for ring-out sparks
const fxCanvas = document.createElement('canvas');
fxCanvas.width = CANVAS_WIDTH;
fxCanvas.height = CANVAS_HEIGHT + FX_PAD;
const fxCtx = fxCanvas.getContext('2d');
const fxTex = new THREE.CanvasTexture(fxCanvas);
fxTex.colorSpace = THREE.SRGBColorSpace;
const fxSheet = new THREE.Mesh(
  new THREE.PlaneGeometry(fxCanvas.width * S, fxCanvas.height * S),
  new THREE.MeshBasicMaterial({ map: fxTex, transparent: true, depthWrite: false, depthTest: false }),
);
fxSheet.position.set(toX(CANVAS_WIDTH / 2), toY(fxCanvas.height / 2), 0.08);
fxSheet.renderOrder = 3;
scene.add(fxSheet);

function updateFx(projectiles) {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  Renderer.drawProjectiles(fxCtx, projectiles);
  Effects.draw(fxCtx);
  fxTex.needsUpdate = true;
}

// ---- Camera ----
const camTarget = new THREE.Vector3(0, 1.4, 0);
const camPos = new THREE.Vector3(0, 3, 13);
let lastRender = performance.now();

function frameCamera(state, dt, t) {
  let tx, ty, dist;
  if (state) {
    const a = state.p1, b = state.p2;
    const ax = toX(a.x), bx = toX(b.x);
    // Don't chase a fighter all the way down a ring-out.
    const ay = Math.max(toY(a.y), -1.2), by = Math.max(toY(b.y), -1.2);
    const tallest = Math.max(a.height, b.height) * S;
    const spanX = Math.abs(ax - bx) + 2.8;
    const spanY = Math.abs(ay - by) + tallest + 1.6;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    dist = Math.max(spanY / 2 / tanV, spanX / 2 / (tanV * camera.aspect));
    dist = THREE.MathUtils.clamp(dist, 7, 16);
    tx = THREE.MathUtils.clamp((ax + bx) / 2, -3.2, 3.2);
    ty = Math.max((ay + by) / 2 + tallest * 0.55, 0.9);
  } else {
    // Menus: slow drift over the empty stage.
    tx = Math.sin(t * 0.00012) * 1.5;
    ty = 1.2;
    dist = 13;
  }
  const k = 1 - Math.exp(-dt * 5);
  camTarget.lerp(new THREE.Vector3(tx, ty, 0), k);
  camPos.lerp(new THREE.Vector3(tx * 0.9, ty + dist * 0.17, dist), k);

  const shake = Effects.getShakeOffset();
  camera.position.set(camPos.x + shake.x * S, camPos.y - shake.y * S, camPos.z);
  camera.lookAt(camTarget.x + shake.x * S, camTarget.y - shake.y * S, camTarget.z);
}

// ---- Public API ----

let active = true;
try { active = localStorage.getItem(STORAGE_KEY) !== '0'; } catch (e) { /* storage blocked */ }

function applyActive() {
  canvas.style.display = active ? '' : 'none';
  overlay.classList.toggle('overlay-3d', active);
}
applyActive();

function render(state) {
  const now = performance.now();
  const dt = Math.min((now - lastRender) / 1000, 0.1);
  lastRender = now;

  if (state) {
    updateCard(cards.p1, state.p1, dt);
    updateCard(cards.p2, state.p2, dt);
    updateFx(state.projectiles);
  } else {
    for (const c of Object.values(cards)) { c.mesh.visible = false; c.blob.visible = false; }
    fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    fxTex.needsUpdate = true;
  }
  fxSheet.visible = !!state;

  for (const isl of islands) {
    isl.position.y = isl.userData.baseY + Math.sin(now * 0.0005 + isl.userData.bob) * 0.25;
  }
  for (const o of orbs) {
    o.position.y = o.userData.baseY + Math.sin(now * 0.0008 + o.userData.phase) * 0.3;
  }

  frameCamera(state, dt, now);
  renderer.render(scene, camera);
}

window.Renderer3D = {
  isActive: () => active,
  setActive(v) {
    active = !!v;
    try { localStorage.setItem(STORAGE_KEY, active ? '1' : '0'); } catch (e) { /* storage blocked */ }
    applyActive();
  },
  render,
};
window.dispatchEvent(new Event('renderer3d-ready'));
