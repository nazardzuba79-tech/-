import * as THREE from 'three';
import { createSceneSequence, FLIP_SECONDS, MOBILE_SCENE_HEIGHT, MOBILE_SCENE_SPOTS, SCENE_HEIGHT, SCENE_INSTRUMENTS, SCENE_SPOTS, SCENE_WIDTH, STEP_SECONDS } from './v0MarketScene';
import { MEDALLION_URLS } from './v0MedallionArtwork';

export interface SceneController { setActive(active: boolean): void; dispose(): void }

export async function createCoinScene(host: HTMLElement, onChange: (ids: string[]) => void, onLost: () => void, compact = false, cancelled = () => false): Promise<SceneController | null> {
  const artwork = await Promise.all(SCENE_INSTRUMENTS.map(async instrument => {
    const image = new Image(); image.src = MEDALLION_URLS.get(instrument.id)!;
    await image.decode(); return { id: instrument.id, image };
  }));
  // An unmount/resize during decoding must not install an orphan GPU.
  if (cancelled()) return null;
  const spots = compact ? MOBILE_SCENE_SPOTS : SCENE_SPOTS;
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  // Keep the static medallions in the buffer. Only the rotating
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
  const textures = new Map(artwork.map(({ id, image }) => {
    const texture = own(new THREE.Texture(image)); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2; texture.needsUpdate = true; return [id, texture];
  }));
  const face = own(new THREE.CircleGeometry(1, 64));
  const rim = own(new THREE.CylinderGeometry(1, 1, .21, 64, 1, true).rotateX(Math.PI / 2));
  const bevel = own(new THREE.TorusGeometry(.975, .028, 6, 64));
  const bevelMaterial = own(new THREE.MeshBasicMaterial({ color: '#ffdf9c' }));
  const rimMaterial = own(new THREE.MeshStandardMaterial({ color: '#e6b866', metalness: .82, roughness: .24, side: THREE.DoubleSide }));
  scene.add(new THREE.AmbientLight('#d7e5ff', 2.2));
  const key = new THREE.DirectionalLight('#ffdf9d', 3); key.position.set(-150, 150, 500); scene.add(key);
  const sequence = createSceneSequence(spots.length);
  const coins = spots.map((spot, index) => {
    const group = new THREE.Group(); group.position.set(spot.x, -spot.y, 30); group.scale.setScalar(spot.r);
    const front = own(new THREE.MeshBasicMaterial({ map: textures.get(sequence.visible[index]), toneMapped: false }));
    const back = own(new THREE.MeshBasicMaterial({ map: textures.get(sequence.visible[index]), toneMapped: false }));
    group.add(new THREE.Mesh(rim, rimMaterial));
    const frontMesh = new THREE.Mesh(face, front); frontMesh.position.z = .106; group.add(frontMesh);
    const backMesh = new THREE.Mesh(face, back); backMesh.position.z = -.106; backMesh.rotation.y = Math.PI; group.add(backMesh);
    for (const z of [-.11, .11]) { const edge = new THREE.Mesh(bevel, bevelMaterial); edge.position.z = z; group.add(edge); }
    group.rotation.y = index % 2 ? -.17 : .15; group.rotation.z = index === 0 ? -.08 : .03;
    scene.add(group); return { group, front, back, turn: 0 };
  });

  // Original perspective-correct pedestal remains in the cleaned reference.
  // Never draw a second platform over the laptop.
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
    // Scissor limits pixels, not draw calls. Submit only medallions intersecting
    // the damaged region; include neighbours so their overlapping edges survive.
    coins.forEach((coin, index) => {
      const other = spots[index];
      coin.group.visible = !spot || (Math.abs(other.x - spot.x) < (other.r + spot.r) * 1.2
        && Math.abs(other.y - spot.y) < (other.r + spot.r) * 1.2);
    });
    renderer.render(scene, camera);
    coins.forEach(coin => { coin.group.visible = true; });
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
      coin.group.rotation.y = (coin.turn + ease) * Math.PI + (index % 2 ? -.17 : .15);
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
