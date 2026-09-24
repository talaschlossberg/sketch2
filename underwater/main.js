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

// Mid-century paper palette
const PAL = {
  paper: '#f2e6cf', ink: '#1f2a2e', teal: '#2f7f7a', deep: '#1c4a4f', mustard: '#e0a526',
  tomato: '#d9572b', olive: '#7c8b3e', pink: '#e8a3a0', sky: '#a9d8c8', sand: '#e2c48c',
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
const SHALLOW = new THREE.Color('#4f9d92');
const DEEP = new THREE.Color('#163a40');
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

// Replaces a built-in material's lighting with flat paper shading: three hard tone steps,
// cut-out caustic patches, a hard-edged torch circle, plus optional custom vertex/fragment code.
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
        vec3 wN = inverseTransformDirection(normal, viewMatrix);
        float l = dot(wN, uSunDir);
        float tone = l > 0.5 ? 1.0 : (l > 0.0 ? 0.8 : 0.62);
        vec3 paper = diffuseColor.rgb * tone;
        float depthFade = exp(vWorldPos.y * 0.04);
        float lit = step(0.42, caustics(vWorldPos) * depthFade * uCaustic) * step(0.35, wN.y);
        paper = mix(paper, diffuseColor.rgb * 1.22 + vec3(0.035, 0.035, 0.025), lit * 0.85);
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
      uniform vec3 uSand, uSandDark, uRock, uMoss, uDeepSand;`,
    fragColor: `
      vec3 ground = mix(uSand, uDeepSand, step(vWorldPos.y, -30.0));
      ground = mix(ground, uSandDark, step(0.12, vData.y));
      float rocky = step(vData.x + vData.y * 0.12, 0.82);
      ground = mix(ground, uRock, rocky);
      ground = mix(ground, uMoss, rocky * step(0.1, vData.z));
      diffuseColor.rgb = ground;`,
    uniforms: {
      uSand: { value: new THREE.Color(PAL.sand) }, uSandDark: { value: new THREE.Color('#c9a66c') },
      uDeepSand: { value: new THREE.Color('#b99d73') }, uRock: { value: new THREE.Color('#3f6663') },
      uMoss: { value: new THREE.Color(PAL.olive) },
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
    uSky: { value: new THREE.Color(PAL.sky) },
    uUnder: { value: new THREE.Color(PAL.teal) },
    uPaper: { value: new THREE.Color(PAL.paper) },
    uSun: { value: new THREE.Color(PAL.mustard) },
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
      float sunDisc = step(0.992, dot(normalize(refr + v), uSunDir)) * window;
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
  uniforms: { uTime: shared.uTime, uStrength: { value: 1 }, uPaper: { value: new THREE.Color(PAL.paper) } },
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
    uniforms: { uTime: shared.uTime, uCam: { value: camera.position }, uPx: pxRatio, uPaper: { value: new THREE.Color(PAL.paper) } },
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
    uniforms: { uPx: pxRatio, uPaper: { value: new THREE.Color(PAL.paper) } },
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

// ---------- rocks -------------------------------------------------------
const ROCK_COLORS = ['#3f6663', '#4d5b57', '#5f6f5a', '#2f4a4c', '#6b6a55'];
{
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + noise2(x * 1.3 + z * 0.7, y * 1.3 + 4) * 0.55 + noise2(x * 3 + 7, z * 3 - y) * 0.15;
    p.setXYZ(i, x * d, y * d * 0.75, z * d);
  }
  geo.computeVertexNormals();
  const N = 320;
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ flatShading: true }), { key: 'rock' });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < N; i++) {
    const at = seabedPoint(8, 190);
    if (!at) continue;
    const s = rand() < 0.12 ? rr(3, 7) : rr(0.4, 2.2);
    tmpP.set(at.x, at.y + s * 0.15, at.z);
    tmpQ.setFromEuler(new THREE.Euler(rr(-0.3, 0.3), rr(0, 6.28), rr(-0.3, 0.3)));
    tmpS.set(s * rr(0.8, 1.4), s * rr(0.6, 1.1), s * rr(0.8, 1.4));
    mesh.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
    mesh.setColorAt(n, c.set(ROCK_COLORS[Math.floor(rand() * ROCK_COLORS.length)]));
    n++;
  }
  mesh.count = n;
  scene.add(mesh);
}

// ---------- coral reef --------------------------------------------------
const CORAL_COLORS = [PAL.tomato, PAL.mustard, PAL.pink, '#e57a4e', PAL.paper, '#c4474b', '#f0c66b'].map((h) => new THREE.Color(h));
const reefSpot = (x, y, z) => y > -27 && terrainNormalY(x, z) > 0.8;
{
  const mat = patchMaterial(new THREE.MeshLambertMaterial(), { key: 'coral' });
  // brain coral
  const brainGeo = new THREE.SphereGeometry(1, 14, 10);
  {
    const p = brainGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + Math.sin(x * 9 + Math.sin(z * 7) * 2) * 0.05;
      p.setXYZ(i, x * d, Math.max(y, -0.2) * 0.6 * d, z * d);
    }
    brainGeo.computeVertexNormals();
  }
  const brains = new THREE.InstancedMesh(brainGeo, mat, 200);
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const at = seabedPoint(0, 95, reefSpot);
    if (!at) continue;
    const s = rr(0.4, 1.5);
    tmpP.set(at.x, at.y + 0.05, at.z);
    tmpQ.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
    tmpS.set(s, s * rr(0.7, 1.2), s);
    brains.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
    brains.setColorAt(n, CORAL_COLORS[Math.floor(rand() * CORAL_COLORS.length)]);
    n++;
  }
  brains.count = n;
  scene.add(brains);

  // tube / branch coral clusters
  const tubeGeo = new THREE.CylinderGeometry(0.09, 0.16, 1, 7, 1).translate(0, 0.5, 0);
  const MAX_T = 1100;
  const tubes = new THREE.InstancedMesh(tubeGeo, mat, MAX_T);
  n = 0;
  for (let k = 0; k < 130 && n < MAX_T - 12; k++) {
    const at = seabedPoint(0, 100, reefSpot);
    if (!at) continue;
    const col = CORAL_COLORS[Math.floor(rand() * CORAL_COLORS.length)];
    const count = 5 + Math.floor(rand() * 8);
    for (let j = 0; j < count; j++) {
      const ox = rr(-0.7, 0.7), oz = rr(-0.7, 0.7);
      const h = rr(0.6, 2.4);
      tmpP.set(at.x + ox, terrainHeight(at.x + ox, at.z + oz) - 0.1, at.z + oz);
      tmpQ.setFromEuler(new THREE.Euler(ox * 0.6 + rr(-0.2, 0.2), 0, -oz * 0.6 + rr(-0.2, 0.2)));
      tmpS.set(rr(0.8, 1.5), h, rr(0.8, 1.5));
      tubes.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
      tubes.setColorAt(n, col);
      n++;
    }
  }
  tubes.count = n;
  scene.add(tubes);

  // sea fans
  const fanGeo = new THREE.CircleGeometry(1, 18, 0, Math.PI);
  const fanMat = patchMaterial(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), { key: 'fan' });
  const fans = new THREE.InstancedMesh(fanGeo, fanMat, 90);
  n = 0;
  for (let i = 0; i < 90; i++) {
    const at = seabedPoint(5, 110, reefSpot);
    if (!at) continue;
    const s = rr(0.8, 2.2);
    tmpP.set(at.x, at.y - 0.1, at.z);
    tmpQ.setFromEuler(new THREE.Euler(rr(-0.15, 0.15), rr(0, 6.28), 0));
    tmpS.set(s, s * rr(0.9, 1.3), s);
    fans.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
    fans.setColorAt(n, new THREE.Color(rand() < 0.5 ? PAL.tomato : rand() < 0.5 ? '#c4474b' : PAL.pink));
    n++;
  }
  fans.count = n;
  scene.add(fans);
}

// ---------- kelp forest + sea grass ---------------------------------------
{
  const geo = new THREE.PlaneGeometry(1, 1, 1, 24).translate(0, 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - 0.75 * y) * (0.75 + 0.25 * Math.sin(y * 45)));
  }
  geo.computeVertexNormals();
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), {
    key: 'kelp',
    vertexHead: 'varying float vKh;\n',
    vertexBody: `
      vKh = position.y;
      vec3 ip = vec3(0.0);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
      #endif
      float ph = ip.x * 0.21 + ip.z * 0.17;
      float h2 = position.y * position.y;
      transformed.x += (sin(uTime * 0.9 + ph + position.y * 2.5) * 0.9 + sin(uTime * 2.1 + ph * 1.7 + position.y * 6.0) * 0.2) * h2;
      transformed.z += cos(uTime * 0.7 + ph * 1.3 + position.y * 2.0) * 0.6 * h2;`,
    fragHead: 'varying float vKh;\n',
    fragColor: 'diffuseColor.rgb *= vKh < 0.3 ? 0.72 : 1.0;',
  });

  const kelp = new THREE.InstancedMesh(geo, mat, 700);
  const c = new THREE.Color();
  let n = 0;
  for (let f = 0; f < 12; f++) {
    const centre = seabedPoint(40, 160, (x, y, z) => y < -24 && terrainNormalY(x, z) > 0.75);
    if (!centre) continue;
    for (let j = 0; j < 55 && n < 700; j++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 14;
      const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r, y = terrainHeight(x, z);
      const h = Math.min(rr(9, 24), -y - 2);
      tmpP.set(x, y - 0.2, z);
      tmpQ.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
      tmpS.set(rr(0.9, 1.6), h, 1);
      kelp.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
      kelp.setColorAt(n, c.set(rand() < 0.55 ? PAL.olive : rand() < 0.5 ? '#5d7a3a' : '#9aa345'));
      n++;
    }
  }
  kelp.count = n;
  scene.add(kelp);

  const grass = new THREE.InstancedMesh(geo, mat, 4000);
  n = 0;
  for (let k = 0; k < 90; k++) {
    const centre = seabedPoint(0, 120, (x, y, z) => y > -30 && terrainNormalY(x, z) > 0.9);
    if (!centre) continue;
    for (let j = 0; j < 45 && n < 4000; j++) {
      const a = rand() * 6.28, r = Math.sqrt(rand()) * 4;
      const x = centre.x + Math.cos(a) * r, z = centre.z + Math.sin(a) * r;
      tmpP.set(x, terrainHeight(x, z) - 0.05, z);
      tmpQ.setFromEuler(new THREE.Euler(0, rr(0, 6.28), 0));
      tmpS.set(0.14, rr(0.5, 1.4), 1);
      grass.setMatrixAt(n, tmpM.compose(tmpP, tmpQ, tmpS));
      grass.setColorAt(n, c.set(rand() < 0.5 ? '#6f8f4a' : '#8fa35a'));
      n++;
    }
  }
  grass.count = n;
  scene.add(grass);
}

// ---------- hydrothermal vents ---------------------------------------------
const vents = [];
{
  const geo = new THREE.CylinderGeometry(0.5, 2.2, 3, 9, 1, true);
  const mat = patchMaterial(new THREE.MeshLambertMaterial({ color: PAL.ink, flatShading: true, side: THREE.DoubleSide }), { key: 'vent' });
  for (let i = 0; i < 6; i++) {
    const at = seabedPoint(55, 160, (x, y) => y < -30);
    if (!at) continue;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(at.x, at.y + 1.2, at.z);
    scene.add(m);
    vents.push(new THREE.Vector3(at.x, at.y + 2.7, at.z));
  }
}

// ---------- fish (boids) -------------------------------------------------
function mergeGeometries(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
function tri(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.computeVertexNormals();
  return g;
}
const fishGeo = mergeGeometries([
  new THREE.SphereGeometry(0.5, 14, 10).scale(0.34, 0.8, 1.0),
  tri([0, 0, -0.42], [0, 0.32, -0.82], [0, -0.32, -0.82]),
  tri([0, 0.28, 0.12], [0, 0.5, -0.12], [0, 0.3, -0.3]),
  tri([0, -0.28, 0.0], [0, -0.42, -0.12], [0, -0.26, -0.25]),
]);

const SPECIES = [
  { name: 'tang', color: '#2e5f8a', size: [0.55, 0.75], count: 110, speed: [3, 6] },
  { name: 'butterfly', color: PAL.mustard, size: [0.4, 0.55], count: 140, speed: [2.5, 5] },
  { name: 'sardine', color: '#c9cfc0', size: [0.28, 0.36], count: 260, speed: [4, 8] },
  { name: 'clown', color: PAL.tomato, size: [0.35, 0.45], count: 60, speed: [2, 4] },
  { name: 'wrasse', color: PAL.pink, size: [0.45, 0.65], count: 70, speed: [2.5, 5.5] },
];
const FISH_N = SPECIES.reduce((s, sp) => s + sp.count, 0);
const fishPhase = new Float32Array(FISH_N);
for (let i = 0; i < FISH_N; i++) fishPhase[i] = rand();
fishGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(fishPhase, 1));
const fishMat = patchMaterial(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), {
  key: 'fish',
  vertexHead: 'attribute float aPhase;\nvarying vec3 vLocal;\n',
  vertexBody: `
    vLocal = position;
    float tl = clamp(0.2 - position.z, 0.0, 1.2);
    transformed.x += sin(uTime * 11.0 + aPhase * 6.2831 + position.z * 5.0) * 0.18 * tl * tl;`,
  fragHead: 'varying vec3 vLocal;\n',
  fragColor: `
    vec3 fc = diffuseColor.rgb;
    fc = vLocal.y < -0.12 && vLocal.z > -0.4 ? mix(fc, vec3(0.95, 0.9, 0.8), 0.55) : fc;   // pale belly
    float band = step(0.08, vLocal.z) * step(vLocal.z, 0.2);
    fc = mix(fc, vec3(0.95, 0.9, 0.8), band * step(-0.4, vLocal.z));                     // stripe
    vec2 eye = vec2(0.3, 0.08);
    float ed = length(vec2(vLocal.z, vLocal.y) - eye);
    fc = ed < 0.075 ? vec3(0.95, 0.9, 0.8) : fc;
    fc = ed < 0.045 ? vec3(0.12, 0.16, 0.18) : fc;
    diffuseColor.rgb = fc;`,
});
const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, FISH_N);
fishMesh.frustumCulled = false;
scene.add(fishMesh);

const fish = { pos: [], vel: [], quat: [], scale: new Float32Array(FISH_N), group: new Uint8Array(FISH_N) };
const groups = [];
{
  let i = 0;
  const c = new THREE.Color();
  SPECIES.forEach((sp, g) => {
    const schools = sp.name === 'sardine' ? 1 : 2;
    for (let s = 0; s < schools; s++) groups.push({ species: sp, members: [], seed: rand() * 100, target: new THREE.Vector3() });
    for (let k = 0; k < sp.count; k++, i++) {
      const gi = groups.length - schools + (k % schools);
      groups[gi].members.push(i);
      fish.group[i] = gi;
      const ang = rand() * 6.28, r = rr(10, 90);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      fish.pos.push(new THREE.Vector3(x, rr(terrainHeight(x, z) + 2, -3), z));
      fish.vel.push(new THREE.Vector3(rr(-1, 1), 0, rr(-1, 1)).setLength(sp.speed[0]));
      fish.quat.push(new THREE.Quaternion());
      fish.scale[i] = rr(sp.size[0], sp.size[1]);
      c.set(sp.color);
      fishMesh.setColorAt(i, c);
    }
  });
}
const _acc = new THREE.Vector3(), _coh = new THREE.Vector3(), _ali = new THREE.Vector3(), _sep = new THREE.Vector3();
const _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const ORIGIN = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

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

      _m.lookAt(v, ORIGIN, UP);
      _q.setFromRotationMatrix(_m);
      fish.quat[i].slerp(_q, Math.min(1, dt * 6));
      const s = fish.scale[i];
      _s.set(s, s, s);
      fishMesh.setMatrixAt(i, _m.compose(p, fish.quat[i], _s));
    }
  }
  fishMesh.instanceMatrix.needsUpdate = true;
}

// ---------- jellyfish -------------------------------------------------------
const jellies = [];
{
  const bellGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const tentGeo = new THREE.BufferGeometry();
  {
    const pts = [], ts = [];
    const STR = 10, SEGS = 14;
    for (let s = 0; s < STR; s++) {
      const a = (s / STR) * Math.PI * 2, r = 0.55 + (s % 2) * 0.25;
      for (let k = 0; k < SEGS; k++) {
        const t0 = k / SEGS, t1 = (k + 1) / SEGS;
        pts.push(Math.cos(a) * r, -t0 * 4.5 - 0.1, Math.sin(a) * r, Math.cos(a) * r, -t1 * 4.5 - 0.1, Math.sin(a) * r);
        ts.push(t0 + s * 0.013, t1 + s * 0.013);
      }
    }
    tentGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    tentGeo.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1));
  }
  const pulseGLSL = /* glsl */`
    uniform float uTime;
    float jellyPhase() { return modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.19; }
    float pulse() { return sin(uTime * 2.1 + jellyPhase()); }`;
  const tentMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(PAL.pink) } },
    vertexShader: pulseGLSL + /* glsl */`
      attribute float aT;
      varying float vT;
      varying float vDist;
      void main() {
        vec3 p = position;
        float t = fract(aT);
        vT = t;
        float ph = jellyPhase();
        p.x += sin(uTime * 1.3 + t * 5.0 + ph) * 0.5 * t;
        p.z += cos(uTime * 1.1 + t * 4.0 + ph) * 0.5 * t;
        p.xz *= 1.0 + 0.12 * pulse() * (1.0 - t);
        p.y *= 1.0 - 0.08 * pulse();
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vT, vDist;
      void main() {
        gl_FragColor = vec4(uColor, step(vDist, 55.0) * (vT < 0.7 ? 0.9 : 0.5));
      }`,
  });
  const palette = [PAL.pink, PAL.paper, PAL.mustard, '#f0b8a0'];
  for (let i = 0; i < 34; i++) {
    const col = new THREE.Color(palette[i % palette.length]);
    const bellMat = patchMaterial(new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide }), {
      key: 'jelly',
      vertexHead: 'varying float vBellY;\n',
      vertexBody: `
        float pl = sin(uTime * 2.1 + modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.19);
        vBellY = position.y;
        transformed.xz *= 1.0 + 0.14 * pl * (1.0 - position.y);
        transformed.y *= 1.0 - 0.12 * pl;`,
      fragHead: 'varying float vBellY;\n',
      fragColor: `
        diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 0.7;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.78, step(fract(vBellY * 5.0 + 0.1), 0.22));`,
    });
    const tm = tentMat.clone();
    tm.uniforms.uTime = shared.uTime;
    tm.uniforms.uColor = { value: col };
    const j = new THREE.Group();
    j.add(new THREE.Mesh(bellGeo, bellMat));
    j.add(new THREE.LineSegments(tentGeo, tm));
    const at = seabedPoint(25, 165, (x, y) => y < -18);
    if (!at) continue;
    const s = rr(0.45, 1.1);
    j.scale.setScalar(s);
    j.position.set(at.x, rr(at.y + 5, Math.min(-6, at.y + 22)), at.z);
    j.userData = { home: j.position.clone(), seed: rand() * 100, size: s };
    scene.add(j);
    jellies.push(j);
  }
}
function updateJellies(t) {
  for (const j of jellies) {
    const { home, seed } = j.userData;
    j.position.x = home.x + Math.sin(t * 0.05 + seed) * 6;
    j.position.z = home.z + Math.cos(t * 0.04 + seed * 1.3) * 6;
    j.position.y = home.y + Math.sin(t * 0.15 + seed) * 3 + Math.sin(t * 2.1 + j.position.x * 0.37 + j.position.z * 0.19) * 0.15;
    j.rotation.z = Math.sin(t * 0.3 + seed) * 0.15;
  }
}

// ---------- pearls in clams ---------------------------------------------
const glowTex = (() => {
  const c = document.createElement('canvas');
  // atomic-age starburst: a long four-point star over a short diagonal one
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const star = (r1, r2, rot, fill) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4, r = i % 2 ? r2 : r1;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  star(40, 7, Math.PI / 4, PAL.mustard);
  star(62, 9, 0, PAL.paper);
  g.beginPath(); g.arc(64, 64, 9, 0, Math.PI * 2); g.fillStyle = PAL.mustard; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const pearls = [];
{
  const shellGeo = new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  shellGeo.scale(1, 0.4, 0.85);
  const shellMat = patchMaterial(new THREE.MeshLambertMaterial({ color: PAL.teal, side: THREE.DoubleSide }), { key: 'shell' });
  const innerMat = new THREE.MeshBasicMaterial({ color: PAL.pink, side: THREE.BackSide });
  const pearlMat = new THREE.MeshBasicMaterial({ color: '#fff8ea' });
  const pearlGeo = new THREE.SphereGeometry(0.22, 16, 12);
  const minSpacing = 22;
  let tries = 0;
  while (pearls.length < PEARL_COUNT && tries++ < 4000) {
    const band = pearls.length < 7 ? [8, 70] : pearls.length < 14 ? [60, 125] : [100, 165];
    const at = seabedPoint(band[0], band[1], (x, y, z) => terrainNormalY(x, z) > 0.82 &&
      pearls.every((p) => Math.hypot(p.root.position.x - x, p.root.position.z - z) > minSpacing));
    if (!at) continue;
    const root = new THREE.Group();
    root.position.copy(at);
    root.rotation.y = rand() * 6.28;
    const bottom = new THREE.Mesh(shellGeo, shellMat);
    bottom.rotation.x = Math.PI;
    bottom.position.y = 0.34;
    const bottomIn = new THREE.Mesh(shellGeo, innerMat);
    bottomIn.rotation.x = Math.PI; bottomIn.position.y = 0.34; bottomIn.scale.setScalar(0.96);
    const lid = new THREE.Group();
    lid.position.set(0, 0.34, -0.75);
    const top = new THREE.Mesh(shellGeo, shellMat);
    top.position.z = 0.75;
    const topIn = new THREE.Mesh(shellGeo, innerMat);
    topIn.position.z = 0.75; topIn.scale.setScalar(0.96);
    lid.add(top, topIn);
    lid.rotation.x = -0.7;
    const pearl = new THREE.Mesh(pearlGeo, pearlMat);
    pearl.position.set(0, 0.5, 0.05);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true, fog: false }));
    glow.position.copy(pearl.position);
    glow.scale.setScalar(2.4);
    root.add(bottom, bottomIn, lid, pearl, glow);
    scene.add(root);
    pearls.push({ root, lid, pearl, glow, taken: false, phase: rand() * 6.28 });
  }
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
    p.taken = false; p.pearl.visible = true; p.glow.visible = true; p.lid.rotation.x = -0.7;
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
    if (d < 1.2 + j.userData.size * 1.4 && game.stingCooldown <= 0) {
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
    const pulse = 0.5 + 0.5 * Math.sin(t * 2 + p.phase);
    if (!p.taken) {
      p.glow.scale.setScalar(1.8 + pulse * 0.8);
      p.glow.material.rotation = t * 0.4 + p.phase;
      p.lid.rotation.x = -0.6 - pulse * 0.25;
      const wp = p.pearl.getWorldPosition(tmpP);
      const d = wp.distanceTo(player.pos);
      if (d < 2.4) {
        p.taken = true; p.pearl.visible = false; p.glow.visible = false;
        game.score++;
        game.o2 = Math.min(100, game.o2 + 10);
        for (let i = 0; i < 24; i++) spawnBubble(wp.x + rr(-0.4, 0.4), wp.y + rr(0, 0.4), wp.z + rr(-0.4, 0.4), rr(0.04, 0.12));
        toast(game.score === pearls.length ? 'Last pearl!' : `Pearl ${game.score} of ${pearls.length} · +10 O₂`);
        if (game.score === pearls.length) setTimeout(() => endGame(true), 900);
      } else if (d < nd) { nd = d; nearest = wp.clone(); }
    } else {
      p.lid.rotation.x = lerp(p.lid.rotation.x, 0, Math.min(1, dt * 3));
    }
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
  surfaceMat.uniforms.uUnder.value.set(PAL.teal).lerp(_c.set(PAL.deep), k * 0.8);
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
window.blueHollow = { scene, camera, player, game, terrainHeight };
