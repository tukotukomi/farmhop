// Betty Lou's Farm Hop: hop across the farm before the sun sets, then grow the Fish Pond back home.
// One cell = one world unit. Row r sits at z = -r, so "forward" is -z.
// Playable columns are -COLS..COLS. The world is drawn wider than that, and
// the cells outside the playable strip are shaded darker, like Crossy Road.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createMusic, breakHit, SCALES, inScale } from './music.js';
import { STRINGS, LANGS } from './lang.js';
import { joinFarm } from './guest.js';
import { createAccount } from './account/tuko-account.js';
import { UPDATES } from './updates.js';

// ---------- moving house ----------
// Each website keeps its own saves, so the old address (tuckermills.com/farmhop)
// forwards here with the farm in the link: #move=<the bl-* settings as JSON>.
// It's taken only if this browser has no farm here yet, before anything reads a
// setting, and the link is tidied up straight away.
(() => {
  const m = location.hash.match(/[#&]move=([^&]*)/);
  if (!m) return;
  try {
    const here = Object.keys(localStorage).some(k => k.startsWith('bl-'));
    const farm = JSON.parse(decodeURIComponent(m[1]));
    if (!here && farm && typeof farm === 'object') {
      for (const [k, v] of Object.entries(farm)) if (/^bl-[\w-]+$/.test(k) && typeof v === 'string' && v.length < 4000) localStorage.setItem(k, v);
    }
  } catch { /* a broken link just starts a new farm */ }
  history.replaceState(null, '', location.pathname + location.search);
})();

// ---------- language ----------
// English, Spanish or Mandarin; the device's language picks the first time, Settings after that.
const guessLang = () => { const n = (navigator.language || 'en').toLowerCase(); return n.startsWith('es') ? 'es' : n.startsWith('zh') ? 'zh' : 'en'; };
let lang = (() => { try { const v = JSON.parse(localStorage.getItem('bl-lang')); return STRINGS[v] ? v : guessLang(); } catch { return guessLang(); } })();
// t('death.squash'), t('best', { n: 3 }): falls back to English for anything missing.
function t(key, vars = {}) {
  const get = L => key.split('.').reduce((o, k) => (o == null ? o : o[k]), STRINGS[L]);
  const s = get(lang) ?? get('en') ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
const heroName = id => t('heroes.' + id);

// ---------- a friend's farm ----------
// An invite link (#join=<room>) opens the game as a guest on the host's farm:
// before anything reads a setting, wait for the host to send it (guest.js). The
// farm's settings then come from the host and are only kept in memory, so this
// device's own farm is never touched.
const FARM_KEYS = ['bl-owned', 'bl-decor', 'bl-layout', 'bl-pond', 'bl-bunk', 'bl-stage', 'bl-coins', 'bl-top', 'bl-dnb', 'bl-land', 'bl-wide', 'bl-key', 'bl-scale'];
const joinArgs = new URLSearchParams(location.hash.slice(1));
const GUEST = /^[A-Za-z0-9_-]{22,64}$/.test(joinArgs.get('join') || '') ? joinArgs.get('join') : null;
const guestNet = GUEST && window.FARMHOP_RELAY_URL
  ? await joinFarm(GUEST, joinArgs.get('relay') || window.FARMHOP_RELAY_URL, t, () => { try { return sessionStorage.getItem('bl-guest-hero') || JSON.parse(localStorage.getItem('bl-hero')); } catch { return null; } },
    () => { try { return { sup: !!JSON.parse(localStorage.getItem('bl-supporter')) }; } catch { return {}; } })
  : null;
let guestKeys = guestNet ? { ...guestNet.farm.keys, 'bl-owned-v2': true } : null;
let guestKey = guestNet?.farm.me || null;   // which hopper on the farm is ours: 'p' + our slot
const farmKey = k => FARM_KEYS.includes(k) || k === 'bl-hero' || k === 'bl-owned-v2';
let onFarmSave = null;   // the host tells its guests when the farm changes
let onLocalSave = null;  // ...and the Google account gets a copy

// ---------- tuning ----------
const COLS = 4;                 // playable columns either side of centre
const VIS = 16;                 // columns drawn either side
const SPAN = 2 * VIS + 10;      // loop length that moving things wrap around
const AHEAD = 27, BEHIND = 22;  // rows kept around the camera
const HOP_T = 0.13;             // seconds per hop
const CAM_OFF = new THREE.Vector3(2.4, 5.6, 7.2); // behind-right, a low 36° look across the fields
const _feet = new THREE.Vector3();
// Is a spot on the ground (x, z) below the bottom edge of the screen? Hoppers can't back off-screen.
const _view = new THREE.Vector3();
const belowScreen = (x, z, cam = camera) => {
  _feet.set(x, 0, z);
  // The Behind camera follows the hopper back, so there only stepping under or behind it is ruled out.
  if (cam.isPerspectiveCamera) return _view.copy(_feet).applyMatrix4(cam.matrixWorldInverse).z > -1.5;
  return _feet.project(cam).y < -0.92;
};
const RAINBOW = [0xff4b4b, 0xff9a2e, 0xffd93b, 0x5fd35f, 0x46a6ff, 0x9b6bff];
const GREENS = [0x5cb83a, 0x4faa38, 0x68c444, 0x55b03f];

// rnd is Math.random, except while a lane of the road is being built: then it's
// that row's own seeded generator, so every screen in Co-Op Hop builds the same road.
let rnd = Math.random;
const rand = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
function seeded(seed) {   // mulberry32: small, quick, and the same everywhere
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rowSeed = (r, salt = 0) => (Math.imul(game.seed, 2654435761) ^ Math.imul(r + 4096, 40503) ^ Math.imul(salt + 1, 9973)) >>> 0;
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
  get(k, d) {
    if (guestKeys && farmKey(k)) return guestKeys[k] ?? d;
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    if (guestKeys && farmKey(k)) { guestKeys[k] = v; return; }
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
    if (FARM_KEYS.includes(k)) onFarmSave?.();
    onLocalSave?.();   // signed in: copied to the account a few seconds later
  },
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
// No antialias on the canvas itself: it only ever shows the finished picture; the scene is smoothed in rtColor.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // soft-edged shadows, so they blend rather than step

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2f6e3a);
const orthoCam = new THREE.OrthographicCamera(-5, 5, 5, -5, -60, 120);
const perspCam = new THREE.PerspectiveCamera(60, 1, 0.3, 80);
let camera = orthoCam;   // the active camera: orthoCam for the farm, Classic and Low; perspCam for Behind
const GROUND_BG = scene.background;

const hemi = new THREE.HemisphereLight(0xfff4ec, 0x7d6fa8, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dc, 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
// The sun's shadow covers ±half around what's in view, and its push off each surface
// grows with the size of a shadow-map texel. Too little push and the ground fills with
// stripes of false shadow ("acne"), and phones (smaller maps, less exact GPUs) show it first.
function setShadowSpan(half = sun.shadow.camera.right) {
  const sc = sun.shadow.camera;
  if (sc.right !== half) {
    Object.assign(sc, { left: -half, right: half, top: half, bottom: -half });
    sc.updateProjectionMatrix();
  }
  sun.shadow.normalBias = Math.max(0.02, 2 * half / sun.shadow.mapSize.x * 1.5);
}
setShadowSpan();
const SUN_OFF = new THREE.Vector3(-5, 12, 4);

// ---------- graphics quality ----------
// High is the full picture. Medium and Low draw fewer pixels (the ink lines are
// redrawn at screen size, so they stay crisp), use a smaller shadow map and, on Low,
// skip edge smoothing. Auto starts where it last settled and steps down if frames drop.
const QUALITY = {
  high: { scale: dpr => Math.min(dpr, 2), samples: 4, shadow: 2048 },
  medium: { scale: dpr => Math.min(dpr, 1.5), samples: 4, shadow: 1024 },
  low: { scale: dpr => Math.max(0.75, Math.min(dpr, 1.25) * 0.8), samples: 0, shadow: 1024 },
};
const Q_LEVELS = ['high', 'medium', 'low'];
let gfx = store.get('bl-gfx', 'auto');
if (!QUALITY[gfx]) gfx = 'auto';
const autoQ = { level: QUALITY[store.get('bl-gfx-auto')] ? store.get('bl-gfx-auto') : 'high', dts: [], calm: 0, tried: false, noUp: false };
const qualityLevel = () => gfx === 'auto' ? autoQ.level : gfx;
let qualityNow = null;
function applyQuality() {
  const name = qualityLevel(), q = QUALITY[name];
  if (name === qualityNow) return;
  qualityNow = name;
  renderer.setPixelRatio(q.scale(window.devicePixelRatio || 1));
  if (rtColor.samples !== q.samples) { rtColor.samples = q.samples; rtColor.dispose(); }
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;   // three.js makes a new one at the new size
    setShadowSpan();
  }
  resize();
}
function setAuto(level) {
  autoQ.level = level;
  store.set('bl-gfx-auto', level);
  applyQuality();
  if (settingsOpen()) renderSettings();
}
// Fed the real time between frames. Two seconds under ~45 fps steps down a level;
// half a minute of smooth frames tries one step back up, once, and if that is
// too much it steps down again and stays there.
function watchFrames(dt) {
  if (gfx !== 'auto' || document.hidden || dt > 0.1) return;   // skip hitches from tab switches and loading
  const a = autoQ;
  a.dts.push(dt);
  if (a.dts.length < 120) return;
  const avg = a.dts.reduce((s, x) => s + x, 0) / a.dts.length;
  a.dts.length = 0;
  const i = Q_LEVELS.indexOf(a.level);
  if (avg > 1 / 45) {
    a.calm = 0;
    if (a.tried) a.noUp = true;
    if (i < Q_LEVELS.length - 1) setAuto(Q_LEVELS[i + 1]);
  } else if (avg < 1 / 58 && i > 0 && !a.noUp && ++a.calm >= 15) {
    a.calm = 0;
    a.tried = true;
    setAuto(Q_LEVELS[i - 1]);
  }
}

// ---------- cel shading ----------
// Lighting snaps to flat bands via a toon gradient, then a screen-space pass
// draws ink outlines wherever depth or surface direction jumps.
function ramp(levels) {
  const t = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
// The look: a soft three-band toon with plum ink.
const look = { ramp: ramp([95, 175, 255]), sky: 0xfff4ec, ground: 0x7d6fa8, hemi: 1.15, sun: 2.9, ink: 0x2b1d33, inkMix: 0.9, line: 1, sat: 1 };
const toons = [];
const toon = opts => {
  const m = new THREE.MeshToonMaterial({ gradientMap: look.ramp, ...opts });
  toons.push(m);
  return m;
};

const INK = new THREE.Color(0x2b1d33);
const rtColor = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });   // no stencil: multisampled stencil costs ~8 ms a frame on Windows
rtColor.texture.colorSpace = THREE.SRGBColorSpace;
const rtNormal = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
rtNormal.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);   // float depth: precise enough for perspective outlines
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
    persp: { value: 0 }, cnear: { value: 0.3 }, cfar: { value: 80 },
    fadeNear: { value: 20 }, fadeFar: { value: 38 },
    ink: { value: INK },
    inkMix: { value: 0.9 },
    grade: { value: new THREE.Color(1, 1, 1) },   // time-of-day tint over the whole picture
    sat: { value: 1 },
    // Night lights (torches, fireflies, the players' hoppers): ellipses on the screen
    // (centre and radii, in uv) where the night tint gives way to warm light.
    lamps: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
    lampS: { value: new Array(24).fill(0) },
    lampW: { value: new Array(24).fill(1) },   // 1: warm torchlight; 0: white, so a glowing thing keeps its own colour; -1: plain white light, no halo (stage lighting)
    lampN: { value: 0 },
    lampK: { value: 0 },   // how dark it is: 0 in the day, 1 at night
    lampCol: { value: new THREE.Color(1, 0.8, 0.5) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `
    uniform sampler2D tColor, tNormal, tDepth;
    uniform vec2 texel, texelN;  // silhouette lines vs thinner interior lines
    uniform float depthRange;
    uniform float persp, cnear, cfar, fadeNear, fadeFar;
    uniform vec3 ink;
    uniform float inkMix, sat;
    uniform vec3 grade;
    uniform vec4 lamps[24];
    uniform float lampS[24];
    uniform float lampW[24];
    uniform int lampN;
    uniform float lampK;
    uniform vec3 lampCol;
    varying vec2 vUv;
    // Orthographic depth is linear, so a flat (even sloped) surface has zero second
    // difference. With perspective the raw depth buffer is linear in 1/distance, which
    // keeps that property; the result is rescaled to world units below.
    float D(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return persp > 0.5 ? (cfar - d * (cfar - cnear)) / (cnear * cfar) : d * depthRange;
    }
    vec3 N(vec2 uv) { return texture2D(tNormal, uv).xyz; }
    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      float lit = 0., warm = 0., halo = 0.;
      for (int i = 0; i < 24; i++) {
        if (i >= lampN) break;
        vec2 q = (vUv - lamps[i].xy) / lamps[i].zw;
        float f = max(0., 1. - dot(q, q));
        lit += f * f * lampS[i];
        warm += f * f * lampS[i] * max(lampW[i], 0.);
        halo += f * lampS[i] * (lampW[i] < 0. ? 0. : 1. - lampW[i]);   // things that glow themselves (the players' sunflowers): a soft halo
      }
      vec3 tint = mix(vec3(1.), lampCol, warm / max(lit, 1e-4));
      lit = min(lit, 1.) * lampK;
      col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, sat), 0.) * mix(grade, max(grade, tint), lit) + tint * lit * 0.05 + vec3(1., .96, .82) * min(halo, 1.) * lampK * 0.28;
      vec2 dx = vec2(texel.x, 0.), dy = vec2(0., texel.y);
      float dc = D(vUv);
      // second difference: flat (even sloped) ground cancels out, steps don't
      float de = max(abs(D(vUv - dx) + D(vUv + dx) - 2. * dc), abs(D(vUv - dy) + D(vUv + dy) - 2. * dc));
      vec3 nc = N(vUv);
      vec2 nx = vec2(texelN.x, 0.), ny = vec2(0., texelN.y);
      float ne = max(max(distance(nc, N(vUv + nx)), distance(nc, N(vUv - nx))),
                     max(distance(nc, N(vUv + ny)), distance(nc, N(vUv - ny))));
      float fade = 1.0;
      if (persp > 0.5) {
        float L = 1.0 / dc;   // distance from the camera
        de *= L * L;
        fade = 1.0 - smoothstep(fadeNear, fadeFar, L);   // far lanes melt into the fog without ink
      }
      float edge = max(smoothstep(0.04, 0.09, de), smoothstep(0.25, 0.45, ne)) * fade;
      gl_FragColor = vec4(mix(col, ink, edge * inkMix), 1.);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
});
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
renderer.shadowMap.autoUpdate = false;

const GLOW_LAYER = 1;
// Split screen draws each half with its own camera into its own part of the same
// targets; the outline pass then runs once over the whole picture (and inks the seam).
function renderCel() {
  const views = splitViews() || [null];
  const bg = scene.background;
  for (const rt of [rtColor, rtNormal]) {
    for (const v of views) {
      const cam = v ? v.cam : camera;
      if (v) { rt.viewport.set(...v.rect); rt.scissor.set(...v.rect); rt.scissorTest = true; }
      renderer.setRenderTarget(rt);
      if (rt === rtColor) {
        if (v) aimSun(v.x, v.z);
        renderer.shadowMap.needsUpdate = true;
        cam.layers.enable(GLOW_LAYER);    // glowing bits (fireflies) are drawn but get no ink outline
        cam.layers.enable(XRAY_LAYER);
        renderer.render(scene, cam);
        cam.layers.disable(GLOW_LAYER);
        cam.layers.disable(XRAY_LAYER);
      } else {
        scene.overrideMaterial = normalMat;
        scene.background = null;
        renderer.render(scene, cam);
        scene.overrideMaterial = null;
        scene.background = bg;
      }
    }
    rt.viewport.set(0, 0, rt.width, rt.height);
    rt.scissorTest = false;
  }
  renderer.setRenderTarget(null);
  placeLamps(views);
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
function applyLook() {
  const L = look;
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
  [1.0, 0xfff3dc, 1.0, 0xfff4ec, 0x7d6fa8, 1.0, 0xffffff, 12, 0xa8dcff],    // midday
  [0.45, 0xffcf94, 1.0, 0xffe4c8, 0x8a6fa8, 0.95, 0xfff0dc, 7, 0xffd8b0],    // golden hour
  [0.2, 0xffd6c4, 0.8, 0xdcc8ff, 0x6a5aa0, 0.9, 0xece4fa, 4, 0xcdb6f0],    // dusk: lavender, grass stays green
  [0.0, 0xa8bcff, 0.5, 0x7088d0, 0x30306a, 0.72, 0x93a8ee, 6, 0x2c3470],    // night, moonlit blue
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
  mixHex(A[4], B[4], t, hemi.groundColor);
  hemi.intensity = look.hemi * lerp(A[5], B[5], t);
  mixHex(A[6], B[6], t, postMat.uniforms.grade.value);
  SUN_OFF.y = lerp(A[7], B[7], t);
  if (game.where === 'farm') SUN_OFF.x = farmSunX();   // the sun crosses the farm by day, the moon by night
  else SUN_OFF.x = -5;
  mixHex(A[8], B[8], t, skyCol);   // the sky behind the Behind view, and its fog
  fog.color.copy(skyCol);
}

// Fireflies come out at dusk: little glowing dots drifting around the hopper.
const flies = [];
const FLY_MAT = new THREE.MeshBasicMaterial({ color: 0xfff27a });
function updateFlies(dt) {
  if (game.day < 0.35 && game.state === 'play' && flies.length < 30 && Math.random() < dt * 14) {
    const m = new THREE.Mesh(PGEO, FLY_MAT);
    m.layers.set(GLOW_LAYER);
    const f = roadFocus();
    m.position.set(f.x + rand(-5, 5), rand(0.3, 1.4), f.z + rand(-9, 3));
    scene.add(m);
    flies.push({ m, t: 0, life: rand(2, 4), ph: rand(0, 6) });
  }
  // On the farm after dark: drifting over the pond, and here and there in the yard.
  if (game.where === 'farm' && game.state === 'farm' && farm.pond && flies.length < 36 * nightK() && Math.random() < dt * 10) {
    const m = new THREE.Mesh(PGEO, FLY_MAT);
    m.layers.set(GLOW_LAYER);
    const base = farm.group.position;
    if (Math.random() < 0.65) {
      const [rx, rz] = farm.pondR, a = rand(0, Math.PI * 2), r = rand(0.5, 1.5);
      farm.pond.localToWorld(m.position.set(Math.cos(a) * rx * r, rand(0.25, 1.1), Math.sin(a) * rz * r));
    } else m.position.set(base.x + rand(YARD.x0, YARD.x1), rand(0.3, 1.3), base.z + rand(YARD.z0, YARD.z1));
    scene.add(m);
    flies.push({ m, t: 0, life: rand(3, 6), ph: rand(0, 6) });
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
// The low cameras let trees and traffic stand in front of the hopper, so a flat
// silhouette is drawn wherever something else covers her. No stencil buffer for this:
// a multisampled stencil is very slow on Windows. Instead, after everything else the
// silhouette is drawn where she is hidden (greater depth), and then her visible
// pixels are drawn again on top, wiping the bits of silhouette that landed on her own body.
const GIRL_MAT = toon({ vertexColors: true });
const XRAY_LAYER = 2;   // only the colour pass draws these (not the outline or shadow passes)
const XRAY_MAT = new THREE.MeshBasicMaterial({ color: 0x8a5cff, transparent: true, opacity: 0.8, depthWrite: false, depthFunc: THREE.GreaterDepth });
const REDRAW_MAT = toon({ vertexColors: true, transparent: true, depthWrite: false });
function addXray(model) {   // only the hopper you're playing needs it
  const meshes = [];
  model.group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) for (const [mat, order] of [[XRAY_MAT, 10], [REDRAW_MAT, 11]]) {
    const c = new THREE.Mesh(m.geometry, mat);
    c.renderOrder = order;
    c.receiveShadow = true;
    c.layers.set(XRAY_LAYER);
    m.add(c);
  }
  return model;
}

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

// Shared by every playable character: scale and material.
// `wobbles` are pivoted meshes that bounce when hopping (pigtails, tails...);
// userData.side sets direction and userData.axis the rotation axis (default z).
function finishHero(group, inner, wobbles) {
  group.scale.setScalar(1.3);
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    m.material = GIRL_MAT;
    m.castShadow = true;
  }
  return { group, inner, tails: wobbles };
}
// Free a hopper's GPU buffers once it leaves the scene (every hopper is built fresh, so nothing is shared).
function disposeHero(model) {
  model.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
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

function buildTuko() {
  const FOX = 0xff8a2a, FOX_D = 0xe0661a, W = 0xfff4e6, K = 0x2e2230, HAT = 0x3f8fe0, HAT_D = 0x2c6fc0;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.07, 0.045, 0.1, s * 0.09, 0.045, -0.03, K);               // dark socks
    b.cap(0.055, 0.08, s * 0.09, 0.16, 0, FOX);
    b.cap(0.04, 0.12, s * 0.185, 0.41, -0.02, FOX, 0, 0, s * 0.25);    // arms
    b.ball(0.045, 0.045, 0.045, s * 0.21, 0.31, -0.03, K);             // paws
    b.ball(0.07, 0.05, 0.05, s * 0.07, 0.64, -0.17, W);                // white cheeks
    b.ball(0.034, 0.044, 0.02, s * 0.095, 0.765, -0.19, 0x222222);     // eyes
    b.ball(0.012, 0.014, 0.008, s * 0.095 + 0.01, 0.782, -0.208, 0xffffff);
    b.cone(0.1, 0.22, s * 0.15, 0.95, 0.02, FOX, 0, 0, -s * 0.28);     // big pointed ears, poking through the cap
    b.cone(0.06, 0.13, s * 0.145, 0.93, -0.03, W, 0, 0, -s * 0.28);
    b.cone(0.048, 0.08, s * 0.172, 1.024, 0.02, K, 0, 0, -s * 0.28);    // dark ear tips
  }
  b.ball(0.17, 0.17, 0.14, 0, 0.36, 0, FOX);                           // body
  b.ball(0.1, 0.12, 0.04, 0, 0.37, -0.115, W);                         // white chest
  b.hiBall(0.25, 0.2, 0.21, 0, 0.72, 0, FOX);                          // head
  b.ball(0.08, 0.06, 0.12, 0, 0.64, -0.14, W);                         // pointy snout
  b.ball(0.03, 0.022, 0.02, 0, 0.66, -0.265, K);                       // nose
  b.torus(0.028, 0.008, Math.PI, 0, 0.605, -0.21, 0xc2475f, 0, 0, Math.PI); // grin
  b.ball(0.2, 0.09, 0.19, 0, 0.87, 0.01, HAT);                         // baseball cap, worn backwards
  b.ball(0.025, 0.02, 0.025, 0, 0.958, 0.01, HAT_D);                   // button on top
  b.ball(0.15, 0.02, 0.13, 0.1, 0.85, 0.19, HAT_D, 0, 0.5, 0);        // brim out the back, a little to one side
  b.ball(0.07, 0.05, 0.03, -0.05, 0.9, 0.16, 0xffffff, 0, 0.5, 0);    // the white front panel ends up at the back too
  b.torus(0.05, 0.012, Math.PI, 0, 0.83, -0.185, HAT_D, 0, 0, 0);      // snapback strap across the forehead
  inner.add(b.mesh());
  const t = new VB();                                                 // big bushy tail, white tip
  for (const [y, z, r] of [[0.0, 0.06, 0.07], [0.07, 0.13, 0.09], [0.16, 0.18, 0.1], [0.26, 0.2, 0.095]]) t.ball(r, r, r, 0, y, z, FOX_D);
  t.ball(0.085, 0.09, 0.085, 0, 0.35, 0.19, W);
  return finishHero(group, inner, [wobble(inner, t, 0, 0.24, 0.12, 1)]);
}

// Captain Awesome: a big 55-year-old with a white beard and a stern brow who turns out
// to be the friendliest guy on the farm. A baseball cap worn forwards, a black shirt,
// jeans and work boots, and his acoustic guitar slung on his back.
function buildCaptain() {
  const SKIN = 0xf5caa8, DENIM = 0x3d5f9a, DENIM_D = 0x2e4a7a, BOOT = 0x6b4226, W = 0xf6f4ef, W_D = 0xe4e0d8;
  const HAT = 0x2f4566, HAT_D = 0x22344f, SHIRT = 0x2a2a30, WOOD = 0xd9984e, WOOD_D = 0x8a5a2b, NECK = 0x6b4226;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.085, 0.055, 0.115, s * 0.095, 0.05, -0.03, BOOT);           // work boots
    b.cap(0.06, 0.1, s * 0.095, 0.18, 0, DENIM);                         // jeans
    b.rbox(0.135, 0.04, 0.135, s * 0.095, 0.115, 0, DENIM_D, 0.02);      // turned-up cuffs
    b.cap(0.043, 0.12, s * 0.22, 0.42, 0, SKIN, 0, 0, s * 0.18);         // bare forearms...
    b.cap(0.058, 0.03, s * 0.2, 0.51, 0, SHIRT, 0, 0, s * 0.18);         // ...under short sleeves
    b.ball(0.055, 0.055, 0.055, s * 0.245, 0.31, -0.01, SKIN);           // big hands
    b.ball(0.034, 0.037, 0.02, s * 0.085, 0.785, -0.214, 0x2a2420);      // eyes, round and kind under the brows
    b.ball(0.014, 0.014, 0.008, s * 0.085 + 0.011, 0.796, -0.231, 0xffffff);
    b.rbox(0.095, 0.034, 0.034, s * 0.088, 0.838, -0.21, W, 0.014, 0, 0, s * 0.12);   // bushy white brows, a little stern
    b.ball(0.042, 0.024, 0.01, s * 0.155, 0.725, -0.188, 0xff9e9e);     // rosy cheeks: a big softie really
    b.ball(0.07, 0.11, 0.1, s * 0.215, 0.79, 0.05, W);                   // white hair round the sides...
    b.ball(0.075, 0.042, 0.04, s * 0.058, 0.69, -0.214, W, 0, 0, s * 0.25);   // moustache
    b.cone(0.05, 0.07, s * 0.07, 0.635, -0.135, SHIRT, Math.PI / 2 - 0.5, 0, s * 0.4);   // shirt collar points
  }
  b.ball(0.14, 0.1, 0.1, 0, 0.8, 0.165, W);                               // ...and round the back
  b.ball(0.22, 0.12, 0.17, 0, 0.28, 0, DENIM);                           // jeans
  b.cyl(0.2, 0.2, 0.04, 0, 0.36, 0, 0x5a3a24);                      // belt
  b.rbox(0.07, 0.05, 0.02, 0, 0.36, -0.195, 0xd8b04a, 0.01);              // buckle
  b.ball(0.215, 0.19, 0.17, 0, 0.49, 0, SHIRT);                          // black shirt, a big frame
  for (const y of [0.42, 0.48, 0.54, 0.6]) b.ball(0.014, 0.014, 0.01, 0, y, -0.168, 0xf4ead8);   // buttons
  b.hiBall(0.235, 0.225, 0.215, 0, 0.79, 0, SKIN);                       // head: mostly bald
  b.ball(0.036, 0.032, 0.03, 0, 0.75, -0.232, 0xeeac8c);                 // nose
  b.ball(0.19, 0.125, 0.12, 0, 0.66, -0.085, W);                         // big white beard
  b.ball(0.12, 0.08, 0.09, 0, 0.61, -0.11, W_D);
  b.torus(0.03, 0.008, Math.PI, 0, 0.665, -0.205, 0x8a3a3a, 0, 0, Math.PI);   // a smile peeking out of the beard
  // a baseball cap, worn forwards, a button on top and a little patch on the front
  b.ball(0.245, 0.165, 0.232, 0, 0.935, 0.005, HAT);                        // crown
  b.ball(0.022, 0.014, 0.022, 0, 1.099, 0.005, HAT_D);                    // button
  b.ball(0.175, 0.018, 0.125, 0, 0.9, -0.245, HAT_D, -0.12, 0, 0);       // bill, curved down at the front
  b.ball(0.055, 0.045, 0.012, 0, 0.99, -0.218, 0xf4ead8, -0.35, 0, 0);    // patch
  b.ball(0.03, 0.016, 0.01, 0, 0.99, -0.226, 0x3a7fc0, -0.35, 0, 0);     // a little fish on it
  b.cap(0.018, 0.4, 0.005, 0.49, -0.168, 0x5a3a24, 0, 0, 0.87);          // guitar strap, shoulder to hip, under the beard
  inner.add(b.mesh());
  const g = new VB();                                                   // the acoustic guitar on his back
  g.ball(0.17, 0.19, 0.06, 0, 0, 0, WOOD);                              // lower bout
  g.ball(0.13, 0.13, 0.06, 0, 0.2, 0, WOOD);                            // upper bout
  g.cyl(0.05, 0.05, 0.01, 0, 0.06, 0.06, 0x2a1a10, Math.PI / 2, 0, 0);  // sound hole
  g.rbox(0.08, 0.03, 0.02, 0, -0.08, 0.06, WOOD_D, 0.008);              // bridge
  g.rbox(0.055, 0.42, 0.04, 0, 0.5, 0.01, NECK, 0.012);                 // neck
  g.rbox(0.085, 0.12, 0.04, 0, 0.75, 0.0, WOOD_D, 0.015);               // headstock
  for (const s of [-1, 1]) for (const y of [0.71, 0.75, 0.79]) g.ball(0.012, 0.012, 0.012, s * 0.055, y, 0, 0xd8d8d8);   // tuning pegs
  const gm = g.mesh();
  gm.position.set(0.02, 0.5, 0.2);
  gm.rotation.set(0.12, 0, -0.55);
  inner.add(gm);
  return finishHero(group, inner, []);
}

// A little heart, facing out from the front (for Spicy Spider's shirt).
function heartOn(v, x, y, z, s, color) {
  for (const side of [-1, 1]) v.ball(s * 0.55, s * 0.55, s * 0.3, x + side * s * 0.42, y + s * 0.22, z, color);
  v.cone(s * 0.7, s * 1.0, x, y - s * 0.38, z, color, Math.PI, 0, 0);
}

function buildSpicySpider() {   // Spicy Spider: a spider queen in a shirt covered in blue hearts
  const K = 0x3d2f52, K2 = 0x5a4774, SHIRT = 0xf6f2ff, HEART = 0x3f7fe0, GOLD = 0xffd23f, W = 0xffffff;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.07, 0.045, 0.1, s * 0.09, 0.045, -0.03, K2);               // feet
    b.cap(0.055, 0.08, s * 0.09, 0.16, 0, K);
    b.cap(0.04, 0.12, s * 0.185, 0.41, -0.02, K, 0, 0, s * 0.25);       // arms
    b.ball(0.065, 0.06, 0.065, s * 0.16, 0.48, -0.01, SHIRT);           // short sleeves
    b.ball(0.045, 0.045, 0.045, s * 0.21, 0.31, -0.03, K2);             // hands
    b.ball(0.052, 0.06, 0.025, s * 0.09, 0.74, -0.188, W);              // two big eyes...
    b.ball(0.027, 0.034, 0.015, s * 0.09, 0.735, -0.208, 0x1a1020);
    b.ball(0.01, 0.012, 0.006, s * 0.09 + 0.012, 0.75, -0.22, W);
    b.ball(0.022, 0.024, 0.012, s * 0.055, 0.845, -0.168, 0xff5f9e);    // ...and four little ones above
    b.ball(0.016, 0.018, 0.01, s * 0.14, 0.825, -0.16, 0xff5f9e);
    b.ball(0.036, 0.018, 0.01, s * 0.16, 0.66, -0.172, 0xff9ec4);       // cheeks
    b.cone(0.012, 0.045, s * 0.032, 0.615, -0.188, W, Math.PI, 0, 0);    // two tiny fangs
  }
  b.ball(0.17, 0.17, 0.14, 0, 0.36, 0, SHIRT);                         // the shirt
  heartOn(b, 0, 0.42, -0.142, 0.05, HEART);                            // blue hearts all over it
  heartOn(b, -0.075, 0.3, -0.128, 0.035, HEART);
  heartOn(b, 0.08, 0.31, -0.128, 0.035, HEART);
  heartOn(b, -0.12, 0.43, -0.09, 0.03, HEART);
  heartOn(b, 0.125, 0.42, -0.09, 0.03, HEART);
  b.hiBall(0.25, 0.21, 0.21, 0, 0.72, 0, K);                           // head
  b.torus(0.035, 0.009, Math.PI, 0, 0.665, -0.198, 0xff7fb8, 0, 0, Math.PI);   // smile
  b.cyl(0.095, 0.105, 0.06, 0, 0.955, 0, GOLD);                        // a queen's crown
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 - Math.PI / 2;
    b.cone(0.024, 0.07, Math.cos(a) * 0.088, 1.02, Math.sin(a) * 0.088, GOLD);
  }
  b.ball(0.022, 0.022, 0.014, 0, 0.955, -0.104, 0xff5f9e);              // its jewel
  inner.add(b.mesh());
  const wob = [];
  for (const s of [-1, 1]) {                                          // four more legs, waving
    const L = new VB();
    for (const [dy, dz] of [[0.05, -0.04], [-0.07, 0.05]]) {
      L.cap(0.02, 0.15, s * 0.1, dy + 0.05, dz, K, 0, 0, -s * 1.05);
      L.cap(0.018, 0.11, s * 0.2, dy - 0.02, dz, K, 0, 0, s * 0.45);
      L.ball(0.025, 0.025, 0.025, s * 0.225, dy - 0.085, dz, K2);
    }
    wob.push(wobble(inner, L, s * 0.13, 0.38, 0.02, s));
  }
  return finishHero(group, inner, wob);
}

function buildLyla() {   // Lyla: a grey American bulldog in a green onesie and a green crown
  const FUR = 0xa9a9b6, FUR_D = 0x80808f, W = 0xf6f4f2, K = 0x2e2230, SUIT = 0x5fbf5a, SUIT_D = 0x46a043, CROWN = 0x4cc35a, GEM = 0xffd23f;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.075, 0.045, 0.1, s * 0.1, 0.045, -0.03, SUIT_D);           // onesie feet
    b.cap(0.06, 0.08, s * 0.1, 0.16, 0, SUIT);                          // sturdy legs
    b.cap(0.045, 0.12, s * 0.2, 0.41, -0.02, SUIT, 0, 0, s * 0.25);     // arms
    b.ball(0.05, 0.048, 0.05, s * 0.225, 0.31, -0.03, FUR);             // paws
    b.ball(0.075, 0.06, 0.05, s * 0.085, 0.585, -0.235, W);             // droopy jowls either side of the jaw
    b.ball(0.034, 0.04, 0.02, s * 0.12, 0.77, -0.19, 0x222222);         // wide-set eyes
    b.ball(0.012, 0.014, 0.008, s * 0.12 + 0.011, 0.785, -0.208, 0xffffff);
    b.ball(0.06, 0.022, 0.04, s * 0.115, 0.815, -0.175, FUR_D, 0, 0, -s * 0.25);   // a frowny bulldog brow
    b.ball(0.085, 0.07, 0.025, s * 0.2, 0.85, -0.09, FUR_D, -0.7, 0, s * 0.5);     // ears folding forward at the corners
    b.cone(0.012, 0.03, s * 0.055, 0.59, -0.27, W);                      // an underbite
  }
  b.ball(0.19, 0.17, 0.15, 0, 0.36, 0, SUIT);                          // a stocky chest, in the onesie
  b.ball(0.09, 0.07, 0.04, 0, 0.47, -0.13, W);                         // white chest peeking out
  for (const y of [0.4, 0.33, 0.26]) b.ball(0.017, 0.017, 0.01, 0, y, -0.15, W);   // the onesie's buttons
  b.ball(0.2, 0.13, 0.1, 0, 0.6, 0.13, SUIT_D);                        // its hood, down at the back
  b.rbox(0.46, 0.33, 0.38, 0, 0.72, 0, FUR, 0.13);                    // a broad, square bulldog head
  b.rbox(0.07, 0.2, 0.03, 0, 0.78, -0.19, W, 0.03);                    // white blaze
  b.rbox(0.26, 0.15, 0.14, 0, 0.635, -0.2, W, 0.06);                   // short, square muzzle
  b.ball(0.06, 0.04, 0.035, 0, 0.7, -0.275, K);                        // big black nose
  b.ball(0.028, 0.016, 0.012, 0, 0.575, -0.27, 0xff7fa0);              // tongue
  b.cyl(0.11, 0.12, 0.06, 0, 0.92, 0.01, CROWN);                       // a green crown
  for (let i = 0; i < 5; i++) {
    const ang = i / 5 * Math.PI * 2 - Math.PI / 2;
    b.cone(0.026, 0.07, Math.cos(ang) * 0.1, 0.985, 0.01 + Math.sin(ang) * 0.1, CROWN);
  }
  b.ball(0.024, 0.024, 0.014, 0, 0.92, -0.11, GEM);
  inner.add(b.mesh());
  const t = new VB();                                                 // a little stub of a tail
  t.ball(0.04, 0.04, 0.045, 0, 0, 0.03, SUIT);
  return finishHero(group, inner, [wobble(inner, t, 0, 0.26, 0.14, 1)]);
}

function buildCarla() {   // Carla: a capybara in a yellow princess dress and yellow heels
  const FUR = 0xa8754a, FUR_D = 0x86593a, K = 0x2e2230, DRESS = 0xffd84a, DRESS_D = 0xf2b52a, HEEL = 0xffc61a, GOLD = 0xffcf2a, GEM = 0xff7fb8;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.cap(0.042, 0.09, s * 0.08, 0.13, 0, FUR);                         // capybara legs below the skirt
    b.ball(0.05, 0.03, 0.085, s * 0.08, 0.035, -0.03, HEEL);            // yellow heels...
    b.cyl(0.012, 0.008, 0.06, s * 0.08, 0.03, 0.045, HEEL);             // ...with a little heel at the back
    b.cap(0.042, 0.12, s * 0.2, 0.41, -0.02, FUR, 0, 0, s * 0.25);      // arms
    b.ball(0.085, 0.072, 0.08, s * 0.2, 0.5, 0, DRESS);                 // puffy sleeves
    b.ball(0.042, 0.042, 0.042, s * 0.225, 0.31, -0.03, FUR_D);         // paws
    b.ball(0.034, 0.02, 0.015, s * 0.105, 0.85, -0.172, K);             // calm, half-closed eyes, up above the snout
    b.ball(0.01, 0.008, 0.005, s * 0.105 + 0.012, 0.857, -0.185, 0xffffff);
    b.ball(0.042, 0.036, 0.03, s * 0.15, 0.91, 0.04, FUR_D);            // little round ears
    b.ball(0.012, 0.009, 0.006, s * 0.032, 0.745, -0.262, K);            // nostrils
    b.ball(0.035, 0.018, 0.01, s * 0.15, 0.75, -0.17, 0xff9ec4);         // cheeks
  }
  b.ball(0.2, 0.18, 0.17, 0, 0.4, 0, FUR);                             // a round, barrel-shaped capybara body
  b.cyl(0.2, 0.27, 0.26, 0, 0.28, 0, DRESS);                           // the princess skirt, flaring from the waist, legs showing below
  b.torus(0.27, 0.03, Math.PI * 2, 0, 0.16, 0, DRESS_D, Math.PI / 2, 0, 0);     // its ruffled hem
  b.torus(0.205, 0.024, Math.PI * 2, 0, 0.36, 0, DRESS_D, Math.PI / 2, 0, 0);    // a sash at the waist
  b.ball(0.214, 0.17, 0.195, 0, 0.41, 0, DRESS);                       // the bodice, up to a modest neckline
  b.torus(0.15, 0.02, Math.PI * 2, 0, 0.555, -0.005, DRESS_D, Math.PI / 2, 0, 0);   // its neckline trim
  b.ball(0.055, 0.032, 0.02, 0, 0.45, -0.2, GEM);                      // a pink bow
  b.hiBall(0.22, 0.2, 0.22, 0, 0.77, 0, FUR);                          // head
  b.ball(0.13, 0.1, 0.14, 0, 0.71, -0.12, FUR);                        // the big blunt capybara snout
  b.ball(0.085, 0.045, 0.05, 0, 0.74, -0.215, 0x9a6a42);              // its darker nose pad
  b.torus(0.028, 0.008, Math.PI, 0, 0.665, -0.24, 0xc2475f, 0, 0, Math.PI);  // a small smile
  inner.add(b.mesh());
  const tiara = new VB();                                             // a tiara, bobbing a little
  tiara.torus(0.075, 0.014, Math.PI, 0, 0, 0, GOLD, -0.3, 0, 0);
  for (const [x, h] of [[-0.05, 0.05], [0, 0.08], [0.05, 0.05]]) tiara.cone(0.018, h, x, 0.06 + h / 2 - 0.02, -0.02, GOLD);
  tiara.ball(0.02, 0.02, 0.012, 0, 0.06, -0.035, GEM);
  return finishHero(group, inner, [wobble(inner, tiara, 0, 0.95, 0.02, 1, 'x')]);
}

function buildSiracha() {   // Sir Racha: a cool white duck in shades, a black beanie and a black hoodie lined in red
  const W = 0xffffff, K = 0x24222c, K2 = 0x3a3846, RED = 0xe53935, BILL = 0xffc21a, BILL_D = 0xf2a20a;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.09, 0.022, 0.12, s * 0.095, 0.022, -0.06, BILL);            // yellow webbed feet...
    for (const dx of [-0.045, 0, 0.045]) b.cap(0.012, 0.07, s * 0.095 + dx, 0.03, -0.13, BILL_D, Math.PI / 2, 0, 0);   // ...with their toes
    b.cap(0.026, 0.09, s * 0.09, 0.12, 0, BILL);                        // thin duck legs
    b.cap(0.045, 0.12, s * 0.19, 0.41, -0.02, K, 0, 0, s * 0.25);       // hoodie sleeves
    b.ball(0.05, 0.026, 0.05, s * 0.212, 0.34, -0.03, RED);             // red cuffs
    b.ball(0.045, 0.05, 0.045, s * 0.222, 0.3, -0.03, W);               // white wing tips for hands
    b.rbox(0.12, 0.08, 0.03, s * 0.078, 0.775, -0.2, K, 0.025, 0, s * 0.35, 0);   // cool black sunglasses, wrapping round the face
    b.rbox(0.03, 0.012, 0.01, s * 0.064, 0.795, -0.218, 0x8a8aa0, 0.004, 0, s * 0.35, 0);   // a glint on each lens
    b.cap(0.01, 0.12, s * 0.15, 0.785, -0.1, K, Math.PI / 2, 0, 0);      // their arms back to the ears
    b.cap(0.007, 0.07, s * 0.04, 0.45, -0.152, W);                       // hoodie drawstrings
  }
  b.ball(0.17, 0.18, 0.15, 0, 0.37, 0, K);                             // the black hoodie
  b.ball(0.1, 0.05, 0.03, 0, 0.29, -0.135, K2);                        // its front pocket
  b.ball(0.18, 0.11, 0.1, 0, 0.55, 0.12, K);                           // the hood, down at the back...
  b.ball(0.135, 0.08, 0.07, 0, 0.58, 0.1, RED);                        // ...showing its red lining
  b.torus(0.13, 0.024, Math.PI * 2, 0, 0.55, 0.02, RED, Math.PI / 2, 0, 0);   // the red-lined edge of the hood, round his neck
  b.hiBall(0.21, 0.21, 0.2, 0, 0.74, 0, W);                            // white duck head
  b.ball(0.13, 0.045, 0.1, 0, 0.665, -0.18, BILL);                     // a wide yellow bill
  b.ball(0.11, 0.03, 0.08, 0, 0.625, -0.165, BILL_D);
  b.rbox(0.05, 0.015, 0.02, 0, 0.79, -0.213, K, 0.006);                // the shades' bridge
  b.ball(0.205, 0.12, 0.195, 0, 0.88, 0.01, K);                        // a black beanie
  b.cyl(0.2, 0.21, 0.06, 0, 0.84, 0.01, K2);                           // its folded brim
  inner.add(b.mesh());
  const t = new VB();                                                 // a perky white tail tuft
  t.cone(0.06, 0.12, 0, 0.03, 0.05, W, -1.1, 0, 0);
  return finishHero(group, inner, [wobble(inner, t, 0, 0.3, 0.13, 1)]);
}

function buildRibbit() {   // DJ Ribbit: a frog in big headphones
  const FROG = 0x6fd24a, FROG_D = 0x4fae36, BELLY = 0xe9f7b0, W = 0xffffff, K = 0x2e2230, PHONE = 0x8a5cff, PHONE_D = 0x5a3cc0, PAD = 0xff7fb8;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  for (const s of [-1, 1]) {
    b.ball(0.09, 0.035, 0.12, s * 0.1, 0.035, -0.04, FROG_D);           // big flat feet
    b.cap(0.055, 0.08, s * 0.09, 0.16, 0, FROG);
    b.cap(0.04, 0.12, s * 0.185, 0.41, -0.02, FROG, 0, 0, s * 0.25);    // arms
    b.ball(0.045, 0.045, 0.045, s * 0.21, 0.31, -0.03, FROG_D);         // hands
    b.ball(0.085, 0.085, 0.08, s * 0.12, 0.86, -0.05, FROG);            // eyes up on top
    b.ball(0.062, 0.064, 0.03, s * 0.12, 0.87, -0.115, W);
    b.ball(0.03, 0.036, 0.015, s * 0.12, 0.865, -0.142, K);
    b.ball(0.011, 0.013, 0.006, s * 0.12 + 0.012, 0.882, -0.156, W);
    b.ball(0.042, 0.022, 0.01, s * 0.17, 0.655, -0.185, 0xff9eb5);      // cheeks
    b.ball(0.07, 0.09, 0.09, s * 0.275, 0.73, 0.03, PHONE);             // headphone cups
    b.ball(0.025, 0.065, 0.065, s * 0.33, 0.73, 0.03, PAD);
  }
  b.ball(0.17, 0.17, 0.14, 0, 0.36, 0, FROG);                          // body
  b.ball(0.11, 0.12, 0.04, 0, 0.36, -0.115, BELLY);                    // pale tummy
  b.hiBall(0.27, 0.17, 0.21, 0, 0.7, 0, FROG);                         // wide head
  b.torus(0.08, 0.011, Math.PI, 0, 0.665, -0.19, 0xc2475f, 0, 0, Math.PI);   // a big wide grin
  b.torus(0.285, 0.024, Math.PI, 0, 0.73, 0.06, PHONE_D);             // the headband, over the top
  inner.add(b.mesh());
  const n = new VB();                                                 // a music note bobbing over one ear
  n.cap(0.008, 0.11, 0, 0.06, 0, K);
  n.ball(0.03, 0.022, 0.02, -0.024, 0, 0, K, 0, 0, 0.4);
  n.cap(0.008, 0.035, 0.02, 0.105, 0, K, 0, 0, -1.2);
  return finishHero(group, inner, [wobble(inner, n, 0.36, 0.9, 0.04, 1, 'x')]);
}

function buildMoonbun() {   // Moonbun: a lavender bunny with a crescent-moon clip
  const FUR = 0xcdb8ff, FUR_D = 0xa98be8, W = 0xfff8ff, PINK = 0xff9ec4, MOON = 0xffd23f;
  const group = new THREE.Group(), inner = new THREE.Group();
  group.add(inner);
  const b = new VB();
  const wob = [];
  for (const s of [-1, 1]) {
    b.ball(0.07, 0.045, 0.13, s * 0.09, 0.045, -0.05, W);               // big bunny feet
    b.cap(0.055, 0.08, s * 0.09, 0.16, 0, FUR);
    b.cap(0.04, 0.12, s * 0.185, 0.41, -0.02, FUR, 0, 0, s * 0.25);     // arms
    b.ball(0.045, 0.045, 0.045, s * 0.21, 0.31, -0.03, W);              // paws
    b.ball(0.06, 0.045, 0.04, s * 0.04, 0.645, -0.18, W);               // muzzle
    b.ball(0.033, 0.043, 0.02, s * 0.095, 0.765, -0.19, 0x2e2230);      // eyes
    b.ball(0.012, 0.014, 0.008, s * 0.095 + 0.01, 0.782, -0.208, W);
    b.ball(0.04, 0.02, 0.01, s * 0.16, 0.67, -0.17, PINK);              // cheeks
    const e = new VB();                                               // long ears that flop as she hops
    e.ball(0.06, 0.21, 0.04, 0, 0.2, 0, FUR, 0, 0, -s * 0.12);
    e.ball(0.034, 0.15, 0.01, 0, 0.2, -0.035, PINK, 0, 0, -s * 0.12);
    wob.push(wobble(inner, e, s * 0.1, 0.86, 0.02, s));
  }
  b.ball(0.17, 0.17, 0.14, 0, 0.36, 0, FUR);                           // body
  b.ball(0.1, 0.12, 0.04, 0, 0.37, -0.115, W);                         // white tummy
  b.hiBall(0.24, 0.2, 0.2, 0, 0.72, 0, FUR);                           // head
  b.ball(0.026, 0.018, 0.015, 0, 0.68, -0.215, PINK);                  // nose
  b.cap(0.012, 0.03, -0.012, 0.62, -0.19, W, 0, 0, 0.2);               // two front teeth
  b.cap(0.012, 0.03, 0.012, 0.62, -0.19, W, 0, 0, -0.2);
  b.torus(0.055, 0.02, Math.PI * 1.25, 0.15, 0.86, -0.1, MOON, 0, 0, -0.5);   // crescent-moon hair clip
  b.ball(0.05, 0.04, 0.05, 0, 0.92, 0.0, FUR_D);                       // a little tuft
  inner.add(b.mesh());
  const t = new VB();                                                 // cotton tail
  t.ball(0.075, 0.075, 0.075, 0, 0, 0.06, W);
  wob.push(wobble(inner, t, 0, 0.26, 0.12, 1));
  return finishHero(group, inner, wob);
}

// ---------- Hop Supporters ----------
// $5 on Ko-fi (see support/): supporters get DJ Ribbit and Moonbun, a badge, and the
// drum and bass version of the farm tune, which their guests hear too. bl-supporter
// holds their code once it's paid; bl-sup-pending the one they're paying with.
const SUPPORT_URL = (new URLSearchParams(location.search).get('support') || window.FARMHOP_SUPPORT_URL || '').replace(/\/$/, '');
const KOFI_URL = 'https://ko-fi.com/funbytuko';
const STRIPE_LINK = new URLSearchParams(location.search).get('stripe') || window.FARMHOP_STRIPE_LINK || '';   // a Stripe Payment Link: the code rides along as client_reference_id
const SUP_CODE = /^HOP-[A-HJKMNP-Z2-9]{6}$/;
const supCode = () => { const v = store.get('bl-supporter', null); return SUP_CODE.test(v) ? v : null; };
let supporter = !!supCode();

const HEROES = [
  { id: 'betty', name: 'Betty Lou', build: () => buildGirl(), bg: '#ffd6ec', pad: '#ff7fb8' },
  { id: 'axolotl', name: 'Axolotl Princess', build: buildAxolotl, bg: '#d9f2ff', price: 20, pad: '#7fd0ff' },
  { id: 'catstar', name: 'Catstar', build: buildCatstar, bg: '#fff1b8', price: 20, pad: '#ffd24a' },
  { id: 'leafwish', name: 'LeafWish', build: buildLeafWish, bg: '#e6dcff', price: 20, pad: '#7ad653' },
  { id: 'tuko', name: 'Tuko', build: buildTuko, bg: '#ffe1c4', price: 20, pad: '#ff9a3c' },
  { id: 'spider', name: 'Spicy Spider', build: buildSpicySpider, bg: '#e2e8ff', price: 20, pad: '#4f8fe6' },
  { id: 'lyla', name: 'Lyla', build: buildLyla, bg: '#e2f5dc', price: 20, pad: '#5fbf5a' },
  { id: 'carla', name: 'Carla', build: buildCarla, bg: '#fff3c4', price: 20, pad: '#ffb84a' },
  { id: 'siracha', name: 'Sir Racha', build: buildSiracha, bg: '#ffe4e0', price: 20, pad: '#ff5a4a' },
  { id: 'ribbit', name: 'DJ Ribbit', build: buildRibbit, bg: '#dcf7c8', pad: '#6fd24a', supporter: true },
  { id: 'moonbun', name: 'Moonbun', build: buildMoonbun, bg: '#efe6ff', pad: '#cdb8ff', supporter: true },
  { id: 'captain', name: 'Captain Awesome', build: buildCaptain, bg: '#ffe0d6', price: 20, pad: '#d8473a' },
];
const SUP_HEROES = HEROES.filter(h => h.supporter).map(h => h.id);   // live on every supporter's farm
const STARTERS = ['betty'];   // owned from the start; everyone else is invited from the Bunkhouse
// Farms from before only Betty Lou came free keep the three friends they started with.
if (!store.get('bl-owned-v2', false)) {
  const played = ['bl-top', 'bl-coins', 'bl-hero', 'bl-pond'].some(k => store.get(k, null) !== null);
  if (played) store.set('bl-owned', [...new Set([...store.get('bl-owned', []), 'axolotl', 'catstar', 'leafwish'])]);
  store.set('bl-owned-v2', true);
}
const owned = new Set([...STARTERS, ...store.get('bl-owned', []), ...(supporter ? SUP_HEROES : [])].filter(id => HEROES.some(h => h.id === id)));
const ownedHeroes = () => HEROES.filter(h => owned.has(h.id));
let heroId = store.get('bl-hero', 'betty');
if (!owned.has(heroId) && !GUEST) heroId = 'betty';   // a guest may bring a hopper from their own farm
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
  const was = rnd;
  rnd = Math.random;
  try { return (MODELS[kind] = buildModel(kind)); } finally { rnd = was; }
}
function buildModel(kind) {
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
  return m;
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
// The song's key and scale, bought in the shop's Music tab: semitones from D (the tune's
// own key), kept within -6..5 so nothing goes too low or shrill, and a scale from SCALES
// (music.js). Farm settings: guests hear the host's key. Every hopper sound follows
// keyNow(), the key the tune is playing right now, so hops, pads and fishing notes
// never clash with the music while it changes over.
const SONG_KEYS = [['C', -2], ['Db', -1], ['D', 0], ['Eb', 1], ['E', 2], ['F', 3], ['Fs', 4], ['G', 5], ['Ab', -6], ['A', -5], ['Bb', -4], ['B', -3]];
const KEY_PRICE = 50;
const songKey = () => { const n = store.get('bl-key', 0); return SONG_KEYS.some(k => k[1] === n) ? n : 0; };
const songScale = () => { const sc = store.get('bl-scale', 'major'); return SCALES[sc] ? sc : 'major'; };
const keyNow = () => (music ? [music.key, music.scale] : [songKey(), songScale()]);
// Step i of the key's pentatonic (0 = the key note near D4, 5 = an octave up, ...), in Hz.
function pentHz(i, [k, sc] = keyNow()) {
  const p = SCALES[sc].pent, o = Math.floor(i / p.length);
  return 293.66 * 2 ** ((k + p[i - o * p.length] + 12 * o) / 12);
}
// A sound effect's little tune, written in D major, in the song's key and scale.
function inKey(f) {
  const [k, sc] = keyNow(), m = Math.round(69 + 12 * Math.log2(f / 440));
  return f * 2 ** ((inScale(m, sc, k) - m) / 12);
}
const sfx = (() => {
  // Signal flow: effects -> master (effects volume) -> out (mute); music -> musicBus (music volume) -> out.
  let ctx = null, master = null, out = null, musicBus = null, noiseBuf = null;
  let muted = store.get('bl-mute', false);
  const vol = { music: store.get('bl-vol-music', 0.8), fx: store.get('bl-vol-fx', 0.9) };
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = muted ? 0 : 0.55;
      const limit = ctx.createDynamicsCompressor();   // a safety limiter: loud moments never clip in headphones
      limit.threshold.value = -3;
      limit.knee.value = 0;
      limit.ratio.value = 20;
      limit.attack.value = 0.002;
      limit.release.value = 0.12;
      out.connect(limit).connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = vol.fx;
      master.connect(out);
      musicBus = ctx.createGain();
      musicBus.gain.value = vol.music;
      musicBus.connect(out);
      music = createMusic(ctx, musicBus);   // the sound button mutes both
      music.setStyle(songStyle());
      music.setKey(songKey(), songScale());
      music.start();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume();   // 'suspended', or iOS's 'interrupted' after a call or the app going to the background
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
  // ---- hop voices ----
  // Two octaves of the key's pentatonic (D major's: D E F# A B): climbs from the key note
  // up to the top, then walks back down.
  const TAP_LEN = 0.12;   // how long a quick tap on a Jam Stage pad is held
  const HOP_TUNE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1];   // steps for pentHz()
  let hopStep = 0, pulse = null;
  function env(g, t, vol, dur, attack = 0.004) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function sweep(type, f0, f1, t, dur, vol) {                  // a quick pitch glide
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    env(g, t, vol, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function pulseWave() {                                       // a thin pulse: the banjo-ish colour
    if (!pulse) {
      const k = 32, re = new Float32Array(k), im = new Float32Array(k);
      for (let i = 1; i < k; i++) im[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * 0.2);
      pulse = ctx.createPeriodicWave(re, im);
    }
    return pulse;
  }
  function pluck(f, t, dur, vol) {                             // thin pulse, bright attack that mellows: banjo-ish
    const o = ctx.createOscillator(), f1 = ctx.createBiquadFilter(), g = ctx.createGain();
    o.setPeriodicWave(pulseWave());
    o.frequency.value = f;
    f1.type = 'lowpass';
    f1.frequency.setValueAtTime(5000, t);
    f1.frequency.exponentialRampToValueAtTime(700, t + dur);
    env(g, t, vol, dur, 0.002);
    o.connect(f1).connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function guitar(f, t, dur, vol) {                            // an acoustic string: warm triangle with a little saw, bright at the pick, mellowing
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), mix = ctx.createGain(), f1 = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o2.type = 'sawtooth';
    o.frequency.value = o2.frequency.value = f;
    mix.gain.value = 0.3;
    f1.type = 'lowpass';
    f1.Q.value = 0.7;
    f1.frequency.setValueAtTime(3600, t);
    f1.frequency.exponentialRampToValueAtTime(450, t + dur);
    env(g, t, vol, dur, 0.002);
    o.connect(f1); o2.connect(mix).connect(f1); f1.connect(g).connect(master);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  function boing(f, t, dur, vol, glide = true) {               // up-glide, then a wobble that dies away
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * (glide ? 0.6 : 1.3), t);   // no glide: straight onto the note
    if (glide) o.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.06);
    lfo.frequency.value = 17;
    depth.gain.setValueAtTime(f * 0.25, t + 0.04);
    depth.gain.exponentialRampToValueAtTime(1, t + dur);
    lfo.connect(depth).connect(o.frequency);
    env(g, t, vol, dur);
    o.connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }
  function rustle(t, dur, vol) {                               // noise through a rising band: leaves brushing
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(5200, t + dur);
    env(g, t, vol, dur, 0.02);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  // A duck's quack: a buzzy sawtooth on the note through a nasal "aa" that opens and
  // closes, with a twang on top. The pitch never moves, so it stays in tune.
  function quack(f, t, dur, vol) {
    const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), nose = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.linearRampToValueAtTime(1500, t + dur * 0.3);
    bp.frequency.exponentialRampToValueAtTime(650, t + dur);
    nose.type = 'peaking';
    nose.frequency.value = 2600;
    nose.Q.value = 2;
    nose.gain.value = 9;
    env(g, t, vol, dur, 0.008);
    o.connect(bp).connect(nose).connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // A dog's woof: a low buzzy note through a "wuh" that opens and closes, with a puff
  // of breath. The pitch never moves, so it stays in tune.
  function woof(f, t, dur, vol) {
    const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(950, t + dur * 0.25);
    bp.frequency.exponentialRampToValueAtTime(320, t + dur);
    env(g, t, vol, dur, 0.006);
    o.connect(bp).connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
    const s = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();   // the breath
    s.buffer = noiseBuf;
    nf.type = 'bandpass';
    nf.frequency.value = 900;
    nf.Q.value = 1.2;
    env(ng, t, vol * 0.35, dur * 0.5, 0.004);
    s.connect(nf).connect(ng).connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur);
  }
  // A frog's croak: a low reedy pulse whose loudness rattles on and off at an eighth
  // of the note's own frequency, so the rasp is in tune with it.
  function croak(f, t, dur, vol) {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), am = ctx.createGain(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    o.setPeriodicWave(pulseWave());
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 1.6;
    lfo.type = 'square';
    lfo.frequency.value = f / 8;
    am.gain.value = 0.5;
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(am.gain);
    env(g, t, vol, dur, 0.006);
    o.connect(lp).connect(am).connect(g).connect(master);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }
  // Something a little spooky: two glassy sines a hair apart that shimmer against each
  // other, trembling as they ring.
  function eerie(f, t, dur, vol) {
    for (const cents of [-10, 10]) {
      const o = ctx.createOscillator(), mix = ctx.createGain(), g = ctx.createGain(), trem = ctx.createOscillator(), depth = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = cents;
      trem.frequency.value = 7.5;
      depth.gain.value = 0.45;
      mix.gain.value = 0.55;
      trem.connect(depth).connect(mix.gain);
      env(g, t, vol, dur, 0.012);
      o.connect(mix).connect(g).connect(master);
      o.start(t); trem.start(t); o.stop(t + dur + 0.02); trem.stop(t + dur + 0.02);
    }
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
      if (out) out.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    get volumes() { return { ...vol }; },
    setVolume(which, v) {   // which: 'music' or 'fx', v: 0..1
      vol[which] = v;
      store.set(which === 'music' ? 'bl-vol-music' : 'bl-vol-fx', v);
      const bus = which === 'music' ? musicBus : master;
      if (bus) bus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    },
    // A hop sounds exactly like a quick tap on that hopper's Jam Stage pad: its voice,
    // and the sustain tone at the Jam Stage's sustain setting, let go as a tap would be.
    // The notes walk a major pentatonic line in the soundtrack's key, so a run of hops
    // plays a little tune. delay: seconds from now, for sounds that must land on a beat.
    sustain: store.get('bl-sustain', 0.35),
    hop(id, delay = 0) { this.note(id, pentHz(HOP_TUNE[hopStep++ % HOP_TUNE.length]), delay); },
    note(id, n, delay = 0) {
      this.voice(id, n, false, delay);
      this.hold(id, n, this.sustain, delay, TAP_LEN);
    },
    // One hopper's voice at pitch n: the same sound for a hop on the farm and a pad on
    // the Jam Stage, so each hopper sounds like itself everywhere. Every layer starts
    // right on the note (a little echo of the old hop may follow it), and only
    // octaves and fifths of n are used, so it's always in key and tight on the beat.
    // (tight is still passed by the Jam Stage; the sound is the same either way.)
    voice(id, n, _tight, delay = 0) {
      if (!ctx || muted) return;
      const t = ctx.currentTime + Math.max(0, delay);
      if (id === 'axolotl') {                                   // a watery bloop, and a little bubble after
        sweep('sine', n * 0.94, n * 1.06, t, 0.13, 0.17);
        sweep('triangle', n * 4, n * 4, t, 0.1, 0.02);
        sweep('sine', n * 2, n * 2, t + 0.05, 0.06, 0.05);
      } else if (id === 'catstar') {                            // the spring in her cap, and a star chime
        boing(n / 2 / 1.3, t, 0.3, 0.15, false);
        sweep('triangle', n * 2, n * 2, t, 0.18, 0.035);
      } else if (id === 'leafwish') {                           // a leafy rustle and a wind-chime twinkle
        rustle(t, 0.1, 0.12);
        sweep('triangle', n * 2, n * 2, t, 0.45, 0.05);
        sweep('sine', n * 3, n * 3, t + 0.02, 0.3, 0.015);
      } else if (id === 'tuko') {                               // a woodblock tok, then a quick little fox yip a fifth up
        sweep('sine', n * 2, n * 2, t, 0.06, 0.16);
        sweep('triangle', n * 4, n * 4, t, 0.03, 0.04);
        sweep('triangle', n * 3, n * 3, t + 0.05, 0.05, 0.04);
      } else if (id === 'spider') {                             // a little creepy: a shimmering, trembling glass note, and legs skittering
        eerie(n * 2, t, 0.42, 0.11);
        sweep('sine', n * 3, n * 3, t, 0.3, 0.02);
        for (const dt of [0, 0.035, 0.07]) sweep('square', n * 4, n * 4, t + dt, 0.012, 0.008);
      } else if (id === 'lyla') {                               // a bulldog's "woof!" on the note, with a soft chest thump
        woof(n / 2, t, 0.17, 0.22);
        sweep('sine', n / 2, n / 2, t, 0.09, 0.1);
      } else if (id === 'carla') {                              // a gentle capybara whistle, "kwee-kwee"
        sweep('sine', n * 2, n * 2, t, 0.12, 0.12);
        sweep('triangle', n, n, t, 0.12, 0.05);
        sweep('sine', n * 2, n * 2, t + 0.11, 0.09, 0.06);
      } else if (id === 'siracha') {                            // a proper duck's quack, on the note
        quack(n, t, 0.17, 0.34);
        sweep('sine', n / 2, n / 2, t, 0.1, 0.05);
      } else if (id === 'ribbit') {                             // "rib-bit": a froggy croak an octave down, then a shorter one a fifth up
        croak(n / 2, t, 0.13, 0.15);
        croak(n * 0.75, t + 0.12, 0.08, 0.11);
      } else if (id === 'moonbun') {                            // a soft thump and a little moon bell
        sweep('sine', n / 2, n / 2, t, 0.07, 0.09);
        sweep('sine', n * 2, n * 2, t, 0.5, 0.1);
        sweep('sine', n * 3, n * 3, t, 0.35, 0.03);
      } else if (id === 'captain') {                            // Captain Awesome: a strum down his acoustic, root, fifth, octave, fifth
        [[n / 2, 0.09], [n * 0.75, 0.07], [n, 0.08], [n * 1.5, 0.05]].forEach(([f, v], i) => guitar(f, t + i * 0.013, 0.6, v));
      } else {                                                  // Betty Lou: a banjo pluck
        pluck(n, t, 0.28, 0.11);
        pluck(n / 2, t, 0.2, 0.05);
      }
    },
    // A soft tone in the hopper's own colour that rings under the hop sound while a
    // Jam Stage pad is held, then fades out once it's let go. amt (0..1) is the
    // sustain slider: louder and a longer fade the higher it is. Returns release().
    // With len, it's a tap of known length (a hop): let go on the audio clock, no release().
    hold(id, n, amt, delay = 0, len = 0) {
      if (!ctx || muted || amt <= 0) return null;
      const t = ctx.currentTime + Math.max(0, delay), o = ctx.createOscillator(), f1 = ctx.createBiquadFilter(), g = ctx.createGain();
      const V = { captain: ['triangle', 1, 0], betty: ['pulse', 1, 0], axolotl: ['sine', 1, 5], catstar: ['triangle', 1, 6.5], leafwish: ['triangle', 2, 0], tuko: ['sawtooth', 2, 0], siracha: ['sawtooth', 1, 0], ribbit: ['triangle', 0.5, 14], moonbun: ['sine', 2, 4], spider: ['sine', 2, 9], lyla: ['triangle', 0.5, 0], carla: ['sine', 2, 3] }[id] || ['triangle', 1, 0];
      const [wave, oct, wob] = V;
      if (wave === 'pulse') o.setPeriodicWave(pulseWave()); else o.type = wave;
      o.frequency.value = n * oct;   // octaves of the pad's note, so it stays in key
      let lfo = null;
      if (wob) {                      // a little vibrato for the bubbly and springy voices
        lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = wob;
        depth.gain.value = n * oct * 0.012;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t);
      }
      f1.type = 'lowpass';
      f1.frequency.value = Math.min(9000, n * oct * 3.5);
      const lvl = 0.02 + 0.06 * amt;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.012);
      g.gain.setTargetAtTime(lvl * 0.7, t + 0.012, 0.4);   // settles a touch below the attack
      o.connect(f1).connect(g).connect(master);
      o.start(t);
      if (len > 0) {
        const r = t + len, rel = 0.08 + amt * 1.2;
        g.gain.setValueAtTime(lvl * 0.9, r);   // about where it has settled by then
        g.gain.exponentialRampToValueAtTime(0.0001, r + rel);
        o.stop(r + rel + 0.05);
        lfo?.stop(r + rel + 0.05);
        return null;
      }
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        clearTimeout(cap);
        const r = ctx.currentTime, rel = 0.08 + amt * 1.2;
        g.gain.cancelScheduledValues(r);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), r);
        g.gain.exponentialRampToValueAtTime(0.0001, r + rel);
        o.stop(r + rel + 0.05);
        lfo?.stop(r + rel + 0.05);
      };
      const cap = setTimeout(release, 12000);   // never ring forever if a release is missed
      return release;
    },
    // The Jam Stage drum kit, all synthesised: 0 kick, 1 snare, 2 closed hi-hat,
    // 3 open hi-hat, 4 clap, 5 low tom, 6 high tom, 7 cowbell.
    drum(i) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const hit = (type, f0, f1, drop, dur, vol) => {   // a pitched thump that drops
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + drop);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + dur + 0.02);
      };
      const hiss = (type, freq, q, dur, vol, at = 0) => {   // filtered noise: hats, snare wires, claps
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf;
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.setValueAtTime(vol, t + at);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        s.connect(f).connect(g).connect(master);
        s.start(t, Math.random() * 0.5); s.stop(t + at + dur + 0.02);
      };
      if (i === 0) { hit('sine', 165, 42, 0.11, 0.4, 0.95); hiss('lowpass', 3000, 0.7, 0.012, 0.3); }
      else if (i === 1) { hit('triangle', 210, 165, 0.05, 0.13, 0.35); hiss('bandpass', 2300, 0.8, 0.19, 0.5); }
      else if (i === 2) hiss('highpass', 7500, 0.7, 0.05, 0.32);
      else if (i === 3) hiss('highpass', 7000, 0.7, 0.4, 0.26);
      else if (i === 4) { for (const at of [0, 0.011, 0.022]) hiss('bandpass', 1300, 1.2, 0.03, 0.45, at); hiss('bandpass', 1200, 1, 0.16, 0.32, 0.033); }
      else if (i === 5) hit('sine', 150, 92, 0.22, 0.36, 0.65);
      else if (i === 6) hit('sine', 245, 160, 0.17, 0.28, 0.6);
      else {
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'bandpass'; f.frequency.value = 820; f.Q.value = 1.2;
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        f.connect(g).connect(master);
        for (const fr of [545, 815]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 0.34); }
      }
    },
    bump() { tone(220, 150, 0.07, 'square', 0.07); },
    // these little tunes are in D too, so they move with the song's key
    pick() { tone(inKey(587), inKey(880), 0.08, 'triangle', 0.07); },
    place() { tone(inKey(880), null, 0.05, 'triangle', 0.07); tone(inKey(1175), null, 0.12, 'triangle', 0.06, 0.05); },
    coin() { tone(inKey(988), null, 0.08, 'square', 0.07); tone(inKey(1319), null, 0.2, 'square', 0.07, 0.08); },
    squash() { noise(0.3, 0.5, 'lowpass', 700); tone(180, 60, 0.3, 'sawtooth', 0.12); },
    splash() { noise(0.55, 0.45, 'bandpass', 1400); tone(600, 180, 0.25, 'sine', 0.1); },
    moo() { tone(150, 105, 0.7, 'sawtooth', 0.07); tone(152, 108, 0.7, 'triangle', 0.12); },
    rumble(k = 1) { noise(0.55, 0.55 * k, 'lowpass', 140); tone(58, 44, 0.5, 'sine', 0.18 * k); },
    creak() { tone(320, 170, 0.45, 'sawtooth', 0.035); tone(260, 210, 0.3, 'square', 0.02, 0.15); },
    snort() { noise(0.35, 0.35, 'bandpass', 500); tone(90, 60, 0.3, 'sawtooth', 0.1); },
    rooster() { tone(700, 900, 0.12, 'sawtooth', 0.045); tone(900, 760, 0.12, 'sawtooth', 0.045, 0.13); tone(760, 1020, 0.14, 'sawtooth', 0.045, 0.27); tone(1020, 640, 0.55, 'sawtooth', 0.045, 0.43); },
    upgrade() { tone(inKey(784), null, 0.1, 'square', 0.06); tone(inKey(988), null, 0.1, 'square', 0.06, 0.1); tone(inKey(1319), null, 0.32, 'square', 0.06, 0.2); noise(0.4, 0.25, 'bandpass', 1400, 0.05); },
    lullaby() { tone(784, null, 0.4, 'triangle', 0.08); tone(659, null, 0.4, 'triangle', 0.08, 0.35); tone(523, null, 0.9, 'triangle', 0.08, 0.7); },
    launch() { tone(300, 1200, 0.4, 'square', 0.07); },
    cast() { tone(900, 380, 0.2, 'sine', 0.06); noise(0.18, 0.12, 'highpass', 2500); },
    plop() { noise(0.12, 0.25, 'bandpass', 900); tone(520, 260, 0.12, 'sine', 0.08); },
    bite() { tone(1046, null, 0.06, 'square', 0.06); tone(1319, null, 0.08, 'square', 0.06, 0.09); noise(0.2, 0.3, 'bandpass', 1500); },
    lost() { tone(440, 220, 0.35, 'triangle', 0.07); },
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
  const k = rnd();
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
function wrap(m) {   // round to the other side, well off screen
  const lo = -SPAN / 2 - m.len / 2;
  m.x = lo + (((m.x - lo) % SPAN) + SPAN) % SPAN;
}

function nextType(r, prev) {
  if (!queue.length) {
    const d = diff(r), last = prev.type, early = r < STRAIGHT, on = k => r >= UNLOCK[k];
    let t;
    // a grass break after every hazard until STRAIGHT, tapering to 45% of the time by row 60
    if (last !== 'grass' && rnd() < lerp(1, 0.45, clamp((r - STRAIGHT) / (35 * PACE), 0, 1))) t = 'grass';
    else {
      const w = [['grass', 0.2], ['road', 0.24 + 0.05 * d], ['pasture', on('pasture') ? 0.16 : 0], ['water', on('water') ? 0.2 : 0],
        ['bull', on('bull') ? 0.08 + 0.05 * d : 0], ['wheat', on('wheat') ? 0.1 : 0], ['crops', on('crops') ? 0.07 + 0.05 * d : 0]];
      let k = rnd() * w.reduce((s, x) => s + x[1], 0);
      t = w.find(x => (k -= x[1]) < 0)[0];
      if (t === last && t !== 'grass') t = 'grass';
    }
    if (t === 'grass') queue = Array(early ? ri(2, 3) : ri(1, 3)).fill('grass');
    else if (t === 'road') queue = Array(on('multiRoad') ? ri(1, 2 + Math.round(2 * d)) : 1).fill('road');
    else if (t === 'pasture') queue = Array(early ? 1 : ri(1, 2)).fill('pasture');
    else if (t === 'bull') queue = Array(ri(1, d > 0.4 ? 2 : 1)).fill('bull');
    else if (t === 'wheat') queue = Array(r < 40 * PACE ? 1 : ri(1, 2)).fill('wheat');
    else if (t === 'crops') queue = ['crops'];
    else if (on('pads') && last === 'grass' && rnd() < 0.3) queue = ['pads', 'grass'];
    else queue = Array(r < 30 * PACE ? 1 : ri(1, 2 + Math.round(d))).fill('water');
  }
  return queue.shift();
}

// Each row is built from its own seeded generator, and its traffic is moved on to
// where it is at this moment of the round (game.roadT), so a lane comes out the
// same on every screen whenever that screen gets round to building it.
function addLane(r) {
  const was = rnd;
  rnd = seeded(rowSeed(r));
  try { buildLane(r); } finally { rnd = was; }
  catchUp(lanes.get(r), game.roadT);
}
function catchUp(lane, T) {
  if (!(T > 0)) return;
  if (lane.type === 'bull') { for (let t = 0; t < T; t += 0.05) updateStampede(lane, Math.min(0.05, T - t), true); return; }
  for (const m of lane.movers) { m.x += lane.dir * lane.speed * T; wrap(m); m.mesh.position.x = m.x; }
}
function buildLane(r) {
  const prev = lanes.get(r - 1) || null;
  const type = r < 0 ? 'forest' : r < OPEN ? 'grass' : nextType(r, prev);
  const lane = {
    r, type, movers: [], blocked: new Set(), reach: new Set(), coins: [],
    dir: rnd() < 0.5 ? 1 : -1, speed: 0, group: new THREE.Group(),
  };
  lane.group.position.z = -r;
  const vb = new VB(0.4);   // scenery: low detail, it's everywhere
  const d = diff(r);

  if (type === 'forest' || type === 'grass') {
    const c = Math.abs(r) % 2 === 0 ? 0xaee667 : 0xa2dc5c;
    strip(vb, 0, c, shade(c, 0.74));
    for (let x = -VIS; x <= VIS; x++) {
      if (Math.abs(x) <= COLS || Math.abs(x) > 11) continue;   // nothing past what the widest screen shows
      if (type === 'forest' || rnd() < 0.7) blocker(vb, x, true);
      else if (rnd() < 0.4) flowers(vb, x);
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
        else if (rnd() < 0.18) flowers(vb, x);
      }
      if (r > 3 && rnd() < 0.16 && reach.size) addSunflower(lane, pick([...reach]));
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
    addMovers(lane, () => (r >= UNLOCK.wagon && rnd() < 0.25 ? 'wagon' : 'tractor') + (rnd() < 0.5 ? color : ri(0, TRACTORS.length - 1)), 3, 7.5 - 2 * d);
    if (rnd() < 0.1) addSunflower(lane, ri(-COLS, COLS));
  } else if (type === 'pasture') {
    strip(vb, 0, 0xcfa66b, shade(0xcfa66b, 0.72));
    for (let i = 0; i < 14; i++) {
      const x = rand(-VIS, VIS);
      vb.box(0.14, 0.01, 0.1, x, 0.005, rand(-0.35, 0.35), Math.abs(x) <= COLS + 0.5 ? 0xb58e58 : 0x8a6c43);
    }
    const k = rnd();
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
    lane.rng = seeded(rowSeed(r, 7));   // when the bulls come, and how many: the same on every screen
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
    if (rnd() < 0.12) addSunflower(lane, ri(-COLS, COLS));
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
      if (r >= UNLOCK.kayak && rnd() < 0.35) {
        // a flotilla of kayaks: quicker than logs, and shorter
        lane.speed = rand(1.4, 2.3) * (1 + 0.4 * d);
        const col = ri(0, KAYAKS.length - 1);
        addMovers(lane, () => 'kayak' + (rnd() < 0.6 ? 2 : 3) + '_' + (rnd() < 0.5 ? col : ri(0, KAYAKS.length - 1)), 1.3, 2.4 + d, -0.1);
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
        if (rnd() < 0.5) {   // a water lily
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
      if (m.buzz <= 0 && game.state === 'play' && crewNear(lane.r, m.x, 4, 9)) {
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
function updateStampede(lane, dt, quiet = false) {
  const s = lane.stamp, playing = game.state === 'play' && !quiet;
  const near = Math.min(99, ...game.crew.filter(h => h.alive && !h.parked).map(h => Math.abs(lane.r - h.r)));
  const gx = -lane.dir * (COLS + 0.6);                    // the gate the bulls come through
  s.t -= dt;
  let open = s.state === 'charge', rattle = 0;
  if (s.state === 'wait') {
    if (s.t <= 0) { s.state = 'warn'; s.t += WARN_T; s.cue = 0; }
  } else if (s.state === 'warn') {
    const k = 1 - s.t / WARN_T;                            // 0 -> 1 through the warning
    open = k > 0.45;
    rattle = open ? 0 : 0.07;
    if (near < 7 && playing) game.shake = Math.max(game.shake, 0.7 * (0.3 + 0.7 * k) * (1 - near / 7));
    if (!quiet && Math.random() < dt * (30 + 90 * k)) {   // dust lifting off the lane, thickest by the gate
      const x = lerp(gx, -gx, Math.random() ** 1.5);
      burst(x, 0.05, -lane.r + rand(-0.4, 0.4), [0xe8d2b0, 0xdcc09a, 0xf2e2c8], 1, 0.3, 2.6, 0.24 + 0.12 * k, 0.9, true);
    }
    if (!quiet && Math.random() < dt * 25 * k) {          // pebbles jumping on the shaking ground
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
      const n = 1 + Math.floor(lane.rng() * (diff(lane.r) > 0.3 ? 3 : 2)), late = -s.t;
      lane.movers.forEach((m, i) => {
        m.active = i < n;
        m.mesh.visible = m.active;
        m.x = -lane.dir * (VIS + 2 + i * 1.9) + lane.dir * lane.speed * late;
        m.mesh.position.x = m.x;
      });
      s.t = (2 * VIS + 5 + (n - 1) * 1.9) / lane.speed - late;   // until the last one is through
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
        if (near < 7 && playing && crewNear(lane.r, m.x, 7, 6)) game.shake = Math.max(game.shake, 0.5 * (1 - near / 7));
        if (!quiet && Math.random() < dt * 30 && Math.abs(m.x) < VIS) {
          burst(m.x - lane.dir * 0.7, 0.1, -lane.r + rand(-0.3, 0.3), [0xe8d2b0, 0xdcc09a], 1, 0.6, 2.5, 0.2, 0.6, true);
        }
      }
    }
    if (s.t <= 0) {
      for (const m of lane.movers) { m.active = false; m.mesh.visible = false; }
      s.state = 'wait';
      s.t += 2.5 + lane.rng() * 3.5;
    }
  }
  // Swing the gate: snaps open fast, drifts shut slowly once the bulls are through.
  if (quiet) return;
  s.ang = lerp(s.ang, open ? 1 : 0, Math.min(1, dt * (open ? 7 : 2.5)));
  for (const g of lane.gates) g.rotation.y = g.userData.open * s.ang + rattle * Math.sin(game.time * 45 + g.position.x);
}

// ---------- the hoppers on the road ----------
// P is the hopper played on this screen (touch, keys or a controller). In Co-Op Hop,
// friends on phones (joined through the QR code, see "jam with phones") each bring
// their own hopper: everyone shares the road, the daylight, the sunflowers and the
// score. A knocked-out hopper drops back in beside the team a few seconds later;
// the round ends when everyone is down at once, or when the sun sets.
// Every function here takes the hopper it acts on (default P), so playing alone is
// exactly the one-hopper game it always was.
const P = { slot: 0 };
const game = { state: 'farm', where: 'farm', light: 1, dawn: 1, today: 0, day: 1, shake: 0, score: 0, top: store.get('bl-top', 0), coins: store.get('bl-coins', 0), camX: 0, camZ: 0, time: 0, crew: [P] };
const coop = () => game.crew.length > 1;
// In Co-Op Hop with friends on their own devices, each device moves its own
// hopper ("local") and shows the others as they report their hops ("remote").
// The host's screen also moves the hoppers of phones used as controllers.
function localCrew() { return game.crew.filter(h => !h.remote); }
const RESPAWN_T = 4;                                              // seconds before a knocked-out hopper drops back in
// Each player's colour, by slot: the host (player 1) red, then blue, yellow, green,
// and purple for a fifth. The farm's sunflowers, the road's markers and the phones' dots use it.
const MARK_COLORS = [0xff4b4b, 0x46a6ff, 0xffd23f, 0x5fd35f, 0xb48cff];
const MARK_CSS = ['#ff4b4b', '#46a6ff', '#ffd23f', '#5fd35f', '#b48cff'];
const MARK_GEO = new THREE.ConeGeometry(0.11, 0.22, 4).rotateX(Math.PI);   // a little diamond pointing down

// (Re)build hopper h as hero `id`, standing on row r, column x.
function freshHopper(h, id, x = 0, r = 0) {
  // Classic and Low start turned toward the camera; Behind starts facing down the road, back to the camera.
  const startFace = roadView().ortho ? Math.PI + 0.36 : 0;
  if (h.model) { scene.remove(h.model.group); disposeHero(h.model); }
  const lane = laneAt(r);
  Object.assign(h, {
    hero: id, x, z: -r, y: lane ? LANE_Y[lane.type] : 0, r, hop: null, queue: null, log: null, alive: true, parked: false, back: 0,
    face: startFace, faceTarget: startFace, held: false, sy: 1, jelly: 9,
    tailAng: 0, tailVel: 0, death: null, deathT: 0, vx: 0, vy: 0, vz: 0,
    model: addXray(HEROES.find(o => o.id === id).build()),
  });
  if (h.slot || (h.remote && h.key === 'h')) {   // friends' hoppers (and the host's, on a guest's screen) wear their player's colour
    const mark = new THREE.Mesh(MARK_GEO, toon({ color: MARK_COLORS[h.col ?? h.slot] }));
    mark.position.y = 1.62;   // above even Catstar's spring
    h.model.group.add(mark);
    h.mark = mark;
  }
  scene.add(h.model.group);
}
function resetPlayer() {
  P.active = false;
  freshHopper(P, heroId);
}

function laneAt(r) { return lanes.get(r); }
// Co-Op Hop keeps the team together: nobody gets more than LEASH rows ahead of the
// hindmost teammate still hopping (the camera follows that one).
const LEASH = 7;
const tooFarAhead = (h, r) => coop() && game.crew.some(o => o !== h && o.alive && !o.parked && o.active && r - o.r > (splitActive() || o.remote ? 30 : LEASH));
const camOf = h => (splitActive() && h.cam?.c) || camera;   // in split screen each hopper has its own

function move(dx, dr, h = P) {
  if (game.state === 'title') startGame();
  if (game.state !== 'play') return;
  if (h.parked) { h.active = true; respawn(h); return; }   // sat out so far: hop in beside the team
  if (!h.alive) return;
  h.active = true;
  if (h.hop) { h.queue = [dx, dr]; return; }
  h.faceTarget = dr > 0 ? 0 : dr < 0 ? Math.PI : dx < 0 ? Math.PI / 2 : -Math.PI / 2;
  const tr = h.r + dr;
  const lane = laneAt(tr);
  if (!lane) return;
  const land = lane.type !== 'water';
  let tx = h.x + dx;
  if (land) tx = Math.round(tx);
  const blocked = Math.abs(tx) > COLS + (land ? 0 : 0.49) || ((lane.type === 'grass' || lane.type === 'forest') && lane.blocked.has(tx))
    || (dr < 0 && belowScreen(tx, -tr, camOf(h)))     // can't back off the bottom of the screen
    || (dr > 0 && tooFarAhead(h, tr));                // ...or, with friends, run too far ahead
  if (blocked) {
    h.hop = { fx: h.x, fz: h.z, fy: h.y, tx: h.x, tz: h.z, ty: h.y, t: 0, fromR: h.r, toR: h.r, h: 0.15, bump: true };
    sfx.bump();
    roadSend({ t: 'rh', k: h.key, fx: h.x, fr: h.r, tx: h.x, tr: h.r, face: h.faceTarget, bump: true });
    return;
  }
  roadSend({ t: 'rh', k: h.key, fx: h.x, fr: h.r, tx, tr, face: h.faceTarget });
  h.hop = { fx: h.x, fz: h.z, fy: h.y, tx, tz: -tr, ty: LANE_Y[lane.type], t: 0, fromR: h.r, toR: tr, h: 0.5 };
  h.log = null;
  h.tailVel += 9;
  sfx.hop(h.hero);
}

// Each hopper kicks up their own little puff on landing.
const PUFFS = {
  betty: [RAINBOW, false],                                  // rainbow sparkles
  axolotl: [[0xbfe9ff, 0xffffff, 0xff8fc8], true],          // bubbles
  catstar: [[0xffd23f, 0xfff3a0, 0xffffff], false],         // little stars
  leafwish: [[0x6cc94a, 0x8fe070, 0x4fa83a], false],        // leaves
  tuko: [[0xff8a2a, 0xffb24a, 0xd2541a], false],            // autumn leaves
  spider: [[0x3f7fe0, 0xffffff, 0x9fc4ff], false],          // blue-heart confetti
  lyla: [[0x5fbf5a, 0xc9c9d2, 0xffffff], true],             // a puff of dust
  carla: [[0xffd84a, 0xfff4b0, 0xff7fb8], false],           // princess sparkles
  siracha: [[0xffffff, 0xe53935, 0xffc21a], true],          // a flurry of feathers
  ribbit: [[0x8a5cff, 0xff7fb8, 0x6fd24a], false],          // disco confetti
  moonbun: [[0xffd23f, 0xfff4b0, 0xcdb8ff], false],         // moon dust
};
function hopPuff(h = P) {
  const [cols, soft] = PUFFS[h.hero] || PUFFS.betty;
  burst(h.x, h.y + 0.05, h.z, cols, 6, 1, 2, soft ? 0.13 : 0.08, 0.45, soft);
}

function land(h = P) {
  const hp = h.hop;
  h.hop = null;
  h.x = hp.tx; h.z = hp.tz; h.y = hp.ty; h.r = hp.toR;
  if (hp.bump) { h.jelly = 0.12; if (h.queue) { const q = h.queue; h.queue = null; move(...q, h); } return; }
  const lane = laneAt(h.r);
  if (!lane) return;   // a friend's hopper out beyond the rows this screen keeps
  if (lane.type === 'water') {
    const m = lane.movers.find(m => Math.abs(m.x - h.x) < m.len / 2 + 0.12);
    if (!m) { if (h.remote) return; return die('splash', null, lane, h); }
    const left = m.x - m.len / 2;
    const off = clamp(Math.floor(h.x - left) + 0.5, 0.5, m.len - 0.5);
    h.x = left + off;
    h.log = m;
    m.bob = 0.12;
  } else if (lane.type === 'pads' && !lane.padCols.has(h.x) && !h.remote) {
    return die('splash', null, lane, h);
  }
  h.jelly = 0;   // start the landing wobble
  hopPuff(h);
  const coin = !h.remote && lane.coins.find(c => c.c === h.x);   // a friend's device reports their own sunflowers
  if (coin) {
    roadSend({ t: 'rc', r: h.r, c: coin.c });
    lane.group.remove(coin.m);
    lane.coins.splice(lane.coins.indexOf(coin), 1);
    game.coins++;
    game.today++;
    store.set('bl-coins', game.coins);
    sfx.coin();
    burst(h.x, 0.6, h.z, [0xffd23f, 0xffe680, 0xffffff], 10, 1.5, 4, 0.08, 0.5);
    hud();
  }
  if (h.r > game.score) {   // new ground: the sun climbs back up a little
    game.day = Math.min(1, game.day + DAY_GAIN * (h.r - game.score));
    game.score = h.r;
    hud();
  }
  if (h.queue) { const q = h.queue; h.queue = null; move(...q, h); }
}

// Which death each moving thing causes, and which animation each death uses.
const HIT_BY = { bull: 'launch', cow: 'bonk', geese: 'goose', combine: 'harvest', plane: 'dusted' };
const FLAT = new Set(['squash', 'harvest']), KNOCK = new Set(['bonk', 'goose']), FLY = new Set(['launch', 'dusted']);

function die(kind, mover, lane, h = P) {
  if (!h.alive) return;
  if (!h.remote) roadSend({ t: 'rd', k: h.key, kind, x: h.x, r: h.r, dir: lane?.dir || 1, type: lane?.type || 'grass' });
  h.alive = false;
  h.death = kind;
  h.deathT = 0;
  h.hop = null;
  h.queue = null;
  h.log = null;
  const { inner } = h.model;
  if (FLAT.has(kind)) {
    h.y = LANE_Y[lane.type];
    inner.scale.set(1.35, 0.12, 1.35);
    if (kind === 'harvest') {
      sfx.chomp();
      burst(h.x, 0.3, h.z, [0xe9c46a, 0xf2d37a, 0xc9a23e, ...RAINBOW], 22, 2.5, 5, 0.1, 0.8);
    } else {
      sfx.squash();
      burst(h.x, 0.2, h.z, [0xff8fc8, 0x3e6fd8, ...RAINBOW], 14, 2.5, 3, 0.1, 0.6);
    }
  } else if (KNOCK.has(kind)) {
    h.y = 0;
    h.vx = lane.dir;
    if (kind === 'goose') {
      sfx.honk();
      burst(h.x, 0.6, h.z, [0xffffff, 0xf2f2f2, 0xffe46b], 14, 1.5, 3, 0.09, 1.0);
    } else {
      sfx.moo();
      burst(h.x, 1.1, h.z, [0xffd93b, 0xffffff], 8, 1.2, 3, 0.1, 0.8);
    }
  } else if (FLY.has(kind)) {
    if (kind === 'dusted') {
      h.vx = lane.dir * 5; h.vy = 7; h.vz = rand(-1, 1);
      sfx.launch();
      burst(h.x, 0.7, h.z, [0xf3f0d0, 0xdff5c8, 0xffffff], 18, 2, 2, 0.2, 1.0);
    } else {
      h.vx = lane.dir * 7; h.vy = 11; h.vz = rand(-1.5, 1.5);
      sfx.launch();
      burst(h.x, 0.3, h.z, [0xc89a6a, 0xa87a4a], 12, 2, 3, 0.15, 0.7);
    }
  } else if (kind === 'splash' || kind === 'swept') {
    sfx.splash();
    burst(h.x, 0, h.z, [0xffffff, 0xbfe9ff, 0x56c3ee], 18, 1.8, 5, 0.12, 0.7);
  } else if (kind === 'night') {        // the sun went down: turn round, yawn, lie down for the night
    h.faceTarget = Math.PI + 0.36;
    if (h === game.crew.find(o => o.death === 'night')) sfx.lullaby();
  }
  game.lastDeath = h;
  if (GUEST) { if (!h.remote && kind !== 'night') h.back = RESPAWN_T; return; }   // the host's screen ends the round
  if (coop() && kind !== 'night' && game.crew.some(o => o.alive && !o.parked)) {   // friends still going: back in a moment
    if (h.remote) return;   // their own device drops them back in
    h.back = RESPAWN_T;
    tellHopper(h);
    return;
  }
  if (game.state === 'dead') return;   // the round is already ending
  game.state = 'dead';
  for (const o of game.crew) o.back = 0;
  if (game.score > game.top) { game.top = game.score; store.set('bl-top', game.top); game.record = true; }
  setTimeout(gameOver, kind === 'night' ? 1800 : 1100);
}

// Back onto the road beside the hindmost teammate who's still going: the nearest
// grass row at or behind them that's on screen, in the closest open column.
function respawn(h) {
  const team = game.crew.filter(o => o !== h && o.alive && !o.parked);
  if (!team.length || game.state !== 'play') { h.back = 0.5; return; }
  const anchor = team.reduce((a, b) => (b.r < a.r ? b : a));
  const cols = Array.from({ length: COLS * 2 + 1 }, (_, i) => i - COLS).sort((a, b) => Math.abs(a - anchor.x) - Math.abs(b - anchor.x));
  for (let r = anchor.r; r >= anchor.r - 8; r--) {
    const lane = laneAt(r);
    if (!lane || (!anchor.remote && belowScreen(anchor.x, -r, camOf(anchor)))) break;
    if (lane.type !== 'grass' && lane.type !== 'forest') continue;
    const x = cols.find(c => !lane.blocked.has(c) && !game.crew.some(o => o !== h && o.alive && o.r === r && Math.round(o.x) === c));
    if (x == null) continue;
    freshHopper(h, h.hero, x, r);
    h.active = true;
    h.hop = { fx: x, fz: -r, fy: 2.4, tx: x, tz: -r, ty: LANE_Y[lane.type], t: 0, fromR: r, toR: r, h: 0 };   // drops in from above
    burst(x, 1.2, -r, [0xffd23f, 0xffffff, MARK_COLORS[h.col ?? h.slot] || 0xff8fc8], 14, 1.5, 3, 0.09, 0.7);
    sfx.place();
    tellHopper(h);
    roadSend({ t: 'rb', k: h.key, x, r });
    return;
  }
  h.back = 0.5;   // nowhere safe just now: try again shortly
}

function updatePlayer(dt) {
  for (const h of [...game.crew]) updateHopper(h, dt);
}
function updateHopper(h, dt) {
  if (h.parked) return;
  const { group, inner, tails } = h.model;

  if (h.alive) {
    if (h.hop) {
      const hp = h.hop;
      hp.t += dt / HOP_T;
      const t = Math.min(1, hp.t);
      h.x = lerp(hp.fx, hp.tx, t);
      h.z = lerp(hp.fz, hp.tz, t);
      h.y = lerp(hp.fy, hp.ty, t) + Math.pow(Math.sin(Math.PI * t), 0.6) * hp.h;   // a floaty, flat-topped arc
      if (hp.t >= 1) land(h);
    } else if (h.log) {
      const lane = laneAt(h.r);
      h.x += lane.dir * lane.speed * dt;
      h.y = LANE_Y.water + h.log.mesh.position.y - h.log.y;
      if (Math.abs(h.x) > COLS + 1.1 && !h.remote) die('swept', null, lane, h);
    }
    // In Co-Op Hop a hopper nobody has moved yet sits the round out once the team leaves it behind.
    if (coop() && !h.remote && !h.active && !h.hop && game.state === 'play' && belowScreen(h.x, h.z, camOf(h))) {
      h.parked = true;
      group.visible = false;
      roadSend({ t: 'rp', k: h.key });
      return;
    }
  } else if (!h.remote && h.back > 0 && (h.back -= dt) <= 0) {
    respawn(h);
    if (h.alive) return;
  }

  // collisions with traffic
  if (h.alive && !h.remote && game.state === 'play') {
    const row = h.hop ? (h.hop.t > 0.5 ? h.hop.toR : h.hop.fromR) : h.r;
    const lane = laneAt(row);
    if (lane && (lane.movers.length && lane.type !== 'water')) {
      for (const m of lane.movers) {
        if (!m.active) continue;
        if (Math.abs(m.x - h.x) < m.len / 2 + 0.2) {
          if (h.hop) { h.x = Math.round(h.hop.t > 0.5 ? h.hop.tx : h.hop.fx); h.z = -row; }
          h.r = row;
          die(HIT_BY[m.kind] || 'squash', m, lane, h);
          break;
        }
      }
    }
  }

  // death animations
  if (!h.alive) {
    h.deathT += dt;
    const t = h.deathT;
    if (FLY.has(h.death)) {
      h.vy -= 22 * dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
      inner.rotation.x += 13 * dt;
      inner.rotation.z += 7 * dt;
    } else if (KNOCK.has(h.death)) {
      inner.rotation.z = lerp(inner.rotation.z, -h.vx * Math.PI / 2, Math.min(1, dt * 14));
      if (t < 0.35) h.x += h.vx * 2.5 * dt;
    } else if (h.death === 'splash' || h.death === 'swept') {
      h.y = lerp(h.y, -1.3, Math.min(1, dt * 4));
    } else if (h.death === 'night' && t > 0.5) {
      inner.rotation.x = lerp(inner.rotation.x, 1.35, Math.min(1, dt * 3));   // settles onto her back
    }
    if (h.back > 0 && t > 1.2) group.visible = Math.floor(t * 8) % 2 === 0;   // blinks while waiting to drop back in
  }

  // squash & stretch, facing, pigtail bounce
  // The hop: crouch while held, stretch tall and lean into the hop on take-off,
  // tuck into a squash coming down, then settle with a jelly wobble.
  if (!FLAT.has(h.death)) {
    const flying = h.alive && h.hop && !h.hop.bump, k = flying ? Math.min(1, h.hop.t) : 0;
    if (flying) h.sy = 1 + 0.16 * Math.cos(Math.PI * k);                       // 1.16 at take-off -> 0.84 at touch-down
    else if (h.alive && h.held) h.sy = lerp(h.sy, 0.78, Math.min(1, dt * 25));  // wind-up crouch
    else if (h.alive) { h.jelly += dt; h.sy = 1 - 0.17 * Math.exp(-h.jelly * 7) * Math.cos(h.jelly * 26); }
    else h.sy = lerp(h.sy, 1, Math.min(1, dt * 25));
    inner.scale.set(1 + (1 - h.sy) * 0.55, h.sy, 1 + (1 - h.sy) * 0.55);
    if (h.alive) inner.rotation.x = flying ? -0.34 * Math.sin(Math.PI * k) : lerp(inner.rotation.x, 0, Math.min(1, dt * 14));
  }
  let da = h.faceTarget - h.face;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  h.face += da * Math.min(1, dt * 20);
  h.tailVel += (-70 * h.tailAng - 7 * h.tailVel) * dt;
  h.tailAng += h.tailVel * dt;
  const idle = Math.sin(game.time * 3 + h.slot) * 0.04;
  for (const t of tails) {
    t.rotation[t.userData.axis || 'z'] = t.userData.side * (h.tailAng * 0.12 + idle);
    if (t.userData.boing) t.scale.y = 1 + h.tailAng * 0.3 + idle;   // Catstar's spring
  }
  if (h.mark) { h.mark.position.y = 1.62 + Math.sin(game.time * 4 + h.slot) * 0.05; h.mark.rotation.y += dt * 2; }

  group.position.set(h.x, h.y, h.z);
  group.rotation.y = h.face;
}
// Where the road camera looks: the hopper alone, or in Co-Op Hop the hindmost of
// the team still going (so nobody is left behind), centred on everyone across.
function roadFocus() {
  if (localCrew().length < 2) return P;
  const going = localCrew().filter(h => h.alive && !h.parked);
  const movers = going.filter(h => h.active);
  const set = movers.length ? movers : going;
  if (!set.length) return { x: game.camX, z: game.camZ + roadView().lead, alive: false };
  const hind = set.reduce((a, b) => (b.z > a.z ? b : a));
  return { x: set.reduce((s, h) => s + h.x, 0) / set.length, z: hind.z, alive: true };
}
const crewNear = (r, x, dr, dx) => game.crew.some(h => h.alive && !h.parked && Math.abs(r - h.r) < dr && (x == null || Math.abs(x - h.x) < dx));

// ---------- camera ----------
//   The road:  a perspective camera just behind the hopper, about 20 degrees down,
//              with sky above the fields and distant lanes fading into it.
//   The farm:  orthographic, about 36 degrees down, from behind and to the right.
// lead = how far ahead of the hopper the camera looks; ahead/behind = rows kept loaded.
const ROAD_VIEW = { id: 'behind', ortho: false, off: new THREE.Vector3(0, 3.2, 8.4), lead: 5, ahead: 32, behind: 16, shadow: 26, lookY: 0.3 };
const FARM_VIEW = { id: 'classic', ortho: true, off: CAM_OFF, lead: 4, ahead: AHEAD, behind: BEHIND, shadow: 24 };
const roadView = () => ROAD_VIEW;
const activeView = () => game.where === 'road' ? roadView() : FARM_VIEW;
const fog = new THREE.Fog(0xa8dcff, 22, 40);
const skyCol = new THREE.Color(0xa8dcff);
function useCamera(c) {
  if (camera === c) return;
  camera = c;
  const persp = !!c.isPerspectiveCamera, u = postMat.uniforms;
  u.persp.value = persp ? 1 : 0;
  u.cnear.value = c.near;
  u.cfar.value = c.far;
  u.depthRange.value = c.far - c.near;
  scene.fog = persp ? fog : null;
  scene.background = persp ? skyCol : GROUND_BG;
}
function orthoHalf(a) {   // how much of the world an orthographic view of aspect a shows
  let halfW, halfH;
  if (a < 1) { halfW = 4.3; halfH = halfW / a; }
  else { halfH = 6.2; halfW = Math.min(halfH * a, 11); halfH = halfW / a; }
  return [halfW, halfH];
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  resizeCel();
  const [halfW, halfH] = orthoHalf(a);
  Object.assign(orthoCam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  orthoCam.updateProjectionMatrix();
  perspCam.aspect = a;
  perspCam.fov = a < 1 ? 78 : 52;   // tall phone screens need a wider lens to see the lanes ahead
  perspCam.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const _t = new THREE.Vector3(), _look = new THREE.Vector3(), _off = new THREE.Vector3();
// ---------- split screen (Co-Op Hop, two players) ----------
// Settings > Co-Op screen > Split gives two players a half each (side by side on a
// wide screen, one above the other on a tall one), each camera following its own
// hopper. With three or more, or if one hopper sits the round out, the team shares one view.
let splitPref = store.get('bl-split', true);   // two players on one screen: each their own half, unless Settings says Shared
const splitActive = () => splitPref && game.where === 'road' && localCrew().length === 2 && localCrew().every(h => !h.parked && h.model);
const _sz = new THREE.Vector2();
function splitRects() {   // drawing-buffer pixels: the first hopper (the TV's) on the left or top
  const { x: W, y: H } = renderer.getDrawingBufferSize(_sz);
  return W >= H ? [[0, 0, W >> 1, H], [W >> 1, 0, W - (W >> 1), H]] : [[0, H >> 1, W, H - (H >> 1)], [0, 0, W, H >> 1]];
}
function splitViews() {
  if (!splitActive() || !localCrew().every(h => h.cam)) return null;
  const rects = splitRects();
  return localCrew().map((h, i) => ({ cam: h.cam.c, rect: rects[i], x: h.cam.x, z: h.cam.z }));
}
function aimSun(x, z) {   // shadows are drawn around whichever half is being drawn
  sun.position.set(x, 0, z).add(SUN_OFF);
  sun.target.position.set(x, 0, z);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
}
function splitCam(h, V) {
  const c = h.cam ||= {};
  if (!c.c || !!c.c.isOrthographicCamera !== !!V.ortho) {
    c.c = (V.ortho ? orthoCam : perspCam).clone();
    c.x = h.x;
    c.z = h.z - V.lead;
    c.size = '';
  }
  const wide = window.innerWidth >= window.innerHeight;
  const w = window.innerWidth / (wide ? 2 : 1), ht = window.innerHeight / (wide ? 1 : 2), key = w + 'x' + ht;
  if (c.size !== key) {   // a lens for half the screen
    c.size = key;
    const a = w / ht;
    if (c.c.isPerspectiveCamera) { c.c.aspect = a; c.c.fov = a < 1 ? 78 : 52; }
    else { const [hw, hh] = orthoHalf(a); Object.assign(c.c, { left: -hw, right: hw, top: hh, bottom: -hh }); }
    c.c.updateProjectionMatrix();
  }
  return c;
}
function updateSplit(dt, V) {
  for (const h of localCrew()) {
    const c = splitCam(h, V), going = h.alive && !h.parked;
    const desired = h.z - V.lead;
    if (going && (desired < c.z || !V.ortho)) c.z += (desired - c.z) * Math.min(1, dt * 5);
    const follow = V.ortho ? clamp(h.x, -2.5, 2.5) * 0.6 : h.x;
    if (going) c.x += (follow - c.x) * Math.min(1, dt * (V.ortho ? 3 : 6));
    _t.set(c.x, 0, c.z);
    c.c.position.copy(_t).add(V.off);
    _look.copy(_t);
    _look.y = V.lookY || 0;
    c.c.lookAt(_look);
    if (game.shake > 0.002) {
      c.c.position.x += (Math.random() - 0.5) * game.shake * 0.18;
      c.c.position.y += (Math.random() - 0.5) * game.shake * 0.18;
    }
    c.c.updateMatrixWorld();
  }
  if (game.shake > 0.002) game.shake *= Math.exp(-dt * 5);
  useCamera(localCrew()[0].cam.c);
  game.camX = localCrew()[0].cam.x;
  game.camZ = Math.max(...localCrew().map(h => h.cam.z));   // the hindmost half, for anything that reads one camera
  setShadowSpan(V.shadow);
}
let splitShown = '';
function markSplit() {   // the ink line between the halves
  const on = splitActive(), tall = window.innerWidth < window.innerHeight, key = on ? (tall ? 'v' : 'h') : '';
  if (key === splitShown) return;
  splitShown = key;
  document.body.classList.toggle('split', on);
  document.body.classList.toggle('splitV', on && tall);
}

let fishCamHook = null;   // fishing's own camera (set up with the fishing, further down)
function updateCamera(dt) {
  if (game.where === 'farm' && (fishCamHook?.(dt) || swingCamHook(dt))) return;
  if (game.where === 'road') skyClouds(dt, camera.position.x, camera.position.z);   // the hopping game's sky has clouds too
  else clouds.visible = false;                                                       // the farm from above has no sky
  const V = activeView();
  markSplit();
  if (splitActive()) return updateSplit(dt, V);
  useCamera(V.ortho ? orthoCam : perspCam);
  const zoom = game.where === 'farm' ? farmCam.zoom : 1;
  if (orthoCam.zoom !== zoom) { orthoCam.zoom = zoom; orthoCam.updateProjectionMatrix(); }
  if (game.where === 'farm') {   // the farm: framed, but you can drag and zoom to look around; zoomed right out, the whole farm sits in the middle
    const out = clamp((FARM_ZOOM0 - zoom) / (FARM_ZOOM0 - FARM_ZOOM[0]), 0, 1);
    _t.set(lerp(farmCam.x, viewMid(), out * out), 0, FARM_Z - 1.4 + farmCam.z);
  }
  else {
    const F = roadFocus();
    const desired = F.z - V.lead;
    // Classic and Low only ever move forward; Behind follows the hopper both ways, like a third-person camera.
    if (F.alive && (desired < game.camZ || !V.ortho)) game.camZ += (desired - game.camZ) * Math.min(1, dt * 5);
    // Classic and Low drift gently with the hopper; Behind keeps the hopper centred.
    const follow = V.ortho ? clamp(F.x, -2.5, 2.5) * 0.6 : F.x;
    if (F.alive) game.camX += (follow - game.camX) * Math.min(1, dt * (V.ortho ? 3 : 6));
    _t.set(game.camX, 0, game.camZ);
  }
  // Co-Op Hop's Behind camera sits further back and higher, so the whole team fits.
  const pull = game.where === 'road' && localCrew().length > 1 && !V.ortho ? 1.45 : 1;
  camera.position.copy(_t).add(_off.copy(V.off).multiplyScalar(pull));
  _look.copy(_t);
  _look.y = V.lookY || 0;
  camera.lookAt(_look);
  if (game.shake > 0.002) {             // the ground rumbles when bulls are about to charge
    camera.position.x += (Math.random() - 0.5) * game.shake * 0.18;
    camera.position.y += (Math.random() - 0.5) * game.shake * 0.18;
    game.shake *= Math.exp(-dt * 5);
  }
  sun.position.copy(_t).add(SUN_OFF);
  sun.target.position.copy(_t);
  setShadowSpan(V.shadow);
  camera.updateMatrixWorld();
}

function ensureLanes() {
  const V = activeView();
  const rows = splitActive() && localCrew().every(h => h.cam) ? localCrew().map(h => Math.round(-h.cam.z)) : [Math.round(-game.camZ)];
  while (genRow <= Math.max(...rows) + V.ahead) addLane(genRow++);
  for (const lane of [...lanes.values()]) if (lane.r < Math.min(...rows) - V.behind) removeLane(lane);
}

// ---------- Betty Lou's farm: the hub between rounds ----------
// Built far behind the road (z = FARM_Z) in the same scene, so the same camera,
// lights and ink outlines draw it. While you're at the farm the road is paused.
const FARM_Z = 160;
// The farm has its own day, ten minutes long: sunrise, a long bright day, a golden
// sunset, a lavender dusk and about three minutes of moonlit night. It runs off the
// clock, so friends on the same farm see the same sky. Torches around the pond and
// along the house path light up from dusk, fireflies come out, and a soft glow
// stays around the players' hoppers so nobody gets lost in the dark.
const FARM_DAY = 600;
let farmTimeAt = null;   // tests: hold the farm at one time of day (0..1)
const farmClock = () => farmTimeAt ?? ((Date.now() / 1000) % FARM_DAY) / FARM_DAY;
// [time of day, daylight] keyframes; 0 is just before sunrise.
const FARM_SKY = [[0, 0.12], [0.05, 0.7], [0.14, 0.95], [0.3, 1], [0.48, 0.85], [0.56, 0.42], [0.62, 0.16], [0.67, 0], [0.94, 0], [1, 0.12]];
function farmLight(k = farmClock()) {
  let i = 0;
  while (i < FARM_SKY.length - 2 && k > FARM_SKY[i + 1][0]) i++;
  const [ka, la] = FARM_SKY[i], [kb, lb] = FARM_SKY[i + 1], t = clamp((k - ka) / (kb - ka), 0, 1);
  return lerp(la, lb, t * t * (3 - 2 * t));
}
function farmSunX(k = farmClock()) {   // east to west through the day (0 to 0.73 after dawn), back again by moon
  const d = (k + 0.06) % 1;
  return d < 0.73 ? lerp(-9, 9, d / 0.73) : lerp(9, -9, (d - 0.73) / 0.27);
}

// ---------- night lights ----------
// Anything that lights up the dark: a torch's flame, a firefly, a player's hopper.
// Each frame the brightest few are placed on the screen for the outline pass.
const lamps = [];   // { o: Object3D, r: radius of light on the ground, s: strength, torch }
const FLAME_GEO = new THREE.ConeGeometry(0.11, 0.34, 8);
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0xffd25a });
const EMBER_MAT = new THREE.MeshBasicMaterial({ color: 0xff6a2a });
// A bamboo garden torch with a little flame, in a piece's own space.
function torch(g, x, z, h = 0.85) {
  const v = new VB(0.6);
  v.cyl(0.03, 0.04, h, x, h / 2, z, 0xc79a52);                    // bamboo
  for (const y of [0.3, 0.62]) v.cyl(0.042, 0.042, 0.025, x, y * h, z, 0x8a6236);
  v.cyl(0.08, 0.045, 0.13, x, h + 0.04, z, 0x5a3a24);             // the cup
  g.add(v.mesh());
  const f = new THREE.Group();
  f.position.set(x, h + 0.24, z);
  const outer = new THREE.Mesh(FLAME_GEO, FLAME_MAT), inner = new THREE.Mesh(FLAME_GEO, EMBER_MAT);
  inner.scale.setScalar(0.55);
  inner.position.y = -0.04;
  for (const m of [outer, inner]) { m.layers.set(GLOW_LAYER); f.add(m); }
  f.userData.flame = true;
  g.add(f);
  lamps.push({ o: f, r: 2.4, s: 1, torch: true, ph: Math.random() * 6 });
  lamps.push({ o: f, r: 0.32, s: 1.2, torch: true, flame: true, ph: Math.random() * 6 });   // and the flame's own glow
}
const TORCH_AT = [1.75, 3.55, 4.75, 5.95];   // around the pond (radians), clear of the dock and the reeds
function inScene(o) { while (o) { if (o === scene) return true; o = o.parent; } return false; }
const nightK = () => clamp((0.4 - game.light) / 0.32, 0, 1);
const _lp = new THREE.Vector3(), _lq = new THREE.Vector3();
function placeLamps(views) {
  const U = postMat.uniforms, k = game.where === 'farm' && game.state === 'farm' ? nightK() : 0;
  U.lampK.value = k;
  U.lampN.value = 0;
  for (let i = lamps.length - 1; i >= 0; i--) if (!inScene(lamps[i].o)) lamps.splice(i, 1);   // its piece was rebuilt or moved
  if (!k) return;
  // the players' own hoppers glow a little, and so do a few fireflies
  const list = lamps.slice();
  const close = camera.isPerspectiveCamera;   // the fishing camera, right beside them: light their whole body
  for (const w of playerMarks().map(([w]) => w)) if (w && !w.hidden) list.push({ o: w.m.group, r: close ? 0.9 : 1.5, s: close ? 0.95 : 0.75, y: close ? 0.6 + (w.y || 0) : 0.35 });
  for (const m of farm.markers || []) if (m.visible) list.push({ o: m, r: 0.42, s: 1.3, w: 0, flame: true });   // the players' sunflowers glow, in their own colours
  for (const f of flies.slice(0, 4)) list.push({ o: f.m, r: 0.7, s: 0.5 * Math.min(1, f.m.scale.x * 12), y: 0, fly: true });
  const W = rtColor.width, H = rtColor.height;
  let n = 0;
  for (const v of views) {
    const cam = v ? v.cam : camera, [rx0, ry0, rw, rh] = v ? v.rect : [0, 0, W, H];
    const toUv = p => [(rx0 + (p.x * 0.5 + 0.5) * rw) / W, (ry0 + (p.y * 0.5 + 0.5) * rh) / H];
    for (const L of list) {
      if (n >= 24) break;
      L.o.getWorldPosition(_lp);
      if (!L.flame) _lp.y = L.y ?? 0.35;                    // light on the ground and on whoever stands there
      _lq.copy(_lp).project(cam);
      if (Math.abs(_lq.x) > 1.4 || Math.abs(_lq.y) > 1.4 || _lq.z > 1) continue;   // well off this view
      const [cx, cy] = toUv(_lq);
      let ex = 0, ey = 0;
      for (const [dx, dz] of [[L.r, 0], [0, L.r]]) {          // the ground circle's size on the screen
        const [ux, uy] = toUv(_lq.copy(_lp).add({ x: dx, y: 0, z: dz }).project(cam));
        ex = Math.max(ex, Math.abs(ux - cx)); ey = Math.max(ey, Math.abs(uy - cy));
      }
      if (L.fly && ex > 0.06) continue;                      // a firefly right by the camera: not a big blob of light
      U.lamps.value[n].set(cx, cy, ex + 0.001, L.flame ? ex * W / H + 0.001 : ey * 1.35 + 0.01);   // a little taller: it lights the hoppers standing in it
      U.lampS.value[n] = L.s * (L.torch ? 0.9 + 0.1 * Math.sin(game.time * 9 + L.ph) : 1);
      U.lampW.value[n] = L.w ?? 1;
      n++;
    }
  }
  U.lampN.value = n;
}
// Flames flicker once it's dark enough to light them; by day the torches stand unlit.
function updateTorches(t) {
  const k = nightK();
  for (const L of lamps) {
    if (!L.torch || L.flame) continue;
    L.o.visible = k > 0.02;
    const s = Math.min(1, k * 3);
    L.o.scale.set(s * (1 + Math.sin(t * 13 + L.ph) * 0.08), s * (1 + Math.sin(t * 9 + L.ph * 2) * 0.18), s);
  }
}
// What each Fish Pond level adds. Level n costs n sunflowers (1, 2, 3, ...).
const pondNext = lvl => {   // what the next level brings: its new look, or after those the new fish it lets in
  const step = t('pondSteps')[lvl], sp = FISH.find(f => f.lvl === lvl + 1);
  return step || (sp ? t('pondNewFish', { name: fishName(sp.id) }) : t('pondMore'));
};
const pondCost = lvl => lvl + 1;

const farm = { group: new THREE.Group(), pieces: {}, fish: [], ducks: [], spray: 0, hero: null, level: store.get('bl-pond', 0) };
farm.group.position.set(0, 0, FARM_Z);
// The Bunkhouse: a staked-out plot until it's built, then a log cabin where new hoppers move in.
const BUNK_COST = 10;
farm.bunkBuilt = store.get('bl-bunk', false);
// The Jam Stage: a plot until it's built, then a little stage where your hopper plays the banjo.
const STAGE_COST = 1;
const LAND_COST = 500;
farm.stageBuilt = store.get('bl-stage', false);
scene.add(farm.group);
// Everything in the Farm Buildings menu (the Fish Pond has its own button). Each is
// built once; levels come later, so a finished one is level 1 for now.
const BUILDINGS = [
  { id: 'bunk', flag: 'bunkBuilt', name: 'bunkhouse', cost: BUNK_COST, draw: () => buildBunk(), open: () => openBunk() },
  { id: 'stage', flag: 'stageBuilt', name: 'jamStage', cost: STAGE_COST, draw: () => buildStage(), open: () => farm.stageBuilt ? openJam() : openStage() },
  { id: 'plot', flag: 'wide', name: 'moreLand', cost: LAND_COST, draw: () => drawPlotIcon(), open: () => openLand() },
];
const buildLevel = b => farm[b.flag] ? 1 : 0;

// ---------- the farm layout ----------
// The house, barn, pond, Bunkhouse, sunflower patch, mailbox and any decorations
// you buy are "pieces": each is its own group, moved and turned in Decorate mode
// and saved on the device. A piece's footprint is given in its own space, front
// (+z) toward the camera: `foot` must stay clear of other pieces and inside the
// fence; `block` (default: foot) is where the hoppers can't walk.
const FARM_BOUNDS = { x0: -7.2, x1: 7.2, z0: -11, z1: 7.2 };   // inside the fence and trees: twice the old farm's area
// More Land: the field to the right, as big again, bought for LAND_COST. Before then it
// lies past the trees inside a faint rope fence; once bought the trees move round it
// and the countryside reaches further out that way, so the farm stays in the middle.
const WIDE_X1 = 21.6;
farm.wide = store.get('bl-wide', false);
if (farm.wide) FARM_BOUNDS.x1 = WIDE_X1;
const farmMid = () => (FARM_BOUNDS.x0 + FARM_BOUNDS.x1) / 2;
const PLOT = { x0: FARM_BOUNDS.x0 + 18.8, x1: WIDE_X1 + 0.6, z0: FARM_BOUNDS.z0 - 0.6, z1: FARM_BOUNDS.z1 + 0.6 };   // the field next door, past the trees
const viewMid = () => (FARM_BOUNDS.x0 + (farm.wide ? FARM_BOUNDS.x1 : PLOT.x1)) / 2;   // zoomed right out: the farm, and the field for sale too
const GRID = 0.5;
const PIECES = {
  house: { build: buildHouse, foot: [-1.7, 1.7, -1.4, 4.2], block: [-1.7, 1.7, -1.4, 2.0], at: [-2.5, -7.5, 0] },
  barn: { build: buildBarn, foot: [-2.05, 1.6, -1.6, 1.95], at: [4, -8.5, 0] },
  pond: { build: g => { farm.pond = g; buildPond(); }, foot: [-2.8, 2.8, -2.1, 2.1], at: [2, 2, 0], pond: true },   // room for its biggest size
  bunk: { build: g => { farm.bunk = g; buildBunk(); }, foot: [-1.3, 1.3, -1.1, 1.45], block: [-1.3, 1.3, -1.1, 1.0], at: [0.5, -3.5, 0] },
  stage: {
    build: g => { farm.stage = g; buildStage(); return stageTick; }, at: [-4.5, -1.5, 0],
    get foot() { const k = stageK(); return [-1.3 * k, 1.3 * k, -1.0 * k, 1.25 * k]; },   // the Big Jam Stage takes more room
    get block() { const k = stageK(); return [-1.3 * k, 1.3 * k, -1.0 * k, 1.0 * k]; },
  },
  flowers: { build: buildFlowers, foot: [-0.75, 0.75, -0.75, 0.75], at: [-4.5, 2.5, 0] },
  mailbox: { build: buildMailbox, foot: [-0.35, 0.35, -0.35, 0.35], at: [-3, 6, 0] },
  scarecrow: { build: buildScarecrow, foot: [-0.75, 0.75, -0.45, 0.45], decor: true, price: 10, bg: '#fff1b8' },
  swing: { build: buildSwing, foot: [-1.1, 1.1, -0.9, 0.9], decor: true, price: 10, bg: '#d9f2ff', icon: 0.78 },   // icon: smaller in the shop, it's tall
  drums: { build: buildDrumKit, decor: true, onStage: true, price: 1, bg: '#ffd6ec' },   // sits on the Jam Stage, not in the yard
  disco: { build: buildDiscoBall, decor: true, onStage: true, price: 100, bg: '#e6dcff' },   // turns on top of the Jam Stage's sign
  bigstage: { build: buildBigStageIcon, decor: true, onStage: true, needsStage: true, price: 200, bg: '#ffe0b8' },   // the Jam Stage, a third bigger
};
const DECOR = Object.keys(PIECES).filter(id => PIECES[id].decor);
const ownedDecor = new Set(store.get('bl-decor', []).filter(id => DECOR.includes(id)));
const savedLayout = store.get('bl-layout', {});
const snap = v => Math.round(v / GRID) * GRID;
// A footprint turned r quarter turns (three.js y rotation), as an x0, x1, z0, z1 box.
function turnRect([x0, x1, z0, z1], r) {
  return [[x0, x1, z0, z1], [z0, z1, -x1, -x0], [-x1, -x0, -z1, -z0], [-z1, -z0, x0, x1]][r & 3];
}
function worldRect(rect, x, z, r) {
  const [a, b, c, d] = turnRect(rect, r);
  return [a + x, b + x, c + z, d + z];
}
function placeOk(id, x, z, r) {
  const [a, b, c, d] = worldRect(PIECES[id].foot, x, z, r), B = FARM_BOUNDS;
  if (a < B.x0 || b > B.x1 || c < B.z0 || d > B.z1) return false;
  for (const p of Object.values(farm.pieces)) {
    if (p.id === id) continue;
    const [e, f, g, h] = worldRect(PIECES[p.id].foot, p.x, p.z, p.r);
    if (a < f && b > e && c < h && d > g) return false;
  }
  return true;
}
function findSpot(id, x, z, r) {   // the nearest clear grid spot to (x, z), rings outward
  for (let k = 0; k <= 36; k++) for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
    const px = snap(x) + i * GRID, pz = snap(z) + j * GRID;
    if (placeOk(id, px, pz, r)) return [px, pz];
  }
  return null;
}
function setPiece(p, x, z, r) {
  Object.assign(p, { x, z, r: r & 3 });
  p.group.position.x = x;
  p.group.position.z = z;
  p.group.rotation.y = p.r * Math.PI / 2;
}
function addPiece(id, near) {
  const p = { id, group: new THREE.Group() };
  farm.group.add(p.group);
  p.update = PIECES[id].build(p.group);   // a few pieces return a little animation
  const saved = savedLayout[id];
  let [x, z, r] = near || (saved ? [saved.x, saved.z, saved.r] : PIECES[id].at || [0, 0, 0]);   // (a decoration with no saved spot: the nearest free one to the middle)
  if (!placeOk(id, x, z, r)) [x, z] = findSpot(id, x, z, r) || [x, z];
  farm.pieces[id] = p;
  setPiece(p, x, z, r);
  return p;
}
function saveLayout() {
  const out = {};
  for (const p of Object.values(farm.pieces)) out[p.id] = { x: p.x, z: p.z, r: p.r };
  store.set('bl-layout', out);
}
const pieceToFarm = (p, lx, lz) => {   // a point in a piece's own space, in farm space
  const a = p.r * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
};

function buildFarm() {
  farm.scenery = new THREE.Group();
  farm.group.add(farm.scenery);
  buildScenery();
  for (const id of Object.keys(PIECES)) if (!PIECES[id].onStage && (!PIECES[id].decor || ownedDecor.has(id))) addPiece(id);
}
// Everything round the pieces: the ground, the fence along the front, the trees all
// round, and the countryside. Built again when the farm grows.
function buildScenery() {
  const g = farm.scenery;
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse(o => { o.geometry?.dispose(); if (o.userData.tag) { o.material.map.dispose(); o.material.dispose(); } });
  }
  const vb = new VB(0.45);
  const GRASS = 0x9bd85a, B = FARM_BOUNDS, [lx0, lx1] = landX(), mid = farmMid();
  vb.rbox(lx1 - lx0 + 4, 1, 64, (lx0 + lx1) / 2, -0.51, 0, GRASS, 0.3);    // the ground, big enough to zoom out over (the land grid lies on top)
  for (let i = 0; i < 80 * (B.x1 - B.x0) / 14.4; i++) vb.cone(0.035, 0.11, rand(B.x0 - 4.8, B.x1 + 4.8), 0.045, rand(-14, 10), 0x7cc24a);  // tufts

  // fence along the front, trees all round
  const fz = B.z1 + 0.6, fx0 = Math.ceil(B.x0 - 0.6), fx1 = Math.floor(B.x1 + 0.6);
  for (let x = fx0; x <= fx1; x += 1) {
    vb.cyl(0.05, 0.06, 0.6, x, 0.3, fz, 0xf4ead8);
    vb.ball(0.06, 0.04, 0.06, x, 0.62, fz, 0xf4ead8);
  }
  for (const y of [0.25, 0.48]) vb.rbox(fx1 - fx0 + 0.2, 0.06, 0.05, (fx0 + fx1) / 2, y, fz, 0xf4ead8, 0.02);
  for (let x = B.x0 - 5.8; x <= B.x1 + 5.8; x += 1.3) for (const z of [B.z0 - 1.3, B.z0 - 2.9]) pick(ALL_TREES)(vb, x + rand(-0.3, 0.3), z + rand(-0.3, 0.3));
  for (let z = B.z0; z <= B.z1 + 1.5; z += 1.4) for (const d of [1.2, 2.5, 3.9]) for (const x of [B.x0 - d, B.x1 + d]) pick(ALL_TREES)(vb, x + rand(-0.3, 0.3), z + rand(-0.3, 0.3));
  bush(vb, B.x0 - 0.5, 3.4); bush(vb, B.x1 + 0.5, -1.6);
  if (!farm.wide) {   // the field next door: a faint rope fence round it, and its price
    const P = PLOT, posts = [];
    for (let x = P.x0; x <= P.x1 + 0.01; x += (P.x1 - P.x0) / 10) posts.push([x, P.z0], [x, P.z1]);
    for (let z = P.z0; z <= P.z1 + 0.01; z += (P.z1 - P.z0) / 12) posts.push([P.x0, z], [P.x1, z]);
    for (const [x, z] of posts) vb.cyl(0.025, 0.03, 0.3, x, 0.15, z, 0xe6dcc2);
    for (const z of [P.z0, P.z1]) vb.rbox(P.x1 - P.x0, 0.015, 0.015, (P.x0 + P.x1) / 2, 0.25, z, 0xd8ccb0, 0.005);
    for (const x of [P.x0, P.x1]) vb.rbox(0.015, 0.015, P.z1 - P.z0, x, 0.25, (P.z0 + P.z1) / 2, 0xd8ccb0, 0.005);
    costTag(g, LAND_COST, (P.x0 + P.x1) / 2, 1.3, (P.z0 + P.z1) / 2);
  }
  g.add(vb.mesh());
  g.add(buildLand());
}
const inPlot = (x, z) => x > PLOT.x0 && x < PLOT.x1 && z > PLOT.z0 && z < PLOT.z1;
// For the Farm Buildings card: a little fenced field with a sign.
function drawPlotIcon() {
  const g = farm.plot, v = new VB(0.6);
  v.rbox(2.6, 0.08, 2.0, 0, 0.04, 0, 0x9bd85a, 0.06);
  for (let i = 0; i < 9; i++) v.cone(0.05, 0.16, -1 + (i % 3) * 1, 0.14, -0.6 + Math.floor(i / 3) * 0.6, 0x7cc24a);
  for (let i = 0; i <= 6; i++) for (const z of [-0.95, 0.95]) v.cyl(0.03, 0.035, 0.35, -1.25 + i * 2.5 / 6, 0.2, z, 0xe6dcc2);
  for (let i = 0; i <= 4; i++) for (const x of [-1.25, 1.25]) v.cyl(0.03, 0.035, 0.35, x, 0.2, -0.95 + i * 1.9 / 4, 0xe6dcc2);
  v.cyl(0.04, 0.04, 0.9, 0.5, 0.45, 0.3, 0x9c6b3c);                                // a sign with a sunflower on it
  v.rbox(0.7, 0.42, 0.06, 0.5, 0.95, 0.32, 0xfff1d8, 0.06);
  v.cyl(0.11, 0.11, 0.03, 0.5, 0.95, 0.36, 0xffcc1a, Math.PI / 2, 0, 0);
  v.cyl(0.05, 0.05, 0.035, 0.5, 0.95, 0.37, 0x7a4a1c, Math.PI / 2, 0, 0);
  g.add(v.mesh());
}
// The More Land panel: the price and a Buy button; once it's bought, just a happy note.
const landOpen = () => $('land').classList.contains('show');
function refreshLand() {
  $('landSay').textContent = t(farm.wide ? 'landDone' : 'landPlan');
  $('landBuy').hidden = farm.wide;
  $('landCost').textContent = LAND_COST;
  $('landBuy').disabled = game.coins < LAND_COST;
  $('landNeed').textContent = farm.wide ? '' : needText(LAND_COST - game.coins);
}
function openLand() {
  if (GUEST || game.state !== 'farm') return;
  closeHeroes(); closePond(); closeBunk(); closeStage();
  refreshLand();
  $('land').classList.add('show');
  game.picking = true;
}
function closeLand() {
  $('land').classList.remove('show');
  game.picking = anyPanel();
}
function buyLand() {
  if (farm.wide) return;
  if (game.coins < LAND_COST) { sfx.bump(); return; }
  game.coins -= LAND_COST;
  store.set('bl-coins', game.coins);
  farm.wide = true;
  store.set('bl-wide', true);
  growFarm();
  sfx.upgrade();
  cheer((PLOT.x0 + PLOT.x1) / 2, (PLOT.z0 + PLOT.z1) / 2);
  hud();
  closeLand();
  Object.assign(farmCam, { x: farmMid(), z: 0, zoom: FARM_ZOOM[0] });   // look out over the whole farm
}
function growFarm() {   // the bounds, the yard and the scenery
  FARM_BOUNDS.x1 = WIDE_X1;
  YARD.x1 = FARM_BOUNDS.x1 - 0.3;
  buildScenery();
  settleWalkers();
}

// ---------- the land around the farm ----------
// Past the fence and the ring of trees: meadows of different grasses, ploughed
// fields, rolling hills, a river with a footbridge, a lake or two, little groves
// and rock gardens. It's all laid out from a seed made once for each farm, so every
// farm's countryside is its own (and a visiting friend sees the host's).
// Flat things are stacked a hair apart in height so they never flicker.
const LAND_KEY = 'bl-land';
const LAND = 30;                                                   // how far out it goes, front to back
// ...and side to side: a little further right once the farm is bigger, so it stays in the middle
const landX = () => [-LAND, LAND + 2 * farmMid()];
const FARM_ZONE = { x0: -12.8, x1: WIDE_X1 + 5.6, z0: -15.5, z1: 8.8 };   // the farm, the field next door, and their trees
const LDISC = () => prim('ldisc', () => new THREE.CylinderGeometry(1, 1, 0.1, 22));
// A hill: a bell turned on a lathe, easing out flat into the grass so it never has the
// steep sides that the ink pass would hatch.
const HILL = () => prim('hill', () => new THREE.LatheGeometry(Array.from({ length: 33 }, (_, i) => new THREE.Vector2(1 - i / 32, (1 - Math.cos(Math.PI * i / 32)) / 2)), 128));
const MEADOW = [0x7fc049, 0x86c64c, 0x8fd052, 0x9ccf5e, 0xa8e06a, 0xb2e27a];   // darkest to palest: the ground blends along it
const YARD_GREEN = 0x9bd85a;
const HILLS = [0x6fb440, 0x78bd45, 0x66a93c, 0x82c34a];
const STONES = [0x9aa0a6, 0xb4babf, 0x878d94, 0xc4c0b8];
const BLOOMS = [0xff6fae, 0xffd93b, 0xffffff, 0xb48cff, 0xff8a5c];
function landSeed() {
  let s = store.get(LAND_KEY, null);
  if (!Number.isInteger(s)) { s = (Math.random() * 2 ** 32) >>> 0; store.set(LAND_KEY, s); }
  return s >>> 0;
}
// A flat oval lying on the ground with its top at y, turned `turn` about the vertical.
const oval = (vb, rx, rz, x, z, y, col, turn = 0) => vb.add(LDISC(), col, x, y - 0.05, z, 0, turn, 0, rx, 1, rz);
const nearFarm = (x, z, r) => x + r > FARM_ZONE.x0 && x - r < FARM_ZONE.x1 && z + r > FARM_ZONE.z0 && z - r < FARM_ZONE.z1;
const inYard = (x, z, r) => x + r > FARM_BOUNDS.x0 - 0.6 && x - r < FARM_BOUNDS.x1 + 0.6 && z + r > FARM_BOUNDS.z0 - 0.6 && z - r < FARM_BOUNDS.z1 + 0.6;
function buildLand() {
  const vb = new VB(0.45), hills = new VB(0.45), was = rnd, [LX0, LX1] = landX();
  rnd = seeded(landSeed());
  const used = [], wet = [];                                       // circles taken by things, and by water: [x, z, r]
  const hits = (list, x, z, r) => list.some(([ux, uz, ur]) => Math.hypot(ux - x, uz - z) < ur + r);
  const free = (x, z, r) => x - r > LX0 && x + r < LX1 && Math.abs(z) + r < LAND && !nearFarm(x, z, r) && !hits(used, x, z, r);
  const spot = (r, zone = () => true) => {                        // somewhere clear for a circle of radius r
    for (let i = 0; i < 80; i++) {
      const x = rand(LX0, LX1), z = rand(-LAND, LAND);
      if (free(x, z, r) && zone(x, z)) { used.push([x, z, r]); return [x, z]; }
    }
    return null;
  };

  // The river wanders right across the land in front of the farm, down one side, or behind it.
  const way = ri(0, 2), side = rnd() < 0.5 ? -1 : 1;
  const base = way === 0 ? rand(12, 14.5) : way === 1 ? -rand(15.8, 18) : -rand(19, 23);   // (down the left side: the right is kept for the field next door)
  const amp = rand(0.7, 1.9), freq = rand(0.12, 0.2), ph = rand(0, 6.3), w = rand(0.85, 1.2);
  const along = t => { const o = base + (Math.sin(t * freq + ph) + Math.sin(t * freq * 2.3 + ph) * 0.3) * amp; return way === 1 ? [o, t] : [t, o]; };
  const [t0, t1] = way === 1 ? [-LAND, LAND] : [LX0, LX1];
  for (let t = t0 - 2; t <= t1 + 2; t += 0.7) {
    const [x, z] = along(t);
    oval(vb, w + 0.45, w + 0.45, x, z, 0.03, 0xd9c48a);           // sandy banks
    oval(vb, w, w, x, z, 0.036, 0x5ccaf0);                         // water
    oval(vb, w * 0.45, w * 0.45, x, z, 0.04, 0x4ab4e4);            // the deeper middle
    used.push([x, z, w + 0.5]); wet.push([x, z, w + 0.5]);
  }
  for (let i = 0; i < 14; i++) {                                   // glints on the water
    const t = rand(t0, t1), [x, z] = along(t), [x2, z2] = along(t + 0.2);
    oval(vb, rand(0.35, 0.6), 0.1, x + rand(-0.3, 0.3), z + rand(-0.3, 0.3), 0.044, 0x8edcf6, -Math.atan2(z2 - z, x2 - x));
  }
  {                                                                // a footbridge somewhere along it
    const t = rand(-14, 14) + (way === 1 ? 0 : side * 4), [x, z] = along(t), [x2, z2] = along(t + 0.2);
    const a = -Math.atan2(z2 - z, x2 - x) + Math.PI / 2, len = 2 * w + 1.3, c = Math.cos(a), s = Math.sin(a);
    vb.rbox(len, 0.08, 0.85, x, 0.2, z, 0xb88a5a, 0.02, 0, a, 0);
    for (let k = -2; k <= 2; k++) vb.rbox(0.05, 0.02, 0.86, x + c * k * len / 5, 0.25, z - s * k * len / 5, 0x9a6f45, 0.01, 0, a, 0);   // plank lines
    for (const e of [-1, 1]) {
      const rx = x - s * e * 0.42, rz = z - c * e * 0.42;
      vb.rbox(len, 0.05, 0.05, rx, 0.52, rz, 0xf4ead8, 0.02, 0, a, 0);           // rails
      for (const k of [-1, 0, 1]) vb.cyl(0.04, 0.04, 0.36, rx + c * k * len * 0.45, 0.36, rz - s * k * len * 0.45, 0xf4ead8);
    }
  }

  // A lake or two, with reeds, lily pads and sometimes a little rowing boat.
  for (let n = ri(1, 2), i = 0; i < n; i++) {
    const rx = rand(2.6, 4.2), rz = rx * rand(0.6, 0.85), turn = rand(0, Math.PI);
    const at = spot(rx + 1);
    if (!at) continue;
    const [x, z] = at, c = Math.cos(turn), s = Math.sin(turn), on = (u, v) => [x + u * c + v * s, z - u * s + v * c];
    wet.push([x, z, rx + 1]);
    oval(vb, rx + 0.45, rz + 0.45, x, z, 0.03, 0xd9c48a, turn);
    oval(vb, rx, rz, x, z, 0.036, 0x5ccaf0, turn);
    oval(vb, rx * 0.55, rz * 0.5, x, z, 0.04, 0x4ab4e4, turn);
    oval(vb, rx * 0.4, rz * 0.2, ...on(rx * 0.2, -rz * 0.3), 0.044, 0x8edcf6, turn);
    for (let k = 0; k < 5; k++) {                                  // reeds and cattails in a clump
      const a = rand(0, Math.PI * 2), [px, pz] = on(Math.cos(a) * rx, Math.sin(a) * rz);
      for (let j = 0; j < 3; j++) {
        const qx = px + rand(-0.25, 0.25), qz = pz + rand(-0.25, 0.25), h = rand(0.45, 0.7);
        vb.cyl(0.015, 0.015, h, qx, h / 2, qz, 0x4f8f30);
        vb.cap(0.03, 0.08, qx, h, qz, 0x7a4a1c);
      }
    }
    for (let k = 0; k < ri(3, 6); k++) {                           // lily pads, some in flower
      const a = rand(0, Math.PI * 2), d = rand(0.3, 0.75), [px, pz] = on(Math.cos(a) * rx * d, Math.sin(a) * rz * d);
      oval(vb, 0.26, 0.26, px, pz, 0.05 + k * 0.001, 0x3fae49);
      if (rnd() < 0.5) vb.ball(0.06, 0.05, 0.06, px + 0.06, 0.08, pz, 0xff8fc8);
    }
    if (rnd() < 0.5) {                                             // a rowing boat drifting
      const [bx, bz] = on(rand(-0.4, 0.4) * rx, rand(-0.4, 0.4) * rz), ba = rand(0, Math.PI);
      vb.ball(0.62, 0.2, 0.26, bx, 0.06, bz, 0xc9473a, 0, ba, 0);
      vb.ball(0.54, 0.12, 0.2, bx, 0.15, bz, 0x8a5a33, 0, ba, 0);
      vb.rbox(0.08, 0.04, 0.4, bx, 0.2, bz, 0xb88a5a, 0.01, 0, ba, 0);
    }
  }

  // Rolling hills, tallest out behind and to the sides; only low ones in front.
  for (let n = ri(4, 7), i = 0; i < n; i++) {
    const rx = rand(3.5, 7), rz = rx * rand(0.55, 0.8), turn = rand(0, Math.PI);
    const at = spot(rx * 0.85, (x, z) => z < 9 || rnd() < 0.3);
    if (!at) continue;
    const [x, z] = at, h = Math.min(z > 9 ? rand(0.7, 1.1) : rand(1.4, 2.6), rz * 0.3), y0 = -0.04;   // never so steep the camera sees a slope edge-on (the ink pass hatches it)
    const foot = new THREE.Color(pick(HILLS)), top = foot.clone().multiplyScalar(1.18), _k = new THREE.Color();
    hills.add(HILL(), (_x, y) => _k.copy(foot).lerp(top, clamp(y / h, 0, 1)), x, y0, z, 0, turn, 0, rx, h, rz);   // sunnier toward the top
    const c = Math.cos(turn), s = Math.sin(turn);
    for (let k = 0; k < ri(6, 14); k++) {                          // wildflowers up its sides
      const u = rand(-0.75, 0.75), v = rand(-0.75, 0.75);
      if (u * u + v * v > 0.6) continue;
      const fy = y0 + h * (1 + Math.cos(Math.PI * Math.hypot(u, v))) / 2;
      vb.ball(0.07, 0.04, 0.07, x + u * rx * c + v * rz * s, fy, z - u * rx * s + v * rz * c, pick(BLOOMS));
    }
  }

  // Ploughed fields: furrows, some sprouting, some golden with wheat.
  for (let n = ri(1, 3), i = 0; i < n; i++) {
    const fw = rand(4, 6.5), fd = rand(3, 4.5), at = spot(Math.hypot(fw, fd) / 2 + 0.4);
    if (!at) continue;
    const [x, z] = at, turn = rand(-0.4, 0.4), c = Math.cos(turn), s = Math.sin(turn), crop = ri(0, 2);
    vb.rbox(fw, 0.06, fd, x, 0.0, z, 0x9a6b3e, 0.03, 0, turn, 0);
    for (let r = -fd / 2 + 0.3; r < fd / 2 - 0.1; r += 0.45) {
      const rx = x + r * s, rz = z + r * c;
      vb.rbox(fw - 0.3, 0.06, 0.16, rx, 0.04, rz, 0x84592f, 0.03, 0, turn, 0);
      if (crop === 0) continue;                                    // bare earth, freshly ploughed
      for (let u = -fw / 2 + 0.35; u < fw / 2 - 0.2; u += 0.4) {
        const px = rx + u * c, pz = rz - u * s;
        if (crop === 1) vb.ball(0.1, 0.08, 0.1, px, 0.1, pz, pick([0x5cb83a, 0x68c444]));
        else vb.cone(0.07, 0.3, px, 0.2, pz, pick([0xe8c45c, 0xf0d070]));
      }
    }
  }

  // Little groves of trees.
  for (let n = ri(2, 4), i = 0; i < n; i++) {
    const at = spot(1.8);
    if (at) for (let k = 0; k < ri(3, 6); k++) pick(ALL_TREES)(vb, at[0] + rand(-1.4, 1.4), at[1] + rand(-1.4, 1.4));
  }

  // Rock gardens: a gravel bed with stones big and small, moss, succulents and flowers.
  for (let n = ri(5, 9), i = 0; i < n; i++) {
    const r = rand(1.2, 2), at = spot(r + 0.2);
    if (!at) continue;
    const [x, z] = at, turn = rand(0, Math.PI);
    oval(vb, r, r * 0.75, x, z, 0.026 + i * 0.0006, 0xe2dccb, turn);
    for (let k = 0; k < 14; k++) {                                 // a ring of edging pebbles
      const a = k / 14 * Math.PI * 2, px = Math.cos(a) * r, pz = Math.sin(a) * r * 0.75;
      vb.ball(0.1, 0.06, 0.09, x + px * Math.cos(turn) + pz * Math.sin(turn), 0.03, z - px * Math.sin(turn) + pz * Math.cos(turn), pick(STONES));
    }
    for (let k = 0; k < ri(3, 6); k++) {
      const s = rand(0.22, 0.6), px = x + rand(-0.5, 0.5) * r, pz = z + rand(-0.4, 0.4) * r;
      vb.ball(s, s * rand(0.5, 0.8), s * rand(0.7, 1), px, s * 0.2, pz, pick(STONES), 0, rand(0, 3), 0);
      if (rnd() < 0.5) vb.ball(s * 0.5, s * 0.2, s * 0.45, px - s * 0.2, s * 0.62, pz, 0x6fae4a);   // moss on top
    }
    for (let k = 0; k < ri(2, 4); k++) {                           // succulents
      const px = x + rand(-0.6, 0.6) * r, pz = z + rand(-0.45, 0.45) * r;
      for (let j = 0; j < 5; j++) vb.cone(0.06, 0.2, px, 0.08, pz, 0x7fc6a4, Math.cos(j * 1.26) * 0.6, 0, Math.sin(j * 1.26) * 0.6);
    }
    for (let k = 0; k < ri(3, 7); k++) {
      const px = x + rand(-0.7, 0.7) * r, pz = z + rand(-0.5, 0.5) * r;
      vb.cyl(0.012, 0.012, 0.14, px, 0.07, pz, 0x3f8f2f);
      vb.ball(0.06, 0.035, 0.06, px, 0.15, pz, pick(BLOOMS));
    }
  }

  // The ground itself: a fine grid tinted by gentle noise into meadows of different
  // grasses, fading in from the yard's own green past the fence.
  const p1 = rand(0, 6.3), p2 = rand(0, 6.3), p3 = rand(0, 6.3), B = FARM_BOUNDS, _g = new THREE.Color(), _h = new THREE.Color();
  const gw = LX1 - LX0 + 4;
  vb.add(prim('landGrid' + gw, () => new THREE.PlaneGeometry(gw, 2 * LAND + 4, Math.round(132 * gw / (2 * LAND + 4)), 132)), (x, y, z) => {
    const out = Math.hypot(Math.max(B.x0 - x, 0, x - B.x1), Math.max(B.z0 - z, 0, z - B.z1 - 0.6));
    const n = (Math.sin(x * 0.21 + p1) * Math.cos(z * 0.17 + p2) + Math.sin((x + z) * 0.11 + p3) * 0.6 + Math.sin(x * 0.53 - z * 0.47 + p2) * 0.25) / 1.85;
    const k = (clamp(n, -1, 1) + 1) / 2 * (MEADOW.length - 1), i = Math.min(Math.floor(k), MEADOW.length - 2);
    _h.set(MEADOW[i]).lerp(_g.set(MEADOW[i + 1]), k - i);
    return _g.set(YARD_GREEN).lerp(_h, clamp(out / 3, 0, 1));
  }, (LX0 + LX1) / 2, 0, 0, -Math.PI / 2, 0, 0);
  for (let i = 0; i < 520 * (LX1 - LX0) / (2 * LAND); i++) {       // tufts, and flowers where it's a wildflower patch
    const x = rand(LX0, LX1), z = rand(-LAND, LAND);
    if (inYard(x, z, 0.2) || hits(wet, x, z, 0.1) || hits(used, x, z, 0)) continue;
    if (Math.sin(x * 0.31 + ph) * Math.cos(z * 0.27 - ph) > 0.55) vb.ball(0.06, 0.035, 0.06, x, 0.07, z, pick(BLOOMS));
    else vb.cone(0.035, 0.11, x, 0.045, z, pick([0x7cc24a, 0x6fb440, 0x8fd052]));
  }

  rnd = was;
  const g = new THREE.Group(), hm = hills.mesh();
  hm.castShadow = false;   // a dome shading itself comes out as hatching
  g.add(vb.mesh(), hm);
  return g;
}

// farmhouse: cream walls, red gable roof, porch, door and windows, a path to the door
function buildHouse(g) {
  const vb = new VB(0.45), WOOD = 0x9c6b3c;
  vb.rbox(1.0, 0.04, 2.4, 0, 0.01, 3.0, 0xdcc08a, 0.3);                      // path from the porch
  vb.rbox(2.8, 1.6, 2.2, 0, 0.8, 0, 0xfff1d8, 0.08);
  vb.roof(2.6, 3.2, 0.62, 0, 1.6 + 2.6 / Math.sqrt(3) / 2 * 0.62, 0, 0xd8473a);   // sits on the walls
  vb.cyl(0.14, 0.14, 0.7, 0.8, 2.05, -0.3, 0xb35a3a);                       // chimney
  vb.rbox(0.5, 0.9, 0.06, 0, 0.45, 1.11, 0x8a5a33, 0.05);                   // door
  vb.ball(0.04, 0.04, 0.03, 0.15, 0.45, 1.15, 0xffd23f);
  for (const s of [-1, 1]) {
    vb.rbox(0.5, 0.5, 0.06, s * 0.85, 0.95, 1.11, 0xbfe9ff, 0.06);          // windows
    vb.rbox(0.56, 0.06, 0.08, s * 0.85, 0.68, 1.12, 0xffffff, 0.02);
    vb.rbox(0.56, 0.12, 0.14, s * 0.85, 0.62, 1.18, 0x8a5a33, 0.03);        // flower boxes
    for (let i = 0; i < 3; i++) vb.ball(0.05, 0.05, 0.05, s * 0.85 + (i - 1) * 0.16, 0.71, 1.2, [0xff6fae, 0xffd93b, 0xb48cff][i]);
  }
  vb.rbox(2.4, 0.12, 0.8, 0, 0.06, 1.5, WOOD, 0.04);                        // porch
  for (const s of [-1, 1]) vb.cyl(0.05, 0.05, 1.1, s * 1.1, 0.6, 1.85, 0xffffff);
  vb.rbox(2.5, 0.08, 0.9, 0, 1.18, 1.5, 0xd8473a, 0.03);                    // porch roof
  g.add(vb.mesh());
  for (const s of [-1, 1]) torch(g, s * 0.75, 3.3, 0.75);                    // torches along the path
}
// red barn with white trim, a hayloft and hay bales
function buildBarn(g) {
  const vb = new VB(0.45);
  vb.rbox(2.6, 2.0, 2.8, 0, 1.0, 0, 0xc9473a, 0.08);
  vb.roof(3.0, 3.0, 0.75, 0, 2.0 + 3.0 / Math.sqrt(3) / 2 * 0.75, 0, 0x6e3a3a);
  vb.rbox(1.1, 1.3, 0.06, 0, 0.65, 1.42, 0xa8352c, 0.04);                   // big door
  for (const s of [-1, 1]) vb.rbox(0.08, 1.6, 0.04, 0, 0.65, 1.46, 0xffffff, 0.02, 0, 0, s * 0.7);   // the X
  vb.rbox(1.2, 0.08, 0.05, 0, 1.32, 1.45, 0xffffff, 0.02);
  vb.rbox(0.6, 0.5, 0.06, 0, 1.75, 1.42, 0x5a2a24, 0.05);                   // hayloft
  vb.cyl(0.26, 0.26, 0.5, -1.7, 0.26, 1.6, 0xe8c45c, Math.PI / 2, 0, 0);
  vb.cyl(0.26, 0.26, 0.5, -1.6, 0.72, 1.6, 0xe8c45c, Math.PI / 2, 0, 0);
  g.add(vb.mesh());
}
function buildFlowers(g) {   // the sunflower patch: three rows of three
  const vb = new VB(0.45);
  vb.rbox(1.4, 0.04, 1.4, 0, 0.01, 0, 0x8a6a3c, 0.2);
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 0.45 + rand(-0.06, 0.06), z = (Math.floor(i / 3) - 1) * 0.45;
    vb.cyl(0.02, 0.02, 0.55, x, 0.28, z, 0x3f8f2f);
    vb.cyl(0.13, 0.13, 0.04, x, 0.6, z + 0.02, 0xffc21a, Math.PI / 2, 0, 0);
    vb.cyl(0.06, 0.06, 0.05, x, 0.6, z + 0.04, 0x7a4a1c, Math.PI / 2, 0, 0);
  }
  g.add(vb.mesh());
}
function buildMailbox(g) {
  const vb = new VB(0.45);
  vb.cyl(0.04, 0.04, 0.8, 0, 0.4, 0, 0x9c6b3c);
  vb.rbox(0.36, 0.26, 0.24, 0, 0.9, 0, 0x5bb4ff, 0.1);
  vb.rbox(0.05, 0.16, 0.04, 0.2, 1.0, 0, 0xff4b4b, 0.02);
  g.add(vb.mesh());
}
// ---------- decorations ----------
function buildScarecrow(g) {   // straw hat, patched red shirt, a crow on one arm
  const vb = new VB(0.6), WOOD = 0x9c6b3c, STRAW = 0xe8c45c, SHIRT = 0xd8473a;
  vb.cyl(0.05, 0.06, 1.5, 0, 0.75, -0.05, WOOD);
  vb.cyl(0.04, 0.04, 1.3, 0, 1.18, -0.05, WOOD, 0, 0, Math.PI / 2);
  vb.rbox(0.46, 0.32, 0.26, 0, 0.72, 0, 0x3e6fd8, 0.08);                   // overalls
  vb.rbox(0.5, 0.42, 0.28, 0, 1.08, 0, SHIRT, 0.1);
  vb.rbox(0.14, 0.14, 0.03, 0.1, 1.0, 0.145, 0xffd23f, 0.03);              // a patch
  vb.cyl(0.09, 0.09, 1.0, 0, 1.18, 0, SHIRT, 0, 0, Math.PI / 2);          // sleeves
  for (const s of [-1, 1]) {
    vb.cone(0.07, 0.14, s * 0.56, 1.18, 0, STRAW, 0, 0, -s * Math.PI / 2);   // straw hands
    vb.cone(0.05, 0.14, s * 0.12, 0.52, 0.02, STRAW, Math.PI, 0, 0);         // straw feet
    vb.ball(0.025, 0.025, 0.015, s * 0.07, 1.53, 0.18, 0x3a2442);            // button eyes
  }
  vb.ball(0.2, 0.2, 0.19, 0, 1.48, 0, 0xf0dca0);                            // sack head
  vb.torus(0.06, 0.012, Math.PI, 0, 1.44, 0.18, 0x3a2442, 0, 0, Math.PI);   // stitched smile
  vb.cone(0.035, 0.08, 0, 1.49, 0.21, 0xff8a2a, Math.PI / 2, 0, 0);          // carrot nose
  vb.cyl(0.36, 0.36, 0.03, 0, 1.64, 0, STRAW);                              // hat
  vb.cyl(0.16, 0.2, 0.22, 0, 1.76, 0, STRAW);
  vb.cyl(0.205, 0.205, 0.05, 0, 1.69, 0, SHIRT);
  vb.ball(0.08, 0.07, 0.11, 0.42, 1.33, 0, 0x2b2b38);                       // the crow
  vb.ball(0.055, 0.055, 0.055, 0.42, 1.43, 0.07, 0x2b2b38);
  vb.cone(0.02, 0.06, 0.42, 1.42, 0.14, 0xffb000, Math.PI / 2, 0, 0);
  vb.ball(0.012, 0.012, 0.01, 0.45, 1.45, 0.11, 0xffffff);
  g.add(vb.mesh());
}
// A wooden A-frame, tall enough for a hopper to sit under, with a pink seat on two ropes.
// It sways a little on its own and swings properly with someone on it.
const SWING_TOP = 2.3, SWING_ROPE = 1.82, SEAT_TOP = -SWING_ROPE + 0.005;   // the seat's top, below the bar
function buildSwing(g) {
  const vb = new VB(0.6), WOOD = 0x9c6b3c, spread = 0.75, leg = Math.hypot(SWING_TOP, spread), lean = Math.atan2(spread, SWING_TOP);
  vb.cyl(0.06, 0.06, 2.1, 0, SWING_TOP, 0, WOOD, 0, 0, Math.PI / 2);
  for (const x of [-0.95, 0.95]) for (const sz of [-1, 1]) vb.cyl(0.05, 0.05, leg, x, SWING_TOP / 2, sz * spread / 2, WOOD, -sz * lean, 0, 0);
  g.add(vb.mesh());
  const sv = new VB(0.6);
  for (const x of [-0.36, 0.36]) sv.cyl(0.012, 0.012, SWING_ROPE, x, -SWING_ROPE / 2, 0, 0xf4ead8);
  sv.rbox(0.86, 0.07, 0.36, 0, -SWING_ROPE - 0.03, 0, 0xff7fb8, 0.03);
  const seat = sv.mesh();
  seat.position.y = SWING_TOP;
  g.add(seat);
  g.userData.seat = seat;
  let swing = 0;
  return t => {
    const on = farm.swingSitter?.sit;
    swing += ((on?.leaving ? 0.62 : on ? 0.36 : 0.1) - swing) * (on?.leaving ? 0.05 : 0.02);   // eases up to a real swing with someone on it, and higher to jump off
    seat.rotation.x = Math.sin(t * 1.7) * swing;
  };
}

// A price bubble floating over a plot: a sunflower and how many it takes to build.
// It always faces the camera and gets no ink outline.
function costTag(g, n, x, y, z) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const font = '600 80px Fredoka, system-ui, sans-serif';
  const paint = () => {
    const k = c.getContext('2d');
    k.clearRect(0, 0, c.width, c.height);
    k.beginPath();
    k.roundRect(6, 6, 244, 116, 58);
    k.fillStyle = '#fff4e0';
    k.fill();
    k.lineWidth = 7;
    k.strokeStyle = '#3a2442';
    k.stroke();
    for (let i = 0; i < 10; i++) {                       // the sunflower: petals, then the middle
      const a = i * Math.PI / 5;
      k.beginPath();
      k.ellipse(78 + Math.cos(a) * 22, 64 + Math.sin(a) * 22, 15, 9, a, 0, Math.PI * 2);
      k.fillStyle = i % 2 ? '#ffcc1a' : '#ffb000';
      k.fill();
    }
    k.beginPath();
    k.arc(78, 64, 16, 0, Math.PI * 2);
    k.fillStyle = '#7a4a1c';
    k.fill();
    k.font = font;
    k.fillStyle = '#3a2442';
    k.textAlign = 'center';
    k.textBaseline = 'middle';
    k.fillText(n, 170, 70);
    tex.needsUpdate = true;
  };
  paint();
  document.fonts?.load(font).then(paint, () => {});   // again once the game's font is in
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  tag.scale.set(1.5, 0.75, 1);
  tag.position.set(x, y, z);
  tag.layers.set(GLOW_LAYER);
  tag.userData.tag = true;
  g.add(tag);
}
// Takes down a plot or building's meshes before it's built again.
function clearPiece(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.geometry?.dispose();
    if (c.userData.tag) { c.material.map.dispose(); c.material.dispose(); }
  }
}

// The Big Jam Stage is the same stage a third bigger (everything on it too), with
// footlights along the front, speaker stacks and a gold edge.
const BIG_STAGE = 1.35;
function stageK() { return farm.stageBuilt && ownedDecor.has('bigstage') ? BIG_STAGE : 1; }
function buildStage() {
  const g = farm.stage;
  if (!g) return;
  clearPiece(g);
  g.scale.setScalar(stageK());
  const v = new VB(0.6), WOOD = 0x9c6b3c, WOOD_D = 0x7a4f2c, CURTAIN = 0x7d58d6, CURTAIN_L = 0x9b74ee;
  if (!farm.stageBuilt) {                                                     // a plot with a sign that has a music note on it
    v.rbox(2.3, 0.05, 1.8, 0, 0, 0, 0xc9a06a, 0.2);
    for (const [x, z] of [[-1.1, -0.85], [1.1, -0.85], [1.1, 0.85], [-1.1, 0.85]]) {
      v.cyl(0.03, 0.03, 0.42, x, 0.21, z, 0xf4ead8);
      v.ball(0.045, 0.03, 0.045, x, 0.43, z, 0xbd96ff);
    }
    v.cyl(0.03, 0.03, 0.7, 0, 0.35, 0.5, WOOD);
    v.rbox(0.56, 0.4, 0.05, 0, 0.75, 0.52, 0xf4ead8, 0.05);
    v.ball(0.07, 0.055, 0.03, -0.05, 0.66, 0.56, 0x3a2442);                   // a note: head, stem, flag
    v.rbox(0.02, 0.24, 0.02, 0.01, 0.78, 0.56, 0x3a2442, 0.005);
    v.rbox(0.09, 0.03, 0.02, 0.05, 0.88, 0.56, 0x3a2442, 0.005, 0, 0, -0.5);
    g.add(v.mesh());
    costTag(g, STAGE_COST, 0, 1.55, 0.5);
    return;
  }
  v.rbox(2.4, 0.3, 1.8, 0, 0.15, 0, WOOD, 0.05);                              // the stage floor
  for (let i = -3; i <= 3; i++) v.rbox(0.02, 0.01, 1.78, i * 0.33, 0.305, 0, WOOD_D, 0.005);
  v.rbox(0.8, 0.15, 0.32, 0, 0.075, 1.02, WOOD_D, 0.04);                       // step up
  v.rbox(2.4, 1.5, 0.12, 0, 1.05, -0.85, CURTAIN, 0.04);                       // curtain at the back, in folds
  for (let i = 0; i < 9; i++) v.cyl(0.11, 0.11, 1.45, -1.05 + i * 0.26, 1.03, -0.76, i % 2 ? CURTAIN : CURTAIN_L);
  v.rbox(1.5, 0.36, 0.08, 0, 1.92, -0.74, 0xfff1d8, 0.08);                     // a sign over the stage, with stars
  for (const s of [-1, 1]) {
    v.cyl(0.05, 0.05, 1.8, s * 1.13, 1.1, 0.82, WOOD_D);                       // front posts
    v.rbox(0.38, 0.55, 0.32, s * 0.82, 0.58, -0.4, 0x3a2f45, 0.05);            // speakers
    v.cyl(0.12, 0.12, 0.03, s * 0.82, 0.5, -0.23, 0x1d1626, Math.PI / 2, 0, 0);
    v.cyl(0.06, 0.06, 0.03, s * 0.82, 0.73, -0.23, 0x1d1626, Math.PI / 2, 0, 0);
  }
  // The lights: bulbs strung between the posts and the four on the sign. Unlit, so
  // they keep their colours, and after dark each one glows softly in its own colour.
  const bulbs = new VB(0.6), lit = [];
  for (let i = 0; i <= 10; i++) {
    const x = -1.13 + i * 0.226, y = 1.95 - Math.sin(i / 10 * Math.PI) * 0.22, c = [0xffd24a, 0xff7fb8, 0x7fd0ff, 0x7ad653][i % 4];
    bulbs.ball(0.045, 0.06, 0.045, x, y, 0.82, c);
    lit.push([x, y, 0.82, c, 0.46]);
  }
  [[-0.5, 0xff7fb8], [-0.17, 0x7fd0ff], [0.17, 0xffd24a], [0.5, 0x7ad653]].forEach(([x, c]) => { bulbs.ball(0.07, 0.07, 0.03, x, 1.92, -0.69, c); lit.push([x, 1.92, -0.66, c, 0.42]); });
  const glow = bulbs.mesh(MARKER_MAT);
  glow.castShadow = false;
  glow.layers.set(GLOW_LAYER);
  g.add(glow);
  for (const [x, y, z, c, size] of lit) glowAt(g, x, y, z, c, size);
  // Stage lighting: a spotlight on top of each front post, crossing to light the middle
  // of the stage. After dark their beams show and plain white light falls where they
  // land, and softly over the curtain, so a performer stands in the light.
  for (const sx of [-1, 1]) {
    const from = new THREE.Vector3(sx * 1.13, 2.05, 0.82), to = new THREE.Vector3(-sx * 0.3, 0.3, 0.05);
    const dir = from.clone().sub(to).normalize(), can = new THREE.Mesh(CAN_GEO, CAN_MAT);
    can.position.copy(from).addScaledVector(dir, -0.06);
    can.quaternion.setFromUnitVectors(_up, dir);
    can.castShadow = true;
    g.add(can);
    const len = from.distanceTo(to), b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.42, len, 18, 1, true), BEAM_MAT);
    b.position.copy(from).add(to).multiplyScalar(0.5);
    b.quaternion.setFromUnitVectors(_up, dir);   // the narrow end at the light
    b.layers.set(GLOW_LAYER);
    g.add(b);
    const o = new THREE.Object3D();
    o.position.copy(to);
    g.add(o);
    lamps.push({ o, r: 0.9 * stageK(), s: 1, w: -1, y: 0.4 * stageK() });
  }
  const back = new THREE.Object3D();
  back.position.set(0, 1, -0.7);
  g.add(back);
  lamps.push({ o: back, r: 1.25 * stageK(), s: 0.55, w: -1, y: stageK() });
  if (stageK() > 1) {
    const x = new VB(0.6), foot = new VB(0.6);
    x.rbox(2.44, 0.05, 0.05, 0, 0.29, 0.9, 0xe8c45c, 0.02);                    // a gold edge along the front
    for (const s of [-1, 1]) {
      x.rbox(0.36, 0.45, 0.3, s * 0.82, 1.08, -0.4, 0x3a2f45, 0.05);           // a second speaker on each
      x.cyl(0.1, 0.1, 0.03, s * 0.82, 1.08, -0.24, 0x1d1626, Math.PI / 2, 0, 0);
    }
    for (let i = 0; i < 7; i++) {                                               // footlights
      const fx = -0.9 + i * 0.3;
      x.rbox(0.12, 0.06, 0.08, fx, 0.33, 0.84, 0x2b2233, 0.02);
      foot.ball(0.035, 0.03, 0.02, fx, 0.35, 0.885, 0xfff1c4);
      glowAt(g, fx, 0.36, 0.9, 0xfff1c4, 0.22);
    }
    g.add(x.mesh());
    const fm = foot.mesh(MARKER_MAT);
    fm.castShadow = false;
    fm.layers.set(GLOW_LAYER);
    g.add(fm);
  }
  v.cyl(0.015, 0.015, 0.9, 0.4, 0.75, 0.35, 0x9aa0a6);                        // a mic on a stand
  v.cyl(0.12, 0.14, 0.03, 0.4, 0.31, 0.35, 0x9aa0a6);
  v.ball(0.05, 0.065, 0.05, 0.4, 1.23, 0.35, 0x3a2f45);
  g.add(v.mesh());
  if (ownedDecor.has('drums')) {   // the drum kit, at the back of the stage between the speakers
    const kit = new THREE.Group();
    buildDrumKit(kit);
    kit.position.set(-0.15, 0.3, -0.3);
    kit.scale.setScalar(0.85);
    g.add(kit);
  }
  farm.disco = farm.discoDots = null;
  if (ownedDecor.has('disco')) {   // the disco ball, turning on top of the sign, and its specks of light after dark
    const ball = new THREE.Group();
    buildDiscoBall(ball);
    ball.position.set(0, 1.85, -0.72);   // clear of whoever's performing
    g.add(ball);
    farm.disco = ball;
    glowAt(g, 0, 2.4, -0.68, 0xf4f8ff, 0.75);
    farm.discoDots = Array.from({ length: 18 }, (_, i) => {
      const m = new THREE.Mesh(DOT_GEO, new THREE.MeshBasicMaterial({ color: [0xffffff, 0xffc8ec, 0xc8ecff, 0xfff1b8][i % 4] }));
      m.layers.set(GLOW_LAYER);
      m.rotation.x = -Math.PI / 2;
      m.userData = { a: i * 2.4, r: 0.35 + (i * 0.37) % 2 };
      g.add(m);
      return m;
    });
  }
}
// For the shop: a little Big Jam Stage, with its sign, footlights and speaker stacks.
function buildBigStageIcon(g) {
  const v = new VB(0.6), WOOD = 0x9c6b3c;
  v.rbox(2.6, 0.3, 1.6, 0, 0.15, 0, WOOD, 0.05);
  v.rbox(2.64, 0.05, 0.05, 0, 0.29, 0.8, 0xe8c45c, 0.02);
  v.rbox(2.6, 1.4, 0.12, 0, 1.0, -0.74, 0x7d58d6, 0.04);
  for (let i = 0; i < 9; i++) v.cyl(0.1, 0.1, 1.35, -1.15 + i * 0.29, 0.98, -0.66, i % 2 ? 0x7d58d6 : 0x9b74ee);
  v.rbox(1.6, 0.36, 0.08, 0, 1.85, -0.64, 0xfff1d8, 0.08);
  [[-0.5, 0xff7fb8], [-0.17, 0x7fd0ff], [0.17, 0xffd24a], [0.5, 0x7ad653]].forEach(([x, c]) => v.ball(0.07, 0.07, 0.03, x, 1.85, -0.59, c));
  for (const s of [-1, 1]) for (const y of [0.55, 1.0]) v.rbox(0.36, 0.42, 0.3, s * 0.9, y, -0.3, 0x3a2f45, 0.05);
  for (let i = 0; i < 7; i++) v.ball(0.04, 0.035, 0.03, -0.9 + i * 0.3, 0.34, 0.78, 0xfff1c4);
  const m = v.mesh();
  m.scale.setScalar(0.78);
  g.add(m);
}
// A mirrored disco ball: little silver tiles all over, a few catching colour, on a stand.
function buildDiscoBall(g) {
  const v = new VB(0.6), R = 0.2;
  v.ball(R * 0.95, R * 0.95, R * 0.95, 0, 0.55, 0, 0x6a7280);
  for (let i = 1; i < 8; i++) {
    const th = i / 8 * Math.PI, n = Math.max(4, Math.round(16 * Math.sin(th)));
    for (let j = 0; j < n; j++) {
      const ph = (j + (i % 2) * 0.5) / n * Math.PI * 2, x = Math.sin(th) * Math.cos(ph) * R, z = Math.sin(th) * Math.sin(ph) * R;
      const c = (i * 7 + j * 3) % 11 === 0 ? pick([0xffc8ec, 0xc8ecff, 0xfff1b8]) : [0xe8edf3, 0xc4ccd6, 0xf8fbff, 0xaab4c2][(i + j) % 4];
      v.box(0.07, 0.07, 0.07, x, 0.55 + Math.cos(th) * R, z, c, th, -ph, 0);
    }
  }
  v.cyl(0.025, 0.035, 0.2, 0, 0.27, 0, 0x9aa0a6);   // the stand it turns on
  v.cyl(0.08, 0.09, 0.04, 0, 0.17, 0, 0x6a7280);
  g.add(v.mesh());
}
const DOT_GEO = new THREE.CircleGeometry(0.045, 8);
// A light's own glow: a soft dot of its colour, added on top, that fades in after dark.
// One material per colour, shared, so they all brighten together.
const GLOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const k = c.getContext('2d'), gr = k.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.fillStyle = gr;
  k.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const GLOW_MATS = new Map();
const _up = new THREE.Vector3(0, 1, 0);
const CAN_GEO = new THREE.CylinderGeometry(0.07, 0.1, 0.16, 12), CAN_MAT = new THREE.MeshLambertMaterial({ color: 0x2b2233 });
// A spotlight's beam: brightest at the light, fading toward the boards.
const BEAM_MAT = new THREE.MeshBasicMaterial({
  map: (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const k = c.getContext('2d'), gr = k.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0.12)');
    k.fillStyle = gr;
    k.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })(),
  color: 0xfff6e6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
function glowAt(g, x, y, z, color, size) {
  if (!GLOW_MATS.has(color)) GLOW_MATS.set(color, new THREE.SpriteMaterial({ map: GLOW_TEX, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  const sp = new THREE.Sprite(GLOW_MATS.get(color));
  sp.position.set(x, y, z);
  sp.scale.setScalar(size);
  sp.layers.set(GLOW_LAYER);
  g.add(sp);
}
// The lights glow after dark; the disco ball turns, and its specks of light sweep over
// the boards and the grass.
function stageTick(t) {
  const k = nightK();
  for (const m of GLOW_MATS.values()) { m.opacity = k; m.visible = k > 0.02; }
  BEAM_MAT.opacity = 0.16 * k;
  BEAM_MAT.visible = k > 0.02;
  if (!farm.disco) return;
  farm.disco.rotation.y = t * 0.8;
  const on = nightK() > 0.05;
  for (const m of farm.discoDots) {
    const a = m.userData.a + t * 0.8, x = Math.cos(a) * m.userData.r * 1.1, z = 0.4 + Math.sin(a) * m.userData.r;
    m.visible = on && z > -0.7;
    m.position.set(x, Math.abs(x) < 1.18 && z < 0.88 ? 0.315 : 0.02, z);   // on the stage floor, or down on the grass
  }
}
// A little red drum kit: bass drum with a star on it, snare, a tom, hi-hat and a crash.
function buildDrumKit(g) {
  const v = new VB(0.6), RED = 0xd8473a, HEAD = 0xfff4e0, METAL = 0x9aa0a6, BRASS = 0xe8c45c;
  v.cyl(0.32, 0.32, 0.3, 0, 0.33, 0, RED, Math.PI / 2, 0, 0);                  // bass drum, facing out
  v.cyl(0.29, 0.29, 0.02, 0, 0.33, 0.155, HEAD, Math.PI / 2, 0, 0);
  v.torus(0.31, 0.022, Math.PI * 2, 0, 0.33, 0.16, 0xf4ead8);
  v.ball(0.07, 0.07, 0.02, 0, 0.33, 0.17, 0xffd24a);
  v.cyl(0.13, 0.13, 0.13, -0.12, 0.74, 0.04, RED, 0.45, 0, 0);                 // a tom on top
  v.cyl(0.12, 0.12, 0.01, -0.12, 0.8, 0.07, HEAD, 0.45, 0, 0);
  v.cyl(0.016, 0.016, 0.5, 0.42, 0.25, 0.18, METAL);                          // snare on its stand
  v.cyl(0.16, 0.16, 0.12, 0.42, 0.53, 0.18, 0xf4ead8);
  v.cyl(0.155, 0.155, 0.01, 0.42, 0.595, 0.18, HEAD);
  v.cyl(0.016, 0.016, 0.85, -0.46, 0.43, 0.16, METAL);                        // hi-hat
  v.cyl(0.18, 0.18, 0.012, -0.46, 0.85, 0.16, BRASS);
  v.cyl(0.18, 0.18, 0.012, -0.46, 0.83, 0.16, BRASS);
  v.cyl(0.016, 0.016, 1.05, 0.38, 0.52, -0.2, METAL);                         // crash cymbal, tipped toward you
  v.cyl(0.24, 0.24, 0.012, 0.38, 1.05, -0.2, BRASS, 0.3, 0, 0);
  g.add(v.mesh());
}

function buildBunk() {
  const g = farm.bunk;
  if (!g) return;
  clearPiece(g);
  const v = new VB(0.6);
  const LOG = 0xc98a4b, LOG_D = 0xa86c34, END = 0xf0c48a, WOOD = 0x8a5a33;
  if (!farm.bunkBuilt) {                                                     // a plot: dirt, stakes and string, a pile of logs
    v.rbox(1.9, 0.05, 1.5, 0, 0.0, 0, 0xc9a06a, 0.2);
    for (const [x, z] of [[-0.9, -0.7], [0.9, -0.7], [0.9, 0.7], [-0.9, 0.7]]) {
      v.cyl(0.03, 0.03, 0.42, x, 0.21, z, 0xf4ead8);
      v.ball(0.045, 0.03, 0.045, x, 0.43, z, 0xff7a3c);
    }
    for (const [x, z, len, ry] of [[0, -0.7, 1.8, 0], [0, 0.7, 1.8, 0], [-0.9, 0, 1.4, Math.PI / 2], [0.9, 0, 1.4, Math.PI / 2]])
      v.cyl(0.008, 0.008, len, x, 0.36, z, 0xff7a3c, 0, ry, Math.PI / 2);   // string between the stakes
    for (const [x, y, z] of [[-0.3, 0.1, 0.1], [-0.3, 0.1, -0.12], [-0.3, 0.28, -0.01]]) {     // log pile
      v.cyl(0.1, 0.1, 0.9, x, y, z, LOG, 0, 0, Math.PI / 2);
      for (const sx of [-1, 1]) v.cyl(0.085, 0.085, 0.01, x + sx * 0.455, y, z, END, 0, 0, Math.PI / 2);
    }
    v.cyl(0.03, 0.03, 0.7, 0.5, 0.35, 0.45, WOOD);                           // a sign with a sunflower on it
    v.rbox(0.5, 0.34, 0.05, 0.5, 0.72, 0.47, 0xf4ead8, 0.04);
    v.cyl(0.09, 0.09, 0.03, 0.5, 0.72, 0.51, 0xffc21a, Math.PI / 2, 0, 0);
    v.cyl(0.04, 0.04, 0.035, 0.5, 0.72, 0.52, 0x7a4a1c, Math.PI / 2, 0, 0);
    g.add(v.mesh());
    costTag(g, BUNK_COST, 0.5, 1.5, 0.45);
    return;
  }
  const W = 1.8, D = 1.4, H = 1.0, r = 0.09;
  v.rbox(W + 0.16, 0.12, D + 0.16, 0, 0.06, 0, 0xb4babf, 0.05);              // stone footing
  const logs = Math.round(H / (r * 2));
  for (let i = 0; i < logs; i++) {                                           // stacked log walls, ends crossing at the corners
    const y = 0.12 + r + i * r * 2, c = i % 2 ? LOG : LOG_D;
    for (const sz of [-1, 1]) v.cyl(r, r, W + 0.24, 0, y, sz * D / 2, c, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) v.cyl(r, r, D + 0.24, sx * W / 2, y + r * 0.5, 0, i % 2 ? LOG_D : LOG, Math.PI / 2, 0, 0);
  }
  v.rbox(W - 0.1, H, D - 0.1, 0, 0.12 + H / 2, 0, LOG_D, 0.02);             // fills the gaps between logs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < logs; i++)
    v.cyl(r * 0.8, r * 0.8, 0.02, sx * (W / 2 + 0.121), 0.12 + r + i * r * 2, sz * D / 2, END, 0, 0, Math.PI / 2);   // cut log ends
  const top = 0.12 + logs * r * 2;
  v.roof(D + 0.5, W + 0.5, 0.72, 0, top + (D + 0.5) / Math.sqrt(3) / 2 * 0.72, 0, 0x5fb84a);
  v.add(prim('roofRidge', () => new THREE.CylinderGeometry(0.06, 0.06, 1, 10)), 0x3f8f2f, 0, top + (D + 0.5) / Math.sqrt(3) * 0.72 * 1.45, 0, 0, 0, Math.PI / 2, 1, W + 0.55, 1);
  v.rbox(0.42, 0.66, 0.06, -0.3, 0.45, D / 2 + 0.09, WOOD, 0.05);           // door
  v.ball(0.03, 0.03, 0.025, -0.17, 0.45, D / 2 + 0.13, 0xffd23f);
  v.cyl(0.17, 0.17, 0.05, 0.42, 0.66, D / 2 + 0.09, 0xfff1d8, Math.PI / 2, 0, 0);   // round window
  v.cyl(0.13, 0.13, 0.06, 0.42, 0.66, D / 2 + 0.1, 0xffe08a, Math.PI / 2, 0, 0);
  v.rbox(0.03, 0.26, 0.03, 0.42, 0.66, D / 2 + 0.13, WOOD, 0.01);
  v.rbox(0.26, 0.03, 0.03, 0.42, 0.66, D / 2 + 0.13, WOOD, 0.01);
  v.rbox(0.36, 0.12, 0.14, 0.42, 0.42, D / 2 + 0.16, WOOD, 0.03);          // flower box
  for (let i = 0; i < 3; i++) v.ball(0.045, 0.045, 0.045, 0.3 + i * 0.12, 0.5, D / 2 + 0.18, [0xff8a2a, 0xffd93b, 0xff6fae][i]);
  v.rbox(0.3, 0.8, 0.3, -0.55, top + 0.45, -0.25, 0x9aa0a6, 0.06);          // stone chimney
  v.rbox(0.9, 0.22, 0.06, 0, top - 0.05, D / 2 + 0.11, 0xf4ead8, 0.05);     // name board over the door
  for (let i = 0; i < 3; i++) v.ball(0.035, 0.035, 0.02, -0.18 + i * 0.18, top - 0.05, D / 2 + 0.15, [0xff7fb8, 0x5bb4ff, 0x6bd864][i]);
  v.rbox(0.9, 0.06, 0.5, -0.3, 0.03, D / 2 + 0.36, WOOD, 0.02);            // doorstep
  g.add(v.mesh());
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
// ---------- fish you can catch ----------
// Each Fish Pond level lets new kinds in (lvl). rhy = how tricky its rhythm is to
// reel in, 1 (taps right on the beat) to 9 (runs of sixteenths): a new pond level can
// bring an easy fish as well as a hard one. w = how often it bites compared with the
// others, cm = smallest and biggest, price = sunflowers it sells for, wiggle = how
// hard it fights on the line, night = only bites after dark.
const FISH = [
  { id: 'minnow', lvl: 1, rhy: 1, w: 10, cm: [4, 9], price: 1, wiggle: 0.6, col: [0xa9b8c4, 0xe8eef2], shape: { long: 0.85, tall: 0.75 } },
  { id: 'guppy', lvl: 1, rhy: 1, w: 8, cm: [2, 5], price: 1, wiggle: 0.5, col: [0x7fd0ff, 0xff7fb8], shape: { long: 0.7, tall: 0.85, fan: true } },
  { id: 'bluegill', lvl: 1, rhy: 2, w: 8, cm: [10, 22], price: 2, wiggle: 0.9, col: [0x4f7fc4, 0xffb347], shape: { tall: 1.25 } },
  { id: 'boot', lvl: 1, rhy: 1, w: 3, cm: [24, 30], price: 0, wiggle: 0.3 },
  { id: 'pumpkinseed', lvl: 2, rhy: 1, w: 6, cm: [8, 18], price: 2, wiggle: 0.8, col: [0x5fb89a, 0xff9a3c], shape: { tall: 1.35, long: 0.9 } },
  { id: 'goldfish', lvl: 2, rhy: 3, w: 6, cm: [6, 15], price: 3, wiggle: 1.1, col: [0xff9a2a, 0xffd23f] },
  { id: 'crappie', lvl: 3, rhy: 2, w: 5, cm: [12, 28], price: 3, wiggle: 1, col: [0x9aa6b4, 0xeef0f2], shape: { tall: 1.15, stripes: 0x5a6470 } },
  { id: 'perch', lvl: 3, rhy: 4, w: 5, cm: [15, 30], price: 4, wiggle: 1.3, col: [0xb8d050, 0xf2e6b0], shape: { stripes: 0x4a6a24 } },
  { id: 'glowfin', lvl: 3, rhy: 3, w: 4, cm: [8, 16], price: 6, wiggle: 1.2, col: [0x3fe0d0, 0xc8fff4], shape: { long: 0.85, glow: true }, night: true },
  { id: 'carp', lvl: 4, rhy: 2, w: 4, cm: [30, 70], price: 5, wiggle: 1.2, col: [0xb08a3c, 0xe8d49a], shape: { long: 1.2, tall: 0.95, whiskers: true } },
  { id: 'koi', lvl: 4, rhy: 5, w: 4, cm: [30, 60], price: 6, wiggle: 1.5, col: [0xffffff, 0xff6a2a], shape: { koi: true, long: 1.1 } },
  { id: 'bass', lvl: 5, rhy: 4, w: 3, cm: [25, 55], price: 7, wiggle: 1.6, col: [0x6f9a4a, 0xe6eac8], shape: { long: 1.1, stripes: 0x3f5a2a } },
  { id: 'catfish', lvl: 5, rhy: 6, w: 3, cm: [40, 90], price: 8, wiggle: 1.7, col: [0x6e6258, 0xd8c8a8], shape: { long: 1.15, tall: 0.8, whiskers: true } },
  { id: 'eel', lvl: 6, rhy: 5, w: 2.5, cm: [40, 100], price: 12, wiggle: 2.1, col: [0x4a5a3a, 0xc8c89a], shape: { long: 1.9, tall: 0.42 }, night: true },
  { id: 'trout', lvl: 6, rhy: 7, w: 3, cm: [25, 55], price: 10, wiggle: 2, col: [0x7fa8a0, 0xff7fb8], shape: { trout: true, long: 1.1 } },
  { id: 'lanternfish', lvl: 7, rhy: 6, w: 2, cm: [10, 25], price: 16, wiggle: 2.2, col: [0x2f3f7a, 0x8fa8e6], shape: { tall: 1.1, lure: true }, night: true },
  { id: 'pike', lvl: 7, rhy: 7, w: 2, cm: [50, 100], price: 14, wiggle: 2.3, col: [0x6f8a3a, 0xece4b0], shape: { long: 1.4, tall: 0.65 } },
  { id: 'goldkoi', lvl: 8, rhy: 8, w: 1.2, cm: [40, 70], price: 20, wiggle: 2.6, col: [0xffd23f, 0xfff4e0], shape: { koi: true, long: 1.1 } },
  { id: 'moonfish', lvl: 9, rhy: 9, w: 0.8, cm: [20, 40], price: 30, wiggle: 2.9, col: [0xbd96ff, 0xdff3ff], shape: { long: 0.8, tall: 1.5 } },
  { id: 'sturgeon', lvl: 10, rhy: 7, w: 1, cm: [80, 180], price: 24, wiggle: 2.7, col: [0x7a8590, 0xd8dde2], shape: { long: 1.6, tall: 0.7, whiskers: true, stripes: 0xe8ecef } },
  { id: 'rainbowkoi', lvl: 11, rhy: 8, w: 0.8, cm: [40, 75], price: 28, wiggle: 2.8, col: [0xff7fb8, 0x7fd0ff], shape: { koi: true, long: 1.1 } },
  { id: 'ghostfish', lvl: 12, rhy: 9, w: 0.6, cm: [20, 45], price: 36, wiggle: 3, col: [0xe6e0ff, 0xffffff], shape: { long: 1.05, tall: 1.1, glow: true }, night: true },
];
// A fish side on, nose toward +x, about a unit long and centred half a unit up
// (for the Fish Book's pictures and the catch cards).
function fishModel(sp) {
  const v = new VB(1);
  if (sp.id === 'boot') {
    const LEATHER = 0x8a5a33;
    v.rbox(0.36, 0.6, 0.3, -0.16, 0.62, 0, LEATHER, 0.1);                       // the leg
    v.rbox(0.72, 0.26, 0.32, 0.04, 0.3, 0, LEATHER, 0.1);                       // the foot
    v.rbox(0.76, 0.07, 0.34, 0.04, 0.16, 0, 0x4a3020, 0.03);                    // the sole
    v.cyl(0.13, 0.13, 0.04, -0.16, 0.92, 0, 0x4a3020);                          // the way in
    for (let i = 0; i < 3; i++) v.rbox(0.18, 0.03, 0.02, -0.02, 0.5 - i * 0.09, 0.16, 0xf4ead8, 0.01, 0, 0, 0.3);   // laces
    v.ball(0.07, 0.03, 0.07, 0.22, 0.45, 0.05, 0x5fb84a);                       // a bit of pond weed
    return { group: v.mesh() };
  }
  const [a, b] = sp.col, s = sp.shape || {}, L = s.long || 1, H = s.tall || 1;
  const skin = (x, y, z) => {
    if (s.koi) return Math.sin(x * 9 + 1) * Math.cos(y * 11 + z * 5) > 0.15 ? b : a;   // patches
    if (s.trout) return Math.abs(y - 0.5) < 0.035 ? b : y < 0.45 ? 0xf2f0e6 : a;         // a pink stripe down the side
    if (s.stripes && y > 0.47 && Math.sin(x * 20) > 0.5) return s.stripes;
    return y < 0.45 ? b : a;                                                              // pale belly
  };
  v.ball(0.42 * L, 0.24 * H, 0.13, 0, 0.5, 0, skin);
  const fin = (x, y, rz, sx, sy) => v.add(prim('fin', () => new THREE.ConeGeometry(1, 1, 12)), a, x, y, 0, 0, 0, rz, sx, sy, 0.035);
  fin(-0.48 * L, 0.5, -Math.PI / 2, (s.fan ? 0.34 : 0.2) * H, s.fan ? 0.38 : 0.3);   // tail (a guppy's is a big fan)
  fin(-0.04 * L, 0.5 + 0.24 * H, 0.2, 0.15, 0.16);                           // back fin
  fin(0.02, 0.38, Math.PI - 0.6, 0.06, 0.12);                                // a little side fin
  for (const z of [-1, 1]) {
    v.ball(0.05, 0.05, 0.03, 0.28 * L, 0.55, z * 0.1, 0xffffff);
    v.ball(0.026, 0.026, 0.02, 0.3 * L, 0.55, z * 0.12, 0x111111);
  }
  if (s.whiskers) for (const z of [-1, 1]) v.cyl(0.008, 0.008, 0.3, 0.46 * L, 0.42, z * 0.08, 0x3a2442, 0, 0, -1.1);
  if (s.lure) {                                                                // a lanternfish's little light on a stalk
    v.cyl(0.01, 0.01, 0.26, 0.24 * L, 0.84, 0, a, 0, 0, -0.6);
    v.ball(0.055, 0.055, 0.055, 0.34 * L, 0.95, 0, 0xfff27a);
  }
  if (s.glow) for (const [x, y] of [[-0.15, 0.6], [0.05, 0.56], [0.18, 0.47], [-0.25, 0.47]]) v.ball(0.03, 0.03, 0.02, x * L, y, 0.12, 0xffffff);   // glowing spots
  return { group: v.mesh() };
}

function buildPond() {
  const g = farm.pond, L = farm.level;
  for (const c of [...g.children]) { g.remove(c); if (c.geometry !== PGEO) c.geometry?.dispose(); }   // PGEO is shared with particles (and a torch's flame is a group)
  farm.fish = []; farm.ducks = [];
  const s = L >= 6 ? 1.3 : 1, rx = 1.7 * s, rz = 1.15 * s;
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
  for (const a of TORCH_AT) torch(g, Math.cos(a) * (rx + 0.5), Math.sin(a) * (rz + 0.45));
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

const _fw = new THREE.Vector3();
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
        f.mesh.getWorldPosition(_fw);
        burst(_fw.x, 0.08, _fw.z, [0xffffff, 0xbfe9ff], 4, 0.5, 2, 0.06, 0.4);
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
    farm.pond.getWorldPosition(_fw);
    burst(_fw.x, 0.65, _fw.z, [0xbfe9ff, 0xffffff], 1, 0.35, 3.2, 0.07, 0.6, true);
  }
  for (const p of Object.values(farm.pieces)) p.update?.(t);
  updateTorches(t);
  stageShows(dt);
  updateWalkers(dt, t);
}

// ---------- shows on the Jam Stage ----------
// Now and then a farm hopper (or two) wanders up onto the Jam Stage and puts on a
// show, bouncing to the beat with notes flying off, and a couple of others come and
// watch from the front. The host runs it; friends' screens see the climb up and down.
const stageY = () => 0.3 * stageK();
const show = { next: rand(20, 40), until: 0, cast: [] };
const stageAt = (lx, lz) => pieceToFarm(farm.pieces.stage, lx * stageK(), lz * stageK());
function stageOut() {   // which way a hopper faces to look out from the stage
  const [x0, z0] = stageAt(0, 0), [x1, z1] = stageAt(0, 1);
  return Math.atan2(-(x1 - x0), -(z1 - z0));
}
function stageShows(dt) {
  if (GUEST) return;
  const live = game.state === 'farm' && farm.stageBuilt && farm.pieces.stage && !decor.on;
  const players = new Set(playerMarks().map(([w]) => w));
  for (const c of show.cast) {   // anyone who's been picked to play, or gone, leaves the show
    if (!farm.walkers.includes(c) || players.has(c) || c.hidden || c.fishing) { leaveShow(c); show.cast = show.cast.filter(o => o !== c); }
  }
  if (show.cast.length) {
    if (!live || game.time > show.until) endShow();
    return;
  }
  if (!live || (show.next -= dt) > 0) return;
  show.next = rand(35, 75);
  const idle = farm.walkers.filter(w => !w.hidden && !players.has(w) && !w.fishing && !w.leap && !w.goal && !w.show && !w.sit && !w.swingGo).sort(() => rnd() - 0.5);
  if (idle.length < 2) return;
  const band = stageK() > 1 && idle.length >= 5 && rnd() < 0.5 ? 3 : idle.length >= 4 && rnd() < 0.4 ? 2 : 1;
  const perf = [[[-0.15, 0.1]], [[-0.45, 0.15], [0.2, 0.05]], [[-0.6, 0.15], [-0.05, 0.05], [0.55, 0.12]]][band - 1];
  const watch = [[-0.75, 2.05 + rand(0, 0.4)], [0.75, 2.05 + rand(0, 0.4)]].slice(0, ri(1, 2));
  // Someone free goes to their spot: waddling if the way is clear, else hopping round
  // whatever's in the way.
  const take = (role, [lx, lz], to) => {
    const [x, z] = stageAt(...to);
    if (x < YARD.x0 || x > YARD.x1 || z < YARD.z0 || z > YARD.z1 || blockedAt(x, z)) return;
    const w = idle.find(o => !o.show && pathClear(o.x, o.z, x, z)) || idle.find(o => !o.show);
    if (!w) return;
    w.show = { role, lx, lz, st: 'go', beat: -1, ph: ri(0, 2), x, z };
    if (pathClear(w.x, w.z, x, z)) {
      w.tx = x; w.tz = z;
      toGuests({ t: 'walk', k: w.key, x: w.x, z: w.z, tx: x, tz: z });
    } else hopToward(w.key, x, z);
    show.cast.push(w);
  };
  for (const p of perf) take('perform', p, [p[0] * 0.5, 1.7]);   // to the foot of the step first
  if (!show.cast.length) return;
  for (const p of watch) take('watch', p, p);
  show.until = game.time + rand(16, 26);
}
function leaveShow(w) {
  if (w.show?.role === 'perform' && (w.y || 0) > 0.05) {   // hop back down to the grass
    const [x, z] = stageAt(w.show.lx * 0.5, 1.7);
    landLeap(w, x, z, 0.35, 0);
    toGuests({ t: 'leap', k: w.key, x, z, up: 0.35, y: 0 });
  }
  w.show = null;
  w.wait = rand(0.8, 2.5);
}
function endShow() {
  for (const w of show.cast) leaveShow(w);
  show.cast = [];
}
// A hopper in the show, standing still: climbing up once at the step, then on each beat.
function showAct(w, t) {
  const s = w.show;
  if (s.st === 'go') {
    if (w.goal || w.leap) return;   // still hopping over
    if (Math.hypot(w.x - s.x, w.z - s.z) > 0.6) { leaveShow(w); show.cast = show.cast.filter(o => o !== w); return; }   // couldn't get there
    if (s.role === 'perform') {
      const [x, z] = stageAt(s.lx, s.lz);
      s.st = 'on';
      landLeap(w, x, z, 0.35, stageY());
      toGuests({ t: 'leap', k: w.key, x, z, up: 0.35, y: stageY() });
    } else s.st = 'on';
    return;
  }
  const beat = Math.floor((music ? music.heard().pos : t) / BEAT);
  if (beat === s.beat) return;
  s.beat = beat;
  const out = stageOut();
  if (s.role === 'perform') {   // bounce on every beat, turning to one side then the other; notes fly off now and then
    w.hop = 0.42;
    w.face = out + (beat % 2 ? 0.35 : -0.35);
    if (beat % 4 === 0) burst(farm.group.position.x + w.x, stageY() + 1, farm.group.position.z + w.z, RAINBOW, 4, 0.6, 2, 0.05, 0.6, true);
  } else {                      // the audience faces the stage and hops along every so often
    w.face = out + Math.PI;
    if ((beat + s.ph) % 3 === 0) w.hop = 0.35;
  }
}

// ---------- hoppers wandering the farm ----------
// Every unlocked hopper strolls around the yard between rounds:
// waddling from spot to spot, pausing to look around. The one you'll play as has a
// sunflower bobbing over its head, and gives a happy hop when picked or back home.
const YARD = { x0: FARM_BOUNDS.x0 + 0.3, x1: FARM_BOUNDS.x1 - 0.3, z0: FARM_BOUNDS.z0 + 0.3, z1: FARM_BOUNDS.z1 - 0.3 };
function blockedAt(x, z) {   // inside any piece (the pond as an oval), with a little room to spare
  for (const p of Object.values(farm.pieces)) {
    const def = PIECES[p.id], a = p.r * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    const dx = x - p.x, dz = z - p.z, lx = dx * c - dz * s, lz = dx * s + dz * c;   // into the piece's own space
    if (def.pond) {
      const [rx, rz] = farm.pondR;
      if ((lx / (rx + 0.45)) ** 2 + (lz / (rz + 0.45)) ** 2 < 1) return true;
      continue;
    }
    const [x0, x1, z0, z1] = def.block || def.foot, m = 0.2;
    if (lx > x0 - m && lx < x1 + m && lz > z0 - m && lz < z1 + m) return true;
  }
  return false;
}
const freeSpot = w => { do { w.x = rand(YARD.x0, YARD.x1); w.z = rand(YARD.z0, YARD.z1); } while (blockedAt(w.x, w.z)); };
// After something moves: anyone now inside it steps out, anyone heading through it stops.
function settleWalkers() {
  for (const w of farm.walkers || []) {
    if (blockedAt(w.x, w.z)) { freeSpot(w); w.tx = w.x; w.tz = w.z; }
    else if (blockedAt(w.tx, w.tz) || !pathClear(w.x, w.z, w.tx, w.tz)) { w.tx = w.x; w.tz = w.z; }
  }
}
function pathClear(ax, az, bx, bz) {
  for (let i = 1; i <= 12; i++) if (blockedAt(lerp(ax, bx, i / 12), lerp(az, bz, i / 12))) return false;
  return true;
}
function nextSpot(w) {
  for (let tries = 0; tries < 40; tries++) {
    const x = rand(YARD.x0, YARD.x1), z = rand(YARD.z0, YARD.z1);
    const roomy = (farm.walkers || []).every(o => o === w || o.hidden || Math.hypot(x - o.tx, z - o.tz) > 1.4);   // don't crowd the others
    if (Math.hypot(x - w.x, z - w.z) > 1.2 && roomy && !blockedAt(x, z) && pathClear(w.x, w.z, x, z)) return [x, z];
  }
  return [w.x, w.z];
}
function markerGeo([a, b]) {                       // a little sunflower that floats over a hopper
  const v = new VB(0.6);
  for (let i = 0; i < 10; i++) {
    const ang = i * Math.PI / 5;
    v.ball(0.04, 0.09, 0.025, Math.cos(ang) * 0.12, Math.sin(ang) * 0.12, 0, i % 2 ? a : b, 0, 0, ang - Math.PI / 2);
  }
  v.cyl(0.085, 0.085, 0.06, 0, 0, 0.02, 0x7a4a1c, Math.PI / 2, 0, 0);
  return v.geometry();
}
// Playing alone, the classic golden one over your hopper; with friends, one per
// player in their colour (petals in two shades of it).
const MARKER_GEO = markerGeo([0xffcc1a, 0xffb000]);
const PLAYER_MARKERS = [[0xff4b4b, 0xe0383a], [0x46a6ff, 0x2f86e0], [0xffd93b, 0xf2b800], [0x6bd864, 0x3fb84a], [0xbd96ff, 0x9b6bff]].map(markerGeo);
// Unlit, so they stay bright in shade and at dusk; after dark they glow (see placeLamps).
const MARKER_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
// at = [x, z] to start somewhere particular (a new friend steps out of the Bunkhouse door).
// key: the hopper's id for the farm's own hoppers, 'p' + slot for a friend playing.
function addWalker(h, at, key = h.id) {
  const m = h.build();
  const w = { id: h.id, key, m, x: 0, z: 0, tx: 0, tz: 0, wait: rand(0.3, 2.5), ph: rand(0, 6), face: Math.PI + 0.36, hop: 0 };
  if (at) [w.x, w.z] = at;
  else freeSpot(w);
  w.tx = w.x; w.tz = w.z;
  m.group.position.set(w.x, 0, w.z);
  w.top = new THREE.Box3().setFromObject(m.group).max.y;   // where the marker floats
  farm.group.add(m.group);
  farm.walkers.push(w);
  return w;
}
function spawnWalkers() {
  for (const w of farm.walkers || []) { farm.group.remove(w.m.group); disposeHero(w.m); }
  farm.walkers = [];
  for (const h of ownedHeroes()) addWalker(h);
  farm.markers ||= [];
  syncPlayerWalkers();
}
function removeWalker(w) {
  stopFish(w.key);
  const s = seen.get(w.key);
  if (s) { dropRig(s.rig); seen.delete(w.key); }
  farm.group.remove(w.m.group);
  disposeHero(w.m);
  farm.walkers.splice(farm.walkers.indexOf(w), 1);
}
function hideWalker(w, on) {
  w.hidden = on;
  w.m.group.visible = !on;
  if (on) w.leap = w.goal = w.queued = null;
}
// Every friend playing (a phone in the room or a guest far away) gets a hopper of
// their own on the farm, even the same one as someone else's: four Leaf Wishes is
// fine. The farm's own hopper of that kind steps out of sight meanwhile, unless
// it's the host's.
const isPlayerKey = k => /^p\d$/.test(k);
function syncPlayerWalkers() {
  if (!farm.walkers || GUEST) return;
  const want = new Map([...party.players].filter(([, p]) => p.hero).map(([slot, p]) => ['p' + slot, p.hero]));
  for (const w of [...farm.walkers]) if (isPlayerKey(w.key) && want.get(w.key) !== w.id) removeWalker(w);
  for (const [key, id] of want) if (!walkerOf(key)) addWalker(HEROES.find(h => h.id === id), null, key);
  const played = new Set(want.values());
  for (const w of farm.walkers) if (!isPlayerKey(w.key)) hideWalker(w, played.has(w.id) && w.id !== heroId);
  toGuests({ t: 'crew', walkers: crewList() });
}
const crewList = () => farm.walkers.map(w => ({ k: w.key, hero: w.id, hidden: !!w.hidden, host: w.key === heroId, col: isPlayerKey(w.key) ? colorOf(+w.key.slice(1)) : 0, x: w.x, z: w.z, tx: w.tx, tz: w.tz }));
// Between rounds everyone can hop their own hopper around the yard, one hop at a
// time: friends with their phone's hop pad, the TV with the arrow keys, WASD, the
// controller, or a tap on the grass. Left alone for a while, a hopper goes back to wandering.
const FARM_STEP = 1, STEER_IDLE = 25;
const walkerOf = key => farm.walkers?.find(w => w.key === key);
const myKey = () => GUEST ? guestKey : heroId;   // the hopper this screen steers
// crowd false: never mind other hoppers (squeezing up to the swing past someone in the way)
const roomAt = (w, x, z, crowd = true) => x > YARD.x0 && x < YARD.x1 && z > YARD.z0 && z < YARD.z1 && !blockedAt(x, z)
  && (!crowd || farm.walkers.every(o => o === w || o.hidden || Math.hypot(x - o.x, z - o.z) > 0.7));
function leapTo(w, x, z, crowd = true) {   // false (and a little bump in place) when a wall or a friend is in the way
  const ok = roomAt(w, x, z, crowd);
  if (x !== w.x || z !== w.z) w.face = Math.atan2(-(x - w.x), -(z - w.z));
  if (!ok) { x = w.x; z = w.z; }
  const up = ok ? 0.4 : 0.15;
  landLeap(w, x, z, up);
  // Everyone on this farm sees it: a guest tells the host, the host tells its guests.
  if (GUEST) { if (w.key === myKey()) guestNet.send({ t: 'leap', x, z, up }); }
  else toGuests({ t: 'leap', k: w.key, x, z, up });
  return ok;
}
function landLeap(w, x, z, up, y = null) {   // y: a height to land at (up onto the Jam Stage, or back down)
  if (x !== w.x || z !== w.z) w.face = Math.atan2(-(x - w.x), -(z - w.z));
  w.hop = 0;
  w.leap = { x0: w.x, z0: w.z, x1: x, z1: z, t: 0, up, y0: w.y || 0, y1: y };
  w.wait = STEER_IDLE;
  sfx.hop(w.id);
}
function farmHop(id, dx, dr) {
  const w = walkerOf(id);
  if (!w || fishers.has(id) || w.flip) return;
  if (w.sit) { if (w.key === myKey()) dismount(w); else standUp(w); return; }   // on the swing: a hop gets off
  w.swingGo = false;
  if (w.leap) { w.queued = [dx, dr]; return; }   // pressed again mid-hop: go straight after this one
  w.goal = null;
  leapTo(w, w.x + dx * FARM_STEP, w.z - dr * FARM_STEP);
}
function hopToward(id, x, z) {   // a tap on the grass: hop over there, the long way round if need be
  const w = walkerOf(id);
  if (!w) return;
  w.swingGo = false;
  w.goal = { x, z };
  w.path = findPath(w.x, w.z, x, z);
  if (!w.leap) nextLeap(w);
}
// The way from here to there round the pond, the buildings and the decorations: A* over
// a half-unit grid of the yard, then pulled taut into as few straight stretches as can
// see each other. null when there's no way (the spot itself is inside something).
const PATH_STEP = 0.5;
function findPath(x0, z0, x1, z1) {
  const S = PATH_STEP, X0 = YARD.x0, Z0 = YARD.z0, nx = Math.floor((YARD.x1 - X0) / S) + 1, nz = Math.floor((YARD.z1 - Z0) / S) + 1;
  const cx = i => X0 + i * S, cz = j => Z0 + j * S;
  const ci = x => clamp(Math.round((x - X0) / S), 0, nx - 1), cj = z => clamp(Math.round((z - Z0) / S), 0, nz - 1);
  if (blockedAt(x1, z1) || pathClear(x0, z0, x1, z1)) return pathClear(x0, z0, x1, z1) ? [] : null;
  const wall = new Int8Array(nx * nz).fill(-1), isWall = (i, j) => { const k = j * nx + i; if (wall[k] < 0) wall[k] = blockedAt(cx(i), cz(j)) ? 1 : 0; return wall[k] === 1; };
  const start = cj(z0) * nx + ci(x0), goal = cj(z1) * nx + ci(x1);
  const g = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), done = new Uint8Array(nx * nz);
  const h = k => Math.hypot(k % nx - goal % nx, Math.floor(k / nx) - Math.floor(goal / nx));
  const open = [start];
  g[start] = 0;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (g[open[i]] + h(open[i]) < g[open[bi]] + h(open[bi])) bi = i;
    const k = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (k === goal) break;
    if (done[k]) continue;
    done[k] = 1;
    const i = k % nx, j = Math.floor(k / nx);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz || isWall(a, b)) continue;
      if (di && dj && (isWall(i + di, j) || isWall(i, j + dj))) continue;   // no cutting corners
      const n = b * nx + a, cost = g[k] + (di && dj ? Math.SQRT2 : 1);
      if (cost < g[n]) { g[n] = cost; from[n] = k; open.push(n); }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const cells = [];
  for (let k = goal; k !== start && k >= 0; k = from[k]) cells.unshift([cx(k % nx), cz(Math.floor(k / nx))]);
  cells.push([x1, z1]);
  const out = [];   // pulled taut: from each corner, straight on to the furthest point in sight
  let at = [x0, z0];
  for (let i = 0; i < cells.length;) {
    let j = cells.length - 1;
    while (j > i && !pathClear(at[0], at[1], cells[j][0], cells[j][1])) j--;
    out.push(cells[j]);
    at = cells[j];
    i = j + 1;
  }
  return out;
}
function nextLeap(w) {
  while (w.path?.length > 1 && Math.hypot(w.path[0][0] - w.x, w.path[0][1] - w.z) < 0.35) w.path.shift();   // reached a corner: on to the next
  const [gx, gz] = w.path?.length ? w.path[0] : [w.goal.x, w.goal.z], last = !(w.path?.length > 1);
  const dx = gx - w.x, dz = gz - w.z, d = Math.hypot(dx, dz);
  if (d < 0.35 && last) { w.goal = w.path = null; return; }
  const s = Math.min(FARM_STEP, d), a = Math.atan2(dz, dx), crowd = !(w.swingGo && last);   // the last hop up to the swing squeezes past anyone there
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {   // someone in the way: try stepping round them
    const x = w.x + Math.cos(a + turn) * s, z = w.z + Math.sin(a + turn) * s;
    if (roomAt(w, x, z, crowd) && (!turn || Math.hypot(gx - x, gz - z) < d)) { leapTo(w, x, z, crowd); return; }
  }
  w.goal = w.path = null;
  leapTo(w, w.x, w.z);
}
// The TV's own hopper, from the keyboard or a controller
// ---------- the swing ----------
// Now and then a farm hopper wanders over to the swing, hops on and sits for a good
// swing, then hops off again. Tap the swing and your own hopper goes and sits, with
// a camera in front of the swing; any tap or hop gets off. The sitter rides the seat:
// hips on the board, legs dangling below it, tipping as it swings.
// Sitting bends a hopper at the waist: while seated it wears a copy of its body with
// everything below the hips swung forward, so its legs stick out over the front of
// the seat. HIPS: where each one's legs meet its body (model units, before the 1.3 scale).
const HIPS = { captain: 0.265, betty: 0.265, axolotl: 0.18, catstar: 0.235, leafwish: 0.2, tuko: 0.235, spider: 0.235, lyla: 0.24, carla: 0.15, siracha: 0.17, ribbit: 0.235, moonbun: 0.235 };   // (Carla's at her skirt's hem: the dress sits on the seat, legs out from under it)
const TAIL_UP = -0.95;   // a low tail tips up and back over the back of the seat while sitting
const SIT_BEND = 1.35;   // how far forward the legs swing (radians)
const hipOf = w => (HIPS[w.id] ?? 0.22) * 1.3;
function bendBody(w, on) {
  const hip = HIPS[w.id] ?? 0.22;
  for (const m of [...w.m.inner.children]) {
    if (!m.isMesh) continue;
    if (w.m.tails.includes(m)) {   // tails don't bend with the legs; a low one lifts clear of the seat instead
      if (m.position.y < 0.45 && (m.userData.axis || 'z') !== 'x') m.rotation.x = on ? TAIL_UP : 0;
      continue;
    }
    if (!on) {   // back to standing
      if (m.userData.stand) { m.geometry.dispose(); m.geometry = m.userData.stand; m.userData.stand = null; }
      continue;
    }
    if (m.userData.stand) continue;
    const g = m.geometry.clone(), pos = g.attributes.position, nor = g.attributes.normal, oy = m.position.y, oz = m.position.z;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + oy;
      if (y >= hip) continue;
      const k = Math.min(1, (hip - y) / 0.05), a = SIT_BEND * k * k * (3 - 2 * k);   // eases in just under the hips, so nothing tears
      const c = Math.cos(a), sn = Math.sin(a), dy = y - hip, dz = pos.getZ(i) + oz;
      pos.setY(i, hip + dy * c - dz * sn - oy);
      pos.setZ(i, dy * sn + dz * c - oz);
      if (nor) { const ny = nor.getY(i), nz = nor.getZ(i); nor.setY(i, ny * c - nz * sn); nor.setZ(i, ny * sn + nz * c); }
    }
    pos.needsUpdate = true;
    if (nor) nor.needsUpdate = true;
    g.computeBoundingSphere();
    m.userData.stand = m.geometry;
    m.geometry = g;
  }
}
const _sv = new THREE.Vector3(), _sq = new THREE.Quaternion(), _turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const swingFront = () => pieceToFarm(farm.pieces.swing, 0, 1.25);
const onSwing = (x, z) => { const p = farm.pieces.swing, [a, b, c, d] = worldRect(PIECES.swing.foot, p.x, p.z, p.r); return x > a && x < b && z > c && z < d; };
const swingTaken = by => farm.walkers.some(o => o !== by && (o.sit || o.swingGo));   // one hopper on the swing at a time
function goSwing(w, mine = false) {   // head for the front of the swing; false if it can't
  const sp = farm.pieces.swing;
  if (!w || !sp || decor.on || w.fishing || w.sit || w.show) return false;
  if (swingTaken(w)) {   // your turn: whoever's on it hops off, and anyone on the way changes their mind
    if (!mine) return false;
    for (const o of farm.walkers) if (o !== w) { if (o.sit) standUp(o); o.swingGo = false; }
  }
  const [x, z] = swingFront();
  if (blockedAt(x, z)) return false;
  farm.swingSitter = w;
  if (mine) {
    for (const o of farm.walkers) {   // anyone loitering in front of the swing wanders off
      if (o === w || o.sit || o.fishing || o.show || playerMarks().some(([p]) => p === o) || Math.hypot(o.x - x, o.z - z) > 1.1) continue;
      [o.tx, o.tz] = nextSpot(o);
      toGuests({ t: 'walk', k: o.key, x: o.x, z: o.z, tx: o.tx, tz: o.tz });
    }
    hopToward(w.key, x, z);
    w.swingGo = true;
    return true;
  }
  if (!pathClear(w.x, w.z, x, z)) { farm.swingSitter = null; return false; }
  w.swingGo = true;
  w.tx = x; w.tz = z;
  toGuests({ t: 'walk', k: w.key, x: w.x, z: w.z, tx: x, tz: z });
  return true;
}
function sitDown(w) {
  w.swingGo = false;
  const other = farm.walkers.find(o => o !== w && o.sit);
  if (other) { if (w.key !== myKey()) return; standUp(other); }   // taken: a farm hopper wanders off; yours takes a turn
  if (!farm.pieces.swing || Math.hypot(w.x - swingFront()[0], w.z - swingFront()[1]) > 0.6) { if (farm.swingSitter === w) farm.swingSitter = null; return; }   // didn't make it
  farm.swingSitter = w;
  w.sit = { t: w.key === myKey() ? Infinity : rand(12, 22), k: 0 };   // yours stays till you hop off
  bendBody(w, true);
  w.leap = null; w.hop = 0;
  sfx.hop(w.id);
  if (w.key === myKey()) document.body.classList.add('swinging');
}
// Your hopper's way off: the swing goes higher and higher, and at the top of a swing
// forward you let go, backflip through the air and land out in front.
function dismount(w) {
  if (!w?.sit || w.sit.leaving) return;
  w.sit.leaving = 0.001;
  w.sit.t = Infinity;
}
function flipOff(w) {
  const sp = farm.pieces.swing;
  let [x, z] = pieceToFarm(sp, 0, 2.6);
  if (blockedAt(x, z) || x < YARD.x0 || x > YARD.x1 || z < YARD.z0 || z > YARD.z1) [x, z] = swingFront();
  w.sit = null;
  if (farm.swingSitter === w) farm.swingSitter = null;
  w.flip = { t: 0, dur: 1.05, x0: w.x, y0: w.y || 0, z0: w.z, x1: x, z1: z };
  w.face = sp.r * Math.PI / 2 + Math.PI;
  sfx.hop(w.id);
  toGuests({ t: 'leap', k: w.key, x, z, up: 0.5, y: 0 });
}
const _flipQ = new THREE.Quaternion(), _xAxis = new THREE.Vector3(1, 0, 0), _yAxis = new THREE.Vector3(0, 1, 0);
function flipPose(w, dt) {
  const F = w.flip, k = Math.min(1, (F.t += dt) / F.dur), spin = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);   // eases in and out of the turn
  w.x = w.tx = lerp(F.x0, F.x1, k);
  w.z = w.tz = lerp(F.z0, F.z1, k);
  w.y = lerp(F.y0, 0, k) + Math.sin(Math.PI * k) * 1.5;
  const g = w.m.group;
  g.position.set(w.x, w.y, w.z);
  g.quaternion.setFromAxisAngle(_yAxis, w.face).multiply(_flipQ.setFromAxisAngle(_xAxis, Math.PI * 2 * spin));   // head back first: a backflip
  if (k >= 1) {   // landed (legs tucked all the way round, straightened now)
    w.flip = null;
    bendBody(w, false);
    w.y = 0;
    g.quaternion.identity();
    g.rotation.y = w.face;
    w.hop = 0.3;
    w.wait = STEER_IDLE;
    sfx.hop(w.id);
    if (w.key === myKey()) document.body.classList.remove('swinging');
  }
}
function standUp(w) {
  if (!w?.sit) return;
  w.sit = null;
  bendBody(w, false);
  if (farm.swingSitter === w) farm.swingSitter = null;
  if (w.key === myKey()) document.body.classList.remove('swinging');
  w.m.group.quaternion.identity();
  w.m.group.rotation.y = w.face;
  if (!farm.pieces.swing) { w.y = 0; return; }
  const [x, z] = w.key === myKey() ? swingFront() : pieceToFarm(farm.pieces.swing, rnd() < 0.5 ? -1.6 : 1.6, 0.2);   // others hop off to the side, out of the way and out of the swing camera's view
  landLeap(w, x, z, 0.35, 0);   // a hop down off the seat
  toGuests({ t: 'leap', k: w.key, x, z, up: 0.35, y: 0 });
  w.wait = rand(1, 3);
}
// On the seat: placed on it as it swings, facing out the front.
function sitPose(w, dt) {
  const sp = farm.pieces.swing, seat = sp?.group.userData.seat;
  if (!seat || decor.on || game.state !== 'farm') { standUp(w); return; }
  seat.updateMatrixWorld();
  seat.localToWorld(_sv.set(0, SEAT_TOP - hipOf(w) + 0.02, -0.04));   // hips on the board, a touch back
  farm.group.worldToLocal(_sv);
  w.m.group.position.copy(_sv);
  seat.getWorldQuaternion(_sq);
  w.m.group.quaternion.copy(_sq).multiply(_turn);
  w.m.inner.position.y = 0;
  w.m.inner.rotation.z = 0;
  w.x = w.tx = _sv.x; w.z = w.tz = _sv.z; w.y = _sv.y;
  w.face = (sp.r * Math.PI / 2) + Math.PI;
  w.sit.k = Math.min(1, w.sit.k + dt * 2);
  if (w.sit.leaving) {   // getting off with a flourish: let go at the front of a big swing
    const S = w.sit, a = seat.rotation.x;
    S.leaving += dt;
    if ((S.last != null && a > S.last && S.last < -0.35 && S.leaving > 1.2) || S.leaving > 4) { flipOff(w); return; }   // just past the front (or it's taken long enough)
    S.last = a;
    return;
  }
  if ((w.sit.t -= dt) <= 0) standUp(w);
}
// Your hopper on the swing: a camera out in front, a little low, looking up at you
// swinging, with the sky and clouds behind.
// Look around just like the fishing camera: drag (or A / D, W / S, the right stick,
// LB / RB) to turn and tilt, pinch, the wheel, Q / E or the triggers to zoom.
const SWING_PITCH = [0.02, 1.0], SWING_ZOOM = [0.55, 1.8];
const swingCam = { on: false, swoop: 1, look: new THREE.Vector3(), yaw: 0, shown: 0, pitch: 0.12, zoom: 1, spin: 0, tilt: 0, zoomSpin: 0 };
function setSwingView(pitch, zoom) {
  swingCam.pitch = clamp(pitch, ...SWING_PITCH);
  swingCam.zoom = clamp(zoom, ...SWING_ZOOM);
}
function swingCamHook(dt) {
  const me = walkerOf(myKey()), sp = farm.pieces.swing;
  if (!(me?.sit || me?.flip) || !sp) { swingCam.on = false; return false; }
  useCamera(perspCam);
  const base = farm.group.position, front = sp.r * Math.PI / 2;   // the swing's front, as an angle round the y axis
  const lookX = base.x + sp.x, lookY = 1.15, lookZ = base.z + sp.z;
  if (!swingCam.on) Object.assign(swingCam, { on: true, swoop: 1, yaw: 0, shown: 0, pitch: 0.12, zoom: 1 });
  swingCam.swoop *= Math.exp(-dt * 2.5);
  swingCam.yaw += swingCam.spin * dt * 1.8;
  if (swingCam.tilt || swingCam.zoomSpin) setSwingView(swingCam.pitch + swingCam.tilt * dt * 0.9, swingCam.zoom * Math.exp(swingCam.zoomSpin * dt * 1.2));
  swingCam.shown += (swingCam.yaw - swingCam.shown) * Math.min(1, dt * 8);
  const a = front + swingCam.shown, p = swingCam.pitch + swingCam.swoop * 0.3, d = 3.6 * swingCam.zoom + swingCam.swoop * 2;
  camera.position.set(lookX + Math.sin(a) * Math.cos(p) * d, 0.75 + Math.sin(p) * d, lookZ + Math.cos(a) * Math.cos(p) * d);
  camera.lookAt(swingCam.look.set(lookX, lookY, lookZ));
  skyClouds(dt, lookX, lookZ);
  sun.position.copy(swingCam.look).add(SUN_OFF);
  sun.target.position.copy(swingCam.look);
  setShadowSpan(FISH_SHADOW);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  camera.updateMatrixWorld();
  return true;
}
function hostFarmHop(dx, dr) {
  if (game.state !== 'farm' || game.picking || decor.on || jam.open || fishers.has(myKey())) return false;
  farmHop(myKey(), dx, dr);
  return true;
}
function updateWalkers(dt, t) {
  for (const w of farm.walkers) {
    if (w.hidden) continue;
    if (w.sit) { sitPose(w, dt); continue; }
    if (w.flip) { flipPose(w, dt); continue; }
    const { inner, group, tails } = w.m;
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    let sway = Math.sin(t * 2.2 + w.ph) * 0.1;
    if (w.leap) {                                    // steered from a phone
      const L = w.leap;
      L.t = Math.min(1, L.t + dt / 0.2);
      w.x = w.tx = lerp(L.x0, L.x1, L.t);
      w.z = w.tz = lerp(L.z0, L.z1, L.t);
      inner.position.y = Math.sin(Math.PI * L.t) * L.up;
      inner.rotation.z = 0;
      if (L.y1 != null) w.y = lerp(L.y0, L.y1, L.t);
      if (L.t >= 1) {
        w.leap = null;
        if (w.queued) { const [qx, qr] = w.queued; w.queued = null; farmHop(w.key, qx, qr); }
        else if (w.goal) nextLeap(w);
      }
    } else if (w.hop > 0) {                                 // happy hop
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
      if (w.show) showAct(w, t);
      else if (w.swingGo && !w.goal) sitDown(w);
      else if ((w.wait -= dt) <= 0) {
        if (w.fishing) w.wait = 1;
        else if (GUEST) w.wait = 1;   // on a friend's farm, the host decides where everyone wanders
        else if (rnd() < 0.22 && !playerMarks().some(([o]) => o === w) && goSwing(w)) {}   // off for a swing
        else { [w.tx, w.tz] = nextSpot(w); toGuests({ t: 'walk', k: w.key, x: w.x, z: w.z, tx: w.tx, tz: w.tz }); }
      }
    }
    let da = w.face - group.rotation.y;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    group.rotation.y += da * Math.min(1, dt * 8);
    group.position.set(w.x, w.y || 0, w.z);
    for (const tl of tails) tl.rotation[tl.userData.axis || 'z'] = tl.userData.side * sway;
  }
  const marks = playerMarks();
  while (farm.markers.length < marks.length) {
    const m = new THREE.Mesh(MARKER_GEO, MARKER_MAT);
    m.castShadow = true;
    farm.group.add(m);
    farm.markers.push(m);
  }
  farm.markers.forEach((m, i) => {
    const [w, n] = marks[i] || [];
    m.visible = !!w;
    if (!w) return;
    m.geometry = n < 0 ? MARKER_GEO : PLAYER_MARKERS[n];
    m.position.set(w.x, (w.y || 0) + w.top + 0.32 + Math.sin(t * 3 + i) * 0.06 + w.m.inner.position.y, w.z);
    m.rotation.y = Math.sin(t * 1.5 + i) * 0.5;
  });
}
// [walker, player index] for each sunflower: -1 is the golden one, for playing alone.
// The host is player 0 (red); a phone or guest in slot n is player n.
function playerMarks() {
  if (!GUEST && ![...party.players.values()].some(p => p.hero)) return [[walkerOf(heroId), -1]];
  return farm.walkers.filter(w => !w.hidden && (GUEST ? w.isHost : w.key === heroId) || isPlayerKey(w.key))
    .map(w => [w, !isPlayerKey(w.key) ? 0 : GUEST ? w.col : colorOf(+w.key.slice(1))]);
}
// Called when arriving at the farm or picking a hopper: your hopper hops and turns to you.
function placeFarmHero() {
  if (!farm.walkers) spawnWalkers();
  syncPlayerWalkers();   // the host's own hopper is back in sight if a friend had it
  const me = walkerOf(myKey());
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
  farm.pond.getWorldPosition(_fw);
  burst(_fw.x, 0.3, _fw.z, [0xffd23f, 0xffffff, 0xff8fc8, 0x5bb4ff], 26, 2.2, 5, 0.09, 0.9);
  burst(_fw.x, 0.1, _fw.z, [0xffffff, 0xbfe9ff], 14, 1.2, 4, 0.12, 0.7, true);
  settleWalkers();   // a bigger pond might now cover someone
  hud();
  return true;
}
// ---------- flow ----------
const $ = id => document.getElementById(id);
let sunDot = null, skyBar = null;
function hudDay() {   // the daylight clock: its sunny wedge shrinks and warms toward night
  sunDot ||= $('sunDot'); skyBar ||= $('sky');
  const d = clamp(game.day, 0, 1);
  skyBar.style.setProperty('--day', d.toFixed(3));
  skyBar.style.setProperty('--wedge', d > 0.5 ? '#ffd24a' : d > 0.2 ? '#ff9a3c' : '#bd96ff');
  sunDot.classList.toggle('moon', d < 0.15);
  skyBar.classList.toggle('low', game.day < 0.25 && game.state === 'play');
}
function hud() {
  $('score').textContent = game.score;
  $('top').textContent = t('best', { n: game.top });
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
  game.crew = [P];
  P.cam = null;
  P.key = GUEST ? guestKey : 'h';
  game.roadT = 0;
  if (!GUEST) game.seed = (Math.random() * 2 ** 32) >>> 0;   // a guest gets the host's (see goRoadGuest)
  setupCrew();
  game.camZ = -roadView().lead;
  resetPlayer();
  ensureLanes();
  placeCrew();
  hud();
}

// The flow: farm -> (sunrise) -> road, waiting for the first hop ('title') -> play
// -> dead -> over (the sign) -> (fade home) -> farm.
function setHint() {
  const pad = document.body.classList.contains('pad');
  const key = (decor.on ? 'hintDecor' : game.where === 'farm' ? (GUEST ? 'hintGuest' : 'hintFarm') : 'hintRoad') + (pad ? 'Pad' : '');
  const hint = $('hint');
  hint.textContent = t(key);
  const small = document.createElement('small');
  small.textContent = t(key + 'Sub');
  hint.append(small);
}
// ---------- Betty Lou's tips ----------
// On the farm Betty Lou pipes up with a tip in a speech bubble: the first a few
// seconds in, then one a minute, taking turns. Tips for things already done are skipped.
const TIP_EVERY = 60, TIP_SHOW = 6;
const tip = { wait: 3, show: 0, n: 0, w: null };
function tipList() {
  if (GUEST) return ['guest', 'hop', farm.level >= 1 && 'fishGuest', 'hopper'].filter(Boolean);
  return ['hop', 'start', 'pond', farm.level >= 1 && 'fish', !farm.bunkBuilt && 'bunk', !farm.stageBuilt && 'stage', 'decor', 'hopper', 'friends'].filter(Boolean);
}
function tipText(key) {
  const pad = document.body.classList.contains('pad');
  const k = pad && t('tips.' + key + 'Pad') !== 'tips.' + key + 'Pad' ? key + 'Pad' : key;
  return t('tips.' + k, { n: BUNK_COST });
}
// Over Betty Lou if she's about the farm, otherwise over your own hopper.
const tipWalker = () => farm.walkers?.find(w => w.id === 'betty' && !w.hidden) || walkerOf(myKey());
function updateTip(dt) {
  const el = $('tip');
  const quiet = game.state !== 'farm' || decor.on || game.picking || fishers.has(myKey()) || /show-logo|swinging/.test(document.body.className);   // (and not over the swing's view)
  if (quiet) {
    if (tip.show > 0) { tip.show = 0; el.classList.remove('show'); }
    tip.wait = Math.max(tip.wait, 3);   // a moment's breath before she speaks again
    return;
  }
  if (tip.show > 0) {
    tip.show -= dt;
    if (tip.show <= 0) { el.classList.remove('show'); tip.wait = TIP_EVERY - TIP_SHOW; }
  } else if ((tip.wait -= dt) <= 0) {
    const list = tipList();
    el.textContent = tipText(list[tip.n++ % list.length]);
    tip.w = tipWalker();
    tip.show = TIP_SHOW;
    el.classList.add('show');
  }
  if (tip.show <= 0 || !tip.w) return;
  // follow her around: just above her head (and her sunflower, if she has one)
  tip.w.m.group.getWorldPosition(_tipAt);
  _tipAt.y += tip.w.top + 0.75;
  _tipAt.project(camera);
  const x = (_tipAt.x + 1) / 2 * innerWidth, y = (1 - _tipAt.y) / 2 * innerHeight;
  const half = el.offsetWidth / 2, left = Math.min(Math.max(x, half + 8), innerWidth - half - 8);
  el.style.transform = `translate(${left - half}px, ${y - el.offsetHeight - 12}px)`;
  el.style.setProperty('--tail', `${Math.min(Math.max(x - left + half, 22), el.offsetWidth - 22)}px`);
}
const _tipAt = new THREE.Vector3();
function bettySays(text) {   // a word from Betty Lou right now
  const el = $('tip');
  el.textContent = text;
  tip.w = tipWalker();
  tip.show = 4;
  el.classList.add('show');
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
  if (game.state !== 'farm' || GUEST) return;
  exitDecor();
  stopAllFishing();
  game.state = 'sunrise';
  closeHeroes();
  closePond();
  closeBunk();
  closeSettings();
  sfx.rooster();
  Object.assign(farmCam, { x: 0, z: 0, zoom: FARM_ZOOM0 });   // home looks like home again after the round
  transition('sunrise', 950, () => {
    newWorld();
    game.where = 'road';
    game.state = 'title';
    game.dawn = 0.12;
    document.body.classList.remove('farm', 'show-logo');
    document.body.classList.add('ready');
    setHint();
    // Friends on their own devices build the same road from the seed and line up beside us.
    toGuests(roadNews());
    tellView();
  });
}
// A guest's side of the sunrise: the host's road, the host's line-up.
function goRoadGuest(m) {
  stopAllFishing();
  closeHeroes();
  closeSettings();
  sfx.rooster();
  Object.assign(farmCam, { x: 0, z: 0, zoom: FARM_ZOOM0 });
  game.state = 'sunrise';
  const late = m.state === 'play';   // the team is already on its way
  transition('sunrise', 950, () => {
    game.seed = m.seed >>> 0;
    roadClock = { T: m.T, at: performance.now() };
    newWorld();
    for (const c of m.crew) {
      if (c.k === guestKey) {
        if (!late) { freshHopper(P, P.hero, c.x, c.r); P.active = false; }
        continue;
      }
      const h = { key: c.k, slot: c.slot || 0, col: c.col ?? 0, hero: c.hero, remote: true };
      freshHopper(h, c.hero, c.x, c.r);
      h.active = false;
      if (!c.alive || c.parked) { h.alive = false; h.parked = !!c.parked; h.model.group.visible = false; }
      game.crew.push(h);
    }
    game.where = 'road';
    game.dawn = 0.12;
    document.body.classList.remove('farm', 'show-logo');
    if (late) {
      // Catch the road up to now, build it out to the team, and drop in beside them in a moment.
      game.state = 'play';
      game.score = m.score | 0;
      game.day = m.day;
      for (const lane of lanes.values()) catchUp(lane, m.T);
      game.roadT = m.T;
      const team = game.crew.filter(h => h.remote && h.alive && !h.parked);
      const at = team.length ? team.reduce((a, b) => (b.r < a.r ? b : a)) : { x: 0, r: game.score };
      game.camZ = -at.r - roadView().lead;
      game.camX = at.x;
      ensureLanes();
      P.alive = false;
      P.back = 0.3;
      P.model.group.visible = false;
    } else {
      game.state = 'title';
      document.body.classList.add('ready');
    }
    setHint();
    hud();
  });
}
function goFarm() {   // after a round: a quick fade home
  if (game.state !== 'over' || GUEST) return;
  game.state = 'dusk';
  transition('dusk', 450, enterFarm);
}
function enterFarm() {
  music?.setLevel(1);
  for (const h of game.crew) if (h !== P && h.model) { scene.remove(h.model.group); disposeHero(h.model); h.model = null; }
  game.crew = [P];
  setTimeout(tellView);
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
  const last = game.lastDeath || P;
  $('overMsg').textContent = t('death.' + (last.death in STRINGS.en.death ? last.death : 'other'), { name: heroName(last.hero) });
  tellView();
  $('overGain').textContent = game.today === 0 ? t('gainNone') : game.today === 1 ? t('gain1') : t('gainN', { n: game.today });
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

// ---------- exploring the farm: drag to look around, pinch or scroll to zoom, tap things ----------
const FARM_ZOOM0 = 0.85;   // the farm starts a little zoomed out: there's a lot of it
const farmCam = { x: 0, z: 0, zoom: FARM_ZOOM0 };
const FARM_PAN = { x0: -12, x1: WIDE_X1 + 4.8, z0: -12, z1: 10 }, FARM_ZOOM = [0.35, 1.7];   // room to look out over the countryside
const touches = new Map();   // pointerId -> {x, y}
let farmTap = null, pinch = 0;
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundAt(x, y, out) {
  _ndc.set(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  return _ray.ray.intersectPlane(GROUND, out);
}
const exploring = e => game.state === 'farm' && !game.picking && !e.target.closest('button');
function zoomFarm(k) {
  farmCam.zoom = clamp(farmCam.zoom * k, ...FARM_ZOOM);
  updateCamera(0);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
window.addEventListener('pointerdown', e => {
  if (!exploring(e)) return;
  if (swingCam.on) {   // on the swing: drag to look around, pinch to zoom (the button hops off)
    fishTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fishTouch.size === 2) { fishDrag = null; fishPinch = 0; }
    else { fishPtr = e.pointerId; fishDrag = { x: e.clientX, y: e.clientY, yaw: swingCam.yaw, pitch: swingCam.pitch, moved: false }; }
    return;
  }
  const meF = fishers.get(myKey());
  if (meF) {   // fishing: the whole screen is the reel
    fishTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (meF.st === 'bite' || meF.st === 'reel') {   // timing counts: straight away, from any finger (two thumbs drum faster)
      fishPtr = e.pointerId;
      fishDrag = null;
      fishPress(meF, false);
      fishPress(meF, true, 'tap', e.timeStamp / 1000);
    } else if (fishTouch.size === 2) { fishDrag = null; fishPinch = 0; }                          // two fingers: zoom
    else { fishPtr = e.pointerId; fishDrag = { x: e.clientX, y: e.clientY, yaw: fishCam.yaw, pitch: fishView.pitch, moved: false }; }   // a tap, or a drag to look around
    return;
  }
  if (decor.on && !touches.size && decorGrab(e)) return;   // picked up a piece: drag it instead of the view
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  farmTap = touches.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  pinch = 0;
});
window.addEventListener('pointermove', e => {
  const ft = fishTouch.get(e.pointerId);
  if (ft) {
    ft.x = e.clientX; ft.y = e.clientY;
    if (fishTouch.size === 2) {   // pinch to zoom
      const [m, n] = [...fishTouch.values()], d = Math.hypot(m.x - n.x, m.y - n.y);
      if (fishPinch) { if (swingCam.on) setSwingView(swingCam.pitch, swingCam.zoom * fishPinch / d); else setFishView(fishView.pitch, fishView.zoom * fishPinch / d); }
      fishPinch = d;
      return;
    }
  }
  if (fishDrag && e.pointerId === fishPtr) {
    const dx = e.clientX - fishDrag.x, dy = e.clientY - fishDrag.y;
    if (Math.hypot(dx, dy) > 8) fishDrag.moved = true;
    if (fishDrag.moved && swingCam.on) {
      swingCam.yaw = fishDrag.yaw - dx * 0.012;
      setSwingView(fishDrag.pitch + dy * 0.006, swingCam.zoom);
    } else if (fishDrag.moved) {
      fishCam.yaw = fishDrag.yaw - dx * 0.012;
      setFishView(fishDrag.pitch + dy * 0.006, fishView.zoom);   // drag down to look down from higher up
    }
    return;
  }
  if (decor.drag && decor.drag.id === e.pointerId) { decorDrag(e); return; }
  const p = touches.get(e.pointerId);
  if (!p || game.state !== 'farm') return;
  if (farmTap && Math.hypot(e.clientX - farmTap.x, e.clientY - farmTap.y) > 10) farmTap = null;   // it's a drag, not a tap
  if (touches.size === 1 && !farmTap) {            // drag: the ground under your finger follows it
    if (groundAt(p.x, p.y, _a) && groundAt(e.clientX, e.clientY, _b)) {
      farmCam.x = clamp(farmCam.x + _a.x - _b.x, FARM_PAN.x0, FARM_PAN.x1);
      farmCam.z = clamp(farmCam.z + _a.z - _b.z, FARM_PAN.z0, FARM_PAN.z1);
      updateCamera(0);
    }
  }
  p.x = e.clientX; p.y = e.clientY;
  if (touches.size === 2) {                        // pinch
    const [m, n] = [...touches.values()], d = Math.hypot(m.x - n.x, m.y - n.y);
    if (pinch) zoomFarm(d / pinch);
    pinch = d;
  }
});
function farmPointerUp(e) {
  if (fishTouch.delete(e.pointerId)) {
    fishPinch = 0;
    if (fishPtr !== e.pointerId) return;   // the other finger of a pinch, or a second thumb
  }
  if (fishPtr != null && fishPtr === e.pointerId) {
    fishPtr = null;
    const f = fishers.get(myKey());
    if (f && fishDrag && !fishDrag.moved && e.type === 'pointerup') fishPress(f, true, 'tap');   // it was a tap: cast
    if (f) fishPress(f, false);
    fishDrag = null;
    return;
  }
  if (decor.drag && decor.drag.id === e.pointerId) { decorDrop(); return; }
  if (!touches.delete(e.pointerId)) return;
  pinch = 0;
  if (!farmTap || farmTap.id !== e.pointerId || e.type !== 'pointerup') return;
  farmTap = null;
  tapFarm(e.clientX, e.clientY);
}
window.addEventListener('pointerup', farmPointerUp);
window.addEventListener('pointercancel', farmPointerUp);
window.addEventListener('wheel', e => {
  if (game.state !== 'farm' || game.picking) return;
  e.preventDefault();
  if (fishCam.on) { setFishView(fishView.pitch, fishView.zoom * Math.exp(e.deltaY * 0.0015)); return; }   // the fishing camera
  if (swingCam.on) { setSwingView(swingCam.pitch, swingCam.zoom * Math.exp(e.deltaY * 0.0015)); return; }   // the swing's
  zoomFarm(Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
// A tap on the pond or the Bunkhouse opens it; a tap on a hopper gets a happy hop.
function tapFarm(x, y) {
  if (decor.on) return;
  _ndc.set(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const hit = (obj) => _ray.intersectObject(obj, true).length > 0;
  const me = walkerOf(myKey());
  const w = farm.walkers.find(w => !w.hidden && hit(w.m.group));
  if (w) { w.hop = 0.5; sfx.hop(w.id); return; }
  if (!GUEST && farm.pieces.swing && (hit(farm.pieces.swing.group) || (groundAt(x, y, _a) && onSwing(_a.x - farm.group.position.x, _a.z - farm.group.position.z)))) { goSwing(me, true); return; }   // the frame, or anywhere on its patch of grass
  const pondHit = _ray.intersectObject(farm.pieces.pond.group, true)[0];
  if (pondHit && (GUEST || onDock(pondHit.point))) { goFish(myKey(), 'tap'); return; }
  if (!GUEST) {   // a guest's taps on buildings just hop there
    if (hit(farm.pieces.bunk.group)) { openBunk(); return; }
    if (hit(farm.pieces.stage.group)) { stageAct(); return; }
    if (hit(farm.pieces.pond.group)) { openPond(); return; }
    if (!farm.wide && groundAt(x, y, _a) && inPlot(_a.x - farm.group.position.x, _a.z - farm.group.position.z)) { openLand(); return; }
  }
  if (groundAt(x, y, _a)) hopToward(myKey(), _a.x - farm.group.position.x, _a.z - farm.group.position.z);
}
// Stop the page itself from scrolling or bouncing, but let panels (pickers, settings) scroll.
document.addEventListener('touchmove', e => { if (!e.target.closest('.sheet, .partyPanel, input[type=range]')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
// Browsers only let sound start from a tap, click or key press. Any of them, anywhere
// (panels and drags included), starts or wakes the music; iOS counts the touch ending,
// not starting, so listen for both. Capture phase so nothing can swallow it first.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(type, () => sfx.ensure(), { capture: true, passive: true });
}
// The logo greets you on the farm; the first touch, click, key or controller press
// tucks it away to free up the screen, and the tip appears at the top instead.
const dismissLogo = () => document.body.classList.remove('show-logo');
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, dismissLogo, { capture: true, passive: true });
document.addEventListener('contextmenu', e => e.preventDefault());

const KEYS = {
  ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};
window.addEventListener('keyup', e => {
  if (jam.open) letGo('k' + e.code);
  const meF = fishers.get(myKey()), kf = keysPlayer() && fishers.get('p' + keysPlayer());
  if (meF && (e.code === 'Space' || e.code === 'Enter')) fishPress(meF, false);
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) fishCam.spin = swingCam.spin = 0;
  if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(e.code)) fishCam.tilt = swingCam.tilt = 0;
  if (['KeyQ', 'KeyE'].includes(e.code)) fishCam.zoomSpin = swingCam.zoomSpin = 0;
  if (kf && e.code.startsWith('Arrow')) fishPress(kf, false);
});
window.addEventListener('keydown', e => {
  sfx.ensure();
  if (e.target.closest?.('input')) { if (e.code === 'Escape') { closeParty(); closeSupport(); } return; }   // typing a room code, or a supporter code
  if (partyOpen()) { if (e.code === 'Escape' || e.code === 'Enter') closeParty(); e.preventDefault(); return; }
  if (game.picking && supportOpen()) { if (e.code === 'Escape') closeSupport(); return; }
  if (game.picking && pickOpen()) { if (e.code === 'Escape') closePick(); return; }
  if (game.picking && nudgeOpen()) {   // Feeling off beat? Enter starts the helper, Escape is "Later"
    if (e.code === 'Enter' || e.code === 'Space') startNudge();
    else if (e.code === 'Escape') closeNudge(true);
    e.preventDefault();
    return;
  }
  if (game.picking && tapOpen()) {   // Latency Helper: Space or Enter taps, Escape closes
    if (e.code === 'Escape') closeTap();
    else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { if ($('tapGo').hidden) tapHit(e.timeStamp / 1000); else tapStart(); }   // tapping along, or starting
    e.preventDefault();
    return;
  }
  if (game.picking && settingsOpen()) {   // Settings: arrows change things, Tab / Q / E switch tabs, Escape or Enter closes
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (/^(Tab|KeyQ|KeyE)$/.test(e.code)) setSettingsTab(setTab === 'set' ? 'upd' : 'set');
    else if (setTab === 'upd' && nav) { if (nav === 'up' || nav === 'down') document.querySelector('.setPanel .panelBody').scrollBy({ top: nav === 'down' ? 80 : -80 }); }
    else if (nav) { document.body.classList.add('keys'); settingsNav(nav); }
    else if (e.code === 'Escape' || e.code === 'Enter') closeSettings();
    e.preventDefault();
    return;
  }
  if (game.picking && bookOpen()) { if (e.code === 'Escape' || e.code === 'Enter') closeBook(); e.preventDefault(); return; }
  if (game.picking && bagOpen()) { bagKey(e.code); e.preventDefault(); return; }
  if (game.picking && landOpen()) {   // More Land: Enter buys, Escape closes
    if (e.code === 'Enter' || e.code === 'Space') buyLand();
    else if (e.code === 'Escape') closeLand();
    e.preventDefault();
    return;
  }
  if (game.picking && pondOpen()) {   // Fish Pond panel: Enter buys, F goes fishing, B opens the backpack, Escape closes
    if (e.code === 'Enter' || e.code === 'Space') buyPond();
    else if (e.code === 'KeyF') goFish(myKey(), 'keys');
    else if (e.code === 'KeyB') openBag();
    else if (e.code === 'Escape') closePond();
    e.preventDefault();
    return;
  }
  if (jam.open) {   // Jam Stage: Q-Y / A-H / Z-N play, +/- octave, Escape leaves
    if (e.repeat) { e.preventDefault(); return; }
    if (partyOpen()) { if (e.code === 'Escape' || e.code === 'Enter') closeParty(); e.preventDefault(); return; }
    setJamInput('keys');
    const row = JAM_KEYS.findIndex(r => r.includes(e.code));
    const drum = jam.drums ? +Object.keys(DRUM_KEYS).find(d => DRUM_KEYS[d] === e.code) : NaN;
    if (e.code === 'Tab') setDrums(!jam.drums);
    else if (jam.drums) { if (!isNaN(drum)) playDrum(drum); else if (e.code === 'Escape') closeJam(); }
    else if (row >= 0) playPad(row, JAM_KEYS[row].indexOf(e.code), 'k' + e.code);
    else if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'BracketRight' || e.code === 'ArrowRight') setOctave(1);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'BracketLeft' || e.code === 'ArrowLeft') setOctave(-1);
    else if (e.code === 'Escape') closeJam();
    e.preventDefault();
    return;
  }
  if (game.picking && stageOpen()) {   // Jam Stage plot: Enter builds, Escape closes
    if (e.code === 'Enter' || e.code === 'Space') buildJamStage();
    else if (e.code === 'Escape') closeStage();
    e.preventDefault();
    return;
  }
  if (game.picking && shopOpen()) {   // shop: arrows pick, Enter buys, Tab / Q / E switch tabs, [ / ] scales, Escape closes
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) { document.body.classList.add('keys'); shopFocus = gridStep(shopCards(), shopFocus, nav); refreshShop(); }
    else if (/^(Tab|KeyQ|KeyE)$/.test(e.code)) setShopTab(shopTab === 'decor' ? 'music' : 'decor');
    else if (shopTab === 'music' && /^Bracket(Left|Right)$/.test(e.code)) nextScale(e.code === 'BracketLeft' ? -1 : 1);
    else if (e.code === 'Enter' || e.code === 'Space') shopBuy();
    else if (e.code === 'Escape') closeShop();
    e.preventDefault();
    return;
  }
  if (decor.on && !game.picking) {   // Decorate: arrows move, Tab/X next, R turns, S shop, Enter/Escape done
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) nudgePiece(nav);
    else if (e.code === 'Tab' || e.code === 'KeyX') nextPiece();
    else if (e.code === 'KeyR') rotatePiece();
    else if (e.code === 'KeyS') openShop();
    else if (e.code === 'Enter' || e.code === 'Escape') exitDecor();
    e.preventDefault();
    return;
  }
  if (game.picking && buildsOpen()) {   // Farm Buildings: arrows pick, Enter opens, Escape closes
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) { document.body.classList.add('keys'); buildsNav(nav); }
    else if (e.code === 'Enter' || e.code === 'Space') buildAct();
    else if (e.code === 'Escape') closeBuilds();
    e.preventDefault();
    return;
  }
  if (game.picking && bunkOpen()) {   // Bunkhouse: arrows pick a hopper, Enter builds or invites
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) { document.body.classList.add('keys'); bunkNav(nav); }
    else if (e.code === 'Enter' || e.code === 'Space') bunkAct();
    else if (e.code === 'Escape') closeBunk();
    e.preventDefault();
    return;
  }
  if (game.picking) {   // arrow keys + Enter work in the picker too
    const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.code];
    if (nav) { document.body.classList.add('keys'); heroNav(nav); }
    else if (e.code === 'Enter' || e.code === 'Space') pickHero(shownCards()[heroFocus].dataset.id);
    else if (e.code === 'Escape') closeHeroes();
    e.preventDefault();
    return;
  }
  if (game.state === 'farm' && !game.picking && swingCam.on) {   // on the swing: look around like fishing; Space, Enter or Escape hops off
    const turn = { KeyA: 1, KeyD: -1, ArrowLeft: 1, ArrowRight: -1 }[e.code], tilt = { KeyW: -1, KeyS: 1, ArrowUp: -1, ArrowDown: 1 }[e.code], zoom = { KeyQ: -1, KeyE: 1 }[e.code];
    if (turn) swingCam.spin = turn;
    else if (tilt) swingCam.tilt = tilt;
    else if (zoom) swingCam.zoomSpin = zoom;
    else if (['Space', 'Enter', 'Escape'].includes(e.code)) dismount(walkerOf(myKey()));
    e.preventDefault();
    return;
  }
  if (game.state === 'farm' && !game.picking) {   // fishing: Space or Enter casts and reels, F or Escape stops
    const meF = fishers.get(myKey()), kp = keysPlayer(), kf = kp && fishers.get('p' + kp);
    const turn = { KeyA: 1, KeyD: -1, ...(kp ? {} : { ArrowLeft: 1, ArrowRight: -1 }) }[e.code];
    if (meF && turn) { fishCam.spin = turn; e.preventDefault(); return; }
    const tilt = { KeyW: -1, KeyS: 1, ...(kp ? {} : { ArrowUp: -1, ArrowDown: 1 }) }[e.code], zoom = { KeyQ: -1, KeyE: 1 }[e.code];
    if (meF && tilt) { fishCam.tilt = tilt; e.preventDefault(); return; }
    if (meF && zoom) { fishCam.zoomSpin = zoom; e.preventDefault(); return; }
    if (meF && ['Space', 'Enter', 'Escape', 'KeyF'].includes(e.code)) {
      if (e.code === 'Escape' || e.code === 'KeyF') stopFish(myKey());
      else if (!e.repeat) fishPress(meF, true, 'keys', e.timeStamp / 1000);
      e.preventDefault();
      return;
    }
    if (kp && e.code === 'ShiftRight') { toggleFish('p' + kp, 'arrows'); e.preventDefault(); return; }   // the keyboard friend
    if (kf && e.code.startsWith('Arrow')) { if (!e.repeat) fishPress(kf, true, undefined, e.timeStamp / 1000); e.preventDefault(); return; }
    if (e.code === 'KeyF') { goFish(myKey(), 'keys'); return; }
  }
  if (game.state === 'farm') {          // Enter starts the day, P opens the pond, B the buildings, C picks a hopper
    if (e.code === 'Enter' || e.code === 'Space') { goRoad(); e.preventDefault(); }
    else if (e.code === 'KeyP') openPond();
    else if (e.code === 'KeyB') openBuilds();
    else if (e.code === 'KeyE') enterDecor();
    else if (e.code === 'KeyJ') stageAct();
    else if (e.code === 'KeyC') openHeroes();
    else if (e.code === 'KeyO') openSettings();
    else if (KEYS[e.code] && keysPlayer() && e.code.startsWith('Arrow')) { if (!e.repeat && !game.picking) onPlayer(keysPlayer(), { t: 'hop', dx: KEYS[e.code][0], dr: KEYS[e.code][1] }); e.preventDefault(); }
    else if (KEYS[e.code] && hostFarmHop(...KEYS[e.code])) e.preventDefault();
    return;
  }
  if (game.state === 'over' && (e.code === 'Space' || e.code === 'Enter')) { goFarm(); return; }
  if (game.state !== 'title' && game.state !== 'play') return;
  if (e.code === 'Space' && !e.repeat) { move(0, 1); e.preventDefault(); return; }
  const k = KEYS[e.code];
  if (k && !e.repeat && keysPlayer() && e.code.startsWith('Arrow')) { onPlayer(keysPlayer(), { t: 'hop', dx: k[0], dr: k[1] }); e.preventDefault(); return; }   // the keyboard player
  if (k && !e.repeat) { move(...k); e.preventDefault(); }
});

$('play').addEventListener('click', () => { sfx.ensure(); goFarm(); });
// Look: ?look=bold in the URL wins, otherwise the last one picked on this device.
applyLook();
const soundBtn = $('sound');
soundBtn.classList.toggle('muted', sfx.muted);
soundBtn.addEventListener('click', () => { sfx.ensure(); soundBtn.classList.toggle('muted', sfx.toggle()); });

// ---------- main loop ----------
let last = performance.now();
function step(dt) {
  if (GUEST && game.where === 'road') dt = guestRoadDt(dt);   // keep in time with the host's road
  game.time += dt;
  if (game.where === 'road') {
    game.roadT += dt;
    if (!GUEST) tellRoad();
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
  updateTip(dt);
  updateFishing(dt);
  if (game.where === 'road') ensureLanes();
  updateParts(dt);
  if (game.state === 'play' && game.crew.some(h => h.alive && !h.parked)) {   // the day wears on
    game.day -= dayDrain(game.score) * dt;
    if (game.day <= 0) { game.day = 0; for (const h of game.crew) if (h.alive && !h.parked) die('night', null, null, h); }
  }
  game.dawn = Math.min(1, game.dawn + dt * 0.4);   // after the sunrise, the road brightens to full day
  game.light = game.where === 'farm' ? farmLight() : Math.min(game.day, game.dawn);
  updateDay();
  if (music && Math.abs(game.light - (music.day ?? -1)) > 0.02) { music.day = game.light; music.setDay(game.light); }
  updateFlies(dt);
  hudDay();
  if (!jam.open) renderCel();   // the Jam Stage covers the whole screen and draws its own picture
}
function frame(now) {
  pollPad();
  const dt = (now - last) / 1000;
  if (!game.frozen) { watchFrames(dt); step(Math.min(0.05, dt)); }   // frozen: tests drive the frames themselves
  if (jam.open) jamFrame(Math.min(0.05, dt));
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
  const shot = (h, size, cy, half, clipBelow, turn = Math.PI - 0.45) => {
    r.setSize(size, size, false);
    r.clippingPlanes = clipBelow == null ? [] : [new THREE.Plane(new THREE.Vector3(0, 1, 0), -clipBelow)];
    const m = h.build();
    m.group.rotation.y = turn;   // three-quarter view, facing the camera
    sc.add(m.group);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
    cam.position.set(0, cy + 1.2, 10);
    cam.lookAt(0, cy, 0);
    r.render(sc, cam);
    sc.remove(m.group);
    return r.domElement.toDataURL('image/png');
  };
  // Head and shoulders of every hopper, for the button that picks your hopper: framed
  // like Betty Lou's, moved up or down by how much taller or shorter each one is.
  const built = HEROES.map(h => h.build()), tops = built.map(m => new THREE.Box3().setFromObject(m.group).max.y);
  const LIFT = { catstar: -0.42, moonbun: -0.15 };   // springs and ears stand tall above the face
  const heads = built.map((m, i) => { const d = tops[i] - tops[0] + (LIFT[HEROES[i].id] || 0); return shot({ build: () => m }, 160, 1.08 + d, 0.72, 0.74 + d); });
  const cards = HEROES.map(h => shot(h, 256, 0.8, 0.98));
  const decor = DECOR.map(id => shot({ build: () => { const group = new THREE.Group(); PIECES[id].build(group); group.scale.setScalar(PIECES[id].icon || 1); return { group }; } }, 256, 0.9, 1.1, null, -0.45));
  const builds = BUILDINGS.map(b => shot({ build: () => {   // each building as it looks once built, whether it is yet or not
    const group = new THREE.Group(), was = [farm[b.id], farm[b.flag]];
    farm[b.id] = group; farm[b.flag] = true;
    b.draw();
    [farm[b.id], farm[b.flag]] = was;
    return { group };
  } }, 256, 1.0, 1.75, null, -0.45));
  const fish = FISH.map(sp => shot({ build: () => fishModel(sp) }, 192, 0.5, 0.7, null, 0.35));
  r.dispose();
  r.forceContextLoss();
  return { heads, cards, decor, builds, fish };
}

const shots = renderPortraits();
// Your hopper's face on the button, on the same colour as their card in the hopper picker.
const darken = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
function showHeroBtn() {
  const i = Math.max(0, HEROES.findIndex(h => h.id === heroId)), bg = HEROES[i].bg;
  document.querySelectorAll('.heroBtn').forEach(b => {
    b.querySelector('img').src = shots.heads[i];
    b.style.setProperty('--c1', bg);
    b.style.setProperty('--c2', darken(bg, 0.86));
  });
}
showHeroBtn();
const heroGrid = $('heroGrid');
HEROES.forEach((h, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard';
  card.dataset.id = h.id;
  card.style.background = h.bg;
  card.innerHTML = `<img class="cutout" alt="" src="${shots.cards[i]}"><span class="heroName">${heroName(h.id)}</span>`;
  card.hidden = !owned.has(h.id);   // hoppers still waiting in the Bunkhouse stay hidden
  card.addEventListener('click', () => pickHero(h.id));
  heroGrid.append(card);
});
const shownCards = () => [...heroGrid.children].filter(c => !c.hidden && c.dataset.id);   // not the Host Hoppers heading
// Arrow keys / d-pad through a grid of cards, however many columns fit the screen.
function gridStep(cards, i, dir) {
  const cols = Math.max(1, cards.filter(c => c.offsetTop === cards[0].offsetTop).length);
  const n = i + { left: -1, right: 1, up: -cols, down: cols }[dir];
  if (n < 0 || n >= cards.length) return i;
  if ((dir === 'left' || dir === 'right') && Math.floor(n / cols) !== Math.floor(i / cols)) return i;
  return n;
}
const anyPanel = () => !!document.querySelector('.sheet.show');
let heroFocus = 0;   // highlighted card (among the shown ones) when choosing with a controller or arrow keys
function markHero() {
  showHeroBtn();
  for (const c of heroGrid.children) c.classList.toggle('on', c.dataset.id === heroId);
  shownCards().forEach((c, i) => c.classList.toggle('focus', i === heroFocus));
}
function heroNav(dir) {
  heroFocus = gridStep(shownCards(), heroFocus, dir);
  markHero();
}
function openHeroes() {
  stopFish(myKey());   // a new hopper would leave the rod behind
  heroFocus = Math.max(0, shownCards().findIndex(c => c.dataset.id === heroId));
  markHero();
  $('heroes').classList.add('show');
  game.picking = true;
}
function closeHeroes() {
  $('heroes').classList.remove('show');
  game.picking = anyPanel();
}
function pickHero(id) {
  if (GUEST) guestNet.send({ t: 'pick', hero: id });   // the host has the last word (another friend may have it)
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
const needText = short => short <= 0 ? '' : short === 1 ? t('pondNeed1') : t('pondNeedN', { n: short });
function refreshPond() {
  const cost = pondCost(farm.level), short = cost - game.coins;
  $('pondLevel').textContent = farm.level === 0 ? t('pondMuddy') : t('pondLevel', { n: farm.level });
  $('pondNext').textContent = pondNext(farm.level);
  $('pondCost').textContent = cost;
  $('pondBuy').disabled = short > 0;
  $('pondNeed').textContent = needText(short);
  $('bagN').textContent = bagCount() || '';
}
function openPond() {
  if (GUEST) { goFish(myKey(), document.body.classList.contains('pad') ? 'pad' : 'tap'); return; }   // a guest can't buy, but can fish
  if (game.state !== 'farm') return;
  refreshPond();
  $('pond').classList.add('show');
  game.picking = true;
}
function closePond() {
  $('pond').classList.remove('show');
  game.picking = anyPanel();
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

// ---------- Fishing ----------
// Go fishing from the Fish Pond panel, by tapping the dock, or (friends) by tapping
// the pond. Your hopper hops to the dock, or to a free spot on the bank, and gets
// a rod out. Cast, wait for the bobber to dip, then hook it in time, and reel it
// in by tapping along with the music (see startReel). Everything caught goes in
// the Fish Book, and every fish (not the boots) into your Fish Backpack.
// Everyone can fish at once: you, friends on this screen (X to fish, A to reel,
// B to stop; the keyboard friend Right Shift and the up arrow), and guests on
// their own devices, who each see everyone else's rod and bobber and catches.
const FISH_KEY = 'bl-fish';
let fishBook = store.get(FISH_KEY, {});            // id -> { n: how many, best: biggest in cm }
const fishers = new Map();                         // walker key -> someone fishing on this screen
const seen = new Map();                            // walker key -> someone fishing on another screen (just their rod)
const catches = [];                                // catch cards floating over hoppers
const DOCK_Y = 0.15;
let fishPtr = null;                                // the finger or mouse button reeling for you
const fishTouch = new Map();                       // every finger down while fishing
let fishPinch = 0;
const pondPiece = () => farm.pieces.pond;
const farmToPond = (x, z) => {                     // a farm point in the pond's own space
  const p = pondPiece(), a = p.r * Math.PI / 2, c = Math.cos(a), s = Math.sin(a), dx = x - p.x, dz = z - p.z;
  return [dx * c - dz * s, dx * s + dz * c];
};
const fishName = id => t('fish.names.' + id);
// Where to stand: the end of the dock if there is one and it's free, else the
// nearest free spot on the bank that isn't up against something else.
function fishSpot(w) {
  const [rx, rz] = farm.pondR, p = pondPiece();
  const taken = [...fishers.values(), ...seen.values()].filter(f => f.w !== w).map(f => f.spot);
  if (farm.level >= 3 && !taken.some(s => s.dock)) {
    return { dock: true, at: pieceToFarm(p, rx * 0.55, rz * 0.75 - 0.4), land: pieceToFarm(p, rx * 0.55, rz + 0.8), aim: [rx * 0.55, -rz * 0.25] };
  }
  let best = null, bd = Infinity;
  for (let i = 0; i < 24; i++) {
    const th = i / 24 * Math.PI * 2, lx = Math.cos(th) * (rx + 0.6), lz = Math.sin(th) * (rz + 0.6);
    if (farm.level >= 3 && Math.abs(lx - rx * 0.55) < 0.7 && lz > 0) continue;   // not across the dock
    if (TORCH_AT.some(a => Math.abs(Math.atan2(Math.sin(th - a), Math.cos(th - a))) < 0.5)) continue;   // nor right by a torch
    const [x, z] = pieceToFarm(p, lx, lz);
    if (x < YARD.x0 || x > YARD.x1 || z < YARD.z0 || z > YARD.z1 || blockedAt(x, z)) continue;
    if (taken.some(s => Math.hypot(s.at[0] - x, s.at[1] - z) < 1)) continue;
    const d = Math.hypot(x - w.x, z - w.z);
    if (d < bd) { bd = d; best = { at: [x, z], land: [x, z], aim: [Math.cos(th) * rx * 0.4, Math.sin(th) * rz * 0.4] }; }
  }
  return best;
}
// via: how they're playing, for the prompts: 'tap', 'pad', 'keys' (Space) or 'arrows'.
function goFish(key, via) {
  if (game.state !== 'farm' || decor.on || jam.open || fishers.has(key)) return;
  const w = walkerOf(key);
  if (!w || w.hidden) return;
  if (w.sit) standUp(w);   // off the swing first
  closePond();
  if (farm.level < 1) { if (key === myKey()) bettySays(t('fish.noFish')); sfx.bump(); return; }
  const spot = fishSpot(w);
  if (!spot) { sfx.bump(); return; }
  const f = { key, w, via, spot, st: 'walk', t: 0, tell: 0, hold: false, tapped: false, msg: '', msgT: 0, say: null, ui: fishUi(), rig: addRig(w) };
  fishers.set(key, f);
  w.fishing = true;
  w.goal = w.queued = null;
  hopToward(key, ...spot.land);
  if (key === myKey()) {
    document.body.classList.add('fishing');
    farmCam.x = clamp(spot.at[0], FARM_PAN.x0, FARM_PAN.x1);
    farmCam.z = clamp(spot.at[1] + 1.4, FARM_PAN.z0, FARM_PAN.z1);
  }
  sfx.pick();
}
function stopFish(key) {
  const f = fishers.get(key);
  if (!f) return;
  fishers.delete(key);
  f.ui.remove();
  dropRig(f.rig);
  const w = f.w;
  w.fishing = false;
  w.wait = STEER_IDLE;
  if (w.y) { w.y = 0; landLeap(w, ...f.spot.land, 0.4); }   // hop back off the dock
  if (f.st !== 'walk' && f.st !== 'settle') tellFish(f, false);
  if (key === myKey()) { document.body.classList.remove('fishing', 'reeling'); fishPtr = null; fishTouch.clear(); }
}
function stopAllFishing() {
  for (const key of [...fishers.keys()]) stopFish(key);
  for (const [key, s] of seen) { dropRig(s.rig); s.w.fishing = false; s.w.y = 0; seen.delete(key); }
}
const toggleFish = (key, via) => fishers.has(key) ? stopFish(key) : goFish(key, via);
// at: when it happened (an input event's timeStamp, in seconds): the reel judges the
// moment of the tap, not the frame that gets round to it.
function fishPress(f, down, via, at = performance.now() / 1000) {
  if (via) f.via = via;
  if (down && !f.hold) { f.tapped = true; f.tapAt = at; }
  f.hold = down;
}

// The rod in the hopper's hands, the bobber and the line between them.
const ROD_GEO = (() => {
  const v = new VB(0.6);
  v.cyl(0.012, 0.024, 0.95, 0, 0.475, 0, 0x8a5a33);
  v.cyl(0.032, 0.032, 0.16, 0, 0.1, 0, 0x3a2442);                        // the handle
  v.cyl(0.05, 0.05, 0.04, 0.045, 0.24, 0, 0xc9cfd4, 0, 0, Math.PI / 2);    // the reel
  return v.geometry();
})();
const BOB_GEO = (() => {
  const v = new VB(0.6);
  v.ball(0.06, 0.06, 0.06, 0, 0.03, 0, (x, y) => y > 0.03 ? 0xff4b4b : 0xffffff);
  v.cyl(0.008, 0.008, 0.06, 0, 0.11, 0, 0x3a2442);
  return v.geometry();
})();
const LINE_MAT = new THREE.LineBasicMaterial({ color: 0x3a2442 });
const _tip = new THREE.Vector3();
// Where each hopper holds the rod: in its right hand, or LeafWish's left (her wand's in the right).
const GRIP = { leafwish: [-0.33, 0.5, -0.02] };
function addRig(w) {
  const rod = new THREE.Mesh(ROD_GEO, VMAT), [gx, gy, gz] = GRIP[w.id] || [0.21, 0.31, -0.03];
  rod.position.set(gx, gy - 0.035, gz + 0.05);       // the handle runs through the hand
  rod.rotation.set(-0.95, 0, gx > 0 ? 0.15 : -0.15); // tipped out in front, toward the middle
  w.m.inner.add(rod);                                // so it hops and sways with them
  const bob = new THREE.Mesh(BOB_GEO, VMAT);
  bob.visible = false;
  farm.group.add(bob);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), LINE_MAT);
  line.frustumCulled = false;
  line.visible = false;
  line.layers.set(GLOW_LAYER);                       // a hairline, no ink outline
  farm.group.add(line);
  return { w, rod, bob, line, bx: 0, bz: 0, k: 1 };
}
function dropRig(rig) {
  rig.rod.removeFromParent();
  farm.group.remove(rig.bob, rig.line);
  rig.line.geometry.dispose();
}
function drawRig(rig, st, t) {
  const out = st === 'fly' || st === 'wait' || st === 'bite' || st === 'reel';
  rig.bob.visible = rig.line.visible = out;
  rig.rod.rotation.x = st === 'reel' ? -0.55 + Math.sin(t * 22) * 0.06 : st === 'bite' ? -0.8 : -0.95;
  if (!out) return;
  rig.rod.updateWorldMatrix(true, false);
  farm.group.worldToLocal(rig.rod.localToWorld(_tip.set(0, 0.95, 0)));
  let x = rig.bx, z = rig.bz, y = 0.07 + Math.sin(t * 3 + rig.bx * 5) * 0.012;
  if (st === 'bite') y -= 0.05 + Math.abs(Math.sin(t * 25)) * 0.03;
  if (st === 'reel') y -= 0.03 + Math.sin(t * 13) * 0.02;
  if (st === 'fly') {                                // flying out on an arc
    const k = rig.k;
    x = lerp(_tip.x, x, k); z = lerp(_tip.z, z, k);
    y = lerp(_tip.y, y, k) + Math.sin(Math.PI * k) * 0.6;
  }
  rig.bob.position.set(x, y, z);
  const pos = rig.line.geometry.attributes.position;
  pos.setXYZ(0, _tip.x, _tip.y, _tip.z);
  pos.setXYZ(1, x, y + 0.13, z);
  pos.needsUpdate = true;
}

// What's biting: any kind whose level the pond has reached (a level 3 pond has
// level 1, 2 and 3 fish), the common ones more often; the night fish only after dark.
function rollFish() {
  const dark = nightK() > 0.25;
  const can = FISH.filter(sp => sp.lvl <= farm.level && (!sp.night || dark));
  let r = Math.random() * can.reduce((n, sp) => n + sp.w, 0);
  for (const sp of can) if ((r -= sp.w) <= 0) return sp;
  return can[0];
}
function setSt(f, st, time = 0) {
  f.st = st;
  f.t = time;
  f.ui.classList.toggle('reeling', st === 'reel');
  if (f.key === myKey()) document.body.classList.toggle('reeling', st === 'reel');   // the Fish Book and Done buttons step aside
  tellFish(f);
}
function say(f, key) { f.msg = t('fish.' + key); f.msgT = 1.4; }
function cast(f) {
  const [ax, az] = f.spot.aim, j = () => (Math.random() - 0.5) * 0.4;
  [f.rig.bx, f.rig.bz] = pieceToFarm(pondPiece(), ax + j(), az + j());
  f.rig.k = 0;
  sfx.cast();
  setSt(f, 'fly', 0.5);
}
function stepFisher(f, dt) {
  const w = f.w, tap = f.tapped;
  f.tapped = false;
  f.t -= dt;
  f.msgT -= dt;
  switch (f.st) {
    case 'walk':                                     // hopping over; arrived (or stuck): one last hop onto the spot
      if (w.leap || w.goal) break;
      landLeap(w, ...f.spot.at, 0.45);
      if (f.spot.dock) w.y = DOCK_Y;
      f.st = 'settle';
      break;
    case 'settle':
      if (w.leap) break;
      { const [ax, az] = pieceToFarm(pondPiece(), ...f.spot.aim); w.face = Math.atan2(-(ax - w.x), -(az - w.z)); }
      setSt(f, 'ready');
      break;
    case 'ready': if (tap) cast(f); break;
    case 'fly':
      f.rig.k = clamp(1 - f.t / 0.5, 0, 1);
      if (f.t <= 0) {
        sfx.plop();
        burst(f.rig.bx, 0.08, FARM_Z + f.rig.bz, [0xffffff, 0xbfe9ff], 5, 0.5, 2, 0.05, 0.4);
        setSt(f, 'wait', 1.5 + Math.random() * 4.5);
      }
      break;
    case 'wait':
      if (tap) { say(f, 'soon'); sfx.bump(); setSt(f, 'ready'); }
      else if (f.t <= 0) {
        f.sp = rollFish();
        sfx.bite();
        burst(f.rig.bx, 0.08, FARM_Z + f.rig.bz, [0xffffff, 0xbfe9ff], 8, 0.8, 2.5, 0.06, 0.5);
        setSt(f, 'bite', 1.1);
      }
      break;
    case 'bite':
      if (tap) startReel(f);
      else if (f.t <= 0) { say(f, 'away'); sfx.lost(); setSt(f, 'ready'); }
      break;
    case 'reel': reelGame(f, tap); break;
    case 'show': if (f.t <= 0 || (tap && f.t < 2)) setSt(f, 'ready'); break;
  }
}
// Reeling in, to the music: notes slide along a lane toward the ring on the
// song's own beat, and a tap as one reaches the ring catches it, sung in the
// hopper's voice up the scale. A fish's level sets the rhythm it fights with:
// level 1 is plain quarter notes; then eighths, off-beats, dotted rhythms, and at
// the top, runs of sixteenths. Harder fish also have a tighter window and allow
// fewer misses. A tap with no note at the ring costs the next one.
const BEAT = 60 / 84, SIXTEENTH = BEAT / 4;   // the song's beat (84 BPM)
const songNow = () => performance.now() / 1000;
// One beat's worth of rhythm each: which sixteenths of the beat have a note (0 is
// on the beat, 2 the "and", 1 and 3 the sixteenths between), and the fish level
// that first uses it.
const RHYTHMS = [   // lvl here is the fish's rhy: the first two only ever land right on the beat
  { at: [0], lvl: 1 },             // quarter, on the beat
  { at: [], lvl: 2 },              // a rest
  { at: [0, 2], lvl: 3 },          // two eighths
  { at: [2], lvl: 4 },             // off the beat
  { at: [0, 3], lvl: 5 },          // dotted eighth, sixteenth
  { at: [0, 1], lvl: 6 },          // sixteenth, dotted eighth
  { at: [0, 2, 3], lvl: 7 },       // eighth, two sixteenths
  { at: [0, 1, 2], lvl: 7 },       // two sixteenths, eighth
  { at: [1, 2, 3], lvl: 8 },       // a sixteenth rest, then three
  { at: [0, 1, 2, 3], lvl: 9 },    // four sixteenths
];
function fishRhythm(lvl) {   // [sixteenths from the start, ...]: a phrase a few beats long
  const can = RHYTHMS.filter(r => r.lvl <= lvl);
  const pick = () => {   // the newest rhythms this fish knows come up most
    let r = Math.random() * can.reduce((n, c) => n + 1 + c.lvl, 0);
    for (const c of can) if ((r -= 1 + c.lvl) <= 0) return c;
    return can[0];
  };
  const beats = Math.min(4 + lvl, 12), out = [];
  for (let b = 0; b < beats; b++) {
    const c = b === 0 || b === beats - 1 ? RHYTHMS[0] : pick();   // starts and ends on a plain beat, to find your feet
    for (const s of c.at) out.push(b * 4 + s);
  }
  return out;
}
// With the drum and bass tune on, the notes are the break itself: the snare's
// backbeat first, then kicks, the kick that skips in a sixteenth early, ghost
// notes and, at the top, the snare rolls of the fill.
function breakRhythm(lvl, from) {
  const beats = Math.min(4 + lvl, 12), out = [];
  for (let s = 0; s < beats * 4; s++) { const d = breakHit(from + s); if (d && d <= lvl) out.push(s); }
  return out;
}
function startReel(f) {
  const lvl = Math.min(f.sp.rhy || f.sp.lvl, 9);   // how tricky its rhythm is, not the pond level it came with
  const h = music ? music.heard() : { pos: 0, at: songNow(), swing: 0 };   // the beat as it comes out of the speakers
  const start = h.at + (BEAT - h.pos % BEAT) + 2 * BEAT;   // on the beat, a couple of beats from now
  const dnb = music?.style === 'dnb';
  const steps = dnb ? breakRhythm(lvl, music.stepAt(h.pos + start - h.at)) : fishRhythm(lvl), notes = [];
  const lane = f.ui.querySelector('.lane');
  lane.classList.toggle('dnb', dnb);
  lane.querySelectorAll('.note').forEach(e => e.remove());
  for (const s of steps) {
    const el = document.createElement('i');
    el.className = 'note' + (s % 4 === 0 ? '' : s % 2 ? ' sixteenth' : ' eighth');   // coloured by where in the beat it falls
    lane.append(el);
    notes.push({ at: start + s * SIXTEENTH + (s % 2 ? h.swing * SIXTEENTH : 0), el, done: 0 });   // the tune swings its off-sixteenths; done: 1 caught, -1 missed
  }
  const fast = steps.some(s => s % 2) ? 2 : steps.some(s => s % 4) ? 3 : 4;   // closer notes: the lane shows fewer beats, so they spread out
  const k = (lvl - 1) / 8;
  f.g = {
    notes, ahead: fast * BEAT,
    win: Math.min(0.2 - k * 0.11, SIXTEENTH * 0.48),            // 0.2 s either side down to under half a sixteenth
    need: Math.ceil(notes.length * (0.5 + k * 0.35)),           // half the notes, up to 85%
    hits: 0, miss: 0, sung: 0, offs: [], off: 0,
  };
  setSt(f, 'reel');
}
function judge(f, nt, ok, perfect) {
  const g = f.g;
  nt.done = ok ? 1 : -1;
  nt.el.classList.add(ok ? 'hit' : 'missed');
  if (ok) { g.hits++; sfx.note(f.w.id, padFreq(1, g.sung++ % SCALE.length)); }
  else g.miss++;
  say(f, ok ? (perfect ? 'perfect' : 'good') : 'miss');
  f.msgT = 0.5;
}
// Whatever lag is left (a slow screen, Bluetooth headphones, how someone hears the
// beat) the game learns: each reel, it looks at how early or late the taps landed and
// moves this device's offset half way there. It stays on the device.
// The player can set it themselves (Settings > Rhythm latency, or the Latency Helper's
// tap-along), and switch the learning off: it gets confused by players still finding
// the beat. It's applied wherever taps are judged against the music.
let beatLag = clamp(store.get('bl-beat-lag', 0.02), -0.1, 0.35);
let beatAuto = store.get('bl-beat-auto', false);
function setBeatLag(sec) {
  beatLag = clamp(Math.round(sec * 1000) / 1000, -0.1, 0.35);
  store.set('bl-beat-lag', beatLag);
}
function learnLag(g) {
  if (!beatAuto || g.offs.length < 4) return;
  const o = g.offs.sort((a, b) => a - b), mid = o[o.length >> 1];
  beatLag = clamp(beatLag + (mid - beatLag) * 0.5, -0.1, 0.35);
  store.set('bl-beat-lag', Math.round(beatLag * 1000) / 1000);
}
function reelGame(f, tap) {
  const g = f.g, now = songNow() - beatLag;
  if (tap) {
    const at = (f.tapAt ?? songNow()) - beatLag;
    const near = g.notes.filter(n => !n.done).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (near && Math.abs(near.at - at) < 0.25) g.offs.push(beatLag - (near.at - at));   // how late the tap really was (before the offset)
    if (near && Math.abs(near.at - at) > g.win && Math.abs(near.at - at) < 0.5) g.off++;   // there, but off the beat
    const nt = g.notes.find(n => !n.done && Math.abs(n.at - at) <= g.win);
    if (nt) judge(f, nt, true, Math.abs(nt.at - at) <= g.win * 0.45);
    else { const next = g.notes.find(n => !n.done && n.at - at < 0.5); if (next) judge(f, next, false); else sfx.bump(); }
  }
  for (const nt of g.notes) if (!nt.done && now - nt.at > g.win) judge(f, nt, false);
  if (g.notes.length - g.miss < g.need) { learnLag(g); offBeat(f); say(f, 'away'); sfx.lost(); setSt(f, 'ready'); }   // can't be caught now
  else if (g.notes.every(n => n.done)) { learnLag(g); offBeat(f); landFish(f); }
}
function logFish(id, cm) {   // into this device's Fish Book: is it a new kind, or the biggest yet?
  const was = fishBook[id];
  fishBook[id] = { n: (was?.n || 0) + 1, best: Math.max(was?.best || 0, cm) };
  store.set(FISH_KEY, fishBook);
  return { isNew: !was, isBest: !!was && cm > was.best };
}
function landFish(f) {
  const sp = f.sp, cm = Math.round(sp.cm[0] + (sp.cm[1] - sp.cm[0]) * Math.random() ** 1.6);
  const rec = logFish(sp.id, cm);
  if (sp.price) addToBag(sp.id);   // to sell from the Fish Pond, or craft with
  showCatch(f.w, sp, cm, rec);
  burst(f.rig.bx, 0.1, FARM_Z + f.rig.bz, [0xffffff, 0xbfe9ff, 0xffd23f], 14, 1.2, 3.5, 0.07, 0.6);
  sfx.splash();
  if (rec.isNew || rec.isBest) sfx.upgrade(); else if (sp.price) sfx.coin();
  const msg = { t: 'fc', k: f.key, sp: sp.id, cm };
  if (GUEST) guestNet.send(msg); else toGuests(msg);
  setSt(f, 'show', 3);
}
// A card over the hopper's head: the fish, its size, into the backpack, and New! or Best!
function showCatch(w, sp, cm, rec) {
  const el = document.createElement('div');
  el.className = 'fishCatch';
  const badge = rec?.isNew ? t('fish.new') : rec?.isBest ? t('fish.best') : '';
  el.innerHTML = `<div class="card"><img alt="" src="${shots.fish[FISH.indexOf(sp)]}"><b></b><span class="cm"></span>${sp.price ? `<span class="gain">+1 ${BAG_SVG}</span>` : ''}${badge ? '<i class="badge"></i>' : ''}</div>`;
  el.querySelector('b').textContent = fishName(sp.id);
  el.querySelector('.cm').textContent = t('fish.cm', { n: cm });
  if (badge) el.querySelector('.badge').textContent = badge;
  document.body.append(el);
  for (const c of catches.filter(c => c.w === w)) c.t = Math.min(c.t, 0);   // one card per hopper
  catches.push({ el, w, t: 3 });
}
// Tell everyone else on the farm what we're up to, so they see our rod and bobber.
function tellFish(f, on = true) {
  f.tell = 2;
  const w = f.w, st = f.st === 'show' || f.st === 'walk' || f.st === 'settle' ? 'ready' : f.st;
  const [x, z] = on ? [w.x, w.z] : f.spot.land;   // stopping: where they hop back to
  const msg = { t: 'fv', k: f.key, on, x, z, dock: !!f.spot.dock, face: w.face, st, bx: f.rig.bx, bz: f.rig.bz };
  if (GUEST) { if (f.key === myKey()) guestNet.send(msg); }
  else toGuests(msg);
}
function applyFishView(m) {
  const w = walkerOf(m.k);
  if (!w) return;
  let s = seen.get(m.k);
  const x = clamp(+m.x, FARM_BOUNDS.x0, FARM_BOUNDS.x1), z = clamp(+m.z, FARM_BOUNDS.z0, FARM_BOUNDS.z1);
  if (!isFinite(x) || !isFinite(z)) return;
  if (!m.on) {
    if (s) { dropRig(s.rig); seen.delete(m.k); }
    w.fishing = false;
    w.y = 0;
    w.wait = STEER_IDLE;
    if (Math.hypot(w.x - x, w.z - z) > 0.1) landLeap(w, x, z, 0.4);   // back off the dock
    return;
  }
  if (!s) { s = { w, rig: addRig(w), spot: null, st: 'ready' }; seen.set(m.k, s); }
  w.fishing = true;
  w.goal = w.leap = null;
  w.x = w.tx = x; w.z = w.tz = z;
  w.y = m.dock ? DOCK_Y : 0;
  if (isFinite(+m.face)) w.face = +m.face;
  s.spot = { at: [x, z], dock: !!m.dock };
  s.st = ['ready', 'fly', 'wait', 'bite', 'reel'].includes(m.st) ? m.st : 'ready';
  if (s.st === 'fly') s.st = 'wait';
  s.rig.bx = clamp(+m.bx || 0, FARM_BOUNDS.x0, FARM_BOUNDS.x1);
  s.rig.bz = clamp(+m.bz || 0, FARM_BOUNDS.z0, FARM_BOUNDS.z1);
}
function remoteCatch(m) {
  const sp = FISH.find(s => s.id === m.sp), w = walkerOf(m.k);
  if (sp && w) showCatch(w, sp, clamp(m.cm | 0, 1, 999), null);
}
// The host hears from a guest: their rod or a catch.
function guestFish(slot, m) {
  if (m.t === 'fsell') return;   // from before the backpack: a guest's fish now go home with them
  const msg = { ...m, k: 'p' + slot };
  if (m.t === 'fv') applyFishView(msg); else remoteCatch(msg);
  toGuests(msg, slot);
}

// On screen: a speech bubble with what to do, and the reel meter beside the hopper.
function fishUi() {
  const el = document.createElement('div');
  el.className = 'fishUi';
  el.innerHTML = '<div class="fishSay"></div><div class="reel"><div class="lane"><i class="ring"></i></div><b class="count"></b></div>';
  document.body.append(el);
  return el;
}
const _scr = new THREE.Vector3();
function screenAt(w, up) {   // a point over a hopper's head, in screen pixels
  w.m.group.getWorldPosition(_scr);
  _scr.y += w.top + up;
  _scr.project(camera);
  return [(_scr.x + 1) / 2 * innerWidth, (1 - _scr.y) / 2 * innerHeight];
}
function promptFor(f) {
  if (f.msgT > 0) return f.msg;
  const how = { tap: '', pad: 'Pad', keys: 'Keys', arrows: 'Arrows' }[f.via] ?? '';
  if (f.st === 'ready') return t('fish.cast' + how);
  if (f.st === 'wait') return '…';
  if (f.st === 'bite') return '!';
  if (f.st === 'reel' && !f.g.hits && !f.g.miss) return t('fish.reel' + how);
  return '';
}
function placeFishUi(f, hide) {
  const el = f.ui;
  el.classList.toggle('away', hide);
  if (hide) return;
  const [x, y] = screenAt(f.w, 0.25);
  el.style.transform = `translate(${x}px, ${y}px)`;
  const big = fishCam.on && f.key === myKey(), reel = el.querySelector('.reel');
  el.classList.toggle('big', big);
  if (big) Object.assign(reel.style, { left: `${innerWidth / 2 - x}px`, top: `${innerHeight - clamp(innerHeight * 0.3, 110, 196) - y}px`, bottom: 'auto' });
  else reel.removeAttribute('style');
  const text = promptFor(f);
  if (text !== f.say) {
    f.say = text;
    const s = el.querySelector('.fishSay');
    s.textContent = text;
    s.classList.toggle('bite', text === '!');
  }
  if (f.st === 'reel') {   // the notes, sliding in toward the ring
    const now = songNow();
    for (const nt of f.g.notes) {
      const k = (nt.at - now) / f.g.ahead;
      nt.el.style.left = `calc(22px + ${k} * (100% - 36px))`;
      nt.el.hidden = k > 1.05 || k < -0.12;
    }
    el.querySelector('.count').textContent = `${f.g.hits}/${f.g.need}`;
  }
}
function updateFishing(dt) {
  if (game.where !== 'farm') return;
  const t = game.time, paused = game.picking;
  for (const f of fishers.values()) {
    if (!paused) stepFisher(f, dt);
    else if (f.st === 'reel') for (const nt of f.g.notes) nt.at += dt;   // a menu open: the notes wait
    drawRig(f.rig, f.st, t);
    placeFishUi(f, paused);
    if ((f.tell -= dt) < 0 && f.st !== 'walk' && f.st !== 'settle') tellFish(f);   // now and then, for anyone who just arrived
  }
  for (const s of seen.values()) drawRig(s.rig, s.st, t);
  for (let i = catches.length - 1; i >= 0; i--) {
    const c = catches[i];
    if ((c.t -= dt) <= 0 || !farm.walkers.includes(c.w)) { c.el.remove(); catches.splice(i, 1); continue; }
    const [x, y] = screenAt(c.w, 0.35);
    c.el.style.transform = `translate(${x}px, ${y}px)`;
    c.el.classList.toggle('away', paused);
  }
}
// ---------- the fishing camera ----------
// Once your hopper is at the water, the camera drops down beside them: side on and
// close, the line, the bobber and the pond in view, with the beat lane underneath.
// It turns around them with a drag (while there's nothing on the line), A and D,
// or a controller's right stick or shoulder buttons.
// Drag up and down (or W / S, the right stick) to tilt it; zoom with the mouse wheel,
// a pinch, Q / E or the triggers. Tilt and zoom are remembered on this device.
const FISH_PITCH = [0.18, 1.25], FISH_ZOOM = [0.55, 1.8], FISH_SHADOW = 5;
const fishView = { pitch: 0.62, zoom: 1, ...store.get('bl-fishcam', {}) };
const fishCam = { on: false, yaw: 0, shown: 0, spin: 0, tilt: 0, zoomSpin: 0, swoop: 1, pitch: fishView.pitch, look: new THREE.Vector3() };
let fishViewTimer = null;
function setFishView(pitch, zoom) {
  fishView.pitch = clamp(pitch, ...FISH_PITCH);
  fishView.zoom = clamp(zoom, ...FISH_ZOOM);
  clearTimeout(fishViewTimer);
  fishViewTimer = setTimeout(() => store.set('bl-fishcam', { pitch: +fishView.pitch.toFixed(3), zoom: +fishView.zoom.toFixed(3) }), 600);
}
let fishDrag = null;                                 // a drag that turns the camera, or a tap that casts
const _fcLook = new THREE.Vector3();
const camFisher = () => { const f = fishers.get(myKey()); return f && f.st !== 'walk' && f.st !== 'settle' && !decor.on ? f : null; };
// Clouds for the views that look up at the sky (fishing, and the hopping game): puffy
// heaps in a ring out past the fog (which they ignore), white on top and a little blue
// beneath. The ring follows the camera like a faraway sky, drifts slowly round, and
// takes on the sky's colour as it gets dark.
const clouds = (() => {
  const vb = new VB(0.6), was = rnd;
  rnd = seeded(20261029);   // the same sky every time
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + rand(-0.15, 0.15), r = rand(44, 60), y = rand(5.5, 11), s = rand(1.4, 2.6);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, tx = -Math.sin(a), tz = Math.cos(a);   // puffs strung out across the view
    const tone = (_x, py) => py < y + s * 0.15 ? 0xdbe8f6 : 0xffffff;
    for (let k = 0, n = ri(3, 5); k < n; k++) {
      const u = (k - (n - 1) / 2) * s * 0.9 + rand(-0.3, 0.3), big = s * (k === n >> 1 ? 1.25 : rand(0.75, 1));
      vb.ball(big * 1.2, big * 0.85, big, cx + tx * u, y + big * 0.3, cz + tz * u, tone);
    }
    vb.ball(s * 2.2, s * 0.45, s * 1.1, cx, y, cz, tone, 0, -a + Math.PI / 2, 0);   // a flat underside to sit on
  }
  rnd = was;
  const m = vb.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.castShadow = m.receiveShadow = false;
  m.visible = false;
  scene.add(m);
  return m;
})();
const _white = new THREE.Color(0xffffff);
function skyClouds(dt, x, z) {
  clouds.visible = true;
  clouds.position.set(x, 0, z);
  clouds.rotation.y += dt * 0.006;
  const lum = 0.2126 * skyCol.r + 0.7152 * skyCol.g + 0.0722 * skyCol.b;
  clouds.material.color.copy(skyCol).lerp(_white, clamp(lum * 1.3, 0, 1));
}
fishCamHook = dt => {
  const f = camFisher();
  if (!f) { Object.assign(fishCam, { on: false, yaw: 0, shown: 0, spin: 0, tilt: 0, zoomSpin: 0, swoop: 1, pitch: fishView.pitch }); return false; }
  useCamera(perspCam);
  skyClouds(dt, fishCam.look.x, fishCam.look.z);
  const w = f.w, base = farm.group.position, [ax, az] = pieceToFarm(pondPiece(), ...f.spot.aim);
  const dx = ax - w.x, dz = az - w.z, len = Math.hypot(dx, dz) || 1;
  let sx = -dz / len, sz = dx / len;                 // square on to the line
  if (sz < 0) { sx = -sx; sz = -sz; }                // from the front of the farm, to begin with
  fishCam.yaw += fishCam.spin * dt * 1.8;
  fishCam.shown += (fishCam.yaw - fishCam.shown) * Math.min(1, dt * 8);
  if (fishCam.tilt || fishCam.zoomSpin) setFishView(fishView.pitch + fishCam.tilt * dt * 0.9, fishView.zoom * Math.exp(fishCam.zoomSpin * dt * 1.2));
  fishCam.pitch += (fishView.pitch - fishCam.pitch) * Math.min(1, dt * 8);
  const c = Math.cos(fishCam.shown), s = Math.sin(fishCam.shown);
  [sx, sz] = [sx * c - sz * s, sx * s + sz * c];
  const halfW = Math.atan(Math.tan(perspCam.fov * Math.PI / 360) * perspCam.aspect);
  const dist = Math.max(4.4, (len + 1.2) / Math.tan(halfW));   // with the hopper in the middle, the bobber still fits, with room around
  const ty = (w.y || 0) + 0.92;   // the hopper's face (head height, at the hoppers' 1.3 scale) in the middle of the picture
  _fcLook.set(base.x + w.x, ty, base.z + w.z);
  if (!fishCam.on) { fishCam.on = true; fishCam.swoop = 1; fishCam.look.copy(_fcLook); }
  fishCam.swoop *= Math.exp(-dt * 3);                // swoop in from further out and higher up
  fishCam.look.lerp(_fcLook, Math.min(1, dt * 3));
  const d = dist * fishView.zoom * (1 + fishCam.swoop * 0.6), p = fishCam.pitch + fishCam.swoop * 0.25;
  camera.position.set(fishCam.look.x + sx * d * Math.cos(p), ty + d * Math.sin(p), fishCam.look.z + sz * d * Math.cos(p));
  camera.lookAt(fishCam.look);
  sun.position.copy(fishCam.look).add(SUN_OFF);
  sun.target.position.copy(fishCam.look);
  setShadowSpan(FISH_SHADOW);   // close up, shadows only need to cover the pond side: far finer detail on the hoppers
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  camera.updateMatrixWorld();
  return true;
};
// Did a tap on the pond land on the dock?
function onDock(pt) {
  if (farm.level < 3) return false;
  const [rx, rz] = farm.pondR, [lx, lz] = farmToPond(pt.x - farm.group.position.x, pt.z - farm.group.position.z);
  return Math.abs(lx - rx * 0.55) < 0.4 && Math.abs(lz - rz * 0.75) < 0.65;
}

// ---------- Fish Book ----------
// Every kind of fish: the ones you've caught with your biggest and how many, the
// rest a grey shape and "???" (with the pond level they need, if it's not there yet).
const bookOpen = () => $('book').classList.contains('show');
const bookGrid = $('bookGrid');
FISH.forEach((sp, i) => {
  const card = document.createElement('div');
  card.className = 'heroCard';
  card.innerHTML = `<img class="cutout" alt="" src="${shots.fish[i]}"><span class="heroName"></span><span class="lvl"></span><i class="tag"></i>`;
  bookGrid.append(card);
});
function refreshBook() {
  [...bookGrid.children].forEach((c, i) => {
    const sp = FISH[i], rec = fishBook[sp.id];
    c.classList.toggle('unbuilt', !rec);
    c.querySelector('.heroName').textContent = rec ? fishName(sp.id) : t('notBuilt');
    c.querySelector('.lvl').textContent = rec ? t('fish.bestCm', { n: rec.best }) : sp.lvl > farm.level ? t(sp.night ? 'fish.lockedNight' : 'fish.locked', { n: sp.lvl }) : sp.night ? t('fish.night') : '';
    c.querySelector('.tag').textContent = rec ? t('fish.count', { n: rec.n }) : '';
  });
  $('bookCount').textContent = t('fish.caught', { n: FISH.filter(sp => fishBook[sp.id]).length, all: FISH.length });
}
function openBook() {
  if (game.state !== 'farm') return;
  closePond();
  refreshBook();
  $('book').classList.add('show');
  game.picking = true;
}
function closeBook() {
  $('book').classList.remove('show');
  game.picking = anyPanel();
}
$('fishGo').addEventListener('click', () => { sfx.ensure(); goFish(myKey(), 'tap'); });
$('fishBookBtn').addEventListener('click', () => { sfx.ensure(); openBook(); });
$('bookBtn').addEventListener('click', () => { sfx.ensure(); openBook(); });
$('fishStop').addEventListener('click', () => stopFish(myKey()));
// Cast (and hook a bite) the moment it's pressed, like a tap on the water.
$('fishCast').addEventListener('pointerdown', e => {
  const f = fishers.get(myKey());
  if (!f) return;
  sfx.ensure();
  fishPress(f, false);
  fishPress(f, true, 'tap', e.timeStamp / 1000);
  fishPress(f, false);
});
$('bookClose').addEventListener('click', closeBook);
$('book').addEventListener('click', e => { if (e.target.id === 'book') closeBook(); });

// ---------- Fish Backpack ----------
// Every fish you catch (not the boots) waits in here, to sell for sunflowers or,
// later on, to craft with. It's yours rather than the farm's, so a guest's catch
// goes home with them. Tap fish (or + and −) to choose how many to sell, then
// Sell asks once more before they go.
const BAG_KEY = 'bl-bag';
let fishBag = store.get(BAG_KEY, {});              // id -> how many
const bagPick = {};                                // id -> how many chosen to sell
const bagOpen = () => $('bag').classList.contains('show');
const bagGrid = $('bagGrid');
const BAG_SVG = $('bagBtn').querySelector('svg').outerHTML;
const bagKinds = () => FISH.filter(sp => fishBag[sp.id] > 0);
const bagCount = () => FISH.reduce((n, sp) => n + (fishBag[sp.id] || 0), 0);
const pickCount = () => FISH.reduce((n, sp) => n + (bagPick[sp.id] || 0), 0);
const pickTotal = () => FISH.reduce((n, sp) => n + (bagPick[sp.id] || 0) * sp.price, 0);
const bagCards = () => [...bagGrid.children];
const asking = () => !$('bagSure').hidden;
let bagFocus = 0;
function addToBag(id) {
  fishBag[id] = (fishBag[id] || 0) + 1;
  store.set(BAG_KEY, fishBag);
}
function refreshBag() {
  const kinds = bagKinds();
  for (const id in bagPick) bagPick[id] = clamp(bagPick[id], 0, fishBag[id] || 0);
  bagGrid.replaceChildren(...kinds.map(sp => {
    const k = bagPick[sp.id] || 0, card = document.createElement('div');
    card.className = 'heroCard' + (k ? ' on' : '');
    card.dataset.id = sp.id;
    card.innerHTML = `<img class="cutout" alt="" src="${shots.fish[FISH.indexOf(sp)]}"><span class="heroName"></span><span class="lvl">${FLOWER_SVG}${sp.price}</span><i class="tag"></i>`
      + '<div class="pick"><button class="less bubble">−</button><b></b><button class="more bubble">+</button></div>';
    card.querySelector('.heroName').textContent = fishName(sp.id);
    card.querySelector('.tag').textContent = t('fish.count', { n: fishBag[sp.id] });
    card.querySelector('.pick b').textContent = k;
    card.querySelector('.less').setAttribute('aria-label', t('bag.less'));
    card.querySelector('.more').setAttribute('aria-label', t('bag.more'));
    card.querySelector('.less').disabled = !k;
    card.querySelector('.more').disabled = k >= fishBag[sp.id];
    return card;
  }));
  bagFocus = clamp(bagFocus, 0, Math.max(0, kinds.length - 1));
  bagCards().forEach((c, i) => c.classList.toggle('focus', i === bagFocus));
  $('bagWho').textContent = kinds.length ? t('bag.who') : t('bag.empty');
  $('bagBar').hidden = !kinds.length;
  $('bagAll').querySelector('span').textContent = kinds.length && kinds.every(sp => bagPick[sp.id] === fishBag[sp.id]) ? t('bag.none') : t('bag.all');
  $('bagTotal').textContent = pickTotal();
  $('bagSell').disabled = !pickCount();
}
function pickFish(id, d) {
  const was = bagPick[id] || 0, k = clamp(was + d, 0, fishBag[id] || 0);
  if (k === was) { sfx.bump(); return; }
  bagPick[id] = k;
  sfx.pick();
  refreshBag();
}
function pickAll() {   // everything, or (with everything chosen already) nothing
  const kinds = bagKinds();
  if (!kinds.length) return;
  const all = kinds.every(sp => bagPick[sp.id] === fishBag[sp.id]);
  for (const sp of kinds) bagPick[sp.id] = all ? 0 : fishBag[sp.id];
  sfx.pick();
  refreshBag();
}
function bagNav(dir) {
  bagFocus = gridStep(bagCards(), bagFocus, dir);
  bagCards().forEach((c, i) => c.classList.toggle('focus', i === bagFocus));
  bagCards()[bagFocus]?.scrollIntoView({ block: 'nearest' });
}
function showSure(on) {
  $('bagSure').hidden = !on;
  $('bagGrid').hidden = $('bagWho').hidden = on;
  if (on) $('bagBar').hidden = true;
  else refreshBag();
}
function askSell() {   // what's going, and for how much, before anything is sold
  const n = pickCount();
  if (!n) { sfx.bump(); return; }
  $('bagSureText').textContent = n === 1 ? t('bag.sure1') : t('bag.sureN', { n });
  $('bagSureList').replaceChildren(...bagKinds().filter(sp => bagPick[sp.id]).map(sp => {
    const li = document.createElement('li');
    li.innerHTML = `<img alt="" src="${shots.fish[FISH.indexOf(sp)]}"><span></span><b>${FLOWER_SVG}${sp.price * bagPick[sp.id]}</b>`;
    li.querySelector('span').textContent = fishName(sp.id) + ' ' + t('fish.count', { n: bagPick[sp.id] });
    return li;
  }));
  $('bagSureTotal').textContent = pickTotal();
  showSure(true);
}
function sellFish() {
  const total = pickTotal();
  if (GUEST || !total) { showSure(false); return; }
  for (const sp of FISH) {
    const k = bagPick[sp.id] || 0;
    if (!k) continue;
    fishBag[sp.id] -= k;
    if (fishBag[sp.id] <= 0) delete fishBag[sp.id];
    delete bagPick[sp.id];
  }
  store.set(BAG_KEY, fishBag);
  game.coins += total;
  store.set('bl-coins', game.coins);
  hud();
  sfx.coin();
  showSure(false);
}
function openBag() {
  if (GUEST || game.state !== 'farm') return;
  closePond();
  for (const id in bagPick) delete bagPick[id];
  bagFocus = 0;
  showSure(false);
  $('bag').classList.add('show');
  game.picking = true;
}
function closeBag() {
  $('bag').classList.remove('show');
  game.picking = anyPanel();
}
// Keys: arrows choose a fish, Enter or + one more, Backspace or − one fewer, A all,
// S sells. Asked to be sure: Enter sells, Escape keeps them.
function bagKey(code) {
  if (asking()) {
    if (code === 'Enter' || code === 'Space') sellFish();
    else if (code === 'Escape' || code === 'Backspace') showSure(false);
    return;
  }
  const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[code];
  const id = bagCards()[bagFocus]?.dataset.id;
  if (dir) bagNav(dir);
  else if (/^(Enter|Space|Equal|NumpadAdd)$/.test(code)) { if (id) pickFish(id, 1); }
  else if (/^(Backspace|Minus|NumpadSubtract)$/.test(code)) { if (id) pickFish(id, -1); }
  else if (code === 'KeyA') pickAll();
  else if (code === 'KeyS') askSell();
  else if (code === 'Escape') closeBag();
}
bagGrid.addEventListener('click', e => {
  const card = e.target.closest('.heroCard');
  if (!card) return;
  bagFocus = bagCards().indexOf(card);
  pickFish(card.dataset.id, e.target.closest('.less') ? -1 : 1);
});
$('bagBtn').addEventListener('click', () => { sfx.ensure(); openBag(); });
$('bagAll').addEventListener('click', pickAll);
$('bagSell').addEventListener('click', askSell);
$('bagYes').addEventListener('click', sellFish);
$('bagNo').addEventListener('click', () => showSure(false));
$('bagClose').addEventListener('click', closeBag);
$('bag').addEventListener('click', e => { if (e.target.id === 'bag') closeBag(); });


// ---------- Bunkhouse panel ----------
// Before it's built: what it costs. After: every hopper, a green check on the ones
// living on the farm and a price on the ones still to invite.
const bunkOpen = () => $('bunk').classList.contains('show');
const bunkGrid = $('bunkGrid');
const FLOWER_SVG = document.querySelector('#coins .flower').outerHTML;
const HEART_SVG = '<svg class="heart" viewBox="0 0 32 32" aria-hidden="true"><g stroke="#3a2442" stroke-width="1.6" stroke-linejoin="round"><ellipse cx="11.2" cy="6.4" rx="2.7" ry="5.2" fill="#ff7fb8" transform="rotate(-14 11.2 6.4)"/><ellipse cx="20.8" cy="6.4" rx="2.7" ry="5.2" fill="#ff7fb8" transform="rotate(14 20.8 6.4)"/><path d="M16 29.2S4 22.2 4 14.1C4 9.9 7 7.2 10.6 7.2c2.3 0 4.3 1.2 5.4 3.1 1.1-1.9 3.1-3.1 5.4-3.1 3.6 0 6.6 2.7 6.6 6.9 0 8.1-12 15.1-12 15.1z" fill="#ff5f9e"/></g><ellipse cx="11.2" cy="5.9" rx="1.1" ry="3.2" fill="#ffd1e6" transform="rotate(-14 11.2 5.9)"/><ellipse cx="20.8" cy="5.9" rx="1.1" ry="3.2" fill="#ffd1e6" transform="rotate(14 20.8 5.9)"/><ellipse cx="9.6" cy="12.6" rx="2.1" ry="1.3" fill="#fff" opacity=".75" transform="rotate(-35 9.6 12.6)"/><circle cx="12.7" cy="16.6" r="1.25" fill="#3a2442"/><circle cx="19.3" cy="16.6" r="1.25" fill="#3a2442"/><circle cx="13.1" cy="16.2" r=".4" fill="#fff"/><circle cx="19.7" cy="16.2" r=".4" fill="#fff"/><ellipse cx="10.4" cy="19.3" rx="1.5" ry=".9" fill="#ffc2dc"/><ellipse cx="21.6" cy="19.3" rx="1.5" ry=".9" fill="#ffc2dc"/><path d="M14.4 19.2q1.6 1.7 3.2 0" fill="none" stroke="#3a2442" stroke-width="1.1" stroke-linecap="round"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#3a2442" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let bunkFocus = 0;
HEROES.forEach((h, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard';
  card.dataset.id = h.id;
  card.style.background = h.bg;
  card.innerHTML = `<img class="cutout" alt="" src="${shots.cards[i]}"><span class="heroName">${heroName(h.id)}</span><i class="tag"></i>`;
  card.addEventListener('click', () => { bunkFocus = i; unlockHero(h.id); });
  bunkGrid.append(card);
});
function refreshBunk(msg) {
  $('bunkPlan').hidden = farm.bunkBuilt;
  $('bunkHome').hidden = !farm.bunkBuilt;
  $('bunkCost').textContent = BUNK_COST;
  $('bunkBuy').disabled = game.coins < BUNK_COST;
  const nav = document.body.classList.contains('pad') || document.body.classList.contains('keys');
  [...bunkGrid.children].forEach((c, i) => {
    const h = HEROES[i], have = owned.has(h.id);
    c.classList.toggle('locked', !have);
    c.classList.toggle('short', !have && !h.supporter && game.coins < h.price);
    c.classList.toggle('focus', nav && i === bunkFocus);
    c.hidden = h.supporter && !SUPPORT_URL && !have;
    const tag = c.querySelector('.tag');
    tag.className = 'tag ' + (have ? 'check' : h.supporter ? 'cost sup' : 'cost');
    tag.innerHTML = have ? CHECK_SVG : h.supporter ? HEART_SVG + `<span>${t('sup.tag')}</span>` : FLOWER_SVG + `<span>${h.price}</span>`;
    c.setAttribute('aria-label', have ? t('aria.lives', { name: heroName(h.id) }) : h.supporter ? t('aria.supHero', { name: heroName(h.id) }) : t('aria.unlock', { name: heroName(h.id), n: h.price }));
  });
  $('bunkNeed').textContent = msg ?? (farm.bunkBuilt ? '' : needText(BUNK_COST - game.coins));
}
function openBunk() {
  if (GUEST) return;
  if (game.state !== 'farm') return;
  closeHeroes();
  closePond();
  bunkFocus = Math.max(0, HEROES.findIndex(h => !owned.has(h.id)));
  refreshBunk();
  $('bunk').classList.add('show');
  game.picking = true;
}
function closeBunk() {
  $('bunk').classList.remove('show');
  game.picking = anyPanel();
}
const cheer = (x, z) => {
  burst(x, 0.4, FARM_Z + z, [0xffd23f, 0xffffff, 0xff8fc8, 0x6bd864, 0xff8a2a], 26, 2.2, 5, 0.09, 0.9);
  burst(x, 0.1, FARM_Z + z, [0xe8d2a8, 0xffffff], 14, 1.4, 3, 0.14, 0.7, true);
};
function buildBunkhouse() {
  if (farm.bunkBuilt) return;
  if (game.coins < BUNK_COST) { sfx.bump(); return; }
  game.coins -= BUNK_COST;
  store.set('bl-coins', game.coins);
  farm.bunkBuilt = true;
  store.set('bl-bunk', true);
  buildBunk();
  settleWalkers();   // anyone standing on the plot steps aside
  sfx.upgrade();
  cheer(farm.pieces.bunk.x, farm.pieces.bunk.z);
  hud();
  bunkFocus = Math.max(0, HEROES.findIndex(h => !owned.has(h.id)));
  refreshBunk();
}
function unlockHero(id) {
  const h = HEROES.find(x => x.id === id);
  if (h.supporter) { if (!owned.has(id)) { closeBunk(); openSupport(); } return; }
  if (!farm.bunkBuilt || owned.has(id)) return;
  if (game.coins < h.price) { sfx.bump(); refreshBunk(needText(h.price - game.coins)); return; }
  game.coins -= h.price;
  store.set('bl-coins', game.coins);
  owned.add(id);
  store.set('bl-owned', [...owned].filter(x => !STARTERS.includes(x) && !SUP_HEROES.includes(x)));
  heroGrid.querySelector(`[data-id="${id}"]`).hidden = false;
  const bp = farm.pieces.bunk;
  const w = addWalker(h, pieceToFarm(bp, -0.3, 1.55));   // out the Bunkhouse door, with a happy hop
  w.hop = 0.5;
  w.face = bp.r * Math.PI / 2;
  w.wait = 1.2;
  sfx.upgrade();
  sfx.hop(id);
  cheer(w.x, w.z);
  hud();
  refreshBunk(t('movedIn', { name: heroName(id) }));
  const c = bunkGrid.children[HEROES.indexOf(h)];
  c.classList.remove('yay'); void c.offsetWidth; c.classList.add('yay');
}
function bunkNav(dir) {
  bunkFocus = gridStep([...bunkGrid.children], bunkFocus, dir);
  refreshBunk();
}
const bunkAct = () => farm.bunkBuilt ? unlockHero(HEROES[bunkFocus].id) : buildBunkhouse();
$('bunkBuy').addEventListener('click', buildBunkhouse);
$('bunkClose').addEventListener('click', closeBunk);
$('bunk').addEventListener('click', e => { if (e.target.id === 'bunk') closeBunk(); });

// ---------- Farm Buildings menu ----------
// A card for each building: its picture and level once it's built, a grey shape,
// "???" and the price until then. A tap opens the building (or its plans). Under
// them: arranging the farm, and the decorations shop.
const buildsOpen = () => $('builds').classList.contains('show');
const buildGrid = $('buildGrid');
const BUILD_ACTS = [$('arrangeBtn'), $('decorShopBtn')];
let buildFocus = 0;
BUILDINGS.forEach((b, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard';
  card.innerHTML = `<img class="cutout" alt="" src="${shots.builds[i]}"><span class="heroName"></span><span class="lvl"></span><i class="tag"></i>`;
  card.addEventListener('click', () => { buildFocus = i; buildAct(); });
  buildGrid.append(card);
});
const buildItems = () => [...buildGrid.children, ...BUILD_ACTS];
function refreshBuilds() {
  const nav = document.body.classList.contains('pad') || document.body.classList.contains('keys');
  [...buildGrid.children].forEach((c, i) => {
    const b = BUILDINGS[i], lvl = buildLevel(b), name = t(b.name);
    c.classList.toggle('unbuilt', !lvl);
    c.querySelector('.heroName').textContent = lvl ? name : t('notBuilt');
    c.querySelector('.lvl').textContent = lvl ? t('buildLevel', { n: lvl }) : '';
    c.querySelector('.tag').innerHTML = lvl ? '' : FLOWER_SVG + `<span>${b.cost}</span>`;
    c.setAttribute('aria-label', lvl ? t('aria.building', { name, n: lvl }) : t('aria.unbuilt', { n: b.cost }));
  });
  buildItems().forEach((c, i) => c.classList.toggle('focus', nav && i === buildFocus));
}
function openBuilds() {
  if (GUEST || game.state !== 'farm') return;
  closeHeroes(); closePond(); closeBunk(); closeStage();
  buildFocus = 0;
  refreshBuilds();
  $('builds').classList.add('show');
  game.picking = true;
}
function closeBuilds() {
  $('builds').classList.remove('show');
  game.picking = anyPanel();
}
function buildAct() {
  const n = BUILDINGS.length;
  closeBuilds();
  if (buildFocus < n) BUILDINGS[buildFocus].open();
  else if (buildFocus === n) enterDecor();
  else { enterDecor(); openShop(); }
}
function buildsNav(dir) {
  const n = BUILDINGS.length, cards = [...buildGrid.children];
  if (buildFocus < n) {
    const next = gridStep(cards, buildFocus, dir);
    buildFocus = next === buildFocus && dir === 'down' ? n : next;   // off the bottom: onto the buttons
  } else if (dir === 'up') buildFocus = 0;
  else if (dir === 'left' || dir === 'right') buildFocus = dir === 'left' ? n : n + 1;
  refreshBuilds();
}
$('buildBtn').addEventListener('click', () => { sfx.ensure(); openBuilds(); });
BUILD_ACTS.forEach((btn, i) => btn.addEventListener('click', () => { sfx.ensure(); buildFocus = BUILDINGS.length + i; buildAct(); }));
$('buildsClose').addEventListener('click', closeBuilds);
$('builds').addEventListener('click', e => { if (e.target.id === 'builds') closeBuilds(); });

// ---------- Decorate mode ----------
// Drag things around the farm and turn them; buy decorations in the shop. Everything
// snaps to a half-tile grid. A green footprint means it fits; red means it won't, and
// letting go sends it back to its last good spot. Controller: d-pad moves, X picks the
// next thing, Y turns it, Select opens the shop, A or B is done.
const decor = { on: false, sel: null, drag: null };
const footMat = new THREE.MeshBasicMaterial({ color: 0x6bd864, transparent: true, opacity: 0.45, depthWrite: false });
const footMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), footMat);
footMark.layers.set(GLOW_LAYER);   // no ink outline
footMark.visible = false;
farm.group.add(footMark);
function showFoot() {
  const p = farm.pieces[decor.sel];
  footMark.visible = decor.on && !!p;
  if (!footMark.visible) return;
  const [a, b, c, d] = worldRect(PIECES[p.id].foot, p.x, p.z, p.r);
  footMark.position.set((a + b) / 2, 0.05, (c + d) / 2);
  footMark.scale.set(b - a, 1, d - c);
  footMat.color.setHex(placeOk(p.id, p.x, p.z, p.r) ? 0x6bd864 : 0xff5a6a);
}
function selectPiece(id) {
  const old = farm.pieces[decor.sel];
  if (old) old.group.position.y = 0;
  decor.sel = id;
  const p = farm.pieces[id];
  if (p) { p.group.position.y = 0.12; p.good = [p.x, p.z, p.r]; }   // lifted a little while it's picked up
  showFoot();
}
function focusPiece(p) {   // bring it into view (controller users can't drag the camera)
  farmCam.x = clamp(p.x, FARM_PAN.x0, FARM_PAN.x1);
  farmCam.z = clamp(p.z + 1.4, FARM_PAN.z0, FARM_PAN.z1);
}
function enterDecor() {
  if (GUEST) return;
  if (game.state !== 'farm' || decor.on) return;
  if (farm.swingSitter?.sit) standUp(farm.swingSitter);   // everyone off the swing while things move
  closeHeroes(); closePond(); closeBunk(); closeBuilds(); closeSettings();
  stopAllFishing();
  decor.on = true;
  document.body.classList.add('decor');
  selectPiece(null);
  setHint();
}
function exitDecor() {
  if (!decor.on) return;
  const p = farm.pieces[decor.sel];
  if (p && !placeOk(p.id, p.x, p.z, p.r)) setPiece(p, ...p.good);
  selectPiece(null);
  decor.on = false;
  decor.drag = null;
  closeShop();
  document.body.classList.remove('decor');
  saveLayout();
  settleWalkers();
  setHint();
}
function pieceAt(x, y) {   // the nearest piece under the finger
  _ndc.set(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  let best = null, dist = Infinity;
  for (const p of Object.values(farm.pieces)) {
    const h = _ray.intersectObject(p.group, true)[0];
    if (h && h.distance < dist) { dist = h.distance; best = p; }
  }
  return best;
}
function decorGrab(e) {
  const p = pieceAt(e.clientX, e.clientY);
  if (!p || !groundAt(e.clientX, e.clientY, _a)) return false;
  if (decor.sel !== p.id) { selectPiece(p.id); sfx.pick(); }
  decor.drag = { id: e.pointerId, ox: p.x - _a.x, oz: p.z - (_a.z - FARM_Z) };   // keep the grab point under the finger
  return true;
}
function decorDrag(e) {
  const p = farm.pieces[decor.sel];
  if (!p || !groundAt(e.clientX, e.clientY, _a)) return;
  const B = FARM_BOUNDS;
  const x = snap(clamp(_a.x + decor.drag.ox, B.x0, B.x1)), z = snap(clamp(_a.z - FARM_Z + decor.drag.oz, B.z0, B.z1));
  if (x !== p.x || z !== p.z) { setPiece(p, x, z, p.r); showFoot(); }
}
function decorDrop() {
  decor.drag = null;
  const p = farm.pieces[decor.sel];
  if (!p) return;
  if (placeOk(p.id, p.x, p.z, p.r)) { p.good = [p.x, p.z, p.r]; sfx.place(); }
  else { setPiece(p, ...p.good); sfx.bump(); }
  showFoot();
  settleWalkers();
}
function placed(p) {
  p.good = [p.x, p.z, p.r];
  sfx.place();
  showFoot();
  settleWalkers();
}
function rotatePiece() {   // a quarter turn; if it no longer fits there, the nearest spot where it does
  const p = farm.pieces[decor.sel];
  if (!p) { sfx.bump(); return; }
  const r = (p.r + 1) & 3, spot = placeOk(p.id, p.x, p.z, r) ? [p.x, p.z] : findSpot(p.id, p.x, p.z, r);
  if (!spot) { sfx.bump(); return; }
  setPiece(p, spot[0], spot[1], r);
  placed(p);
}
function nudgePiece(dir) {   // controller / arrow keys: one grid step, hopping over anything in the way
  const p = farm.pieces[decor.sel];
  if (!p) { nextPiece(); return; }
  const [dx, dz] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
  for (let k = 1; k <= 16; k++) {
    const x = p.x + dx * GRID * k, z = p.z + dz * GRID * k;
    if (placeOk(p.id, x, z, p.r)) { setPiece(p, x, z, p.r); placed(p); focusPiece(p); return; }
  }
  sfx.bump();
}
function nextPiece() {
  const ids = Object.keys(farm.pieces), id = ids[(ids.indexOf(decor.sel) + 1) % ids.length];
  selectPiece(id);
  focusPiece(farm.pieces[id]);
  sfx.pick();
}
$('doneBtn').addEventListener('click', exitDecor);
$('rotateBtn').addEventListener('click', rotatePiece);
$('shopBtn').addEventListener('click', () => { sfx.ensure(); openShop(); });

// ---------- Decorations shop ----------
const shopOpen = () => $('shop').classList.contains('show');
const shopGrid = $('shopGrid');
let shopFocus = 0;
DECOR.forEach((id, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard';
  card.dataset.id = id;
  card.style.background = PIECES[id].bg;
  card.innerHTML = `<img class="cutout" alt="" src="${shots.decor[i]}"><span class="heroName"></span><i class="tag"></i>`;
  card.addEventListener('click', () => { shopFocus = i; buyDecor(id); });
  shopGrid.append(card);
});
// The Music tab: the song's key. Pick a scale (Major, Minor, ...) at the top, then a
// key: D major is the tune's own; every other key is KEY_PRICE. Tap one you have to
// switch to it: the soundtrack and every hopper sound change key together on the next
// bar line. Tab, Q / E or LB / RB switch tabs; [ / ] or LT / RT switch scales.
const keyGrid = $('keyGrid'), scaleChips = $('scaleChips');
let shopTab = 'decor', keyScale = songScale();
for (const sc of Object.keys(SCALES)) {
  const chip = document.createElement('button');
  chip.className = 'setTab';
  chip.dataset.scale = sc;
  chip.setAttribute('role', 'tab');
  chip.addEventListener('click', () => setKeyScale(sc));
  scaleChips.append(chip);
}
SONG_KEYS.forEach((_, i) => {
  const card = document.createElement('button');
  card.className = 'heroCard keyCard';
  card.innerHTML = '<b class="keyGlyph"></b><span class="heroName"></span><i class="tag"></i>';
  card.addEventListener('click', () => { shopFocus = i; buyKey(i); });
  keyGrid.append(card);
});
// Bought keys, by id: 'C' for C major, 'C:minor' for C minor.
const keyId = (i, sc) => SONG_KEYS[i][0] + (sc === 'major' ? '' : ':' + sc);
const ownedKeys = () => new Set(['D', ...store.get('bl-keys', [])]);
const shopCards = () => [...(shopTab === 'music' ? keyGrid : shopGrid).children];
const shopBuy = () => (shopTab === 'music' ? buyKey(shopFocus) : buyDecor(DECOR[shopFocus]));
function setShopTab(tab) {
  shopTab = tab;
  for (const [id, on] of [['tabDecor', tab === 'decor'], ['tabMusic', tab === 'music']]) {
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-selected', String(on));
  }
  shopGrid.hidden = tab === 'music';
  keyGrid.hidden = scaleChips.hidden = tab !== 'music';
  if (tab === 'music') keyScale = songScale();
  shopFocus = tab === 'music' ? keyFocus() : Math.max(0, DECOR.findIndex(id => !ownedDecor.has(id)));
  refreshShop();
  document.querySelector('#shop .panelBody').scrollTop = 0;
}
const keyFocus = () => (keyScale === songScale() ? Math.max(0, SONG_KEYS.findIndex(k => k[1] === songKey())) : 0);
function setKeyScale(sc) {
  keyScale = sc;
  shopFocus = keyFocus();
  refreshShop();
}
const nextScale = d => { const all = Object.keys(SCALES); setKeyScale(all[(all.indexOf(keyScale) + d + all.length) % all.length]); };
$('tabDecor').addEventListener('click', () => setShopTab('decor'));
$('tabMusic').addEventListener('click', () => setShopTab('music'));
const STEP_SEC = 60 / 84 / 2;   // an eighth note of the farm tune (84 BPM)
function buyKey(i) {
  const id = keyId(i, keyScale), n = SONG_KEYS[i][1], sc = keyScale, owned = ownedKeys();
  if (!owned.has(id)) {
    if (game.coins < KEY_PRICE) { sfx.bump(); refreshShop(needText(KEY_PRICE - game.coins)); return; }
    game.coins -= KEY_PRICE;
    store.set('bl-coins', game.coins);
    store.set('bl-keys', [...owned].filter(k => k !== 'D').concat(id));
    hud();
  }
  if (n === songKey() && sc === songScale()) { refreshShop(); return; }
  store.set('bl-key', n);   // farm settings: the guests on this farm hear it too
  store.set('bl-scale', sc);
  sfx.ensure();
  const wait = music?.setKey(n, sc) ?? 0;
  // Right as the tune changes key, your hopper sings up its chord: the root, third, fifth and octave.
  const deg = SCALES[sc].deg;
  [0, 4 + deg[2], 7 + deg[4], 12].forEach((st, j) => sfx.note(heroId, 293.66 * 2 ** ((n + st) / 12), wait + j * STEP_SEC));
  refreshShop(t('keyHere', { k: keyLabel(i, sc) }));
}
// Key names: a scale can spell some differently (C# minor, not Db minor).
const keyGlyph = (i, sc) => STRINGS.en.keyNamesBy?.[sc] ? t('keyNamesBy.' + sc + '.' + i) : t('keyNames.' + i);
const keyLabel = (i, sc) => t('scaleKey.' + sc, { k: keyGlyph(i, sc) });
function refreshShop(msg) {
  const nav = document.body.classList.contains('pad') || document.body.classList.contains('keys');
  $('shopWho').textContent = t(shopTab === 'music' ? 'shopKeyWho' : 'shopWho');
  for (const chip of scaleChips.children) {
    const on = chip.dataset.scale === keyScale;
    chip.textContent = t('scales.' + chip.dataset.scale);
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-selected', String(on));
  }
  const owned = ownedKeys(), now = songKey(), nowScale = songScale(), minor = SCALES[keyScale].deg[2] < 0;
  [...keyGrid.children].forEach((c, i) => {
    const n = SONG_KEYS[i][1], have = owned.has(keyId(i, keyScale)), on = n === now && keyScale === nowScale, name = keyLabel(i, keyScale);
    c.style.background = minor ? `hsl(${i * 30} 45% 80%)` : `hsl(${i * 30} 85% 88%)`;   // minor keys a little dusky
    c.classList.toggle('short', !have && game.coins < KEY_PRICE);
    c.classList.toggle('on', on);
    c.classList.toggle('focus', nav && shopTab === 'music' && i === shopFocus);
    c.querySelector('.keyGlyph').textContent = keyGlyph(i, keyScale);
    c.querySelector('.heroName').textContent = t('scaleShort.' + keyScale);
    const tag = c.querySelector('.tag');
    tag.style.display = on ? 'none' : '';   // the chosen key wears the spinning sunflower instead
    tag.className = 'tag ' + (have ? 'check' : 'cost');
    tag.innerHTML = have ? CHECK_SVG : FLOWER_SVG + `<span>${KEY_PRICE}</span>`;
    c.setAttribute('aria-label', t(on ? 'aria.keyOn' : have ? 'aria.keyHave' : 'aria.keyBuy', { name, n: KEY_PRICE }));
  });
  [...shopGrid.children].forEach((c, i) => {
    const id = DECOR[i], have = ownedDecor.has(id), price = PIECES[id].price, name = t('decor.' + id);
    c.classList.toggle('short', !have && (game.coins < price || (PIECES[id].needsStage && !farm.stageBuilt)));
    c.classList.toggle('focus', nav && shopTab === 'decor' && i === shopFocus);
    c.querySelector('.heroName').textContent = name;
    const tag = c.querySelector('.tag');
    tag.className = 'tag ' + (have ? 'check' : 'cost');
    tag.innerHTML = have ? CHECK_SVG : FLOWER_SVG + `<span>${price}</span>`;
    c.setAttribute('aria-label', t(have ? 'aria.ownItem' : 'aria.buyItem', { name, n: price }));
  });
  $('shopNeed').textContent = msg ?? '';
}
function openShop() {
  if (GUEST) return;
  if (!decor.on) return;
  setShopTab(shopTab);
  $('shop').classList.add('show');
  game.picking = true;
}
function closeShop() {
  $('shop').classList.remove('show');
  game.picking = anyPanel();
}
function buyDecor(id) {
  if (ownedDecor.has(id) && PIECES[id].onStage) { closeShop(); return; }
  if (ownedDecor.has(id)) {   // already on the farm: go and pick it up
    closeShop();
    selectPiece(id);
    focusPiece(farm.pieces[id]);
    return;
  }
  const price = PIECES[id].price;
  if (PIECES[id].needsStage && !farm.stageBuilt) { sfx.bump(); refreshShop(t('bigNeedsStage')); return; }
  if (game.coins < price) { sfx.bump(); refreshShop(needText(price - game.coins)); return; }
  game.coins -= price;
  store.set('bl-coins', game.coins);
  ownedDecor.add(id);
  store.set('bl-decor', [...ownedDecor]);
  if (PIECES[id].onStage) {   // the drum kit goes straight onto the Jam Stage
    if (id === 'bigstage') {   // the stage grows where it stands, or moves to the nearest place with room
      endShow();
      const sp = farm.pieces.stage;
      if (!placeOk('stage', sp.x, sp.z, sp.r)) { const at = findSpot('stage', sp.x, sp.z, sp.r); if (at) setPiece(sp, at[0], at[1], sp.r); }
      saveLayout();
    }
    buildStage();
    settleWalkers();
    hud();
    sfx.upgrade();
    const sp = farm.pieces.stage;
    cheer(sp.x, sp.z);
    refreshShop(t({ disco: 'discoHere', bigstage: 'bigHere' }[id] || 'drumsHere'));
    return;
  }
  const p = addPiece(id, [snap(farmCam.x), snap(farmCam.z - 1.4), 0]);   // the nearest free spot to the middle of the view
  saveLayout();
  settleWalkers();
  hud();
  sfx.upgrade();
  cheer(p.x, p.z);
  closeShop();
  selectPiece(id);
}
$('shopClose').addEventListener('click', closeShop);
$('shop').addEventListener('click', e => { if (e.target.id === 'shop') closeShop(); });

// ---------- Jam Stage ----------
// Build it once (one sunflower); after that a tap opens the jam: your hopper on a
// little stage with a banjo, playing along with the soundtrack. The pad is that
// hopper's instrument: three rows (high, middle, low octave) of the game's scale
// (D pentatonic), so any pads sound good together; + and - shift the whole range.
// Only your hopper is on stage, leaving room for friends to jam together one day.
// Each pad shows how to play it with what you last used: keys Q-Y / A-H / Z-N, or a
// controller's LB X A Y B RB on the row the d-pad picked; nothing for touch.
const stageOpen = () => $('stage').classList.contains('show');
function stageAct() {
  if (GUEST) { openJam(); return; }   // a guest can step back on stage while the host is jamming
  if (farm.stageBuilt) openJam(); else openStage();
}
function refreshStage() {
  $('stageCost').textContent = STAGE_COST;
  $('stageBuy').disabled = game.coins < STAGE_COST;
  $('stageNeed').textContent = needText(STAGE_COST - game.coins);
}
function openStage() {
  if (game.state !== 'farm') return;
  closeHeroes(); closePond(); closeBunk();
  refreshStage();
  $('stage').classList.add('show');
  game.picking = true;
}
function closeStage() {
  $('stage').classList.remove('show');
  game.picking = anyPanel();
}
function buildJamStage() {
  if (farm.stageBuilt) return;
  if (game.coins < STAGE_COST) { sfx.bump(); return; }
  game.coins -= STAGE_COST;
  store.set('bl-coins', game.coins);
  farm.stageBuilt = true;
  store.set('bl-stage', true);
  buildStage();
  settleWalkers();
  sfx.upgrade();
  cheer(farm.pieces.stage.x, farm.pieces.stage.z);
  hud();
  closeStage();
  setTimeout(openJam, 700);   // straight up on stage
}
$('stageBuy').addEventListener('click', buildJamStage);
$('stageClose').addEventListener('click', closeStage);
$('stage').addEventListener('click', e => { if (e.target.id === 'stage') closeStage(); });
$('swingOff').addEventListener('click', () => { sfx.ensure(); dismount(walkerOf(myKey())); });
$('landBuy').addEventListener('click', buyLand);
$('landClose').addEventListener('click', closeLand);
$('land').addEventListener('click', e => { if (e.target.id === 'land') closeLand(); });

const SCALE = [0, 1, 2, 3, 4, 5];   // pad columns: pentHz() steps, the key's pentatonic and its octave (D E F# A B D in D major)
const JAM_ROWS = 3;   // top row an octave up, bottom row an octave down
const JAM_KEYS = ['KeyQ KeyW KeyE KeyR KeyT KeyY', 'KeyA KeyS KeyD KeyF KeyG KeyH', 'KeyZ KeyX KeyC KeyV KeyB KeyN'].map(r => r.split(' '));
const PAD_BTNS = [4, 2, 0, 3, 1, 5], PAD_LABELS = ['LB', 'X', 'A', 'Y', 'B', 'RB'];   // controller button for each column
const jam = { open: false, drums: false, oct: 0, row: 1, input: null, t: 0, kick: 0, r: null, scene: null, cam: null, model: null, spread: 0,
  sustain: store.get('bl-sustain', 0.35), held: new Map(),
  song: store.get('bl-jam-song', 1),   // the farm tune's volume on the stage, on this device: 0 leaves just the instruments   // held: finger / key / button -> release()
  band: new Map(), byRC: new Map(), hostOpen: false };   // band: a guest's bandmates, by key; byRC: a guest's held pads
// Everyone else on stage. On the host: the phones and guests (party.players, by slot);
// on a guest's device: the rest of the band as the host lists it (n = their slot, the host 0).
const bandOf = () => GUEST ? [...jam.band.entries()] : [...party.players.entries()];
const bandN = ([k, pl]) => pl.n ?? k;
const jamPads = $('jamPads');
for (let row = 0; row < JAM_ROWS; row++) SCALE.forEach((_, col) => {
  const pad = document.createElement('button');
  pad.className = 'pad' + (col === 0 || col === 5 ? ' root' : '');
  pad.dataset.row = row;
  pad.dataset.col = col;
  pad.innerHTML = '<span class="k"></span>';
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch') setJamInput('touch');
    else if (jam.input === 'pad') setJamInput('keys');   // a mouse: back to the keyboard hints
    if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);   // touch captures; release so sliding off the pad lets the note go
    playPad(row, col, 'p' + e.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) pad.addEventListener(type, e => letGo('p' + e.pointerId));
  pad.addEventListener('click', e => { if (e.detail === 0) playPad(row, col); });   // Enter / Space on a focused pad
  jamPads.append(pad);
});
// The drum pads: two rows of four. Bottom row kick, snare, closed and open hi-hat;
// top row clap, low tom, high tom, cowbell. Index = the sfx.drum() sound.
const DRUM_GRID = [4, 5, 6, 7, 0, 1, 2, 3];   // pad order, top-left first
const DRUM_KEYS = { 4: 'KeyQ', 5: 'KeyW', 6: 'KeyE', 7: 'KeyR', 0: 'KeyA', 1: 'KeyS', 2: 'KeyD', 3: 'KeyF' };
const DRUM_BTNS = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 7, 7: 5 };   // drum -> controller button: A B X Y, LB LT RT RB
const BTN_LABELS = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT' };
const DRUM_COLORS = ['#ff6b6b', '#fff1d8', '#ffd24a', '#ffe68a', '#ff7fb8', '#7fd0ff', '#a6e3ff', '#bd96ff'];
const drumPads = $('drumPads');
DRUM_GRID.forEach(d => {
  const pad = document.createElement('button');
  pad.className = 'pad drumPad';
  pad.dataset.drum = d;
  pad.style.setProperty('--c', DRUM_COLORS[d]);
  pad.innerHTML = '<span class="dn"></span><span class="k"></span>';
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch') setJamInput('touch');
    else if (jam.input === 'pad') setJamInput('keys');
    playDrum(d);
  });
  pad.addEventListener('click', e => { if (e.detail === 0) playDrum(d); });
  drumPads.append(pad);
});
function playDrum(d) {
  sfx.ensure();
  sfx.drum(d);
  if (GUEST) guestNet.send({ t: 'drum', d });
  else toGuests({ t: 'jd', k: 'h', d });
  const pad = drumPads.querySelector(`[data-drum="${d}"]`);
  pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
  jam.kick = 1;
  jam.boom = 1;   // the kit on stage jumps too
  const note = document.createElement('span');
  note.className = 'jamNote';
  note.textContent = pick(['♪', '♫', '✦']);
  note.style.color = DRUM_COLORS[d];
  note.style.left = (12 + Math.random() * 76) + '%';
  $('jamNotes').append(note);
  setTimeout(() => note.remove(), 1400);
}
// Flip between the hopper's own sounds and the drum kit (once the kit is bought).
function setDrums(on) {
  jam.drums = !!on && ownedDecor.has('drums');   // a strict true/false: toggle() with undefined would flip the class instead
  letGoAll();
  $('jam').classList.toggle('drums', jam.drums);
  if (jam.banjo) jam.banjo.visible = !jam.drums;   // the banjo goes down while you drum
  $('instBtn').setAttribute('aria-label', jam.drums ? t('aria.instHopper', { name: heroName(heroId) }) : t('aria.instDrums'));
  $('instFace').src = jam.drums ? shots.cards[HEROES.indexOf(hero())] : shots.decor[DECOR.indexOf('drums')];
  if (GUEST) guestNet.send({ t: 'mode', drums: jam.drums });
  else tellBand();
}
$('instBtn').addEventListener('click', () => { sfx.ensure(); setDrums(!jam.drums); });
const padAt = (row, col) => jamPads.querySelector(`.pad[data-row="${row}"][data-col="${col}"]`);
const noteFreq = (oct, row, col) => pentHz(SCALE[col]) * 2 ** (oct + 1 - row);
const padFreq = (row, col) => noteFreq(jam.oct, row, col);
function playPad(row, col, by) {
  sfx.ensure();
  const h = hero();
  sfx.voice(h.id, padFreq(row, col), true);
  if (by) {   // held: the sustain tone rings until it's let go
    letGo(by);
    const release = sfx.hold(h.id, padFreq(row, col), jam.sustain);
    if (release) jam.held.set(by, release);
  }
  // The band hears it too: a guest tells the host (who plays it in the guest's own octave);
  // the host tells its guests.
  if (GUEST) { guestNet.send({ t: 'note', r: row, c: col, on: true }); if (by) jam.byRC.set(by, [row, col]); }
  else toGuests({ t: 'jn', k: 'h', by: by || 'x', hero: h.id, f: padFreq(row, col), sus: jam.sustain, on: true, hold: !!by });
  const pad = padAt(row, col);
  pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
  jam.kick = 1;   // the hopper bounces to every note
  const note = document.createElement('span');   // and a note floats up off the stage
  note.className = 'jamNote';
  note.textContent = pick(['♪', '♫', '♩', '♬']);
  note.style.color = h.pad;
  note.style.left = (12 + Math.random() * 76) + '%';
  $('jamNotes').append(note);
  setTimeout(() => note.remove(), 1400);
}
function letGo(by) {
  jam.held.get(by)?.();
  jam.held.delete(by);
  if (!/^[pkb]/.test(by)) return;   // only this screen's own fingers, keys and buttons
  const rc = jam.byRC.get(by);
  if (GUEST) { if (rc) { jam.byRC.delete(by); guestNet.send({ t: 'note', r: rc[0], c: rc[1], on: false }); } }
  else toGuests({ t: 'jn', k: 'h', by, on: false });
}
function letGoAll() { for (const by of [...jam.held.keys()]) letGo(by); }
function setSustain(v) {
  jam.sustain = clamp(Math.round(v * 20) / 20, 0, 1);
  sfx.sustain = jam.sustain;   // hops ring the same way
  store.set('bl-sustain', jam.sustain);
  if (GUEST) guestNet.send({ t: 'sus', v: jam.sustain });
  setVolSlider('sustain', jam.sustain);
}
$('sustain').addEventListener('input', e => setSustain(e.target.value / 100));
function setJamSong(v) {
  jam.song = clamp(Math.round(v * 20) / 20, 0, 1);
  store.set('bl-jam-song', jam.song);
  if (jam.open) music?.setLevel(jam.song);
  setVolSlider('jamSong', jam.song);
}
$('jamSong').addEventListener('input', e => { sfx.ensure(); setJamSong(e.target.value / 100); });
function setOctave(d) {
  jam.oct = clamp(jam.oct + d, -1, 1);
  if (GUEST) guestNet.send({ t: 'oct', v: jam.oct });
  $('octN').textContent = (jam.oct > 0 ? '+' : '') + jam.oct;
  $('octUp').disabled = jam.oct >= 1;
  $('octDown').disabled = jam.oct <= -1;
  if (d) sfx.voice(heroId, padFreq(1, 0));   // hear where you are
}
// Pad labels follow whatever was used last: 'keys', 'pad' (a controller) or 'touch' (none).
function setJamInput(mode) {
  if (jam.input === mode) return;
  jam.input = mode;
  markJamHints();
}
function markJamHints() {
  const m = jam.input;
  $('jam').dataset.input = m;
  jamPads.querySelectorAll('.pad').forEach(p => {
    const row = +p.dataset.row, col = +p.dataset.col;
    p.querySelector('.k').textContent = m === 'keys' ? JAM_KEYS[row][col].slice(3) : m === 'pad' && row === jam.row ? PAD_LABELS[col] : '';
    p.classList.toggle('live', m === 'pad' && row === jam.row);
  });
  const hints = { keys: ['=', '−', 'Esc', '', 'Tab'], pad: ['▶', '◀', 'Start', 'LT · RT', 'Select'], touch: ['', '', '', '', ''] }[m];
  ['octUp', 'octDown', 'jamClose', 'sustainRow', 'instBtn'].forEach((id, i) => { $(id).dataset.hint = hints[i]; });
  const names = t('drumNames');
  drumPads.querySelectorAll('.pad').forEach(p => {
    const d = +p.dataset.drum;
    p.querySelector('.dn').textContent = names[d];
    p.querySelector('.k').textContent = m === 'keys' ? DRUM_KEYS[d].slice(3) : m === 'pad' ? BTN_LABELS[DRUM_BTNS[d]] : '';
  });
}
// A banjo: round drum with a cream head, a long neck, four strings.// A banjo: round drum with a cream head, a long neck, four strings.
function banjoMesh() {
  const v = new VB(0.8), WOOD = 0x9c6b3c;
  v.cyl(0.14, 0.14, 0.05, 0, 0, 0, 0xfff4e0, Math.PI / 2, 0, 0);
  v.torus(0.14, 0.028, Math.PI * 2, 0, 0, 0, WOOD);
  v.rbox(0.06, 0.52, 0.035, 0, 0.38, -0.005, 0x7a4a1c, 0.012);
  v.rbox(0.09, 0.12, 0.04, 0, 0.68, -0.005, 0x5a3420, 0.02);
  for (const s of [-1, 1]) for (const y of [0.64, 0.71]) v.ball(0.016, 0.016, 0.016, s * 0.06, y, -0.005, 0xfff1d8);
  for (const x of [-0.018, -0.006, 0.006, 0.018]) v.cyl(0.003, 0.003, 0.72, x, 0.27, -0.03, 0xe8e8f0);
  v.rbox(0.07, 0.02, 0.02, 0, -0.04, -0.035, WOOD, 0.005);
  const m = v.mesh();
  m.position.set(0.02, 0.4, -0.24);   // across the chest
  m.rotation.z = -0.85;
  return m;
}
function jamSetup() {
  if (jam.r) return;
  jam.r = new THREE.WebGLRenderer({ canvas: $('jamCanvas'), alpha: true, antialias: true });
  jam.scene = new THREE.Scene();
  jam.scene.add(new THREE.HemisphereLight(0xfff4ec, 0x7d6fa8, 1.4));
  const key = new THREE.DirectionalLight(0xfff3dc, 2.4);   // the spotlight from above
  key.position.set(-1.5, 6, 5);
  jam.scene.add(key);
  jam.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
}
function jamResize() {
  const c = $('jamCanvas'), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  jam.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  jam.r.setSize(w, h, false);
  const a = w / h, half = Math.tan(THREE.MathUtils.degToRad(15));
  const halfW = 1.15 + jam.spread;   // the hopper and her banjo, plus any friends beside her
  const dist = Math.max(1.2 / half, halfW / (half * a));
  jam.cam.aspect = a;
  const lookY = dist * half * 0.76;   // however far back, feet stay low in the picture, on the wooden floor
  jam.cam.position.set(0, lookY + 0.2, dist);
  jam.cam.lookAt(0, lookY, 0);
  jam.cam.updateProjectionMatrix();
}
function openJam() {
  if (game.state !== 'farm' || !farm.stageBuilt || (GUEST && !jam.hostOpen)) return;
  closeHeroes(); closePond(); closeBunk(); closeStage();
  stopAllFishing();
  jamSetup();
  if (jam.model) { jam.scene.remove(jam.model.group); disposeHero(jam.model); }
  jam.model = hero().build();
  jam.banjo = banjoMesh();
  jam.model.inner.add(jam.banjo);
  jam.scene.add(jam.model.group);
  if (ownedDecor.has('drums') && !jam.kit) {   // the drum kit stands behind, beside the hopper
    jam.kit = new THREE.Group();
    buildDrumKit(jam.kit);
    jam.kit.position.set(0.74, 0, -0.75);
    jam.kit.rotation.y = -0.35;
    jam.kit.scale.setScalar(0.72);
    jam.scene.add(jam.kit);
  }
  $('instBtn').hidden = !ownedDecor.has('drums');
  setDrums(jam.drums);
  $('partyBtn').hidden = !RELAY;
  layoutStage();
  jam.open = true;
  jam.row = 1;
  jamPads.style.setProperty('--c', hero().pad);   // the pads take your hopper's colour
  $('jam').classList.add('show');
  game.picking = true;
  setOctave(0);
  setSustain(jam.sustain);
  setJamSong(jam.song);   // after jam.open, so the tune turns down (or up) to this player's level
  jamResize();
  tellView();
  jam.input = null;   // start with hints for the last thing used, or what this device has
  setJamInput(document.body.classList.contains('pad') ? 'pad' : document.body.classList.contains('keys') || matchMedia('(hover: hover) and (pointer: fine)').matches ? 'keys' : 'touch');
  if (!GUEST) { tellBand(); tellBeat(); }
}
function closeJam() {
  if (!jam.open) return;
  jam.open = false;
  music?.setLevel(1);   // the farm tune back to full
  $('jam').classList.remove('show');
  game.picking = anyPanel();
  letGoAll();
  tellView();
}
function jamFrame(dt) {
  const m = jam.model;
  if (!m) return;
  jam.t += dt;
  jam.kick = Math.max(0, jam.kick - dt * 4);
  jam.boom = Math.max(0, (jam.boom || 0) - dt * 6);
  if (jam.kit) jam.kit.scale.set(0.72 + jam.boom * 0.05, 0.72 - jam.boom * 0.04, 0.72 + jam.boom * 0.05);
  const t = jam.t, k = jam.kick;
  m.inner.position.y = Math.abs(Math.sin(t * 4.4)) * 0.05 + Math.sin(k * Math.PI) * 0.12;   // bob along, bounce on a note
  m.inner.scale.set(1 + k * 0.06, 1 - k * 0.08, 1 + k * 0.06);
  m.inner.rotation.z = Math.sin(t * 2.2) * 0.06;
  m.group.rotation.y = Math.PI - 0.3 + Math.sin(t * 1.1) * 0.18;
  const sway = Math.sin(t * 4.4) * 0.2 + k * 0.3;
  for (const tl of m.tails) tl.rotation[tl.userData.axis || 'z'] = tl.userData.side * sway;
  for (const e of bandOf()) {   // friends bob along, each a little out of step
    const pl = e[1];
    if (!pl.m) continue;
    pl.kick = Math.max(0, pl.kick - dt * 4);
    const q = t + bandN(e) * 0.37, pk = pl.kick;
    pl.m.inner.position.y = Math.abs(Math.sin(q * 4.4)) * 0.05 + Math.sin(pk * Math.PI) * 0.12;
    pl.m.inner.scale.set(1 + pk * 0.06, 1 - pk * 0.08, 1 + pk * 0.06);
    pl.m.inner.rotation.z = Math.sin(q * 2.2) * 0.06;
    pl.m.group.rotation.y = Math.PI - (pl.m.group.position.x < 0 ? -0.35 : 0.35) + Math.sin(q * 1.1) * 0.15;
    const sw = Math.sin(q * 4.4) * 0.2 + pk * 0.3;
    for (const tl of pl.m.tails) tl.rotation[tl.userData.axis || 'z'] = tl.userData.side * sw;
  }
  jam.r.render(jam.scene, jam.cam);
  if (!GUEST && jam.t - (jam.beatAt || 0) > 3) tellBeat();   // keep the guests' tune in step
}
$('octUp').addEventListener('click', () => setOctave(1));
$('octDown').addEventListener('click', () => setOctave(-1));
$('jamClose').addEventListener('click', closeJam);
window.addEventListener('resize', () => { if (jam.open) jamResize(); });

// ---------- jam with phones ----------
// "Jam with phones" shows a QR code. Each phone that scans it (up to four) opens
// remote/, picks a hopper from this farm and plays it from its own pads; its
// hopper joins yours on stage and every note plays here, with the soundtrack.
// The two meet through a small relay (relay/, address in relay-config.js).
const DEBUG = new URLSearchParams(location.search).has('debug');
const RELAY = (DEBUG && new URLSearchParams(location.search).get('relay')) || window.FARMHOP_RELAY_URL || '';
const party = { on: false, ws: null, room: null, retry: 0, ping: null, timer: null, players: new Map() };   // slot -> player
const partyOpen = () => !$('party').hidden;
// A room is named after a six-letter code, so a friend can also type it in: on an
// iPhone, invite links open in Safari, not in Farm Hop saved to the Home Screen.
// No I, L, O, 0 or 1, which are easy to mix up.
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeRoom = code => 'farmhop-code-' + code + '-room';
const roomCode = room => /^farmhop-code-([A-Z2-9]{6})-room$/.exec(room || '')?.[1] || null;
const showCode = code => code.slice(0, 3) + '-' + code.slice(3);
function partyRoom() {   // kept for the browser session, so a reload keeps the same QR and phones reconnect
  let r = null;
  try { r = sessionStorage.getItem('bl-party-room'); } catch {}
  if (!roomCode(r)) {   // (rooms from before the codes get a code too)
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    r = codeRoom([...b].map(n => CODE_ABC[n % CODE_ABC.length]).join(''));
    try { sessionStorage.setItem('bl-party-room', r); } catch {}
  }
  return r;
}
// What a friend typed, as a code, or null if it can't be one.
function readCode(text) {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 && [...code].every(c => CODE_ABC.includes(c)) ? code : null;
}
const partyLink = () => new URL('remote/', location.href).href.split('#')[0].replace(/\?.*$/, '') + '#r=' + party.room + (DEBUG && RELAY !== window.FARMHOP_RELAY_URL ? '&relay=' + encodeURIComponent(RELAY) : '');
function relaySend(to, msg) { if (party.ws && party.ws.readyState === 1) party.ws.send(to + '|' + msg); }
// To one phone (or '*' for all): straight down its direct link when it has one, else through the relay.
function partySend(to, obj) {
  const msg = JSON.stringify(obj), open = slot => peers.get(+slot)?.dc?.readyState === 'open';
  if (to !== '*') { if (open(to)) peers.get(+to).dc.send(msg); else relaySend(to, msg); return; }
  if (![...peers.keys()].some(open)) { relaySend('*', msg); return; }
  for (const slot of party.players.keys()) { if (open(slot)) peers.get(slot).dc.send(msg); else relaySend(slot, msg); }
}

// ---------- direct links (WebRTC) ----------
// Every phone starts on the relay, then offers this screen a direct WebRTC data
// channel, set up through the relay. On the same Wi-Fi the browsers connect over
// the home network (a few milliseconds instead of a trip to Cloudflare), or else
// straight across the internet; notes and hops then travel on it. If it can't
// connect, or drops, everything carries on through the relay as before.
// path: 'local' (same network), 'direct' (peer to peer across the internet), '' (relay).
const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const peers = new Map();   // slot -> { pc, dc, path }
function rtcSignal(slot, m) {
  if (m.sdp?.type === 'offer') {   // a phone (re)starting its direct link
    closePeer(slot);
    if (!window.RTCPeerConnection) return;
    const p = { pc: new RTCPeerConnection({ iceServers: ICE }), dc: null, path: '' };
    peers.set(slot, p);
    p.pc.onicecandidate = e => { if (e.candidate) relaySend(slot, JSON.stringify({ t: 'rtc', c: e.candidate.toJSON() })); };
    p.pc.ondatachannel = e => {
      const dc = p.dc = e.channel;
      dc.onopen = () => notePath(slot, p);
      dc.onmessage = ev => { let mm; try { mm = JSON.parse(ev.data); } catch { return; } onPlayer(slot, mm, true); };
      dc.onclose = () => { if (peers.get(slot) === p) closePeer(slot); };
    };
    p.pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(p.pc.connectionState) && peers.get(slot) === p) closePeer(slot); };
    p.pc.setRemoteDescription(m.sdp)
      .then(() => p.pc.createAnswer()).then(a => p.pc.setLocalDescription(a))
      .then(() => relaySend(slot, JSON.stringify({ t: 'rtc', sdp: p.pc.localDescription })))
      .catch(() => closePeer(slot));
  } else if (m.c) peers.get(slot)?.pc.addIceCandidate(m.c).catch(() => {});
}
async function notePath(slot, p) {   // which way did the browsers connect?
  p.path = 'direct';
  try {
    const stats = await p.pc.getStats();
    let pair = null;
    stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (pair && stats.get(pair.localCandidateId)?.candidateType === 'host') p.path = 'local';   // no router in the way: same network
  } catch {}
  renderParty();
  partySend(slot, { t: 'path', path: p.path });
}
function closePeer(slot) {
  const p = peers.get(slot);
  if (!p) return;
  peers.delete(slot);
  try { p.dc?.close(); p.pc.close(); } catch {}
  partySend(slot, { t: 'path', path: '' });
  renderParty();
}
function partyStart() {
  if (!RELAY || party.on) return;
  party.on = true;
  party.room = partyRoom();
  party.retry = 0;
  partyConnect();
}
function partyConnect() {
  if (!party.on) return;
  let ws;
  try { ws = new WebSocket(RELAY.replace(/\/$/, '') + '/room/' + party.room + '?role=host'); } catch { return; }
  party.ws = ws;
  ws.onopen = () => {
    party.retry = 0;
    clearInterval(party.ping);
    party.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
    renderParty();
  };
  ws.onmessage = e => {
    if (typeof e.data !== 'string' || e.data === 'pong') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.t === 'sys') {
      if (msg.ev === 'welcome') partySend('*', { t: 'who' });   // phones already in the room say hello again
      else if (msg.ev === 'peer-left' && msg.role === 'player') dropPlayer(msg.p);
    } else if (msg.t === 'from') {
      let m;
      try { m = JSON.parse(msg.m); } catch { return; }
      onPlayer(msg.p, m);
    }
  };
  ws.onclose = () => {
    clearInterval(party.ping);
    if (party.ws === ws) party.ws = null;
    renderParty();
    if (!party.on) return;
    clearTimeout(party.timer);
    party.timer = setTimeout(partyConnect, Math.min(15000, 1000 * 2 ** party.retry++));
  };
  ws.onerror = () => {};
}
function partyStop() {
  partySend('*', { t: 'bye' });
  relaySend('*', JSON.stringify({ t: 'bye' }));
  for (const slot of [...peers.keys()]) closePeer(slot);
  party.on = false;
  clearTimeout(party.timer);
  clearInterval(party.ping);
  try { party.ws?.close(); } catch {}
  party.ws = null;
  for (const [slot, p] of [...party.players]) if (!p.local) dropPlayer(slot);   // players on this screen stay
  try { sessionStorage.removeItem('bl-party-room'); } catch {}
  party.room = null;
  renderParty();
}
// ---------- Co-Op Hop ----------
// Starting the day with phones joined takes their hoppers onto the road too, in a
// row along the start line. A phone that joins mid-round drops in beside the team
// on its first hop. Each phone is told which screen to show: the jam pads, the hop
// pad, or a "waiting on the farm" note.
function setupCrew() {
  for (const [slot, pl] of [...party.players.entries()].sort((a, b) => a[0] - b[0])) {
    if (!pl.hero) continue;
    // A guest's hopper is moved on their own device ("remote"); a phone's, here.
    pl.road = { slot, key: 'p' + slot, hero: pl.hero, col: pl.col, parked: true, alive: false, active: false, remote: !!pl.guest };
    game.crew.push(pl.road);
  }
}
function placeCrew() {
  const lane = laneAt(0), spots = [-2, 2, -1, 1, -3, 3, -4, 4];
  let i = 0;
  for (const h of game.crew) {
    if (h === P) continue;
    let x = spots[i++ % spots.length];
    if (lane?.blocked?.has(x)) x = spots.find(c => !lane.blocked.has(c)) ?? 0;
    freshHopper(h, h.hero, x, 0);
    h.active = false;
  }
}
function addToRoad(slot, pl) {   // joined while a round is on
  const h = pl.road = { slot, key: 'p' + slot, hero: pl.hero, col: pl.col, parked: true, alive: false, active: false, remote: !!pl.guest };
  game.crew.push(h);
  if (game.state === 'title') { freshHopper(h, h.hero, [-2, 2, -1, 1][game.crew.length % 4], 0); }
  // A guest's device builds the road up to the team and drops them in beside it.
  if (pl.guest) partySend(slot, roadNews());
  tellView();
}
// The road as it stands, for guests' devices: the seed, the clock and everyone on it.
function roadNews() {
  return {
    t: 'road', seed: game.seed, T: game.roadT, state: game.state, score: game.score, day: game.day,
    crew: game.crew.map(h => ({ k: h.key, hero: h.hero, slot: h.slot, col: h.col ?? 0, x: h.x, r: h.r, alive: !!h.alive, parked: !!h.parked })),
  };
}
function dropFromRoad(pl) {
  const h = pl.road;
  if (!h) return;
  game.crew = game.crew.filter(o => o !== h);
  if (h.model) { scene.remove(h.model.group); disposeHero(h.model); }
  pl.road = null;
}
function currentView() {
  if (jam.open) return 'jam';
  if (game.where === 'road') return game.state === 'over' || game.state === 'dead' || game.state === 'dusk' ? 'over' : 'road';
  return 'farm';
}
function tellView() { partySend('*', { t: 'view', v: currentView(), score: game.score }); }
function tellHopper(h) { if (h.slot && !h.remote && !GUEST) partySend(h.slot, { t: 'me', alive: h.alive, back: Math.ceil(h.back) }); }

const taken = () => [heroId, ...[...party.players.values()].map(p => p.hero)];
function sendLobby(slot) {
  partySend(slot, { t: 'lobby', heroes: ownedHeroes().map(h => ({ id: h.id, pad: h.pad })), taken: taken() });
}
function lobbyAll() { for (const [slot, p] of party.players) if (!p.hero) sendLobby(slot); }
function onPlayer(slot, m, direct = false) {
  if (m.t === 'rtc') { if (!direct) rtcSignal(slot, m); return; }
  // Once a phone's direct link is open its notes and hops come that way; one still
  // on its way through the relay is older than what's already arrived, so skip it.
  if (!direct && peers.get(slot)?.dc?.readyState === 'open' && /^(note|drum|hop|leap|r[hdbpc]|fv|fc|fsell)$/.test(m.t)) return;
  const pl = party.players.get(slot);
  if (m.t === 'hello' && m.guest) {   // a friend playing on their own device: send them the farm
    const was = party.players.get(slot);
    if (was?.road) dropFromRoad(was);   // reconnecting mid-round: their old hopper makes way
    party.players.set(slot, { hero: null, kick: 0, guest: true, sup: !!m.sup });
    assign(slot, anyHero(m.hero) ? m.hero : 'betty');
    partySend(slot, { t: 'farm', farm: farmSnap(slot) });
    return;
  }
  // A guest may play any hopper: one from their own farm, or one of ours.
  if (m.t === 'pick' && pl?.guest) { if (anyHero(m.hero)) assign(slot, m.hero); return; }
  if (m.t === 'sup' && pl?.guest) { pl.sup = true; renderParty(); return; }   // a friend just became a supporter
  if (/^r[hdbpc]$/.test(m.t)) {   // a guest's hopper on the road
    if (!pl?.guest || game.where !== 'road') return;
    const k = 'p' + slot;
    if (m.t === 'rc') takeSunflower(m.r | 0, m.c | 0, true);
    else onRoadNews(game.crew.find(h => h.key === k), m);
    toGuests({ ...m, k }, slot);
    return;
  }
  if (/^f(v|c|sell)$/.test(m.t)) { if (pl?.guest && game.where === 'farm') guestFish(slot, m); return; }
  if (m.t === 'leap') {
    const w = pl?.guest && game.where === 'farm' && walkerOf('p' + slot);
    const x = clamp(+m.x, YARD.x0, YARD.x1), z = clamp(+m.z, YARD.z0, YARD.z1), up = clamp(+m.up || 0, 0, 0.5);
    if (w && isFinite(x) && isFinite(z)) { landLeap(w, x, z, up); toGuests({ t: 'leap', k: w.key, x, z, up }, slot); }
    return;
  }
  if (m.t === 'hello' || m.t === 'pick') {
    const want = m.t === 'pick' ? m.hero : m.hero;
    if (want && owned.has(want)) assign(slot, want);
    else { party.players.set(slot, { hero: null, kick: 0 }); sendLobby(slot); renderParty(); }
    return;
  }
  if (m.t === 'leave') { dropPlayer(slot); party.players.set(slot, { hero: null, kick: 0 }); renderParty(); return; }
  if (!pl || !pl.hero) return;
  if (m.t === 'hop') {
    const dx = clamp(m.dx | 0, -1, 1), dr = dx ? 0 : clamp(m.dr | 0, -1, 1);
    if (!dx && !dr) return;
    if (game.where === 'farm') { if (game.state === 'farm' && !jam.open && !decor.on) farmHop('p' + slot, dx, dr); return; }
    if (!pl.road) addToRoad(slot, pl);
    move(dx, dr, pl.road);
    return;
  }
  // A guest has already heard their own note: everyone else gets it from here.
  const others = pl.guest ? slot : undefined, k = 'p' + slot;
  if (m.t === 'oct') pl.oct = clamp(+m.v || 0, -1, 1);
  else if (m.t === 'sus') pl.sus = clamp(+m.v || 0, 0, 1);
  else if (m.t === 'mode') { pl.drums = !!m.drums && ownedDecor.has('drums'); if (pl.banjo) pl.banjo.visible = !pl.drums; tellBand(); }
  else if (!jam.open) return;   // notes only sound while the Jam Stage is open
  else if (m.t === 'note') {
    const r = clamp(m.r | 0, 0, JAM_ROWS - 1), c = clamp(m.c | 0, 0, SCALE.length - 1), key = 'r' + slot + '-' + r + '-' + c;
    if (!m.on) { letGo(key); toGuests({ t: 'jn', k, by: key, on: false }, others); return; }
    sfx.ensure();
    const f = noteFreq(pl.oct, r, c);
    sfx.voice(pl.hero, f, true);
    letGo(key);
    const release = sfx.hold(pl.hero, f, pl.sus);
    if (release) jam.held.set(key, release);
    pl.kick = 1;
    floatNote(HEROES.find(h => h.id === pl.hero).pad, pl.m?.group.position.x);
    toGuests({ t: 'jn', k, by: key, hero: pl.hero, f, sus: pl.sus, on: true, hold: true }, others);
  } else if (m.t === 'drum') {
    const d = clamp(m.d | 0, 0, 7);
    sfx.ensure();
    sfx.drum(d);
    pl.kick = 1;
    jam.boom = 1;
    floatNote(DRUM_COLORS[d], pl.m?.group.position.x);
    toGuests({ t: 'jd', k, d }, others);
  }
}
// ---------- Co-Op Hop with friends on their own devices ----------
// Each device sends what its own hoppers do: rh (a hop, or a bump), rd (knocked
// out), rb (dropped back in), rp (sat out), rc (picked a sunflower). The host passes
// a guest's news on to the other guests, and every 0.2 s tells them the road's
// clock, the score, the daylight and how the round is going (rs).
function roadSend(m) {
  if (game.where !== 'road') return;
  if (GUEST) guestNet.send(m);
  else toGuests(m);
}
function onRoadNews(h, m) {   // a friend's hopper, as their device reports it
  if (!h) return;
  if (m.t === 'rh') {
    if (game.state === 'title' && !GUEST) startGame();
    if (!h.alive) return;
    h.parked = false;
    h.active = true;
    h.model.group.visible = true;
    const tl = laneAt(m.tr);
    h.x = +m.fx; h.r = m.fr | 0; h.z = -h.r; h.log = null;
    h.faceTarget = +m.face || 0;
    h.hop = { fx: h.x, fz: h.z, fy: h.y, tx: +m.tx, tz: -(m.tr | 0), ty: tl ? LANE_Y[tl.type] : 0, t: 0, fromR: h.r, toR: m.tr | 0, h: m.bump ? 0.15 : 0.5, bump: !!m.bump };
    if (!m.bump) { h.tailVel += 9; sfx.hop(h.hero); }
  } else if (m.t === 'rd') {
    h.x = +m.x; h.r = m.r | 0; h.z = -h.r; h.hop = null;
    die(m.kind, null, laneAt(h.r) || { dir: m.dir, type: m.type }, h);
  } else if (m.t === 'rb') {
    if (game.state !== 'play' && game.state !== 'title') return;
    const r = m.r | 0, lane = laneAt(r);
    freshHopper(h, h.hero, +m.x, r);
    h.active = true;
    h.hop = { fx: h.x, fz: -r, fy: 2.4, tx: h.x, tz: -r, ty: lane ? LANE_Y[lane.type] : 0, t: 0, fromR: r, toR: r, h: 0 };
    burst(h.x, 1.2, -r, [0xffd23f, 0xffffff, MARK_COLORS[h.col ?? h.slot] || 0xff8fc8], 14, 1.5, 3, 0.09, 0.7);
  } else if (m.t === 'rp') {
    h.parked = true;
    h.model.group.visible = false;
  }
}
function takeSunflower(r, c, count) {   // someone picked one: gone from every screen, counted once, by the host
  const lane = laneAt(r), coin = lane?.coins.find(o => o.c === c);
  if (coin) {
    lane.group.remove(coin.m);
    lane.coins.splice(lane.coins.indexOf(coin), 1);
    burst(c, 0.6, -r, [0xffd23f, 0xffe680, 0xffffff], 10, 1.5, 4, 0.08, 0.5);
  }
  if (!count) return;
  game.coins++;
  game.today++;
  store.set('bl-coins', game.coins);
  hud();
}
let roadTold = 0;
function tellRoad() {   // host: the shared clock and the round, a few times a second
  if (!guests().length || game.time - roadTold < 0.2) return;
  roadTold = game.time;
  toGuests({ t: 'rs', T: game.roadT, day: game.day, score: game.score, state: game.state, coins: game.coins, today: game.today, death: game.lastDeath?.death, hero: game.lastDeath?.hero });
}
// Guest: follow the host's road clock, easing in small differences and jumping big ones.
let roadClock = { T: 0, at: 0 };
function guestRoadDt(dt) {
  // at most half a second past the host's last word: if their screen pauses (hidden, asleep), so does ours
  const target = roadClock.T + Math.min(0.5, (performance.now() - roadClock.at) / 1000);
  const ahead = target - (game.roadT + dt);
  if (ahead > 0.6) {   // fell well behind (a hidden tab): catch every lane up at once
    for (const lane of lanes.values()) catchUp(lane, ahead);
    game.roadT += ahead;
    return dt;
  }
  return Math.max(0, dt + clamp(ahead * 0.3, -dt * 0.5, dt * 0.5));
}

// ---------- the Jam Stage with friends on their own devices ----------
// The host lists the band for its guests (tellBand), and every few seconds says
// where the tune is (tellBeat) so their soundtrack plays the same bar. Notes and
// drum hits go to everyone: jn (a note, with its pitch, held until a matching
// note-off) and jd (a drum).
function tellBand() {
  if (GUEST) return;
  const list = [{ k: 'h', n: 0, hero: heroId, drums: jam.drums },
    ...[...party.players].filter(([, p]) => p.hero).map(([slot, p]) => ({ k: 'p' + slot, n: slot, hero: p.hero, drums: !!p.drums }))];
  for (const [slot] of guests()) partySend(slot, { t: 'band', list: list.filter(b => b.k !== 'p' + slot) });
}
function tellBeat() {
  jam.beatAt = jam.t;
  if (music && guests().length) toGuests({ t: 'beat', pos: music.position() });
}
function applyBand(list) {   // guest: the rest of the band, as the host lists it
  const keys = new Set(list.map(b => b.k));
  for (const [k, pl] of [...jam.band]) {
    const b = list.find(o => o.k === k);
    if (keys.has(k) && b.hero === pl.hero) continue;
    if (pl.m) { jam.scene?.remove(pl.m.group); disposeHero(pl.m); }
    jam.band.delete(k);
  }
  for (const b of list) {
    const pl = jam.band.get(b.k) || { hero: b.hero, n: b.n, kick: 0, m: null, banjo: null };
    pl.drums = !!b.drums;
    if (pl.banjo) pl.banjo.visible = !pl.drums;
    jam.band.set(b.k, pl);
  }
  layoutStage();
}
function bandNote(m) {   // guest: someone else's note
  const id = 'n' + m.k + ':' + m.by;
  letGo(id);
  if (!m.on || !jam.open) return;
  sfx.ensure();
  const f = +m.f;
  sfx.voice(m.hero, f, true);
  if (m.hold) { const release = sfx.hold(m.hero, f, clamp(+m.sus || 0, 0, 1)); if (release) jam.held.set(id, release); }
  const pl = jam.band.get(m.k);
  if (pl) pl.kick = 1;
  floatNote(HEROES.find(h => h.id === m.hero)?.pad || '#fff', pl?.m?.group.position.x);
}
function bandDrum(m) {
  if (!jam.open) return;
  const d = clamp(m.d | 0, 0, 7), pl = jam.band.get(m.k);
  sfx.ensure();
  sfx.drum(d);
  jam.boom = 1;
  if (pl) pl.kick = 1;
  floatNote(DRUM_COLORS[d], pl?.m?.group.position.x);
}
const LOOP_S = 512 * 60 / 84 / 4;   // the tune's 32-bar loop, in seconds (music.js)
function followBeat(pos) {   // guest: line our tune up with the host's, if it's drifted
  if (!music) return;
  const want = (+pos + 0.04) % LOOP_S;   // a little for the trip
  let off = Math.abs(music.position() - want);
  off = Math.min(off, LOOP_S - off);
  if (off > 0.08) music.seek(want);
}

// ---------- player colours ----------
// The host is player 1 (red); everyone else takes the first colour free when they
// join: blue, yellow, green, then purple.
function colorOf(slot) { return slot ? party.players.get(slot)?.col ?? Math.min(slot, 4) : 0; }
function freeColor(slot) {
  const used = new Set([...party.players].filter(([s, p]) => s !== slot && p.hero).map(([, p]) => p.col));
  for (let c = 1; c < MARK_COLORS.length; c++) if (!used.has(c)) return c;
  return MARK_COLORS.length - 1;
}

// ---------- local co-op: more players on this screen ----------
// Extra controllers (press Start or A on one to join) and a keyboard player (the
// arrow keys, while the host keeps WASD) play right here as players of their own:
// a hopper on the farm, on the road (split screen with two) and on the Jam Stage.
// They sit in slots after the phones' (5-8) and play through the very messages a
// phone sends, so everything a phone can do, they can.
const LOCAL_SLOTS = [5, 6, 7, 8];
const localPlayers = () => [...party.players].filter(([, p]) => p.local);
const keysPlayer = () => localPlayers().find(([, p]) => p.local.keys)?.[0];
function addLocal(local) {
  if (GUEST) return null;
  const slot = LOCAL_SLOTS.find(s => !party.players.has(s));
  if (!slot) return null;
  const busy = new Set([heroId, ...[...party.players.values()].map(p => p.hero)]);   // a hopper nobody's playing, if there is one
  const hero = ownedHeroes().map(h => h.id).find(id => !busy.has(id)) || heroId;
  party.players.set(slot, { hero: null, kick: 0, local });
  assign(slot, hero);
  sfx.ensure();
  sfx.place();
  return slot;
}
function nextLocalHero(slot) {
  const pl = party.players.get(slot), ids = ownedHeroes().map(h => h.id);
  if (pl) assign(slot, ids[(ids.indexOf(pl.hero) + 1) % ids.length]);
}
const localPads = new Map();   // gamepad index -> { prev, stick, slot }
function pollLocalPads(list) {
  for (const gp of list) {
    const st = localPads.get(gp.index) || { prev: [], stick: null, slot: null };
    localPads.set(gp.index, st);
    const down = gp.buttons.map(b => b.pressed), prev = st.prev;
    st.prev = down;
    const pressed = i => down[i] && !prev[i], released = i => !down[i] && prev[i];
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, mag = Math.hypot(ax, ay);
    const stick = mag > 0.55 ? (Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up')) : mag > 0.3 ? st.stick : null;
    const flick = stick && stick !== st.stick ? stick : null;
    st.stick = stick;
    const dir = pressed(12) ? 'up' : pressed(13) ? 'down' : pressed(14) ? 'left' : pressed(15) ? 'right' : flick;
    if (st.slot && !party.players.get(st.slot)?.local) st.slot = null;   // removed from the menu
    if (!st.slot) {   // Start or A: join in
      if ((pressed(9) || pressed(0)) && !jam.open && ['farm', 'title', 'play'].includes(game.state)) { st.slot = addLocal({ pad: gp.index }); renderParty(); }
      continue;
    }
    const slot = st.slot, pl = party.players.get(slot), send = m => onPlayer(slot, m);
    if (jam.open) {   // the six buttons play the row the d-pad picked; left/right shift the octave
      if (dir === 'up' || dir === 'down') pl.row = clamp((pl.row ?? 1) + (dir === 'down' ? 1 : -1), 0, JAM_ROWS - 1);
      if (dir === 'left' || dir === 'right') send({ t: 'oct', v: clamp(pl.oct + (dir === 'right' ? 1 : -1), -1, 1) });
      PAD_BTNS.forEach((b, col) => {
        if (pressed(b)) { st[b] = pl.row ?? 1; send({ t: 'note', r: st[b], c: col, on: true }); }
        if (released(b)) send({ t: 'note', r: st[b] ?? 1, c: col, on: false });
      });
      continue;
    }
    if (game.picking) continue;
    const fk = 'p' + slot, lf = fishers.get(fk);
    if (lf) {   // fishing: A casts and reels, B or X stops
      if (pressed(0)) fishPress(lf, true);
      if (released(0)) fishPress(lf, false);
      if (pressed(1) || pressed(2)) stopFish(fk);
      continue;
    }
    if (game.state === 'farm' && pressed(2)) { goFish(fk, 'pad'); continue; }   // X: go fishing
    if (dir) send({ t: 'hop', dx: DIRS[dir][0], dr: DIRS[dir][1] });
    if (released(0)) send({ t: 'hop', dx: 0, dr: 1 });   // A, like a tap: hop forward
    if (game.state === 'farm') {
      if (pressed(3)) nextLocalHero(slot);                   // Y: the next hopper
      if (pressed(8)) { dropPlayer(slot); renderParty(); }    // Back / Select: leave
    }
  }
}

// ---------- guests: friends playing the game on their own device ----------
const guests = () => [...party.players.entries()].filter(([, p]) => p.guest);
function toGuests(obj, except) { for (const [slot] of guests()) if (slot !== except) partySend(slot, obj); }
function farmSnap(slot) {   // the farm's settings, which hopper they're playing, and where everyone is
  const keys = {};
  for (const k of FARM_KEYS) { const v = store.get(k, null); if (v !== null) keys[k] = v; }
  keys['bl-hero'] = party.players.get(slot)?.hero || 'betty';
  if (supporter) keys['bl-owned'] = [...new Set([...(keys['bl-owned'] || []), ...SUP_HEROES])];   // a supporter's own hoppers live here too
  keys['bl-dnb'] = songStyle() === 'dnb';
  return { keys, me: 'p' + slot, walkers: farm.walkers ? crewList() : [] };
}
const anyHero = id => HEROES.some(h => h.id === id);
let farmTimer = null;
if (!GUEST) onFarmSave = () => {   // bought, built or moved something: guests get the new farm
  clearTimeout(farmTimer);
  farmTimer = setTimeout(() => { for (const [slot] of guests()) partySend(slot, { t: 'farm', farm: farmSnap(slot) }); }, 400);
};
function assign(slot, hero) {
  const old = party.players.get(slot);
  if (old?.m) { jam.scene?.remove(old.m.group); disposeHero(old.m); }
  const pl = { hero, oct: 0, sus: 0.35, drums: false, kick: 0, m: null, banjo: null, guest: !!old?.guest, local: old?.local || null, col: old?.col ?? freeColor(slot), sup: !!old?.sup };
  party.players.set(slot, pl);
  if (jam.scene) addPlayerModel(pl);
  if (old?.road) dropFromRoad(old);
  partySend(slot, { t: 'joined', hero, pad: HEROES.find(h => h.id === hero).pad, drums: ownedDecor.has('drums'), mark: MARK_CSS[pl.col] });
  partySend(slot, { t: 'view', v: currentView(), score: game.score });
  if (game.where === 'road' && (game.state === 'title' || game.state === 'play')) addToRoad(slot, pl);
  lobbyAll();
  layoutStage();
  renderParty();
  syncPlayerWalkers();
  tellBand();
}
function addPlayerModel(pl) {
  pl.m = HEROES.find(h => h.id === pl.hero).build();
  pl.banjo = banjoMesh();
  pl.banjo.visible = !pl.drums;
  pl.m.inner.add(pl.banjo);
  jam.scene.add(pl.m.group);
}
function dropPlayer(slot) {
  stopFish('p' + slot);
  closePeer(slot);
  const pl = party.players.get(slot);
  if (!pl) return;
  for (const key of [...jam.held.keys()]) if (key.startsWith('r' + slot + '-')) letGo(key);
  if (pl.m) { jam.scene?.remove(pl.m.group); disposeHero(pl.m); }
  dropFromRoad(pl);
  party.players.delete(slot);
  lobbyAll();
  layoutStage();
  renderParty();
  syncPlayerWalkers();
  tellBand();
}
// Everyone in a row across the stage, yours in the middle; the drum kit moves to the back.
function layoutStage() {
  if (!jam.scene || !jam.model) return;
  for (const [, pl] of bandOf()) if (pl.hero && !pl.m) addPlayerModel(pl);
  const cast = [jam.model, ...bandOf().sort((a, b) => bandN(a) - bandN(b)).map(e => e[1].m).filter(Boolean)];
  const order = cast.map((_, i) => i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2));   // middle, left, right, further left...
  cast.forEach((m, i) => { m.group.position.x = order[i] * 1.05; });
  jam.spread = Math.max(0, ...order.map(o => Math.abs(o) * 1.05));
  if (jam.kit) {   // the drum kit stands at the right end of the row, just behind
    const right = Math.max(...order) * 1.05;
    jam.kit.position.set(right + 0.74, 0, -0.75);
    jam.spread = Math.max(jam.spread, right + 0.74 + 0.4 - 1.15);
  }
  if (jam.open) jamResize();
}
function floatNote(color, x = 0) {
  const note = document.createElement('span');
  note.className = 'jamNote';
  note.textContent = pick(['♪', '♫', '♩', '♬']);
  note.style.color = color;
  note.style.left = clamp(50 + x / (1.15 + jam.spread) * 45 + (Math.random() - 0.5) * 12, 4, 92) + '%';
  $('jamNotes').append(note);
  setTimeout(() => note.remove(), 1400);
}
// The QR panel and the row of friends on stage.
let qrLib = null;
function loadQr() {
  return qrLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLib = null; reject(); };
    document.head.append(s);
  });
}
let qrFor = '';
function renderParty() {
  const list = [...party.players.entries()].filter(([, p]) => p.hero).sort((a, b) => a[1].col - b[1].col);
  const chip = ([slot, p]) => {
    const path = p.local ? 'screen' : peers.get(slot)?.path || 'relay';
    const how = p.local?.keys ? ' ⌨' : p.local ? ' 🎮' : '';
    return `<span class="partyChip" style="--c:${HEROES.find(h => h.id === p.hero).pad}"><b style="background:${MARK_CSS[p.col]}">${p.col + 1}</b>${heroName(p.hero)}${p.sup ? HEART_SVG : ''}${how}<i class="path ${path}">${t('party.' + path)}</i></span>`;
  };
  $('partyChips').innerHTML = list.map(chip).join('');
  const far = list.filter(([, p]) => !p.local), here = list.filter(([, p]) => p.local);
  $('partyList').innerHTML = far.length ? far.map(chip).join('') : '<span class="partyNone"></span>';
  // Players on this screen: tap to change hopper, ✕ to leave.
  $('partyLocal').innerHTML = here.map(([slot, p]) => `<button class="localChip" data-slot="${slot}">${chip([slot, p])}<span class="x" data-x="${slot}" aria-label="${t('party.leave')}">✕</span></button>`).join('');
  $('partyKeys').hidden = !!keysPlayer() || here.length >= LOCAL_SLOTS.length;
  const none = $('partyList').querySelector('.partyNone');
  if (none) none.textContent = t('party.none');
  $('partyBtn').classList.toggle('live', party.on);
  $('partyCount').textContent = list.length ? list.length : '';
  $('phonesBtn').classList.toggle('live', list.length > 0);
  $('phonesCount').textContent = list.length ? list.length : '';
  if (!party.on || !partyOpen()) return;
  const link = partyLink();
  if (qrFor !== link) {
    qrFor = link;
    $('partyQr').innerHTML = '';
    loadQr().then(qrcode => {
      if (qrFor !== link) return;
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      $('partyQr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
    }).catch(() => { $('partyQr').textContent = link; });
  }
  $('partyStatus').textContent = party.ws?.readyState === 1 ? '' : t('remote.connecting');
  $('partyCode').textContent = roomCode(party.room) ? showCode(roomCode(party.room)) : '';
}
function openParty() {
  if (GUEST) return;
  partyStart();
  $('party').hidden = false;
  game.picking = true;
  renderParty();
}
function closeParty() {
  $('party').hidden = true;
  game.picking = jam.open || anyPanel();
}
$('phonesBtn').addEventListener('click', () => { sfx.ensure(); if (game.state === 'farm') openParty(); });
$('partyBtn').addEventListener('click', () => { sfx.ensure(); openParty(); });
$('partyDone').addEventListener('click', closeParty);
$('party').addEventListener('click', e => { if (e.target.id === 'party') closeParty(); });   // a tap off the menu closes it
$('partyKeys').addEventListener('click', () => { addLocal({ keys: true }); renderParty(); });
$('partyLocal').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'), b = e.target.closest('[data-slot]');
  if (x) { dropPlayer(+x.dataset.x); renderParty(); }
  else if (b) nextLocalHero(+b.dataset.slot);
});
$('partyStop').addEventListener('click', () => { partyStop(); closeParty(); });
// Join a friend's farm by its code: this game reopens as their guest.
$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = readCode($('joinCode').value);
  if (!code) { $('joinNote').textContent = t('party.badCode'); sfx.bump(); return; }
  if (codeRoom(code) === party.room) { $('joinNote').textContent = t('party.badCode'); sfx.bump(); return; }   // that's this farm
  partyStop();
  location.hash = 'join=' + codeRoom(code);
  location.reload();
});
$('joinCode').addEventListener('input', () => { $('joinNote').textContent = ''; });
// A friend who opened the invite in Safari on an iPhone or iPad, where links don't
// open the Home Screen app: tell them the code, in case they'd rather play there.
if (GUEST && roomCode(GUEST) && /iPhone|iPad|iPod/.test(navigator.userAgent) && !navigator.standalone) {
  const note = $('homeNote'), code = showCode(roomCode(GUEST));
  const [before, after] = t('party.homeNote').split('{code}');
  note.querySelector('span').replaceChildren(before, Object.assign(document.createElement('b'), { textContent: code }), after ?? '');
  note.hidden = false;
  $('homeNoteX').addEventListener('click', () => { note.hidden = true; });
}
$('partyCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(inviteLink()).then(() => { $('partyCopy').textContent = t('party.copied'); setTimeout(() => { $('partyCopy').textContent = t('party.copy'); }, 1500); }).catch(() => {});
});
// "Send invite": a link that opens the whole game on the friend's own device, on
// this farm (see guest.js), through the share sheet (Messages, WhatsApp...) or copied.
const inviteLink = () => new URL('./', location.href).href.split('#')[0].replace(/\?.*$/, '') + '#join=' + party.room + (DEBUG && RELAY !== window.FARMHOP_RELAY_URL ? '&relay=' + encodeURIComponent(RELAY) : '');
$('partyInvite').addEventListener('click', async () => {
  sfx.ensure();
  const url = inviteLink();
  if (navigator.share) {
    const code = roomCode(party.room), text = t('party.inviteText') + (code ? ' ' + t('party.codeLine', { code: showCode(code) }) : '');
    try { await navigator.share({ title: "Betty Lou's Farm Hop", text, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  navigator.clipboard?.writeText(url).then(() => {
    $('partyInvite').textContent = t('party.inviteCopied');
    setTimeout(() => { $('partyInvite').textContent = t('party.invite'); }, 1800);
  }).catch(() => {});
});
if (RELAY && !GUEST) try { if (sessionStorage.getItem('bl-party-room')) partyStart(); } catch {}   // a reload mid-jam picks the phones back up

// ---------- Google account: cloud saves ----------
// Signed in, everything this device saves (the farm, sunflowers, hoppers, the Fish
// Book, Hop Supporter, settings) is copied to the player's Google account, and comes
// down again on another device. See account/tuko-account.js; the farm saves on the
// device first, as always.
const DEVICE_ONLY = ['bl-gfx-auto', 'bl-beat-lag', 'bl-beat-auto', 'bl-fishcam', 'bl-lat-nudge'];   // measured on this device: not worth carrying over
const savedKeys = () => Object.keys(localStorage).filter(k => k.startsWith('bl-') && !DEVICE_ONLY.includes(k));
const account = window.TUKO_FIREBASE && !GUEST ? createAccount({
  app: 'farmhop',
  config: window.TUKO_FIREBASE,
  read: () => Object.fromEntries(savedKeys().map(k => [k, localStorage.getItem(k)])),
  write: data => {   // the account's farm replaces this device's: start again on it
    for (const k of savedKeys()) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(data)) if (k.startsWith('bl-') && typeof v === 'string') localStorage.setItem(k, v);
    location.reload();
  },
  fresh: data => !['bl-coins', 'bl-top', 'bl-owned', 'bl-pond', 'bl-fish', 'bl-bag', 'bl-supporter', 'bl-bunk', 'bl-stage'].some(k => k in data),
}) : null;
if (account) onLocalSave = () => account.changed();
function farmSummary(data) {   // "12 sunflowers · 3 hoppers · pond level 4 · best 57"
  const v = (k, d) => { try { return JSON.parse(data[k]) ?? d; } catch { return d; } };
  return t('acct.sum', { coins: v('bl-coins', 0), hoppers: 1 + v('bl-owned', []).length, pond: v('bl-pond', 0), top: v('bl-top', 0), fish: Object.keys(v('bl-fish', {})).length });
}
const pickOpen = () => $('acctPick').classList.contains('show');
let pickShown = false;   // asked once per conflict; after that, from Settings
function renderAccount() {
  if (!account) { $('acctRow').hidden = true; return; }
  const s = account.state, u = s.user;
  $('acctRow').hidden = false;
  $('acctOut').hidden = !!u || !s.ready;
  if (!u) account.prepare();   // the sign-in button is showing: get Firebase ready for the tap
  $('acctIn').hidden = !u;
  if (!u) return;
  $('acctPic').src = u.photo || 'icon-192.png';
  $('acctName').textContent = u.name;
  $('acctEmail').textContent = u.email;
  $('acctStatus').textContent = s.status === 'saved' ? t('acct.saved', { time: new Date(s.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })
    : t('acct.' + ({ syncing: 'saving', error: 'error', conflict: 'conflict' }[s.status] || 'saving'));
  $('acctPickBtn').hidden = s.status !== 'conflict';
}
function openPick() {
  const c = account.state.conflict;
  if (!c) return;
  $('pickDeviceSum').textContent = farmSummary(c.device);
  $('pickAccountSum').textContent = farmSummary(c.account);
  closeSettings();
  $('acctPick').classList.add('show');
  game.picking = true;
}
function closePick() {
  $('acctPick').classList.remove('show');
  game.picking = anyPanel();
}
function accountError(e) {
  console.warn(e);
  const s = $('acctStatus');
  if (s) s.textContent = t('acct.error');
}
if (account) {
  account.on(s => {
    if ($('settings').classList.contains('show')) renderAccount();   // (Settings is set up further down)
    if ($('support').classList.contains('show')) refreshSupport();   // signed in from the supporter panel: on to paying
    if (s.status !== 'conflict') pickShown = false;
    else if (!pickShown && game.where === 'farm' && !anyPanel()) { pickShown = true; openPick(); }   // ask straight away, once
  });
  $('acctSignIn').addEventListener('click', () => { sfx.ensure(); account.signIn().catch(accountError); });
  $('supSignIn').addEventListener('click', () => { sfx.ensure(); account.signIn().catch(e => { console.warn(e); $('supGateNote').textContent = t('acct.error'); }); });
  $('acctOutBtn').addEventListener('click', () => account.signOut().then(renderAccount));
  $('acctPickBtn').addEventListener('click', openPick);
  $('acctDel').addEventListener('click', async () => {
    if (!confirm(t('acct.deleteSure'))) return;
    try { await account.deleteAll(); renderAccount(); } catch (e) { accountError(e); }
  });
  $('pickDevice').addEventListener('click', () => { closePick(); account.keep('device'); });
  $('pickAccount').addEventListener('click', () => { closePick(); account.keep('account'); });
  $('pickClose').addEventListener('click', closePick);
  $('acctPick').addEventListener('click', e => { if (e.target.id === 'acctPick') closePick(); });
}

// ---------- settings (from the farm only) ----------
// Language, music and effects volume, the road's view angle, and the art style.
// With a controller or arrow keys: up/down picks a row, left/right changes it.
const settingsOpen = () => $('settings').classList.contains('show');
const SET_ROWS = [...(account ? ['acct'] : []), ...(SUPPORT_URL ? ['sup'] : []), 'lang', 'music', 'fx', 'timing', 'coop', 'hand', 'gfx'];   // in the order they're shown
const GFX_CHOICES = ['auto', ...Q_LEVELS];
let setFocus = 0;
function segment(el, labels, current, pick, icons) {
  el.innerHTML = '';
  labels.forEach((label, i) => {
    const b = document.createElement('button');
    b.className = 'segBtn';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(i === current));
    b.innerHTML = (icons ? icons[i] : '') + '<span></span>';
    b.querySelector('span').textContent = label;
    b.addEventListener('click', () => { sfx.ensure(); pick(i); });
    el.append(b);
  });
}
function setVolSlider(id, v) {
  const el = $(id);
  el.value = Math.round(v * 100);
  el.style.setProperty('--fill', el.value + '%');
}
function renderSettings() {
  segment($('segLang'), LANGS.map(l => l.label), LANGS.findIndex(l => l.id === lang), i => setLang(LANGS[i].id));
  segment($('segCoop'), t('coopScreens'), splitPref ? 1 : 0, i => setSplit(!!i));
  segment($('segHand'), t('lat.offOn'), lefty ? 1 : 0, i => setLefty(!!i));
  $('coopNote').textContent = t('coopNote');
  const gi = GFX_CHOICES.indexOf(gfx);
  segment($('segGfx'), t('gfxs'), gi, i => setGfx(GFX_CHOICES[i]));
  $('gfxNote').textContent = t('gfxNotes.' + gi, { level: t('gfxs')[GFX_CHOICES.indexOf(autoQ.level)] });
  const v = sfx.volumes;
  setVolSlider('volMusic', v.music);
  setVolSlider('volFx', v.fx);
  renderLatency();
  renderAccount();
  $('supRow').hidden = !SUPPORT_URL;
  $('supBtn').hidden = supporter;
  $('supHave').hidden = !supporter;
  $('songRow').hidden = !supporter || !!GUEST;   // on a friend's farm, the farm's song is theirs to pick
  if (supporter && !GUEST) segment($('segSong'), t('sup.songs'), songStyle() === 'dnb' ? 1 : 0, i => setSong(!!i));
  const nav = document.body.classList.contains('pad') || document.body.classList.contains('keys');
  document.querySelectorAll('.setRow').forEach(r => r.classList.toggle('focus', nav && r.dataset.row === SET_ROWS[setFocus]));
}
function setLang(id) {
  lang = id;
  store.set('bl-lang', id);
  applyLang();
}
function setGfx(name) {
  gfx = name;
  store.set('bl-gfx', name);
  Object.assign(autoQ, { dts: [], calm: 0, tried: false, noUp: false });
  applyQuality();
  renderSettings();
}
// Left-handed mode: the farm, decorate and fishing buttons on the left instead of the right.
let lefty = store.get('bl-lefty', false);
document.body.classList.toggle('lefty', lefty);
function setLefty(on) {
  lefty = on;
  store.set('bl-lefty', on);
  document.body.classList.toggle('lefty', on);
  renderSettings();
}
function setSplit(on) {
  splitPref = on;
  store.set('bl-split', on);
  renderSettings();
}
// Put every visible word into the chosen language.
function applyLang() {
  document.documentElement.lang = (LANGS.find(l => l.id === lang) || LANGS[0]).html;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('#heroGrid .heroCard, #bunkGrid .heroCard').forEach(c => { c.querySelector('.heroName').textContent = heroName(c.dataset.id); });
  hud();
  setHint();
  if (pondOpen()) refreshPond();
  if (bunkOpen()) refreshBunk();
  if (buildsOpen()) refreshBuilds();
  if (bookOpen()) refreshBook();
  if (bagOpen() && !asking()) refreshBag();
  if (landOpen()) refreshLand();
  if (shopOpen()) refreshShop();
  if (stageOpen()) refreshStage();
  if (settingsOpen()) { renderSettings(); if (setTab === 'upd') renderUpdates(); }
}
// Settings has two tabs: the settings, and Updates (the developer log in updates.js),
// in the player's language. Tab, Q / E or LB / RB switch tabs; on Updates the arrows scroll.
let setTab = 'set';
function setSettingsTab(tab) {
  setTab = tab;
  document.querySelector('.setPanel').classList.toggle('upd', tab === 'upd');
  for (const [id, on] of [['tabSet', tab === 'set'], ['tabUpd', tab === 'upd']]) {
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-selected', String(on));
  }
  if (tab === 'upd') renderUpdates();
  document.querySelector('.setPanel .panelBody').scrollTop = 0;
}
function renderUpdates() {
  const html = (LANGS.find(l => l.id === lang) || LANGS[0]).html;
  $('updList').replaceChildren(...UPDATES.map(u => {
    const tr = u[lang] || u, day = document.createElement('article'), when = document.createElement('time');
    day.className = 'updDay';
    when.dateTime = u.date;
    when.textContent = new Date(u.date + 'T12:00:00').toLocaleDateString(html, { year: 'numeric', month: 'long', day: 'numeric' });
    const h = document.createElement('h3'), ul = document.createElement('ul');
    h.textContent = tr.title || u.title;
    for (const n of tr.notes || u.notes) { const li = document.createElement('li'); li.textContent = n; ul.append(li); }
    day.append(when, h, ul);
    return day;
  }));
}
$('tabSet').addEventListener('click', () => setSettingsTab('set'));
$('tabUpd').addEventListener('click', () => setSettingsTab('upd'));
function openSettings() {
  if (game.state !== 'farm') return;
  closeHeroes();
  closePond();
  closeBunk();
  setFocus = 0;
  setSettingsTab('set');
  renderSettings();
  $('settings').classList.add('show');
  game.picking = true;
}
function closeSettings() {
  $('settings').classList.remove('show');
  game.picking = anyPanel();
}
function settingsNav(dir) {
  if (dir === 'up' || dir === 'down') {
    setFocus = (setFocus + (dir === 'down' ? 1 : -1) + SET_ROWS.length) % SET_ROWS.length;
    renderSettings();
    return;
  }
  const d = dir === 'right' ? 1 : -1, row = SET_ROWS[setFocus];
  if (row === 'lang') setLang(LANGS[(LANGS.findIndex(l => l.id === lang) + d + LANGS.length) % LANGS.length].id);
  else if (row === 'music' || row === 'fx') {
    sfx.setVolume(row, clamp(Math.round((sfx.volumes[row] + d * 0.1) * 10) / 10, 0, 1));
    if (row === 'fx') sfx.hop(heroId);
    renderSettings();
  } else if (row === 'timing') { setBeatLag(beatLag + d * 0.005); renderLatency(); }
  else if (row === 'coop') setSplit(!splitPref);
  else if (row === 'hand') setLefty(!lefty);
  else if (row === 'gfx') setGfx(GFX_CHOICES[(GFX_CHOICES.indexOf(gfx) + d + GFX_CHOICES.length) % GFX_CHOICES.length]);
  else if (row === 'acct') { if (!account.state.user) account.signIn().catch(accountError); }
  else if (row === 'sup') { if (supporter && !GUEST) setSong(songStyle() !== 'dnb'); else if (!supporter) openSupport(); }
}
for (const [id, which] of [['volMusic', 'music'], ['volFx', 'fx']]) {
  $(id).addEventListener('input', e => {
    sfx.ensure();
    sfx.setVolume(which, e.target.value / 100);
    e.target.style.setProperty('--fill', e.target.value + '%');
  });
}
$('volFx').addEventListener('change', () => sfx.hop(heroId));   // hear the new level

// ---------- rhythm latency ----------
// How far after the beat this player's taps land: a slider in milliseconds, the
// auto adjust switch, and the Latency Helper, a little tap-along that measures it.
const latMs = s => (s >= 0 ? '+' : '') + Math.round(s * 1000) + ' ms';
function renderLatency() {
  const el = $('latency');
  el.value = Math.round(beatLag * 1000);
  el.style.setProperty('--fill', ((beatLag + 0.1) / 0.45 * 100).toFixed(1) + '%');
  $('latVal').textContent = latMs(beatLag);
  segment($('segLatAuto'), t('lat.offOn'), beatAuto ? 1 : 0, i => { beatAuto = !!i; store.set('bl-beat-auto', beatAuto); renderLatency(); });
}
$('latency').addEventListener('input', e => { setBeatLag(e.target.value / 1000); renderLatency(); });
$('latHelp').addEventListener('click', () => { sfx.ensure(); openTap(); });

// The Latency Helper: your hopper hops on the beat, singing its own note, and you tap
// the big button each time it lands. Four beats to count in, then twelve to measure.
// The hops fall on the farm tune's own beats (the tune carries on softly underneath,
// and two beats a little apart pull the ear off), each sound set on the audio clock to
// reach the ears right on its beat. Each tap is compared with that moment; the middle
// of those differences (leaving out any wild ones) is your latency.
const TAP_BEAT = BEAT, TAP_COUNT = 4, TAP_BEATS = 12;
const tapOpen = () => $('tapHelp').classList.contains('show');
const tap = { run: 0, beats: [], taps: [], timers: [], result: null };
const tapNow = () => performance.now() / 1000;
function outLag() {   // how long a sound takes to come out of the speakers
  return music ? clamp(music.lag(), 0, 0.5) : 0;
}
function tapReset() {
  for (const id of tap.timers) clearTimeout(id);
  Object.assign(tap, { run: tap.run + 1, beats: [], taps: [], timers: [], result: null });
  $('tapDots').innerHTML = Array.from({ length: TAP_BEATS }, () => '<i></i>').join('');
  $('tapCount').textContent = '';
  $('tapResult').textContent = '';
  $('tapUse').hidden = true;
  $('tapGo').hidden = false;
  $('tapSay').textContent = t('lat.say', { name: heroName(heroId) });
}
function openTap() {
  closeSettings();
  const i = HEROES.findIndex(h => h.id === heroId);
  $('tapHopper').src = shots.cards[Math.max(0, i)];
  tapReset();
  $('tapHelp').classList.add('show');
  game.picking = true;
  music?.setLevel(0.15);   // the farm tune steps back so the beat is easy to hear
}
function closeTap() {
  tapReset();
  $('tapHelp').classList.remove('show');
  music?.setLevel(1);
  game.picking = anyPanel();
}
function tapStart() {
  sfx.ensure();
  tapReset();
  const run = tap.run;
  $('tapGo').hidden = true;
  $('tapSay').textContent = t('lat.listen');
  const later = (at, fn) => tap.timers.push(setTimeout(() => { if (tap.run === run) fn(); }, Math.max(0, (at - tapNow()) * 1000)));
  // The first count-in beat: the tune's next beat that's at least 0.8 s away (when
  // it'll be heard, on the performance clock). Without the tune, just 0.8 s from now.
  const h = music?.heard();
  let first = h ? h.at + (BEAT - h.pos % BEAT) : tapNow() + 0.8;
  while (first - tapNow() < 0.8) first += BEAT;
  for (let k = 0; k < TAP_COUNT + TAP_BEATS; k++) {
    const heard = first + k * TAP_BEAT;
    tap.beats[k] = heard;
    // The hop takes off before the beat and lands on it (92% of the way through tapHop).
    later(heard - 0.32 * 0.92, () => {
      const img = $('tapHopper');
      img.classList.remove('hop'); void img.offsetWidth; img.classList.add('hop');
    });
    // A little ahead, set the sound going on the audio clock so it's heard right on the beat.
    later(heard - 0.6, () => sfx.hop(heroId, heard - tapNow() - outLag()));   // room for even Bluetooth's delay (up to half a second)
    later(heard, () => {
      if (k < TAP_COUNT) $('tapCount').textContent = t('lat.count')[k];
      else {
        $('tapCount').textContent = '';
        $('tapDots').children[k - TAP_COUNT].classList.add('on');
      }
    });
  }
  later(first + (TAP_COUNT + TAP_BEATS) * TAP_BEAT + 0.5, tapFinish);
}
function tapHit(at) {   // at: when the tap happened (seconds, performance clock)
  const pad = $('tapPad');
  pad.classList.remove('pop'); void pad.offsetWidth; pad.classList.add('pop');
  if (!tap.beats.length || tap.result) return;
  tap.taps.push(at);
  const near = tap.beats.filter(Boolean).reduce((b, x) => Math.abs(x - at) < Math.abs(b - at) ? x : b, Infinity);
  const d = at - near - beatLag;                         // against what's set now
  if (Math.abs(d) > 0.3) return;
  const word = document.createElement('b');
  word.className = 'tapWord ' + (Math.abs(d) < 0.04 ? 'good' : d < 0 ? 'early' : 'late');
  word.textContent = t(Math.abs(d) < 0.04 ? 'lat.good' : d < 0 ? 'lat.early' : 'lat.late');
  $('tapHelp').querySelector('.tapStage').append(word);
  setTimeout(() => word.remove(), 700);
}
function tapFinish() {
  const beats = tap.beats.slice(TAP_COUNT).filter(Boolean), offs = [];
  for (const at of tap.taps) {
    const near = beats.reduce((b, x) => Math.abs(x - at) < Math.abs(b - at) ? x : b, Infinity);
    if (Math.abs(at - near) < TAP_BEAT * 0.45) offs.push(at - near);
  }
  offs.sort((a, b) => a - b);
  const mid = offs[offs.length >> 1], keep = offs.filter(o => Math.abs(o - mid) < 0.09);
  $('tapCount').textContent = '';
  if (keep.length < 6) {   // too few taps on the beat to be sure
    $('tapSay').textContent = t('lat.retry');
    $('tapGo').hidden = false;
    $('tapGo').textContent = t('lat.again');
    return;
  }
  tap.result = clamp(keep.reduce((a, b) => a + b, 0) / keep.length, -0.1, 0.35);
  $('tapSay').textContent = t('lat.done');
  $('tapResult').textContent = t('lat.result', { ms: latMs(tap.result) });
  $('tapUse').hidden = false;
  $('tapGo').hidden = false;
  $('tapGo').textContent = t('lat.again');
  sfx.upgrade();
}
// Feeling off beat? When your taps keep landing near the notes but outside them (a
// reel's worth of them, twice), a little pop-up suggests the Latency Helper, your
// hopper hopping along in it. Once per visit; never again once you've tried the helper.
const NUDGE_KEY = 'bl-lat-nudge';
const nudge = { reels: 0, shown: false };
const nudgeOpen = () => $('latNudge').classList.contains('show');
function offBeat(f) {
  const g = f.g;
  if (f.key !== myKey() || nudge.shown || store.get(NUDGE_KEY, false)) return;
  if (g.off < Math.max(3, g.notes.length * 0.3)) return;
  if (++nudge.reels < 2) return;
  nudge.shown = true;
  setTimeout(openNudge, 1200);   // once the fish has got away (or come in)
}
function openNudge() {
  if (game.state !== 'farm' || anyPanel()) { nudge.shown = false; nudge.reels = 1; return; }   // busy: ask after the next off-beat reel
  const i = HEROES.findIndex(h => h.id === heroId);
  $('nudgeHopper').src = shots.cards[Math.max(0, i)];
  $('latNudge').classList.add('show');
  game.picking = true;
}
function closeNudge(later) {
  $('latNudge').classList.remove('show');
  game.picking = anyPanel();
  if (!later) return;
  const f = fishers.get(myKey());
  if (f) { f.msg = t('lat.laterSay'); f.msgT = 3.5; }
  else { bettySays(t('lat.laterSay')); tip.w = walkerOf(myKey()) || tip.w; }   // said by your own hopper, not Betty Lou
}
function startNudge() {
  store.set(NUDGE_KEY, true);
  closeNudge(false);
  openTap();
}
$('nudgeLater').addEventListener('click', () => closeNudge(true));
$('nudgeClose').addEventListener('click', () => closeNudge(true));
$('latNudge').addEventListener('click', e => { if (e.target.id === 'latNudge') closeNudge(true); });
$('nudgeGo').addEventListener('click', () => { sfx.ensure(); startNudge(); });
$('tapGo').addEventListener('click', tapStart);
$('tapUse').addEventListener('click', () => {
  if (tap.result == null) return;
  store.set(NUDGE_KEY, true);   // they know the helper now
  setBeatLag(tap.result);
  closeTap();
  openSettings();
});
$('tapPad').addEventListener('pointerdown', e => { e.preventDefault(); sfx.ensure(); tapHit(e.timeStamp / 1000); });
$('tapClose').addEventListener('click', closeTap);
$('tapHelp').addEventListener('click', e => { if (e.target.id === 'tapHelp') closeTap(); });
$('gear').addEventListener('click', () => { sfx.ensure(); openSettings(); });
// Full screen, where the browser allows it (iPhones only do it for videos, so no button there).
const page = document.documentElement;
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
document.body.classList.toggle('noFull', !(page.requestFullscreen || page.webkitRequestFullscreen));
$('fullBtn').addEventListener('click', () => {
  sfx.ensure();
  const go = isFull() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (page.requestFullscreen || page.webkitRequestFullscreen).call(page);
  go?.catch?.(() => {});
});
for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, () => $('fullBtn').classList.toggle('on', isFull()));
$('setClose').addEventListener('click', closeSettings);
$('settings').addEventListener('click', e => { if (e.target.id === 'settings') closeSettings(); });

// ---------- Become a Hop Supporter ----------
// The player gets a code (HOP-XXXXXX), supports on Ko-fi with it in their message,
// and this panel asks the support worker every few seconds until it's paid. Lost
// it? Their code, or the email they used on Ko-fi, brings it back.
const supportOpen = () => $('support').classList.contains('show');
let supTimer = null;
function songStyle() { return (GUEST || supporter) && store.get('bl-dnb', false) ? 'dnb' : 'classic'; }
function applySong() { music?.setStyle(songStyle()); music?.setKey(songKey(), songScale()); }
function setSong(on) {
  store.set('bl-dnb', on);   // a farm setting: the guests on this farm hear it too
  applySong();
  renderSettings();
}
function pendingCode() {
  let c = store.get('bl-sup-pending', null);
  if (!SUP_CODE.test(c)) {
    const r = crypto.getRandomValues(new Uint8Array(6));
    c = 'HOP-' + [...r].map(b => CODE_ABC[b % CODE_ABC.length]).join('');
    store.set('bl-sup-pending', c);
  }
  return c;
}
async function supFetch(path, body) {
  const r = await fetch(SUPPORT_URL + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}
async function checkPaid(code) {
  try { return (await supFetch('/check?code=' + encodeURIComponent(code))).data.paid === true; } catch { return false; }
}
// Not signed in with Google? The farm (and so the purchase) lives only in this browser,
// so first a word about signing in, with "continue without" still there.
let supSkipped = false;
function refreshSupport(note) {
  const u = account?.state.user, gate = !!account && !u && !supporter && !supSkipped;
  $('supGate').hidden = !gate;
  $('supPay').hidden = gate;
  $('supSafe').hidden = !u;
  if (u) $('supSafe').textContent = t('sup.safe', { name: u.name });
  if (gate) account.prepare();   // ready for the tap, so the sign-in popup isn't blocked
  $('supAsk').hidden = supporter;
  $('supThanks').hidden = !supporter;
  $('supTitle').textContent = t(supporter ? 'sup.thanksTitle' : 'sup.title');
  $('supCodeText').textContent = supporter ? supCode() : pendingCode();
  $('supMine').textContent = supCode() || '';
  $('supKofi').href = KOFI_URL;
  $('supCard').hidden = $('supCardNote').hidden = !STRIPE_LINK;
  if (STRIPE_LINK) $('supCard').href = STRIPE_LINK + (STRIPE_LINK.includes('?') ? '&' : '?') + 'client_reference_id=' + encodeURIComponent(pendingCode());
  else $('supKofiWay').open = true;   // Ko-fi is the only way: show it
  if (note !== undefined) $('supStatus').textContent = note;
}
function openSupport() {
  if (!SUPPORT_URL) return;
  closeSettings();
  supSkipped = false;
  refreshSupport(t('sup.waiting'));
  $('supRestoreNote').textContent = '';
  $('support').classList.add('show');
  game.picking = true;
  clearInterval(supTimer);
  supTimer = setInterval(async () => {   // paid yet?
    if (!supportOpen() || supporter || document.hidden) return;
    if (await checkPaid(pendingCode())) welcomeSupporter(pendingCode());
  }, 4000);
}
function closeSupport() {
  clearInterval(supTimer);
  $('support').classList.remove('show');
  game.picking = anyPanel();
}
// Paid: the hoppers move in, the badge and the song switch appear.
function welcomeSupporter(code) {
  if (supporter) return;
  store.set('bl-supporter', code);
  supporter = true;
  sfx.upgrade();
  for (const id of SUP_HEROES) {
    if (owned.has(id)) continue;
    owned.add(id);
    const c = heroGrid.querySelector(`[data-id="${id}"]`);
    if (c) c.hidden = false;
    if (!GUEST && farm.walkers && game.where === 'farm') {
      const me = walkerOf(myKey());
      const w = addWalker(HEROES.find(h => h.id === id), me ? [me.x + (id === 'ribbit' ? 0.8 : -0.8), me.z + 0.6] : null);
      w.hop = 0.5;
      cheer(w.x, w.z);
    }
  }
  if (GUEST) guestNet.send({ t: 'sup' });
  else onFarmSave?.();   // guests see the new hoppers
  refreshSupport(t('sup.thanks'));
  if (settingsOpen()) renderSettings();
  if (bunkOpen()) refreshBunk();
}
$('supBtn').addEventListener('click', () => { sfx.ensure(); openSupport(); });
$('supClose').addEventListener('click', closeSupport);
$('supSkip').addEventListener('click', () => { supSkipped = true; refreshSupport(); });
$('support').addEventListener('click', e => { if (e.target.id === 'support') closeSupport(); });
$('supCopy').addEventListener('click', async () => {
  const code = $('supCodeText').textContent;
  try { await navigator.clipboard.writeText(code); $('supCopy').classList.add('copied'); setTimeout(() => $('supCopy').classList.remove('copied'), 1400); }
  catch { getSelection().selectAllChildren($('supCodeText')); }   // no clipboard: select it so it can be copied by hand
});
$('supForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = $('supInput').value.trim(), note = $('supRestoreNote');
  const m = v.toUpperCase().replace(/\s+/g, '').match(/^HOP-?([A-HJKMNP-Z2-9]{6})$/);
  note.textContent = t('sup.checking');
  try {
    if (m) {
      const code = 'HOP-' + m[1];
      if (await checkPaid(code)) welcomeSupporter(code); else note.textContent = t('sup.notPaid');
    } else if (v.includes('@')) {
      const r = await supFetch('/restore', { email: v });
      if (r.ok && SUP_CODE.test(r.data.code)) welcomeSupporter(r.data.code); else note.textContent = t('sup.noEmail');
    } else note.textContent = t('sup.what');
  } catch { note.textContent = t('sup.offline'); }
});
// Came back from Ko-fi with the panel shut, or reopened the game: one look.
async function lookForPayment() {
  if (supporter || !SUPPORT_URL) return;
  const c = store.get('bl-sup-pending', null);
  if (SUP_CODE.test(c) && await checkPaid(c)) welcomeSupporter(c);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) lookForPayment(); });
setTimeout(lookForPayment, 3000);

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
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(p => p && p.connected);
  if (!GUEST) pollLocalPads(pads.slice(1));   // more controllers: more players on this screen
  const gp = pads[0];
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

  if (dir || down.some(Boolean)) { showPadHints(); sfx.ensure(); dismissLogo(); }
  const pick = pressed(2) || pressed(3);

  if (partyOpen()) { if (pressed(0) || pressed(1) || pressed(9)) closeParty(); return; }
  if (game.picking && supportOpen()) { if (pressed(1) || pressed(9)) closeSupport(); return; }
  if (game.picking && pickOpen()) { if (pressed(1)) closePick(); return; }
  if (game.picking && nudgeOpen()) { if (pressed(0)) startNudge(); else if (pressed(1)) closeNudge(true); return; }
  if (game.picking && tapOpen()) { if (pressed(0)) { if ($('tapGo').hidden) tapHit(performance.now() / 1000); else tapStart(); } if (pressed(1)) closeTap(); return; }
  if (game.picking && settingsOpen()) {
    if (pressed(4) || pressed(5)) setSettingsTab(setTab === 'set' ? 'upd' : 'set');   // LB / RB: the other tab
    if (setTab === 'upd') { if (dir === 'up' || dir === 'down') document.querySelector('.setPanel .panelBody').scrollBy({ top: dir === 'down' ? 80 : -80 }); }
    else if (dir) settingsNav(dir);
    if (pressed(1) || pressed(8) || pressed(9)) closeSettings();
    return;
  }
  if (game.picking && bookOpen()) { if (pressed(0) || pressed(1) || pressed(9)) closeBook(); return; }
  if (game.picking && landOpen()) { if (pressed(0) || pressed(9)) buyLand(); else if (pressed(1)) closeLand(); return; }
  if (game.picking && bagOpen()) {   // d-pad chooses a fish, A one more, X one fewer, Y all, Start sells, B closes; asked to be sure: A sells, B keeps them
    if (asking()) { if (pressed(0) || pressed(9)) sellFish(); else if (pressed(1)) showSure(false); return; }
    const id = bagCards()[bagFocus]?.dataset.id;
    if (dir) bagNav(dir);
    if (pressed(0) && id) pickFish(id, 1);
    if (pressed(2) && id) pickFish(id, -1);
    if (pressed(3)) pickAll();
    if (pressed(9)) askSell();
    if (pressed(1)) closeBag();
    return;
  }
  if (game.picking && pondOpen()) {   // A buys, Y goes fishing, X opens the backpack, B closes
    if (pressed(0) || pressed(9)) buyPond();
    if (pressed(3)) { goFish(myKey(), 'pad'); return; }
    if (pressed(2)) { openBag(); return; }
    if (pressed(1)) closePond();
    return;
  }
  if (game.state === 'farm' && !game.picking && swingCam.on) {   // on the swing: the right stick, LB / RB and the triggers look around; A or B hops off
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    swingCam.spin = Math.abs(rx) > 0.3 ? -rx : down[4] ? 1 : down[5] ? -1 : 0;
    swingCam.tilt = Math.abs(ry) > 0.3 ? ry : 0;
    swingCam.zoomSpin = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
    if (pressed(0) || pressed(1)) dismount(walkerOf(myKey()));
    return;
  }
  const meF = game.state === 'farm' && !game.picking && fishers.get(myKey());
  if (meF) {   // fishing: A casts and reels, B stops; the right stick turns and tilts the camera, LB / RB turn it, the triggers zoom
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    fishCam.spin = Math.abs(rx) > 0.3 ? -rx : down[4] ? 1 : down[5] ? -1 : 0;
    fishCam.tilt = Math.abs(ry) > 0.3 ? ry : 0;
    fishCam.zoomSpin = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
    if (pressed(0)) fishPress(meF, true, 'pad');
    if (released(0)) fishPress(meF, false);
    if (pressed(1)) stopFish(myKey());
    return;
  }
  if (jam.open) {   // the six buttons play the row the d-pad picked; left/right shift the octave
    if (dir || down.some(Boolean)) setJamInput('pad');
    if (dir === 'up' || dir === 'down') { jam.row = clamp(jam.row + (dir === 'down' ? 1 : -1), 0, JAM_ROWS - 1); markJamHints(); }
    if (dir === 'left' || dir === 'right') setOctave(dir === 'right' ? 1 : -1);
    if (pressed(8) && ownedDecor.has('drums')) { setDrums(!jam.drums); return; }   // Select: drums / hopper
    if (jam.drums) {
      for (const d in DRUM_BTNS) if (pressed(DRUM_BTNS[d])) playDrum(+d);
      if (pressed(9)) closeJam();
      return;
    }
    PAD_BTNS.forEach((b, col) => {
      if (pressed(b)) playPad(jam.row, col, 'b' + b);
      if (released(b)) letGo('b' + b);
    });
    if (pressed(6)) setSustain(jam.sustain - 0.1);   // LT / RT: less or more sustain
    if (pressed(7)) setSustain(jam.sustain + 0.1);
    if (pressed(8) || pressed(9)) closeJam();
    return;
  }
  if (game.picking && stageOpen()) {
    if (pressed(0) || pressed(9)) buildJamStage();
    if (pressed(1)) closeStage();
    return;
  }
  if (game.picking && shopOpen()) {
    if (dir) { shopFocus = gridStep(shopCards(), shopFocus, dir); refreshShop(); }
    if (pressed(4) || pressed(5)) setShopTab(shopTab === 'decor' ? 'music' : 'decor');   // LB / RB: the other tab
    if (shopTab === 'music' && (pressed(6) || pressed(7))) nextScale(pressed(6) ? -1 : 1);   // LT / RT: the other scales
    if (pressed(0) || pressed(9)) shopBuy();
    if (pressed(1) || pressed(8)) closeShop();
    return;
  }
  if (decor.on && !game.picking) {
    if (dir) nudgePiece(dir);
    if (pressed(2)) nextPiece();
    if (pressed(3)) rotatePiece();
    if (pressed(8)) openShop();
    if (pressed(0) || pressed(1) || pressed(9)) exitDecor();
    return;
  }
  if (game.picking && buildsOpen()) {
    if (dir) buildsNav(dir);
    if (pressed(0) || pressed(9)) buildAct();
    if (pressed(1) || pick) closeBuilds();
    return;
  }
  if (game.picking && bunkOpen()) {
    if (dir) bunkNav(dir);
    if (pressed(0) || pressed(9)) bunkAct();
    if (pressed(1) || pick) closeBunk();
    return;
  }
  if (game.picking) {
    if (dir) heroNav(dir);
    if (pressed(0) || pressed(9)) pickHero(shownCards()[heroFocus].dataset.id);
    if (pressed(1) || pick) closeHeroes();
    return;
  }
  if (game.state === 'farm') {          // A or Start: start the day; Y: hoppers; X: Fish Pond; B: Bunkhouse
    if (pressed(0) || pressed(9)) goRoad();
    else if (pressed(1)) openBuilds();
    else if (pressed(5)) enterDecor();     // RB
    else if (pressed(4)) stageAct();       // LB
    else if (pressed(3)) openHeroes();
    else if (pressed(2)) openPond();
    else if (pressed(8)) openSettings();   // Select / View button
    else if (dir) hostFarmHop(...DIRS[dir]);
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

applyQuality();   // sizes the canvas too
newWorld();
buildFarm();
placeFarmHero();
document.body.classList.add('farm', 'show-logo');
setHint();
hud();
applyLang();
requestAnimationFrame(frame);
if (guestNet) {
  document.body.classList.add('guest');
  // The picker: hoppers from this player's own farm first, then the host's under "Host Hoppers".
  const mine = (() => {
    try {
      const own = JSON.parse(localStorage.getItem('bl-owned')) || [];
      const before = !JSON.parse(localStorage.getItem('bl-owned-v2')) && ['bl-top', 'bl-coins', 'bl-hero', 'bl-pond'].some(k => localStorage.getItem(k) !== null);
      return new Set([...STARTERS, ...own, ...(before ? ['axolotl', 'catstar', 'leafwish'] : []), ...(supporter ? SUP_HEROES : [])]);   // as the old farms were
    } catch { return new Set(STARTERS); }
  })();
  const head = document.createElement('h3');
  head.className = 'gridHead';
  head.dataset.i18n = 'hostHoppers';
  head.textContent = t('hostHoppers');
  const cards = [...heroGrid.children];
  for (const c of cards) c.hidden = !mine.has(c.dataset.id) && !owned.has(c.dataset.id);
  heroGrid.append(...cards.filter(c => mine.has(c.dataset.id)), head, ...cards.filter(c => !mine.has(c.dataset.id)));
  head.hidden = !cards.some(c => !mine.has(c.dataset.id) && owned.has(c.dataset.id));
  markHero();
  // Everyone on the host's farm: its own hoppers and each friend's, ours included.
  const applyCrew = list => {
    const keys = new Set(list.map(c => c.k));
    for (const w of [...farm.walkers]) if (!keys.has(w.key)) removeWalker(w);
    for (const c of list) {
      let w = walkerOf(c.k);
      if (w && w.id !== c.hero) { removeWalker(w); w = null; }
      if (!w) w = Object.assign(addWalker(HEROES.find(h => h.id === c.hero) || HEROES[0], [c.x, c.z], c.k), { tx: c.tx, tz: c.tz });
      else if (c.k !== myKey() && !w.leap && Math.hypot(w.x - c.x, w.z - c.z) > 0.6) Object.assign(w, { x: c.x, z: c.z, tx: c.tx, tz: c.tz });
      hideWalker(w, c.hidden);
      w.isHost = !!c.host;
      w.col = c.col ?? 0;
    }
  };
  const keepHero = () => { try { sessionStorage.setItem('bl-guest-hero', heroId); } catch {} };   // the same hopper after a reload
  keepHero();
  const LOOKS = ['bl-owned', 'bl-decor', 'bl-layout', 'bl-pond', 'bl-bunk', 'bl-stage', 'bl-wide'];
  guestNet.on(m => {
    if (m.t === 'leap') { const w = walkerOf(m.k); if (w && m.k !== myKey()) landLeap(w, +m.x, +m.z, +m.up, isFinite(m.y) ? clamp(+m.y, 0, 0.5) : null); }
    else if (m.t === 'crew') applyCrew(m.walkers || []);
    else if (m.t === 'fv') { if (m.k !== myKey()) applyFishView(m); }
    else if (m.t === 'fc') { if (m.k !== myKey()) remoteCatch(m); }
    else if (m.t === 'band') applyBand(m.list || []);
    else if (m.t === 'jn') bandNote(m);
    else if (m.t === 'jd') bandDrum(m);
    else if (m.t === 'beat') followBeat(m.pos);
    else if (m.t === 'road') { if (game.where === 'farm') { guestNet.note.hide(); goRoadGuest(m); } }
    else if (/^r[hdbp]$/.test(m.t)) { if (game.where === 'road' && m.k !== guestKey) onRoadNews(game.crew.find(h => h.key === m.k), m); }
    else if (m.t === 'rc') { if (game.where === 'road') takeSunflower(m.r | 0, m.c | 0, false); }
    else if (m.t === 'rs') {
      if (game.where !== 'road') return;
      roadClock = { T: m.T, at: performance.now() };
      game.day = m.day;
      game.score = Math.max(game.score, m.score | 0);
      game.coins = m.coins | 0;
      game.today = m.today | 0;
      hud();
      if (m.state === 'play' && game.state === 'title') startGame();
      if (m.state === 'dead' && game.state === 'play') game.state = 'dead';
      if (m.state === 'over' && game.state !== 'over') {
        game.lastDeath = { death: m.death || 'other', hero: m.hero || heroId };
        gameOver();
      }
    }
    else if (m.t === 'walk') {
      const w = walkerOf(m.k);
      if (w && !w.leap) { if (Math.hypot(w.x - m.x, w.z - m.z) > 0.6) { w.x = m.x; w.z = m.z; } w.tx = m.tx; w.tz = m.tz; }
    } else if (m.t === 'farm') {
      // Something new was bought, built or moved: start again on the new farm. Sunflowers just update.
      if (LOOKS.some(k => JSON.stringify(m.farm.keys[k] ?? null) !== JSON.stringify(guestKeys[k] ?? null))) { location.reload(); return; }
      Object.assign(guestKeys, m.farm.keys);
      applySong();
      game.coins = guestKeys['bl-coins'] ?? 0;
      game.top = guestKeys['bl-top'] ?? 0;
      hud();
    } else if (m.t === 'joined') {
      if (m.hero !== heroId) { heroId = guestKeys['bl-hero'] = m.hero; markHero(); }
      keepHero();
    } else if (m.t === 'view') {
      jam.hostOpen = m.v === 'jam';
      if (m.v === 'farm') {
        guestNet.note.hide();
        closeJam();
        if (game.where === 'road' && game.state !== 'dusk') { game.state = 'dusk'; transition('dusk', 450, enterFarm); }
      } else if (m.v === 'jam') { guestNet.note.hide(); if (!jam.open) openJam(); }
      else if (m.v === 'over' && game.where === 'farm' && game.state === 'farm') guestNet.note.show(t('guest.nextDay'));   // their day is ending: next time
    }
  });
  applyCrew(guestNet.farm.walkers || []);
  placeFarmHero();
  setHint();
}
if (new URLSearchParams(location.search).has('debug')) window.__hop = { party, peers, die, respawn, laneAt, P, game, lanes, move, step, pollPad, get camera() { return camera; }, farm, sfx, renderer, scene, watchFrames, autoQ, jam, fishers, FISH, fishRhythm, goFish, landFish, rollFish, goSwing, standUp, walkerOf, swingCam, farmCam, offBeat, stageShow: show, shots, myKey, get music() { return music; }, farmTime(k) { farmTimeAt = k; }, farmLight, lamps, get tapHelp() { return tap; }, keyNow, pentHz, songKey, buyKey, setShopTab, setKeyScale, noteFreq };
