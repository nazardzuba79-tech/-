import { heroInstruments, orbitPose, SCENE_WIDTH } from './v0MarketScene';

export type SceneController = { setActive(active: boolean): void; dispose(): void };

/** Local SVG layers, one active-time RAF. No canvas, WebGL, textures or network. */
export function createCoinScene(host: HTMLElement, compact: boolean): SceneController {
  const nodes = Array.from(host.querySelectorAll<HTMLElement>('.v0-coin'));
  const instruments = heroInstruments(compact);
  let disposed = false, active = false, raf = 0, previous = 0, elapsed = 0, frames = 0;
  // Match the SVG guides at fractional CSS widths (clientWidth rounds pixels).
  let scale = host.getBoundingClientRect().width / SCENE_WIDTH;
  const draw = () => {
    instruments.forEach((_, i) => {
      const node = nodes[i];
      if (!node) return;
      const pose = orbitPose(i, elapsed, compact);
      node.style.transform = 'translate3d(' + pose.x * scale + 'px,' + pose.y * scale + 'px,0) translate(-50%,-50%)';
    });
    host.dataset.frames = String(++frames);
    host.dataset.elapsed = String(elapsed);
  };
  const resize = () => {
    scale = host.getBoundingClientRect().width / SCENE_WIDTH;
    nodes.forEach((node, i) => {
      node.style.left = '0';
      node.style.top = '0';
      node.style.width = orbitPose(i, 0, compact).radius * 2 * scale + 'px';
    });
    draw();
  };
  const tick = (now: number) => {
    if (disposed || !active) return;
    if (!previous) previous = now;
    if (now - previous >= 1000 / 30 - .5) {
      elapsed += Math.min((now - previous) / 1000, .1);
      previous = now;
      draw();
    }
    raf = requestAnimationFrame(tick);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  host.dataset.renderer = 'svg';
  host.dataset.ready = 'true';
  host.dataset.active = 'false';
  resize();
  return {
    setActive(value) {
      if (disposed || value === active) return;
      active = value;
      previous = 0;
      host.dataset.active = String(active);
      cancelAnimationFrame(raf);
      if (active) raf = requestAnimationFrame(tick);
    },
    dispose() {
      disposed = true;
      active = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      host.dataset.active = 'false';
      host.dataset.ready = 'false';
      nodes.forEach(node => { node.style.willChange = 'auto'; });
    },
  };
}
