import { useRef } from 'react';

const DEFAULT_PRESETS = [0, 25, 50, 75, 100];

/**
 * Draggable percent-of-balance slider + snap-to preset buttons.
 *
 * `presets` names the buttons. The track always snaps to 0 as well, so the
 * size can be dragged back to nothing even when 0 is not offered as a
 * button. Omitting the prop reproduces the original behaviour exactly.
 */
export function PercentSlider({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
}: {
  value: number;
  onChange: (pct: number) => void;
  presets?: number[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const marks = Array.from(new Set([0, ...presets])).sort((a, b) => a - b);

  function setFromClientX(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const nearest = marks.reduce((acc, m) => (Math.abs(pct - m) < Math.abs(pct - acc) ? m : acc));
    onChange(nearest);
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.buttons === 0) return;
    setFromClientX(e.clientX);
  }

  return (
    <div style={styles.wrap}>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        style={styles.track}
      >
        <div style={styles.trackBg} />
        <div style={{ ...styles.trackFill, width: `${value}%` }} />
        {marks.map((m) => (
          <div key={m} style={{ ...styles.tick, left: `${m}%` }} />
        ))}
        <div style={{ ...styles.thumb, left: `${value}%` }} />
      </div>
      <div style={styles.percentRow}>
        {presets.map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => onChange(pct)}
            style={{ ...styles.percentBtn, ...(value === pct ? styles.percentBtnActive : {}) }}
          >
            {pct}%
          </button>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  track: {
    position: 'relative',
    height: 20,
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    touchAction: 'none',
  },
  trackBg: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
  },
  trackFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 999,
    background: 'var(--accent)',
    pointerEvents: 'none',
  },
  tick: {
    position: 'absolute',
    top: '50%',
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'var(--text-tertiary)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: 'var(--panel)',
    border: '2px solid var(--accent)',
    boxShadow: 'var(--shadow-sm)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  percentRow: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: '1fr',
    gap: 6,
  },
  percentBtn: {
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '6px 0',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
  },
  percentBtnActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: 'var(--on-accent)',
  },
};
