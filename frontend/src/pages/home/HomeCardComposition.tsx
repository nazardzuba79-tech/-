import { useId } from 'react';
import { CARD_MASTER } from '../crypto-card-final/components/VoltexCard';

/** Homepage-only product artwork. Exact physical masters, unwarped and fully
 * visible; the phone is a deterministic vector mockup, not an account view. */
export function HomeCardComposition() {
  const id = useId().replace(/:/g, '');
  return <svg viewBox="0 0 690 610" role="img"
    aria-label="VOLTEX Titanium, VOLTEX Black Signature · Crypto Card"
    data-home-card-composition="two-cards-phone"
    style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 520, overflow: 'visible' }}>
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2=".7">
        <stop stopColor="#777b83"/><stop offset=".12" stopColor="#24272c"/>
        <stop offset=".5" stopColor="#101217"/><stop offset=".83" stopColor="#777369"/>
        <stop offset="1" stopColor="#303137"/>
      </linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2=".9" y2="1">
        <stop stopColor="#192028"/><stop offset=".45" stopColor="#0b1017"/>
        <stop offset="1" stopColor="#06090e"/>
      </linearGradient>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#303139"/><stop offset="1" stopColor="#14161d"/>
      </linearGradient>
      <filter id={`${id}-shadow`} x="-25%" y="-25%" width="150%" height="170%">
        <feDropShadow dx="0" dy="17" stdDeviation="15" floodColor="#000" floodOpacity=".55"/>
      </filter>
      {/* Remove only the masters' studio background, outside the complete
          physical card perimeter. Original art and edge highlights stay intact. */}
      <clipPath id={`${id}-black-outline`} clipPathUnits="userSpaceOnUse">
        <rect x="111" y="82" width="1358" height="820" rx="58"/>
      </clipPath>
      <clipPath id={`${id}-titanium-outline`} clipPathUnits="userSpaceOnUse">
        <rect x="55" y="44" width="1470" height="906" rx="63"/>
      </clipPath>
    </defs>

    {/* Brushed graphite chassis; no hardware brand or borrowed phone UI. */}
    <g data-product="smartphone" filter={`url(#${id}-shadow)`}>
      <rect x="431" y="138" width="5" height="43" rx="2" fill="#63646a"/>
      <rect x="431" y="193" width="5" height="58" rx="2" fill="#484a51"/>
      <rect x="654" y="173" width="5" height="68" rx="2" fill="#74716b"/>
      <rect x="435" y="38" width="220" height="532" rx="39" fill={`url(#${id}-metal)`} stroke="#92918e" strokeWidth="1.2"/>
      <rect x="440" y="43" width="210" height="522" rx="35" fill="#030507" stroke="#000" strokeWidth="2"/>
      <rect x="447" y="51" width="196" height="506" rx="29" fill={`url(#${id}-glass)`}/>
      <rect x="514" y="65" width="62" height="16" rx="8" fill="#020304"/>
      <circle cx="565" cy="73" r="3" fill="#101924" stroke="#192833"/>
      <path d="M466 73h18m-18 4h12" stroke="#b9bdc6" strokeWidth="2" strokeLinecap="round"/>
      <rect x="609" y="69" width="17" height="9" rx="2" fill="none" stroke="#9da4ad"/>
      <rect x="612" y="71" width="11" height="5" rx="1" fill="#b7c0c8"/>
      <g fontFamily="Inter, sans-serif">
        <text x="465" y="118" fill="#f5f3ee" fontSize="18" fontWeight="700" letterSpacing="2">VOLTEX</text>
        <path d="M613 106v9m-4-5 4-4 4 4m-10 9h12" stroke="#c9a75d" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <text x="465" y="151" fill="#b2b7c0" fontSize="13">Crypto Card</text>
        {/* Masked balance: this image never invents a financial account value. */}
        <text x="463" y="189" fill="#f3f2ec" fontSize="30" letterSpacing="3">••••••</text>
        <text x="465" y="211" fill="#8d99a8" fontSize="11" letterSpacing="1.5">USDT</text>
        <rect x="461" y="239" width="168" height="80" rx="13" fill={`url(#${id}-tile)`} stroke="#4a4436"/>
        <circle cx="482" cy="260" r="8" fill="none" stroke="#c9a75d" strokeWidth="1.3"/>
        <ellipse cx="482" cy="260" rx="12" ry="4" fill="none" stroke="#c9a75d"/>
        <text x="473" y="293" fill="#ede4cd" fontSize="12" fontWeight="600">Black Signature</text>
        <circle cx="612" cy="298" r="3" fill="#c5a35b"/>
        <text x="465" y="342" fill="#c6cbd3" fontSize="12" fontWeight="600">Recent activity</text>
        {/* Illustrative purchases in product artwork only, never account/API data. */}
        {[
          { name: 'Shopping', amount: '−$128.50', date: 'Today', y: 365, icon: 'M473 368h16l-2 10h-12zm3 0v-3a5 5 0 0 1 10 0v3' },
          { name: 'Netflix', amount: '−$12.99', date: 'Yesterday', y: 407, icon: 'M477 405v15l11-7.5z' },
          { name: 'Transport', amount: '−$24.00', date: 'Yesterday', y: 449, icon: 'M473 453l3-7h12l3 7v7h-18zm0 0h18m-14 3h1m8 0h1' },
        ].map(expense => <g key={expense.name} data-phone-expense={expense.name}>
          <rect x="465" y={expense.y - 8} width="30" height="30" rx="8" fill="#19212c"/>
          <path d={expense.icon} fill="none" stroke="#c6af78" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          <text x="502" y={expense.y + 2} fill="#e0e4ea" fontSize="11.5" fontWeight="500">{expense.name}</text>
          <text x="626" y={expense.y + 2} fill="#eef0f3" fontSize="11.5" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>{expense.amount}</text>
          <text x="502" y={expense.y + 17} fill="#8d99a8" fontSize="9">{expense.date}</text>
        </g>)}
      </g>
      <path d="M462 481h166" stroke="#242b35"/>
      <g stroke="#8994a2" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M474 512v-11l8-7 8 7v11h-16m6 0v-7h5v7"/>
        <rect x="535" y="498" width="21" height="14" rx="3" stroke="#d1b46f"/>
        <path d="M535 503h21" stroke="#d1b46f"/>
        <circle cx="610" cy="501" r="4"/><path d="M602 512c0-8 16-8 16 0"/>
      </g>
      <rect x="518" y="540" width="54" height="3" rx="1.5" fill="#9fa7b4"/>
    </g>

    {/* Uniform scale and rigid rotation only: no skew or perspective warp.
        Both complete physical cards occupy independent, non-overlapping slots. */}
    <g transform="rotate(-4 215 180)" filter={`url(#${id}-shadow)`}>
      <g transform="translate(5.55 44.5) scale(.2651)">
        <image data-product="black-signature" href={CARD_MASTER.black}
          width="1580" height="996" preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${id}-black-outline)`}/>
      </g>
    </g>
    <g transform="rotate(4 215 444)" filter={`url(#${id}-shadow)`}>
      <g transform="translate(21.5 322.2) scale(.245)">
        <image data-product="titanium" href={CARD_MASTER.titanium}
          width="1580" height="996" preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${id}-titanium-outline)`}/>
      </g>
    </g>
  </svg>;
}
