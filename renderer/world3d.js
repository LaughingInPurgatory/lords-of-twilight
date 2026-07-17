/* Low-poly WebGL view for Lords of Twilight.
   Same tile grid + 8-way facing as the 2D panorama; only the view changes. */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const EYE = 1.15;
const FOG_NEAR = 14;
const FOG_FAR = 48;

const H = {
  plains: 0.02, downs: 0.18, hills: 0.55, forest: 0.08, mountains: 2.05,
  wasteland: 0.04, keep: 0.06, citadel: 0.08, village: 0.05, tower: 0.06, rift: -1.85,
};

/* mountain peak snow blend only — tile albedos come from textures + baseColor() */
const SNOW = [0.85, 0.88, 0.92];

function hash(x, y, i) {
  let s = (x * 374761393 + y * 668265263 + i * 2246822519) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 1274126177) >>> 0;
  return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
}

function terrainH(t) { return H[t] != null ? H[t] : 0.02; }

/* Vertex tint multiplies the albedo map — keep near-white so textures read clearly */
function baseColor(tile) {
  if (tile.corrupt && tile.t !== 'rift') return [0.55, 0.32, 0.72];
  switch (tile.t) {
    case 'forest': return [0.72, 0.88, 0.68];
    case 'downs': return [1.0, 0.98, 0.88];
    case 'hills': return [0.92, 0.90, 0.85];
    case 'mountains': return [0.88, 0.88, 0.92];
    case 'wasteland': return [0.65, 0.55, 0.70];
    case 'rift': return [0.45, 0.30, 0.60];
    case 'plains': return [0.98, 1.0, 0.92];
    default: return [0.95, 0.93, 0.88];
  }
}

function surfaceKind(t) {
  if (t === 'mountains' || t === 'hills') return 'rock';
  if (t === 'wasteland' || t === 'rift') return 'ground';
  return 'grass';
}

const UV_SCALE = 0.42;

/* Must match game.js DIRS: face increases on left turn (0=N,1=NW,2=W…6=E,7=NE).
   World X = map X (east), world Z = map Y (south). */
const FACE_DIRS = [
  { dx: 0, dy: -1 },  { dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },   { dx: 1, dy: 1 },  { dx: 1, dy: 0 },  { dx: 1, dy: -1 },
];

/** Procedural fire sprite: tall teardrop, hot core → red → purple, soft alpha. */
function makeFireSpriteTexture(kind) {
  /* kind: 'core' | 'mid' | 'outer' — different colour bias */
  const w = 64, h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5;          /* -0.5..0.5 */
      const v = 1 - (y + 0.5) / h;            /* 0 base → 1 tip */
      /* flame outline: wide base, taper, noise edges */
      const edge = 0.42 * (1 - v * 0.92) * (0.75 + 0.35 * Math.sin(v * 18 + u * 9));
      const dist = Math.abs(u) / Math.max(0.02, edge);
      let a = 1 - dist;
      a *= Math.pow(Math.max(0, 1 - v * 0.98), 0.55); /* fade at tip */
      a *= 0.85 + 0.15 * Math.sin(x * 0.8 + y * 0.35);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = Math.pow(a, 1.15);
      /* heat colour: base white-yellow → orange-red → purple */
      let r, g, b;
      if (kind === 'core') {
        r = 255; g = 220 - v * 80; b = 120 - v * 40;
      } else if (kind === 'mid') {
        r = 255; g = 60 + (1 - v) * 40; b = 40 + v * 80;
      } else {
        r = 180 + (1 - v) * 60; g = 20 + v * 30; b = 200 - v * 40;
      }
      /* mix purple into tips of all kinds */
      const tip = Math.pow(v, 1.4);
      r = r * (1 - tip * 0.45) + 160 * tip;
      g = g * (1 - tip * 0.7) + 20 * tip;
      b = b * (1 - tip * 0.2) + 255 * tip;
      const i = (y * w + x) * 4;
      img.data[i] = r | 0;
      img.data[i + 1] = g | 0;
      img.data[i + 2] = b | 0;
      img.data[i + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let _fireTex = null;
function getFireTextures() {
  if (!_fireTex) {
    _fireTex = {
      core: makeFireSpriteTexture('core'),
      mid: makeFireSpriteTexture('mid'),
      outer: makeFireSpriteTexture('outer'),
    };
  }
  return _fireTex;
}

/**
 * Soft-edge oily stain: ambientCG Asphalt006 (CC0) with radial alpha falloff.
 * @param {HTMLImageElement|THREE.Texture} src
 */
function makeSoftOilyStainTex(src) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imgEl = src && src.isTexture ? src.image : src;
  if (imgEl) {
    /* tile the photo texture */
    try {
      const pat = ctx.createPattern(imgEl, 'repeat');
      if (pat) {
        /* scale pattern ~2× so grain is visible on large decal */
        const m = new DOMMatrix();
        m.a = 2; m.d = 2;
        pat.setTransform(m);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, size, size);
      } else {
        ctx.drawImage(imgEl, 0, 0, size, size);
      }
    } catch (_) {
      ctx.drawImage(imgEl, 0, 0, size, size);
    }
  } else {
    ctx.fillStyle = '#0a080c';
    ctx.fillRect(0, 0, size, size);
  }
  /* darken to oily black */
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(20,4,28,0.22)';
  ctx.fillRect(0, 0, size, size);
  /* soft blended edge */
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.49);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** @param {HTMLElement} host */
export function createLot3D(host, width, height) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 2));
  renderer.setClearColor(0x0b0a12, 1);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = 'auto';
  /* sun-driven landscape shadows */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb6c8d8, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(62, width / height, 0.08, 96);

  const amb = new THREE.AmbientLight(0xc8d4f0, 0.55);
  scene.add(amb);
  const sunLight = new THREE.DirectionalLight(0xfff2d8, 0.9);
  sunLight.position.set(12, 22, 6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.035;
  sunLight.shadow.radius = 2.5;
  const shCam = sunLight.shadow.camera;
  shCam.near = 2;
  shCam.far = 90;
  const SHADOW_EXT = 24; /* half-extent of ground covered around the focus */
  shCam.left = -SHADOW_EXT;
  shCam.right = SHADOW_EXT;
  shCam.top = SHADOW_EXT;
  shCam.bottom = -SHADOW_EXT;
  shCam.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);
  const hemi = new THREE.HemisphereLight(0x9ec8ff, 0x3a4a28, 0.35);
  scene.add(hemi);

  /* Procedural sky dome: moving clouds, sun disc, day cycle, rift taint */
  const skyUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2).normalize() },
    uZenith: { value: new THREE.Color(0.25, 0.45, 0.85) },
    uHorizon: { value: new THREE.Color(0.65, 0.75, 0.9) },
    uCloudColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
    uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
    uTaint: { value: 0 },
    uNight: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uCloudColor;
      uniform vec3 uSunColor;
      uniform float uTaint;
      uniform float uNight;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = m * p;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y; /* -1..1 */

        /* sky gradient */
        float elev = clamp(h * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(elev, 0.85));

        /* atmospheric glow near horizon opposite/around sun */
        float sunDot = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
        col += uSunColor * pow(sunDot, 12.0) * 0.35 * (1.0 - uNight * 0.7);
        col += uSunColor * pow(sunDot, 80.0) * 0.9 * (1.0 - uNight);

        /* sun disc */
        float sunAng = acos(clamp(dot(d, normalize(uSunDir)), -1.0, 1.0));
        float disc = smoothstep(0.045, 0.02, sunAng);
        float glow = smoothstep(0.22, 0.04, sunAng);
        col += uSunColor * disc * 1.4 * (1.0 - uNight);
        col += uSunColor * glow * 0.35 * (1.0 - uNight * 0.5);

        /* parallax-ish cloud layers (slow drift) */
        float cloudMask = smoothstep(-0.05, 0.35, h);
        vec2 uv1 = d.xz / max(0.15, h + 0.35);
        uv1 += uTime * vec2(0.007, 0.0035);
        float c1 = fbm(uv1 * 2.4 + 1.7);
        float c2 = fbm(uv1 * 4.1 - uTime * vec2(0.004, -0.002) + 9.0);
        float clouds = smoothstep(0.42, 0.78, c1 * 0.65 + c2 * 0.45);
        clouds *= cloudMask * (1.0 - disc * 0.85);

        /* lit cloud undersides toward sun */
        float cloudLit = mix(0.55, 1.15, pow(sunDot, 2.0));
        vec3 cloudCol = uCloudColor * cloudLit;
        cloudCol = mix(cloudCol, uSunColor * 1.1, glow * 0.35 * (1.0 - uNight));
        col = mix(col, cloudCol, clouds * mix(0.75, 0.45, uNight));

        /* stars at night (hash speckles) */
        if (uNight > 0.2 && h > 0.05) {
          float star = step(0.997, hash(floor(d.xy * 180.0) + floor(d.z * 180.0)));
          col += vec3(0.85, 0.9, 1.0) * star * (uNight - 0.2) * 1.2 * (1.0 - clouds);
        }

        /* Abyssal rift taint — purple-violet cast, thicker near horizon */
        if (uTaint > 0.001) {
          vec3 blight = vec3(0.35, 0.08, 0.48);
          float veil = uTaint * (0.35 + 0.55 * (1.0 - elev));
          col = mix(col, mix(col, blight, 0.75), veil);
          col += vec3(0.18, 0.02, 0.22) * uTaint * clouds * 0.4;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 24), skyMat);
  scene.add(sky);

  /* soft sun billboard for bloom-ish disc above the shader */
  const sunSprite = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false,
    }),
  );
  sunSprite.renderOrder = -1;
  scene.add(sunSprite);

  const root = new THREE.Group();
  scene.add(root);
  const markers = new THREE.Group();
  scene.add(markers);

  /* Abyssal horde kit — dark pack, slight purple emissive */
  const hordeBodyGeo = new THREE.BoxGeometry(0.11, 0.26, 0.1);
  const hordeHeadGeo = new THREE.SphereGeometry(0.055, 6, 5);
  const hordeHornGeo = new THREE.ConeGeometry(0.018, 0.1, 4);
  const hordeClawGeo = new THREE.ConeGeometry(0.02, 0.09, 3);
  const hordeEyeGeo = new THREE.SphereGeometry(0.012, 4, 4);
  const hordeStainGeo = new THREE.CircleGeometry(0.38, 10);
  const hordeMoteGeo = new THREE.SphereGeometry(0.04, 6, 6);
  const hordeBodyMat = new THREE.MeshLambertMaterial({
    color: 0x0a0612,
    emissive: 0x5a18a0,
    emissiveIntensity: 0.28,
  });
  const hordeHeadMat = new THREE.MeshLambertMaterial({
    color: 0x12081c,
    emissive: 0x6a20b8,
    emissiveIntensity: 0.35,
  });
  const hordeHornMat = new THREE.MeshLambertMaterial({
    color: 0x1a0a22,
    emissive: 0x3a1060,
    emissiveIntensity: 0.2,
  });
  const hordeEyeMat = new THREE.MeshBasicMaterial({ color: 0xd060ff });
  const hordeStainMat = new THREE.MeshBasicMaterial({
    color: 0x1a0820,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const hordeMoteMat = new THREE.MeshBasicMaterial({
    color: 0xc060ff,
    transparent: true,
    opacity: 0.5,
  });
  const bannerGeo = new THREE.BoxGeometry(0.08, 0.55, 0.08);
  const bannerMat = new THREE.MeshLambertMaterial({ color: 0xffd24a });
  const flagGeo = new THREE.BoxGeometry(0.28, 0.16, 0.04);
  const flagMat = new THREE.MeshLambertMaterial({ color: 0xe8c040 });

  let mapW = 0, mapH = 0;
  const terrainGroup = new THREE.Group();
  scene.add(terrainGroup);
  let riftLight = null;
  let builtFor = null;
  let pendingWorld = null;

  /* ambientCG CC0 maps — see renderer/textures/CREDITS.txt */
  const maps = { grass: null, ground: null, rock: null, castle: null, house: null, oil: null, oilStain: null };
  const texLoader = new THREE.TextureLoader();
  function mapsReady() {
    return maps.grass && maps.ground && maps.rock && maps.castle && maps.house;
  }
  function prepTex(t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  }
  function loadMap(key, file) {
    texLoader.load(
      'textures/' + file,
      tex => {
        maps[key] = prepTex(tex);
        if (key === 'oil') {
          maps.oilStain = makeSoftOilyStainTex(tex);
          /* rebuild if world already exists so stain picks up the photo map */
          if (builtFor) {
            const w = builtFor, mw = mapW, mh = mapH;
            builtFor = null;
            rebuild(w, mw, mh);
          }
        }
        if (mapsReady() && pendingWorld) {
          const w = pendingWorld;
          pendingWorld = null;
          builtFor = null;
          rebuild(w.world, w.mw, w.mh);
        }
      },
      undefined,
      err => console.warn('texture load failed:', file, err),
    );
  }
  loadMap('grass', 'grass.jpg');
  loadMap('ground', 'ground.jpg');
  loadMap('rock', 'rock.jpg');
  loadMap('castle', 'castle.jpg');
  loadMap('house', 'house.jpg');
  loadMap('oil', 'oil.jpg');

  /* free twisted crystal spire (CC0 procedural OBJ in models/) */
  let crystalSpireTemplate = null;
  const spireMat = new THREE.MeshStandardMaterial({
    color: 0x030308,
    metalness: 0.92,
    roughness: 0.18,
    emissive: 0x1a0840,
    emissiveIntensity: 0.35,
  });
  new OBJLoader().load(
    'models/crystal_spire.obj',
    obj => {
      obj.traverse(c => {
        if (c.isMesh) {
          c.material = spireMat;
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      crystalSpireTemplate = obj;
      if (builtFor) {
        const w = builtFor, mw = mapW, mh = mapH;
        builtFor = null;
        rebuild(w, mw, mh);
      }
    },
    undefined,
    err => console.warn('crystal spire load failed', err),
  );

  function disposeTerrain() {
    terrainGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      /* materials share textures — only dispose material, not maps */
      if (obj.material) obj.material.dispose();
    });
    while (terrainGroup.children.length) terrainGroup.remove(terrainGroup.children[0]);
  }

  /* Multi-texture terrain: blend grass/ground/rock + manual sun-shadow sample.
     (Avoid ShaderMaterial lights:true — it steals texture units from uGrass/uGround/uRock.) */
  const terrainUniforms = {
    uGrass: { value: null },
    uGround: { value: null },
    uRock: { value: null },
    uSunDir: { value: new THREE.Vector3(0.35, 0.85, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
    uAmbColor: { value: new THREE.Color(0.45, 0.48, 0.55) },
    uAmbInt: { value: 0.5 },
    uSunInt: { value: 0.9 },
    uFogColor: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uFogNear: { value: FOG_NEAR },
    uFogFar: { value: FOG_FAR },
    uShadowStrength: { value: 0.55 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uReceiveShadow: { value: 0 },
  };

  function makeTerrainMat() {
    terrainUniforms.uGrass.value = maps.grass;
    terrainUniforms.uGround.value = maps.ground;
    terrainUniforms.uRock.value = maps.rock;
    return new THREE.ShaderMaterial({
      lights: false,
      fog: false, /* fog applied manually to match scene */
      uniforms: terrainUniforms,
      vertexShader: /* glsl */ `
        attribute vec3 blend;
        varying vec3 vColor;
        varying vec3 vBlend;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec4 vShadowCoord;
        uniform mat4 uShadowMatrix;
        void main() {
          vColor = color;
          vBlend = blend;
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vShadowCoord = uShadowMatrix * wp;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform sampler2D uGrass;
        uniform sampler2D uGround;
        uniform sampler2D uRock;
        uniform sampler2D uShadowMap;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uAmbColor;
        uniform float uAmbInt;
        uniform float uSunInt;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform float uShadowStrength;
        uniform float uReceiveShadow;
        varying vec3 vColor;
        varying vec3 vBlend;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        varying vec4 vShadowCoord;

        /* soft 3×3 PCF over the sun's depth map */
        float sampleShadow(vec4 sc) {
          if (uReceiveShadow < 0.5) return 1.0;
          vec3 proj = sc.xyz / sc.w;
          proj = proj * 0.5 + 0.5;
          if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0) return 1.0;
          float bias = 0.0025;
          float shadow = 0.0;
          vec2 texel = vec2(1.0 / 2048.0);
          for (int x = -1; x <= 1; x++) {
            for (int y = -1; y <= 1; y++) {
              float d = texture2D(uShadowMap, proj.xy + vec2(float(x), float(y)) * texel).r;
              shadow += (proj.z - bias > d) ? 0.0 : 1.0;
            }
          }
          return shadow / 9.0;
        }

        void main() {
          /* soft splat — weights already averaged at corners */
          vec3 w = max(vBlend, vec3(0.0));
          float s = w.x + w.y + w.z;
          w = s > 1e-4 ? w / s : vec3(1.0, 0.0, 0.0);

          /* slight UV offset per layer breaks up grid-aligned seams */
          vec3 g = texture2D(uGrass, vUv).rgb;
          vec3 d = texture2D(uGround, vUv * 0.93 + 0.03).rgb;
          vec3 r = texture2D(uRock, vUv * 1.07 - 0.02).rgb;
          vec3 albedo = g * w.x + d * w.y + r * w.z;
          albedo *= vColor;

          vec3 N = normalize(vWorldNormal);
          vec3 L = normalize(uSunDir);
          float ndl = max(dot(N, L), 0.0);
          /* soft wrap lighting so flat shading still reads form */
          float wrap = max(dot(N, L) * 0.5 + 0.5, 0.0);
          float lambert = mix(ndl, wrap, 0.35);

          float sh = sampleShadow(vShadowCoord);
          float shade = mix(1.0 - uShadowStrength, 1.0, sh);

          vec3 amb = uAmbColor * uAmbInt;
          vec3 sun = uSunColor * uSunInt * lambert * shade;
          vec3 bounce = uAmbColor * (0.08 * uSunInt * (1.0 - sh));
          vec3 lit = albedo * (amb + sun + bounce);

          float depth = length(vWorldPos - cameraPosition);
          float fogF = smoothstep(uFogNear, uFogFar, depth);
          lit = mix(lit, uFogColor, fogF);

          gl_FragColor = vec4(lit, 1.0);
        }
      `,
      vertexColors: true,
    });
  }

  /** Blend weights at grid corner (x,y) from up to 4 adjacent tiles — smooth rock/grass/dirt edges */
  function cornerWeights(tiles, x, y, mw, mh) {
    let g = 0, d = 0, r = 0, n = 0;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= mw || ty >= mh) continue;
        const k = surfaceKind(tiles[ty * mw + tx].t);
        if (k === 'grass') g += 1;
        else if (k === 'ground') d += 1;
        else r += 1;
        n++;
      }
    }
    if (!n) return [1, 0, 0];
    /* slight noise so blend lines aren't laser-straight */
    const j = (hash(x, y, 41) - 0.5) * 0.12;
    g = Math.max(0, g / n + j);
    d = Math.max(0, d / n - j * 0.5);
    r = Math.max(0, r / n - j * 0.5);
    const s = g + d + r || 1;
    return [g / s, d / s, r / s];
  }

  function disposeGroup(g) {
    g.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  function sampleH(tiles, x, y, mw, mh) {
    const ix = Math.max(0, Math.min(mw - 1, x | 0));
    const iy = Math.max(0, Math.min(mh - 1, y | 0));
    const t = tiles[iy * mw + ix];
    let h = terrainH(t.t);
    if (t.t === 'mountains') {
      /* ridged multi-octave height — tall peaks so massifs read against low hills */
      const n1 = hash(ix, iy, 3);
      const n2 = hash(ix * 3 + 1, iy * 2 + 2, 7);
      const n3 = hash(ix + iy * 17, iy - ix * 3, 19);
      h = 1.55 + n1 * 1.55 + n2 * 0.95;          /* ~1.55–4.05 base ridges */
      if (n3 > 0.68) h += (n3 - 0.68) * 3.1;     /* occasional sharp summit */
      /* fringe of a mountain mass is lower (foothills) — still above hills */
      let mCount = 0, neigh = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = ix + dx, ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
        neigh++;
        if (tiles[ny * mw + nx].t === 'mountains') mCount++;
      }
      const interior = neigh ? mCount / neigh : 1;
      h *= 0.48 + 0.62 * interior;               /* fringe ~half height, core full */
    } else if (t.t === 'hills') {
      h += hash(ix, iy, 4) * 0.28;               /* stays ~0.55–0.83 — well below peaks */
    }
    return h;
  }

  function cornerH(tiles, x, y, mw, mh) {
    /* blend corners; bias toward max on mountains so summits stay sharp */
    let s = 0, n = 0, mx = 0, mN = 0;
    for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= mw || cy >= mh) continue;
      const sh = sampleH(tiles, cx, cy, mw, mh);
      s += sh; n++;
      if (sh > mx) mx = sh;
      if (tiles[cy * mw + cx].t === 'mountains') mN++;
    }
    if (!n) return 0;
    const avg = s / n;
    if (mN >= 2) return avg * 0.3 + mx * 0.7;
    if (mN === 1) return avg * 0.55 + mx * 0.45;
    return avg;
  }

  function tagTile(mesh, tx, ty) {
    mesh.userData.tile = { x: tx, y: ty };
    return mesh;
  }

  function addBox(parent, w, h, d, x, y, z, color, y0, tx, ty, mapKind) {
    const geo = new THREE.BoxGeometry(w, h, d);
    let mat;
    if (mapKind && maps[mapKind]) {
      /* scale face UVs so bricks/siding tile by building size */
      const uv = geo.attributes.uv;
      const sx = Math.max(0.8, w * 2.4);
      const sy = Math.max(0.8, h * 2.4);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
      uv.needsUpdate = true;
      mat = new THREE.MeshLambertMaterial({ map: maps[mapKind], color: color != null ? color : 0xffffff });
    } else {
      mat = new THREE.MeshLambertMaterial({ color: color != null ? color : 0x888888 });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, (y0 != null ? y0 : 0) + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (tx != null) tagTile(mesh, tx, ty);
    parent.add(mesh);
    return mesh;
  }

  function addCone(parent, r, h, x, y, z, color, seg, tx, ty, mapKind) {
    const mat = mapKind && maps[mapKind]
      ? new THREE.MeshLambertMaterial({ map: maps[mapKind], color: color != null ? color : 0xffffff })
      : new THREE.MeshLambertMaterial({ color: color != null ? color : 0x888888 });
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 6), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (tx != null) tagTile(mesh, tx, ty);
    parent.add(mesh);
    return mesh;
  }

  function rebuild(world, mw, mh) {
    if (!world || !world.tiles) return;
    mapW = mw; mapH = mh;
    builtFor = world;
    if (!mapsReady()) {
      pendingWorld = { world, mw, mh };
    }
    disposeGroup(root);
    disposeTerrain();
    if (riftLight) { scene.remove(riftLight); riftLight = null; }
    for (const nm of ['riftLightRed', 'riftLightMag']) {
      const old = scene.getObjectByName(nm);
      if (old) scene.remove(old);
    }

    const tiles = world.tiles;
    /* single mesh: blend weights at corners so rock/grass/dirt edges soft-merge */
    const pos = [], col = [], uv = [], blend = [];

    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const tile = tiles[y * mw + x];
        const h00 = cornerH(tiles, x, y, mw, mh);
        const h10 = cornerH(tiles, x + 1, y, mw, mh);
        const h01 = cornerH(tiles, x, y + 1, mw, mh);
        const h11 = cornerH(tiles, x + 1, y + 1, mw, mh);
        const w00 = cornerWeights(tiles, x, y, mw, mh);
        const w10 = cornerWeights(tiles, x + 1, y, mw, mh);
        const w01 = cornerWeights(tiles, x, y + 1, mw, mh);
        const w11 = cornerWeights(tiles, x + 1, y + 1, mw, mh);
        const x0 = x, z0 = y, x1 = x + 1, z1 = y + 1;

        /* CCW from +Y — two tris, each corner carries its blend weights */
        const corners = [
          [x0, h00, z0, w00], [x0, h01, z1, w01], [x1, h11, z1, w11],
          [x0, h00, z0, w00], [x1, h11, z1, w11], [x1, h10, z0, w10],
        ];

        for (const [px, py, pz, w] of corners) {
          pos.push(px, py, pz);
          uv.push(px * UV_SCALE, pz * UV_SCALE);
          /* base tint from blend of nearby tiles */
          let c = baseColor(tile);
          const tints = [];
          for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
            const tx = (px | 0) + dx, ty = (pz | 0) + dy;
            if (tx < 0 || ty < 0 || tx >= mw || ty >= mh) continue;
            tints.push(baseColor(tiles[ty * mw + tx]));
          }
          if (tints.length) {
            c = [0, 0, 0];
            for (const t of tints) { c[0] += t[0]; c[1] += t[1]; c[2] += t[2]; }
            c[0] /= tints.length; c[1] /= tints.length; c[2] /= tints.length;
          }
          /* snow only on high rock — by height, not random cones */
          if (py > 2.35 && w[2] > 0.35 && !(tile.corrupt)) {
            const snowAmt = Math.min(1, (py - 2.35) / 1.15) * Math.min(1, w[2] * 1.2);
            c = [
              c[0] + (SNOW[0] - c[0]) * snowAmt,
              c[1] + (SNOW[1] - c[1]) * snowAmt,
              c[2] + (SNOW[2] - c[2]) * snowAmt,
            ];
          }
          col.push(c[0], c[1], c[2]);
          blend.push(w[0], w[1], w[2]);
        }
      }
    }

    if (pos.length && maps.grass && maps.ground && maps.rock) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('blend', new THREE.Float32BufferAttribute(blend, 3));
      geo.computeVertexNormals();
      const tMesh = new THREE.Mesh(geo, makeTerrainMat());
      tMesh.receiveShadow = true;
      tMesh.castShadow = true; /* mountains / hills cast onto low ground */
      tMesh.name = 'terrain';
      terrainGroup.add(tMesh);
    }

    /* props per tile — keep counts low */
    const grassPlacements = []; /* { x, y, z, rot, sx, sy, r, g, b } for InstancedMesh */

    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const tile = tiles[y * mw + x];
        const cx = x + 0.5, cz = y + 0.5;
        const base = sampleH(tiles, x, y, mw, mh);
        const t = tile.t;

        /* scatter low-poly blades on grassy surfaces */
        if ((t === 'plains' || t === 'downs' || t === 'forest') && !tile.corrupt) {
          const density = t === 'forest' ? 3 : t === 'downs' ? 7 : 6;
          for (let i = 0; i < density; i++) {
            if (hash(x, y, 200 + i) < 0.18) continue; /* natural gaps */
            const ox = (hash(x, y, 210 + i) - 0.5) * 0.88;
            const oz = (hash(x, y, 220 + i) - 0.5) * 0.88;
            const tall = 0.11 + hash(x, y, 230 + i) * 0.13; /* world height */
            const fat = 0.28 + hash(x, y, 240 + i) * 0.22;   /* thin blades, not wedges */
            const shade = 0.75 + hash(x, y, 250 + i) * 0.35;
            const gHue = t === 'downs' ? 0.55 : 0.48;
            grassPlacements.push({
              x: cx + ox,
              y: base - 0.005,
              z: cz + oz,
              rot: hash(x, y, 260 + i) * Math.PI * 2,
              lean: (hash(x, y, 270 + i) - 0.5) * 0.22,
              fat, tall,
              r: 0.22 * shade,
              g: gHue * shade,
              b: 0.14 * shade,
            });
          }
        }

        /* bright pad + pin on the exact place tile (aiming reference) */
        if (tile.place) {
          const p = tile.place;
          const ringCol = p.type === 'citadel' ? 0xffe08a
            : p.type === 'keep' ? 0xffd070
            : p.type === 'village' ? 0xe8c070
            : p.type === 'tower' ? 0x9adfe8
            : 0xe8d9a0;
          const done = p.recruited && p.visited;
          const pad = new THREE.Mesh(
            new THREE.CircleGeometry(0.36, 20),
            new THREE.MeshBasicMaterial({
              color: ringCol,
              transparent: true,
              opacity: done ? 0.2 : 0.55,
              depthWrite: false,
            }),
          );
          pad.rotation.x = -Math.PI / 2;
          pad.position.set(cx, base + 0.025, cz);
          tagTile(pad, x, y);
          root.add(pad);
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.36, 0.46, 20),
            new THREE.MeshBasicMaterial({
              color: ringCol,
              transparent: true,
              opacity: done ? 0.3 : 0.95,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(cx, base + 0.04, cz);
          tagTile(ring, x, y);
          root.add(ring);
        }

        if (t === 'forest') {
          const n = 2 + (hash(x, y, 1) * 2 | 0);
          for (let i = 0; i < n; i++) {
            const ox = (hash(x, y, 10 + i) - 0.5) * 0.7;
            const oz = (hash(x, y, 20 + i) - 0.5) * 0.7;
            const hh = 0.55 + hash(x, y, 30 + i) * 0.45;
            const green = hash(x, y, 40 + i) > 0.35 ? 0x1e5a28 : 0x2a6a30;
            addCone(root, 0.18 + hash(x, y, 50 + i) * 0.08, hh, cx + ox, base, cz + oz, green, 6, x, y);
            addBox(root, 0.05, 0.12, 0.05, cx + ox, base, cz + oz, 0x3a2818, base, x, y);
          }
        } else if (t === 'keep' || t === 'citadel') {
          /* compact footprint so the mesh sits on its tile, not spilling into neighbors */
          const big = t === 'citadel';
          const bw = big ? 0.42 : 0.34;
          const bh = big ? 0.72 : 0.52;
          const tint = big ? 0xe8d9a0 : 0xd0c8b0;
          addBox(root, bw, bh, bw, cx, base, cz, tint, base, x, y, 'castle');
          const tw = big ? 0.12 : 0.1, th = bh + 0.18;
          for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            addBox(root, tw, th, tw, cx + ox * bw * 0.42, base, cz + oz * bw * 0.42, tint, base, x, y, 'castle');
          }
          if (big) {
            addBox(root, 0.14, bh + 0.28, 0.14, cx, base, cz, 0xffe8b0, base, x, y, 'castle');
            /* Cardinal ground marks at citadel: N white, E gold, W blue — prove map axes */
            const marks = [
              { dx: 0, dz: -1.6, c: 0xffffff }, /* north −Z */
              { dx: 1.6, dz: 0, c: 0xffcc33 },  /* east  +X (Rift) */
              { dx: -1.6, dz: 0, c: 0x4488ff }, /* west  −X */
            ];
            for (const m of marks) {
              const bar = new THREE.Mesh(
                new THREE.BoxGeometry(m.dz ? 0.2 : 1.2, 0.12, m.dx ? 0.2 : 1.2),
                new THREE.MeshBasicMaterial({ color: m.c }),
              );
              bar.position.set(cx + m.dx, base + 0.08, cz + m.dz);
              root.add(bar);
            }
          }
        } else if (t === 'village') {
          for (let i = 0; i < 3; i++) {
            const ox = (hash(x, y, 60 + i) - 0.5) * 0.35;
            const oz = (hash(x, y, 70 + i) - 0.5) * 0.35;
            const hh = 0.2 + hash(x, y, 80 + i) * 0.1;
            addBox(root, 0.18, hh, 0.16, cx + ox, base, cz + oz, 0xf0e0c8, base, x, y, 'house');
            addCone(root, 0.13, 0.1, cx + ox, base + hh, cz + oz, 0x6a3030, 4, x, y);
          }
        } else if (t === 'tower') {
          addBox(root, 0.2, 0.95, 0.2, cx, base, cz, 0xc8d0d8, base, x, y, 'castle');
          addBox(root, 0.28, 0.1, 0.28, cx, base + 0.95, cz, 0xb0b8c0, base + 0.95, x, y, 'castle');
        } else if (t === 'rift') {
          /* ═══ THE ABYSSAL RIFT — multi-tier chasm, crystal shards, firestorm ═══ */
          const chasm = new THREE.Group();
          chasm.position.set(cx, 0, cz);
          chasm.name = 'riftChasm';
          tagTile(chasm, x, y);
          const by = base;

          const addGlowMat = (color, opacity) => new THREE.MeshBasicMaterial({
            color, transparent: true, opacity,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
          });
          const fireTex = getFireTextures();
          /** Crossed billboard fire tongue — looks like real flames, not purple blobs */
          const addFire = (parent, w, h, kind, px, py, pz, ph) => {
            w *= 2; h *= 2; /* double flame scale */
            const tex = fireTex[kind] || fireTex.mid;
            const mat = new THREE.MeshBasicMaterial({
              map: tex,
              transparent: true,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              side: THREE.DoubleSide,
            });
            const g = new THREE.Group();
            g.position.set(px, py, pz);
            g.name = 'riftFlame';
            g.userData.ph = ph;
            g.userData.baseY = py;
            g.userData.baseH = h;
            g.userData.baseW = w;
            g.userData.baseX = px;
            g.userData.baseZ = pz;
            /* two crossed planes = volume from any angle */
            for (let k = 0; k < 2; k++) {
              const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
              plane.position.y = h * 0.5;
              plane.rotation.y = k * Math.PI * 0.5 + ph * 0.1;
              g.add(plane);
            }
            parent.add(g);
            return g;
          };

          /* black oily stain — ambientCG Asphalt006 (CC0) with soft radial edge */
          const stainMap = maps.oilStain || (maps.oil ? makeSoftOilyStainTex(maps.oil) : null);
          if (stainMap && !maps.oilStain) maps.oilStain = stainMap;
          const oilyMat = new THREE.MeshBasicMaterial({
            map: stainMap || null,
            color: stainMap ? 0xffffff : 0x0a080c,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const oilyBig = new THREE.Mesh(new THREE.CircleGeometry(3.6, 40), oilyMat);
          oilyBig.rotation.x = -Math.PI / 2;
          oilyBig.position.y = by + 0.012;
          oilyBig.renderOrder = 1;
          chasm.add(oilyBig);
          /* denser inner slick */
          const oilyIn = new THREE.Mesh(
            new THREE.CircleGeometry(1.7, 32),
            new THREE.MeshBasicMaterial({
              map: stainMap || null,
              color: stainMap ? 0xddd0e8 : 0x0a080c,
              transparent: true,
              opacity: 0.9,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          oilyIn.rotation.x = -Math.PI / 2;
          oilyIn.position.y = by + 0.014;
          oilyIn.renderOrder = 2;
          chasm.add(oilyIn);

          /* scorched ground ring + outer cracks (on top of oil) */
          const scorched = new THREE.Mesh(
            new THREE.RingGeometry(0.7, 1.55, 28),
            new THREE.MeshLambertMaterial({
              color: 0x120818, emissive: 0x3a1055, emissiveIntensity: 0.4,
              side: THREE.DoubleSide, transparent: true, opacity: 0.75,
            }),
          );
          scorched.rotation.x = -Math.PI / 2;
          scorched.position.y = by + 0.016;
          chasm.add(scorched);

          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + hash(x, y, 40 + i);
            const len = 0.5 + hash(x, y, 50 + i) * 0.9;
            const crack = new THREE.Mesh(
              new THREE.BoxGeometry(0.06, 0.04, len),
              new THREE.MeshBasicMaterial({ color: 0x9010c0, transparent: true, opacity: 0.55 }),
            );
            crack.position.set(Math.cos(a) * (0.85 + len * 0.35), by + 0.03, Math.sin(a) * (0.85 + len * 0.35));
            crack.rotation.y = a;
            crack.name = 'riftCrack';
            crack.userData.ph = a;
            chasm.add(crack);
          }

          /* multi-layer jagged rim — broken earth + leaning slabs */
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2 + 0.15;
            const rr = 0.72 + hash(x, y, 80 + i) * 0.28;
            const rw = 0.18 + hash(x, y, 90 + i) * 0.16;
            const rh = 0.18 + hash(x, y, 100 + i) * 0.35;
            const rock = new THREE.Mesh(
              new THREE.BoxGeometry(rw, rh, rw * 0.65),
              new THREE.MeshLambertMaterial({
                color: 0x140a1c, emissive: 0x4a1480, emissiveIntensity: 0.25 + hash(x, y, 105 + i) * 0.2,
              }),
            );
            rock.position.set(Math.cos(a) * rr, by + rh * 0.4, Math.sin(a) * rr);
            rock.rotation.y = a + hash(x, y, 108 + i);
            rock.rotation.z = (hash(x, y, 110 + i) - 0.5) * 0.7;
            rock.rotation.x = (hash(x, y, 111 + i) - 0.5) * 0.35;
            chasm.add(rock);
          }

          /* floating debris orbiting the mouth */
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const deb = new THREE.Mesh(
              new THREE.TetrahedronGeometry(0.08 + hash(x, y, 200 + i) * 0.08, 0),
              new THREE.MeshLambertMaterial({
                color: 0x1a0a22, emissive: 0x7010a0, emissiveIntensity: 0.45,
              }),
            );
            deb.position.set(Math.cos(a) * 0.95, by + 0.35 + hash(x, y, 210 + i) * 0.4, Math.sin(a) * 0.95);
            deb.name = 'riftDebris';
            deb.userData.ph = a;
            deb.userData.rad = 0.85 + hash(x, y, 220 + i) * 0.35;
            deb.userData.baseY = deb.position.y;
            chasm.add(deb);
          }

          /* crystal obelisk shards around the rim */
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + 0.4;
            const sh = 0.7 + hash(x, y, 230 + i) * 1.1;
            const shard = new THREE.Mesh(
              new THREE.ConeGeometry(0.07, 1, 5),
              new THREE.MeshLambertMaterial({
                color: 0x2a0840, emissive: 0xc040ff, emissiveIntensity: 0.7, transparent: true, opacity: 0.92,
              }),
            );
            shard.position.set(Math.cos(a) * 1.05, by + sh * 0.45, Math.sin(a) * 1.05);
            shard.scale.set(1, sh, 1);
            shard.rotation.z = (hash(x, y, 240 + i) - 0.5) * 0.5;
            shard.rotation.x = (hash(x, y, 241 + i) - 0.5) * 0.35;
            shard.name = 'riftShard';
            shard.userData.ph = a;
            shard.userData.baseY = shard.position.y;
            chasm.add(shard);
          }

          /* ── pit: three telescoping throats ── */
          const tiers = [
            { r0: 0.78, r1: 0.45, h: 0.9, y: by - 0.35, em: 0x2a0860, emI: 0.45 },
            { r0: 0.42, r1: 0.22, h: 1.1, y: by - 1.05, em: 0x5010a0, emI: 0.65 },
            { r0: 0.2, r1: 0.06, h: 1.0, y: by - 1.85, em: 0x9010ff, emI: 0.9 },
          ];
          for (const t of tiers) {
            const wall = new THREE.Mesh(
              new THREE.CylinderGeometry(t.r0, t.r1, t.h, 14, 1, true),
              new THREE.MeshLambertMaterial({
                color: 0x06020c, emissive: t.em, emissiveIntensity: t.emI, side: THREE.DoubleSide,
              }),
            );
            wall.position.y = t.y;
            chasm.add(wall);
          }

          /* abyss floor — searing core */
          const core = new THREE.Mesh(
            new THREE.CircleGeometry(0.22, 16),
            new THREE.MeshBasicMaterial({ color: 0xff40e0, transparent: true, opacity: 1 }),
          );
          core.rotation.x = -Math.PI / 2;
          core.position.y = by - 2.35;
          core.name = 'riftGlowCore';
          chasm.add(core);

          const coreHalo = new THREE.Mesh(
            new THREE.CircleGeometry(0.55, 18),
            addGlowMat(0xc020ff, 0.65),
          );
          coreHalo.rotation.x = -Math.PI / 2;
          coreHalo.position.y = by - 2.3;
          coreHalo.name = 'riftGlowHalo';
          chasm.add(coreHalo);

          /* stacked mouth glow rings */
          const rings = [
            { r0: 0.2, r1: 0.95, y: by + 0.02, c: 0xb030ff, o: 0.7 },
            { r0: 0.5, r1: 1.25, y: by + 0.04, c: 0xff2080, o: 0.35 },
            { r0: 0.15, r1: 0.55, y: by - 0.15, c: 0xff60ff, o: 0.5 },
          ];
          rings.forEach((r, i) => {
            const ring = new THREE.Mesh(new THREE.RingGeometry(r.r0, r.r1, 28), addGlowMat(r.c, r.o));
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = r.y;
            ring.name = 'riftMouthGlow';
            ring.userData.ph = i * 1.7;
            chasm.add(ring);
          });

          /* deep black semi-opaque smoke/void streak rising from the mouth */
          const smokeMat = new THREE.MeshBasicMaterial({
            color: 0x030108,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          for (let s = 0; s < 4; s++) {
            const plane = new THREE.Mesh(
              new THREE.PlaneGeometry(0.55 + s * 0.12, 4.2 + s * 0.35),
              smokeMat.clone(),
            );
            plane.material.opacity = 0.42 + s * 0.06;
            plane.position.set(
              (hash(x, y, 500 + s) - 0.5) * 0.2,
              by + 2.0 + s * 0.15,
              (hash(x, y, 510 + s) - 0.5) * 0.2,
            );
            plane.rotation.y = (s / 4) * Math.PI * 0.5 + 0.2;
            plane.name = 'riftSmoke';
            plane.userData.ph = s * 1.3;
            plane.userData.baseY = plane.position.y;
            plane.userData.baseOp = plane.material.opacity;
            chasm.add(plane);
          }
          /* soft cylindrical void core (reads as a thick black plume from any angle) */
          const voidCore = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.38, 3.8, 10, 1, true),
            new THREE.MeshBasicMaterial({
              color: 0x000000,
              transparent: true,
              opacity: 0.48,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          voidCore.position.y = by + 1.9;
          voidCore.name = 'riftSmoke';
          voidCore.userData.ph = 0.7;
          voidCore.userData.baseY = voidCore.position.y;
          voidCore.userData.baseOp = 0.48;
          chasm.add(voidCore);

          /* ── proper purple/red firestorm (sprite billboards, not cones) ── */
          /* outer ring of licking flames */
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2 + hash(x, y, 120 + i) * 0.35;
            const rad = 0.28 + hash(x, y, 130 + i) * 0.55;
            const fh = 0.9 + hash(x, y, 140 + i) * 1.1;
            const fw = 0.35 + hash(x, y, 150 + i) * 0.25;
            const kind = hash(x, y, 155 + i) > 0.55 ? 'outer' : 'mid';
            addFire(chasm, fw, fh, kind,
              Math.cos(a) * rad, by + 0.05, Math.sin(a) * rad,
              hash(x, y, 160 + i) * Math.PI * 2);
          }
          /* inner roar — hotter red cores */
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + 0.25;
            const rad = 0.08 + hash(x, y, 300 + i) * 0.22;
            addFire(chasm, 0.45 + hash(x, y, 305 + i) * 0.2, 1.5 + hash(x, y, 310 + i) * 0.8,
              i % 2 ? 'core' : 'mid',
              Math.cos(a) * rad, by + 0.02, Math.sin(a) * rad, i * 0.85);
          }
          /* towering central column — layered core/mid/outer */
          addFire(chasm, 0.85, 2.8, 'core', 0, by, 0, 0.15);
          addFire(chasm, 1.05, 3.2, 'mid', 0.04, by + 0.1, -0.03, 1.0);
          addFire(chasm, 1.25, 3.6, 'outer', -0.05, by + 0.05, 0.04, 2.1);
          addFire(chasm, 0.7, 4.0, 'mid', 0.02, by + 0.15, 0.02, 3.2);

          /* rising sparks / embers (small bright flecks) */
          for (let i = 0; i < 28; i++) {
            const a = hash(x, y, 400 + i) * Math.PI * 2;
            const rad = hash(x, y, 410 + i) * 0.65;
            const spark = new THREE.Mesh(
              new THREE.SphereGeometry(0.02 + hash(x, y, 420 + i) * 0.025, 5, 5),
              addGlowMat(hash(x, y, 430 + i) > 0.45 ? 0xffaa44 : 0xff40a0, 0.95),
            );
            spark.position.set(Math.cos(a) * rad, by + 0.15, Math.sin(a) * rad);
            spark.name = 'riftSpark';
            spark.userData.ph = hash(x, y, 440 + i) * Math.PI * 2;
            spark.userData.rad = rad;
            spark.userData.spin = 0.4 + hash(x, y, 450 + i) * 0.8;
            spark.userData.speed = 0.35 + hash(x, y, 460 + i) * 0.7;
            chasm.add(spark);
          }

          /* dark energy tendrils (tall lean cones) */
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.5;
            const tend = new THREE.Mesh(
              new THREE.ConeGeometry(0.06, 1.8, 5, 1, true),
              new THREE.MeshBasicMaterial({
                color: 0x200840, transparent: true, opacity: 0.55,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
              }),
            );
            tend.position.set(Math.cos(a) * 0.55, by + 0.9, Math.sin(a) * 0.55);
            tend.rotation.z = Math.cos(a) * 0.6;
            tend.rotation.x = Math.sin(a) * 0.6;
            tend.name = 'riftTendril';
            tend.userData.ph = a;
            tend.userData.baseY = tend.position.y;
            chasm.add(tend);
          }

          /* lightning-ish arcs (thin rotating slabs) */
          for (let i = 0; i < 5; i++) {
            const arc = new THREE.Mesh(
              new THREE.BoxGeometry(0.03, 0.8 + i * 0.15, 0.03),
              addGlowMat(0xff80ff, 0.75),
            );
            arc.position.set(0, by + 0.6 + i * 0.2, 0);
            arc.name = 'riftArc';
            arc.userData.ph = i * 1.2;
            arc.userData.baseY = arc.position.y;
            chasm.add(arc);
          }

          /* jet-black twisted crystal spire (free CC0 model: models/crystal_spire.obj) */
          if (crystalSpireTemplate) {
            const spire = crystalSpireTemplate.clone(true);
            spire.traverse(c => {
              if (c.isMesh) {
                c.material = spireMat.clone();
                c.material.emissiveIntensity = 0.4;
              }
            });
            spire.position.set(0, by - 0.15, 0);
            spire.scale.setScalar(0.95);
            spire.name = 'riftSpire';
            spire.userData.baseY = by - 0.15;
            chasm.add(spire);
          } else {
            /* lightweight fallback until OBJ loads */
            for (let i = 0; i < 8; i++) {
              const t0 = i / 7;
              const sp = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.35 * (1 - t0 * 0.85), 0),
                spireMat,
              );
              sp.position.y = by + t0 * 3.5;
              sp.rotation.y = t0 * Math.PI * 2.5;
              sp.scale.set(1, 1.4, 0.75);
              sp.name = 'riftSpire';
              chasm.add(sp);
            }
          }

          root.add(chasm);

          /* multi-point lighting — purple storm + red underglow + magenta flare */
          riftLight = new THREE.PointLight(0xd050ff, 4.5, 22, 1.6);
          riftLight.position.set(cx, by + 1.2, cz);
          scene.add(riftLight);
          const riftLight2 = new THREE.PointLight(0xff2060, 2.8, 14, 1.8);
          riftLight2.position.set(cx, by - 0.5, cz);
          riftLight2.name = 'riftLightRed';
          scene.add(riftLight2);
          const riftLight3 = new THREE.PointLight(0xff40c0, 2.0, 12, 2);
          riftLight3.position.set(cx + 0.4, by + 2.2, cz - 0.3);
          riftLight3.name = 'riftLightMag';
          scene.add(riftLight3);
          chasm.userData.redLight = riftLight2;
          chasm.userData.magLight = riftLight3;
        } else if (t === 'wasteland' && hash(x, y, 15) > 0.6) {
          addBox(root, 0.15, 0.2 + hash(x, y, 16) * 0.25, 0.12,
            cx + (hash(x, y, 17) - 0.5) * 0.4, base, cz + (hash(x, y, 18) - 0.5) * 0.4,
            0x2a1830, base, x, y);
        }
      }
    }

    /* instanced grass blades — tall thin strips (not wide triangles) */
    if (grassPlacements.length) {
      const bladeGeo = new THREE.BufferGeometry();
      /* base slightly wider than tip so it reads as a blade, still very slim */
      const b0 = 0.014, b1 = 0.004, bh = 1;
      bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        /* face A */
        -b0, 0, 0,   b0, 0, 0,   0, bh, 0,
        /* face B (crossed) */
        0, 0, -b0,   0, 0, b0,   0, bh, 0,
        /* mid ribs for a little volume without fat wedges */
        -b1, bh * 0.45, 0,  b1, bh * 0.45, 0,  0, bh, 0,
        0, bh * 0.45, -b1,  0, bh * 0.45, b1,  0, bh, 0,
      ], 3));
      bladeGeo.computeVertexNormals();
      const bladeMat = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const grassMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, grassPlacements.length);
      grassMesh.frustumCulled = true;
      grassMesh.name = 'grassBlades';
      grassMesh.castShadow = false; /* too many blades — receive only for performance */
      grassMesh.receiveShadow = true;
      const dummy = new THREE.Object3D();
      const c = new THREE.Color();
      for (let i = 0; i < grassPlacements.length; i++) {
        const g = grassPlacements[i];
        dummy.position.set(g.x, g.y, g.z);
        dummy.rotation.set(g.lean, g.rot, g.lean * 0.4);
        dummy.scale.set(g.fat, g.tall, g.fat);
        dummy.updateMatrix();
        grassMesh.setMatrixAt(i, dummy.matrix);
        c.setRGB(g.r, g.g, g.b);
        grassMesh.setColorAt(i, c);
      }
      grassMesh.instanceMatrix.needsUpdate = true;
      if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
      root.add(grassMesh);
    }
  }

  function ensureBuilt(world, mw, mh) {
    if (builtFor !== world || mapW !== mw || mapH !== mh) rebuild(world, mw, mh);
  }

  function refreshCorruption(world, mw, mh) {
    /* night growth is rare — full rebuild keeps multi-surface colors/maps in sync */
    if (!world) return;
    builtFor = null;
    rebuild(world, mw, mh);
  }

  function clearMarkers() {
    /* shared geos/mats — only detach meshes, do not dispose */
    while (markers.children.length) markers.remove(markers.children[0]);
  }

  function spawnHordeFigure(parent, ox, oz, scale, bob, facing) {
    const fig = new THREE.Group();
    fig.position.set(ox, bob, oz);
    fig.rotation.y = facing;
    fig.scale.setScalar(scale);

    const body = new THREE.Mesh(hordeBodyGeo, hordeBodyMat);
    body.position.y = 0.14;
    body.scale.set(1, 1.05, 0.9);
    body.castShadow = true;
    fig.add(body);

    const head = new THREE.Mesh(hordeHeadGeo, hordeHeadMat);
    head.position.y = 0.32;
    head.castShadow = true;
    fig.add(head);

    /* twin horns */
    const hornL = new THREE.Mesh(hordeHornGeo, hordeHornMat);
    hornL.position.set(-0.04, 0.38, 0);
    hornL.rotation.z = 0.45;
    hornL.rotation.x = -0.2;
    hornL.castShadow = true;
    fig.add(hornL);
    const hornR = new THREE.Mesh(hordeHornGeo, hordeHornMat);
    hornR.position.set(0.04, 0.38, 0);
    hornR.rotation.z = -0.45;
    hornR.rotation.x = -0.2;
    hornR.castShadow = true;
    fig.add(hornR);

    /* glowing eyes */
    const eyeL = new THREE.Mesh(hordeEyeGeo, hordeEyeMat);
    eyeL.position.set(-0.022, 0.33, 0.045);
    fig.add(eyeL);
    const eyeR = new THREE.Mesh(hordeEyeGeo, hordeEyeMat);
    eyeR.position.set(0.022, 0.33, 0.045);
    fig.add(eyeR);

    /* claws */
    const clawL = new THREE.Mesh(hordeClawGeo, hordeHornMat);
    clawL.position.set(-0.08, 0.12, 0.04);
    clawL.rotation.z = 1.2;
    clawL.rotation.x = 0.6;
    fig.add(clawL);
    const clawR = new THREE.Mesh(hordeClawGeo, hordeHornMat);
    clawR.position.set(0.08, 0.12, 0.04);
    clawR.rotation.z = -1.2;
    clawR.rotation.x = 0.6;
    fig.add(clawR);

    parent.add(fig);
    return fig;
  }

  function updateMarkers(world, state, active, time) {
    clearMarkers();
    if (!world) return;
    const tiles = world.tiles;
    const pulse = 0.55 + 0.45 * Math.sin(time * 3.5);
    hordeBodyMat.emissiveIntensity = 0.22 + pulse * 0.18;
    hordeHeadMat.emissiveIntensity = 0.28 + pulse * 0.2;
    hordeMoteMat.opacity = 0.35 + pulse * 0.35;

    for (const en of world.enemies) {
      const base = sampleH(tiles, en.x, en.y, mapW, mapH);
      const pack = new THREE.Group();
      pack.position.set(en.x + 0.5, base, en.y + 0.5);

      /* scorched ground stain */
      const stain = new THREE.Mesh(hordeStainGeo, hordeStainMat);
      stain.rotation.x = -Math.PI / 2;
      stain.position.y = 0.02;
      pack.add(stain);

      /* 4–6 warriors in a tight menacing knot */
      const n = 4 + ((en.x * 3 + en.y * 7) % 3);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + time * 0.15;
        const rad = 0.1 + (i % 2) * 0.08;
        const ox = Math.cos(ang) * rad;
        const oz = Math.sin(ang) * rad;
        const sc = 0.85 + ((en.x + i * 5) % 5) * 0.06;
        const bob = Math.sin(time * 5.2 + i * 1.3) * 0.025;
        const face = ang + Math.PI + Math.sin(time * 2 + i) * 0.2;
        spawnHordeFigure(pack, ox, oz, sc, bob, face);
      }

      /* slight purple aura */
      const glow = new THREE.PointLight(0xa040ff, 0.45 + pulse * 0.55, 2.8, 2);
      glow.position.set(0, 0.35, 0);
      pack.add(glow);

      /* floating blight mote */
      const mote = new THREE.Mesh(hordeMoteGeo, hordeMoteMat);
      mote.position.set(0, 0.55 + Math.sin(time * 2.4 + en.x) * 0.06, 0);
      pack.add(mote);

      markers.add(pack);
    }
    if (state && state.lords) {
      for (const l of state.lords) {
        if (!l.alive || l === active) continue;
        const base = sampleH(tiles, l.x, l.y, mapW, mapH);
        const pole = new THREE.Mesh(bannerGeo, bannerMat);
        pole.position.set(l.x + 0.5, base + 0.3, l.y + 0.5);
        markers.add(pole);
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(l.x + 0.62, base + 0.5, l.y + 0.5);
        markers.add(flag);
      }
    }
  }

  function findRift(tiles, mw, mh) {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        if (tiles[y * mw + x].t === 'rift') return { x, y };
      }
    }
    return null;
  }

  /** Global doom + stronger purple near the expanding blight / when standing in it */
  function computeTaint(lord, world, mw, mh, doom) {
    let t = clamp01((doom || 0) * 0.55);
    if (!lord || !world) return t;
    const rift = findRift(world.tiles, mw, mh);
    if (rift) {
      const dist = Math.hypot(lord.x - rift.x, lord.y - rift.y);
      const radius = (world.corruptR || 2.5) + 8;
      const near = 1 - clamp01(dist / radius);
      t = Math.max(t, near * near * 0.95);
    }
    const tile = world.tiles[lord.y * mw + lord.x];
    if (tile && tile.corrupt) t = Math.min(1, t + 0.28);
    if (tile && tile.t === 'rift') t = Math.min(1, t + 0.45);
    return clamp01(t);
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /** Sun direction: dawn east (+X), noon high, dusk west (−X). Y-up, −Z north. */
  function sunDirFromHour(hour) {
    let h = hour;
    if (h < 0) h += 24;
    if (h >= 24) h -= 24;
    /* map 5:00–21:00 to day arc; outside = night below horizon */
    const dayStart = 5, dayEnd = 21;
    let dayT, below = false;
    if (h < dayStart || h > dayEnd) {
      below = true;
      dayT = h < 12 ? 0 : 1;
    } else {
      dayT = (h - dayStart) / (dayEnd - dayStart);
    }
    const elev = below ? -0.18 : Math.sin(dayT * Math.PI) * 1.15;
    const az = Math.PI * 0.5 - dayT * Math.PI; /* +X dawn → −X dusk */
    const cosEl = Math.cos(elev);
    const dir = new THREE.Vector3(
      Math.sin(az) * cosEl,
      Math.sin(elev),
      -Math.cos(az) * cosEl * 0.35, /* slight southern bias */
    );
    return dir.normalize();
  }

  function setEnv(env, hour, doom, time, lord, world, mw, mh) {
    const top = env.top || [80, 128, 190];
    const bot = env.bot || [180, 200, 220];
    const fog = env.fog || bot;
    const taint = computeTaint(lord, world, mw, mh, doom);

    const night = hour >= 20 || hour < 6;
    const nightAmt = night
      ? (hour >= 20 ? clamp01((hour - 20) / 2) : clamp01((6 - hour) / 2) * 0.5 + 0.5)
      : (hour < 7 ? clamp01((7 - hour) / 1.5) * 0.5 : hour > 18.5 ? clamp01((hour - 18.5) / 1.5) * 0.5 : 0);

    const zen = new THREE.Color(top[0] / 255, top[1] / 255, top[2] / 255);
    const hor = new THREE.Color(bot[0] / 255, bot[1] / 255, bot[2] / 255);
    /* envColors already doom-tints; push local blight further into sky */
    if (taint > 0) {
      const blightZ = new THREE.Color(0.12, 0.04, 0.22);
      const blightH = new THREE.Color(0.42, 0.14, 0.38);
      zen.lerp(blightZ, taint * 0.65);
      hor.lerp(blightH, taint * 0.55);
    }
    skyUniforms.uZenith.value.copy(zen);
    skyUniforms.uHorizon.value.copy(hor);
    skyUniforms.uTime.value = time || 0;
    skyUniforms.uTaint.value = taint;
    skyUniforms.uNight.value = nightAmt;

    const sdir = sunDirFromHour(hour);
    skyUniforms.uSunDir.value.copy(sdir);

    const warm = hour < 8 || hour > 17;
    const sunCol = night
      ? new THREE.Color(0.45, 0.5, 0.7)
      : warm
        ? new THREE.Color(1.0, 0.55, 0.28)
        : new THREE.Color(1.0, 0.96, 0.85);
    if (taint > 0.2) sunCol.lerp(new THREE.Color(0.85, 0.4, 1.0), (taint - 0.2) * 0.5);
    skyUniforms.uSunColor.value.copy(sunCol);
    skyUniforms.uCloudColor.value.set(night ? 0.25 : warm ? 1.0 : 0.98, night ? 0.28 : warm ? 0.72 : 0.98, night ? 0.4 : warm ? 0.55 : 1.0);
    if (taint > 0) {
      skyUniforms.uCloudColor.value.lerp(new THREE.Color(0.55, 0.35, 0.7), taint * 0.5);
    }

    const fc = new THREE.Color(fog[0] / 255, fog[1] / 255, fog[2] / 255);
    if (taint > 0) fc.lerp(new THREE.Color(0.28, 0.1, 0.36), taint * 0.55);
    scene.fog.color.copy(fc);
    renderer.setClearColor(fc, 1);

    const dayAmt = night ? 0.2 : hour < 8 || hour > 18 ? 0.5 : 1;
    const above = Math.max(0, sdir.y);
    sunLight.intensity = (0.28 + dayAmt * 0.82) * (0.3 + above * 0.85);
    sunLight.color.copy(sunCol);
    /* place sun + shadow frustum around the active viewpoint (play or cinematic) */
    const focusX = (lord && Number.isFinite(lord.x)) ? lord.x + 0.5 : 0;
    const focusZ = (lord && Number.isFinite(lord.y)) ? lord.y + 0.5 : 0;
    const focusY = (lord && world && world.tiles)
      ? sampleH(world.tiles, lord.x, lord.y, mw, mh)
      : 0;
    const sunDist = 42;
    sunLight.position.set(
      focusX + sdir.x * sunDist,
      focusY + Math.max(8, sdir.y * sunDist),
      focusZ + sdir.z * sunDist,
    );
    sunLight.target.position.set(focusX, focusY, focusZ);
    sunLight.target.updateMatrixWorld();
    /* long shadows at dawn/dusk: widen frustum slightly when sun is low */
    const lowSun = 1 + (1 - above) * 0.35;
    const ext = SHADOW_EXT * lowSun;
    shCam.left = -ext; shCam.right = ext;
    shCam.top = ext; shCam.bottom = -ext;
    shCam.far = 70 + (1 - above) * 30;
    shCam.updateProjectionMatrix();
    /* no map-cast shadows at night / sun under horizon */
    sunLight.castShadow = above > 0.06 && !night && sunLight.intensity > 0.18;

    amb.intensity = night ? 0.28 : 0.38 + dayAmt * 0.12;
    amb.color.set(night ? 0x6a78a8 : taint > 0.4 ? 0xb8a0d0 : 0xc8d4f0);
    hemi.intensity = night ? 0.14 : 0.28 + dayAmt * 0.08;
    hemi.color.set(night ? 0x304060 : 0x9ec8ff);
    hemi.groundColor.set(taint > 0.3 ? 0x3a2048 : 0x3a4a28);

    /* keep blended terrain lit/fogged like the rest of the scene */
    terrainUniforms.uSunDir.value.copy(sdir);
    terrainUniforms.uSunColor.value.copy(sunCol);
    terrainUniforms.uSunInt.value = sunLight.intensity;
    terrainUniforms.uAmbColor.value.copy(amb.color);
    terrainUniforms.uAmbInt.value = amb.intensity + hemi.intensity * 0.4;
    terrainUniforms.uFogColor.value.copy(fc);
    terrainUniforms.uFogNear.value = FOG_NEAR;
    terrainUniforms.uFogFar.value = FOG_FAR;
    /* deeper shadows at high sun, softer wash at dawn/dusk */
    terrainUniforms.uShadowStrength.value = night ? 0 : (0.38 + above * 0.32);
    if (maps.grass) terrainUniforms.uGrass.value = maps.grass;
    if (maps.ground) terrainUniforms.uGround.value = maps.ground;
    if (maps.rock) terrainUniforms.uRock.value = maps.rock;
    /* feed the directional shadow map into the terrain shader (manual sample) */
    if (sunLight.castShadow && sunLight.shadow && sunLight.shadow.map) {
      terrainUniforms.uShadowMap.value = sunLight.shadow.map.texture;
      terrainUniforms.uShadowMatrix.value.copy(sunLight.shadow.matrix);
      terrainUniforms.uReceiveShadow.value = 1;
    } else {
      terrainUniforms.uShadowMap.value = null;
      terrainUniforms.uReceiveShadow.value = 0;
    }

    /* sun sprite rides the same arc (hide below horizon) */
    const sunVis = above > 0.02 ? Math.min(1, above * 4) : 0;
    sunSprite.visible = sunVis > 0.01;
    sunSprite.material.opacity = 0.55 + sunVis * 0.4;
    sunSprite.material.color.copy(sunCol);
    sunSprite.scale.setScalar(1.2 + (1 - above) * 1.8);

    if (riftLight) {
      riftLight.intensity = 3.2 + Math.sin(time * 2.4) * 1.1 + doom * 1.4 + taint * 1.2;
      riftLight.color.setHSL(0.78 + Math.sin(time * 1.8) * 0.05, 0.95, 0.58);
    }
    root.traverse(o => {
      const ph = o.userData.ph || 0;
      if (o.name === 'riftFlame') {
        /* fire tongue: height flicker, lean, soft opacity pulse */
        const flicker = 0.78 + Math.sin(time * 14 + ph) * 0.16 + Math.sin(time * 23 + ph * 1.7) * 0.1;
        const lean = Math.sin(time * 3.2 + ph) * 0.14;
        const wiggle = 0.88 + Math.sin(time * 11 + ph) * 0.14;
        o.scale.set(wiggle, flicker, wiggle);
        o.position.y = (o.userData.baseY || 0) + Math.sin(time * 6 + ph) * 0.05;
        o.position.x = (o.userData.baseX || 0) + lean * 0.12;
        o.position.z = (o.userData.baseZ || 0) + Math.cos(time * 4 + ph) * 0.07;
        o.rotation.z = lean * 0.4;
        o.rotation.y = ph * 0.15 + Math.sin(time * 0.7 + ph) * 0.12;
        o.traverse(c => {
          if (c.isMesh && c.material && c.material.opacity != null) {
            c.material.opacity = 0.65 + flicker * 0.3;
          }
        });
      } else if (o.name === 'riftSpark') {
        const life = (time * (o.userData.speed || 0.6) + ph) % 1;
        const rad = (o.userData.rad || 0.4) * (0.7 + life * 0.55);
        const ang = ph + time * (o.userData.spin || 1);
        o.position.x = Math.cos(ang) * rad;
        o.position.z = Math.sin(ang) * rad;
        o.position.y = life * 3.4;
        if (o.material) o.material.opacity = (1 - life) * 0.95;
        o.scale.setScalar(0.55 + (1 - life) * 0.9);
      } else if (o.name === 'riftDebris') {
        const ang = ph + time * 0.35;
        const rad = o.userData.rad || 0.9;
        o.position.x = Math.cos(ang) * rad;
        o.position.z = Math.sin(ang) * rad;
        o.position.y = (o.userData.baseY || 0.5) + Math.sin(time * 2 + ph) * 0.12;
        o.rotation.x = time * 0.8 + ph;
        o.rotation.y = time * 1.1;
      } else if (o.name === 'riftShard') {
        o.position.y = (o.userData.baseY || 0.5) + Math.sin(time * 1.6 + ph) * 0.05;
        if (o.material && o.material.emissiveIntensity != null) {
          o.material.emissiveIntensity = 0.5 + Math.sin(time * 3 + ph) * 0.35;
        }
      } else if (o.name === 'riftSmoke') {
        o.position.y = (o.userData.baseY || 2) + Math.sin(time * 0.55 + ph) * 0.12;
        o.position.x = Math.sin(time * 0.7 + ph) * 0.08;
        o.position.z = Math.cos(time * 0.6 + ph) * 0.06;
        o.rotation.y = ph + time * 0.12;
        o.scale.x = 1 + Math.sin(time * 0.9 + ph) * 0.14;
        o.scale.z = 1 + Math.cos(time * 0.8 + ph) * 0.12;
        if (o.material && o.material.opacity != null) {
          o.material.opacity = (o.userData.baseOp || 0.5) * (0.85 + Math.sin(time * 1.1 + ph) * 0.15);
        }
      } else if (o.name === 'riftSpire') {
        o.rotation.y = time * 0.18;
        o.position.y = (o.userData.baseY != null ? o.userData.baseY : o.position.y) + Math.sin(time * 0.9) * 0.04;
        o.traverse(c => {
          if (c.isMesh && c.material && c.material.emissiveIntensity != null) {
            c.material.emissiveIntensity = 0.28 + Math.sin(time * 2.4) * 0.2;
          }
        });
      } else if (o.name === 'riftTendril') {
        o.rotation.y = time * 0.4 + ph;
        o.scale.y = 0.85 + Math.sin(time * 2.2 + ph) * 0.2;
        o.position.y = (o.userData.baseY || 0.9) + Math.sin(time * 1.5 + ph) * 0.08;
      } else if (o.name === 'riftArc') {
        o.rotation.y = time * 2.5 + ph;
        o.rotation.z = Math.sin(time * 4 + ph) * 0.5;
        o.position.y = (o.userData.baseY || 0.6) + Math.sin(time * 5 + ph) * 0.15;
        if (o.material) o.material.opacity = 0.35 + Math.sin(time * 8 + ph) * 0.4;
      } else if (o.name === 'riftCrack') {
        if (o.material) o.material.opacity = 0.35 + Math.sin(time * 3 + ph) * 0.25;
      } else if (o.name === 'riftGlowCore' || o.name === 'riftGlowHalo' || o.name === 'riftMouthGlow') {
        const pulse = 0.65 + Math.sin(time * 3.5 + ph) * 0.35;
        if (o.material && o.material.opacity != null) {
          const baseOp = o.name === 'riftGlowCore' ? 0.9 : o.name === 'riftGlowHalo' ? 0.5 : 0.4;
          o.material.opacity = baseOp * pulse;
        }
        if (o.name === 'riftMouthGlow') o.rotation.z = time * (0.2 + ph * 0.05);
      } else if (o.name === 'riftChasm') {
        if (o.userData.redLight) {
          o.userData.redLight.intensity = 1.8 + Math.sin(time * 5) * 0.9 + doom * 0.8;
        }
        if (o.userData.magLight) {
          o.userData.magLight.intensity = 1.4 + Math.sin(time * 3.2 + 1) * 0.7 + taint * 0.6;
          o.userData.magLight.position.y = 1.8 + Math.sin(time * 2) * 0.4;
        }
      }
    });
  }

  /**
   * @param {object} p
   * @param {object} p.lord
   * @param {object} p.cam
   * @param {object} p.world
   * @param {object} p.state
   * @param {number} p.mapW
   * @param {number} p.mapH
   * @param {object} p.env
   * @param {number} p.hour
   * @param {number} p.doom
   * @param {number} p.time
   * @param {Array<{dx:number,dy:number}>} p.dirs
   * @param {number} [p.corruptKey]
   */
  function render(p) {
    const { lord, cam, world, state, mapW: mw, mapH: mh, env, hour, doom, time } = p;
    if (!lord || !world) return;
    ensureBuilt(world, mw, mh);
    if (p.corruptKey !== undefined && p.corruptKey !== render._ck) {
      refreshCorruption(world, mw, mh);
      render._ck = p.corruptKey;
    }
    /* hide props on the tile you're standing on so keeps/citadels don't swallow the camera */
    root.traverse(o => {
      const t = o.userData && o.userData.tile;
      if (t) o.visible = !(t.x === lord.x && t.y === lord.y);
    });
    updateMarkers(world, state, lord, time);
    setEnv(env, hour, doom, time, lord, world, mw, mh);

    const base = sampleH(world.tiles, lord.x, lord.y, mw, mh);
    const bob = (cam.bob || 0) * 0.06 * Math.sin((time || 0) * 14);
    const eyeH = (p.cineEye != null && p.cineEye > 0) ? p.cineEye : EYE;
    const eye = base + eyeH + bob;
    const px = lord.x + 0.5;
    const pz = lord.y + 0.5;

    /* Compass + movement + camera all use the same dirs table from game.js.
       Map: +x east, +y south. World: +X east, +Y up, +Z south.
       Face 0 look −Z (north). Face NW look (−X,−Z). Geometry uses the same axes. */
    const face = ((lord.face | 0) % 8 + 8) % 8;
    const dirs = (p.dirs && p.dirs.length === 8) ? p.dirs : FACE_DIRS;
    const fd = dirs[face] || FACE_DIRS[0];
    const fl = Math.hypot(fd.dx, fd.dy) || 1;
    /* Look exactly where a step forward would go (map dx→X, map dy→Z). */
    const fwdX = fd.dx / fl;
    const fwdZ = fd.dy / fl;

    /* cineBack / cineLook: optional pull-back for title/end vistas */
    const back = (p.cineBack != null && p.cineBack >= 0) ? p.cineBack : 0.25;
    const look = (p.cineLook != null && p.cineLook > 0) ? p.cineLook : 8;
    const camX = px - fwdX * back;
    const camZ = pz - fwdZ * back;
    /* free look-at target (smooth 360 orbit) or 8-way face ray */
    let lookX, lookZ, lookFwdX = fwdX, lookFwdZ = fwdZ;
    if (p.cineLookAt && Number.isFinite(p.cineLookAt.x) && Number.isFinite(p.cineLookAt.y)) {
      lookX = p.cineLookAt.x + 0.5;
      lookZ = p.cineLookAt.y + 0.5;
      const ldx = lookX - camX, ldz = lookZ - camZ;
      const ll = Math.hypot(ldx, ldz) || 1;
      lookFwdX = ldx / ll;
      lookFwdZ = ldz / ll;
    } else {
      lookX = px + fwdX * look;
      lookZ = pz + fwdZ * look;
    }

    /*
      Cinematic terrain clearance (intro / game-over / victory):
      sample ground under/ahead of the camera, soft-filter the clearance target,
      then follow with a critically damped spring so height changes never hitch.
    */
    if (p.cineClear) {
      const tiles = world.tiles;
      const clearance = (p.cineClearance != null) ? p.cineClearance : 1.5;
      let maxG = -1e9;
      const bump = (mx, mz) => {
        const gnd = sampleH(tiles, mx, mz, mw, mh);
        const ix = Math.max(0, Math.min(mw - 1, mx | 0));
        const iy = Math.max(0, Math.min(mh - 1, mz | 0));
        const tt = tiles[iy * mw + ix].t;
        /* mesh peaks / props sit a bit above sampleH plateaus */
        let fudge = 0.25;
        if (tt === 'mountains') fudge = 2.05;
        else if (tt === 'hills') fudge = 0.65;
        else if (tt === 'keep' || tt === 'citadel') fudge = 1.85;
        else if (tt === 'tower') fudge = 1.55;
        else if (tt === 'forest') fudge = 0.85;
        const h = gnd + fudge;
        if (h > maxG) maxG = h;
      };
      /* under camera + ring */
      for (let r = 0; r <= 4; r++) {
        if (r === 0) bump(camX, camZ);
        else {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            bump(camX + Math.cos(ang) * r * 0.95, camZ + Math.sin(ang) * r * 0.95);
          }
        }
      }
      /* along look corridor toward the Rift / face */
      const span = Math.min(Math.hypot(lookX - camX, lookZ - camZ) || look, 16);
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        bump(camX + lookFwdX * span * t, camZ + lookFwdZ * span * t);
      }
      /* orbit / path lookahead from game.js (pre-rise before peaks) */
      if (Array.isArray(p.cineProbes)) {
        for (let i = 0; i < p.cineProbes.length; i++) {
          const pr = p.cineProbes[i];
          if (!pr || !Number.isFinite(pr.x) || !Number.isFinite(pr.y)) continue;
          bump(pr.x + 0.5, pr.y + 0.5);
          for (let a = 0; a < 4; a++) {
            const ang = (a / 4) * Math.PI * 2;
            bump(pr.x + 0.5 + Math.cos(ang) * 1.1, pr.y + 0.5 + Math.sin(ang) * 1.1);
          }
        }
      }

      const now = (typeof time === 'number') ? time : 0;
      let dt = now - (cineLastT == null ? now : cineLastT);
      if (!(dt > 0) || dt > 0.2) dt = 1 / 60;
      cineLastT = now;

      const baseFloor = eye;
      const desiredRaw = Math.max(baseFloor, maxG + clearance) + bob * 0.15;

      /* soft-filter the target so tile edges don't spike desired height */
      if (cineDesY == null || !Number.isFinite(cineDesY)) cineDesY = desiredRaw;
      const tauDes = desiredRaw > cineDesY ? 0.55 : 1.15; /* settle down more slowly */
      const aDes = 1 - Math.exp(-dt / tauDes);
      cineDesY += (desiredRaw - cineDesY) * aDes;

      /* critically damped spring toward filtered target — hitch-free motion */
      if (cineEyeY == null || !Number.isFinite(cineEyeY)) {
        cineEyeY = cineDesY;
        cineEyeV = 0;
      }
      const omega = 2.1;   /* natural freq — lower = silkier */
      const zeta = 1.0;    /* critical damping */
      const err = cineDesY - cineEyeY;
      const accel = omega * omega * err - 2 * zeta * omega * cineEyeV;
      cineEyeV += accel * dt;
      /* gentle velocity clamp only as a safety net */
      if (cineEyeV > 3.2) cineEyeV = 3.2;
      if (cineEyeV < -2.0) cineEyeV = -2.0;
      cineEyeY += cineEyeV * dt;

      /* soft emergency floor — no hard snap: blend up if we drift into ground */
      const hardFloor = maxG + clearance * 0.5;
      if (cineEyeY < hardFloor) {
        const pull = (hardFloor - cineEyeY) * Math.min(1, dt * 6);
        cineEyeY += pull;
        if (cineEyeV < 0) cineEyeV *= 0.3;
      }

      camera.position.set(camX, cineEyeY, camZ);
      camera.up.set(0, 1, 0);

      const lookG = sampleH(tiles, lookX, lookZ, mw, mh);
      const lookTarget = Math.max(lookG + 0.4, Math.min(cineEyeY - 1.7, lookG + 1.6));
      if (cineLookY == null || !Number.isFinite(cineLookY)) {
        cineLookY = lookTarget;
        cineLookV = 0;
      }
      const lErr = lookTarget - cineLookY;
      const lAcc = 1.6 * 1.6 * lErr - 2 * 1.0 * 1.6 * cineLookV;
      cineLookV += lAcc * dt;
      if (cineLookV > 2.5) cineLookV = 2.5;
      if (cineLookV < -2.5) cineLookV = -2.5;
      cineLookY += cineLookV * dt;
      camera.lookAt(lookX, cineLookY, lookZ);
    } else {
      cineEyeY = null;
      cineEyeV = null;
      cineDesY = null;
      cineLookY = null;
      cineLookV = null;
      cineLastT = null;
      camera.position.set(camX, eye, camZ);
      camera.up.set(0, 1, 0);
      camera.lookAt(lookX, eye - 0.25, lookZ);
    }
    /* no roll/pan on the 3D rig — they were fighting the face vector */

    sky.position.copy(camera.position);
    const sdir = skyUniforms.uSunDir.value;
    sunSprite.position.copy(camera.position).addScaledVector(sdir, 55);
    renderer.render(scene, camera);
  }
  render._ck = -1;
  let cineEyeY = null;
  let cineEyeV = null;
  let cineDesY = null;
  let cineLookY = null;
  let cineLookV = null;
  let cineLastT = null;

  function setVisible(on) {
    host.style.display = on ? 'block' : 'none';
  }

  function dispose() {
    disposeGroup(root);
    clearMarkers();
    disposeTerrain();
    for (const k of Object.keys(maps)) {
      if (maps[k]) maps[k].dispose();
      maps[k] = null;
    }
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  setVisible(false);
  return { rebuild, refreshCorruption, render, setVisible, dispose, canvas: renderer.domElement };
}
