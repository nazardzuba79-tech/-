import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TradingView-style ruler layer', () => {
  const source = readFileSync(resolve(__dirname, '../../components/TradingViewRulerLayer.tsx'), 'utf8');
  const terminal = readFileSync(resolve(__dirname, '../../components/TerminalChart.tsx'), 'utf8');

  test('is installed around the real VOLTEX PriceChart on both spot and futures', () => {
    expect(terminal).toContain("import { TradingViewRulerLayer } from './TradingViewRulerLayer'");
    expect(terminal).toContain('<TradingViewRulerLayer>');
    expect(terminal).toContain('<PriceChart');
  });

  test('renders a TradingView-like blue measurement area and compact information card', () => {
    expect(source).toContain("const BLUE = '#2962ff'");
    expect(source).toContain("background: 'rgba(41,98,255,0.20)'");
    expect(source).toContain('data-tradingview-ruler="true"');
    expect(source).toContain('data-ruler-label="true"');
    expect(source).toContain('formatDuration');
  });

  test('right click and Escape dismiss through the native eraser so state and persistence agree', () => {
    expect(source).toContain('onContextMenu={handleContextMenu}');
    expect(source).toContain("button[data-drawing-tool=\"erase\"]");
    expect(source).toContain("new KeyboardEvent('keydown', { key: 'Escape'");
    expect(source).toContain("button[data-drawing-tool=\"cursor\"]");
  });

  test('replaces an existing visible measurement before activating a new ruler', () => {
    expect(source).toContain("button[data-drawing-tool=\"ruler\"]");
    expect(source).toContain('replayRulerClickRef');
    expect(source).toContain('clearNativeRulers().then');
  });
});
