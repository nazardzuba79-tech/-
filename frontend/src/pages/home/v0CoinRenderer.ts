import * as THREE from 'three';
import { MOBILE_SCENE_HEIGHT, SCENE_HEIGHT, SCENE_INSTRUMENTS, SCENE_WIDTH, scenePose, sceneLabelOpacity, STEP_SECONDS } from './v0MarketScene';
import { MEDALLION_URLS } from './v0MedallionArtwork';

export interface SceneController { setActive(active: boolean): void; dispose(): void }

export async function createCoinScene(host: HTMLElement, onAvailability: (ready: boolean) => void, compact = false, cancelled = () => false): Promise<SceneController | null> {
  const artwork = await Promise.all(SCENE_INSTRUMENTS.map(async instrument => {
    const image = new Image(); image.src = MEDALLION_URLS.get(instrument.id)!;
    await image.decode(); return { id: instrument.id, image };
  }));
  // An unmount/resize during decoding must not install an orphan GPU.
  if (cancelled()) return null;
  const height = compact ? MOBILE_SCENE_HEIGHT : SCENE_HEIGHT;
  // Every object moves: clear the transparent canvas, never retain old scissor pixels.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
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
  scene.add(new THREE.AmbientLight('#d7e5ff', 2.2));
  const key = new THREE.DirectionalLight('#ffdf9d', 3); key.position.set(-150, 150, 500); scene.add(key);
  // Stable identity, including while behind the scene: no texture replacement.
  const coins = SCENE_INSTRUMENTS.map((instrument, index) => {
    const group = new THREE.Group();
    const front = own(new THREE.MeshBasicMaterial({ map: textures.get(instrument.id), toneMapped: false, transparent: true }));
    const back = own(front.clone());
    const edgeMaterial = own(new THREE.MeshBasicMaterial({ color: '#ffdf9c', transparent: true }));
    const rimMaterial = own(new THREE.MeshStandardMaterial({ color: '#e6b866', metalness: .82, roughness: .24, side: THREE.DoubleSide, transparent: true }));
    group.add(new THREE.Mesh(rim, rimMaterial));
    const frontMesh = new THREE.Mesh(face, front); frontMesh.position.z = .106; group.add(frontMesh);
    const backMesh = new THREE.Mesh(face, back); backMesh.position.z = -.106; backMesh.rotation.y = Math.PI; group.add(backMesh);
    for (const z of [-.11, .11]) { const edge = new THREE.Mesh(bevel, edgeMaterial); edge.position.z = z; group.add(edge); }
    scene.add(group);
    const label = host.querySelector<HTMLElement>(`[data-instrument="${instrument.id}"]`);
    return { group, materials: [front, back, edgeMaterial, rimMaterial], label,
      quote: label?.querySelector<HTMLElement>('.v0-quote'), image: label?.querySelector<HTMLElement>('.v0-coin-fallback'),
      // React can reuse label nodes across a responsive renderer remount.
      // Explicitly reset even invisible ones on the first draw.
      base: scenePose(index, 0, compact), visible: null as boolean | null };
  });
  let disposed = false, contextLost = false, requestedActive = false, active = false;
  let raf = 0, last = 0, lastDraw = 0, elapsed = 0, sx = 1, sy = 1;
  const stats = { frames: 0, textures: 0, geometries: 0, elapsed: 0, centre: 'BTCUSDT' };
  Object.defineProperty(host, '__voltexHeroSceneStats', { value: stats, configurable: true });
  const draw = () => {
    const poses = SCENE_INSTRUMENTS.map((_, index) => scenePose(index, elapsed, compact));
    coins.forEach((coin, index) => {
      const pose = poses[index], visible = pose.opacity > .001;
      coin.group.visible = visible;
      if (coin.label && visible !== coin.visible) {
        coin.label.style.visibility = visible ? 'visible' : 'hidden';
        coin.label.setAttribute('aria-hidden', String(!visible));
      }
      coin.visible = visible;
      if (!visible) return;
      coin.group.position.set(pose.x, -pose.y, pose.z);
      coin.group.scale.setScalar(pose.r);
      coin.group.rotation.set(pose.rotationX, pose.rotationY, pose.rotationZ);
      coin.materials.forEach(material => { material.opacity = pose.opacity; });
      if (coin.label) {
        coin.label.style.opacity = String(pose.opacity);
        coin.label.style.transform = `translate3d(${(pose.x - coin.base.x) * sx}px, ${(pose.y - coin.base.y) * sy}px, 0) translate(-50%, -50%)`;
        coin.label.style.zIndex = String(Math.round(pose.z + 300));
      }
      if (coin.image) coin.image.style.transform = `scale(${pose.r / coin.base.r})`;
      if (coin.quote) {
        coin.quote.style.transform = `translate(-50%, ${(pose.r - coin.base.r) * (compact ? 1.04 : 1.16) * sy}px)`;
        coin.quote.style.opacity = String(sceneLabelOpacity(pose, poses, compact));
      }
    });
    renderer.render(scene, camera);
    stats.frames++; stats.elapsed = elapsed;
    stats.centre = SCENE_INSTRUMENTS[Math.round(elapsed / STEP_SECONDS) % SCENE_INSTRUMENTS.length].id;
    stats.textures = renderer.info.memory.textures; stats.geometries = renderer.info.memory.geometries;
  };
  const tick = (now: number) => {
    if (!active || disposed || contextLost) return;
    if (last) elapsed += Math.max(0, now - last) / 1000;
    stats.elapsed = elapsed;
    last = now;
    if (now - lastDraw >= 1000 / 30) { lastDraw = now - (now - lastDraw) % (1000 / 30); draw(); }
    raf = requestAnimationFrame(tick);
  };
  const sync = () => {
    const next = requestedActive && !contextLost && !disposed;
    if (active === next) return;
    active = next; host.dataset.active = String(active);
    cancelAnimationFrame(raf); last = 0; lastDraw = 0;
    if (active) raf = requestAnimationFrame(tick);
  };
  const resize = () => {
    if (disposed || contextLost) return;
    const bounds = host.getBoundingClientRect();
    sx = bounds.width / SCENE_WIDTH; sy = bounds.height / height;
    renderer.setSize(bounds.width, bounds.height, false); draw();
  };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const lost = (event: Event) => {
    event.preventDefault(); contextLost = true; sync(); onAvailability(false);
  };
  const restored = () => {
    if (disposed) return;
    // Three restores GPU resources first. Keep the same timeline and identities;
    // resuming still depends on the current visibility/reduced-motion request.
    contextLost = false; resize(); onAvailability(true); sync();
  };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  renderer.domElement.addEventListener('webglcontextrestored', restored);
  host.dataset.active = 'false'; resize();
  return {
    setActive(value) { requestedActive = value; sync(); },
    dispose() {
      if (disposed) return;
      disposed = true; sync(); observer.disconnect(); cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener('webglcontextrestored', restored);
      resources.forEach(resource => resource.dispose()); scene.clear();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
