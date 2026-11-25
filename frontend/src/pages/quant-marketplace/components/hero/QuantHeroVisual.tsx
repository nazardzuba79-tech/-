import React, { useEffect, useRef } from "react";
import { MousePointerClick, Zap } from "lucide-react";
import { useMarketData } from "../../../../lib/useMarketData";
import { parseChangePercentOrNull } from "../../../../lib/priceChange";
import { ORBIT_COINS, type CoinMark } from "./coinMarks";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type ThemeMode = "light" | "dark";

// Pre-allocated scratch math helpers (zero GC inside animation loop)
const _scratchVec = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchMat = new THREE.Matrix4();
const _scratchAxis = new THREE.Vector3(0, 1, 0);
const _scratchZAxis = new THREE.Vector3(0, 0, 1);
const _scratchRadialDir = new THREE.Vector3();
const _scratchPointerNdc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1.38);
const _rayHit = new THREE.Vector3();

function createPrecisionDialTexture(isDark: boolean): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // Subtle concentric metallic azimuth rings
    const bgGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 248);
    if (isDark) {
      bgGrad.addColorStop(0, "rgba(17, 28, 51, 0.92)");
      bgGrad.addColorStop(0.65, "rgba(13, 22, 42, 0.72)");
      bgGrad.addColorStop(1, "rgba(11, 18, 33, 0.0)");
    } else {
      bgGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
      bgGrad.addColorStop(0.7, "rgba(252, 250, 245, 0.92)");
      bgGrad.addColorStop(1, "rgba(250, 247, 240, 0.0)");
    }
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 250, 0, Math.PI * 2);
    ctx.fill();

    // Fine compass / quant phase graduations (72 ticks)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const isMajor = i % 6 === 0;
      const rIn = isMajor ? 186 : 196;
      const rOut = 210;
      ctx.strokeStyle = isMajor
        ? isDark
          ? "rgba(229, 201, 139, 0.62)"
          : "rgba(150, 104, 18, 0.95)"
        : isDark
          ? "rgba(45, 212, 191, 0.34)"
          : "rgba(15, 23, 42, 0.42)";
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.stroke();
    }

    // Inner calibration hairlines
    [118, 162, 214].forEach((radius, idx) => {
      ctx.strokeStyle =
        idx === 1
          ? isDark
            ? "rgba(212, 175, 106, 0.28)"
            : "rgba(150, 104, 18, 0.55)"
          : isDark
            ? "rgba(94, 234, 212, 0.20)"
            : "rgba(15, 23, 42, 0.22)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, "rgba(6, 10, 22, 0.55)");
    grad.addColorStop(0.5, "rgba(6, 10, 22, 0.18)");
    grad.addColorStop(1, "rgba(6, 10, 22, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGlowSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.28, "rgba(255, 255, 255, 0.72)");
    grad.addColorStop(0.65, "rgba(255, 255, 255, 0.16)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCoinFaceTexture(coin: CoinMark): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = coin.color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    // A soft top-left sheen and a struck inner rim, so the face reads as minted metal, not a sticker.
    const sheen = ctx.createRadialGradient(88, 72, 8, size / 2, size / 2, 150);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.30)");
    sheen.addColorStop(0.55, "rgba(255, 255, 255, 0.0)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.16)");
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 116, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.scale(size / 32, size / 32);
    ctx.fillStyle = "#ffffff";
    for (const mark of coin.paths) {
      ctx.globalAlpha = mark.opacity ?? 1;
      ctx.fill(new Path2D(mark.d));
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Two orbits around the core. Every coin turns at one angular speed and the five are a fifth of a
// turn apart, so they keep their spacing and never run into each other.
const COIN_RADIUS = 0.25;
const COIN_SPEED = 0.22;
const COIN_ORBITS = [
  { radius: 2.02, tiltX: 0.2, tiltZ: 0.06 },
  { radius: 2.36, tiltX: -0.1, tiltZ: -0.22 },
];
const COIN_STEP = (Math.PI * 2) / 5;
const COIN_SLOTS = [
  { orbit: 0, phase: 0.95 },
  { orbit: 1, phase: 0.95 + COIN_STEP },
  { orbit: 0, phase: 0.95 + COIN_STEP * 2 },
  { orbit: 1, phase: 0.95 + COIN_STEP * 3 },
  { orbit: 0, phase: 0.95 + COIN_STEP * 4 },
];
const CHANGE_FORMAT = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

export const QuantHeroVisual: React.FC<{
  theme: ThemeMode;
  /** A coin was chosen (its label or the coin itself). */
  onSelectMarket?: (symbol: string) => void;
}> = ({ theme, onSelectMarket }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const coinLabelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectMarketRef = useRef(onSelectMarket);
  selectMarketRef.current = onSelectMarket;
  // The tab's one shared market poll. A market without a reading shows its ticker and no figure.
  const market = useMarketData(30_000);
  const pulseTriggerRef = useRef<(() => void) | null>(null);
  const sceneCtxRef = useRef<{
    dialMat: THREE.MeshStandardMaterial;
    lightDialTex: THREE.CanvasTexture;
    darkDialTex: THREE.CanvasTexture;
    cageWireMat: THREE.LineBasicMaterial;
    hemiLight: THREE.HemisphereLight;
    waveMat: THREE.ShaderMaterial;
    applyStage: (isDark: boolean) => void;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const width = container.clientWidth || 560;
    const height = container.clientHeight || 300;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: width >= 600,
        powerPreference: "low-power",
      });
    } catch {
      container.dataset.unavailable = "true";
      return;
    }
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const isSoftwareGl =
      /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(
        String(gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
      );
    container.dataset.webgl = "active";
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(
      isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, width < 600 ? 1 : 1.5),
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const isDarkInit = theme === "dark";

    const scene = new THREE.Scene();
    scene.background = null;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environment = new RoomEnvironment();
    const target = pmremGenerator.fromScene(environment, 0.04);
    environment.dispose();
    const envTex = target.texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    // A narrow stage (phones) widens the view instead of cropping the outer rings.
    const fitZoom = (w: number, h: number) =>
      Math.min(1, Math.max(0.6, w / h / 1.5));
    camera.zoom = fitZoom(width, height);
    camera.updateProjectionMatrix();
    // The light stage shows the whole object with air around it; the dark one keeps its closer crop.
    camera.position.set(0.35, isDarkInit ? 1.55 : 1.36, isDarkInit ? 5.15 : 5.55);

    // Interactive OrbitControls (zoom disabled so page scroll remains silky)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, isDarkInit ? 0.12 : -0.1, 0);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.05;
    controls.minPolarAngle = Math.PI * 0.22;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.autoRotate = !isSoftwareGl && !prefersReduced;
    controls.autoRotateSpeed = 0.75;
    controls.update();

    // 3-Point Studio Lighting (Warm Gold Key + Cool Teal Rim + Sky/Slate Fill)
    const hemiLight = new THREE.HemisphereLight(
      isDarkInit ? 0x93c5fd : 0xf8fafc,
      isDarkInit ? 0x0f172a : 0xcbd5e1,
      isDarkInit ? 0.85 : 1.1,
    );
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff0d4, 2.5);
    keyLight.position.set(4.5, 6.5, 4.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.camera.left = -3.4;
    keyLight.shadow.camera.right = 3.4;
    keyLight.shadow.camera.top = 3.4;
    keyLight.shadow.camera.bottom = -3.4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.9);
    rimLight.position.set(-4.6, 2.6, -3.4);
    scene.add(rimLight);

    const violetRimLight = new THREE.DirectionalLight(0xa855f7, 1.45);
    violetRimLight.position.set(3.8, -1.2, -4.2);
    scene.add(violetRimLight);

    const underLight = new THREE.PointLight(0xf59e0b, 2.1, 6.5);
    underLight.position.set(0, -0.8, 0.4);
    scene.add(underLight);

    // =========================================================================
    // 1. LIVING GLSL QUANTUM LIQUIDITY WAVE FIELD (Lower Horizon Plane)
    // =========================================================================
    const waveGeo = new THREE.PlaneGeometry(7.6, 7.6, 72, 72);
    waveGeo.rotateX(-Math.PI / 2);

    const waveMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPulseAge: { value: 99 },
        uPulseOrigin: { value: new THREE.Vector2(0, 0) },
        uHoverPos: { value: new THREE.Vector2(0, 0) },
        uIsDark: { value: isDarkInit ? 1.0 : 0.0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPulseAge;
        uniform vec2 uPulseOrigin;
        uniform vec2 uHoverPos;
        varying vec2 vWorldXZ;
        varying float vElev;
        varying float vPulseWave;

        void main() {
          vec3 pos = position;
          float r = length(pos.xz);

          // Harmonic quantitative volatility waves
          float w1 = sin(pos.x * 1.9 + uTime * 1.15) * cos(pos.z * 1.7 - uTime * 0.95);
          float w2 = sin(r * 3.4 - uTime * 1.8) * 0.55;
          float hoverDist = length(pos.xz - uHoverPos);
          float hoverLift = exp(-hoverDist * hoverDist * 1.1) * 0.14;

          // Shockwave ring on click/pulse trigger
          float pulseRadius = uPulseAge * 3.6;
          float pulseBand = exp(-pow(length(pos.xz - uPulseOrigin) - pulseRadius, 2.0) * 3.8) * exp(-uPulseAge * 0.75);

          float elev = (w1 * 0.08 + w2 * 0.05) * smoothstep(0.6, 2.2, r) + hoverLift + pulseBand * 0.22;
          pos.y += elev;

          vWorldXZ = pos.xz;
          vElev = elev;
          vPulseWave = pulseBand;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIsDark;
        varying vec2 vWorldXZ;
        varying float vElev;
        varying float vPulseWave;

        void main() {
          float r = length(vWorldXZ);
          float edgeFade = 1.0 - smoothstep(1.85, 3.65, r);
          float centerCut = smoothstep(0.62, 1.15, r);

          // Crisp algorithmic grid lines
          vec2 coord = vWorldXZ * 2.2;
          vec2 fw = max(fwidth(coord), vec2(0.0005));
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fw;
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);

          // Concentric radar rings
          float ringDist = abs(fract(r * 1.1 - uTime * 0.12) - 0.5) * 2.0;
          float ringLine = smoothstep(0.93, 0.99, ringDist) * 0.45;

          // The light stage draws the floor in ink, deep teal and deep gold: pale neon lines vanish on white.
          vec3 cyan = mix(vec3(0.03, 0.50, 0.46), vec3(0.133, 0.827, 0.933), uIsDark);
          vec3 gold = mix(vec3(0.70, 0.47, 0.05), vec3(0.988, 0.749, 0.141), uIsDark);
          vec3 violet = mix(vec3(0.13, 0.17, 0.28), vec3(0.659, 0.333, 0.969), uIsDark);

          vec3 col = mix(violet, cyan, clamp(vElev * 5.0 + 0.52, 0.0, 1.0));
          col = mix(col, gold, clamp(vPulseWave * 1.6 + smoothstep(0.05, 0.14, vElev), 0.0, 1.0));

          float alpha = (line * 0.34 + ringLine + vPulseWave * 0.65) * edgeFade * centerCut;
          alpha *= mix(0.92, 1.0, uIsDark);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.position.y = -1.42;
    scene.add(waveMesh);

    // =========================================================================
    // 2. PROCEDURAL CALIBRATION DIAL + CONTACT SHADOW
    // =========================================================================
    const lightDialTex = createPrecisionDialTexture(false);
    const darkDialTex = createPrecisionDialTexture(true);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    lightDialTex.anisotropy = maxAniso;
    darkDialTex.anisotropy = maxAniso;

    const dialGeo = new THREE.CircleGeometry(1.72, 64);
    const dialMat = new THREE.MeshStandardMaterial({
      map: isDarkInit ? darkDialTex : lightDialTex,
      roughness: 0.48,
      metalness: 0.35,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const dialMesh = new THREE.Mesh(dialGeo, dialMat);
    dialMesh.rotation.x = -Math.PI / 2;
    dialMesh.position.y = -1.39;
    dialMesh.receiveShadow = true;
    scene.add(dialMesh);

    const shadowTex = createContactShadowTexture();
    const contactShadowGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -1.37; // >= 0.02 above wave & dial
    scene.add(contactShadow);

    // =========================================================================
    // 3. COMPOSITE 10-PART NEURAL QUANT CHRONOMETER (THREE.Group)
    // =========================================================================
    const quantGroup = new THREE.Group();
    quantGroup.position.set(0, 0.14, 0);
    scene.add(quantGroup);

    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5c451,
      metalness: 0.95,
      roughness: 0.14,
      anisotropy: 0.85,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
    });
    const titaniumMat = new THREE.MeshStandardMaterial({
      color: 0x5b6b8c,
      metalness: 0.85,
      roughness: 0.34,
    });
    const obsidianMat = new THREE.MeshStandardMaterial({
      color: 0x162040,
      metalness: 0.38,
      roughness: 0.58,
    });
    const dysonPlateMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.86,
      roughness: 0.22,
      clearcoat: 0.75,
      clearcoatRoughness: 0.12,
      emissive: new THREE.Color(0x0b1633),
      emissiveIntensity: 0.32,
    });

    // Part 1: Stepped Lathe Plinth Base (grounded flush at y = -1.39 in world)
    const lathePts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.96, 0.0),
      new THREE.Vector2(0.94, 0.06),
      new THREE.Vector2(0.78, 0.12),
      new THREE.Vector2(0.74, 0.18),
      new THREE.Vector2(0.46, 0.24),
      new THREE.Vector2(0.0, 0.24),
    ];
    const plinthGeo = new THREE.LatheGeometry(lathePts, 48);
    const plinthMesh = new THREE.Mesh(plinthGeo, obsidianMat);
    plinthMesh.position.y = -1.53;
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    quantGroup.add(plinthMesh);

    // Part 2: Brushed gold plinth collar ring
    const collarGeo = new THREE.TorusGeometry(0.76, 0.022, 16, 64);
    const collarRing = new THREE.Mesh(collarGeo, goldMat);
    collarRing.rotation.x = Math.PI / 2;
    collarRing.position.y = -1.36;
    quantGroup.add(collarRing);

    // Part 3: Dyson Star Core (Spherical GLSL Solar Plasma + Fresnel Corona Halo)
    const coreGeo = new THREE.SphereGeometry(0.43, 48, 36);
    const coreShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulseEnergy: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPulseEnergy;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        void main() {
          vec3 n = normalize(normal);
          float cell = sin(position.x * 8.5 + uTime * 2.2)
                     * cos(position.y * 8.5 - uTime * 1.8)
                     * sin(position.z * 8.5 + uTime * 1.5);
          vec3 displaced = position + n * (cell * (0.018 + uPulseEnergy * 0.032));
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);

          vLocalPos = displaced;
          vNormal = normalize(normalMatrix * n);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPulseEnergy;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying vec3 vLocalPos;

        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - max(0.0, dot(viewDir, normalize(vNormal))), 2.1);

          // Multi-band solar convection turbulence
          float plasma1 = sin(vLocalPos.x * 9.0 + uTime * 2.0) + cos(vLocalPos.y * 10.0 - uTime * 1.7);
          float plasma2 = sin(vLocalPos.z * 11.0 + uTime * 2.4) * cos((vLocalPos.x + vLocalPos.y) * 7.0);
          float heat = clamp(0.5 + 0.25 * plasma1 + 0.35 * plasma2 + uPulseEnergy * 0.35, 0.0, 1.0);

          vec3 deepCore = vec3(0.28, 0.14, 0.58);
          vec3 plasmaTeal = vec3(0.133, 0.85, 0.93);
          vec3 solarGold = vec3(1.0, 0.78, 0.22);
          vec3 whiteHot = vec3(1.0, 0.96, 0.84);

          vec3 col = mix(deepCore, plasmaTeal, smoothstep(0.12, 0.60, heat));
          col = mix(col, solarGold, smoothstep(0.50, 0.88, heat));
          col = mix(col, whiteHot, fresnel * 0.72 + uPulseEnergy * 0.35);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const innerCoreMesh = new THREE.Mesh(coreGeo, coreShaderMat);
    quantGroup.add(innerCoreMesh);

    // Volumetric Corona Glow Halo around the Dyson Star
    const coronaGeo = new THREE.SphereGeometry(0.56, 36, 28);
    const coronaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uPulseEnergy: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uPulseEnergy;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = pow(clamp(dot(viewDir, -normalize(vNormal)), 0.0, 1.0), 2.2);
          vec3 col = mix(vec3(0.133, 0.827, 0.933), vec3(0.988, 0.749, 0.141), 0.52 + uPulseEnergy * 0.42);
          float alpha = rim * (0.68 + uPulseEnergy * 0.35);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const coronaMesh = new THREE.Mesh(coronaGeo, coronaMat);
    quantGroup.add(coronaMesh);

    // Part 4: Segmented Dyson Sphere Collector Swarm (54 Instanced Hexagonal Plates on Fibonacci Sphere)
    const DYSON_GROUP = new THREE.Group();
    quantGroup.add(DYSON_GROUP);

    const DYSON_PLATE_COUNT = 54;
    const dysonPlateGeo = new THREE.CylinderGeometry(0.115, 0.132, 0.024, 6);
    const dysonPlateInst = new THREE.InstancedMesh(
      dysonPlateGeo,
      dysonPlateMat,
      DYSON_PLATE_COUNT,
    );
    dysonPlateInst.castShadow = true;
    dysonPlateInst.receiveShadow = true;
    dysonPlateInst.frustumCulled = false;

    const dysonGoldTint = new THREE.Color(0xfbbf24);
    const dysonSlateTint = new THREE.Color(0x6366f1);
    const dysonTealAccent = new THREE.Color(0x2dd4bf);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const dysonMeta = Array.from({ length: DYSON_PLATE_COUNT }, (_, i) => {
      // Leave slight polar openings so the Dyson star remains visible from top & bottom
      const y = 1 - ((i + 0.5) / DYSON_PLATE_COUNT) * 2;
      const clampedY = y * 0.88;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - clampedY * clampedY));
      const theta = goldenAngle * i;
      const dirX = Math.cos(theta) * radiusAtY;
      const dirY = clampedY;
      const dirZ = Math.sin(theta) * radiusAtY;
      return {
        dirX,
        dirY,
        dirZ,
        baseRadius: i % 2 === 0 ? 0.69 : 0.73,
        phase: i * 0.53,
        scale: i % 5 === 0 ? 1.08 : 0.94,
      };
    });

    for (let i = 0; i < DYSON_PLATE_COUNT; i++) {
      dysonPlateInst.setColorAt(
        i,
        i % 3 === 0
          ? dysonGoldTint
          : i % 5 === 0
            ? dysonTealAccent
            : dysonSlateTint,
      );
    }
    if (dysonPlateInst.instanceColor)
      dysonPlateInst.instanceColor.needsUpdate = true;
    DYSON_GROUP.add(dysonPlateInst);

    // Part 5: Dyson Geodesic Structural Shell & Interlocking Spherical Meridian Bands
    const cageGeo = new THREE.IcosahedronGeometry(0.83, 2);
    const cageEdges = new THREE.EdgesGeometry(cageGeo);
    const cageWireMat = new THREE.LineBasicMaterial({
      color: isDarkInit ? 0xd4af6a : 0x475569,
      transparent: true,
      opacity: isDarkInit ? 0.34 : 0.38,
    });
    const cageMesh = new THREE.LineSegments(cageEdges, cageWireMat);
    DYSON_GROUP.add(cageMesh);

    const meridianGeo1 = new THREE.TorusGeometry(0.88, 0.016, 12, 72);
    const meridianRing1 = new THREE.Mesh(meridianGeo1, goldMat);
    meridianRing1.rotation.set(Math.PI / 2, 0.22, 0);
    DYSON_GROUP.add(meridianRing1);

    const meridianGeo2 = new THREE.TorusGeometry(0.93, 0.014, 12, 72);
    const meridianRing2 = new THREE.Mesh(meridianGeo2, titaniumMat);
    meridianRing2.rotation.set(0.35, Math.PI / 3, 0.45);
    DYSON_GROUP.add(meridianRing2);

    // Part 6, 7, 8: Precision Calibrated Gyroscope Assembly (Gold + Titanium + Equator Holo Scan)
    const gyroGroup1 = new THREE.Group();
    gyroGroup1.rotation.set(0.48, 0.25, 0);
    quantGroup.add(gyroGroup1);

    const ring1Geo = new THREE.TorusGeometry(1.24, 0.026, 18, 84);
    const ring1 = new THREE.Mesh(ring1Geo, goldMat);
    ring1.castShadow = true;
    gyroGroup1.add(ring1);

    // 24 Instanced Gold Calibration Pins mounted directly onto Gyro Ring 1
    const PIN_COUNT = 24;
    const pinGeo = new THREE.BoxGeometry(0.022, 0.075, 0.022);
    const pinInst = new THREE.InstancedMesh(pinGeo, goldMat, PIN_COUNT);
    for (let i = 0; i < PIN_COUNT; i++) {
      const a = (i / PIN_COUNT) * Math.PI * 2;
      _scratchVec.set(Math.cos(a) * 1.24, Math.sin(a) * 1.24, 0);
      _scratchQuat.setFromAxisAngle(_scratchZAxis, a + Math.PI / 2);
      _scratchScale.set(1, i % 3 === 0 ? 1.45 : 0.85, 1);
      _scratchMat.compose(_scratchVec, _scratchQuat, _scratchScale);
      pinInst.setMatrixAt(i, _scratchMat);
    }
    pinInst.instanceMatrix.needsUpdate = true;
    pinInst.computeBoundingSphere();
    gyroGroup1.add(pinInst);

    // Gyro Ring 2 (Milled Titanium)
    const ring2Geo = new THREE.TorusGeometry(1.42, 0.022, 16, 84);
    const ring2 = new THREE.Mesh(ring2Geo, titaniumMat);
    ring2.rotation.set(-0.58, 0.45, 0.32);
    ring2.castShadow = true;
    quantGroup.add(ring2);

    // Gyro Ring 3 (Fine Champagne Accent Orbit)
    const ring3Geo = new THREE.TorusGeometry(1.58, 0.012, 12, 84);
    const ring3 = new THREE.Mesh(ring3Geo, goldMat);
    ring3.rotation.set(1.05, -0.35, 0.18);
    quantGroup.add(ring3);

    // Part 9: Additive Holographic Equator Sweep Arc (GLSL ShaderMaterial)
    const sweepGeo = new THREE.RingGeometry(1.66, 1.74, 96);
    sweepGeo.rotateX(Math.PI / 2);
    const sweepMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPulseEnergy: { value: 0 },
        uIsDark: { value: isDarkInit ? 1.0 : 0.0 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPulseEnergy;
        uniform float uIsDark;
        varying vec3 vPos;
        void main() {
          float angle = atan(vPos.z, vPos.x);
          float sweep1 = pow(max(0.0, cos(angle - uTime * 1.6)), 6.0);
          float sweep2 = pow(max(0.0, cos(angle + uTime * 1.1 + 3.14)), 8.0);
          vec3 teal = mix(vec3(0.03, 0.52, 0.48), vec3(0.176, 0.831, 0.749), uIsDark);
          vec3 champagne = mix(vec3(0.74, 0.50, 0.06), vec3(0.92, 0.80, 0.56), uIsDark);
          vec3 col = mix(teal, champagne, sweep2);
          float alpha = (sweep1 * 0.75 + sweep2 * 0.55 + 0.08 + uPulseEnergy * 0.35);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
    sweepMesh.rotation.z = 0.14;
    quantGroup.add(sweepMesh);

    // Part 10: 8 Curved 3D Neural Synaptic Conduits + Pre-sampled Traveling Data Packets
    const CONDUIT_COUNT = 8;
    const SAMPLES_PER_CURVE = 96;
    const conduitGeometries: THREE.TubeGeometry[] = [];
    const curveLut = new Float32Array(CONDUIT_COUNT * SAMPLES_PER_CURVE * 3);

    const conduitMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      metalness: 0.7,
      roughness: 0.32,
      transparent: true,
      opacity: 0.65,
    });

    for (let c = 0; c < CONDUIT_COUNT; c++) {
      const a = (c / CONDUIT_COUNT) * Math.PI * 2;
      const aMid = a + 0.45;
      const aTop = a + 0.9;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * 1.55, -1.36, Math.sin(a) * 1.55),
        new THREE.Vector3(Math.cos(aMid) * 1.72, -0.58, Math.sin(aMid) * 1.72),
        new THREE.Vector3(
          Math.cos(aTop) * 0.92,
          0.05 + (c % 2 === 0 ? 0.28 : -0.18),
          Math.sin(aTop) * 0.92,
        ),
        new THREE.Vector3(
          Math.cos(aTop + 0.4) * 0.48,
          0.0,
          Math.sin(aTop + 0.4) * 0.48,
        ),
      ]);

      const tubeGeo = new THREE.TubeGeometry(curve, 44, 0.009, 6, false);
      conduitGeometries.push(tubeGeo);
      const tubeMesh = new THREE.Mesh(tubeGeo, conduitMat);
      quantGroup.add(tubeMesh);

      for (let s = 0; s < SAMPLES_PER_CURVE; s++) {
        const pt = curve.getPointAt(s / (SAMPLES_PER_CURVE - 1), _scratchVec);
        const offset = (c * SAMPLES_PER_CURVE + s) * 3;
        curveLut[offset] = pt.x;
        curveLut[offset + 1] = pt.y;
        curveLut[offset + 2] = pt.z;
      }
    }

    // 24 Synaptic Data Packets racing along the 8 3D conduits
    const PACKET_COUNT = 24;
    const packetGeo = new THREE.OctahedronGeometry(0.036, 0);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const packetInst = new THREE.InstancedMesh(
      packetGeo,
      packetMat,
      PACKET_COUNT,
    );
    packetInst.frustumCulled = false;

    const goldColor = new THREE.Color(0xf5dfb0);
    const tealColor = new THREE.Color(0x5eead4);
    const indigoColor = new THREE.Color(0x818cf8);

    const packetMeta = Array.from({ length: PACKET_COUNT }, (_, i) => ({
      conduit: i % CONDUIT_COUNT,
      phase: (i / PACKET_COUNT) * 1.7,
      speed: 0.24 + (i % 4) * 0.06,
      scale: 0.85 + (i % 3) * 0.22,
    }));
    for (let i = 0; i < PACKET_COUNT; i++) {
      packetInst.setColorAt(i, i % 2 === 0 ? tealColor : goldColor);
    }
    if (packetInst.instanceColor) packetInst.instanceColor.needsUpdate = true;
    quantGroup.add(packetInst);

    // =========================================================================
    // 4. ORBITING QUANTUM LIQUIDITY SWARM (84 Instanced Nodes) + STARLIGHT DUST
    // =========================================================================
    const NODE_COUNT = 84;
    const nodeGeo = new THREE.OctahedronGeometry(0.034, 0);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.82,
      roughness: 0.18,
    });
    const instancedNodes = new THREE.InstancedMesh(
      nodeGeo,
      nodeMat,
      NODE_COUNT,
    );
    instancedNodes.frustumCulled = false;

    const nodeMeta = Array.from({ length: NODE_COUNT }, (_, i) => ({
      angle: (i / NODE_COUNT) * Math.PI * 2,
      radius: 1.38 + (i % 6) * 0.17,
      speed: (i % 2 === 0 ? 1 : -1) * (0.18 + (i % 5) * 0.065),
      yAmp: 0.28 + (i % 4) * 0.18,
      phase: i * 0.61,
      scale: 0.72 + (i % 4) * 0.2,
    }));
    for (let i = 0; i < NODE_COUNT; i++) {
      instancedNodes.setColorAt(
        i,
        i % 3 === 0 ? goldColor : i % 3 === 1 ? tealColor : indigoColor,
      );
    }
    if (instancedNodes.instanceColor)
      instancedNodes.instanceColor.needsUpdate = true;
    quantGroup.add(instancedNodes);

    // Ambient volumetric quantum dust points
    const DUST_COUNT = isSoftwareGl || width < 600 ? 60 : 180;
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    const dustColors = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      const r = 1.4 + Math.random() * 2.2;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.45) * 2.3;
      dustPositions[i * 3] = Math.cos(theta) * r;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = Math.sin(theta) * r;

      const c = i % 3 === 0 ? goldColor : i % 3 === 1 ? tealColor : indigoColor;
      dustColors[i * 3] = c.r;
      dustColors[i * 3 + 1] = c.g;
      dustColors[i * 3 + 2] = c.b;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(dustPositions, 3),
    );
    dustGeo.setAttribute("color", new THREE.BufferAttribute(dustColors, 3));
    const glowSpriteTex = createGlowSpriteTexture();
    const dustMat = new THREE.PointsMaterial({
      size: 0.09,
      map: glowSpriteTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    quantGroup.add(dustPoints);

    // =========================================================================
    // 4b. THE MARKETS: COINS ON TWO ORBITS AROUND THE CORE
    // =========================================================================
    const orbitLineMat = new THREE.LineBasicMaterial({
      color: 0xb5832a,
      transparent: true,
      opacity: 0.32,
    });
    const orbitGeometries: THREE.BufferGeometry[] = [];
    const orbitEulers = COIN_ORBITS.map(
      (o) => new THREE.Euler(o.tiltX, 0, o.tiltZ),
    );
    COIN_ORBITS.forEach((o, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 160; k++) {
        const a = (k / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      orbitGeometries.push(geo);
      const loop = new THREE.LineLoop(geo, orbitLineMat);
      loop.rotation.copy(orbitEulers[i]);
      quantGroup.add(loop);
    });

    const coinRimGeo = new THREE.CylinderGeometry(
      COIN_RADIUS,
      COIN_RADIUS,
      0.05,
      48,
      1,
      true,
    );
    coinRimGeo.rotateX(Math.PI / 2);
    const coinFaceGeo = new THREE.CircleGeometry(COIN_RADIUS, 48);
    const coinFaceTextures: THREE.CanvasTexture[] = [];
    const coinFaceMats: THREE.MeshBasicMaterial[] = [];
    const coinMeshes: THREE.Group[] = [];
    const coinHitTargets: THREE.Mesh[] = [];
    ORBIT_COINS.forEach((coin, i) => {
      const tex = createCoinFaceTexture(coin);
      tex.anisotropy = maxAniso;
      coinFaceTextures.push(tex);
      // Unlit and outside tone mapping: a brand colour stays that brand's colour under any stage light.
      // The sheen is painted into the face; the lit gold rim gives the coin its body.
      const faceMat = new THREE.MeshBasicMaterial({
        map: tex,
        toneMapped: false,
      });
      coinFaceMats.push(faceMat);
      const group = new THREE.Group();
      const rim = new THREE.Mesh(coinRimGeo, goldMat);
      rim.castShadow = true;
      const front = new THREE.Mesh(coinFaceGeo, faceMat);
      front.position.z = 0.025;
      front.userData.coin = i;
      const back = new THREE.Mesh(coinFaceGeo, faceMat);
      back.position.z = -0.025;
      back.rotation.y = Math.PI;
      group.add(rim, front, back);
      quantGroup.add(group);
      coinMeshes.push(group);
      coinHitTargets.push(front);
    });

    const _coinWobble = new THREE.Quaternion();
    const _coinWorld = new THREE.Vector3();
    const _coreWorld = new THREE.Vector3();
    const _coreNdc = new THREE.Vector3();
    const CORE_RADIUS = 1.0;
    // Label widths are read now and then, never in the same pass that writes positions.
    const coinLabelWidths: number[] = [];
    let coinFrame = 0;
    function updateCoins(elapsed: number, energyBoost: number) {
      if (coinFrame++ % 12 === 0) {
        for (let i = 0; i < coinMeshes.length; i++)
          coinLabelWidths[i] = coinLabelRefs.current[i]?.offsetWidth ?? 0;
      }
      const w = container!.clientWidth || width;
      const h = container!.clientHeight || height;
      // Pixels per world unit at distance 1 from the camera.
      const focal =
        (h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) *
        camera.zoom;
      quantGroup.getWorldPosition(_coreWorld);
      const coreDist = camera.position.distanceTo(_coreWorld);
      _coreNdc.copy(_coreWorld).project(camera);
      const coreX = (_coreNdc.x * 0.5 + 0.5) * w;
      const coreY = (-_coreNdc.y * 0.5 + 0.5) * h;

      for (let i = 0; i < coinMeshes.length; i++) {
        const slot = COIN_SLOTS[i];
        const orbit = COIN_ORBITS[slot.orbit];
        const a = slot.phase + elapsed * COIN_SPEED * (1 + energyBoost * 0.9);
        const coin = coinMeshes[i];
        coin.position
          .set(Math.cos(a) * orbit.radius, 0, Math.sin(a) * orbit.radius)
          .applyEuler(orbitEulers[slot.orbit]);
        // Faces stay towards the viewer, with a slow turn so the rim catches the light.
        _coinWobble.setFromAxisAngle(
          _scratchAxis,
          Math.sin(elapsed * 0.8 + i * 1.7) * 0.26,
        );
        coin.quaternion.copy(camera.quaternion).multiply(_coinWobble);
        coin.getWorldPosition(_coinWorld);
        const dist = camera.position.distanceTo(_coinWorld);
        // Perspective alone makes the nearest coin twice the farthest and lets it cover the sphere.
        // Half of that difference is taken back, so depth still reads and no coin dominates.
        const depthScale = Math.sqrt(dist / coreDist);
        coin.scale.setScalar(depthScale * (1 + energyBoost * 0.18));

        const label = coinLabelRefs.current[i];
        if (!label) continue;
        _scratchVec.copy(_coinWorld).project(camera);
        const x = (_scratchVec.x * 0.5 + 0.5) * w;
        const y = (-_scratchVec.y * 0.5 + 0.5) * h;
        const coinPx = (COIN_RADIUS * depthScale * focal) / dist;
        const behindCore =
          dist > coreDist &&
          Math.hypot(x - coreX, y - coreY) <
            (CORE_RADIUS * focal) / coreDist + coinPx * 0.4;
        // Nearer coins carry a full label; far ones recede with the coin.
        const near = THREE.MathUtils.clamp(
          (coreDist + orbit.radius - dist) / (orbit.radius * 2),
          0,
          1,
        );
        // A label never leaves the stage: near an edge it stays inside while its coin moves on.
        const half = (coinLabelWidths[i] || 0) / 2 + 4;
        const lx = THREE.MathUtils.clamp(x, half, Math.max(half, w - half));
        label.style.transform = `translate(${lx.toFixed(1)}px, ${(y + coinPx + 5).toFixed(1)}px) translateX(-50%) scale(${(0.9 + near * 0.1).toFixed(3)})`;
        label.style.opacity = behindCore ? "0" : (0.74 + near * 0.26).toFixed(2);
        label.style.pointerEvents = behindCore ? "none" : "auto";
        label.style.zIndex = String(10 + Math.round(near * 10));
      }
    }

    // One place that dresses the whole scene for its stage. On a light page the model is a dark, polished
    // object with gold and teal accents: additive glows and pale tints, made for a dark page, vanish on white.
    const stageColor = new THREE.Color();
    const applyStage = (isDark: boolean) => {
      renderer.toneMapping = isDark
        ? THREE.ACESFilmicToneMapping
        : THREE.NeutralToneMapping;
      renderer.toneMappingExposure = isDark ? 1.18 : 1.02;

      dialMat.map = isDark ? darkDialTex : lightDialTex;
      dialMat.needsUpdate = true;
      hemiLight.color.setHex(isDark ? 0x93c5fd : 0xffffff);
      hemiLight.groundColor.setHex(isDark ? 0x0f172a : 0xd9d2c3);
      hemiLight.intensity = isDark ? 0.85 : 0.95;
      keyLight.intensity = isDark ? 2.5 : 3.1;
      rimLight.intensity = isDark ? 1.9 : 2.6;
      violetRimLight.intensity = isDark ? 1.45 : 0.9;

      goldMat.color.setHex(isDark ? 0xf5c451 : 0xd9a034);
      goldMat.roughness = isDark ? 0.14 : 0.2;
      titaniumMat.color.setHex(isDark ? 0x5b6b8c : 0x232b3d);
      titaniumMat.roughness = isDark ? 0.34 : 0.26;
      obsidianMat.color.setHex(isDark ? 0x162040 : 0x0d1322);
      obsidianMat.metalness = isDark ? 0.38 : 0.6;
      obsidianMat.roughness = isDark ? 0.58 : 0.3;
      dysonPlateMat.emissive.setHex(isDark ? 0x0b1633 : 0x05070d);
      dysonPlateMat.emissiveIntensity = isDark ? 0.32 : 0.18;
      dysonPlateMat.roughness = isDark ? 0.22 : 0.18;

      // Light stage: a two-tone gold shell with a few teal plates. An even dark/bright
      // alternation on a round body reads as a football.
      for (let i = 0; i < DYSON_PLATE_COUNT; i++) {
        const hex = isDark
          ? i % 3 === 0
            ? 0xfbbf24
            : i % 5 === 0
              ? 0x2dd4bf
              : 0x6366f1
          : i % 9 === 4
            ? 0x0fa697
            : i % 2 === 0
              ? 0xdba53a
              : 0xbf8620;
        dysonPlateInst.setColorAt(i, stageColor.setHex(hex));
      }
      if (dysonPlateInst.instanceColor)
        dysonPlateInst.instanceColor.needsUpdate = true;

      cageWireMat.color.setHex(isDark ? 0xd4af6a : 0xb5832a);
      cageWireMat.opacity = isDark ? 0.34 : 0.62;
      conduitMat.color.setHex(isDark ? 0x1e3a5f : 0x18213a);
      conduitMat.opacity = isDark ? 0.65 : 0.55;

      const accentGold = isDark ? 0xf5dfb0 : 0xc4860c;
      const accentTeal = isDark ? 0x5eead4 : 0x0b8f84;
      const accentThird = isDark ? 0x818cf8 : 0xd9b566;
      for (let i = 0; i < PACKET_COUNT; i++) {
        packetInst.setColorAt(
          i,
          stageColor.setHex(i % 2 === 0 ? accentTeal : accentGold),
        );
      }
      if (packetInst.instanceColor) packetInst.instanceColor.needsUpdate = true;
      for (let i = 0; i < NODE_COUNT; i++) {
        instancedNodes.setColorAt(
          i,
          stageColor.setHex(
            i % 3 === 0 ? accentGold : i % 3 === 1 ? accentTeal : accentThird,
          ),
        );
      }
      if (instancedNodes.instanceColor)
        instancedNodes.instanceColor.needsUpdate = true;
      for (let i = 0; i < DUST_COUNT; i++) {
        stageColor.setHex(
          i % 3 === 0 ? accentGold : i % 3 === 1 ? accentTeal : accentThird,
        );
        dustColors[i * 3] = stageColor.r;
        dustColors[i * 3 + 1] = stageColor.g;
        dustColors[i * 3 + 2] = stageColor.b;
      }
      dustGeo.attributes.color.needsUpdate = true;
      dustMat.blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
      dustMat.opacity = isDark ? 0.72 : 0.5;
      dustMat.size = isDark ? 0.09 : 0.06;
      dustMat.needsUpdate = true;

      sweepMat.blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
      sweepMat.uniforms.uIsDark.value = isDark ? 1.0 : 0.0;
      sweepMat.needsUpdate = true;
      waveMat.uniforms.uIsDark.value = isDark ? 1.0 : 0.0;

      // On the light stage the coins are the things in orbit; the anonymous node swarm steps back.
      instancedNodes.visible = isDark;
      orbitLineMat.color.setHex(isDark ? 0xd4af6a : 0xb5832a);
      orbitLineMat.opacity = isDark ? 0.26 : 0.34;

      contactShadowMat.opacity = isDark ? 0.58 : 0.5;
      contactShadow.scale.setScalar(isDark ? 1 : 1.5);
    };
    applyStage(isDarkInit);

    sceneCtxRef.current = {
      dialMat,
      lightDialTex,
      darkDialTex,
      cageWireMat,
      hemiLight,
      waveMat,
      applyStage,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // =========================================================================
    // 5. INTERACTION: POINTER HOVER WAVE + CLICK SHOCKWAVE PULSE
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    let pulseEnergy = 0;
    let pulseAge = 99;
    const hoverTarget = new THREE.Vector2(0, 0);
    const hoverCurrent = new THREE.Vector2(0, 0);

    const triggerPulse = (worldX = 0, worldZ = 0) => {
      pulseEnergy = 1.0;
      pulseAge = 0;
      waveMat.uniforms.uPulseOrigin.value.set(worldX, worldZ);
    };
    pulseTriggerRef.current = () => triggerPulse(0, 0);

    const handlePointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _scratchPointerNdc.x =
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      _scratchPointerNdc.y =
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(_scratchPointerNdc, camera);
      if (raycaster.ray.intersectPlane(_groundPlane, _rayHit)) {
        hoverTarget.set(
          THREE.MathUtils.clamp(_rayHit.x, -3.0, 3.0),
          THREE.MathUtils.clamp(_rayHit.z, -3.0, 3.0),
        );
      }
    };

    let downX = 0;
    let downY = 0;
    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const handleCanvasClick = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      _scratchPointerNdc.x =
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      _scratchPointerNdc.y =
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(_scratchPointerNdc, camera);
      const coinHit = raycaster.intersectObjects(coinHitTargets, false)[0];
      if (coinHit) {
        triggerPulse(0, 0);
        selectMarketRef.current?.(ORBIT_COINS[coinHit.object.userData.coin].symbol);
        return;
      }
      if (raycaster.ray.intersectPlane(_groundPlane, _rayHit)) {
        triggerPulse(_rayHit.x, _rayHit.z);
      } else {
        triggerPulse(0, 0);
      }
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("mousemove", handlePointerMove);
    renderer.domElement.addEventListener("click", handleCanvasClick);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 560;
      const h = container.clientHeight || 300;
      camera.aspect = w / h;
      camera.zoom = fitZoom(w, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // =========================================================================
    // 6. RENDER LOOP (Hardware rAF / Software-WebGL Paced afterDraw)
    // =========================================================================
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateInstanced(elapsed: number, energyBoost: number) {
      // Dyson Sphere Collector Panels (breathing aperture + shockwave opening)
      for (let d = 0; d < DYSON_PLATE_COUNT; d++) {
        const dm = dysonMeta[d];
        const wave = Math.sin(elapsed * 1.5 + dm.phase) * 0.018;
        const r = dm.baseRadius + wave + energyBoost * 0.15;
        _scratchRadialDir.set(dm.dirX, dm.dirY, dm.dirZ).normalize();
        _scratchVec.copy(_scratchRadialDir).multiplyScalar(r);
        _scratchQuat.setFromUnitVectors(_scratchAxis, _scratchRadialDir);
        _scratchScale.setScalar(dm.scale * (1 + energyBoost * 0.08));
        _scratchMat.compose(_scratchVec, _scratchQuat, _scratchScale);
        dysonPlateInst.setMatrixAt(d, _scratchMat);
      }
      dysonPlateInst.instanceMatrix.needsUpdate = true;

      // Orbit swarm
      for (let i = 0; i < NODE_COUNT; i++) {
        const m = nodeMeta[i];
        const a = m.angle + elapsed * m.speed * (1 + energyBoost * 0.45);
        const r =
          m.radius + energyBoost * 0.22 * Math.sin(m.phase + elapsed * 4.0);
        _scratchVec.set(
          Math.cos(a) * r,
          Math.sin(a * 1.4 + m.phase) * m.yAmp,
          Math.sin(a) * r,
        );
        _scratchQuat.setFromAxisAngle(_scratchAxis, a * 2.0);
        _scratchScale.setScalar(m.scale * (1 + energyBoost * 0.28));
        _scratchMat.compose(_scratchVec, _scratchQuat, _scratchScale);
        instancedNodes.setMatrixAt(i, _scratchMat);
      }
      instancedNodes.instanceMatrix.needsUpdate = true;

      // Synaptic data packets racing along pre-sampled 3D conduits
      for (let p = 0; p < PACKET_COUNT; p++) {
        const pm = packetMeta[p];
        const t =
          (pm.phase + elapsed * pm.speed * (1 + energyBoost * 1.25)) % 1.0;
        const fIdx = t * (SAMPLES_PER_CURVE - 1);
        const idx0 = Math.floor(fIdx);
        const idx1 = Math.min(SAMPLES_PER_CURVE - 1, idx0 + 1);
        const frac = fIdx - idx0;

        const base0 = (pm.conduit * SAMPLES_PER_CURVE + idx0) * 3;
        const base1 = (pm.conduit * SAMPLES_PER_CURVE + idx1) * 3;

        _scratchVec.set(
          curveLut[base0],
          curveLut[base0 + 1],
          curveLut[base0 + 2],
        );
        _scratchVecB.set(
          curveLut[base1],
          curveLut[base1 + 1],
          curveLut[base1 + 2],
        );
        _scratchVec.lerp(_scratchVecB, frac);

        _scratchQuat.setFromAxisAngle(_scratchAxis, elapsed * 3.0 + p);
        _scratchScale.setScalar(pm.scale * (1 + energyBoost * 0.4));
        _scratchMat.compose(_scratchVec, _scratchQuat, _scratchScale);
        packetInst.setMatrixAt(p, _scratchMat);
      }
      packetInst.instanceMatrix.needsUpdate = true;
    }

    let lastFrame = -Infinity;
    function tick() {
      if (disposed) return;
      const now = performance.now();
      if (!isSoftwareGl && now - lastFrame < (width < 600 ? 40 : 30)) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      // Smooth exponential damping for pulse & hover
      pulseEnergy = THREE.MathUtils.damp(pulseEnergy, 0, 2.4, dt);
      pulseAge = Math.min(20, pulseAge + dt);
      hoverCurrent.x = THREE.MathUtils.damp(
        hoverCurrent.x,
        hoverTarget.x,
        5.0,
        dt,
      );
      hoverCurrent.y = THREE.MathUtils.damp(
        hoverCurrent.y,
        hoverTarget.y,
        5.0,
        dt,
      );

      waveMat.uniforms.uTime.value = elapsed;
      waveMat.uniforms.uPulseAge.value = pulseAge;
      waveMat.uniforms.uHoverPos.value.copy(hoverCurrent);

      coreShaderMat.uniforms.uTime.value = elapsed;
      coreShaderMat.uniforms.uPulseEnergy.value = pulseEnergy;

      coronaMat.uniforms.uTime.value = elapsed;
      coronaMat.uniforms.uPulseEnergy.value = pulseEnergy;

      sweepMat.uniforms.uTime.value = elapsed;
      sweepMat.uniforms.uPulseEnergy.value = pulseEnergy;

      underLight.intensity =
        1.6 + pulseEnergy * 2.2 + Math.sin(elapsed * 2.2) * 0.25;

      if (!prefersReduced) {
        innerCoreMesh.rotation.y = elapsed * 0.35;
        coronaMesh.rotation.y = -elapsed * 0.2;
        DYSON_GROUP.rotation.y = -elapsed * (isDarkInit ? 0.19 : 0.34);
        DYSON_GROUP.rotation.x = Math.sin(elapsed * 0.25) * 0.14;
        cageMesh.rotation.y = elapsed * 0.28;
        meridianRing1.rotation.z = elapsed * 0.32;
        meridianRing2.rotation.x = 0.35 + elapsed * 0.26;

        gyroGroup1.rotation.z = elapsed * (0.24 + pulseEnergy * 0.65);
        gyroGroup1.rotation.y = 0.25 + Math.sin(elapsed * 0.32) * 0.16;
        ring2.rotation.x = -0.58 + Math.sin(elapsed * 0.28) * 0.2;
        ring2.rotation.y = elapsed * 0.26;
        ring3.rotation.y = -elapsed * 0.2;
        sweepMesh.rotation.y = elapsed * 0.45;
        dustPoints.rotation.y = elapsed * 0.055;

        updateInstanced(elapsed, pulseEnergy);
      }

      controls.update();
      updateCoins(prefersReduced ? 0 : elapsed, pulseEnergy);
      renderer.render(scene, camera);

      if (!prefersReduced) {
        if (isSoftwareGl) afterDraw(tick);
        else frameId = requestAnimationFrame(tick);
      }
    }

    updateInstanced(0, 0);
    dysonPlateInst.computeBoundingSphere();
    instancedNodes.computeBoundingSphere();
    packetInst.computeBoundingSphere();

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener("resize", handleResize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("mousemove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleCanvasClick);
      controls.dispose();

      waveGeo.dispose();
      waveMat.dispose();
      dialGeo.dispose();
      dialMat.dispose();
      lightDialTex.dispose();
      darkDialTex.dispose();
      contactShadowGeo.dispose();
      contactShadowMat.dispose();
      shadowTex.dispose();
      plinthGeo.dispose();
      collarGeo.dispose();
      coreGeo.dispose();
      coreShaderMat.dispose();
      coronaGeo.dispose();
      coronaMat.dispose();
      dysonPlateGeo.dispose();
      dysonPlateMat.dispose();
      meridianGeo1.dispose();
      meridianGeo2.dispose();
      cageGeo.dispose();
      cageEdges.dispose();
      cageWireMat.dispose();
      ring1Geo.dispose();
      pinGeo.dispose();
      ring2Geo.dispose();
      ring3Geo.dispose();
      sweepGeo.dispose();
      sweepMat.dispose();
      conduitGeometries.forEach((g) => g.dispose());
      conduitMat.dispose();
      packetGeo.dispose();
      packetMat.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      glowSpriteTex.dispose();
      orbitGeometries.forEach((g) => g.dispose());
      orbitLineMat.dispose();
      coinRimGeo.dispose();
      coinFaceGeo.dispose();
      coinFaceMats.forEach((m) => m.dispose());
      coinFaceTextures.forEach((t) => t.dispose());
      goldMat.dispose();
      titaniumMat.dispose();
      obsidianMat.dispose();
      target.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      delete container.dataset.webgl;

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneCtxRef.current = null;
      pulseTriggerRef.current = null;
    };
  }, []);

  // Synchronize Three.js lighting and textures smoothly on theme toggle
  useEffect(() => {
    const ctx = sceneCtxRef.current;
    if (!ctx) return;
    ctx.applyStage(theme === "dark");
  }, [theme]);

  return (
    <div className="qx-stage relative w-full h-[250px] sm:h-[280px] lg:h-[305px] rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-subtle)] dark:bg-[#0D162B]/25">
      {/* Dedicated isolated WebGL mount node */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Each orbiting coin's ticker and 24h move. The scene moves these to follow the coins. */}
      <div className="qx-coin-layer">
        {ORBIT_COINS.map((coin, i) => {
          const change = parseChangePercentOrNull(
            market.tickers.get(coin.pair)?.changePercent24h,
            coin.pair,
          );
          return (
            <button
              key={coin.symbol}
              ref={(el) => {
                coinLabelRefs.current[i] = el;
              }}
              type="button"
              className="qx-coin-label"
              data-coin={coin.symbol}
              style={{ opacity: 0 }}
              onClick={() => onSelectMarket?.(coin.symbol)}
              aria-label={`Показать стратегии для ${coin.symbol}`}
              title={
                change === null
                  ? `Стратегии для ${coin.symbol}`
                  : `${coin.symbol}: изменение цены за 24 часа. Нажмите — стратегии для ${coin.symbol}`
              }
            >
              <b>{coin.symbol}</b>
              {change !== null && (
                <span data-dir={change < 0 ? "down" : "up"}>
                  {CHANGE_FORMAT.format(change)}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Caption and the one control. Solid surfaces only: no backdrop-filter over WebGL. */}
      <div className="qx-stage-bar">
        <div className="qx-stage-caption">
          <span className="qx-stage-title">Нейронная 3D-матрица VOLTEX</span>
          <span className="qx-stage-hint">
            <MousePointerClick aria-hidden="true" />
            Нажмите на монету — стратегии для неё · цена за 24 ч
          </span>
        </div>
        <button
          type="button"
          onClick={() => pulseTriggerRef.current?.()}
          className="qx-stage-pulse"
        >
          <Zap aria-hidden="true" />
          Импульс сети
        </button>
      </div>
    </div>
  );
};
