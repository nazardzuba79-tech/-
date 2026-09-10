import { useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useLanguage } from '../../lib/i18n';
import { MotionStage } from './HomeMotion';
import './home-ecosystem.css';

// Plain institution names, not approximations of proprietary wordmarks.
// Asset/usage review: docs/HOMEPAGE_INSTITUTION_SOURCES.md.
const institutions = [
  { id: 'nasdaq', name: 'Nasdaq' },
  { id: 'nyse', name: 'NYSE' },
  { id: 'cme', name: 'CME Group' },
  { id: 'jpmorgan', name: 'J.P. Morgan' },
  { id: 'bofa', name: 'Bank of America Securities' },
  { id: 'goldman', name: 'Goldman Sachs' },
  { id: 'morganstanley', name: 'Morgan Stanley' },
] as const;
const LOOP_SECONDS = 42;

export function HomeEcosystem() {
  const { t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const focusedRef = useRef<HTMLElement | null>(null);

  const revealFocused = () => {
    const target = focusedRef.current, viewport = windowRef.current;
    focusedRef.current = null;
    if (!target || !viewport) return;
    const item = target.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
    if (item.left < bounds.left + 24 || item.right > bounds.right - 24) {
      target.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  };

  // Transfer the current CSS transform into native scroll without a visual jump.
  // There is no frame loop: JS runs only on a pause/resume or user interaction.
  const pause = () => {
    const viewport = windowRef.current, track = trackRef.current;
    if (paused || !viewport || !track) return;
    const transform = getComputedStyle(track).transform;
    offsetRef.current = viewport.scrollLeft - (transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41);
    setPaused(true);
  };
  useLayoutEffect(() => {
    if (paused && windowRef.current) {
      windowRef.current.scrollLeft = offsetRef.current;
      // A keyboard target may have been outside the moving viewport.
      revealFocused();
    }
  }, [paused]);

  const resume = () => {
    const viewport = windowRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    const width = track.firstElementChild?.getBoundingClientRect().width ?? 0;
    const phase = width ? (viewport.scrollLeft % width) / width : 0;
    track.style.setProperty('--vx-eco-delay', `-${phase * LOOP_SECONDS}s`);
    viewport.scrollLeft = 0;
    setSelected(null);
    setPaused(false);
  };

  return (
    <MotionStage className="vx-ecosystem-stage">
      <section id="ecosystem" className="vx-ecosystem" aria-labelledby="vx-ecosystem-title" data-paused={paused}>
        <div className="vx-eco-intro">
          <span className="vx-eco-rule" aria-hidden="true" />
          <h2 id="vx-ecosystem-title">{t('home.ecosystem.title')}</h2>
          <p>{t('home.ecosystem.subtitle')}</p>
        </div>

        <div ref={windowRef} className="vx-eco-window"
          onPointerDown={event => { if (event.pointerType === 'touch') pause(); }}
          onFocusCapture={event => {
            focusedRef.current = event.target as HTMLElement;
            if (paused) revealFocused();
            else pause();
          }}>
          <div ref={trackRef} className="vx-eco-track">
            {[false, true].map(duplicate => (
              <div className="vx-eco-group" key={String(duplicate)} aria-hidden={duplicate || undefined}>
                {institutions.map(institution => {
                  const Element = duplicate ? 'div' : 'button';
                  const descriptor = t(`home.ecosystem.${institution.id}`);
                  const detailId = `vx-eco-${institution.id}${duplicate ? '-copy' : ''}`;
                  return (
                    <Element type={duplicate ? undefined : "button"} key={institution.id}
                      className="vx-eco-institution"
                      tabIndex={duplicate ? undefined : 0}
                      aria-label={institution.name}
                      aria-describedby={detailId}
                      data-selected={selected === institution.id}
                      onClick={() => {
                        pause();
                        setSelected(current => current === institution.id ? null : institution.id);
                      }}>
                      <span className="vx-eco-name">{institution.name}</span>
                      <span className="vx-eco-descriptor" id={detailId}>{descriptor}</span>
                    </Element>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="vx-eco-footnote">
          <p>{t('home.ecosystem.disclaimer')}</p>
          <button type="button" className="vx-eco-motion-control" onClick={paused ? resume : pause}
            aria-label={t(paused ? 'home.ecosystem.resume' : 'home.ecosystem.pause')}>
            {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
            <span>{t(paused ? 'home.ecosystem.resume' : 'home.ecosystem.pause')}</span>
          </button>
          <span className="vx-eco-scroll-hint">{t('home.ecosystem.scrollHint')} <span aria-hidden="true">↔</span></span>
        </div>
      </section>
    </MotionStage>
  );
}
