import { privateNumber, privateCardPnl, type PrivateResultCard } from './privateTradingApi';

export const PRIVATE_RESULT_CARD_WIDTH = 1080;
export const PRIVATE_RESULT_CARD_HEIGHT = 1440;

const escapeXml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[c]!));

function finite(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Formatting only: every financial value is already frozen by the server.
const formatted = (value: string | null | undefined, digits = 2) =>
  finite(value) === null ? '—' : privateNumber(value, digits);
const signed = (value: string | null | undefined, digits = 2) => {
  const number = finite(value);
  return number === null ? '—' : `${number > 0 ? '+' : ''}${formatted(value, digits)}`;
};

function brand(): string {
  return `<g transform="translate(78 72)"><g transform="translate(0 2) scale(.62)"><defs><mask id="logoMask" maskUnits="userSpaceOnUse" x="0" y="0" width="82" height="64"><rect width="82" height="64" fill="white"/><circle cx="41" cy="32" r="24" fill="black"/></mask></defs><ellipse cx="41" cy="32" rx="39" ry="12.5" transform="rotate(-23 41 32)" stroke="#fff" stroke-width="3.3" mask="url(#logoMask)"/><path d="M57.36 14.44A24 24 0 0 0 18.9 41.37ZM24.64 49.56A24 24 0 0 0 63.1 22.63Z" fill="#fff"/></g><text x="70" y="40" font-size="42" fill="#fff" font-weight="700" letter-spacing="1.3">VOLTEX</text></g>`;
}

// Preserve the warm portrait artwork already present on the current PR head.
function warmArtwork(): string {
  return `<g opacity=".98"><defs><radialGradient id="orb" cx="58%" cy="36%" r="70%"><stop offset="0" stop-color="#f6ce85"/><stop offset=".38" stop-color="#c87a2c"/><stop offset=".78" stop-color="#5f361f"/><stop offset="1" stop-color="#251c19"/></radialGradient><linearGradient id="gold" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#6e3f21"/><stop offset=".32" stop-color="#b66b29"/><stop offset=".58" stop-color="#f2bd61"/><stop offset=".78" stop-color="#c6792d"/><stop offset="1" stop-color="#7b4524"/></linearGradient><linearGradient id="goldHi" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9b5727"/><stop offset=".48" stop-color="#ffd58a"/><stop offset="1" stop-color="#bc6d2c"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="22"/></filter><filter id="soft"><feGaussianBlur stdDeviation="8"/></filter></defs><ellipse cx="755" cy="1125" rx="430" ry="330" fill="#c7782e" opacity=".15" filter="url(#glow)"/><circle cx="858" cy="1200" r="350" fill="url(#orb)"/><path d="M466 1390C540 1232 642 1164 748 1106c112-62 150-130 162-230l-80 42 145-249 38 282-78-47c-20 135-94 242-213 316-107 67-169 116-216 220Z" fill="url(#gold)"/><path d="M504 1392c58-123 153-178 256-234 112-61 151-148 166-240" fill="none" stroke="url(#goldHi)" stroke-width="22" stroke-linecap="round" opacity=".86"/><path d="M847 861 975 669l28 225-66-40c-27 90-80 161-161 220" fill="url(#goldHi)" opacity=".95"/><ellipse cx="862" cy="1230" rx="286" ry="86" fill="#f2bd61" opacity=".08" filter="url(#soft)"/></g>`;
}

/** One frozen server snapshot drives the preview and the downloaded PNG. */
export function privateResultCardSvg(card: PrivateResultCard): string {
  if (!['DEMO_LIVE', 'HISTORICAL_REPLAY'].includes(card.mode) || !card.label?.trim() || !['LONG', 'SHORT'].includes(card.side)) {
    throw new Error('Недоступен подтверждённый снимок карточки');
  }
  const pnl = privateCardPnl(card);
  const negative = (finite(pnl) ?? 0) < 0;
  const accent = negative ? '#ff6b7a' : '#55cda2';
  const sideColor = card.side === 'SHORT' ? '#ff7d88' : '#74cfa6';
  const roi = signed(card.roiPercent), profit = signed(pnl);
  const roiSize = roi.length > 10 ? 90 : 96;
  const percentSize = Math.round(roiSize * .60);
  const profitSize = profit.length > 13 ? 46 : 52;
  const side = card.side === 'LONG' ? 'Long' : 'Short';
  const leverage = finite(card.leverage) === null ? '—' : `${card.leverage}x`;
  const badgeWidth = Math.max(152, 38 + (side.length + leverage.length) * 15);
  const priceLabel = card.status === 'OPEN' ? 'Current Price' : 'Exit Price';
  // Cap only unusually long strings; ordinary figures retain their natural width.
  const fit = (text: string, size: number, max: number) =>
    text.length * size * .62 > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '';
  const historical = card.mode === 'HISTORICAL_REPLAY'
    ? '<g transform="translate(796 76)"><rect width="204" height="40" rx="20" fill="#e5b565" fill-opacity=".08" stroke="#e5b565" stroke-opacity=".30"/><text data-field="historical-label" x="102" y="27" text-anchor="middle" font-size="19" fill="#e5c98f" font-weight="600">Historical Test</text></g>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440" role="img" aria-labelledby="card-title" font-family="Arial,Helvetica,sans-serif">
<title id="card-title">VOLTEX ${escapeXml(card.symbol)} P&amp;L</title>
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b1b1d"/><stop offset=".52" stop-color="#242124"/><stop offset="1" stop-color="#3a2a20"/></linearGradient><linearGradient id="shade" x1="0" x2="1"><stop stop-color="#161719" stop-opacity=".92"/><stop offset=".55" stop-color="#1d1d1e" stop-opacity=".44"/><stop offset="1" stop-color="#36251d" stop-opacity=".08"/></linearGradient></defs>
<rect width="1080" height="1440" fill="url(#bg)"/>${warmArtwork()}<rect width="1080" height="1440" fill="url(#shade)"/>${brand()}
<g font-variant-numeric="tabular-nums lining-nums"><g transform="translate(80 220)">
<text data-field="symbol" x="0" y="0" font-size="42" fill="#f5f1ea" font-weight="700" letter-spacing="-.5"${fit(card.symbol, 42, 870)}>${escapeXml(card.symbol)}</text>
<g transform="translate(0 34)"><rect width="${badgeWidth}" height="40" rx="7" fill="${card.side === 'SHORT' ? '#4a2028' : '#315744'}" fill-opacity=".38" stroke="${sideColor}" stroke-opacity=".27"/><text x="13" y="28" font-size="24" font-weight="500"><tspan data-field="side" fill="${sideColor}">${side}</tspan><tspan data-field="leverage" dx="16" fill="#ded8cf">${escapeXml(leverage)}</tspan></text></g>
<text x="0" y="158" font-size="23" fill="#c1b9b0">ROI</text>
<text x="0" y="${168 + roiSize}" fill="${accent}" font-weight="700"><tspan data-field="roi-number" font-size="${roiSize}" letter-spacing="-2.7"${fit(roi, roiSize, 790)}>${escapeXml(roi)}</tspan>${roi !== '—' ? `<tspan data-field="roi-unit" dx="8" dy="-${Math.round(roiSize * .26)}" font-size="${percentSize}" letter-spacing="-1">%</tspan>` : ''}</text>
<text x="0" y="392" font-size="23" fill="#c1b9b0">Profit</text>
<text x="0" y="${402 + profitSize}" fill="#f5f1ea" font-weight="700"><tspan data-field="profit-number" font-size="${profitSize}" letter-spacing="-.65"${fit(profit, profitSize, 754)}>${escapeXml(profit)}</tspan><tspan data-field="profit-unit" dx="22" font-size="25" fill="#d9c5a3" font-weight="400" letter-spacing=".6">USDT</tspan></text>
<text x="0" y="570" font-size="22" fill="#c4bab0">Entry Price</text>
<text data-field="entry-price" x="0" y="610" font-size="32" fill="#f0e9df"${fit(formatted(card.entryPrice, 6), 32, 630)}>${escapeXml(formatted(card.entryPrice, 6))}</text>
<text data-field="valuation-label" x="0" y="678" font-size="22" fill="#c4bab0">${priceLabel}</text>
<text data-field="valuation-price" x="0" y="718" font-size="32" fill="#f0e9df"${fit(formatted(card.valuationPrice, 6), 32, 630)}>${escapeXml(formatted(card.valuationPrice, 6))}</text>
</g>${historical}</g></svg>`;
}

export async function privateResultCardPng(card: PrivateResultCard): Promise<Blob> {
  const svg = privateResultCardSvg(card);
  const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось подготовить карточку'));
      image.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = PRIVATE_RESULT_CARD_WIDTH;
    canvas.height = PRIVATE_RESULT_CARD_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Экспорт изображения недоступен');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Не удалось сохранить PNG')), 'image/png',
    ));
  } finally {
    URL.revokeObjectURL(source);
  }
}

/** Same PNG bytes, including embedded browsers that cannot deliver blob URLs. */
export function privateResultCardDataUrl(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось подготовить PNG'));
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/png;base64,')
      ? resolve(reader.result) : reject(new Error('Не удалось подготовить PNG'));
    reader.readAsDataURL(png);
  });
}
