import { motion } from 'framer-motion';
import { cryptoCurrencies, fiatCurrencies } from '../data/currencies';
import type { CurrencyItem } from '../data/currencies';
import { CurrencyMark } from './CurrencyMarks';
import { VoltexCard } from './VoltexCard';
import { useCardCopy } from '../useCardCopy';

const RADIUS_X = 39;
const RADIUS_Y = 41;
const SPREAD = 74;

interface ArcPoint {
  item: CurrencyItem;
  x: number;
  y: number;
}

function buildArc(items: CurrencyItem[], side: 'left' | 'right'): ArcPoint[] {
  return items.map((item, index) => {
    const ratio = items.length === 1 ? 0.5 : index / (items.length - 1);
    const degrees = -SPREAD + ratio * SPREAD * 2;
    const radians = degrees * Math.PI / 180;
    const horizontal = Math.cos(radians) * RADIUS_X * (side === 'left' ? -1 : 1);
    return { item, x: 50 + horizontal, y: 50 + Math.sin(radians) * RADIUS_Y };
  });
}

const fiatArc = buildArc(fiatCurrencies, 'left');
const cryptoArc = buildArc(cryptoCurrencies, 'right');

export function CurrencySection() {
  const { c } = useCardCopy();
  return (
    <section className="voltex-grid vc-relative vc-overflow-hidden vc-bg-voltex-black vc-px-5 vc-py-24 vc-text-white sm:vc-px-8 lg:vc-px-12 lg:vc-py-36">
      <div className="vc-mx-auto vc-max-w-[1344px]">
        <div className="vc-grid vc-gap-8 lg:vc-grid-cols-[1fr_0.4fr] lg:vc-items-end">
          <h2 className="vc-max-w-5xl vc-text-[clamp(3.1rem,6vw,6.9rem)] vc-font-medium vc-leading-[0.94] vc-tracking-[-0.065em]">{c.currencyTitle}</h2>
        </div>

        <div className="vc-relative vc-mt-16 vc-hidden vc-min-h-[720px] vc-border-y vc-border-white/10 sm:vc-block lg:vc-min-h-[860px]">
          <div className="vc-absolute vc-left-0 vc-top-6 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-muted"><span className="vc-mr-2 vc-text-voltex-goldLight">01</span>{c.fiat}</div>
          <div className="vc-absolute vc-right-0 vc-top-6 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-muted">{c.crypto}<span className="vc-ml-2 vc-text-voltex-goldLight">02</span></div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="vc-absolute vc-inset-0 vc-h-full vc-w-full" aria-hidden="true">
            <g fill="none" vectorEffect="non-scaling-stroke">
              <path d={arcPath('left')} stroke="rgba(201,162,75,0.42)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <path d={arcPath('right')} stroke="rgba(201,162,75,0.42)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {[...fiatArc, ...cryptoArc].map(({ item, x, y }) =>
              <line key={item.code} x1={x} y1={y} x2={x < 50 ? 38 : 62} y2="50" stroke="rgba(255,255,255,0.13)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
              )}
            </g>
          </svg>

          {fiatArc.map((point, index) => <ArcNode key={point.item.code} point={point} type="fiat" align="right" delay={index * 0.04} />)}
          {cryptoArc.map((point, index) => <ArcNode key={point.item.code} point={point} type="crypto" align="left" delay={index * 0.04} />)}

          <div className="vc-absolute vc-left-1/2 vc-top-1/2 vc-w-[34%] vc-max-w-[430px] -vc-translate-x-1/2 -vc-translate-y-1/2">
            <div className="vc-absolute -vc-inset-x-10 -vc-inset-y-16 vc-rounded-[50%] vc-border vc-border-voltex-gold/20" />
            <VoltexCard />
          </div>
        </div>

        <div className="vc-mt-14 sm:vc-hidden">
          <VoltexCard className="vc-mx-auto vc-w-full vc-max-w-[340px]" />
          <div className="vc-mt-10 vc-grid vc-grid-cols-2 vc-gap-x-4 vc-gap-y-3">
            <p className="vc-col-span-2 vc-text-[11px] vc-font-medium vc-uppercase vc-tracking-wide3 vc-text-voltex-goldLight">{c.fiat} &amp; {c.crypto}</p>
            {[...fiatCurrencies, ...cryptoCurrencies].map((item) =>
            <div key={item.code} className="vc-flex vc-items-center vc-gap-2.5 vc-border-b vc-border-white/10 vc-pb-3">
                <CurrencyMark code={item.code} type={fiatCurrencies.includes(item) ? 'fiat' : 'crypto'} className="vc-h-8 vc-w-8" />
                <span className="vc-text-[13px] vc-font-semibold">{item.code}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>);

}

function arcPath(side: 'left' | 'right') {
  const points = side === 'left' ? fiatArc : cryptoArc;
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x} ${first.y} A ${RADIUS_X} ${RADIUS_Y} 0 0 ${side === 'left' ? 0 : 1} ${last.x} ${last.y}`;
}

interface ArcNodeProps {
  point: ArcPoint;
  type: 'fiat' | 'crypto';
  align: 'left' | 'right';
  delay: number;
}

function ArcNode({ point, type, align, delay }: ArcNodeProps) {
  const { c } = useCardCopy();
  return (
    <div className="vc-absolute -vc-translate-x-1/2 -vc-translate-y-1/2" style={{ left: `${point.x}%`, top: `${point.y}%` }}>
      <motion.div
        className="vc-flex vc-items-center vc-gap-3"
        style={{ flexDirection: align === 'left' ? 'row-reverse' : 'row' }}
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1], delay }}>
        
        <div className={align === 'left' ? "vc-text-left" : "vc-text-right"}>
          <div className="vc-text-[15px] vc-font-semibold vc-leading-none">{point.item.code}</div>
          <div className="vc-mt-2 vc-max-w-[125px] vc-text-[12px] vc-leading-tight vc-text-voltex-muted">{point.item.nameKey ? c[point.item.nameKey] : point.item.name}</div>
        </div>
        <CurrencyMark code={point.item.code} type={type} className="vc-h-12 vc-w-12 vc-ring-1 vc-ring-white/15 lg:vc-h-14 lg:vc-w-14" />
      </motion.div>
    </div>);

}
