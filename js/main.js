import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EngineAudio } from './engine-audio.js';

/* ============================================================
   Sozlamalar
   ============================================================ */
const MODEL_URL = './audi_r8.glb';
const CAR_LENGTH = 4.43;            // metr (haqiqiy R8 uzunligi)
const DOOR_ANGLE = THREE.MathUtils.degToRad(54);
const BG = new THREE.Color(0x050608);
const TOP_SPEED = 301;              // km/soat
const REDLINE = 8000;
const IDLE = 900;
const GEAR_TOP = [62, 105, 150, 198, 250, 312]; // har uzatmaning 8000 ayl/daq dagi tezligi

const COLORS = [
  { name: 'Misano qizil', hex: '#b3121c' },
  { name: 'Ibis oq', hex: '#e9eaec' },
  { name: 'Daytona kulrang', hex: '#565a61' },
  { name: 'Mythos qora', hex: '#0c0c0f' },
  { name: 'Sepang ko\'k', hex: '#17408f' },
  { name: 'Vegas sariq', hex: '#e2b007' },
  { name: 'Kyalami yashil', hex: '#2c8a3c' },
];

// Har bir bo'lim uchun kamera holati: az/el — gradusda, r — metrda,
// sx/sy — mashinani ekranda surish (ekran ulushi), door — eshik ochiqligi.
const KEYS = {
  hero:   { az: -32,  el: 9,  r: 7.4, t: [0, 0.55, 0],       sx: 0.17,  sy: 0,    door: 0 },
  design: { az: -90,  el: 5,  r: 7.9, t: [0, 0.55, 0],       sx: -0.19, sy: 0,    door: 0 },
  salon:  { az: -126, el: 16, r: 6.4, t: [-0.3, 0.6, -0.1],  sx: 0.24,  sy: 0,    door: 1 },
  engine: { az: -207, el: 26, r: 5.8, t: [0, 0.6, -0.7],     sx: -0.16, sy: 0,    door: 0 },
  speed:  { az: -322, el: 7,  r: 7.2, t: [0, 0.6, 0],        sx: 0.04,  sy: 0.17, door: 0 },
  final:  { az: -398, el: 32, r: 10,  t: [0, 0.4, 0],        sx: 0,     sy: 0.24, door: 0 },
};

const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = (cur, goal, lambda, dt) => cur + (goal - cur) * (1 - Math.exp(-lambda * dt));
const smooth = (x) => x * x * (3 - 2 * x);

/* ============================================================
   Renderer, sahna, kamera
   ============================================================ */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = BG;
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 300);

scene.environment = buildEnvironment();
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(-4, 7, 5);
scene.add(keyLight, new THREE.AmbientLight(0xffffff, 0.15));

// Post-processing (yumshoq bloom)
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.6, 1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 2.6;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.autoRotateSpeed = 0.9;
controls.target.set(0, 0.55, 0);

/* ============================================================
   Muhit: studiya chiroqlari (aks etish uchun)
   ============================================================ */
function buildEnvironment() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x030304);
  const panel = (w, h, pos, intensity, color = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(9, 3.2, [0, 7, 0], 3.2);               // tepadagi softboks
  panel(12, 0.5, [-8, 2.6, 0], 6);             // yon chiziqlar
  panel(12, 0.5, [8, 2.6, 0], 6);
  panel(5, 1.6, [0, 3.5, 9], 3, 0xdfe8ff);     // old
  panel(5, 1.6, [0, 3.5, -9], 3.5, 0xffe6d6);  // orqa
  panel(3, 3, [-6, 5, -6], 2);
  panel(3, 3, [6, 5, 6], 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

/* ============================================================
   Pol, soya, tezlik chiziqlari
   ============================================================ */
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uBg: { value: BG }, uOffset: { value: 0 }, uSpeed: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vPos;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vPos = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uBg; uniform float uOffset; uniform float uSpeed;
    varying vec3 vPos;
    void main() {
      float d = length(vPos.xz);
      vec3 col = mix(vec3(0.030, 0.032, 0.038), uBg, smoothstep(1.5, 15.0, d));
      // nozik panjara
      vec2 g = vec2(vPos.x, vPos.z + uOffset);
      vec2 gw = abs(fract(g - 0.5) - 0.5) / fwidth(g);
      float grid = 1.0 - min(min(gw.x, gw.y), 1.0);
      col += grid * 0.03 * (1.0 - smoothstep(2.5, 13.0, d));
      // harakat paytidagi yo'l chiziqlari
      float lane = smoothstep(0.075, 0.03, abs(abs(vPos.x) - 2.05));
      float dash = step(0.45, fract((vPos.z + uOffset) / 7.0));
      float fade = 1.0 - smoothstep(10.0, 45.0, d);
      col += lane * dash * fade * uSpeed * vec3(0.38);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

function radialTexture(stops, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(3.3, 6.2),
  new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,.95)'], [0.45, 'rgba(0,0,0,.8)'], [0.75, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']]),
    transparent: true, depthWrite: false,
  }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.006;
shadow.renderOrder = 1;
scene.add(shadow);

// Faralar yoqilganda yo'lga tushadigan yorug'lik
const poolMat = new THREE.MeshBasicMaterial({
  map: radialTexture([[0, 'rgba(225,232,255,.7)'], [0.35, 'rgba(190,205,255,.28)'], [1, 'rgba(160,180,255,0)']]),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
});
const pools = new THREE.Group();
for (const x of [-0.62, 0.62]) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 6.4), poolMat);
  p.rotation.x = -Math.PI / 2;
  p.position.set(x * 1.1, 0.008, 4.9);
  p.renderOrder = 2;
  pools.add(p);
}
scene.add(pools);

// Tezlik chiziqlari
const STREAKS = 280;
const streakData = [];
const streakPos = new Float32Array(STREAKS * 6);
for (let i = 0; i < STREAKS; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  streakData.push({
    x: side * (1.5 + Math.random() ** 1.6 * 11),
    y: 0.06 + Math.random() ** 1.4 * 3.4,
    z: (Math.random() * 2 - 1) * 45,
    k: 0.55 + Math.random() * 0.9,
  });
}
const streakGeo = new THREE.BufferGeometry();
streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
const streakMat = new THREE.LineBasicMaterial({
  color: 0xcfe0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
});
const streaks = new THREE.LineSegments(streakGeo, streakMat);
streaks.frustumCulled = false;
streaks.visible = false;
scene.add(streaks);

/* ============================================================
   Modelni yuklash va qismlarga ajratish
   ============================================================ */
const car = new THREE.Group();        // butun mashina
const body = new THREE.Group();       // kuzov + eshiklar (tebranadi)
const doorL = new THREE.Group();
const doorR = new THREE.Group();
const wheels = [];                    // { pivot }
car.add(body);
scene.add(car);

let paintMat = null;
let lightsMat = null;
let loaded = false;

// Geometriyani bog'langan bo'laklarga ajratib, classify(box) qaytargan kalit bo'yicha guruhlaydi.
// Model material bo'yicha birlashtirilgan — eshik va g'ildiraklar shu yo'l bilan ajratib olinadi.
function splitByComponents(geo, classify) {
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const weld = new Map();
  const vid = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 4000)},${Math.round(pos.getY(i) * 4000)},${Math.round(pos.getZ(i) * 4000)}`;
    let id = weld.get(key);
    if (id === undefined) { id = weld.size; weld.set(key, id); }
    vid[i] = id;
  }
  const parent = new Uint32Array(weld.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(vid[index[t]]);
    parent[find(vid[index[t + 1]])] = a;
    parent[find(vid[index[t + 2]])] = a;
  }
  const comps = new Map();
  const v = new THREE.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const root = find(vid[index[t]]);
    let c = comps.get(root);
    if (!c) { c = { box: new THREE.Box3(), tris: [] }; comps.set(root, c); }
    for (let k = 0; k < 3; k++) {
      c.box.expandByPoint(v.fromBufferAttribute(pos, index[t + k]));
      c.tris.push(index[t + k]);
    }
  }
  const groups = new Map();
  for (const c of comps.values()) {
    const key = classify(c.box);
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    for (let i = 0; i < c.tris.length; i++) arr.push(c.tris[i]);
  }
  const out = new Map();
  for (const [key, arr] of groups) {
    const g = new THREE.BufferGeometry();
    for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
    g.setIndex(arr);
    g.boundingSphere = null;
    out.set(key, g);
  }
  return out;
}

// Bo'lak to'liq eshik hududida joylashganmi? (metrda, mashina markaziga nisbatan)
function doorSide(box) {
  const { min, max } = box;
  if (min.y < 0.17 || max.y > 1.16) return null;
  if (min.z < -0.57 || max.z > 0.84) return null;
  if (max.x < -0.555 && min.x > -1.06) return 'doorL';
  if (min.x > 0.555 && max.x < 1.06) return 'doorR';
  return null;
}

function setupModel(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const s = CAR_LENGTH / size.z;
  const fix = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));

  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });

  // Materiallar
  const seen = new Set();
  for (const m of meshes) {
    const mat = m.material;
    if (seen.has(mat)) continue;
    seen.add(mat);
    if (mat.name === 'Meshpart2Mtl') {
      paintMat = new THREE.MeshPhysicalMaterial({
        name: 'Paint', color: COLORS[0].hex, metalness: 0.55, roughness: 0.36,
        clearcoat: 1, clearcoatRoughness: 0.035, side: THREE.DoubleSide, envMapIntensity: 1.1,
      });
    }
    if (mat.name === 'Meshpart16Mtl') lightsMat = mat;
    if (mat.name === 'Rim1Mtl') { mat.roughness = 0.26; mat.metalness = 0.9; mat.envMapIntensity = 0.55; }
    // Sketchfab deyarli hamma narsani BLEND deb belgilaydi — shaffof bo'lmaganlarini tuzatamiz
    if (mat.transparent && mat.opacity >= 0.8) {
      mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
    } else if (mat.transparent) {
      mat.depthWrite = false;
    }
  }

  const wheelBoxes = {};
  const wheelParts = {};
  const doorBoxes = { doorL: new THREE.Box3(), doorR: new THREE.Box3() };

  for (const m of meshes) {
    const geo = m.geometry;
    geo.applyMatrix4(m.matrixWorld);
    geo.applyMatrix4(fix);
    const name = m.material.name;
    const material = name === 'Meshpart2Mtl' ? paintMat : m.material;
    const isTire = name === 'Tire1Mtl';
    const isWheel = isTire || name === 'Rim1Mtl';

    const parts = splitByComponents(geo, (box) => {
      if (isWheel) {
        const c = box.getCenter(new THREE.Vector3());
        const key = `w${c.x < 0 ? 'L' : 'R'}${c.z > 0 ? 'F' : 'B'}`;
        if (isTire) (wheelBoxes[key] ||= new THREE.Box3()).union(box);
        return key;
      }
      const d = doorSide(box);
      if (d) { doorBoxes[d].union(box); return d; }
      return 'body';
    });

    for (const [key, g] of parts) {
      const mesh = new THREE.Mesh(g, material);
      mesh.renderOrder = material.transparent ? 3 : 0;
      if (key === 'body') body.add(mesh);
      else if (key === 'doorL') doorL.add(mesh);
      else if (key === 'doorR') doorR.add(mesh);
      else (wheelParts[key] ||= []).push(mesh);
    }
  }

  // Eshik o'qlari: eshikning old chekkasida, vertikal
  for (const [grp, key, sign] of [[doorL, 'doorL', -1], [doorR, 'doorR', 1]]) {
    const b = doorBoxes[key];
    if (b.isEmpty()) continue;
    const hinge = new THREE.Vector3(sign * 0.865, 0, b.max.z - 0.03);
    grp.position.copy(hinge);
    grp.children.forEach((c) => c.position.copy(hinge).negate());
    body.add(grp);
  }

  // G'ildiraklar: har biri o'z o'qi atrofida aylanadi
  for (const key in wheelParts) {
    const b = wheelBoxes[key];
    if (!b) { wheelParts[key].forEach((m) => car.add(m)); continue; }
    const c = b.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    wheelParts[key].forEach((m) => { m.position.copy(c).negate(); pivot.add(m); });
    car.add(pivot);
    wheels.push({ pivot, radius: (b.max.y - b.min.y) / 2 });
  }

  loaded = true;
}

/* ============================================================
   Holat
   ============================================================ */
const sections = [...document.querySelectorAll('.panel')];
const keyList = sections.map((s) => KEYS[s.dataset.key]);
const state = {
  prog: 0, activeIndex: 0, exploring: false,
  yawOff: 0, pitchOff: 0, dragging: false, lastDrag: -10,
  door: 0, doorToggle: false, lightsToggle: false, lightLevel: 0,
  // tezlik simulyatsiyasi
  gas: false, brake: false, v: 0, gear: 0, rpm: IDLE, shiftT: 0, accel: 0, dist: 0, maxV: 0,
  timer: 0, timing: false, armed: true,
};
const cur = { az: KEYS.hero.az, el: 30, r: 13, tx: 0, ty: 0.55, tz: 0, sx: 0, sy: 0, fov: 35 };
const goal = { ...cur };
const audio = new EngineAudio();

function isPortrait() { return window.innerWidth / window.innerHeight < 0.95 || window.innerWidth <= 860; }

function updateScrollGoal() {
  const mid = window.scrollY + window.innerHeight / 2;
  const centers = sections.map((s) => s.offsetTop + s.offsetHeight / 2);
  let i = 0;
  while (i < centers.length - 2 && mid > centers[i + 1]) i++;
  const f = clamp((mid - centers[i]) / (centers[i + 1] - centers[i]), 0, 1);
  // har bo'limda biroz "to'xtab turish" uchun
  const e = smooth(clamp((f - 0.22) / 0.56, 0, 1));
  const a = keyList[i], b = keyList[i + 1];
  state.prog = i + f;
  state.activeIndex = Math.round(i + f);

  const aspect = window.innerWidth / window.innerHeight;
  const portrait = isPortrait();
  const fit = Math.max(1, 1.08 / aspect);
  goal.az = lerp(a.az, b.az, e) + state.yawOff;
  goal.el = clamp(lerp(a.el, b.el, e) + state.pitchOff, 2, 70);
  goal.r = lerp(a.r, b.r, e) * fit;
  goal.tx = lerp(a.t[0], b.t[0], e);
  goal.ty = lerp(a.t[1], b.t[1], e);
  goal.tz = lerp(a.t[2], b.t[2], e);
  goal.sx = portrait ? 0 : lerp(a.sx, b.sx, e);
  goal.sy = portrait ? 0.2 : lerp(a.sy, b.sy, e);
  state.doorScroll = lerp(a.door, b.door, e);

  const max = document.documentElement.scrollHeight - window.innerHeight;
  progressFill.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max, 0, 1) : 0})`;
}

/* ============================================================
   Tezlik simulyatsiyasi
   ============================================================ */
function updateSpeed(dt) {
  const s = state;
  const active = sections[s.activeIndex]?.dataset.key === 'speed' && !s.exploring;
  if (!active) { s.gas = false; }
  const braking = s.brake || (!active && s.v > 0);

  if (s.shiftT > 0) s.shiftT -= dt;
  const drive = s.gas && s.shiftT <= 0 ? 1 : 0;

  let a = 0; // km/soat sekundiga
  if (drive) a = 30 * (1 - s.v / 322);
  else a = -(3 + s.v * 0.035);
  if (braking) a = -75;
  s.v = clamp(s.v + a * dt, 0, TOP_SPEED);
  s.accel = damp(s.accel, drive ? a / 30 : (braking && s.v > 0 ? -1.2 : 0), 6, dt);

  // uzatmalar
  let rpmTarget = (s.v / GEAR_TOP[s.gear]) * REDLINE;
  if (s.gas && rpmTarget > 7750 && s.gear < GEAR_TOP.length - 1) {
    s.gear++; s.shiftT = 0.16;
  } else if (s.gear > 0 && (s.v / GEAR_TOP[s.gear - 1]) * REDLINE < (s.gas ? 3600 : 5200)) {
    s.gear--;
  }
  rpmTarget = (s.v / GEAR_TOP[s.gear]) * REDLINE;
  if (s.gear === 0) rpmTarget = Math.max(rpmTarget, s.gas ? 2600 : IDLE); // ilashish muftasi sirpanishi
  rpmTarget = clamp(rpmTarget, IDLE, 8150);
  s.rpm = damp(s.rpm, rpmTarget, s.shiftT > 0 ? 9 : 14, dt);

  s.dist += (s.v / 3.6) * dt;
  s.maxV = Math.max(s.maxV, s.v);

  // 0–100 sekundomeri
  if (s.v < 0.5) { s.timing = false; s.armed = true; }
  if (s.armed && s.gas && s.v >= 0.5) { s.armed = false; s.timing = true; s.timer = 0; hud0100.textContent = '…'; }
  if (s.timing) {
    s.timer += dt;
    if (s.v >= 100) { s.timing = false; hud0100.textContent = `${s.timer.toFixed(1)} s`; }
    else if (!s.gas) { s.timing = false; hud0100.textContent = '—'; }
  }

  if (audio.ready) {
    audio.setActive(active || s.v > 2);
    const wobble = s.rpm < 1100 ? Math.sin(performance.now() / 90) * 25 : 0;
    audio.update(s.rpm + wobble, drive ? 1 : (s.gas ? 0.2 : 0), s.v / TOP_SPEED);
  }

  // HUD
  setText(hudSpeed, Math.round(s.v));
  setText(hudGear, s.v < 1 && !s.gas ? 'N' : s.gear + 1);
  setText(hudRpm, Math.round(s.rpm / 50) * 50);
  setText(hudMax, Math.round(s.maxV));
  rpmFill.style.transform = `scaleX(${clamp(s.rpm / REDLINE, 0, 1).toFixed(3)})`;
  hud.classList.toggle('redline', s.rpm > 7200);
}

const textCache = new WeakMap();
function setText(el, val) {
  if (textCache.get(el) === val) return;
  textCache.set(el, val);
  el.textContent = val;
}

/* ============================================================
   Kadr
   ============================================================ */
const clock = new THREE.Clock();
const tmpTarget = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const s = state;

  updateScrollGoal();
  updateSpeed(dt);
  const k = s.v / TOP_SPEED;            // 0..1 tezlik ulushi

  // sudrab aylantirish asta-sekin joyiga qaytadi
  if (!s.dragging && t - s.lastDrag > 1.6) {
    s.yawOff = damp(s.yawOff, 0, 1.6, dt);
    s.pitchOff = damp(s.pitchOff, 0, 1.6, dt);
  }

  // ---- kamera
  cur.sx = damp(cur.sx, s.exploring ? 0 : goal.sx, 3.5, dt);
  cur.sy = damp(cur.sy, s.exploring ? 0 : goal.sy, 3.5, dt);
  if (s.exploring) {
    cur.fov = damp(cur.fov, 35, 4, dt);
    controls.update();
  } else {
    const L = 4.2;
    cur.az = damp(cur.az, goal.az, L, dt);
    cur.el = damp(cur.el, goal.el, L, dt);
    cur.r = damp(cur.r, goal.r * (1 - 0.1 * k), L, dt);
    cur.tx = damp(cur.tx, goal.tx, L, dt);
    cur.ty = damp(cur.ty, goal.ty, L, dt);
    cur.tz = damp(cur.tz, goal.tz, L, dt);
    cur.fov = damp(cur.fov, 35 + 17 * k, 4, dt);
    const az = THREE.MathUtils.degToRad(cur.az), el = THREE.MathUtils.degToRad(cur.el);
    tmpTarget.set(cur.tx, cur.ty, cur.tz);
    camera.position.set(
      cur.tx + cur.r * Math.sin(az) * Math.cos(el),
      cur.ty + cur.r * Math.sin(el),
      cur.tz + cur.r * Math.cos(az) * Math.cos(el),
    );
    // tezlikda kamera titrashi
    const shake = k * k * 0.035;
    camera.position.x += (Math.sin(t * 37.1) + Math.sin(t * 61.7)) * shake;
    camera.position.y += (Math.sin(t * 43.3) + Math.sin(t * 71.9)) * shake * 0.7;
    camera.lookAt(tmpTarget);
  }
  if (Math.abs(camera.fov - cur.fov) > 0.01) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
  const w = window.innerWidth, h = window.innerHeight;
  if (Math.abs(cur.sx) > 0.001 || Math.abs(cur.sy) > 0.001) camera.setViewOffset(w, h, -cur.sx * w, cur.sy * h, w, h);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();

  // ---- mashina
  if (loaded) {
    // eshiklar
    const doorGoal = k > 0.005 ? 0 : (s.exploring ? (s.doorToggle ? 1 : 0) : s.doorScroll);
    s.door = damp(s.door, doorGoal, 3.2, dt);
    const d = smooth(clamp(s.door, 0, 1)) * DOOR_ANGLE;
    doorL.rotation.y = d;
    doorR.rotation.y = -d;

    // g'ildiraklar
    const ms = s.v / 3.6;
    for (const wl of wheels) wl.pivot.rotation.x += (ms / wl.radius) * dt;

    // kuzov: gazda orqaga cho'kadi, dvigateldan titraydi
    const running = audio.ready && audio.active ? 1 : 0;
    body.rotation.x = -s.accel * 0.014;
    body.position.y = Math.sin(t * 55) * (0.0009 * running + 0.0022 * k) + Math.max(0, s.accel) * -0.006;
    body.rotation.z = Math.sin(t * 31) * 0.0012 * k;

    // chiroqlar
    const lightsOn = s.lightsToggle || s.v > 1 || (!s.exploring && sections[s.activeIndex]?.dataset.key === 'speed');
    s.lightLevel = damp(s.lightLevel, lightsOn ? 1 : 0, 4, dt);
    if (lightsMat) lightsMat.emissiveIntensity = lerp(0.5, 7, s.lightLevel);
    poolMat.opacity = s.lightLevel * 0.2;
  }

  // ---- tezlik effektlari
  floorMat.uniforms.uOffset.value = s.dist % 1400;
  floorMat.uniforms.uSpeed.value = Math.min(1, k * 3);
  bloom.strength = 0.2 + 0.25 * k;
  streaks.visible = k > 0.01;
  if (streaks.visible) {
    const ms = s.v / 3.6;
    const len = 0.3 + k * 9;
    for (let i = 0; i < STREAKS; i++) {
      const p = streakData[i];
      p.z -= ms * p.k * dt;
      if (p.z < -45) p.z += 90;
      const o = i * 6;
      streakPos[o] = p.x; streakPos[o + 1] = p.y; streakPos[o + 2] = p.z;
      streakPos[o + 3] = p.x; streakPos[o + 4] = p.y; streakPos[o + 5] = p.z + len * p.k;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakMat.opacity = Math.min(0.4, k * 1.1);
  }

  composer.render();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/* ============================================================
   UI
   ============================================================ */
const progressFill = $('#progress-fill');
const hud = $('#hud'), hudSpeed = $('#hud-speed'), hudGear = $('#hud-gear'), hudRpm = $('#hud-rpm');
const hudMax = $('#hud-max'), hud0100 = $('#hud-0100'), rpmFill = $('#rpm-fill');
const btnGas = $('#btn-gas'), btnBrake = $('#btn-brake'), btnSound = $('#btn-sound');

// Rang tanlash
function setColor(i) {
  const c = COLORS[i];
  if (paintMat) paintMat.color.set(c.hex);
  $('#color-name').textContent = c.name;
  document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
}
document.querySelectorAll('[data-swatches]').forEach((row) => {
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.i = i;
    b.style.setProperty('--c', c.hex);
    b.title = c.name; b.setAttribute('aria-label', c.name);
    b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => setColor(i));
    row.appendChild(b);
  });
});

// Pedallar
function hold(btn, onChange) {
  const set = (v) => { btn.classList.toggle('held', v); onChange(v); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch { /* ahamiyatsiz */ }
    set(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => set(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // klaviatura (Enter/Space) bilan ham bosib turish mumkin
  btn.addEventListener('keydown', (e) => { if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) { e.preventDefault(); e.stopPropagation(); set(true); } });
  btn.addEventListener('keyup', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.stopPropagation(); set(false); } });
  btn.addEventListener('blur', () => set(false));
}
hold(btnGas, (v) => { if (v) audio.start(); state.gas = v; });
hold(btnBrake, (v) => { state.brake = v; });

btnSound.addEventListener('click', () => {
  const on = btnSound.getAttribute('aria-pressed') !== 'true';
  btnSound.setAttribute('aria-pressed', String(on));
  btnSound.textContent = on ? 'Ovoz: yoniq' : 'Ovoz: o\'chiq';
  audio.setMuted(!on);
});

const speedActive = () => sections[state.activeIndex]?.dataset.key === 'speed' && !state.exploring;
window.addEventListener('keydown', (e) => {
  if (!speedActive() || e.target.closest?.('button, a, input')) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) { audio.start(); state.gas = true; btnGas.classList.add('held'); }
  } else if (e.code === 'ArrowDown') {
    e.preventDefault();
    state.brake = true; btnBrake.classList.add('held');
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { state.gas = false; btnGas.classList.remove('held'); }
  if (e.code === 'ArrowDown') { state.brake = false; btnBrake.classList.remove('held'); }
});
window.addEventListener('blur', () => {
  state.gas = state.brake = false;
  btnGas.classList.remove('held'); btnBrake.classList.remove('held');
});

// Sichqoncha bilan sudrab aylantirish (scroll rejimida)
let lastX = 0, lastY = 0;
window.addEventListener('pointerdown', (e) => {
  if (state.exploring || e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest('button, a, input, .hud, .topbar, .dots')) return;
  state.dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  document.body.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  state.yawOff -= (e.clientX - lastX) * 0.28;
  state.pitchOff = clamp(state.pitchOff + (e.clientY - lastY) * 0.16, -12, 40);
  lastX = e.clientX; lastY = e.clientY;
  state.lastDrag = clock.elapsedTime;
});
const endDrag = () => {
  if (!state.dragging) return;
  state.dragging = false;
  state.lastDrag = clock.elapsedTime;
  document.body.classList.remove('dragging');
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('scroll', () => { if (!state.dragging) state.lastDrag = Math.min(state.lastDrag, clock.elapsedTime - 1.2); }, { passive: true });

// Erkin ko'rish rejimi
const tgDoors = $('#tg-doors'), tgLights = $('#tg-lights'), tgSpin = $('#tg-spin');
function setExplore(on) {
  if (state.exploring === on) return;
  state.exploring = on;
  document.body.classList.toggle('exploring', on);
  $('#explore').setAttribute('aria-hidden', String(!on));
  controls.enabled = on;
  if (on) {
    state.gas = state.brake = false;
    controls.target.set(0, 0.55, 0);
    controls.autoRotate = tgSpin.getAttribute('aria-pressed') === 'true';
    // qulay boshlang'ich masofa
    const dir = camera.position.clone().sub(controls.target);
    dir.setLength(clamp(dir.length(), 5.5, 9) * (isPortrait() ? 1.25 : 1));
    camera.position.copy(controls.target).add(dir);
  } else {
    // kamera hozirgi joyidan scroll holatiga silliq qaytadi
    const d = camera.position.clone().sub(controls.target);
    cur.r = d.length();
    cur.el = THREE.MathUtils.radToDeg(Math.asin(clamp(d.y / cur.r, -1, 1)));
    let az = THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z));
    az += 360 * Math.round((goal.az - az) / 360);
    cur.az = az;
    cur.tx = controls.target.x; cur.ty = controls.target.y; cur.tz = controls.target.z;
    state.yawOff = state.pitchOff = 0;
  }
}
$('#explore-open').addEventListener('click', () => setExplore(true));
$('#explore-open-2').addEventListener('click', () => setExplore(true));
$('#explore-close').addEventListener('click', () => setExplore(false));
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') setExplore(false); });
controls.addEventListener('start', () => { controls.autoRotate = false; tgSpin.setAttribute('aria-pressed', 'false'); });

const toggle = (btn, fn) => btn.addEventListener('click', () => {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  fn(on);
});
toggle(tgDoors, (on) => { state.doorToggle = on; });
toggle(tgLights, (on) => { state.lightsToggle = on; });
toggle(tgSpin, (on) => { controls.autoRotate = on; });

// Bo'limlar paydo bo'lishi, navigatsiya, sanagichlar
const navLinks = [...document.querySelectorAll('.topnav a')];
const dotLinks = [...document.querySelectorAll('.dots a')];
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    en.target.classList.toggle('in', en.isIntersecting);
    if (en.isIntersecting) {
      const id = en.target.id;
      navLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${id}`));
      dotLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${id}`));
      en.target.querySelectorAll('[data-count]:not(.done)').forEach(countUp);
    }
  }
}, { rootMargin: '-45% 0px -45% 0px' });

function countUp(el) {
  el.classList.add('done');
  const to = parseFloat(el.dataset.count), dec = +(el.dataset.dec || 0), t0 = performance.now(), dur = 1400;
  const step = (now) => {
    const p = clamp((now - t0) / dur, 0, 1);
    el.textContent = (to * (1 - (1 - p) ** 3)).toFixed(dec);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ============================================================
   Ishga tushirish
   ============================================================ */
const loaderFill = $('#loader-fill'), loaderPct = $('#loader-pct');
resize();
requestAnimationFrame(frame);

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    setupModel(gltf);
    setColor(0);
    loaderFill.style.width = '100%';
    loaderPct.textContent = '100%';
    renderer.compile(scene, camera);
    setTimeout(() => {
      document.body.classList.remove('loading');
      sections.forEach((s) => io.observe(s));
    }, 350);
  },
  (e) => {
    const total = e.total || 3345044;
    const p = Math.min(99, Math.round((e.loaded / total) * 100));
    loaderFill.style.width = `${p}%`;
    loaderPct.textContent = `${p}%`;
  },
  (err) => {
    console.error(err);
    const row = document.querySelector('.loader-row');
    row.innerHTML = '<span class="loader-error">Modelni yuklab bo\'lmadi. Saytni lokal server orqali oching (start.command).</span>';
  },
);

// Sinov/disk raskadrovka uchun
window.__r8 = { state, setExplore, setColor, audio };
