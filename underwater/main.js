import * as THREE from 'three';

// =====================================================================
// Blue Hollow: a first-person underwater dive.
// World: a lagoon basin, surface at y = 0, walls rising at the rim.
// =====================================================================

const WORLD_R = 172;          // swimmable radius
const PEARL_COUNT = 20;
const SURFACE_BREATH_Y = -1.3; // above this depth you can breathe

// ---------- seeded random + noise ----------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260924);
const rr = (a, b) => a + (b - a) * rand();

const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  const r = mulberry32(1337);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y) {
  const g = h & 7, u = g < 4 ? x : y, v = g < 4 ? y : x;
  return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v);
}
function noise2(x, y) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const X = xf & 255, Y = yf & 255;
  x -= xf; y -= yf;
  const u = fade(x), v = fade(y);
  const a = perm[X] + Y, b = perm[X + 1] + Y;
  return 0.35 * lerp(
    lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
    lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
}
function fbm(x, y, oct = 5) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = -15 - 20 * smooth(35, 140, r);                     // shallow reef in the middle, deeper outside
  h += fbm(x * 0.012, z * 0.012, 5) * 16;                     // rolling seabed
  const rg = 1 - Math.abs(noise2(x * 0.035 + 10, z * 0.035 - 7) * 2.6);
  h += Math.pow(Math.max(rg, 0), 5) * 4;                      // rocky ridges
  const tr = Math.abs(noise2(x * 0.0065 + 3.1, z * 0.0065 - 1.7) * 2.6);
  h -= (1 - smooth(0.0, 0.16, tr)) * 16 * smooth(45, 90, r);  // winding trench
  h += smooth(160, 225, r) * 46;                              // basin walls
  return Math.min(h, -3.5);
}
function terrainNormalY(x, z) {
  const e = 0.8;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return 2 * e / Math.hypot(dx, 2 * e, dz);
}

// ---------- renderer / scene ----------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;
container.appendChild(renderer.domElement);

// Shape-land palette, taken from the cut-paper shapes in ../shapes-1
const PAL = {
  pink: '#eaa8cb', orange: '#ef7426', green: '#0f7160', yellow: '#d9c227', lemon: '#f5e663',
  cream: '#faf4ef', ink: '#1d1d1b', blue: '#3d6fb6', rose: '#d9829f',
  sand: '#f6e7d3', surface: '#bfe6e4', surfaceDeep: '#2a7c7e',
};

// Fog in hard steps, so distance reads as stacked layers of cut paper.
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  fogFactor = min(floor(fogFactor * 6.0 + 0.35) / 6.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;

const scene = new THREE.Scene();
const SHALLOW = new THREE.Color('#8ecfd3');
const DEEP = new THREE.Color('#145a60');
scene.fog = new THREE.FogExp2(SHALLOW.clone(), 0.024);
scene.background = scene.fog.color;

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);


// ---------- shared shader bits ---------------------------------------
const shared = {
  uTime: { value: 0 }, uCaustic: { value: 1 },
  uSunDir: { value: new THREE.Vector3(-0.35, 1, 0.25).normalize() },
  uTorch: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3(0, 0, -1) },
};

const CAUSTIC_GLSL = /* glsl */`
uniform float uTime;
uniform float uCaustic, uTorch;
uniform vec3 uSunDir, uCamPos, uCamDir;
varying vec3 vWorldPos;
float causticLayer(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
float caustics(vec3 wp) {
  float a = causticLayer(wp.xz * 0.075, uTime * 0.5);
  float b = causticLayer(wp.xz * 0.043 + 0.37, uTime * 0.37 + 4.0);
  return min(a * 0.8 + b * 0.6, 1.6);
}
`;

// Replaces a built-in material's lighting with flat colour (plus a hard-edged torch circle)
// and splices in optional custom vertex/fragment code.
function patchMaterial(mat, opts = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    for (const k of ['uCaustic', 'uSunDir', 'uTorch', 'uCamPos', 'uCamDir']) sh.uniforms[k] = shared[k];
    Object.assign(sh.uniforms, opts.uniforms || {});
    sh.vertexShader = 'uniform float uTime;\nvarying vec3 vWorldPos;\n' + (opts.vertexHead || '') + '\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        ${opts.vertexBody || ''}
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vWorldPos = (modelMatrix * cwp).xyz;`);
    sh.fragmentShader = CAUSTIC_GLSL + (opts.fragHead || '') + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${opts.fragColor || ''}`)
      .replace('#include <opaque_fragment>', `
        vec3 paper = diffuseColor.rgb;
        vec3 tv = vWorldPos - uCamPos;
        float td = length(tv);
        float cone = step(0.955, dot(tv / max(td, 0.001), uCamDir)) * step(td, 40.0) * uTorch;
        paper = mix(paper, diffuseColor.rgb * 1.3 + vec3(0.05, 0.04, 0.0), cone * 0.9);
        outgoingLight = paper;
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'patched-' + (opts.key || 'base');
  return mat;
}

// ---------- terrain ---------------------------------------------------
{
  const SIZE = 480, SEG = 240;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  // Per-vertex data (slope, patch noise, moss noise); colours are picked in the shader with hard edges.
  const nrm = geo.attributes.normal;
  const data = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    data.set([nrm.getY(i), fbm(x * 0.06, z * 0.06, 3), fbm(x * 0.05 + 9, z * 0.05, 2)], i * 3);
  }
  geo.setAttribute('aData', new THREE.BufferAttribute(data, 3));
  const mat = patchMaterial(new THREE.MeshLambertMaterial(), {
    key: 'terrain',
    vertexHead: 'attribute vec3 aData;\nvarying vec3 vData;\n',
    vertexBody: 'vData = aData;',
    fragHead: `varying vec3 vData;
      uniform vec3 uSand, uDeepSand, uRock, uDashSand, uDashDeep, uDashRock;
      float hs(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
    fragColor: `
      // flat paper regions: cream shallows, pink depths, green slopes
      float deep = step(vWorldPos.y, -30.0 + vData.y * 6.0);
      float rocky = step(vData.x + vData.y * 0.12, 0.82);
      vec3 ground = mix(mix(uSand, uDeepSand, deep), uRock, rocky);
      // scattered dashes, like the pink triangle's
      vec2 g = vWorldPos.xz * 0.42;
      vec2 cell = floor(g);
      float r = hs(cell);
      vec2 f = fract(g) - 0.5 + (vec2(hs(cell + 7.1), hs(cell + 3.3)) - 0.5) * 0.35;
      float an = r * 2.4 - 1.2;
      f = mat2(cos(an), -sin(an), sin(an), cos(an)) * f;
      float dash = step(abs(f.x), 0.17) * step(abs(f.y), 0.045) * step(0.7, r) * (1.0 - rocky);
      ground = mix(ground, mix(uDashSand, uDashDeep, deep), dash);
      // wobbly stripes across the green slopes
      float st = step(fract((vWorldPos.x * 0.7 + vWorldPos.y + sin(vWorldPos.z * 0.35) * 1.4) * 0.2), 0.28);
      ground = mix(ground, uDashRock, st * rocky);
      diffuseColor.rgb = ground;`,
    uniforms: {
      uSand: { value: new THREE.Color(PAL.sand) }, uDeepSand: { value: new THREE.Color(PAL.pink) },
      uRock: { value: new THREE.Color(PAL.green) }, uDashSand: { value: new THREE.Color(PAL.pink) },
      uDashDeep: { value: new THREE.Color(PAL.orange) }, uDashRock: { value: new THREE.Color(PAL.pink) },
    },
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// Picks a point on the seabed within a radius band, with an optional acceptance test.
function seabedPoint(rMin, rMax, accept = () => true, tries = 40) {
  for (let t = 0; t < tries; t++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rr(rMin * rMin, rMax * rMax));
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = terrainHeight(x, z);
    if (accept(x, y, z)) return new THREE.Vector3(x, y, z);
  }
  return null;
}

// ---------- water surface (seen from below) --------------------------
const surfaceMat = new THREE.ShaderMaterial({
  fog: true,
  side: THREE.DoubleSide,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uSky: { value: new THREE.Color(PAL.cream) },
    uUnder: { value: new THREE.Color(PAL.surface) },
    uPaper: { value: new THREE.Color(PAL.pink) },
    uSun: { value: new THREE.Color(PAL.orange) },
    uSunDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
  }]),
  vertexShader: /* glsl */`
    varying vec3 vW;
    #include <fog_pars_vertex>
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      vec4 mvPosition = viewMatrix * w;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform vec3 uSky, uUnder, uPaper, uSun, uSunDir;
    varying vec3 vW;
    #include <fog_pars_fragment>
    float wave(vec2 p) {
      float t = uTime;
      return sin(p.x * 0.21 + t * 1.1) * 0.5 + sin(p.y * 0.17 - t * 0.9) * 0.5
           + sin((p.x + p.y) * 0.43 + t * 1.7) * 0.25 + sin((p.x - p.y * 0.6) * 0.9 - t * 2.3) * 0.12
           + sin(p.y * 1.7 + p.x * 0.4 + t * 3.1) * 0.05;
    }
    void main() {
      vec2 p = vW.xz;
      float e = 0.2;
      float h = wave(p);
      vec3 n = normalize(vec3(-(wave(p + vec2(e, 0.0)) - h) / e * 0.35, 1.0, -(wave(p + vec2(0.0, e)) - h) / e * 0.35));
      vec3 v = normalize(vW - cameraPosition);
      float cosI = dot(v, n);
      float window = step(0.64, cosI);                       // Snell's window, cut with scissors
      vec3 refr = refract(v, -n, 1.33);
      float sunDisc = step(0.985, dot(normalize(refr + v), uSunDir)) * window;
      vec3 col = mix(uUnder, uSky, window);
      float line = step(fract(h * 1.6), 0.1);                 // scalloped wave lines
      col = mix(col, window > 0.5 ? uPaper : uUnder * 1.25, line * 0.8);
      col = mix(col, uSun, sunDisc);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
{
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), surfaceMat);
  surface.rotation.x = Math.PI / 2; // face down
  scene.add(surface);
}

// ---------- god rays ----------------------------------------------------
const RAY_COUNT = 22, RAY_TILE = 90;
const rayMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.FrontSide,
  uniforms: { uTime: shared.uTime, uStrength: { value: 1 }, uPaper: { value: new THREE.Color(PAL.cream) } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vN, vV;
    varying float vDist;
    varying float vId;
    void main() {
      vUv = uv;
      mat4 im = mat4(1.0);
      #ifdef USE_INSTANCING
        im = instanceMatrix;
      #endif
      vec4 mv = viewMatrix * modelMatrix * im * vec4(position, 1.0);
      vN = normalize(normalMatrix * mat3(im) * normal);
      vV = normalize(-mv.xyz);
      vDist = length(mv.xyz);
      vId = float(gl_InstanceID);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uStrength;
    uniform vec3 uPaper;
    varying vec2 vUv;
    varying vec3 vN, vV;
    varying float vDist, vId;
    void main() {
      float edge = step(0.35, abs(dot(normalize(vN), normalize(vV))));
      float along = 0.5 * step(0.25, vUv.y) + 0.5 * step(0.6, vUv.y);
      float flicker = step(-0.35, sin(uTime * 0.35 + vId * 2.3));
      float near = step(3.0, vDist) * step(vDist, 70.0);
      float a = edge * along * flicker * near * 0.13 * uStrength;
      gl_FragColor = vec4(uPaper, a);
    }`,
});
const rayGeo = new THREE.CylinderGeometry(1.2, 4.5, 1, 14, 1, true).translate(0, -0.5, 0);
const rays = new THREE.InstancedMesh(rayGeo, rayMat, RAY_COUNT);
rays.frustumCulled = false;
const rayData = Array.from({ length: RAY_COUNT }, () => ({
  x: rr(0, RAY_TILE), z: rr(0, RAY_TILE), len: rr(28, 55), w: rr(0.5, 1.4),
}));
scene.add(rays);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const rayTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, -0.22));
function updateRays() {
  for (let i = 0; i < RAY_COUNT; i++) {
    const d = rayData[i];
    const wx = camera.position.x + (((d.x - camera.position.x) % RAY_TILE) + RAY_TILE * 1.5) % RAY_TILE - RAY_TILE / 2;
    const wz = camera.position.z + (((d.z - camera.position.z) % RAY_TILE) + RAY_TILE * 1.5) % RAY_TILE - RAY_TILE / 2;
    tmpP.set(wx, 0, wz);
    tmpS.set(d.w, d.len, d.w);
    tmpM.compose(tmpP, rayTilt, tmpS);
    rays.setMatrixAt(i, tmpM);
  }
  rays.instanceMatrix.needsUpdate = true;
}

// ---------- marine snow ---------------------------------------------------
const pxRatio = { value: renderer.getPixelRatio() * window.innerHeight / 800 };
{
  const N = 2600, BOX = 60;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(N * 3), s = new Float32Array(N);
  for (let i = 0; i < N; i++) { p.set([rr(0, BOX), rr(0, BOX), rr(0, BOX)], i * 3); s[i] = rand(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: shared.uTime, uCam: { value: camera.position }, uPx: pxRatio, uPaper: { value: new THREE.Color(PAL.cream) } },
    vertexShader: /* glsl */`
      uniform float uTime, uPx;
      uniform vec3 uCam;
      attribute float aSeed;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y -= uTime * 0.22 * (0.4 + aSeed);
        p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.8;
        p.z += cos(uTime * 0.25 + aSeed * 23.0) * 0.8;
        p = mod(p - uCam + 30.0, 60.0) - 30.0 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(uPx * (0.5 + aSeed) * 9.0 / max(d, 0.5), 2.0);
        vA = (1.0 - smoothstep(10.0, 28.0, length(p - uCam))) * smoothstep(0.3, 1.5, d) * step(p.y, -0.2);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uPaper;
      varying float vA;
      void main() {
        if (length(gl_PointCoord - 0.5) > 0.5) discard;
        gl_FragColor = vec4(uPaper, step(0.25, vA) * 0.55);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
}

// ---------- bubbles ---------------------------------------------------------
const BUB_N = 900;
const bub = {
  pos: new Float32Array(BUB_N * 3), size: new Float32Array(BUB_N), vel: new Float32Array(BUB_N),
  phase: new Float32Array(BUB_N), next: 0,
};
const bubGeo = new THREE.BufferGeometry();
bubGeo.setAttribute('position', new THREE.BufferAttribute(bub.pos, 3).setUsage(THREE.DynamicDrawUsage));
bubGeo.setAttribute('aSize', new THREE.BufferAttribute(bub.size, 1).setUsage(THREE.DynamicDrawUsage));
{
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uPx: pxRatio, uPaper: { value: new THREE.Color(PAL.cream) } },
    vertexShader: /* glsl */`
      uniform float uPx;
      attribute float aSize;
      varying float vFade;
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(-mv.z, 0.3);
        gl_PointSize = aSize * uPx * 60.0 / d;
        vFade = exp(-d * 0.03) * step(0.001, aSize);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uPaper;
      varying float vFade;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q);
        if (d > 0.5) discard;
        float rim = step(0.36, d);
        float hl = step(length(q - vec2(-0.15, -0.15)), 0.1);
        float a = max(0.18, max(rim, hl) * 0.9) * step(0.15, vFade);
        gl_FragColor = vec4(uPaper, a);
      }`,
  });
  const pts = new THREE.Points(bubGeo, m);
  pts.frustumCulled = false;
  scene.add(pts);
}
function spawnBubble(x, y, z, size = rr(0.05, 0.16)) {
  const i = bub.next; bub.next = (bub.next + 1) % BUB_N;
  bub.pos[i * 3] = x; bub.pos[i * 3 + 1] = y; bub.pos[i * 3 + 2] = z;
  bub.size[i] = size; bub.vel[i] = rr(1.4, 2.6) + size * 6; bub.phase[i] = rr(0, 6.28);
}
function updateBubbles(dt, t) {
  for (let i = 0; i < BUB_N; i++) {
    if (bub.size[i] === 0) continue;
    const k = i * 3;
    bub.pos[k + 1] += bub.vel[i] * dt;
    bub.pos[k] += Math.sin(t * 5 + bub.phase[i]) * dt * 0.4;
    bub.pos[k + 2] += Math.cos(t * 4 + bub.phase[i]) * dt * 0.4;
    if (bub.pos[k + 1] > -0.15) bub.size[i] = 0;
  }
  bubGeo.attributes.position.needsUpdate = true;
  bubGeo.attributes.aSize.needsUpdate = true;
}

// =====================================================================
// Shape land: every creature and plant is a flat cut-paper shape
// standing in the water, drawn once into a texture atlas.
// =====================================================================
const SL = PAL;
// The shapes load from the repo's shapes-1/ and new/ folders; a single-file build can inline them as window.SHAPE_ART.
const ASSET_BASE = document.querySelector('meta[name="asset-base"]')?.content ?? '../';

function loadImage(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
// Crops a transparent PNG to its visible shape (some source files are mostly empty canvas).
function trimmed(img) {
  if (!img) return null;
  try {
    const s = Math.min(1, 700 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.ceil(img.width * s); c.height = Math.ceil(img.height * s);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < x0) return null;
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, -x0, -y0);
    return o;
  } catch (e) { return null; }
}
const art = Object.fromEntries(await Promise.all([
  ['pinkflower', 'shapes-1/pinkflower.png'], ['redflower', 'shapes-1/redflower.png'],
  ['greenflower', 'shapes-1/greenflower.png'], ['redsun', 'shapes-1/redsun.png'],
  ['pinktriangle', 'shapes-1/pinktriangle.png'], ['semicircle', 'shapes-1/semicircle.png'],
  ['macaroni', 'shapes-1/yellowmacaroni.png'], ['noodle', 'new/yellow%20noodle.png'],
].map(async ([k, p]) => [k, trimmed(await loadImage(window.SHAPE_ART?.[k] ?? ASSET_BASE + p))])));

// ---------- the atlas ---------------------------------------------------------
const ATLAS = 2048;
const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = atlasCanvas.height = ATLAS;
const actx = atlasCanvas.getContext('2d');
let ax = 0, ay = 0, arow = 0;
// Reserves a w×h cell, lets draw() paint into it, and returns its UV rect and aspect.
function region(w, h, draw) {
  if (ax + w > ATLAS) { ax = 0; ay += arow; arow = 0; }
  const x = ax, y = ay;
  ax += w; arow = Math.max(arow, h);
  actx.save();
  actx.translate(x, y);
  actx.beginPath(); actx.rect(4, 4, w - 8, h - 8); actx.clip();
  draw(actx, w, h);
  actx.restore();
  return { rect: new THREE.Vector4((x + 4) / ATLAS, 1 - (y + h - 4) / ATLAS, (w - 8) / ATLAS, (h - 8) / ATLAS), aspect: (w - 8) / (h - 8) };
}
const crand = mulberry32(77);
function blob(g, cx, cy, rx, ry, wob = 0.06) {
  const seed = crand() * 60;
  g.beginPath();
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const r = 1 + wob * 2.4 * noise2(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4 + seed);
    g.lineTo(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
  }
  g.closePath();
}
function fillWith(g, path, color, pattern) {
  path(); g.fillStyle = color; g.fill();
  if (pattern) { g.save(); path(); g.clip(); pattern(); g.restore(); }
}
function stripes(g, w, h, color, width, gap, angle = 0.5) {
  g.save(); g.translate(w / 2, h / 2); g.rotate(angle);
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  const R = Math.hypot(w, h);
  for (let x = -R; x < R; x += width + gap) {
    g.beginPath();
    for (let y = -R; y <= R; y += 10) g.lineTo(x + Math.sin(y * 0.025 + x) * width * 0.5, y);
    g.stroke();
  }
  g.restore();
}
function dashes(g, w, h, color, n, len = 20, thick = 8) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.save(); g.translate(crand() * w, crand() * h); g.rotate(-0.7 + crand() * 0.5);
    g.beginPath(); g.roundRect(-len / 2, -thick / 2, len * (0.6 + crand() * 0.7), thick, thick / 2); g.fill();
    g.restore();
  }
}
function spots(g, w, h, color, n, r = 8) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(crand() * w, crand() * h, r * (0.6 + crand() * 0.7), 0, 7); g.fill(); }
}
function noodle(g, pts, width, color) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); pts.forEach(([x, y]) => g.lineTo(x, y)); g.stroke();
}
function wavyLine(x0, y0, y1, amp, freq, phase) {
  const pts = [];
  for (let y = y0; y >= y1; y -= 6) pts.push([x0 + Math.sin(y * freq + phase) * amp, y]);
  return pts;
}
function drawArt(img, fallback) {
  return (g, w, h) => {
    if (!img) return fallback(g, w, h);
    const s = Math.min((w - 12) / img.width, (h - 12) / img.height);
    g.drawImage(img, (w - img.width * s) / 2, h - 6 - img.height * s, img.width * s, img.height * s);
  };
}
function flower(petals, color, centre, pattern) {
  return (g, w, h) => {
    const cx = w / 2, cy = h * 0.42, R = w * 0.27;
    noodle(g, wavyLine(cx, h, cy, 6, 0.04, 1), 14, SL.green);
    const path = () => {
      g.beginPath();
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + 0.3;
        g.moveTo(cx + Math.cos(a) * R + R * 0.62, cy + Math.sin(a) * R);
        g.ellipse(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * 0.62, R * 0.58, a, 0, Math.PI * 2);
      }
    };
    fillWith(g, path, color, pattern && (() => pattern(g, w, h)));
    blob(g, cx, cy, R * 0.42, R * 0.4, 0.1); g.fillStyle = centre; g.fill();
  };
}
function drawFish(body, pattern, fin) {
  return (g, w, h) => {
    const by = h * 0.5;
    g.fillStyle = fin;
    g.beginPath(); g.moveTo(w * 0.34, by); g.lineTo(w * 0.05, by - h * 0.36);
    g.quadraticCurveTo(w * 0.15, by, w * 0.05, by + h * 0.36); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(w * 0.42, by - h * 0.22); g.quadraticCurveTo(w * 0.52, by - h * 0.56, w * 0.7, by - h * 0.26); g.closePath(); g.fill();
    fillWith(g, () => blob(g, w * 0.6, by, w * 0.32, h * 0.33, 0.035), body, pattern && (() => pattern(g, w, h)));
    g.beginPath(); g.arc(w * 0.8, by - h * 0.07, h * 0.1, 0, 7); g.fillStyle = SL.cream; g.fill();
    g.beginPath(); g.arc(w * 0.815, by - h * 0.07, h * 0.05, 0, 7); g.fillStyle = SL.ink; g.fill();
  };
}

const TEX = {};
// tall things first so the shelf packer stays tidy
TEX.kelp = [
  region(176, 1024, (g, w, h) => noodle(g, wavyLine(w / 2, h - 10, 18, w * 0.2, 0.012, 0), 46, SL.lemon)),
  region(176, 1024, (g, w, h) => noodle(g, wavyLine(w / 2, h - 10, 18, w * 0.22, 0.016, 2), 40, SL.green)),
  region(176, 1024, (g, w, h) => noodle(g, wavyLine(w / 2, h - 10, 18, w * 0.18, 0.02, 4), 36, SL.yellow)),
  region(176, 1024, drawArt(art.noodle, (g, w, h) => noodle(g, wavyLine(w / 2, h - 10, 18, w * 0.25, 0.01, 1), 50, SL.lemon))),
];
TEX.jelly = [SL.pink, SL.lemon, SL.cream, SL.rose].map((bell, i) => region(256, 400, (g, w, h) => {
  const tent = [SL.orange, SL.pink, SL.orange, SL.lemon][i];
  for (let k = 0; k < 5; k++) noodle(g, wavyLine(w * (0.26 + k * 0.12), h - 16, h * 0.3, 10, 0.05, k * 1.7), 9, tent);
  fillWith(g, () => { g.beginPath(); g.ellipse(w / 2, h * 0.33, w * 0.42, h * 0.27, 0, Math.PI, 0); g.closePath(); }, bell,
    () => stripes(g, w, h, i % 2 ? SL.pink : SL.orange, 10, 18, 0));
}));
TEX.fish = {
  blueDash: region(256, 128, drawFish(SL.blue, (g, w, h) => dashes(g, w, h, SL.lemon, 30, 18, 7), SL.lemon)),
  blueStripe: region(256, 128, drawFish(SL.blue, (g, w, h) => stripes(g, w, h, SL.cream, 8, 26, 0.2), SL.pink)),
  yellowDot: region(256, 128, drawFish(SL.yellow, (g, w, h) => spots(g, w, h, SL.orange, 26, 7), SL.orange)),
  yellowInk: region(256, 128, drawFish(SL.lemon, (g, w, h) => stripes(g, w, h, SL.ink, 5, 30, -0.1), SL.yellow)),
  sardine: region(256, 128, drawFish(SL.cream, (g, w, h) => { g.fillStyle = SL.blue; g.fillRect(0, h * 0.44, w, h * 0.1); }, SL.blue)),
  clown: region(256, 128, drawFish(SL.orange, (g, w, h) => stripes(g, w, h, SL.cream, 16, 44, 0), SL.ink)),
  pinkDash: region(256, 128, drawFish(SL.pink, (g, w, h) => dashes(g, w, h, SL.orange, 34, 18, 7), SL.orange)),
  greenStripe: region(256, 128, drawFish(SL.green, (g, w, h) => stripes(g, w, h, SL.pink, 6, 18, 0.7), SL.pink)),
};
TEX.grass = [SL.green, SL.yellow, '#3c8a55'].map((c, i) => region(160, 256, (g, w, h) => {
  for (let k = 0; k < 4; k++) noodle(g, wavyLine(w * (0.2 + k * 0.2), h - 8, h * (0.12 + crand() * 0.3), 6, 0.05, k + i), 11, c);
}));
TEX.coral = [
  region(256, 320, drawArt(art.pinkflower, flower(5, SL.pink, SL.orange))),
  region(256, 320, drawArt(art.redflower, flower(5, SL.orange, SL.pink))),
  region(256, 320, drawArt(art.greenflower, flower(6, SL.green, SL.pink, (g, w, h) => stripes(g, w, h, SL.pink, 5, 22, 0.4)))),
  region(256, 320, flower(6, SL.yellow, SL.orange)),
  region(256, 320, flower(5, SL.pink, SL.green, (g, w, h) => dashes(g, w, h, SL.orange, 40, 16, 6))),
  region(256, 256, drawArt(art.pinktriangle, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, 12); g.lineTo(w - 14, h - 8); g.lineTo(14, h - 8); g.closePath(); }, SL.pink, () => dashes(g, w, h, SL.orange, 50)))),
  region(256, 256, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, 10); g.lineTo(w - 20, h - 8); g.lineTo(20, h - 8); g.closePath(); }, SL.green, () => stripes(g, w, h, SL.lemon, 6, 20, -0.4))),
  region(256, 176, drawArt(art.semicircle, (g, w, h) => fillWith(g, () => { g.beginPath(); g.arc(w / 2, h - 8, w * 0.44, Math.PI, 0); g.closePath(); }, SL.pink, () => stripes(g, w, h, SL.orange, 9, 16, 0.6)))),
  region(256, 176, (g, w, h) => fillWith(g, () => { g.beginPath(); g.arc(w / 2, h - 8, w * 0.44, Math.PI, 0); g.closePath(); }, SL.orange, () => stripes(g, w, h, SL.pink, 9, 16, -0.6))),
  region(256, 160, drawArt(art.macaroni, (g, w, h) => { g.beginPath(); g.arc(w / 2, h - 8, w * 0.38, Math.PI, 0); g.strokeStyle = SL.yellow; g.lineWidth = 34; g.stroke(); })),
  region(128, 256, (g, w, h) => { noodle(g, wavyLine(w / 2, h, h * 0.35, 4, 0.05, 0), 10, SL.green); blob(g, w / 2, h * 0.3, w * 0.36, w * 0.36, 0.05); g.fillStyle = SL.orange; g.fill(); }),
  region(128, 256, drawArt(art.redsun, (g, w, h) => { blob(g, w / 2, h * 0.5, w * 0.42, w * 0.42, 0.05); g.fillStyle = SL.orange; g.fill(); })),
];
TEX.rock = [
  region(256, 176, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 0.72, w * 0.46, h * 0.66, 0.05), SL.green, () => stripes(g, w, h, SL.pink, 6, 24, 0.5))),
  region(256, 176, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 0.72, w * 0.46, h * 0.6, 0.07), SL.ink, () => spots(g, w, h, SL.cream, 18, 6))),
  region(256, 176, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 0.75, w * 0.46, h * 0.62, 0.05), SL.rose, () => dashes(g, w, h, SL.green, 30, 18, 7))),
  region(256, 176, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 0.7, w * 0.44, h * 0.7, 0.06), '#2e8a74', () => stripes(g, w, h, SL.lemon, 5, 30, -0.3))),
];
TEX.vent = region(192, 256, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w * 0.38, 12); g.lineTo(w * 0.62, 12); g.lineTo(w - 10, h - 6); g.lineTo(10, h - 6); g.closePath(); }, SL.ink,
  () => { for (let k = 0; k < 4; k++) noodle(g, wavyLine(w * (0.3 + k * 0.13), h, 20, 5, 0.06, k), 4, SL.cream); }));
const clamShell = (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, h - 10); g.arc(w / 2, h - 10, w * 0.44, Math.PI * 1.05, -Math.PI * 0.05); g.closePath(); }, SL.orange,
  () => { g.strokeStyle = SL.pink; g.lineWidth = 7; for (let k = 1; k < 8; k++) { const a = Math.PI + (k / 8) * Math.PI; g.beginPath(); g.moveTo(w / 2, h - 10); g.lineTo(w / 2 + Math.cos(a) * w, h - 10 + Math.sin(a) * w); g.stroke(); } });
TEX.clamOpen = region(256, 192, (g, w, h) => {
  clamShell(g, w, h);
  g.beginPath(); g.arc(w / 2, h * 0.62, w * 0.13, 0, 7); g.fillStyle = SL.cream; g.fill();
  g.beginPath(); g.arc(w * 0.46, h * 0.58, w * 0.035, 0, 7); g.fillStyle = '#ffffff'; g.fill();
});
TEX.clamShut = region(256, 192, (g, w, h) => { g.save(); g.translate(0, h * 0.25); g.scale(1, 0.75); clamShell(g, w, h); g.restore(); });
TEX.star = region(192, 192, (g, w, h) => {
  const star = (r1, r2, rot, fill) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4, r = i % 2 ? r2 : r1; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  star(w * 0.32, w * 0.06, Math.PI / 4, SL.orange);
  star(w * 0.46, w * 0.07, 0, SL.lemon);
  g.beginPath(); g.arc(w / 2, h / 2, w * 0.07, 0, 7); g.fillStyle = SL.orange; g.fill();
});
const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.colorSpace = THREE.SRGBColorSpace;
atlasTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

// ---------- billboard layers ------------------------------------------------------
// MODE_CYL: stands upright and turns to face you. MODE_SPH: always faces you.
// MODE_AXIS: lies along its swim direction and rolls to show its side (fish).
const SHAPE_VERT = /* glsl */`
  uniform float uTime;
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iRect;
  attribute vec4 iParams;   // phase, sway (m), roll, flip
  attribute vec3 iDir;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vec2 q = position.xy;
    vec2 t = uv;
    vec3 toCam = cameraPosition - iPos;
    vec3 right, up;
  #if defined(MODE_CYL)
    vec3 f = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
    right = vec3(f.z, 0.0, -f.x);
    up = vec3(0.0, 1.0, 0.0);
  #elif defined(MODE_AXIS)
    right = normalize(iDir + vec3(1e-4, 0.0, 0.0));
    vec3 c = cross(normalize(toCam), right);
    up = length(c) < 1e-3 ? vec3(0.0, 1.0, 0.0) : normalize(c);
    if (up.y < 0.0) up = -up;
  #else
    right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  #endif
    float ph = iParams.x * 6.2831;
  #ifdef SWAY
    q.x += (sin(uTime * 1.1 + ph + t.y * 3.0) * 0.5 + sin(uTime * 2.3 + ph * 1.7 + t.y * 6.0) * 0.12) * iParams.y * t.y * t.y / iSize.x;
  #endif
  #ifdef WIGGLE
    q.y += sin(uTime * 10.0 + ph) * max(0.0, 0.45 - t.x) * 0.5;
  #endif
    float cr = cos(iParams.z), sr = sin(iParams.z);
    q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
    if (iParams.w > 0.5) t.x = 1.0 - t.x;
    vUv = iRect.xy + t * iRect.zw;
    vec3 wp = iPos + right * q.x * iSize.x + up * q.y * iSize.y;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SHAPE_FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(uAtlas, vUv);
    if (c.a < 0.45) discard;
    gl_FragColor = vec4(c.rgb, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
function makeLayer(max, { mode = 'CYL', bottom = true, segX = 1, segY = 1, sway = false, wiggle = false } = {}) {
  const base = new THREE.PlaneGeometry(1, 1, segX, segY);
  if (bottom) base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
  const a = { iPos: mk(3), iSize: mk(2), iRect: mk(4), iParams: mk(4), iDir: mk(3) };
  for (const k in a) geo.setAttribute(k, a[k]);
  geo.instanceCount = 0;
  const defines = { ['MODE_' + mode]: '' };
  if (sway) defines.SWAY = '';
  if (wiggle) defines.WIGGLE = '';
  const mat = new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide, defines,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null } }]),
    vertexShader: SHAPE_VERT, fragmentShader: SHAPE_FRAG,
  });
  mat.uniforms.uAtlas.value = atlasTex;
  mat.uniforms.uTime = shared.uTime;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    a, count: 0,
    add(pos, w, h, tex, { phase = rand(), sway = 0, roll = 0, flip = rand() < 0.5 } = {}) {
      const i = this.count++;
      a.iPos.setXYZ(i, pos.x, pos.y, pos.z);
      a.iSize.setXY(i, w, h);
      a.iRect.setXYZW(i, tex.rect.x, tex.rect.y, tex.rect.z, tex.rect.w);
      a.iParams.setXYZW(i, phase, sway, roll, flip ? 1 : 0);
      a.iDir.setXYZ(i, 1, 0, 0);
      geo.instanceCount = this.count;
      return i;
    },
    setRect(i, tex) { a.iRect.setXYZW(i, tex.rect.x, tex.rect.y, tex.rect.z, tex.rect.w); a.iRect.needsUpdate = true; },
    dirty(...keys) { for (const k of keys) a[k].needsUpdate = true; },
  };
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------- seabed shapes ------------------------------------------------------------
const reefSpot = (x, y, z) => y > -27 && terrainNormalY(x, z) > 0.8;
{
  const rocks = makeLayer(340);
  for (let i = 0; i < 340; i++) {
    const at = seabedPoint(8, 190);
    if (!at) continue;
    const tex = pick(TEX.rock);
    const w = rand() < 0.12 ? rr(6, 12) : rr(1.4, 4);
    rocks.add(new THREE.Vector3(at.x, at.y - 0.25, at.z), w, w / tex.aspect, tex);
  }

  const coral = makeLayer(700, { segY: 4, sway: true });
  for (let i = 0; i < 700; i++) {
    const at = seabedPoint(0, 110, reefSpot);
    if (!at) continue;
    const tex = pick(TEX.coral);
    const h = rr(0.9, 2.6) * (tex.aspect > 1.2 ? 0.7 : 1);
    coral.add(new THREE.Vector3(at.x, at.y - 0.1, at.z), h * tex.aspect, h, tex, { sway: 0.12 });
  }

  const kelp = makeLayer(700, { segY: 14, sway: true });
  for (let f = 0; f < 12; f++) {
    const centre = seabedPoint(40, 160, (x, y, z) => y < -24 && terrainNormalY(x, z) > 0.75);
    if (!centre) continue;
    for (let j = 0; j < 55; j++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 14;
      const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r, y = terrainHeight(x, z);
      const h = Math.min(rr(9, 24), -y - 2);
      const tex = pick(TEX.kelp);
      kelp.add(new THREE.Vector3(x, y - 0.3, z), h * tex.aspect * 1.6, h, tex, { sway: rr(1.5, 3) });
    }
  }

  const grass = makeLayer(1800, { segY: 3, sway: true });
  for (let k = 0; k < 90; k++) {
    const centre = seabedPoint(0, 120, (x, y, z) => y > -30 && terrainNormalY(x, z) > 0.9);
    if (!centre) continue;
    for (let j = 0; j < 20; j++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 4;
      const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
      const tex = pick(TEX.grass), h = rr(0.6, 1.4);
      grass.add(new THREE.Vector3(x, terrainHeight(x, z) - 0.05, z), h * tex.aspect, h, tex, { sway: 0.25 });
    }
  }
}

const vents = [];
{
  const layer = makeLayer(6);
  for (let i = 0; i < 6; i++) {
    const at = seabedPoint(55, 160, (x, y) => y < -30);
    if (!at) continue;
    const h = rr(2.6, 3.6);
    layer.add(new THREE.Vector3(at.x, at.y - 0.3, at.z), h * TEX.vent.aspect, h, TEX.vent);
    vents.push(new THREE.Vector3(at.x, at.y + h - 0.4, at.z));
  }
}

// ---------- fish (boids) ---------------------------------------------------------------
const SPECIES = [
  { name: 'tang', tex: ['blueDash', 'blueStripe'], size: [0.55, 0.75], count: 110, speed: [3, 6] },
  { name: 'butterfly', tex: ['yellowDot', 'yellowInk'], size: [0.4, 0.55], count: 140, speed: [2.5, 5] },
  { name: 'sardine', tex: ['sardine'], size: [0.28, 0.36], count: 260, speed: [4, 8] },
  { name: 'clown', tex: ['clown'], size: [0.35, 0.45], count: 60, speed: [2, 4] },
  { name: 'wrasse', tex: ['pinkDash', 'greenStripe'], size: [0.45, 0.65], count: 70, speed: [2.5, 5.5] },
];
const FISH_N = SPECIES.reduce((s, sp) => s + sp.count, 0);
const fishLayer = makeLayer(FISH_N, { mode: 'AXIS', bottom: false, segX: 6, wiggle: true });
const fish = { pos: [], vel: [], dir: [], scale: new Float32Array(FISH_N), group: new Uint8Array(FISH_N) };
const groups = [];
{
  let i = 0;
  SPECIES.forEach((sp) => {
    const schools = sp.name === 'sardine' ? 1 : 2;
    for (let s = 0; s < schools; s++) groups.push({ species: sp, members: [], seed: rand() * 100, target: new THREE.Vector3() });
    for (let k = 0; k < sp.count; k++, i++) {
      const gi = groups.length - schools + (k % schools);
      groups[gi].members.push(i);
      fish.group[i] = gi;
      const ang = rand() * 6.28, r = rr(10, 90);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const p = new THREE.Vector3(x, rr(terrainHeight(x, z) + 2, -3), z);
      fish.pos.push(p);
      fish.vel.push(new THREE.Vector3(rr(-1, 1), 0, rr(-1, 1)).setLength(sp.speed[0]));
      fish.dir.push(fish.vel[i].clone().normalize());
      const len = rr(sp.size[0], sp.size[1]) * 1.9;
      fish.scale[i] = len;
      fishLayer.add(p, len, len / 2, TEX.fish[sp.tex[k % sp.tex.length]], { flip: false });
    }
  });
}
const _acc = new THREE.Vector3(), _coh = new THREE.Vector3(), _ali = new THREE.Vector3(), _sep = new THREE.Vector3();
const _d = new THREE.Vector3();

function updateGroupTargets(t) {
  groups.forEach((g, gi) => {
    const a = t * (0.025 + (gi % 3) * 0.008) + g.seed;
    const r = 30 + 55 * (0.5 + 0.5 * Math.sin(t * 0.01 + g.seed * 3));
    const x = Math.cos(a) * r, z = Math.sin(a * 1.3) * r;
    const floor = terrainHeight(x, z);
    g.target.set(x, Math.min(floor + 4 + (gi % 4) * 2, -3), z);
  });
}

function updateFish(dt, playerPos) {
  const NEIGH = 4.2, SEP = 1.1;
  const A = fishLayer.a;
  for (const g of groups) {
    const sp = g.species;
    const mem = g.members;
    for (let a = 0; a < mem.length; a++) {
      const i = mem[a];
      const p = fish.pos[i], v = fish.vel[i];
      _coh.set(0, 0, 0); _ali.set(0, 0, 0); _sep.set(0, 0, 0);
      let cnt = 0;
      for (let b = 0; b < mem.length; b++) {
        if (a === b) continue;
        const q = fish.pos[mem[b]];
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < NEIGH * NEIGH) {
          _coh.add(q); _ali.add(fish.vel[mem[b]]); cnt++;
          if (d2 < SEP * SEP) { const inv = 1 / Math.max(d2, 0.05); _sep.x += dx * inv; _sep.y += dy * inv; _sep.z += dz * inv; }
        }
      }
      _acc.set(0, 0, 0);
      if (cnt) {
        _coh.multiplyScalar(1 / cnt).sub(p).multiplyScalar(0.9);
        _ali.multiplyScalar(1 / cnt).sub(v).multiplyScalar(1.2);
        _acc.add(_coh).add(_ali);
      }
      _acc.addScaledVector(_sep, 3.2);
      _d.subVectors(g.target, p);
      const dl = _d.length();
      if (dl > 0.01) _acc.addScaledVector(_d, Math.min(dl, 20) * 0.06 / dl * 4);

      // flee the diver
      _d.subVectors(p, playerPos);
      const pd = _d.length();
      if (pd < 7 && pd > 0.01) _acc.addScaledVector(_d, (1 - pd / 7) * 40 / pd);

      // stay in the water column
      const floor = terrainHeight(p.x, p.z);
      if (p.y < floor + 1.5) _acc.y += (floor + 1.5 - p.y) * 8;
      if (p.y > -1.5) _acc.y -= (p.y + 1.5) * 8;
      const r = Math.hypot(p.x, p.z);
      if (r > WORLD_R - 10) { _acc.x -= p.x / r * 6; _acc.z -= p.z / r * 6; }
      _acc.y -= v.y * 0.8; // prefer level swimming

      v.addScaledVector(_acc, dt);
      const sp2 = v.length();
      const lo = sp.speed[0], hi = pd < 7 ? sp.speed[1] * 1.8 : sp.speed[1];
      if (sp2 > hi) v.multiplyScalar(hi / sp2); else if (sp2 < lo) v.multiplyScalar(lo / Math.max(sp2, 0.001));
      p.addScaledVector(v, dt);
      if (p.y < floor + 0.6) p.y = floor + 0.6;

      const d = fish.dir[i];
      d.lerp(_d.copy(v).normalize(), Math.min(1, dt * 5)).normalize();
      A.iPos.setXYZ(i, p.x, p.y, p.z);
      A.iDir.setXYZ(i, d.x, d.y, d.z);
    }
  }
  fishLayer.dirty('iPos', 'iDir');
}

// ---------- jellyfish -----------------------------------------------------------------
const jellyLayer = makeLayer(34, { mode: 'SPH', bottom: false });
const jellies = [];
for (let i = 0; i < 34; i++) {
  const at = seabedPoint(25, 165, (x, y) => y < -18);
  if (!at) continue;
  const s = rr(0.9, 2.2);
  const home = new THREE.Vector3(at.x, rr(at.y + 5, Math.min(-6, at.y + 22)), at.z);
  const idx = jellyLayer.add(home, s, s / TEX.jelly[0].aspect, TEX.jelly[i % TEX.jelly.length], { flip: false });
  jellies.push({ idx, position: home.clone(), home, seed: rand() * 100, size: s });
}
function updateJellies(t) {
  const A = jellyLayer.a;
  for (const j of jellies) {
    const pulse = Math.sin(t * 2.1 + j.seed);
    j.position.set(
      j.home.x + Math.sin(t * 0.05 + j.seed) * 6,
      j.home.y + Math.sin(t * 0.15 + j.seed) * 3 + pulse * 0.15,
      j.home.z + Math.cos(t * 0.04 + j.seed * 1.3) * 6);
    A.iPos.setXYZ(j.idx, j.position.x, j.position.y, j.position.z);
    A.iSize.setXY(j.idx, j.size * (1 + pulse * 0.08), (j.size / TEX.jelly[0].aspect) * (1 - pulse * 0.05));
    A.iParams.setZ(j.idx, Math.sin(t * 0.3 + j.seed) * 0.12);
  }
  jellyLayer.dirty('iPos', 'iSize', 'iParams');
}

// ---------- pearls in clams ---------------------------------------------------------------
const clamLayer = makeLayer(PEARL_COUNT);
const starLayer = makeLayer(PEARL_COUNT, { mode: 'SPH', bottom: false });
const pearls = [];
{
  let tries = 0;
  while (pearls.length < PEARL_COUNT && tries++ < 4000) {
    const band = pearls.length < 7 ? [8, 70] : pearls.length < 14 ? [60, 125] : [100, 165];
    const at = seabedPoint(band[0], band[1], (x, y, z) => terrainNormalY(x, z) > 0.82 &&
      pearls.every((p) => Math.hypot(p.pos.x - x, p.pos.z - z) > 22));
    if (!at) continue;
    const w = 1.9;
    const clam = clamLayer.add(new THREE.Vector3(at.x, at.y - 0.15, at.z), w, w / TEX.clamOpen.aspect, TEX.clamOpen, { flip: false });
    const pos = new THREE.Vector3(at.x, at.y + 0.6, at.z);
    const star = starLayer.add(new THREE.Vector3(at.x, at.y + 1.9, at.z), 1.8, 1.8, TEX.star, { flip: false });
    pearls.push({ pos, clam, star, taken: false, phase: rand() * 6.28 });
  }
}
function setPearlTaken(p, taken) {
  p.taken = taken;
  clamLayer.setRect(p.clam, taken ? TEX.clamShut : TEX.clamOpen);
  starLayer.a.iSize.setXY(p.star, taken ? 0 : 1.8, taken ? 0 : 1.8);
  starLayer.dirty('iSize');
}
function updatePearlStars(t) {
  for (const p of pearls) {
    if (p.taken) continue;
    const s = 1.6 + (0.5 + 0.5 * Math.sin(t * 2 + p.phase)) * 0.7;
    starLayer.a.iSize.setXY(p.star, s, s);
    starLayer.a.iParams.setZ(p.star, t * 0.5 + p.phase);
  }
  starLayer.dirty('iSize', 'iParams');
}

// =====================================================================
// Player, input, game state
// =====================================================================
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 };
const game = { state: 'menu', o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 0, torch: false, locked: false };
const keys = new Set();
const touchMove = { x: 0, y: 0 };
const touchVert = { up: false, down: false };

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hudRoot'), depth: $('hDepth'), ata: $('hAta'), temp: $('hTemp'), pearls: $('hPearls'),
  o2: $('o2'), o2Fill: $('o2Fill'), o2Val: $('o2Val'), toast: $('toast'), flash: $('flash'),
  arrow: $('sonarArrow'), sonarDist: $('sonarDist'),
  start: $('startScreen'), end: $('endScreen'), pause: $('pauseScreen'),
  endTitle: $('endTitle'), endText: $('endText'), endEyebrow: $('endEyebrow'),
};
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) {
  $('keyList').innerHTML = '<dt>Left thumb</dt><dd>Swim</dd><dt>Right thumb</dt><dd>Look</dd><dt>Up / Dive</dt><dd>Rise and sink</dd>';
}

let toastTimer = 0;
function toast(msg, secs = 2.2) { ui.toast.textContent = msg; ui.toast.classList.add('on'); toastTimer = secs; }

function resetGame() {
  player.pos.set(0, -2, 24);
  player.vel.set(0, 0, 0);
  player.yaw = 0; player.pitch = -0.25; player.roll = 0;
  game.o2 = 100; game.score = 0; game.time = 0; game.stingCooldown = 0; game.breathTimer = 2;
  for (const p of pearls) {
    setPearlTaken(p, false);
  }
}

function startGame() {
  resetGame();
  game.state = 'play';
  ui.start.hidden = true; ui.end.hidden = true; ui.pause.hidden = true; ui.hud.hidden = false;
  $('touch').hidden = !isTouch;
  requestLock();
  toast('Find the sparkling clams');
}
function endGame(won) {
  game.state = 'over';
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hud.hidden = true;
  ui.end.hidden = false;
  const mins = Math.floor(game.time / 60), secs = Math.floor(game.time % 60).toString().padStart(2, '0');
  if (won) {
    let best = null;
    try {
      best = Number(localStorage.getItem('blueHollowBest')) || null;
      if (!best || game.time < best) { localStorage.setItem('blueHollowBest', String(game.time)); }
    } catch (e) { /* storage unavailable */ }
    const record = !best || game.time < best;
    ui.endEyebrow.textContent = record ? 'New best time' : 'Dive log';
    ui.endTitle.textContent = 'Every pearl found';
    ui.endText.textContent = `You cleared Blue Hollow in ${mins}:${secs}` +
      (best && !record ? `. Your best is ${Math.floor(best / 60)}:${Math.floor(best % 60).toString().padStart(2, '0')}.` : '.');
  } else {
    ui.endEyebrow.textContent = 'Dive log';
    ui.endTitle.textContent = 'Out of air';
    ui.endText.textContent = `You surfaced with ${game.score} of ${pearls.length} pearls after ${mins}:${secs} underwater. Watch the tank and come up to breathe sooner.`;
  }
}

function requestLock() {
  if (isTouch) return;
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* pointer lock unavailable; drag to look instead */ }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (game.locked && !locked && game.state === 'play') { game.state = 'paused'; ui.pause.hidden = false; }
  game.locked = locked;
});

$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', () => { game.state = 'play'; ui.pause.hidden = true; requestLock(); });

let dragging = false;
renderer.domElement.addEventListener('mousedown', () => {
  if (game.state !== 'play') return;
  if (!game.locked) requestLock();
  dragging = true;
});
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (game.state !== 'play' || !(game.locked || dragging)) return;
  // Chrome can report a bogus jump on the first event after pointer lock
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  look(e.movementX, e.movementY, 0.0022);
});
function look(dx, dy, k) {
  player.yaw -= dx * k;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * k));
}
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyF' && game.state === 'play') { game.torch = !game.torch; toast(game.torch ? 'Torch on' : 'Torch off', 1.2); }
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// touch: left half = swim stick, right half = look
{
  const stick = $('stick'), knob = stick.querySelector('i');
  let moveId = null, lookId = null, ox = 0, oy = 0, lx = 0, ly = 0;
  const el = renderer.domElement;
  el.addEventListener('touchstart', (e) => {
    if (game.state !== 'play') return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2 && moveId === null) {
        moveId = t.identifier; ox = t.clientX; oy = t.clientY;
        stick.hidden = false; stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
        knob.style.transform = '';
      } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) {
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const l = Math.hypot(dx, dy), max = 45;
        if (l > max) { dx *= max / l; dy *= max / l; }
        touchMove.x = dx / max; touchMove.y = -dy / max;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (t.identifier === lookId) {
        look(t.clientX - lx, t.clientY - ly, 0.005);
        lx = t.clientX; ly = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { moveId = null; touchMove.x = touchMove.y = 0; stick.hidden = true; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  el.addEventListener('touchend', endTouch);
  el.addEventListener('touchcancel', endTouch);
  const hold = (id, key) => {
    const b = $(id);
    const on = (v) => (e) => { e.preventDefault(); touchVert[key] = v; b.classList.toggle('on', v); };
    b.addEventListener('touchstart', on(true), { passive: false });
    b.addEventListener('touchend', on(false));
    b.addEventListener('touchcancel', on(false));
  };
  hold('tUp', 'up'); hold('tDown', 'down');
}

// ---------- player update -------------------------------------------------
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();
function updatePlayer(dt, t) {
  const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw), cp = Math.cos(player.pitch), spc = Math.sin(player.pitch);
  _fwd.set(-sy * cp, spc, -cy * cp);
  _right.set(cy, 0, -sy);
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touchMove.y;
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touchMove.x;
  const u = (keys.has('Space') || touchVert.up ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') || touchVert.down ? 1 : 0);
  _move.set(0, 0, 0).addScaledVector(_fwd, f).addScaledVector(_right, s);
  _move.y += u;
  if (_move.lengthSq() > 1) _move.normalize();
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const accel = boost ? 16 : 8.5;
  player.vel.addScaledVector(_move, accel * dt);
  player.vel.multiplyScalar(Math.exp(-1.9 * dt));      // water drag
  player.vel.y -= 0.12 * dt;                            // slightly negative buoyancy
  player.pos.addScaledVector(player.vel, dt);

  const floor = terrainHeight(player.pos.x, player.pos.z) + 1.3;
  if (player.pos.y < floor) { player.pos.y = floor; if (player.vel.y < 0) player.vel.y *= -0.2; }
  if (player.pos.y > -0.35) { player.pos.y = -0.35; if (player.vel.y > 0) player.vel.y = 0; }
  const r = Math.hypot(player.pos.x, player.pos.z);
  if (r > WORLD_R) { player.pos.x *= WORLD_R / r; player.pos.z *= WORLD_R / r; }

  // gentle swim sway
  const speed = player.vel.length();
  player.roll = lerp(player.roll, -player.vel.dot(_right) * 0.03, Math.min(1, dt * 3));
  camera.position.copy(player.pos);
  camera.position.y += Math.sin(t * 1.3) * 0.05 + Math.sin(t * 6) * 0.02 * Math.min(speed, 4);
  camera.rotation.set(player.pitch + Math.sin(t * 0.9) * 0.008, player.yaw, player.roll + Math.sin(t * 0.7) * 0.01);

  // air
  const depth = -player.pos.y;
  if (player.pos.y > SURFACE_BREATH_Y) {
    if (game.o2 < 99.5 && Math.floor(game.o2 / 20) !== Math.floor(Math.min(100, game.o2 + 30 * dt) / 20)) toast('Breathing');
    game.o2 = Math.min(100, game.o2 + 30 * dt);
  } else {
    game.o2 -= (0.9 + depth * 0.025) * (boost && _move.lengthSq() > 0 ? 1.8 : 1) * dt;
    game.breathTimer -= dt;
    if (game.breathTimer <= 0) {
      game.breathTimer = rr(3.2, 4.5);
      for (let i = 0; i < 14; i++) spawnBubble(player.pos.x + _fwd.x * 0.6 + rr(-0.15, 0.15), player.pos.y - 0.25 + rr(0, 0.3), player.pos.z + _fwd.z * 0.6 + rr(-0.15, 0.15));
    }
  }
  if (game.o2 <= 0) { game.o2 = 0; endGame(false); }
}

// ---------- interactions ---------------------------------------------------
function updateInteractions(dt, t) {
  game.stingCooldown -= dt;
  for (const j of jellies) {
    const d = j.position.distanceTo(player.pos);
    if (d < 1.2 + j.size * 0.7 && game.stingCooldown <= 0) {
      game.stingCooldown = 1.5;
      game.o2 = Math.max(0, game.o2 - 12);
      _d.subVectors(player.pos, j.position).normalize();
      player.vel.addScaledVector(_d, 6);
      ui.flash.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
      toast('Stung! −12 O₂');
    }
  }
  let nearest = null, nd = Infinity;
  for (const p of pearls) {
    if (p.taken) continue;
    const d = p.pos.distanceTo(player.pos);
    if (d < 2.4) {
      setPearlTaken(p, true);
      game.score++;
      game.o2 = Math.min(100, game.o2 + 10);
      for (let i = 0; i < 24; i++) spawnBubble(p.pos.x + rr(-0.4, 0.4), p.pos.y + rr(0, 0.4), p.pos.z + rr(-0.4, 0.4), rr(0.04, 0.12));
      toast(game.score === pearls.length ? 'Last pearl!' : `Pearl ${game.score} of ${pearls.length} · +10 O₂`);
      if (game.score === pearls.length) setTimeout(() => endGame(true), 900);
    } else if (d < nd) { nd = d; nearest = p.pos; }
  }
  // sonar
  if (nearest) {
    const dx = nearest.x - player.pos.x, dz = nearest.z - player.pos.z;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const ahead = dx * -sy + dz * -cy, side = dx * cy + dz * -sy;
    const ang = Math.atan2(side, ahead) * 180 / Math.PI;
    ui.arrow.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
    const vert = nearest.y - player.pos.y;
    ui.sonarDist.textContent = `${Math.round(nd)} m${vert < -6 ? ' ↓' : vert > 6 ? ' ↑' : ''}`;
  } else {
    ui.sonarDist.textContent = '--';
  }
}

// ---------- environment by depth --------------------------------------------
const _c = new THREE.Color();
function updateAtmosphere() {
  const depth = Math.max(0, -camera.position.y);
  const k = smooth(0, 48, depth);
  scene.fog.color.copy(SHALLOW).lerp(DEEP, k);
  scene.fog.density = 0.022 + k * 0.012;
  rayMat.uniforms.uStrength.value = 1 - k * 0.6;
  surfaceMat.uniforms.uUnder.value.set(PAL.surface).lerp(_c.set(PAL.surfaceDeep), k * 0.8);
  shared.uTorch.value = game.torch && game.state === 'play' ? 1 : 0;
  shared.uCamPos.value.copy(camera.position);
  camera.getWorldDirection(shared.uCamDir.value);
  shared.uCaustic.value = 1 - k * 0.3;
}

// ---------- HUD ---------------------------------------------------------------
let hudTimer = 0;
function updateHUD(dt) {
  hudTimer -= dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('on'); }
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  const depth = Math.max(0, -player.pos.y);
  ui.depth.innerHTML = `${depth.toFixed(1)}<small>m</small>`;
  ui.ata.innerHTML = `${(1 + depth / 10).toFixed(1)}<small>ata</small>`;
  ui.temp.innerHTML = `${Math.round(27 - depth * 0.17)}<small>°C</small>`;
  ui.pearls.innerHTML = `${game.score}<small>/ ${pearls.length}</small>`;
  ui.o2Fill.style.transform = `scaleX(${(game.o2 / 100).toFixed(3)})`;
  ui.o2Val.textContent = `${Math.ceil(game.o2)}%`;
  ui.o2.classList.toggle('low', game.o2 < 25);
}

// ---------- paper pass: cut-out drop shadows from depth, plus paper grain ------------
const paperRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
paperRT.depthTexture = new THREE.DepthTexture(1, 1);
const paperMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    tColor: { value: paperRT.texture }, tDepth: { value: paperRT.depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) }, uScale: { value: 1 },
    uNear: { value: camera.near }, uFar: { value: camera.far },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tColor, tDepth;
    uniform vec2 uRes;
    uniform float uScale, uNear, uFar;
    varying vec2 vUv;
    float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
    }
    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      float d0 = lin(texture2D(tDepth, vUv).r);
      // anything nearer up and to the left casts a shadow down and to the right
      float sh = 0.0;
      for (int i = 1; i <= 4; i++) {
        vec2 o = vec2(-1.0, 1.0) * float(i) * 1.8 * uScale / uRes;
        float d1 = lin(texture2D(tDepth, vUv + o).r);
        sh += step(0.3 + d0 * 0.04, d0 - d1);
      }
      col *= 1.0 - sh * 0.075;
      vec2 fc = gl_FragCoord.xy / uScale;
      float grain = hash(floor(fc)) - 0.5;
      float fiber = vnoise(fc * vec2(0.09, 0.025)) + vnoise(fc * 0.35) * 0.5 - 0.75;
      float mottle = vnoise(fc * 0.006) - 0.5;
      col *= 1.0 + grain * 0.05 + fiber * 0.06 + mottle * 0.07;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
const paperScene = new THREE.Scene();
const paperQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), paperMat);
paperQuad.frustumCulled = false;
paperScene.add(paperQuad);
function sizePaperPass() {
  const pr = renderer.getPixelRatio();
  const w = Math.floor(window.innerWidth * pr), h = Math.floor(window.innerHeight * pr);
  paperRT.setSize(w, h);
  paperMat.uniforms.uRes.value.set(w, h);
  paperMat.uniforms.uScale.value = pr;
}
sizePaperPass();

// ---------- main loop ---------------------------------------------------------
const clock = new THREE.Clock();
let t = 0, ventTimer = 0, menuAngle = 0;
resetGame();
updateGroupTargets(0);

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const paused = game.state === 'paused' || document.hidden;
  if (!paused) t += dt;
  shared.uTime.value = t;
  surfaceMat.uniforms.uTime.value = t;

  if (game.state === 'play') {
    game.time += dt;
    updatePlayer(dt, t);
    updateInteractions(dt, t);
    updateHUD(dt);
  } else if (game.state === 'menu' || game.state === 'over') {
    // slow cinematic drift over the reef behind the menu
    menuAngle += dt * 0.03;
    const x = Math.cos(menuAngle) * 38, z = Math.sin(menuAngle) * 38;
    camera.position.set(x, Math.max(terrainHeight(x, z) + 6, -9), z);
    camera.rotation.set(-0.18, Math.atan2(x, z) + 1.1, 0);
    player.pos.copy(camera.position);
  }

  if (!paused) {
    updateGroupTargets(t);
    updateFish(dt, game.state === 'play' ? player.pos : camera.position);
    updateJellies(t);
    updatePearlStars(t);
    ventTimer -= dt;
    if (ventTimer <= 0) {
      ventTimer = 0.05;
      for (const v of vents) spawnBubble(v.x + rr(-0.3, 0.3), v.y, v.z + rr(-0.3, 0.3), rr(0.06, 0.2));
    }
    updateBubbles(dt, t);
  }
  updateRays();
  updateAtmosphere();
  renderer.setRenderTarget(paperRT);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(paperScene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  sizePaperPass();
  pxRatio.value = renderer.getPixelRatio() * window.innerHeight / 800;
});

// exposed for tinkering from the console
window.blueHollow = { scene, camera, player, game, terrainHeight, jellies, pearls };
