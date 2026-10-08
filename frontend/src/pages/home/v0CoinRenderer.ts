import * as THREE from 'three';
import { createSceneSequence, FLIP_SECONDS, MOBILE_SCENE_HEIGHT, MOBILE_SCENE_SPOTS, SCENE_HEIGHT, SCENE_INSTRUMENTS, SCENE_SPOTS, SCENE_WIDTH, STEP_SECONDS } from './v0MarketScene';
import type { SceneInstrument } from './v0MarketScene';

export interface SceneController { setActive(active: boolean): void; dispose(): void }

// The v0 medallion finish, rendered locally at a bounded resolution. Ticker
// engraving deliberately replaces unlicensed/improvised corporate logo artwork.
function medallion(instrument: SceneInstrument) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const palette = instrument.metal === 'gold' ? ['#fff0ae', '#cf9c41', '#694313']
    : instrument.metal === 'silver' ? ['#f2f4f3', '#aeb9c4', '#4f5e73'] : ['#bcc4ce', '#465364', '#131f31'];
  const fill = ctx.createRadialGradient(75, 60, 8, 125, 128, 165);
  palette.forEach((color, i) => fill.addColorStop(i / 2, color));
  ctx.fillStyle = fill; ctx.fillRect(0, 0, 256, 256);
  for (let radius = 12; radius < 128; radius += 3) {
    ctx.beginPath(); ctx.arc(128, 128, radius, 0, Math.PI * 2);
    ctx.lineWidth = .5; ctx.strokeStyle = radius % 2 ? '#ffffff13' : '#00000010'; ctx.stroke();
  }
  for (const [radius, color, width] of [[121, '#171e2b99', 3], [118, '#fff7d6ba', 1.5], [108, '#ffffff44', 1]] as const) {
    ctx.beginPath(); ctx.arc(128, 128, radius, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }
  const text = instrument.ticker;
  let size = 54;
  do { ctx.font = `700 ${size--}px Arial, sans-serif`; } while (ctx.measureText(text).width > 184 && size > 20);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff9dfb0'; ctx.fillText(text, 128, 131);
  ctx.fillStyle = instrument.metal === 'graphite' ? '#f0e4c7' : '#283346'; ctx.fillText(text, 128, 129);
  ctx.font = '500 12px Arial, sans-serif'; ctx.fillStyle = instrument.metal === 'graphite' ? '#bdc9d6' : '#384553';
  ctx.fillText(instrument.market === 'spot' ? 'CRYPTO' : instrument.market.toUpperCase(), 128, 174);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, '#ffecb6'); glow.addColorStop(.3, '#ffc66566'); glow.addColorStop(1, '#ffaa0000');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createCoinScene(host: HTMLElement, onChange: (ids: string[]) => void, onLost: () => void, compact = false): SceneController {
  const spots = compact ? MOBILE_SCENE_SPOTS : SCENE_SPOTS;
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  // Keep the static seven medallions/platform in the buffer. Only the rotating
  // coin's bounded rectangle is cleared/redrawn, not the whole transparent hero.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, compact ? 1 : 1.5));
  renderer.setClearColor(0, 0);
  renderer.domElement.className = 'v0-coin-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, SCENE_WIDTH, 0, -height, .1, 4000);
  camera.position.z = 1800;
  const resources: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => { resources.push(resource); return resource; };
  const textures = new Map(SCENE_INSTRUMENTS.map(instrument => [instrument.id, own(medallion(instrument))]));
  const face = own(new THREE.CircleGeometry(1, 64));
  const rim = own(new THREE.CylinderGeometry(1, 1, .15, 64, 1, true).rotateX(Math.PI / 2));
  const rimMaterial = own(new THREE.MeshStandardMaterial({ color: '#d2b16d', metalness: .8, roughness: .3, side: THREE.DoubleSide }));
  scene.add(new THREE.AmbientLight('#d7e5ff', 2.2));
  const key = new THREE.DirectionalLight('#ffdf9d', 3); key.position.set(-150, 150, 500); scene.add(key);
  const sequence = createSceneSequence(spots.length);
  const coins = spots.map((spot, index) => {
    const group = new THREE.Group(); group.position.set(spot.x, -spot.y, 30); group.scale.setScalar(spot.r);
    const front = own(new THREE.MeshBasicMaterial({ map: textures.get(sequence.visible[index]), toneMapped: false }));
    const back = own(new THREE.MeshBasicMaterial({ map: textures.get(sequence.visible[index]), toneMapped: false }));
    group.add(new THREE.Mesh(rim, rimMaterial));
    const frontMesh = new THREE.Mesh(face, front); frontMesh.position.z = .079; group.add(frontMesh);
    const backMesh = new THREE.Mesh(face, back); backMesh.position.z = -.079; backMesh.rotation.y = Math.PI; group.add(backMesh);
    scene.add(group); return { group, front, back, turn: 0 };
  });

  // Adapted from the supplied v0 Platform: three metallic levels, lit concentric
  // rings and a soft vertical beam. No screenshot patches or fake UI raster.
  const platformX = compact ? 225 : 186, platformY = compact ? -317 : -638;
  const platform = new THREE.Group(); platform.position.set(platformX, platformY, -30); platform.rotation.x = .4; platform.scale.setScalar(compact ? 45 : 57);
  scene.add(platform);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number, rotation = 0) => {
    const mesh = new THREE.Mesh(own(geometry), own(material)); mesh.position.y = y; mesh.rotation.x = rotation; platform.add(mesh); return mesh;
  };
  add(new THREE.CylinderGeometry(2.35, 2.5, .3, 80), new THREE.MeshStandardMaterial({ color: '#263548', metalness: .9, roughness: .3 }), -.18);
  add(new THREE.CylinderGeometry(1.95, 2.05, .18, 80), new THREE.MeshStandardMaterial({ color: '#d9a443', metalness: .75, roughness: .25 }), .06);
  for (const radius of [2.36, 1.78, 1.25]) add(new THREE.TorusGeometry(radius, .024, 8, 96), new THREE.MeshBasicMaterial({ color: '#ffe1a0' }), .17, Math.PI / 2);
  const glow = own(glowTexture());
  add(new THREE.CircleGeometry(3.3, 64), new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }), .2, -Math.PI / 2);
  const beam = new THREE.Mesh(own(new THREE.PlaneGeometry(210, 350)), own(new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: .19, blending: THREE.AdditiveBlending, depthWrite: false })));
  beam.position.set(platformX, platformY + 162, -80); scene.add(beam);

  let disposed = false, contextLost = false, active = false, raf = 0, last = 0, lastDraw = 0, elapsed = 0, step = -1;
  let pending: { slot: number; id: string; committed: boolean } | null = null;
  const stats = { frames: 0, textures: 0, geometries: 0 };
  Object.defineProperty(host, '__voltexHeroSceneStats', { value: stats, configurable: true });
  const draw = (spot?: { x: number; y: number; r: number }) => {
    renderer.setScissorTest(Boolean(spot));
    if (spot) {
      // setScissor takes CSS renderer pixels, not drawing-buffer/DPR pixels.
      const sx = host.clientWidth / SCENE_WIDTH, sy = host.clientHeight / height, radius = spot.r * 1.2;
      renderer.setScissor(Math.floor((spot.x - radius) * sx), Math.floor((height - spot.y - radius) * sy), Math.ceil(radius * 2 * sx), Math.ceil(radius * 2 * sy));
    }
    renderer.render(scene, camera);
    // Plain local object, NOT DOM mutations on every frame. No global listener,
    // telemetry, style invalidation or React render for diagnostics.
    stats.frames++;
    stats.textures = renderer.info.memory.textures;
    stats.geometries = renderer.info.memory.geometries;
  };
  let lastProgress = -1;
  const frame = (now: number) => {
    if (!active || disposed) return;
    // Decorative motion gets a 30 fps GPU budget; the real terminal and page
    // retain their own refresh rates. No timers, network polling or React frames.
    if (now - lastDraw < 1000 / 30 - 1) { raf = requestAnimationFrame(frame); return; }
    lastDraw = now;
    if (last) elapsed += Math.min((now - last) / 1000, .1);
    last = now;
    const local = Math.max(0, elapsed - 1.4);
    const nextStep = elapsed < 1.4 ? -1 : Math.floor(local / STEP_SECONDS);
    if (nextStep !== step) {
      if (pending) { const coin = coins[pending.slot]; coin.turn++; coin.front.map = coin.back.map = textures.get(pending.id)!; }
      step = nextStep;
      lastProgress = -1;
      const next = sequence.next(); pending = { ...next, committed: false };
      const coin = coins[next.slot];
      const hidden = coin.turn % 2 === 0 ? coin.back : coin.front;
      hidden.map = textures.get(next.id)!; hidden.needsUpdate = true;
    }
    const progress = step < 0 ? 0 : Math.min((local - step * STEP_SECONDS) / FLIP_SECONDS, 1);
    if (pending && !pending.committed && progress >= .5) { pending.committed = true; onChange([...sequence.visible]); }
    coins.forEach((coin, index) => {
      const p = pending?.slot === index ? progress : 0;
      const ease = p * p * (3 - 2 * p);
      coin.group.rotation.y = (coin.turn + ease) * Math.PI;
      coin.group.rotation.x = Math.sin(p * Math.PI) * .13;
      coin.group.position.y = -spots[index].y + Math.sin(p * Math.PI) * 3;
    });
    if (pending && progress !== lastProgress) { draw(spots[pending.slot]); lastProgress = progress; }
    raf = requestAnimationFrame(frame);
  };
  const resize = () => { if (disposed || contextLost) return; renderer.setSize(host.clientWidth, host.clientHeight, false); draw(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; active = false; cancelAnimationFrame(raf); host.dataset.active = 'false'; onLost(); };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  return {
    setActive(value) {
      if (disposed || contextLost || active === value) return;
      active = value; host.dataset.active = String(value); last = 0;
      cancelAnimationFrame(raf); if (value) raf = requestAnimationFrame(frame);
    },
    dispose() {
      disposed = true; active = false; cancelAnimationFrame(raf); observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      resources.forEach(resource => resource.dispose());
      scene.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
