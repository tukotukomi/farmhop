// Betty Lou's Farm Hop: hop across the farm before the sun sets, then grow the Fish Pond back home.
// One cell = one world unit. Row r sits at z = -r, so "forward" is -z.
// Playable columns are -COLS..COLS. The world is drawn wider than that, and
// the cells outside the playable strip are shaded darker, like Crossy Road.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMusic } from './music.js';

// ---------- tuning ----------
const COLS = 4;                 // playable columns either side of centre
const VIS = 16;                 // columns drawn either side
const SPAN = 2 * VIS + 10;      // loop length that moving things wrap around
const AHEAD = 27, BEHIND = 22;  // rows kept around the camera
const HOP_T = 0.13;             // seconds per hop
const CAM_OFF = new THREE.Vector3(2.4, 5.6, 7.2); // behind-right, a low 36° look across the fields
const _feet = new THREE.Vector3();
// Is a spot on the ground (x, z) below the bottom edge of the screen? Hoppers can't back off-screen.
const belowScreen = (x, z) => _feet.set(x, 0, z).project(camera).y < -0.92;
const RAINBOW = [0xff4b4b, 0xff9a2e, 0xffd93b, 0x5fd35f, 0x46a6ff, 0x9b6bff];
const GREENS = [0x5cb83a, 0x4faa38, 0x68c444, 0x55b03f];

const rand = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Difficulty. The opening is calm: OPEN rows of plain grass, the centre column
// kept clear on grass until STRAIGHT, one hazard lane at a time, slow traffic
// with wide gaps. warm() fades that easing out; diff() keeps ramping speed and
// density after that. Tougher hazards unlock by row.
// PACE stretches every one of those distances: at PACE 2 the curve climbs half
// as fast as at PACE 1 (row 100 plays like row 50 did), and full difficulty
// arrives at row 460 instead of 230. Row numbers below are in PACE-1 terms.
const PACE = 2;
const OPEN = 8 * PACE, STRAIGHT = 25 * PACE;
const UNLOCK = Object.fromEntries(Object.entries({ pasture: 8, water: 10, pads: 15, wagon: 18, multiRoad: 20, wheat: 25, geese: 25, kayak: 30, bull: 40, crops: 60, pastureBull: 80 }).map(([k, v]) => [k, v * PACE]));
const diff = r => clamp((r - 10 * PACE) / (220 * PACE), 0, 1);
const warm = r => clamp(r / (60 * PACE), 0, 1);
const speedK = r => 0.6 + 0.4 * warm(r);
const gapK = r => 1.7 - 0.7 * warm(r);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2f6e3a);
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, -60, 120);

const hemi = new THREE.HemisphereLight(0xfff4ec, 0x7d6fa8, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dc, 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-5, 12, 4);

// ---------- cel shading ----------
// Lighting snaps to flat bands via a toon gradient, then a screen-space pass
// draws ink outlines wherever depth or surface direction jumps.
function ramp(levels) {
  const t = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
// Two looks: "cel" (soft three-band toon, plum ink) and "bold" (hard two-tone
// shadows that match the unlit sides, thick black ink, punchier colour).
const LOOKS = {
  cel: { ramp: ramp([95, 175, 255]), sky: 0xfff4ec, ground: 0x7d6fa8, hemi: 1.15, sun: 2.9, ink: 0x2b1d33, inkMix: 0.9, line: 1, sat: 1 },
  bold: { ramp: ramp([0, 255]), sky: 0xfff6f0, ground: 0xfff6f0, hemi: 2.1, sun: 1.5, ink: 0x000000, inkMix: 1, line: 1.6, sat: 1.3 },
};
const toons = [];
let look = LOOKS.cel;
const toon = opts => {
  const m = new THREE.MeshToonMaterial({ gradientMap: look.ramp, ...opts });
  toons.push(m);
  return m;
};

const INK = new THREE.Color(0x2b1d33);
const rtColor = new THREE.WebGLRenderTarget(1, 1, { samples: 4, stencilBuffer: true });
rtColor.texture.colorSpace = THREE.SRGBColorSpace;
const rtNormal = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
rtNormal.depthTexture = new THREE.DepthTexture(1, 1);
const normalMat = new THREE.MeshNormalMaterial();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: rtColor.texture },
    tNormal: { value: rtNormal.texture },
    tDepth: { value: rtNormal.depthTexture },
    texel: { value: new THREE.Vector2() },
    texelN: { value: new THREE.Vector2() },
    depthRange: { value: camera.far - camera.near },
    ink: { value: INK },
    inkMix: { value: 0.9 },
    grade: { value: new THREE.Color(1, 1, 1) },   // time-of-day tint over the whole picture
    sat: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `
    uniform sampler2D tColor, tNormal, tDepth;
    uniform vec2 texel, texelN;  // silhouette lines vs thinner interior lines
    uniform float depthRange;
    uniform vec3 ink;
    uniform float inkMix, sat;
    uniform vec3 grade;
    varying vec2 vUv;
    float D(vec2 uv) { return texture2D(tDepth, uv).x * depthRange; }
    vec3 N(vec2 uv) { return texture2D(tNormal, uv).xyz; }
    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, sat), 0.) * grade;
      vec2 dx = vec2(texel.x, 0.), dy = vec2(0., texel.y);
      float dc = D(vUv);
      // second difference: flat (even sloped) ground cancels out, steps don't
      float de = max(abs(D(vUv - dx) + D(vUv + dx) - 2. * dc), abs(D(vUv - dy) + D(vUv + dy) - 2. * dc));
      vec3 nc = N(vUv);
      vec2 nx = vec2(texelN.x, 0.), ny = vec2(0., texelN.y);
      float ne = max(max(distance(nc, N(vUv + nx)), distance(nc, N(vUv - nx))),
                     max(distance(nc, N(vUv + ny)), distance(nc, N(vUv - ny))));
      float edge = max(smoothstep(0.04, 0.09, de), smoothstep(0.25, 0.45, ne));
      gl_FragColor = vec4(mix(col, ink, edge * inkMix), 1.);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
renderer.shadowMap.autoUpdate = false;

const GLOW_LAYER = 1;
function renderCel() {
  renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(rtColor);
  camera.layers.enable(GLOW_LAYER);    // glowing bits (fireflies) are drawn but get no ink outline
  renderer.render(scene, camera);
  camera.layers.disable(GLOW_LAYER);
  const bg = scene.background;
  scene.overrideMaterial = normalMat;
  scene.background = null;
  renderer.setRenderTarget(rtNormal);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.background = bg;
  renderer.setRenderTarget(null);
  renderer.render(postQuad, postCam);
}
let lineScale = 1;
function resizeCel() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  rtColor.setSize(size.x, size.y);
  rtNormal.setSize(size.x, size.y);
  // lines about 2 CSS px wide on phones, never thinner than one pixel
  const dpr = renderer.getPixelRatio();
  const px = Math.max(1, dpr * lineScale), pn = Math.max(1, dpr * Math.min(lineScale, 1));
  postMat.uniforms.texel.value.set(px / size.x, px / size.y);
  postMat.uniforms.texelN.value.set(pn / size.x, pn / size.y);
}
function applyLook(name) {
  const L = look = LOOKS[name] || LOOKS.cel;
  for (const m of toons) m.gradientMap = L.ramp;
  hemi.color.setHex(L.sky);
  hemi.groundColor.setHex(L.ground);
  hemi.intensity = L.hemi;
  sun.intensity = L.sun;
  INK.setHex(L.ink);
  postMat.uniforms.inkMix.value = L.inkMix;
  postMat.uniforms.sat.value = L.sat;
  lineScale = L.line;
  resizeCel();
}

// ---------- the farming day ----------
// Daylight (1 = full, 0 = night) runs down while you dawdle and comes back with
// every new row reached. When it runs out, night falls and the farming day is
// over. The drain matches the old camera creep: on average you need to reach
// that many new rows per second to keep the sun up.
const DAY_GAIN = 0.05;   // daylight per new row
const dayDrain = r => DAY_GAIN * (0.22 + 0.12 * warm(r) + 0.3 * diff(r));
// Lighting keyframes: daylight, sun colour, sun strength, sky, ground bounce,
// ambient strength, whole-picture tint, sun height (lower = longer shadows).
const DAY_KEYS = [
  [1.0, 0xfff3dc, 1.0, 0xfff4ec, 0x7d6fa8, 1.0, 0xffffff, 12],    // midday
  [0.45, 0xffcf94, 1.0, 0xffe4c8, 0x8a6fa8, 0.95, 0xfff0dc, 7],    // golden hour
  [0.2, 0xffd6c4, 0.8, 0xdcc8ff, 0x6a5aa0, 0.9, 0xece4fa, 4],    // dusk: lavender, grass stays green
  [0.0, 0xa8bcff, 0.5, 0x7088d0, 0x30306a, 0.72, 0x93a8ee, 6],    // night, moonlit blue
];
const _ca = new THREE.Color(), _cb = new THREE.Color();
const mixHex = (a, b, t, out) => out.copy(_ca.setHex(a)).lerp(_cb.setHex(b), t);
function updateDay() {
  const d = clamp(game.light, 0, 1);
  let i = 0;
  while (i < DAY_KEYS.length - 2 && d < DAY_KEYS[i + 1][0]) i++;
  const A = DAY_KEYS[i], B = DAY_KEYS[i + 1], t = clamp((A[0] - d) / (A[0] - B[0]), 0, 1);
  mixHex(A[1], B[1], t, sun.color);
  sun.intensity = look.sun * lerp(A[2], B[2], t);
  mixHex(A[3], B[3], t, hemi.color);
  if (look.sky === look.ground) hemi.groundColor.copy(hemi.color);   // the Bold look keeps its flat ambient
  else mixHex(A[4], B[4], t, hemi.groundColor);
  hemi.intensity = look.hemi * lerp(A[5], B[5], t);
  mixHex(A[6], B[6], t, postMat.uniforms.grade.value);
  SUN_OFF.y = lerp(A[7], B[7], t);
}

// Fireflies come out at dusk: little glowing dots drifting around the hopper.
const flies = [];
const FLY_MAT = new THREE.MeshBasicMaterial({ color: 0xfff27a });
function updateFlies(dt) {
  if (game.day < 0.35 && game.state === 'play' && flies.length < 30 && Math.random() < dt * 14) {
    const m = new THREE.Mesh(PGEO, FLY_MAT);
    m.layers.set(GLOW_LAYER);
    m.position.set(P.x + rand(-5, 5), rand(0.3, 1.4), P.z + rand(-9, 3));
    scene.add(m);
    flies.push({ m, t: 0, life: rand(2, 4), ph: rand(0, 6) });
  }
  for (let i = flies.length - 1; i >= 0; i--) {
    const f = flies[i];
    f.t += dt;
    f.m.position.x += Math.cos(f.t * 2 + f.ph) * dt * 0.25;
    f.m.position.y += Math.sin(f.t * 3 + f.ph) * dt * 0.3;
    f.m.scale.setScalar(0.1 * Math.max(0, Math.sin(Math.PI * f.t / f.life)));
    if (f.t > f.life) { scene.remove(f.m); flies.splice(i, 1); }
  }
}

// ---------- voxel builder: many boxes -> one vertex-coloured mesh ----------
const FACES = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _w = new THREE.Vector3(), _sc = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _nm = new THREE.Matrix3();
const PRIMS = {};
const prim = (key, make) => (PRIMS[key] ||= make());
// Flat outline -> soft-edged solid, centred on z = 0 (stars, the leaf).
function extrudeShape(shape, depth, bevelSize, bevelThickness, curveSegments = 12) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, curveSegments, bevelEnabled: true, bevelSize, bevelThickness, bevelSegments: 3 });
  g.translate(0, 0, -depth / 2);
  return g;
}
const leafGeo = () => prim('leaf', () => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.bezierCurveTo(0.36, -0.3, 0.32, 0.22, 0, 0.5);
  s.bezierCurveTo(-0.32, 0.22, -0.36, -0.3, 0, -0.42);
  return extrudeShape(s, 0.07, 0.03, 0.03);
});
const VMAT = toon({ vertexColors: true });

class VB {
  // d = detail: 1 for the hoppers, lower for traffic and scenery (fewer facets per curve)
  constructor(d = 1) { this.p = []; this.n = []; this.c = []; this.i = []; this.d = d; }
  seg(n, min = 5) { return Math.max(min, Math.round(n * this.d)); }
  box(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    _c.set(color);
    const rot = rx || ry || rz;
    if (rot) _q.setFromEuler(_e.set(rx, ry, rz));
    for (const f of FACES) {
      const base = this.p.length / 3;
      _n.fromArray(f.n);
      if (rot) _n.applyQuaternion(_q);
      for (const k of f.c) {
        _v.set(k[0] * w / 2, k[1] * h / 2, k[2] * d / 2);
        if (rot) _v.applyQuaternion(_q);
        this.p.push(_v.x + x, _v.y + y, _v.z + z);
        this.n.push(_n.x, _n.y, _n.z);
        this.c.push(_c.r, _c.g, _c.b);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
  mesh(mat = VMAT) {
    const m = new THREE.Mesh(this.geometry(), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  // Append any geometry, placed, turned and scaled. `color` is a hex, or
  // (x, y, z) => hex | THREE.Color in model space, for stripes and gradients.
  add(g, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m4.compose(_w.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _sc.set(sx, sy, sz));
    _nm.getNormalMatrix(_m4);
    const pos = g.attributes.position, nor = g.attributes.normal, base = this.p.length / 3;
    const fn = typeof color === 'function';
    if (!fn) _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      if (fn) { const k = color(_v.x, _v.y, _v.z); if (typeof k === 'number') _c.set(k); else _c.copy(k); }
      this.p.push(_v.x, _v.y, _v.z);
      this.n.push(_n.x, _n.y, _n.z);
      this.c.push(_c.r, _c.g, _c.b);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < pos.count; k++) this.i.push(base + k);
    return this;
  }
  // Rounded primitives. Shared geometry is cached by size, so repeated parts are cheap to build.
  ball(rx, ry, rz, x, y, z, color, ax = 0, ay = 0, az = 0) { const a = this.seg(20, 8), b = this.seg(14, 5); return this.add(prim(`ball${a}`, () => new THREE.SphereGeometry(1, a, b)), color, x, y, z, ax, ay, az, rx, ry, rz); }
  hiBall(rx, ry, rz, x, y, z, color, ax = 0, ay = 0, az = 0) { return this.add(prim('hiBall', () => new THREE.SphereGeometry(1, 40, 28)), color, x, y, z, ax, ay, az, rx, ry, rz); }
  cap(r, len, x, y, z, color, ax = 0, ay = 0, az = 0) { const a = this.seg(6, 2), b = this.seg(14, 6); return this.add(prim(`cap${r}/${len}/${b}`, () => new THREE.CapsuleGeometry(r, len, a, b)), color, x, y, z, ax, ay, az); }
  rbox(w, h, d, x, y, z, color, rad, ax = 0, ay = 0, az = 0) { const a = this.seg(4, 2); return this.add(prim(`rbox${w}/${h}/${d}/${rad}/${a}`, () => new RoundedBoxGeometry(w, h, d, a, rad)), color, x, y, z, ax, ay, az); }
  cone(r, h, x, y, z, color, ax = 0, ay = 0, az = 0) { const a = this.seg(18, 6); return this.add(prim(`cone${r}/${h}/${a}`, () => new THREE.ConeGeometry(r, h, a)), color, x, y, z, ax, ay, az); }
  cyl(rt, rb, h, x, y, z, color, ax = 0, ay = 0, az = 0) { const a = this.seg(20, 7); return this.add(prim(`cyl${rt}/${rb}/${h}/${a}`, () => new THREE.CylinderGeometry(rt, rb, h, a)), color, x, y, z, ax, ay, az); }
  // Gable roof: a triangular prism, ridge along x, apex up; flat-shaded. h squashes its height.
  roof(w, len, h, x, y, z, color) { return this.add(prim(`roof${w}`, () => { const g = new THREE.CylinderGeometry(w / Math.sqrt(3), w / Math.sqrt(3), 1, 3).toNonIndexed(); g.computeVertexNormals(); return g; }), color, x, y, z, -Math.PI / 2, 0, Math.PI / 2, 1, len, h); }
  torus(R, tube, arc, x, y, z, color, ax = 0, ay = 0, az = 0) { const a = this.seg(10, 4), b = this.seg(28, 8); return this.add(prim(`torus${R}/${tube}/${arc}/${b}`, () => new THREE.TorusGeometry(R, tube, a, b, arc)), color, x, y, z, ax, ay, az); }
}
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

// ---------- models ----------
// The low camera lets trees and traffic stand in front of Betty Lou, so she marks
// her pixels in the stencil buffer and a flat silhouette is drawn wherever
// something else covers her.
const GIRL_MAT = toon({ vertexColors: true, stencilWrite: true, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp });
const XRAY_MAT = new THREE.MeshBasicMaterial({
  color: 0x8a5cff, transparent: true, opacity: 0.8, depthWrite: false, depthFunc: THREE.GreaterDepth,
  stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
});

// ---------- the four hoppers, built from rounded "toy" shapes ----------
const hairAt = x => RAINBOW[clamp(Math.floor((x + 0.27) / 0.54 * 6), 0, 5)];   // rainbow stripes, side to side

function buildGirl() {
  const SKIN = 0xffd3b4, DENIM = 0x3e6fd8, DENIM_D = 0x2c56b0, SHIRT = 0xff8fc8;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.075, 0.05, 0.1, s * 0.09, 0.05, -0.03, 0xffffff);          // sneakers
    b.ball(0.08, 0.022, 0.105, s * 0.09, 0.022, -0.03, 0xff5fa2);
    b.cap(0.055, 0.1, s * 0.09, 0.18, 0, DENIM);                        // legs
    b.rbox(0.13, 0.045, 0.13, s * 0.09, 0.115, 0, DENIM_D, 0.02);      // rolled cuffs
    b.ball(0.065, 0.06, 0.07, s * 0.19, 0.53, 0, SHIRT);               // puffy sleeves
    b.cap(0.038, 0.09, s * 0.2, 0.43, 0, SKIN, 0, 0, s * 0.12);        // arms
    b.ball(0.048, 0.05, 0.048, s * 0.21, 0.35, -0.01, SKIN);           // hands
    b.cap(0.022, 0.2, s * 0.08, 0.59, 0, DENIM, Math.PI / 2, 0, 0);    // straps over the shoulders
    b.ball(0.022, 0.022, 0.012, s * 0.075, 0.53, -0.148, 0xffd23f);   // buttons
    b.ball(0.032, 0.046, 0.02, s * 0.085, 0.8, -0.222, 0x222222);      // eyes
    b.ball(0.012, 0.014, 0.008, s * 0.085 + 0.01, 0.818, -0.24, 0xffffff);
    b.ball(0.04, 0.022, 0.01, s * 0.15, 0.73, -0.178, 0xff9eb5);       // cheeks
    b.ball(0.065, 0.12, 0.09, s * 0.23, 0.82, 0.08, hairAt);            // side hair, behind the cheeks
  }
  b.ball(0.2, 0.16, 0.16, 0, 0.34, 0, DENIM);                          // overalls
  b.ball(0.17, 0.13, 0.14, 0, 0.48, 0, SHIRT);                         // shirt
  b.rbox(0.2, 0.15, 0.05, 0, 0.47, -0.12, DENIM, 0.022);               // bib
  b.rbox(0.09, 0.05, 0.02, 0, 0.455, -0.146, DENIM_D, 0.008);          // bib pocket
  b.hiBall(0.25, 0.23, 0.23, 0, 0.8, 0, SKIN);                         // head
  b.hiBall(0.268, 0.17, 0.25, 0, 0.93, 0.02, hairAt);                   // rainbow hair, hairline above the eyes
  for (const x of [-0.12, -0.04, 0.04, 0.12]) b.ball(0.06, 0.04, 0.04, x, 0.885, -0.2, hairAt);  // little fringe
  b.torus(0.035, 0.009, Math.PI, 0, 0.712, -0.214, 0xc2475f, 0, 0, Math.PI); // smile
  inner.add(b.mesh());
  const tails = [];                                                    // high pigtails, puffs of rainbow
  for (const s of [-1, 1]) {
    const t = new VB();
    t.ball(0.055, 0.055, 0.055, 0, 0, 0, 0xff5fa2);
    [[0.07, 0.09, 0.075], [0.15, 0.13, 0.072], [0.23, 0.12, 0.068], [0.29, 0.06, 0.063], [0.32, -0.03, 0.058], [0.33, -0.13, 0.05]]
      .forEach(([x, y, r], i) => t.ball(r, r, r * 0.9, s * x, y, 0, RAINBOW[i]));
    tails.push(wobble(inner, t, s * 0.25, 1.0, 0.03, s));
  }
  return finishHero(group, inner, tails);
}

// Shared by every playable character: scale, stencil material, x-ray children.
// `wobbles` are pivoted meshes that bounce when hopping (pigtails, tails...);
// userData.side sets direction and userData.axis the rotation axis (default z).
function finishHero(group, inner, wobbles) {
  group.scale.setScalar(1.3);
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    m.material = GIRL_MAT;
    m.castShadow = true;
    m.add(new THREE.Mesh(m.geometry, XRAY_MAT));
  }
  return { group, inner, tails: wobbles };
}
function wobble(inner, vb, x, y, z, side, axis = 'z') {
  const m = vb.mesh();
  m.position.set(x, y, z);
  m.userData.side = side;
  m.userData.axis = axis;
  inner.add(m);
  return m;
}
// A plump cartoon star: five rounded tips, soft valleys, bevelled edges.
// `color` is a hex, or (x, y) => THREE.Color for gradients such as rainbowAt.
function starMesh(r, depth, color) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r;
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const s = new THREE.Shape();
  pts.forEach((p, i) => {
    const k = i % 2 ? 0.22 : 0.2;   // how much each corner is rounded off
    const a = p.clone().lerp(pts[(i + 9) % 10], k), b = p.clone().lerp(pts[(i + 1) % 10], k);
    if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(p.x, p.y, b.x, b.y);
  });
  s.closePath();
  return new VB().add(extrudeShape(s, depth, r * 0.07, depth * 0.4, 4), color).mesh();   // finishHero gives it the hero material
}
const rainbowAt = (x, y) => new THREE.Color().setHSL((Math.atan2(y, x) / (2 * Math.PI) + 1.25) % 1, 0.95, 0.58);

function buildAxolotl() {
  const PINK = 0xffb3d1, PINK_D = 0xff8fbf, BELLY = 0xffe0ec, GILL = 0xff4f9a, GOLD = 0xffd23f;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.07, 0.04, 0.09, s * 0.1, 0.04, -0.03, PINK_D);            // feet
    b.cap(0.05, 0.06, s * 0.1, 0.12, 0, PINK);                          // legs
    b.cap(0.04, 0.1, s * 0.2, 0.37, -0.02, PINK, 0, 0, s * 0.5);       // arms
    b.ball(0.045, 0.045, 0.045, s * 0.245, 0.29, -0.03, PINK_D);       // hands
    b.ball(0.035, 0.042, 0.02, s * 0.165, 0.745, -0.198, 0x222222);    // eyes, set wide
    b.ball(0.012, 0.014, 0.008, s * 0.165 + 0.01, 0.762, -0.215, 0xffffff);
    b.ball(0.045, 0.022, 0.01, s * 0.22, 0.665, -0.163, 0xff7aa8);    // cheeks
    b.cone(0.026, 0.1, s * 0.075, 0.95, -0.085, GOLD, -0.2, 0, -s * 0.15); // tiara side points
    b.ball(0.022, 0.022, 0.014, s * 0.075, 0.915, -0.11, GILL);
  }
  b.ball(0.2, 0.19, 0.17, 0, 0.32, 0, PINK);                           // body
  b.ball(0.13, 0.14, 0.05, 0, 0.31, -0.135, BELLY);
  b.hiBall(0.32, 0.2, 0.24, 0, 0.7, 0, PINK);                          // wide, round head
  b.torus(0.06, 0.01, Math.PI, 0, 0.655, -0.228, 0xc2475f, 0, 0, Math.PI); // wide smile
  b.torus(0.1, 0.02, Math.PI * 2, 0, 0.885, -0.01, GOLD, Math.PI / 2, 0, 0);  // tiara band
  b.cone(0.032, 0.14, 0, 0.97, -0.095, GOLD, -0.2, 0, 0);
  b.ball(0.032, 0.032, 0.02, 0, 0.93, -0.12, 0x46a6ff);                // gem
  inner.add(b.mesh());
  const wob = [];
  for (const s of [-1, 1]) {                                          // three frilly gill fronds a side
    const g = new VB();
    for (const [a, len] of [[0.9, 0.13], [0.25, 0.15], [-0.4, 0.12]]) {
      const dx = s * Math.cos(a), dy = Math.sin(a), rz = Math.atan2(-dx, dy);
      g.cap(0.03, len, dx * (len / 2 + 0.03), dy * (len / 2 + 0.03), 0, GILL, 0, 0, rz);
      g.ball(0.042, 0.042, 0.036, dx * (len + 0.06), dy * (len + 0.06), 0, 0xff8cc0);
    }
    wob.push(wobble(inner, g, s * 0.3, 0.72, 0.04, s));
  }
  const t = new VB();                                                 // wagging tail with a fin
  t.ball(0.07, 0.075, 0.16, 0, 0, 0.12, PINK);
  t.ball(0.022, 0.1, 0.13, 0, 0.03, 0.2, PINK_D);
  wob.push(wobble(inner, t, 0, 0.26, 0.13, 1, 'y'));
  return finishHero(group, inner, wob);
}

function buildCatstar() {
  const K = 0x262630, W = 0xffffff, PINK = 0xff8fb0, STAR = 0xffcf2a, CAP = 0x8a5cff;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.07, 0.045, 0.1, s * 0.09, 0.045, -0.03, W);               // white feet
    b.cap(0.055, 0.08, s * 0.09, 0.16, 0, K);
    b.cap(0.04, 0.12, s * 0.185, 0.41, -0.02, K, 0, 0, s * 0.25);      // arms
    b.ball(0.045, 0.045, 0.045, s * 0.21, 0.31, -0.03, W);             // paws
    b.ball(0.07, 0.055, 0.05, s * 0.05, 0.645, -0.185, W);             // muzzle puffs
    b.ball(0.044, 0.05, 0.02, s * 0.1, 0.77, -0.187, 0x9ee34a);        // green eyes
    b.ball(0.012, 0.04, 0.01, s * 0.1, 0.77, -0.205, 0x111111);        // slit pupils
    b.ball(0.01, 0.012, 0.006, s * 0.1 + 0.015, 0.785, -0.208, W);
    b.cap(0.006, 0.13, s * 0.17, 0.65, -0.17, W, 0, 0, Math.PI / 2 + s * 0.12);  // whiskers
    b.cap(0.006, 0.13, s * 0.17, 0.625, -0.17, W, 0, 0, Math.PI / 2 - s * 0.08);
    b.cone(0.075, 0.15, s * 0.14, 0.92, 0, K, 0, 0, -s * 0.3);         // ears
    b.cone(0.045, 0.09, s * 0.14, 0.905, -0.04, PINK, 0, 0, -s * 0.3);
    b.cap(0.02, 0.22, s * 0.09, 0.5, 0, 0xe2412f, Math.PI / 2, 0, 0);  // backpack straps
  }
  b.ball(0.17, 0.17, 0.14, 0, 0.36, 0, K);                             // body
  b.ball(0.1, 0.12, 0.04, 0, 0.38, -0.115, W);                         // white chest
  b.hiBall(0.25, 0.2, 0.21, 0, 0.72, 0, K);                            // head
  b.ball(0.05, 0.035, 0.04, 0, 0.6, -0.17, W);                         // chin
  b.ball(0.035, 0.07, 0.02, 0, 0.76, -0.2, W);                         // blaze
  b.ball(0.026, 0.018, 0.015, 0, 0.675, -0.228, PINK);                 // nose
  b.ball(0.13, 0.055, 0.13, 0, 0.915, 0, CAP);                         // little cap for the spring
  b.ball(0.09, 0.015, 0.07, 0, 0.9, -0.115, CAP);
  inner.add(b.mesh());
  const pack = starMesh(0.2, 0.07, STAR);                             // star backpack
  pack.position.set(0, 0.4, 0.17);
  inner.add(pack);
  const t = new VB();                                                 // swishy tail, white tip
  for (const [y, z] of [[0.02, 0.06], [0.1, 0.11], [0.19, 0.14], [0.28, 0.14]]) t.ball(0.05, 0.055, 0.05, 0, y, z, K);
  t.ball(0.055, 0.06, 0.055, 0, 0.36, 0.12, W);
  const sp = new VB();                                                // coiled spring on the cap
  for (let i = 0; i < 5; i++) sp.torus(0.045, 0.012, Math.PI * 2, i % 2 ? 0.008 : -0.008, 0.03 + i * 0.045, 0, 0xcfd6e0, Math.PI / 2, 0, 0);
  for (const s of [-1, 1]) sp.ball(0.016, 0.022, 0.01, s * 0.032, 0.315, -0.045, 0x111111);  // the star's eyes
  const spring = wobble(inner, sp, 0, 0.95, 0, 1, 'x');
  spring.userData.boing = true;                                       // stretches as well as sways
  const hatStar = starMesh(0.11, 0.05, STAR);
  hatStar.position.set(0, 0.3, 0);
  spring.add(hatStar);
  return finishHero(group, inner, [wobble(inner, t, 0, 0.24, 0.12, 1), spring]);
}

function buildLeafWish() {
  const LEAF = 0x7ad653, LEAF_D = 0x4fa83a, VEIN = 0xc4f59a, TWIG = 0x6b4a2a, STEM = 0x4c7a2a;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  const leafShade = (x, y) => new THREE.Color(LEAF_D).lerp(new THREE.Color(LEAF), clamp((y - 0.24) / 0.9, 0, 1));
  b.add(leafGeo(), leafShade, 0, 0.66, 0);                            // the leaf itself: pointed tip, soft edges
  for (const s of [-1, 1]) {
    b.cap(0.025, 0.14, s * 0.08, 0.12, 0, TWIG);                       // twig legs
    b.ball(0.05, 0.03, 0.065, s * 0.08, 0.03, -0.02, TWIG);
    b.ball(0.033, 0.045, 0.015, s * 0.095, 0.76, -0.068, 0x222222);    // eyes
    b.ball(0.012, 0.014, 0.006, s * 0.095 + 0.01, 0.777, -0.08, 0xffffff);
    b.ball(0.04, 0.02, 0.008, s * 0.155, 0.69, -0.066, 0xff9eb5);      // cheeks
    for (const y of [0.5, 0.66, 0.82]) b.cap(0.009, 0.14, s * 0.07, y, 0.062, VEIN, 0, 0, -s * 0.9); // back veins
  }
  b.cap(0.012, 0.7, 0, 0.67, 0.064, VEIN);                             // midrib on the back
  b.torus(0.035, 0.009, Math.PI, 0, 0.685, -0.07, 0xc2475f, 0, 0, Math.PI); // smile
  b.cap(0.02, 0.16, -0.27, 0.58, -0.02, TWIG, 0, 0, -0.6);             // left arm
  b.cap(0.02, 0.14, 0.28, 0.52, -0.04, TWIG, 0, 0, 0.9);               // right arm, holding the wand
  inner.add(b.mesh());
  const st = new VB();                                                // curly stem on top
  st.cap(0.018, 0.06, 0, 0.04, 0, STEM);
  st.torus(0.045, 0.016, Math.PI * 1.3, 0.045, 0.1, 0, STEM, 0, 0, Math.PI * 0.6);
  const w = new VB();                                                 // wishing wand
  w.cap(0.018, 0.38, 0, 0.19, 0, 0xb48cff);
  for (const [x, y] of [[0.12, 0.52], [-0.1, 0.56], [0.08, 0.32]]) w.ball(0.022, 0.022, 0.022, x, y, 0, 0xffffff);
  const wand = wobble(inner, w, 0.34, 0.45, -0.06, -1, 'x');
  const wishStar = starMesh(0.14, 0.05, rainbowAt);                    // rainbow star tip
  wishStar.position.set(0, 0.46, 0);
  wand.add(wishStar);
  return finishHero(group, inner, [wobble(inner, st, 0, 1.15, 0, 1), wand]);
}

const HEROES = [
  { id: 'betty', name: 'Betty Lou', build: () => buildGirl(), bg: '#ffd6ec' },
  { id: 'axolotl', name: 'Axolotl Princess', build: buildAxolotl, bg: '#d9f2ff' },
  { id: 'catstar', name: 'Catstar', build: buildCatstar, bg: '#fff1b8' },
  { id: 'leafwish', name: 'LeafWish', build: buildLeafWish, bg: '#e6dcff' },
];
let heroId = store.get('bl-hero', 'betty');
const hero = () => HEROES.find(h => h.id === heroId) || HEROES[0];

// ---------- traffic & animals: rounded, with moving parts ----------
// Each kind builds a body plus parts that move: legs swing from the hip,
// wheels roll, the combine's reel and the plane's propeller spin.
// Everything faces +x; spawnMover turns it round for lanes heading the other way.
const TRAFFIC_D = 0.6;   // detail level for traffic (the hoppers use 1, scenery less)
const part = (geo, x, y, z, role, extra = {}) => ({ geo, x, y, z, role, ...extra });
function centred(m, minX, maxX) {   // shift body and parts so the model is centred on x = 0
  const dx = -(minX + maxX) / 2;
  m.geo.translate(dx, 0, 0);
  for (const p of m.parts) p.x += dx;
  return m;
}
function wheelGeo(r, w, tire, hub) {
  const v = new VB(TRAFFIC_D);
  v.cyl(r, r, w, 0, 0, 0, tire, Math.PI / 2, 0, 0);
  v.cyl(r * 0.5, r * 0.5, w + 0.02, 0, 0, 0, hub, Math.PI / 2, 0, 0);
  v.rbox(r * 1.3, r * 0.22, w + 0.04, 0, 0, 0, hub, r * 0.1);       // a spoke, so you can see it turn
  return v.geometry();
}
// A leg hanging from a hip at height `hip`, reaching the ground.
function legGeo(hip, r, col, hoof) {
  const v = new VB(TRAFFIC_D), len = hip - 1.7 * r;
  v.cap(r, len, 0, -len / 2 - r * 0.5, 0, col);
  v.ball(r * 1.15, r * 0.7, r * 1.15, 0, -len - r, 0, hoof);
  return v.geometry();
}

function buildTractor(col, hub, wagon) {
  const b = new VB(TRAFFIC_D), dark = 0x2a2a2a, glass = 0xbfe9ff;
  b.rbox(1.5, 0.14, 0.42, 0.15, 0.32, 0, 0x3a3a3a, 0.05);              // chassis
  b.rbox(0.85, 0.38, 0.5, 0.45, 0.56, 0, col, 0.12);                    // rounded hood
  b.rbox(0.86, 0.03, 0.12, 0.45, 0.755, 0, hub, 0.012);
  b.rbox(0.62, 0.42, 0.66, -0.35, 0.6, 0, col, 0.1);                    // cab
  b.rbox(0.54, 0.36, 0.6, -0.35, 0.99, 0, glass, 0.08);
  b.rbox(0.8, 0.08, 0.8, -0.35, 1.24, 0, 0xffffff, 0.035);              // roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.03, 0.03, 0.42, -0.35 + sx * 0.29, 1.0, sz * 0.32, col);
  b.rbox(0.06, 0.26, 0.38, 0.88, 0.55, 0, 0x444444, 0.02);             // grille
  for (const s of [-1, 1]) b.cyl(0.05, 0.05, 0.03, 0.9, 0.63, s * 0.17, 0xfff3a0, 0, 0, Math.PI / 2);
  b.cyl(0.035, 0.035, 0.38, 0.55, 0.92, 0.12, 0x555555);                // exhaust
  b.ball(0.05, 0.03, 0.05, 0.55, 1.12, 0.12, 0x333333);
  const big = wheelGeo(0.31, 0.2, dark, hub), small = wheelGeo(0.17, 0.14, dark, hub), parts = [];
  for (const s of [-1, 1]) {
    parts.push(part(big, -0.4, 0.31, s * 0.38, 'wheel', { r: 0.31 }));
    parts.push(part(small, 0.68, 0.17, s * 0.3, 'wheel', { r: 0.17 }));
  }
  let minX = -0.75;
  if (wagon) {
    const hay = 0xe8c45c, band = 0xc9a23e;
    b.cap(0.03, 0.28, -0.85, 0.3, 0, 0x555555, 0, 0, Math.PI / 2);      // hitch
    b.rbox(1.25, 0.12, 0.74, -1.6, 0.42, 0, 0x9c6b3c, 0.04);
    for (const s of [-1, 1]) b.rbox(1.25, 0.14, 0.05, -1.6, 0.54, s * 0.36, 0x8a5a33, 0.02);
    for (const [x, y] of [[-1.3, 0.7], [-1.9, 0.7], [-1.6, 1.08]]) {     // round bales
      b.cyl(0.22, 0.22, 0.6, x, y, 0, hay, Math.PI / 2, 0, 0);
      for (const s of [-1, 1]) b.torus(0.12, 0.018, Math.PI * 2, x, y, s * 0.3, band);
    }
    const wg = wheelGeo(0.16, 0.12, dark, hub);
    for (const s of [-1, 1]) parts.push(part(wg, -1.6, 0.16, s * 0.36, 'wheel', { r: 0.16 }));
    minX = -2.22;
  }
  return centred({ geo: b.geometry(), parts }, minX, 0.95);
}

const COW_SPOTS = [[-0.2, 0.75, 0.27, 0.15], [0.2, 0.62, -0.27, 0.13], [-0.25, 0.6, -0.26, 0.12], [0.05, 0.9, 0.05, 0.14], [0.32, 0.78, 0.22, 0.1], [-0.42, 0.7, 0.05, 0.12]];
const cowSpots = (x, y, z) => COW_SPOTS.some(([sx, sy, sz, r]) => (x - sx) ** 2 + (y - sy) ** 2 + (z - sz) ** 2 < r * r) ? 0x222222 : 0xfafafa;
function buildCow() {
  const b = new VB(TRAFFIC_D), W = 0xfafafa, PINK = 0xffb3c6;
  b.ball(0.48, 0.28, 0.29, 0, 0.64, 0, cowSpots);
  b.ball(0.1, 0.06, 0.1, -0.15, 0.37, 0, PINK);                         // udder
  b.ball(0.19, 0.18, 0.17, 0.56, 0.84, 0, (x, y, z) => z > 0.06 && y > 0.82 ? 0x222222 : W);  // head, one eye patch
  b.ball(0.1, 0.09, 0.14, 0.72, 0.77, 0, PINK);                         // snout
  b.ball(0.06, 0.06, 0.06, 0.5, 0.63, 0, 0xffcf3a);                     // bell
  b.cap(0.02, 0.3, -0.5, 0.6, 0, W, 0, 0, 0.25);                        // tail
  b.ball(0.045, 0.07, 0.045, -0.54, 0.42, 0, 0x222222);
  for (const s of [-1, 1]) {
    b.ball(0.02, 0.025, 0.02, 0.815, 0.79, s * 0.05, 0x9b4a5e);         // nostrils
    b.ball(0.026, 0.032, 0.02, 0.67, 0.88, s * 0.135, 0x222222);        // eyes
    b.cone(0.026, 0.1, 0.52, 1.0, s * 0.1, 0xfff1cc, -s * 0.4, 0, 0);   // horns
    b.ball(0.09, 0.03, 0.05, 0.5, 0.92, s * 0.2, W, -s * 0.4, 0, 0);    // ears
  }
  const lg = legGeo(0.5, 0.055, W, 0x444444), parts = [];
  for (const [x, z, ph] of [[0.28, 0.16, 0], [0.28, -0.16, Math.PI], [-0.28, 0.16, Math.PI], [-0.28, -0.16, 0]]) parts.push(part(lg, x, 0.5, z, 'leg', { ph }));
  return centred({ geo: b.geometry(), parts }, -0.56, 0.84);
}

function buildBull() {
  const b = new VB(TRAFFIC_D), B = 0x4a2a1c, HORN = 0xfff1d6;
  b.ball(0.52, 0.3, 0.31, 0, 0.68, 0, B);
  b.ball(0.26, 0.16, 0.26, 0.2, 0.92, 0, shade(B, 1.15));               // hump
  b.ball(0.2, 0.19, 0.19, 0.62, 0.74, 0, B);                            // lowered head
  b.ball(0.1, 0.11, 0.15, 0.8, 0.68, 0, 0xc9a07a);                      // snout
  b.torus(0.045, 0.012, Math.PI * 2, 0.89, 0.6, 0, 0xffd23f, 0, Math.PI / 2, 0); // nose ring
  b.cap(0.02, 0.32, -0.55, 0.64, 0, B, 0, 0, 0.3);                      // tail
  b.ball(0.045, 0.07, 0.045, -0.6, 0.45, 0, 0x111111);
  for (const s of [-1, 1]) {
    b.cap(0.035, 0.16, 0.6, 0.92, s * 0.22, HORN, s * 1.1, 0, 0);       // horns sweep out...
    b.cone(0.035, 0.12, 0.62, 1.03, s * 0.34, HORN, -s * 0.35, 0, 0);   // ...then up
    b.ball(0.03, 0.026, 0.02, 0.77, 0.81, s * 0.11, 0xff2020);          // angry red eyes
  }
  const lg = legGeo(0.52, 0.065, B, 0x111111), parts = [];
  // galloping: front legs together, back legs together, slightly offset
  for (const [x, z, ph] of [[0.3, 0.18, 0], [0.3, -0.18, 0.5], [-0.3, 0.18, Math.PI], [-0.3, -0.18, Math.PI + 0.5]]) parts.push(part(lg, x, 0.52, z, 'leg', { ph }));
  return centred({ geo: b.geometry(), parts }, -0.65, 0.92);
}

// A mother goose leading three goslings, all one mover.
function buildGeese() {
  const b = new VB(TRAFFIC_D), parts = [], ORANGE = 0xff9a2e;
  const goose = (x, s, body, baby) => {
    if (baby) {                                                         // fluffy round gosling
      b.ball(0.2 * s, 0.17 * s, 0.16 * s, x, 0.32 * s, 0, body);
      b.ball(0.12 * s, 0.11 * s, 0.11 * s, x + 0.16 * s, 0.52 * s, 0, body);
      b.cone(0.03 * s, 0.08 * s, x + 0.29 * s, 0.5 * s, 0, ORANGE, 0, 0, -Math.PI / 2);
      for (const z of [-1, 1]) b.ball(0.018 * s, 0.022 * s, 0.015 * s, x + 0.22 * s, 0.54 * s, z * 0.075 * s, 0x111111);
    } else {
      b.ball(0.22 * s, 0.15 * s, 0.14 * s, x, 0.3 * s, 0, body);
      b.cone(0.07 * s, 0.15 * s, x - 0.24 * s, 0.34 * s, 0, body, 0, 0, Math.PI / 2);   // tail
      b.cap(0.045 * s, 0.2 * s, x + 0.16 * s, 0.52 * s, 0, body, 0, 0, -0.25);         // neck
      b.ball(0.085 * s, 0.075 * s, 0.075 * s, x + 0.22 * s, 0.7 * s, 0, body);
      b.cone(0.035 * s, 0.11 * s, x + 0.33 * s, 0.68 * s, 0, ORANGE, 0, 0, -Math.PI / 2);
      for (const z of [-1, 1]) b.ball(0.016 * s, 0.02 * s, 0.014 * s, x + 0.26 * s, 0.72 * s, z * 0.055 * s, 0x111111);
    }
    for (const z of [-1, 1]) b.ball(0.15 * s, 0.07 * s, 0.03 * s, x - 0.02 * s, 0.33 * s, z * 0.13 * s, shade(body, 0.9)); // wings
    const v = new VB(TRAFFIC_D);
    v.cap(0.016 * s, 0.1 * s, 0, -0.07 * s, 0, ORANGE);
    v.ball(0.05 * s, 0.015 * s, 0.04 * s, 0.03 * s, -0.145 * s, 0, ORANGE);       // webbed foot
    const lg = v.geometry();
    for (const z of [-1, 1]) parts.push(part(lg, x, 0.16 * s, z * 0.06 * s, 'leg', { ph: z > 0 ? 0 : Math.PI }));
  };
  goose(0.75, 1.15, 0xffffff);
  for (const x of [0.05, -0.4, -0.85]) goose(x, 0.62, 0xffe46b, true);
  return { geo: b.geometry(), parts };
}

function buildCombine() {
  const b = new VB(TRAFFIC_D), G = 0x2f9a3a, Y = 0xffd23f, dark = 0x2a2a2a;
  b.rbox(1.5, 0.75, 0.82, -0.25, 0.7, 0, G, 0.16);                      // body
  b.rbox(0.62, 0.12, 0.84, -0.25, 1.1, 0, Y, 0.05);                     // stripe
  b.rbox(0.54, 0.5, 0.62, 0.25, 1.32, 0, 0xbfe9ff, 0.1);                // cab glass
  b.rbox(0.64, 0.07, 0.7, 0.25, 1.6, 0, 0xffffff, 0.03);
  b.rbox(0.45, 0.42, 0.45, -0.65, 1.28, 0, G, 0.12);                    // grain tank
  b.cyl(0.05, 0.05, 0.9, -0.75, 1.55, 0.3, Y, 0, 0, 1.2);               // unloading auger
  b.rbox(0.14, 0.3, 1.9, 0.75, 0.32, 0, Y, 0.05);                       // header, wider than the lane
  b.rbox(0.34, 0.06, 1.9, 0.86, 0.12, 0, Y, 0.025);
  for (let z = -0.85; z <= 0.86; z += 0.17) b.cone(0.03, 0.14, 1.06, 0.12, z, 0xb0b0b0, 0, 0, -Math.PI / 2); // teeth
  b.cyl(0.035, 0.035, 0.4, -0.2, 1.35, -0.25, 0x555555);                // exhaust
  const parts = [];
  const big = wheelGeo(0.33, 0.2, dark, Y), small = wheelGeo(0.2, 0.16, dark, Y);
  for (const s of [-1, 1]) {
    parts.push(part(big, 0.15, 0.33, s * 0.44, 'wheel', { r: 0.33 }));
    parts.push(part(small, -0.75, 0.2, s * 0.4, 'wheel', { r: 0.2 }));
  }
  const reel = new VB(TRAFFIC_D);                                       // spinning reel
  reel.cyl(0.035, 0.035, 1.8, 0, 0, 0, 0xd63a2f, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    reel.cyl(0.025, 0.025, 1.8, Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0, Y, Math.PI / 2, 0, 0);
    for (const z of [-0.85, 0, 0.85]) reel.rbox(0.42, 0.035, 0.035, 0, 0, z, 0xd63a2f, 0.012, 0, 0, a);
  }
  parts.push(part(reel.geometry(), 0.95, 0.5, 0, 'spin', { axis: 'z', rate: -5 }));
  return centred({ geo: b.geometry(), parts }, -1.05, 1.15);
}

// Crop duster biplane: flies low along its lane, wings overhang the lanes either side.
function buildPlane() {
  const b = new VB(TRAFFIC_D), Y = 0xffcf2a, R = 0xe2412f;
  b.cap(0.15, 1.0, -0.05, 0.75, 0, Y, 0, 0, Math.PI / 2);              // fuselage
  b.cyl(0.17, 0.15, 0.16, 0.6, 0.75, 0, R, 0, 0, Math.PI / 2);          // cowling
  b.rbox(0.42, 0.05, 2.1, 0.2, 0.6, 0, Y, 0.024);                       // lower wing
  b.rbox(0.42, 0.05, 2.1, 0.25, 1.08, 0, R, 0.024);                     // upper wing
  b.rbox(0.3, 0.05, 0.7, -0.6, 0.82, 0, R, 0.024);                      // tail plane
  b.rbox(0.28, 0.3, 0.05, -0.62, 0.98, 0, R, 0.024);                    // fin
  b.ball(0.11, 0.11, 0.11, 0.05, 0.96, 0, 0x6b4a8a);                    // pilot
  b.cyl(0.02, 0.02, 0.5, -0.1, 0.56, 0, 0xbfbfbf, Math.PI / 2, 0, 0);   // spray boom
  for (const s of [-1, 1]) {
    b.cyl(0.02, 0.02, 0.44, 0.25, 0.84, s * 0.85, 0x8a5a33);            // wing struts
    b.cyl(0.015, 0.015, 0.3, 0.3, 0.43, s * 0.17, 0x555555);
    b.ball(0.07, 0.07, 0.04, 0.3, 0.26, s * 0.22, 0x2a2a2a);            // wheels
    b.torus(0.03, 0.01, Math.PI * 2, 0.15, 0.99, s * 0.045, 0x111111, 0, Math.PI / 2, 0); // goggles
  }
  const prop = new VB(TRAFFIC_D);
  prop.cone(0.06, 0.12, 0.03, 0, 0, 0xcccccc, 0, 0, -Math.PI / 2);
  prop.rbox(0.03, 0.6, 0.09, 0, 0, 0, 0x333333, 0.014);
  return { geo: b.geometry(), parts: [part(prop.geometry(), 0.7, 0.75, 0, 'spin', { axis: 'x', rate: 40 })] };
}

const KAYAKS = [0xff4b4b, 0xffcf2a, 0x46a6ff, 0xff8fc8];
function buildKayak(len, col) {
  const b = new VB(TRAFFIC_D);
  b.ball(len / 2 + 0.12, 0.12, 0.26, 0, 0, 0, col);                     // hull, pointed at both ends
  b.ball(len / 2 - 0.05, 0.035, 0.2, 0, 0.085, 0, shade(col, 1.15));   // deck
  for (let i = 0; i < len - 1; i++) b.ball(0.24, 0.035, 0.15, -(len - 2) / 2 + i, 0.105, 0, 0x4a3a66);   // cockpits
  b.cap(0.015, 0.8, 0.15, 0.15, 0, 0x8a5a33, Math.PI / 2, 0, 0);       // paddle across the deck
  for (const s of [-1, 1]) b.ball(0.06, 0.015, 0.11, 0.15, 0.15, s * 0.47, 0xffffff);
  return { geo: b.geometry(), parts: [] };
}

function buildLog(len) {
  const b = new VB(TRAFFIC_D), BARKC = 0x8a5a33;
  b.cyl(0.17, 0.17, len, 0, 0, 0, BARKC, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) {                                            // cut ends with rings
    b.cyl(0.15, 0.15, 0.02, s * len / 2, 0, 0, 0xd9b27c, 0, 0, Math.PI / 2);
    b.cyl(0.07, 0.07, 0.025, s * len / 2, 0, 0, 0xb88a52, 0, 0, Math.PI / 2);
  }
  b.ball(0.06, 0.06, 0.06, len * 0.2, 0.08, 0.15, 0x7a4c2a);            // knot
  b.cyl(0.04, 0.06, 0.18, -len * 0.25, 0.17, 0.05, BARKC, 0, 0, 0.6);   // stubby branch
  return { geo: b.geometry(), parts: [] };
}

const LEN = { cow: 1.35, bull: 1.45, log2: 2, log3: 3, log4: 4, geese: 2.2, combine: 2.6, plane: 1.6 };
const TRACTORS = [[0xd63a2f, 0xffd23f], [0x3aa340, 0xffd23f], [0x3b7be0, 0xffffff], [0xff8a2a, 0x333333]];
TRACTORS.forEach((_, i) => { LEN['tractor' + i] = 1.7; LEN['wagon' + i] = 3.15; });
KAYAKS.forEach((_, i) => { LEN['kayak2_' + i] = 2.2; LEN['kayak3_' + i] = 3.2; });
const MODELS = {};
function model(kind) {
  if (MODELS[kind]) return MODELS[kind];
  let m;
  if (kind.startsWith('tractor')) { const [c, h] = TRACTORS[+kind.slice(7)]; m = buildTractor(c, h, false); }
  else if (kind.startsWith('wagon')) { const [c, h] = TRACTORS[+kind.slice(5)]; m = buildTractor(c, h, true); }
  else if (kind.startsWith('kayak')) m = buildKayak(+kind[5], KAYAKS[+kind.slice(7)]);
  else if (kind === 'cow') m = buildCow();
  else if (kind === 'bull') m = buildBull();
  else if (kind === 'geese') m = buildGeese();
  else if (kind === 'combine') m = buildCombine();
  else if (kind === 'plane') m = buildPlane();
  else m = buildLog(LEN[kind]);
  return (MODELS[kind] = m);
}
// How fast legs cycle per unit of ground covered, and how far they swing.
const GAIT = { cow: [7, 0.4], bull: [3.2, 0.75], geese: [11, 0.6] };

// Sunflowers are the collectible. Built standing on the ground at the origin.
const FLOWER_GEO = (() => {
  const b = new VB(0.6);
  b.cap(0.025, 0.42, 0, 0.25, 0, 0x3f8f2f);
  b.ball(0.1, 0.025, 0.05, 0.09, 0.24, 0, 0x4faa38, 0, 0, 0.4);
  b.ball(0.1, 0.025, 0.05, -0.09, 0.33, 0, 0x4faa38, 0, 0, -0.4);
  for (let i = 0; i < 12; i++) {                                        // petals, pointing out from the middle
    const a = i * Math.PI / 6;
    b.ball(0.035, 0.085, 0.022, Math.cos(a) * 0.13, 0.66 + Math.sin(a) * 0.13, 0.02, i % 2 ? 0xffcc1a : 0xffb000, 0, 0, a - Math.PI / 2);
  }
  b.cyl(0.1, 0.1, 0.07, 0, 0.66, 0.04, 0x7a4a1c, Math.PI / 2, 0, 0);
  return b.geometry();
})();
const FLOWER_MAT = toon({ vertexColors: true, emissive: 0x3a2400 });

// A swinging farm gate, hinged at the origin, its panel reaching along -z.
const GATE_GEO = (() => {
  const v = new VB(TRAFFIC_D), W = 0xf4ead8, R = 0xc9473a;
  for (const y of [0.22, 0.5, 0.78]) v.rbox(0.07, 0.07, 0.92, 0, y, -0.48, W, 0.025);      // rails
  v.rbox(0.06, 0.06, 1.06, 0, 0.5, -0.48, W, 0.022, Math.atan2(0.56, 0.85), 0, 0);        // diagonal brace
  v.rbox(0.09, 0.82, 0.09, 0, 0.42, -0.04, R, 0.03);                                     // hinge stile
  v.rbox(0.09, 0.82, 0.09, 0, 0.42, -0.92, R, 0.03);                                     // latch stile
  v.cyl(0.03, 0.03, 0.1, 0, 0.5, -0.98, 0x777777, Math.PI / 2, 0, 0);                    // latch
  return v.geometry();
})();

// ---------- audio (tiny synth, no files) ----------
let music = null;   // created with the audio context on the first tap
const sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = store.get('bl-mute', false);
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      music = createMusic(ctx, master);   // the farm tune shares the master volume, so mute covers it
      music.start();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }
  function tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, type, freq, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur);
  }
  return {
    ensure,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      store.set('bl-mute', muted);
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    hop() { tone(440, 760, 0.07, 'square', 0.06); },
    bump() { tone(220, 150, 0.07, 'square', 0.07); },
    coin() { tone(988, null, 0.08, 'square', 0.07); tone(1319, null, 0.2, 'square', 0.07, 0.08); },
    squash() { noise(0.3, 0.5, 'lowpass', 700); tone(180, 60, 0.3, 'sawtooth', 0.12); },
    splash() { noise(0.55, 0.45, 'bandpass', 1400); tone(600, 180, 0.25, 'sine', 0.1); },
    moo() { tone(150, 105, 0.7, 'sawtooth', 0.07); tone(152, 108, 0.7, 'triangle', 0.12); },
    rumble(k = 1) { noise(0.55, 0.55 * k, 'lowpass', 140); tone(58, 44, 0.5, 'sine', 0.18 * k); },
    creak() { tone(320, 170, 0.45, 'sawtooth', 0.035); tone(260, 210, 0.3, 'square', 0.02, 0.15); },
    snort() { noise(0.35, 0.35, 'bandpass', 500); tone(90, 60, 0.3, 'sawtooth', 0.1); },
    rooster() { tone(700, 900, 0.12, 'sawtooth', 0.045); tone(900, 760, 0.12, 'sawtooth', 0.045, 0.13); tone(760, 1020, 0.14, 'sawtooth', 0.045, 0.27); tone(1020, 640, 0.55, 'sawtooth', 0.045, 0.43); },
    upgrade() { tone(784, null, 0.1, 'square', 0.06); tone(988, null, 0.1, 'square', 0.06, 0.1); tone(1319, null, 0.32, 'square', 0.06, 0.2); noise(0.4, 0.25, 'bandpass', 1400, 0.05); },
    lullaby() { tone(784, null, 0.4, 'triangle', 0.08); tone(659, null, 0.4, 'triangle', 0.08, 0.35); tone(523, null, 0.9, 'triangle', 0.08, 0.7); },
    launch() { tone(300, 1200, 0.4, 'square', 0.07); },
    honk() { tone(420, 330, 0.18, 'sawtooth', 0.09); tone(430, 340, 0.2, 'sawtooth', 0.09, 0.2); },
    buzz() { tone(110, 120, 0.45, 'sawtooth', 0.025); },
    chomp() { noise(0.4, 0.4, 'bandpass', 900); tone(140, 70, 0.35, 'square', 0.08); },
  };
})();

// ---------- particles ----------
const PGEO = new THREE.SphereGeometry(0.6, 8, 6);   // round puffs for dust, splashes and petals
const pmats = {};
const pmat = c => (pmats[c] ||= toon({ color: c }));
const parts = [];
// soft = see-through puffs with no ink outline (dust, spray), so they read as clouds, not pebbles
const softMats = {};
const softMat = c => (softMats[c] ||= new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, depthWrite: false }));
function burst(x, y, z, colors, n, spd = 3, up = 4, size = 0.12, life = 0.7, soft = false) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(PGEO, soft ? softMat(pick(colors)) : pmat(pick(colors)));
    if (soft) m.layers.set(GLOW_LAYER);
    const s = size * rand(0.7, 1.3);
    m.scale.setScalar(s);
    m.position.set(x, y, z);
    scene.add(m);
    parts.push({ m, s, vx: rand(-1, 1) * spd, vy: rand(0.4, 1) * up, vz: rand(-1, 1) * spd, life, max: life });
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.vy -= 14 * dt;
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.position.z += p.vz * dt;
    p.life -= dt;
    p.m.scale.setScalar(p.s * Math.max(0, p.life / p.max));
    if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); }
  }
}

// ---------- lanes ----------
const lanes = new Map();
let genRow = 0, queue = [];

function strip(vb, top, color, dark) {
  const inner = 2 * COLS + 1, outer = VIS - COLS;
  vb.box(inner, 1, 1, 0, top - 0.5, 0, color);
  for (const s of [-1, 1]) vb.box(outer, 1, 1, s * (COLS + 0.5 + outer / 2), top - 0.5, 0, dark);
}
const LANE_Y = { grass: 0, forest: 0, road: -0.02, pasture: 0, bull: 0, wheat: 0, crops: 0, water: 0.05, pads: -0.15 };

// ---------- trees: a mix of species, each nudged and turned a little ----------
const BARK = 0x7a4f2c;
// Tiered conifer: overlapping cones that shrink upward.
function conifer(vb, x, z, tiers, base, top, h, green, trunkH = 0.22) {
  vb.cyl(0.06, 0.08, trunkH, x, trunkH / 2, z, BARK);
  const step = h / tiers;
  for (let i = 0; i < tiers; i++) {
    const w = lerp(base, top, i / (tiers - 1));
    vb.cone(w / 2, step * 1.7, x, trunkH + step * (i + 0.75), z, i % 2 ? shade(green, 1.1) : green, 0, i * 0.7, 0);
  }
}
const pine = (vb, x, z) => conifer(vb, x, z, 4, 0.85, 0.35, rand(1.3, 1.7), 0x2f7a3a);
const fir = (vb, x, z) => conifer(vb, x, z, 6, 0.6, 0.2, rand(1.7, 2.2), 0x2f7f66, 0.16);
function poplar(vb, x, z) {          // tall, skinny column (Italian cypress / Lombardy poplar)
  vb.cyl(0.05, 0.06, 0.2, x, 0.1, z, BARK);
  const g = pick([0x3c8f3a, 0x4a9a3c]), h = rand(1.6, 2.1);
  vb.ball(0.2, h / 2, 0.2, x, 0.16 + h / 2, z, g);
  vb.ball(0.15, h * 0.3, 0.15, x + 0.05, 0.16 + h * 0.62, z - 0.04, shade(g, 1.12));
}
function dogwood(vb, x, z) {         // low spreading tiers dotted with white blossoms
  vb.cyl(0.05, 0.06, 0.42, x, 0.21, z, BARK);
  vb.cap(0.03, 0.2, x + 0.1, 0.4, z, BARK, 0, 0, -0.6);
  for (const [dx, y, dz, w] of [[0, 0.5, 0, 0.8], [0.12, 0.72, -0.05, 0.62], [-0.1, 0.9, 0.06, 0.44]]) {
    vb.ball(w / 2, 0.11, w * 0.45, x + dx, y, z + dz, 0x5fb84a);
    for (let i = 0; i < 5; i++) {
      const a = rand(0, Math.PI * 2), rr = rand(0.2, 0.85);
      vb.ball(0.05, 0.03, 0.05, x + dx + Math.cos(a) * w * 0.4 * rr, y + 0.09, z + dz + Math.sin(a) * w * 0.36 * rr, pick([0xffffff, 0xfff0f5]));
    }
  }
}
function crepeMyrtle(vb, x, z) {     // several smooth pale trunks, puffs of pink bloom
  for (const a of [-0.35, 0, 0.35]) vb.cap(0.03, 0.55, x + a * 0.25, 0.3, z + a * 0.1, 0xc9a98a, 0, 0, a);
  const pinks = pick([[0xff6fb5, 0xe64a9a], [0xd77bff, 0xb35ae0], [0xff8fa3, 0xf2607e]]);
  vb.ball(0.26, 0.08, 0.2, x, 0.6, z, 0x5fa83a);
  for (const [dx, y, dz, s] of [[-0.18, 0.72, 0, 0.19], [0.18, 0.76, 0.04, 0.18], [0, 0.95, -0.04, 0.2], [0.02, 0.68, 0.18, 0.15]]) {
    vb.ball(s, s * 0.85, s, x + dx, y, z + dz, pinks[0]);
    vb.ball(s * 0.6, s * 0.5, s * 0.6, x + dx + 0.05, y + s * 0.5, z + dz, pinks[1]);
  }
}
function birch(vb, x, z) {           // white bark with dark marks, small airy crown
  vb.cyl(0.055, 0.065, 0.85, x, 0.425, z, 0xf2efe6);
  for (const y of [0.2, 0.45, 0.7]) vb.cyl(0.068, 0.068, 0.03, x, y, z, 0x333333);
  const g = 0x8fd15a;
  vb.ball(0.24, 0.19, 0.24, x, 0.95, z, g);
  vb.ball(0.16, 0.14, 0.16, x + 0.12, 1.16, z, shade(g, 1.08));
  vb.ball(0.14, 0.12, 0.14, x - 0.14, 0.82, z + 0.08, shade(g, 0.92));
}
function appleTree(vb, x, z) {       // big round crown, red apples
  vb.cyl(0.08, 0.1, 0.38, x, 0.19, z, BARK);
  const g = pick(GREENS);
  vb.ball(0.4, 0.3, 0.37, x, 0.66, z, g);
  vb.ball(0.24, 0.17, 0.22, x - 0.05, 0.93, z - 0.02, shade(g, 1.1));
  for (let i = 0; i < 6; i++) {
    const a = rand(-0.3, Math.PI * 0.8), yy = rand(0.5, 0.8);
    vb.ball(0.045, 0.045, 0.045, x + Math.cos(a) * 0.38, yy, z + Math.sin(a) * 0.35, 0xff3b3b);
  }
}
// Playable lanes get the shorter species so they don't hide oncoming traffic
// at the low camera angle; the tall, skinny ones stand along the edges.
const SHORT_TREES = [dogwood, crepeMyrtle, appleTree, birch];
const ALL_TREES = [pine, pine, fir, fir, poplar, poplar, dogwood, crepeMyrtle, appleTree, birch];
function tree(vb, x, tall) {
  pick(tall ? ALL_TREES : SHORT_TREES)(vb, x + rand(-0.08, 0.08), rand(-0.08, 0.08));
}
function bush(vb, x) {
  vb.ball(0.3, 0.22, 0.26, x - 0.1, 0.2, 0, 0x4fae3f);
  vb.ball(0.24, 0.2, 0.22, x + 0.14, 0.18, 0.04, 0x58b844);
  vb.ball(0.2, 0.17, 0.18, x, 0.38, -0.02, 0x5cbf48);
}
function hay(vb, x) {                // a round bale lying on its side
  vb.cyl(0.28, 0.28, 0.56, x, 0.28, 0, 0xe8c45c, Math.PI / 2, 0, 0);
  for (const s of [-1, 1]) for (const r of [0.08, 0.17]) vb.torus(r, 0.016, Math.PI * 2, x, 0.28, s * 0.28, 0xc9a23e);
}
function rock(vb, x) {
  vb.ball(0.3, 0.17, 0.26, x, 0.12, 0, 0x9aa0a6);
  vb.ball(0.17, 0.11, 0.15, x - 0.08, 0.27, 0.02, 0xb4babf);
}
function pumpkin(vb, x) {            // ribbed: a ring of overlapping lobes
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    vb.ball(0.15, 0.19, 0.15, x + Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12, i % 2 ? 0xf08a24 : 0xe07a1a);
  }
  vb.cyl(0.03, 0.04, 0.14, x, 0.43, 0, 0x4c7a2a, 0, 0, 0.2);
  vb.ball(0.08, 0.015, 0.05, x + 0.08, 0.4, 0, 0x5fa83a);
}
function flowers(vb, x) {
  for (let i = 0; i < ri(1, 3); i++) {
    const fx = x + rand(-0.35, 0.35), fz = rand(-0.35, 0.35);
    vb.cyl(0.015, 0.015, 0.12, fx, 0.06, fz, 0x3f8f2f);
    vb.ball(0.07, 0.04, 0.07, fx, 0.14, fz, pick([0xff6fae, 0xffd93b, 0xffffff, 0xb48cff]));
  }
}
function blocker(vb, x, outer) {
  const k = Math.random();
  if (outer) return k < 0.85 ? tree(vb, x, true) : bush(vb, x);
  if (k < 0.5) tree(vb, x, false);
  else if (k < 0.65) hay(vb, x);
  else if (k < 0.77) rock(vb, x);
  else if (k < 0.89) pumpkin(vb, x);
  else bush(vb, x);
}

// Which playable columns of this grass lane can Betty Lou actually stand in
// and get onward from, given how she could have arrived from the lane before?
function reachOf(blocked, prev) {
  const free = c => Math.abs(c) <= COLS && !blocked.has(c);
  const stack = [];
  for (let c = -COLS; c <= COLS; c++) {
    if (!free(c)) continue;
    if (prev && prev.type === 'grass' && !prev.reach.has(c)) continue;
    if (prev && prev.type === 'pads' && !prev.padCols.has(c)) continue;
    stack.push(c);
  }
  const reach = new Set();
  while (stack.length) {
    const c = stack.pop();
    if (reach.has(c)) continue;
    reach.add(c);
    for (const n of [c - 1, c + 1]) if (free(n) && !reach.has(n)) stack.push(n);
  }
  return reach;
}

function addSunflower(lane, c) {
  const m = new THREE.Mesh(FLOWER_GEO, FLOWER_MAT);
  m.position.set(c, LANE_Y[lane.type], 0);
  m.castShadow = true;
  lane.group.add(m);
  lane.coins.push({ c, m });
}

function addMovers(lane, kindFn, gapMin, gapMax, y = 0) {
  lane.speed *= speedK(lane.r);
  if (lane.type !== 'water') { gapMin *= gapK(lane.r); gapMax *= gapK(lane.r); } // wider water gaps would be harder, not easier
  let x = -SPAN / 2 + rand(gapMin, gapMax);
  for (;;) {
    const kind = kindFn(), len = LEN[kind];
    if (x + len > SPAN / 2) break;
    lane.movers.push(spawnMover(lane, kind, x + len / 2, y));
    x += len + rand(gapMin, gapMax);
  }
  const shift = rand(0, SPAN);
  for (const m of lane.movers) { m.x += shift; wrap(m); m.mesh.position.x = m.x; }
}
function spawnMover(lane, kind, x, y = 0) {
  const mdl = model(kind);
  const mesh = new THREE.Mesh(mdl.geo, VMAT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x, y, 0);
  if (lane.dir < 0) mesh.rotation.y = Math.PI;
  const parts = mdl.parts.map(p => {   // legs, wheels, reel, propeller
    const pm = new THREE.Mesh(p.geo, VMAT);
    pm.position.set(p.x, p.y, p.z);
    pm.castShadow = true;
    pm.userData = p;
    mesh.add(pm);
    return pm;
  });
  lane.group.add(mesh);
  return { kind, len: LEN[kind], x, y, mesh, parts, active: true, bob: 0, phase: rand(0, 6), walk: rand(0, 6), buzz: 0 };
}
// Legs swing with distance travelled, wheels roll, spinners spin.
function animateParts(m, speed, dt) {
  const gait = GAIT[m.kind];
  if (gait) m.walk += dt * Math.min(speed * gait[0], 30);
  for (const p of m.parts) {
    const u = p.userData;
    if (u.role === 'leg') p.rotation.z = Math.sin(m.walk + u.ph) * gait[1];
    else if (u.role === 'wheel') p.rotation.z -= dt * speed / u.r;
    else p.rotation[u.axis] += dt * u.rate;
  }
}
function wrap(m) {
  const half = SPAN / 2;
  while (m.x - m.len / 2 > half) m.x -= SPAN;
  while (m.x + m.len / 2 < -half) m.x += SPAN;
}

function nextType(r, prev) {
  if (!queue.length) {
    const d = diff(r), last = prev.type, early = r < STRAIGHT, on = k => r >= UNLOCK[k];
    let t;
    // a grass break after every hazard until STRAIGHT, tapering to 45% of the time by row 60
    if (last !== 'grass' && Math.random() < lerp(1, 0.45, clamp((r - STRAIGHT) / (35 * PACE), 0, 1))) t = 'grass';
    else {
      const w = [['grass', 0.2], ['road', 0.24 + 0.05 * d], ['pasture', on('pasture') ? 0.16 : 0], ['water', on('water') ? 0.2 : 0],
        ['bull', on('bull') ? 0.08 + 0.05 * d : 0], ['wheat', on('wheat') ? 0.1 : 0], ['crops', on('crops') ? 0.07 + 0.05 * d : 0]];
      let k = Math.random() * w.reduce((s, x) => s + x[1], 0);
      t = w.find(x => (k -= x[1]) < 0)[0];
      if (t === last && t !== 'grass') t = 'grass';
    }
    if (t === 'grass') queue = Array(early ? ri(2, 3) : ri(1, 3)).fill('grass');
    else if (t === 'road') queue = Array(on('multiRoad') ? ri(1, 2 + Math.round(2 * d)) : 1).fill('road');
    else if (t === 'pasture') queue = Array(early ? 1 : ri(1, 2)).fill('pasture');
    else if (t === 'bull') queue = Array(ri(1, d > 0.4 ? 2 : 1)).fill('bull');
    else if (t === 'wheat') queue = Array(r < 40 * PACE ? 1 : ri(1, 2)).fill('wheat');
    else if (t === 'crops') queue = ['crops'];
    else if (on('pads') && last === 'grass' && Math.random() < 0.3) queue = ['pads', 'grass'];
    else queue = Array(r < 30 * PACE ? 1 : ri(1, 2 + Math.round(d))).fill('water');
  }
  return queue.shift();
}

function addLane(r) {
  const prev = lanes.get(r - 1) || null;
  const type = r < 0 ? 'forest' : r < OPEN ? 'grass' : nextType(r, prev);
  const lane = {
    r, type, movers: [], blocked: new Set(), reach: new Set(), coins: [],
    dir: Math.random() < 0.5 ? 1 : -1, speed: 0, group: new THREE.Group(),
  };
  lane.group.position.z = -r;
  const vb = new VB(0.4);   // scenery: low detail, it's everywhere
  const d = diff(r);

  if (type === 'forest' || type === 'grass') {
    const c = Math.abs(r) % 2 === 0 ? 0xaee667 : 0xa2dc5c;
    strip(vb, 0, c, shade(c, 0.74));
    for (let x = -VIS; x <= VIS; x++) {
      if (Math.abs(x) <= COLS || Math.abs(x) > 11) continue;   // nothing past what the widest screen shows
      if (type === 'forest' || Math.random() < 0.7) blocker(vb, x, true);
      else if (Math.random() < 0.4) flowers(vb, x);
    }
    if (type === 'forest') {
      for (let x = -COLS; x <= COLS; x++) { tree(vb, x, r < -3); lane.blocked.add(x); }  // short trees nearest the start
    } else {
      const forced = new Set(prev && prev.type === 'pads' ? prev.padCols : []);
      if (r < STRAIGHT) forced.add(0);
      let blocked = new Set(), reach = new Set();
      for (let attempt = 0; attempt < 14 && !reach.size; attempt++) {
        blocked = new Set();
        const n = r < STRAIGHT ? ri(0, 2) : ri(1, 3 + Math.round(d * 1.5));
        for (let k = 0; k < n; k++) {
          const x = ri(-COLS, COLS);
          if (forced.has(x) || (r < OPEN && Math.abs(x) < 2)) continue;
          blocked.add(x);
        }
        reach = reachOf(blocked, prev);
      }
      if (!reach.size) { blocked = new Set(); reach = reachOf(blocked, prev); }
      lane.blocked = blocked;
      lane.reach = reach;
      for (let x = -COLS; x <= COLS; x++) {
        if (blocked.has(x)) blocker(vb, x, false);
        else if (Math.random() < 0.18) flowers(vb, x);
      }
      if (r > 3 && Math.random() < 0.16 && reach.size) addSunflower(lane, pick([...reach]));
    }
  } else if (type === 'road') {
    strip(vb, -0.02, 0x5f5c66, shade(0x5f5c66, 0.72));
    if (prev && prev.type === 'road') {
      for (let x = -VIS; x <= VIS; x += 2) {
        vb.rbox(0.7, 0.025, 0.1, x, -0.01, 0.5, Math.abs(x) <= COLS ? 0xf4f4f4 : 0xa8a8a8, 0.012);
      }
    }
    lane.speed = rand(1.5, 2.9) * (1 + 0.7 * d);
    const color = ri(0, TRACTORS.length - 1);
    addMovers(lane, () => (r >= UNLOCK.wagon && Math.random() < 0.25 ? 'wagon' : 'tractor') + (Math.random() < 0.5 ? color : ri(0, TRACTORS.length - 1)), 3, 7.5 - 2 * d);
    if (Math.random() < 0.1) addSunflower(lane, ri(-COLS, COLS));
  } else if (type === 'pasture') {
    strip(vb, 0, 0xcfa66b, shade(0xcfa66b, 0.72));
    for (let i = 0; i < 14; i++) {
      const x = rand(-VIS, VIS);
      vb.box(0.14, 0.01, 0.1, x, 0.005, rand(-0.35, 0.35), Math.abs(x) <= COLS + 0.5 ? 0xb58e58 : 0x8a6c43);
    }
    const k = Math.random();
    if (r >= UNLOCK.pastureBull && k < 0.3) {
      lane.speed = rand(5, 6.5) * (1 + 0.3 * d);
      addMovers(lane, () => 'bull', 9, 15);
    } else if (r >= UNLOCK.geese && k < 0.62) {
      lane.speed = rand(1.1, 1.7) * (1 + 0.4 * d);
      addMovers(lane, () => 'geese', 2.8, 6);
    } else {
      lane.speed = rand(0.6, 1.15) * (1 + 0.4 * d);
      addMovers(lane, () => 'cow', 2.4, 5.5);
    }
  } else if (type === 'bull') {
    strip(vb, 0, 0xb86b45, shade(0xb86b45, 0.72));
    for (const z of [-0.28, 0.28]) {
      vb.box(2 * COLS + 1, 0.012, 0.07, 0, 0.006, z, 0x9a5434);
      for (const s of [-1, 1]) vb.box(VIS - COLS, 0.012, 0.07, s * (COLS + 0.5 + (VIS - COLS) / 2), 0.006, z, 0x6e3c25);
    }
    for (let i = 0; i < 26; i++) {                         // hoofprints pressed into the dirt
      const hx = rand(-11, 11);
      vb.ball(0.05, 0.01, 0.04, hx, 0.004, rand(-0.36, 0.36), Math.abs(hx) <= COLS + 0.5 ? 0x8f4f30 : 0x6e3c25);
    }
    // The bulls wait in a little corral off one edge. A gate at each end of the lane,
    // just outside the playable columns, swings open before they charge. The camera
    // looks slightly from the side, so whichever end is on screen, one gate is in view.
    const out = -lane.dir;                                 // the corral side
    lane.gates = [];
    for (const side of [-1, 1]) {
      const gx = side * (COLS + 0.6);
      for (const z of [-0.5, 0.5]) {
        vb.cyl(0.075, 0.085, 1.0, gx, 0.5, z, 0x7a4f2c);                      // gate posts
        vb.ball(0.085, 0.05, 0.085, gx, 1.02, z, 0x8a5a33);
        if (side === out) {                                                   // corral fence on the bulls' side
          for (let i = 1; i <= 4; i++) vb.cyl(0.05, 0.06, 0.8, gx + out * i, 0.4, z, 0x7a4f2c);
          for (const y of [0.35, 0.65]) vb.rbox(4, 0.07, 0.05, gx + out * 2, y, z, 0xb88a5a, 0.022);
        }
      }
      const gate = new THREE.Mesh(GATE_GEO, VMAT);
      gate.position.set(gx, 0, 0.47);                      // hinged on the near post, panel across the lane
      gate.castShadow = true;
      gate.userData.open = -side * Math.PI / 2 * 0.95;     // swings outward, away from the field
      lane.group.add(gate);
      lane.gates.push(gate);
    }
    lane.speed = 19 + 5 * d;
    for (let i = 0; i < 3; i++) {
      const m = spawnMover(lane, 'bull', 999);
      m.active = false;
      m.mesh.visible = false;
      lane.movers.push(m);
    }
    lane.stamp = { state: 'wait', t: rand(1.5, 4), cue: 0, ang: 0 };
  } else if (type === 'wheat') {
    strip(vb, 0, 0xe9c46a, shade(0xe9c46a, 0.74));
    for (let x = -VIS; x <= VIS; x++) {                   // stubble tufts, purely decoration
      for (let i = 0; i < 2; i++) {
        const tx = x + rand(-0.4, 0.4), tz = rand(-0.38, 0.38);
        vb.cone(0.028, rand(0.1, 0.18), tx, 0.06, tz, Math.abs(tx) <= COLS + 0.5 ? 0xd4a83f : 0xa88430);
      }
    }
    lane.speed = rand(0.9, 1.5) * (1 + 0.5 * d);
    addMovers(lane, () => 'combine', 5, 9 - 2 * d);
    if (Math.random() < 0.12) addSunflower(lane, ri(-COLS, COLS));
  } else if (type === 'crops') {
    strip(vb, 0, 0x8a5e3c, shade(0x8a5e3c, 0.72));
    for (const z of [-0.3, 0.3]) {
      vb.box(2 * VIS + 1, 0.03, 0.18, 0, 0.015, z, 0x6e4a2e);  // furrows
      for (let x = -VIS; x <= VIS; x++) {
        const out = Math.abs(x) > COLS;
        vb.ball(0.15, 0.1, 0.13, x + 0.25, 0.08, z, out ? 0x3f8a33 : 0x5cbf48);  // cabbages
        vb.ball(0.09, 0.06, 0.08, x + 0.25, 0.15, z, out ? 0x56a845 : 0x8fe070);
      }
    }
    lane.speed = rand(6.5, 8.5) * (1 + 0.25 * d);
    addMovers(lane, () => 'plane', 14, 24);
  } else if (type === 'water' || type === 'pads') {
    strip(vb, -0.22, 0x56c3ee, shade(0x56c3ee, 0.74));
    if (type === 'water') {
      if (prev && prev.type === 'water') lane.dir = -prev.dir;
      if (r >= UNLOCK.kayak && Math.random() < 0.35) {
        // a flotilla of kayaks: quicker than logs, and shorter
        lane.speed = rand(1.4, 2.3) * (1 + 0.4 * d);
        const col = ri(0, KAYAKS.length - 1);
        addMovers(lane, () => 'kayak' + (Math.random() < 0.6 ? 2 : 3) + '_' + (Math.random() < 0.5 ? col : ri(0, KAYAKS.length - 1)), 1.3, 2.4 + d, -0.1);
      } else {
        lane.speed = rand(0.9, 1.9) * (1 + 0.45 * d);
        const lens = r < 30 * PACE ? ['log3', 'log4', 'log4'] : d > 0.5 ? ['log2', 'log2', 'log3'] : ['log2', 'log3', 'log3', 'log4'];
        addMovers(lane, () => pick(lens), 1.2, 2.4 + d, -0.1);
      }
    } else {
      const cands = [...prev.reach];
      lane.padCols = new Set();
      const want = Math.min(cands.length, ri(2, 4));
      while (lane.padCols.size < want) lane.padCols.add(pick(cands));
      for (const x of lane.padCols) {
        vb.add(prim('pad', () => new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16, 1, false, 0.5, Math.PI * 2 - 0.6)), 0x3fae49, x, -0.18, 0);   // round pad with a notch
        if (Math.random() < 0.5) {   // a water lily
          for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4; vb.ball(0.035, 0.07, 0.035, x - 0.12 + Math.cos(a) * 0.05, -0.1, -0.12 + Math.sin(a) * 0.05, 0xff8fc8, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); }
          vb.ball(0.03, 0.03, 0.03, x - 0.12, -0.08, -0.12, 0xffd93b);
        }
      }
    }
  }

  // soft rounded banks wherever water meets dry land, and tufts in the grass
  const wet = t => t === 'water' || t === 'pads';
  if (prev && wet(type) !== wet(prev.type)) vb.cap(0.08, 2 * VIS, 0, -0.07, 0.5, 0xd9c48a, 0, 0, Math.PI / 2);
  if (type === 'grass' || type === 'pasture') {
    for (let i = 0; i < 10; i++) {
      const tx = rand(-VIS, VIS);
      vb.cone(0.035, 0.11, tx, 0.045, rand(-0.42, 0.42), Math.abs(tx) <= COLS + 0.5 ? 0x6cbf3f : 0x4f8f30);
    }
  }
  lane.static = vb.mesh();
  lane.group.add(lane.static);
  scene.add(lane.group);
  lanes.set(r, lane);
}

function removeLane(lane) {
  scene.remove(lane.group);
  lane.static.geometry.dispose();
  lanes.delete(lane.r);
}

function updateLane(lane, dt, time) {
  if (lane.type === 'bull') return updateStampede(lane, dt);
  for (const m of lane.movers) {
    m.x += lane.dir * lane.speed * dt;
    wrap(m);
    m.mesh.position.x = m.x;
    animateParts(m, lane.speed, dt);
    if (m.kind === 'cow') {
      m.mesh.position.y = Math.abs(Math.cos(m.walk)) * 0.025;            // a gentle step bob
    } else if (m.kind === 'bull') {
      m.mesh.position.y = Math.abs(Math.sin(m.walk)) * 0.07;             // galloping: bound and rock
      m.mesh.rotation.z = Math.sin(m.walk) * 0.06;
    } else if (m.kind === 'geese') {
      m.mesh.rotation.x = Math.sin(m.walk) * 0.07;                       // waddle
      m.mesh.position.y = Math.abs(Math.sin(m.walk)) * 0.02;
    } else if (m.kind === 'plane') {
      m.mesh.position.y = Math.sin(time * 3 + m.phase) * 0.05;
      if (Math.abs(m.x) < VIS && Math.random() < dt * 25) {
        burst(m.x - lane.dir * 0.4, 0.5, -lane.r + rand(-0.5, 0.5), [0xf3f0d0, 0xdff5c8], 1, 0.4, 0.3, 0.2, 0.9, true);
      }
      m.buzz -= dt;
      if (m.buzz <= 0 && game.state === 'play' && Math.abs(lane.r - P.r) < 4 && Math.abs(m.x - P.x) < 9) {
        m.buzz = 0.45;
        sfx.buzz();
      }
    } else if (lane.type === 'water') {
      m.bob = Math.max(0, m.bob - dt * 0.6);
      m.mesh.position.y = m.y - Math.sin(m.bob * 40) * m.bob * 0.6 + Math.sin(time * 2 + m.phase) * 0.012;
    } else {
      m.mesh.position.y = Math.sin(time * 40 + m.phase) * 0.008;
    }
  }
}

// Stampede lane: wait, then a warning (the gate rattles and swings open while
// the ground rumbles and dust lifts), then the bulls charge through.
const WARN_T = 1.6;
function updateStampede(lane, dt) {
  const s = lane.stamp, near = Math.abs(lane.r - P.r), playing = game.state === 'play';
  const gx = -lane.dir * (COLS + 0.6);                    // the gate the bulls come through
  s.t -= dt;
  let open = s.state === 'charge', rattle = 0;
  if (s.state === 'wait') {
    if (s.t <= 0) { s.state = 'warn'; s.t = WARN_T; s.cue = 0; }
  } else if (s.state === 'warn') {
    const k = 1 - s.t / WARN_T;                            // 0 -> 1 through the warning
    open = k > 0.45;
    rattle = open ? 0 : 0.07;
    if (near < 7 && playing) game.shake = Math.max(game.shake, 0.7 * (0.3 + 0.7 * k) * (1 - near / 7));
    if (Math.random() < dt * (30 + 90 * k)) {              // dust lifting off the lane, thickest by the gate
      const x = lerp(gx, -gx, Math.random() ** 1.5);
      burst(x, 0.05, -lane.r + rand(-0.4, 0.4), [0xe8d2b0, 0xdcc09a, 0xf2e2c8], 1, 0.3, 2.6, 0.24 + 0.12 * k, 0.9, true);
    }
    if (Math.random() < dt * 25 * k) {                     // pebbles jumping on the shaking ground
      burst(rand(-COLS, COLS), 0.03, -lane.r + rand(-0.4, 0.4), [0x9aa0a6, 0x7a6a5a], 1, 0.15, 3.2, 0.06, 0.5);
    }
    s.cue -= dt;
    if (s.cue <= 0) {
      s.cue = 0.5;
      if (near < 8 && playing) { sfx.rumble(0.4 + 0.6 * k); rumblePad(0.3 + 0.6 * k, 420); }
    }
    if (open && !s.creaked) { s.creaked = true; if (near < 8 && playing) sfx.creak(); }
    if (s.t <= 0) {
      s.state = 'charge';
      s.creaked = false;
      const n = ri(1, diff(lane.r) > 0.3 ? 3 : 2);
      lane.movers.forEach((m, i) => {
        m.active = i < n;
        m.mesh.visible = m.active;
        m.x = -lane.dir * (VIS + 2 + i * 1.9);
        m.mesh.position.x = m.x;
      });
      if (near < 8 && playing) sfx.snort();
    }
  } else {
    let any = false;
    for (const m of lane.movers) {
      if (!m.active) continue;
      m.x += lane.dir * lane.speed * dt;
      m.mesh.position.x = m.x;
      animateParts(m, lane.speed, dt);
      m.mesh.position.y = Math.abs(Math.sin(m.walk)) * 0.09;
      m.mesh.rotation.z = Math.sin(m.walk) * 0.07;
      if (lane.dir * m.x > VIS + 3) { m.active = false; m.mesh.visible = false; }
      else {
        any = true;
        if (near < 7 && playing && Math.abs(m.x - P.x) < 6) game.shake = Math.max(game.shake, 0.5 * (1 - near / 7));
        if (Math.random() < dt * 30 && Math.abs(m.x) < VIS) {
          burst(m.x - lane.dir * 0.7, 0.1, -lane.r + rand(-0.3, 0.3), [0xe8d2b0, 0xdcc09a], 1, 0.6, 2.5, 0.2, 0.6, true);
        }
      }
    }
    if (!any) { s.state = 'wait'; s.t = rand(2.5, 6); }
  }
  // Swing the gate: snaps open fast, drifts shut slowly once the bulls are through.
  s.ang = lerp(s.ang, open ? 1 : 0, Math.min(1, dt * (open ? 7 : 2.5)));
  for (const g of lane.gates) g.rotation.y = g.userData.open * s.ang + rattle * Math.sin(game.time * 45 + g.position.x);
}

// ---------- player ----------
const P = {};
const game = { state: 'farm', where: 'farm', light: 1, dawn: 1, today: 0, day: 1, shake: 0, score: 0, top: store.get('bl-top', 0), coins: store.get('bl-coins', 0), camX: 0, camZ: 0, time: 0 };

function resetPlayer() {
  if (P.model) scene.remove(P.model.group);
  Object.assign(P, {
    x: 0, z: 0, y: 0, r: 0, hop: null, queue: null, log: null, alive: true,
    face: Math.PI + 0.36, faceTarget: Math.PI + 0.36, held: false, sy: 1,
    tailAng: 0, tailVel: 0, death: null, deathT: 0, vx: 0, vy: 0, vz: 0,
    model: hero().build(),
  });
  scene.add(P.model.group);
}

function laneAt(r) { return lanes.get(r); }

function move(dx, dr) {
  if (game.state === 'title') startGame();
  if (game.state !== 'play' || !P.alive) return;
  if (P.hop) { P.queue = [dx, dr]; return; }
  P.faceTarget = dr > 0 ? 0 : dr < 0 ? Math.PI : dx < 0 ? Math.PI / 2 : -Math.PI / 2;
  const tr = P.r + dr;
  const lane = laneAt(tr);
  if (!lane) return;
  const land = lane.type !== 'water';
  let tx = P.x + dx;
  if (land) tx = Math.round(tx);
  const blocked = Math.abs(tx) > COLS + (land ? 0 : 0.49) || ((lane.type === 'grass' || lane.type === 'forest') && lane.blocked.has(tx))
    || (dr < 0 && belowScreen(tx, -tr));   // can't back off the bottom of the screen
  if (blocked) {
    P.hop = { fx: P.x, fz: P.z, fy: P.y, tx: P.x, tz: P.z, ty: P.y, t: 0, fromR: P.r, toR: P.r, h: 0.15, bump: true };
    sfx.bump();
    return;
  }
  P.hop = { fx: P.x, fz: P.z, fy: P.y, tx, tz: -tr, ty: LANE_Y[lane.type], t: 0, fromR: P.r, toR: tr, h: 0.42 };
  P.log = null;
  P.tailVel += 9;
  sfx.hop();
}

function land() {
  const h = P.hop;
  P.hop = null;
  P.x = h.tx; P.z = h.tz; P.y = h.ty; P.r = h.toR;
  if (h.bump) { if (P.queue) { const q = P.queue; P.queue = null; move(...q); } return; }
  const lane = laneAt(P.r);
  if (lane.type === 'water') {
    const m = lane.movers.find(m => Math.abs(m.x - P.x) < m.len / 2 + 0.12);
    if (!m) return die('splash');
    const left = m.x - m.len / 2;
    const off = clamp(Math.floor(P.x - left) + 0.5, 0.5, m.len - 0.5);
    P.x = left + off;
    P.log = m;
    m.bob = 0.12;
  } else if (lane.type === 'pads' && !lane.padCols.has(P.x)) {
    return die('splash');
  }
  const coin = lane.coins.find(c => c.c === P.x);
  if (coin) {
    lane.group.remove(coin.m);
    lane.coins.splice(lane.coins.indexOf(coin), 1);
    game.coins++;
    game.today++;
    store.set('bl-coins', game.coins);
    sfx.coin();
    burst(P.x, 0.6, P.z, [0xffd23f, 0xffe680, 0xffffff], 10, 1.5, 4, 0.08, 0.5);
    hud();
  }
  if (P.r > game.score) {   // new ground: the sun climbs back up a little
    game.day = Math.min(1, game.day + DAY_GAIN * (P.r - game.score));
    game.score = P.r;
    hud();
  }
  if (P.queue) { const q = P.queue; P.queue = null; move(...q); }
}

const DEATH_MSG = {
  squash: 'Flattened by a tractor!',
  bonk: 'Bonked by a cow!',
  launch: 'Launched by a bull!',
  splash: "Splash! {name} can't swim!",
  swept: 'Swept down the creek!',
  night: 'The sun set on the farming day!',
  goose: 'Chased off by geese!',
  harvest: 'Baled up by a combine!',
  dusted: 'Buzzed by a crop duster!',
};
// Which death each moving thing causes, and which animation each death uses.
const HIT_BY = { bull: 'launch', cow: 'bonk', geese: 'goose', combine: 'harvest', plane: 'dusted' };
const FLAT = new Set(['squash', 'harvest']), KNOCK = new Set(['bonk', 'goose']), FLY = new Set(['launch', 'dusted']);

function die(kind, mover, lane) {
  if (!P.alive) return;
  P.alive = false;
  P.death = kind;
  P.deathT = 0;
  P.hop = null;
  P.queue = null;
  P.log = null;
  game.state = 'dead';
  const { inner } = P.model;
  if (FLAT.has(kind)) {
    P.y = LANE_Y[lane.type];
    inner.scale.set(1.35, 0.12, 1.35);
    if (kind === 'harvest') {
      sfx.chomp();
      burst(P.x, 0.3, P.z, [0xe9c46a, 0xf2d37a, 0xc9a23e, ...RAINBOW], 22, 2.5, 5, 0.1, 0.8);
    } else {
      sfx.squash();
      burst(P.x, 0.2, P.z, [0xff8fc8, 0x3e6fd8, ...RAINBOW], 14, 2.5, 3, 0.1, 0.6);
    }
  } else if (KNOCK.has(kind)) {
    P.y = 0;
    P.vx = lane.dir;
    if (kind === 'goose') {
      sfx.honk();
      burst(P.x, 0.6, P.z, [0xffffff, 0xf2f2f2, 0xffe46b], 14, 1.5, 3, 0.09, 1.0);
    } else {
      sfx.moo();
      burst(P.x, 1.1, P.z, [0xffd93b, 0xffffff], 8, 1.2, 3, 0.1, 0.8);
    }
  } else if (FLY.has(kind)) {
    if (kind === 'dusted') {
      P.vx = lane.dir * 5; P.vy = 7; P.vz = rand(-1, 1);
      sfx.launch();
      burst(P.x, 0.7, P.z, [0xf3f0d0, 0xdff5c8, 0xffffff], 18, 2, 2, 0.2, 1.0);
    } else {
      P.vx = lane.dir * 7; P.vy = 11; P.vz = rand(-1.5, 1.5);
      sfx.launch();
      burst(P.x, 0.3, P.z, [0xc89a6a, 0xa87a4a], 12, 2, 3, 0.15, 0.7);
    }
  } else if (kind === 'splash' || kind === 'swept') {
    sfx.splash();
    burst(P.x, 0, P.z, [0xffffff, 0xbfe9ff, 0x56c3ee], 18, 1.8, 5, 0.12, 0.7);
  } else if (kind === 'night') {        // the sun went down: turn round, yawn, lie down for the night
    P.faceTarget = Math.PI + 0.36;
    sfx.lullaby();
  }
  if (game.score > game.top) { game.top = game.score; store.set('bl-top', game.top); game.record = true; }
  setTimeout(gameOver, kind === 'night' ? 1800 : 1100);
}

function updatePlayer(dt) {
  const { group, inner, tails } = P.model;

  if (P.alive) {
    if (P.hop) {
      const h = P.hop;
      h.t += dt / HOP_T;
      const t = Math.min(1, h.t);
      P.x = lerp(h.fx, h.tx, t);
      P.z = lerp(h.fz, h.tz, t);
      P.y = lerp(h.fy, h.ty, t) + Math.sin(Math.PI * t) * h.h;
      if (h.t >= 1) land();
    } else if (P.log) {
      const lane = laneAt(P.r);
      P.x += lane.dir * lane.speed * dt;
      P.y = LANE_Y.water + P.log.mesh.position.y - P.log.y;
      if (Math.abs(P.x) > COLS + 1.1) die('swept');
    }
  }

  // collisions with traffic
  if (P.alive && game.state === 'play') {
    const row = P.hop ? (P.hop.t > 0.5 ? P.hop.toR : P.hop.fromR) : P.r;
    const lane = laneAt(row);
    if (lane && (lane.movers.length && lane.type !== 'water')) {
      for (const m of lane.movers) {
        if (!m.active) continue;
        if (Math.abs(m.x - P.x) < m.len / 2 + 0.2) {
          if (P.hop) { P.x = Math.round(P.hop.t > 0.5 ? P.hop.tx : P.hop.fx); P.z = -row; }
          P.r = row;
          die(HIT_BY[m.kind] || 'squash', m, lane);
          break;
        }
      }
    }
  }

  // death animations
  if (!P.alive) {
    P.deathT += dt;
    const t = P.deathT;
    if (FLY.has(P.death)) {
      P.vy -= 22 * dt;
      P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt;
      inner.rotation.x += 13 * dt;
      inner.rotation.z += 7 * dt;
    } else if (KNOCK.has(P.death)) {
      inner.rotation.z = lerp(inner.rotation.z, -P.vx * Math.PI / 2, Math.min(1, dt * 14));
      if (t < 0.35) P.x += P.vx * 2.5 * dt;
    } else if (P.death === 'splash' || P.death === 'swept') {
      P.y = lerp(P.y, -1.3, Math.min(1, dt * 4));
    } else if (P.death === 'night' && t > 0.5) {
      inner.rotation.x = lerp(inner.rotation.x, 1.35, Math.min(1, dt * 3));   // settles onto her back
    }
  }

  // squash & stretch, facing, pigtail bounce
  const syT = !P.alive && FLAT.has(P.death) ? 0.12 : P.held && P.alive ? 0.78 : P.hop && !P.hop.bump ? 1.12 : 1;
  if (!FLAT.has(P.death)) {
    P.sy = lerp(P.sy, syT, Math.min(1, dt * 25));
    inner.scale.set(1 + (1 - P.sy) * 0.5, P.sy, 1 + (1 - P.sy) * 0.5);
  }
  let da = P.faceTarget - P.face;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  P.face += da * Math.min(1, dt * 20);
  P.tailVel += (-70 * P.tailAng - 7 * P.tailVel) * dt;
  P.tailAng += P.tailVel * dt;
  const idle = Math.sin(game.time * 3) * 0.04;
  for (const t of tails) {
    t.rotation[t.userData.axis || 'z'] = t.userData.side * (P.tailAng * 0.12 + idle);
    if (t.userData.boing) t.scale.y = 1 + P.tailAng * 0.3 + idle;   // Catstar's spring
  }

  group.position.set(P.x, P.y, P.z);
  group.rotation.y = P.face;
}

// ---------- camera ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  resizeCel();
  let halfW, halfH;
  if (a < 1) { halfW = 4.3; halfH = halfW / a; }
  else { halfH = 6.2; halfW = Math.min(halfH * a, 11); halfH = halfW / a; }
  Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const _t = new THREE.Vector3();
function updateCamera(dt) {
  if (game.where === 'farm') _t.set(0, 0, FARM_Z - 1.4);   // the farm: a fixed, framed view
  else {
    const desired = P.z - 4;
    if (P.alive && desired < game.camZ) game.camZ += (desired - game.camZ) * Math.min(1, dt * 5);
    if (P.alive) game.camX += (clamp(P.x, -2.5, 2.5) * 0.6 - game.camX) * Math.min(1, dt * 3);
    _t.set(game.camX, 0, game.camZ);
  }
  camera.position.copy(_t).add(CAM_OFF);
  camera.lookAt(_t);
  if (game.shake > 0.002) {             // the ground rumbles when bulls are about to charge
    camera.position.x += (Math.random() - 0.5) * game.shake * 0.18;
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.18;
    game.shake *= Math.exp(-dt * 5);
  }
  sun.position.copy(_t).add(SUN_OFF);
  sun.target.position.copy(_t);
  camera.updateMatrixWorld();
}

function ensureLanes() {
  const camRow = Math.round(-game.camZ);
  while (genRow <= camRow + AHEAD) addLane(genRow++);
  for (const lane of [...lanes.values()]) if (lane.r < camRow - BEHIND) removeLane(lane);
}

// ---------- Betty Lou's farm: the hub between rounds ----------
// Built far behind the road (z = FARM_Z) in the same scene, so the same camera,
// lights and ink outlines draw it. While you're at the farm the road is paused.
const FARM_Z = 160;
const FARM_LIGHT = 0.8;   // the farm sits in soft morning light
// What each Fish Pond level adds. Level n costs n sunflowers (1, 2, 3, ...).
const POND_STEPS = ['Fish move in', 'Lily pads', 'A little dock', 'Koi', 'Ducks', 'A bigger pond with a stone rim', 'A fountain', 'A frog', 'Lanterns'];
const pondNext = lvl => POND_STEPS[lvl] || 'Another fish';
const pondCost = lvl => lvl + 1;
const POND = new THREE.Vector3(1.3, 0, 1.2);   // pond centre, farm-local

const farm = { group: new THREE.Group(), pond: new THREE.Group(), fish: [], ducks: [], spray: 0, hero: null, level: store.get('bl-pond', 0) };
farm.group.position.set(0, 0, FARM_Z);
farm.group.add(farm.pond);
scene.add(farm.group);

function buildFarm() {
  const vb = new VB(0.45);
  const GRASS = 0x9bd85a, PATH = 0xdcc08a, WOOD = 0x9c6b3c;
  vb.rbox(32, 1, 36, 0, -0.5, 0, GRASS, 0.3);                               // the yard
  vb.rbox(1.2, 0.04, 9, -1.1, 0.01, 1.5, PATH, 0.3);                         // path from the porch
  for (let i = 0; i < 40; i++) vb.cone(0.035, 0.11, rand(-11, 11), 0.045, rand(-12, 10), 0x7cc24a);  // tufts

  // farmhouse: cream walls, red gable roof, porch, door and windows
  const hx = -1.6, hz = -5;
  vb.rbox(2.8, 1.6, 2.2, hx, 0.8, hz, 0xfff1d8, 0.08);
  vb.roof(2.6, 3.2, 0.62, hx, 1.6 + 2.6 / Math.sqrt(3) / 2 * 0.62, hz, 0xd8473a);   // sits on the walls
  vb.cyl(0.14, 0.14, 0.7, hx + 0.8, 2.05, hz - 0.3, 0xb35a3a);                // chimney
  vb.rbox(0.5, 0.9, 0.06, hx, 0.45, hz + 1.11, 0x8a5a33, 0.05);              // door
  vb.ball(0.04, 0.04, 0.03, hx + 0.15, 0.45, hz + 1.15, 0xffd23f);
  for (const s of [-1, 1]) {
    vb.rbox(0.5, 0.5, 0.06, hx + s * 0.85, 0.95, hz + 1.11, 0xbfe9ff, 0.06);  // windows
    vb.rbox(0.56, 0.06, 0.08, hx + s * 0.85, 0.68, hz + 1.12, 0xffffff, 0.02);
    vb.rbox(0.56, 0.12, 0.14, hx + s * 0.85, 0.62, hz + 1.18, 0x8a5a33, 0.03); // flower boxes
    for (let i = 0; i < 3; i++) vb.ball(0.05, 0.05, 0.05, hx + s * 0.85 + (i - 1) * 0.16, 0.71, hz + 1.2, [0xff6fae, 0xffd93b, 0xb48cff][i]);
  }
  vb.rbox(2.4, 0.12, 0.8, hx, 0.06, hz + 1.5, WOOD, 0.04);                   // porch
  for (const s of [-1, 1]) vb.cyl(0.05, 0.05, 1.1, hx + s * 1.1, 0.6, hz + 1.85, 0xffffff);
  vb.rbox(2.5, 0.08, 0.9, hx, 1.18, hz + 1.5, 0xd8473a, 0.03);               // porch roof

  // red barn with white trim and a hayloft
  const bx = 3.3, bz = -6;
  vb.rbox(2.6, 2.0, 2.8, bx, 1.0, bz, 0xc9473a, 0.08);
  vb.roof(3.0, 3.0, 0.75, bx, 2.0 + 3.0 / Math.sqrt(3) / 2 * 0.75, bz, 0x6e3a3a);
  vb.rbox(1.1, 1.3, 0.06, bx, 0.65, bz + 1.42, 0xa8352c, 0.04);              // big door
  for (const s of [-1, 1]) vb.rbox(0.08, 1.6, 0.04, bx, 0.65, bz + 1.46, 0xffffff, 0.02, 0, 0, s * 0.7);   // the X
  vb.rbox(1.2, 0.08, 0.05, bx, 1.32, bz + 1.45, 0xffffff, 0.02);
  vb.rbox(0.6, 0.5, 0.06, bx, 1.75, bz + 1.42, 0x5a2a24, 0.05);              // hayloft
  vb.cyl(0.26, 0.26, 0.5, bx - 1.7, 0.26, bz + 1.6, 0xe8c45c, Math.PI / 2, 0, 0);   // hay bales by the barn
  vb.cyl(0.26, 0.26, 0.5, bx - 1.6, 0.72, bz + 1.6, 0xe8c45c, Math.PI / 2, 0, 0);

  // sunflower patch and a mailbox
  for (let i = 0; i < 9; i++) {
    const x = -3.6 + (i % 3) * 0.45 + rand(-0.08, 0.08), z = 1.8 + Math.floor(i / 3) * 0.5;
    vb.cyl(0.02, 0.02, 0.55, x, 0.28, z, 0x3f8f2f);
    vb.cyl(0.13, 0.13, 0.04, x, 0.6, z + 0.02, 0xffc21a, Math.PI / 2, 0, 0);
    vb.cyl(0.06, 0.06, 0.05, x, 0.6, z + 0.04, 0x7a4a1c, Math.PI / 2, 0, 0);
  }
  vb.cyl(0.04, 0.04, 0.8, -2.3, 0.4, 3.6, WOOD);
  vb.rbox(0.36, 0.26, 0.24, -2.3, 0.9, 3.6, 0x5bb4ff, 0.1);
  vb.rbox(0.05, 0.16, 0.04, -2.1, 1.0, 3.6, 0xff4b4b, 0.02);

  // fence along the front, trees all round
  for (let x = -6; x <= 6; x += 1) {
    vb.cyl(0.05, 0.06, 0.6, x, 0.3, 5.2, 0xf4ead8);
    vb.ball(0.06, 0.04, 0.06, x, 0.62, 5.2, 0xf4ead8);
  }
  for (const y of [0.25, 0.48]) vb.rbox(12.2, 0.06, 0.05, 0, y, 5.2, 0xf4ead8, 0.02);
  for (let x = -11; x <= 11; x += 1.3) for (const z of [-9.5, -11.5]) pick(ALL_TREES)(vb, x + rand(-0.3, 0.3), z + rand(-0.3, 0.3));
  for (let z = -8; z <= 8; z += 1.4) for (const x of [-5.6, -6.8, -8.2, 5.8, 7, 8.4]) pick(ALL_TREES)(vb, x + rand(-0.3, 0.3), z + rand(-0.3, 0.3));
  bush(vb, -3.3, 0); bush(vb, 4.6, 0);
  const m = vb.mesh();
  farm.group.add(m);
  buildPond();
}

// Little animated bits for the pond: fish and ducks are their own meshes so they can swim.
function fishMesh(colors) {
  const v = new VB(0.6);
  v.ball(0.14, 0.07, 0.07, 0, 0, 0, (x, y, z) => colors.length > 1 && (x > 0.04 || (z > 0.02 && x < -0.03)) ? colors[1] : colors[0]);
  v.cone(0.06, 0.12, -0.16, 0, 0, colors[0], 0, 0, Math.PI / 2);
  v.ball(0.015, 0.015, 0.015, 0.1, 0.025, 0.05, 0x111111);
  const mesh = v.mesh();
  farm.pond.add(mesh);
  return mesh;
}
function duckMesh(s) {
  const v = new VB(0.6);
  v.ball(0.2 * s, 0.12 * s, 0.13 * s, 0, 0.08 * s, 0, s > 0.8 ? 0xffffff : 0xffe46b);
  v.ball(0.09 * s, 0.09 * s, 0.09 * s, 0.14 * s, 0.24 * s, 0, s > 0.8 ? 0xffffff : 0xffe46b);
  v.cone(0.035 * s, 0.09 * s, 0.25 * s, 0.22 * s, 0, 0xff9a2e, 0, 0, -Math.PI / 2);
  for (const z of [-1, 1]) v.ball(0.015 * s, 0.018 * s, 0.012 * s, 0.18 * s, 0.27 * s, z * 0.06 * s, 0x111111);
  const mesh = v.mesh();
  farm.pond.add(mesh);
  return mesh;
}

// Rebuild the pond for its current level. Everything up to that level is there.
function buildPond() {
  const g = farm.pond, L = farm.level;
  for (const c of [...g.children]) { g.remove(c); if (c.geometry !== PGEO) c.geometry?.dispose(); }   // PGEO is shared with particles
  farm.fish = []; farm.ducks = [];
  const s = L >= 6 ? 1.3 : 1, rx = 1.7 * s, rz = 1.15 * s;
  g.position.copy(POND);
  farm.pondR = [rx, rz];
  const v = new VB(0.6);
  v.add(prim('disc', () => new THREE.CylinderGeometry(1, 1, 0.1, 28)), 0xd9c48a, 0, -0.02, 0, 0, 0, 0, rx + 0.18, 1, rz + 0.18);   // sandy edge
  v.add(prim('disc', () => new THREE.CylinderGeometry(1, 1, 0.1, 28)), 0x5ccaf0, 0, 0.0, 0, 0, 0, 0, rx, 1, rz);                   // water
  v.add(prim('disc', () => new THREE.CylinderGeometry(1, 1, 0.1, 28)), 0x8edcf6, 0.2, 0.012, -0.15, 0, 0, 0, rx * 0.55, 1, rz * 0.4); // shine
  for (const a of [2.4, 2.7, 3.0]) {                                          // reeds and cattails
    const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    v.cyl(0.015, 0.015, 0.6, x, 0.3, z, 0x4f8f30);
    v.cap(0.03, 0.08, x, 0.6, z, 0x7a4a1c);
  }
  if (L >= 2) for (const [a, r] of [[0.6, 0.6], [2.0, 0.55], [3.8, 0.65], [5.2, 0.5]]) {   // lily pads
    v.add(prim('pad', () => new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16, 1, false, 0.5, Math.PI * 2 - 0.6)), 0x3fae49, Math.cos(a) * rx * r, 0.06, Math.sin(a) * rz * r, 0, a, 0, 0.6, 1, 0.6);
    v.ball(0.05, 0.04, 0.05, Math.cos(a) * rx * r + 0.05, 0.1, Math.sin(a) * rz * r, 0xff8fc8);
  }
  if (L >= 3) {                                                             // dock
    v.rbox(0.5, 0.06, 1.1, rx * 0.55, 0.12, rz * 0.75, 0xb88a5a, 0.02);
    for (const sx of [-1, 1]) v.cyl(0.04, 0.04, 0.3, rx * 0.55 + sx * 0.2, 0.0, rz * 0.35, 0x7a4f2c);
  }
  if (L >= 6) for (let i = 0; i < 18; i++) {                                // stone rim
    const a = i / 18 * Math.PI * 2;
    v.ball(0.16, 0.1, 0.13, Math.cos(a) * (rx + 0.22), 0.04, Math.sin(a) * (rz + 0.22), i % 2 ? 0x9aa0a6 : 0xb4babf);
  }
  if (L >= 7) {                                                             // fountain
    v.cyl(0.2, 0.26, 0.3, 0, 0.12, 0, 0xb4babf);
    v.cyl(0.08, 0.1, 0.35, 0, 0.42, 0, 0xc9cfd4);
  }
  if (L >= 8) {                                                             // a frog on a pad
    const fx = Math.cos(3.8) * rx * 0.65, fz = Math.sin(3.8) * rz * 0.65;
    v.ball(0.1, 0.07, 0.09, fx, 0.15, fz, 0x5cbf48);
    for (const z of [-1, 1]) { v.ball(0.035, 0.035, 0.035, fx + 0.05, 0.22, fz + z * 0.05, 0xffffff); v.ball(0.017, 0.017, 0.017, fx + 0.07, 0.225, fz + z * 0.05, 0x111111); }
  }
  if (L >= 9) for (const a of [0.9, 2.4, 3.9, 5.4]) {                         // lanterns
    const x = Math.cos(a) * (rx + 0.55), z = Math.sin(a) * (rz + 0.55);
    v.cyl(0.03, 0.03, 0.8, x, 0.4, z, 0x5a3a2a);
    const lamp = new THREE.Mesh(PGEO, FLY_MAT);
    lamp.scale.setScalar(0.12);
    lamp.position.set(x, 0.85, z);
    lamp.layers.set(GLOW_LAYER);
    g.add(lamp);
  }
  g.add(v.mesh());
  // fish: two at level 1, koi at 4, then one more per level from 10 on (up to 14)
  const fishCols = [];
  if (L >= 1) fishCols.push([0xff8a2a], [0xff8a2a]);
  if (L >= 4) fishCols.push([0xffffff, 0xff6a2a], [0xff6a2a, 0xffffff], [0xffd23f]);
  for (let i = 10; i <= Math.min(L, 18); i++) fishCols.push(pick([[0xff8a2a], [0xffffff, 0xff6a2a], [0xffd23f], [0xff6fae]]));
  fishCols.forEach((c, i) => farm.fish.push({ mesh: fishMesh(c), ph: i * 1.9, r: rand(0.35, 0.8), speed: rand(0.5, 0.9) * (i % 2 ? 1 : -1), jump: rand(3, 9) }));
  if (L >= 5) [1, 0.6, 0.6].forEach((sz, i) => farm.ducks.push({ mesh: duckMesh(sz), ph: -i * 0.35 }));
}

function updateFarm(dt) {
  const t = game.time, [rx, rz] = farm.pondR;
  for (const f of farm.fish) {                     // swim in loops, now and then a little leap
    const a = f.ph + t * f.speed;
    f.jump -= dt;
    let y = 0.07;
    if (f.jump < 0) {
      const k = -f.jump / 0.6;
      y += Math.sin(Math.PI * Math.min(1, k)) * 0.35;
      if (k >= 1) {
        f.jump = rand(4, 10);
        burst(POND.x + f.mesh.position.x, 0.08, FARM_Z + POND.z + f.mesh.position.z, [0xffffff, 0xbfe9ff], 4, 0.5, 2, 0.06, 0.4);
      }
    }
    f.mesh.position.set(Math.cos(a) * rx * f.r, y, Math.sin(a) * rz * f.r);
    f.mesh.rotation.y = -a - Math.sign(f.speed) * Math.PI / 2;
  }
  farm.ducks.forEach((d, i) => {                    // mother duck and ducklings paddle in a ring
    const a = t * 0.25 + d.ph;
    d.mesh.position.set(Math.cos(a) * rx * 0.62, 0.05 + Math.sin(t * 3 + i) * 0.01, Math.sin(a) * rz * 0.62);
    d.mesh.rotation.y = -a - Math.PI / 2;
  });
  if (farm.level >= 7 && (farm.spray -= dt) < 0) {  // fountain spray
    farm.spray = 0.05;
    burst(POND.x, 0.65, FARM_Z + POND.z, [0xbfe9ff, 0xffffff], 1, 0.35, 3.2, 0.07, 0.6, true);
  }
  updateWalkers(dt, t);
}

// ---------- hoppers wandering the farm ----------
// Every unlocked hopper (all four for now) strolls around the yard between rounds:
// waddling from spot to spot, pausing to look around. The one you'll play as has a
// sunflower bobbing over its head, and gives a happy hop when picked or back home.
const YARD = { x0: -4.6, x1: 4.6, z0: -3.0, z1: 4.4 };
function blockedAt(x, z) {
  const [rx, rz] = farm.pondR;
  if (((x - POND.x) / (rx + 0.45)) ** 2 + ((z - POND.z) / (rz + 0.45)) ** 2 < 1) return true;   // the pond
  if (x > -3.9 && x < -2.5 && z > 1.5 && z < 3.1) return true;                                    // sunflower patch
  return [[-2.3, 3.6], [-3.3, 0], [4.6, 0]].some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 0.55);  // mailbox, bushes
}
function pathClear(ax, az, bx, bz) {
  for (let i = 1; i <= 12; i++) if (blockedAt(lerp(ax, bx, i / 12), lerp(az, bz, i / 12))) return false;
  return true;
}
function nextSpot(w) {
  for (let tries = 0; tries < 40; tries++) {
    const x = rand(YARD.x0, YARD.x1), z = rand(YARD.z0, YARD.z1);
    const roomy = (farm.walkers || []).every(o => o === w || Math.hypot(x - o.tx, z - o.tz) > 1.4);   // don't crowd the others
    if (Math.hypot(x - w.x, z - w.z) > 1.2 && roomy && !blockedAt(x, z) && pathClear(w.x, w.z, x, z)) return [x, z];
  }
  return [w.x, w.z];
}
const MARKER_GEO = (() => {                        // a little sunflower that floats over your hopper
  const v = new VB(0.6);
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5;
    v.ball(0.04, 0.09, 0.025, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0, i % 2 ? 0xffcc1a : 0xffb000, 0, 0, a - Math.PI / 2);
  }
  v.cyl(0.085, 0.085, 0.06, 0, 0, 0.02, 0x7a4a1c, Math.PI / 2, 0, 0);
  return v.geometry();
})();
function spawnWalkers() {
  for (const w of farm.walkers || []) farm.group.remove(w.m.group);
  farm.walkers = HEROES.map(h => {
    const m = h.build();
    const w = { id: h.id, m, x: 0, z: 0, tx: 0, tz: 0, wait: rand(0.3, 2.5), ph: rand(0, 6), face: Math.PI + 0.36, hop: 0 };
    do { w.x = rand(YARD.x0, YARD.x1); w.z = rand(YARD.z0, YARD.z1); } while (blockedAt(w.x, w.z));
    w.tx = w.x; w.tz = w.z;
    m.group.position.set(w.x, 0, w.z);
    w.top = new THREE.Box3().setFromObject(m.group).max.y;   // where the marker floats
    farm.group.add(m.group);
    return w;
  });
  if (!farm.marker) {
    farm.marker = new THREE.Mesh(MARKER_GEO, VMAT);
    farm.marker.castShadow = true;
    farm.group.add(farm.marker);
  }
}
function updateWalkers(dt, t) {
  for (const w of farm.walkers) {
    const { inner, group, tails } = w.m;
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    let sway = Math.sin(t * 2.2 + w.ph) * 0.1;
    if (w.hop > 0) {                                 // happy hop
      w.hop = Math.max(0, w.hop - dt);
      inner.position.y = Math.sin(Math.PI * (1 - w.hop / 0.5)) * 0.4;
    } else if (d > 0.05) {                           // waddle toward the next spot
      const s = Math.min(d, dt * 0.9);
      w.x += dx / d * s;
      w.z += dz / d * s;
      w.face = Math.atan2(-dx, -dz);
      w.ph += dt * 9;
      inner.position.y = Math.abs(Math.sin(w.ph)) * 0.07;
      inner.rotation.z = Math.sin(w.ph) * 0.1;
      sway = Math.sin(w.ph) * 0.18;
      if (d - s <= 0.05) { w.wait = rand(1, 3.5); w.face = Math.PI + rand(-0.4, 0.9); }   // arrive, look around
    } else {                                         // stand and look around for a bit
      inner.position.y = lerp(inner.position.y, 0, Math.min(1, dt * 10));
      inner.rotation.z = lerp(inner.rotation.z, 0, Math.min(1, dt * 10));
      if ((w.wait -= dt) <= 0) [w.tx, w.tz] = nextSpot(w);
    }
    let da = w.face - group.rotation.y;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    group.rotation.y += da * Math.min(1, dt * 8);
    group.position.set(w.x, 0, w.z);
    for (const tl of tails) tl.rotation[tl.userData.axis || 'z'] = tl.userData.side * sway;
  }
  const me = farm.walkers.find(w => w.id === heroId);
  if (me) {
    farm.marker.position.set(me.x, me.top + 0.32 + Math.sin(t * 3) * 0.06 + me.m.inner.position.y, me.z);
    farm.marker.rotation.y = Math.sin(t * 1.5) * 0.5;
  }
}
// Called when arriving at the farm or picking a hopper: your hopper hops and turns to you.
function placeFarmHero() {
  if (!farm.walkers) spawnWalkers();
  const me = farm.walkers.find(w => w.id === heroId);
  if (me) { me.hop = 0.5; me.face = Math.PI + 0.36; }
}

function upgradePond() {
  const cost = pondCost(farm.level);
  if (game.coins < cost) return false;
  game.coins -= cost;
  store.set('bl-coins', game.coins);
  farm.level++;
  store.set('bl-pond', farm.level);
  buildPond();
  sfx.upgrade();
  burst(POND.x, 0.3, FARM_Z + POND.z, [0xffd23f, 0xffffff, 0xff8fc8, 0x5bb4ff], 26, 2.2, 5, 0.09, 0.9);
  burst(POND.x, 0.1, FARM_Z + POND.z, [0xffffff, 0xbfe9ff], 14, 1.2, 4, 0.12, 0.7, true);
  hud();
  return true;
}
// ---------- flow ----------
const $ = id => document.getElementById(id);
let sunDot = null, skyBar = null;
function hudDay() {   // slide the sun along the daylight dial
  sunDot ||= $('sunDot'); skyBar ||= $('sky');
  sunDot.style.left = (clamp(game.day, 0, 1) * 100).toFixed(1) + '%';
  sunDot.classList.toggle('moon', game.day < 0.15);
  skyBar.classList.toggle('low', game.day < 0.25 && game.state === 'play');
}
function hud() {
  $('score').textContent = game.score;
  $('top').textContent = 'Best ' + game.top;
  $('coinN').textContent = game.coins;
}

function newWorld() {
  for (const lane of [...lanes.values()]) removeLane(lane);
  for (const p of parts) scene.remove(p.m);
  parts.length = 0;
  for (const f of flies) scene.remove(f.m);
  flies.length = 0;
  game.day = 1;
  game.shake = 0;
  queue = [];
  genRow = -BEHIND - 3;
  game.score = 0;
  game.today = 0;
  game.record = false;
  game.camX = 0;
  game.camZ = -4;
  resetPlayer();
  ensureLanes();
  hud();
}

// The flow: farm -> (sunrise) -> road, waiting for the first hop ('title') -> play
// -> dead -> over (the sign) -> (fade home) -> farm.
function setHint() {
  const pad = document.body.classList.contains('pad');
  $('hint').innerHTML = game.where === 'farm'
    ? (pad ? 'Press A to start the day<small>Y: pick a hopper &middot; X: Fish Pond</small>' : 'Start the day<small>Spend sunflowers at the Fish Pond</small>')
    : (pad ? 'Press A to hop<small>D-pad or stick to move</small>' : 'Tap to hop<small>Swipe to turn &amp; go back</small>');
}
// Full-screen wipe; `swap` runs while the screen is covered.
function transition(kind, swapAt, swap) {
  const el = $('wipe');
  el.className = '';
  void el.offsetWidth;   // restart the animation
  el.className = kind;
  setTimeout(swap, swapAt);
  setTimeout(() => { el.className = ''; }, kind === 'sunrise' ? 2100 : 1000);
}
function goRoad() {   // sunrise, then onto the road at first light
  if (game.state !== 'farm') return;
  game.state = 'sunrise';
  closeHeroes();
  closePond();
  sfx.rooster();
  transition('sunrise', 950, () => {
    newWorld();
    game.where = 'road';
    game.state = 'title';
    game.dawn = 0.12;
    document.body.classList.remove('farm', 'show-logo');
    document.body.classList.add('ready');
    setHint();
  });
}
function goFarm() {   // after a round: a quick fade home
  if (game.state !== 'over') return;
  game.state = 'dusk';
  transition('dusk', 450, enterFarm);
}
function enterFarm() {
  music?.setLevel(1);
  $('over').classList.remove('show');
  document.body.classList.remove('over', 'ready');
  document.body.classList.add('farm');
  game.where = 'farm';
  game.state = 'farm';
  placeFarmHero();
  setHint();
  hud();
}

function startGame() {
  game.state = 'play';
  document.body.classList.remove('ready');
}

function gameOver() {
  music?.setLevel(0.45);   // duck the tune under the sign
  game.state = 'over';
  document.body.classList.add('over');
  $('overMsg').textContent = (DEATH_MSG[P.death] || 'Oh no!').replace('{name}', hero().name);
  $('overGain').textContent = game.today === 0 ? 'No sunflowers today' : `${game.today} sunflower${game.today === 1 ? '' : 's'} picked today`;
  const over = $('over');
  over.classList.toggle('record', !!game.record);
  over.classList.add('show');
  hud();
}

// ---------- input: tap = hop forward, swipe = direction ----------
let press = null;
window.addEventListener('pointerdown', e => {
  if (game.picking || e.target.closest('button')) return;
  sfx.ensure();
  press = { x: e.clientX, y: e.clientY, id: e.pointerId };
  if (game.state === 'title' || game.state === 'play') P.held = true;
});
window.addEventListener('pointerup', e => {
  if (!press || e.pointerId !== press.id || game.picking) { press = null; P.held = false; return; }
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  press = null;
  P.held = false;
  if (game.state !== 'title' && game.state !== 'play') return;
  if (Math.hypot(dx, dy) < 24) move(0, 1);
  else if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
  else move(0, dy < 0 ? 1 : -1);
});
window.addEventListener('pointercancel', () => { press = null; P.held = false; });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());

const KEYS = {
  ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};
window.addEventListener('keydown', e => {
  sfx.ensure();
  if (game.picking && pondOpen()) {   // Fish Pond panel: Enter buys, Escape closes
    if (e.code === 'Enter' || e.code === 'Space') buyPond();
    else if (e.code === 'Escape') closePond();
    e.preventDefault();
    return;
  }
  if (game.picking) {   // arrow keys + Enter work in the picker too
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) { document.body.classList.add('keys'); heroNav(nav); }
    else if (e.code === 'Enter' || e.code === 'Space') pickHero(HEROES[heroFocus].id);
    else if (e.code === 'Escape') closeHeroes();
    e.preventDefault();
    return;
  }
  if (game.state === 'farm') {          // Enter starts the day, P opens the pond, C picks a hopper
    if (e.code === 'Enter' || e.code === 'Space') { goRoad(); e.preventDefault(); }
    else if (e.code === 'KeyP') openPond();
    else if (e.code === 'KeyC') openHeroes();
    return;
  }
  if (game.state === 'over' && (e.code === 'Space' || e.code === 'Enter')) { goFarm(); return; }
  if (game.state !== 'title' && game.state !== 'play') return;
  if (e.code === 'Space' && !e.repeat) { move(0, 1); e.preventDefault(); return; }
  const k = KEYS[e.code];
  if (k && !e.repeat) { move(...k); e.preventDefault(); }
});

$('play').addEventListener('click', () => { sfx.ensure(); goFarm(); });
// Look: ?look=bold in the URL wins, otherwise the last one picked on this device.
let lookName = new URLSearchParams(location.search).get('look') || store.get('bl-look', 'cel');
if (!LOOKS[lookName]) lookName = 'cel';
applyLook(lookName);
const lookBtn = $('look');
lookBtn.classList.toggle('bold', lookName === 'bold');
lookBtn.addEventListener('click', () => {
  lookName = lookName === 'bold' ? 'cel' : 'bold';
  store.set('bl-look', lookName);
  applyLook(lookName);
  lookBtn.classList.toggle('bold', lookName === 'bold');
});
const soundBtn = $('sound');
soundBtn.classList.toggle('muted', sfx.muted);
soundBtn.addEventListener('click', () => { sfx.ensure(); soundBtn.classList.toggle('muted', sfx.toggle()); });

// ---------- main loop ----------
let last = performance.now();
function step(dt) {
  game.time += dt;
  if (game.where === 'road') {
    for (const lane of lanes.values()) {
      updateLane(lane, dt, game.time);
      for (const c of lane.coins) {
        c.m.rotation.y = Math.sin(game.time * 1.6 + c.c) * 0.7;
        c.m.position.y = LANE_Y[lane.type] + Math.abs(Math.sin(game.time * 3 + c.c)) * 0.06;
      }
    }
    updatePlayer(dt);
  } else updateFarm(dt);
  updateCamera(dt);
  if (game.where === 'road') ensureLanes();
  updateParts(dt);
  if (game.state === 'play' && P.alive) {   // the day wears on
    game.day -= dayDrain(P.r) * dt;
    if (game.day <= 0) { game.day = 0; die('night'); }
  }
  game.dawn = Math.min(1, game.dawn + dt * 0.4);   // after the sunrise, the road brightens to full day
  game.light = game.where === 'farm' ? FARM_LIGHT : Math.min(game.day, game.dawn);
  updateDay();
  if (music && Math.abs(game.light - (music.day ?? -1)) > 0.02) { music.day = game.light; music.setDay(game.light); }
  updateFlies(dt);
  hudDay();
  renderCel();
}
function frame(now) {
  pollPad();
  if (!game.frozen) step(Math.min(0.05, (now - last) / 1000));   // frozen: tests drive the frames themselves
  last = now;
  requestAnimationFrame(frame);
}

// ---------- character select ----------
// Portraits are rendered once in a throwaway WebGL context: a head-only cut-out
// of Betty Lou for the select button, and a full-body shot of each hopper.
function renderPortraits() {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xfff4ec, 0x7d6fa8, 1.5));
  const key = new THREE.DirectionalLight(0xfff3dc, 2.4);
  key.position.set(-2, 5, 6);
  sc.add(key);
  const shot = (h, size, cy, half, clipBelow) => {
    r.setSize(size, size, false);
    r.clippingPlanes = clipBelow == null ? [] : [new THREE.Plane(new THREE.Vector3(0, 1, 0), -clipBelow)];
    const m = h.build();
    m.group.rotation.y = Math.PI - 0.45;   // three-quarter view, facing the camera
    sc.add(m.group);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
    cam.position.set(0, cy + 1.2, 10);
    cam.lookAt(0, cy, 0);
    r.render(sc, cam);
    sc.remove(m.group);
    return r.domElement.toDataURL('image/png');
  };
  const head = shot(HEROES[0], 160, 1.08, 0.72, 0.74);
  const cards = HEROES.map(h => shot(h, 256, 0.8, 0.98));
  r.dispose();
  r.forceContextLoss();
  return { head, cards };
}

const shots = renderPortraits();
document.querySelectorAll('.heroBtn img').forEach(img => { img.src = shots.head; });
const heroGrid = $('heroGrid');
HEROES.forEach((h, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard';
  card.dataset.id = h.id;
  card.style.background = h.bg;
  card.innerHTML = `<img class="cutout" alt="" src="${shots.cards[i]}"><span>${h.name}</span>`;
  card.addEventListener('click', () => pickHero(h.id));
  heroGrid.append(card);
});
let heroFocus = 0;   // highlighted card when choosing with a controller or arrow keys
function markHero() {
  [...heroGrid.children].forEach((c, i) => {
    c.classList.toggle('on', c.dataset.id === heroId);
    c.classList.toggle('focus', i === heroFocus);
  });
}
function heroNav(dir) {   // the cards sit in a 2-wide grid
  const step = { left: -1, right: 1, up: -2, down: 2 }[dir];
  const n = heroFocus + step;
  if (n >= 0 && n < HEROES.length && !(Math.abs(step) === 1 && Math.floor(n / 2) !== Math.floor(heroFocus / 2))) heroFocus = n;
  markHero();
}
function openHeroes() {
  heroFocus = Math.max(0, HEROES.findIndex(h => h.id === heroId));
  markHero();
  $('heroes').classList.add('show');
  game.picking = true;
}
function closeHeroes() {
  $('heroes').classList.remove('show');
  game.picking = false;
}
function pickHero(id) {
  heroId = id;
  store.set('bl-hero', id);
  markHero();
  if (game.where === 'farm') placeFarmHero();   // show the new hopper in the yard straight away
  setTimeout(closeHeroes, 200);
}
document.querySelectorAll('.heroBtn').forEach(b => b.addEventListener('click', () => { sfx.ensure(); openHeroes(); }));
$('heroClose').addEventListener('click', closeHeroes);
$('heroes').addEventListener('click', e => { if (e.target.id === 'heroes') closeHeroes(); });
$('start').addEventListener('click', () => { sfx.ensure(); goRoad(); });
$('pondBtn').addEventListener('click', () => { sfx.ensure(); openPond(); });

// ---------- Fish Pond panel ----------
const pondOpen = () => $('pond').classList.contains('show');
function refreshPond() {
  const cost = pondCost(farm.level), short = cost - game.coins;
  $('pondLevel').textContent = farm.level === 0 ? 'A muddy little pond' : `Level ${farm.level}`;
  $('pondNext').textContent = pondNext(farm.level);
  $('pondCost').textContent = cost;
  $('pondBuy').disabled = short > 0;
  $('pondNeed').textContent = short > 0 ? `Pick ${short} more sunflower${short === 1 ? '' : 's'} on the road` : '';
}
function openPond() {
  if (game.state !== 'farm') return;
  refreshPond();
  $('pond').classList.add('show');
  game.picking = true;
}
function closePond() {
  $('pond').classList.remove('show');
  game.picking = $('heroes').classList.contains('show');
}
function buyPond() {
  if (!upgradePond()) { sfx.bump(); return; }
  refreshPond();
  const b = $('pondBuy');
  b.classList.remove('yay'); void b.offsetWidth; b.classList.add('yay');
}
$('pondBuy').addEventListener('click', buyPond);
$('pondClose').addEventListener('click', closePond);
$('pond').addEventListener('click', e => { if (e.target.id === 'pond') closePond(); });

// ---------- gamepad (for the big TV) ----------
// Rumble the controller for stampedes; Android phones get a short buzz instead.
function rumblePad(strength, ms) {
  const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(p => p && p.connected);
  if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
    gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.5 }).catch(() => {});
  } else if (strength > 0.6 && navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(40);
}
// Standard mapping: A 0, B 1, X 2, Y 3, Start 9, d-pad 12-15, left stick axes 0/1.
// Polled every frame; buttons act on the press edge so holding never repeats.
const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
const pad = { prev: [], stick: null };
function showPadHints() {
  if (document.body.classList.contains('pad')) return;
  document.body.classList.add('pad');
  setHint();
}
window.addEventListener('gamepadconnected', showPadHints);
function pollPad() {
  const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(p => p && p.connected);
  if (!gp) return;
  const down = gp.buttons.map(b => b.pressed), prev = pad.prev;
  pad.prev = down;
  const pressed = i => down[i] && !prev[i];
  const released = i => !down[i] && prev[i];

  // left stick as a d-pad: a direction fires once when pushed past 0.55, re-arms below 0.3
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, mag = Math.hypot(ax, ay);
  let stick = mag > 0.55 ? (Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up'))
    : mag > 0.3 ? pad.stick : null;
  const flick = stick && stick !== pad.stick ? stick : null;
  pad.stick = stick;
  const dir = pressed(12) ? 'up' : pressed(13) ? 'down' : pressed(14) ? 'left' : pressed(15) ? 'right' : flick;

  if (dir || down.some(Boolean)) { showPadHints(); sfx.ensure(); }
  const pick = pressed(2) || pressed(3);

  if (game.picking && pondOpen()) {
    if (pressed(0) || pressed(9)) buyPond();
    if (pressed(1) || pick) closePond();
    return;
  }
  if (game.picking) {
    if (dir) heroNav(dir);
    if (pressed(0) || pressed(9)) pickHero(HEROES[heroFocus].id);
    if (pressed(1) || pick) closeHeroes();
    return;
  }
  if (game.state === 'farm') {          // A or Start: start the day; Y: hoppers; X: Fish Pond
    if (pressed(0) || pressed(9)) goRoad();
    else if (pressed(3)) openHeroes();
    else if (pressed(2)) openPond();
    return;
  }
  if (game.state === 'over') {
    if (pressed(0) || pressed(9)) goFarm();
    return;
  }
  if (game.state === 'title' || game.state === 'play') {
    if (pressed(9)) move(0, 1);
    if (dir) move(...DIRS[dir]);
    // A behaves like a tap: squash while held, hop forward on release
    if (pressed(0)) P.held = true;
    if (released(0)) { P.held = false; move(0, 1); }
  }
}

resize();
newWorld();
buildFarm();
placeFarmHero();
document.body.classList.add('farm', 'show-logo');
setHint();
hud();
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('debug')) window.__hop = { P, game, lanes, move, step, pollPad, camera, farm };
