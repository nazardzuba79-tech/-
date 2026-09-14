import { privateCardArtwork } from './privateCardArtwork';
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
  return `<g transform="translate(78 76)"><g transform="translate(0 2) scale(.62)"><defs><mask id="logoMask" maskUnits="userSpaceOnUse" x="0" y="0" width="82" height="64"><rect width="82" height="64" fill="white"/><circle cx="41" cy="32" r="24" fill="black"/></mask></defs><ellipse cx="41" cy="32" rx="39" ry="12.5" transform="rotate(-23 41 32)" stroke="#fff" stroke-width="3.3" mask="url(#logoMask)"/><path d="M57.36 14.44A24 24 0 0 0 18.9 41.37ZM24.64 49.56A24 24 0 0 0 63.1 22.63Z" fill="#fff"/></g><text x="70" y="40" font-size="42" fill="#fff" font-weight="700" letter-spacing="1.3">VOLTEX</text></g>`;
}

// The actual supplied Canva ribbon is retained as raster artwork. These bags are decorative only.
function warmArtwork(): string {
  const bag = (x:number,y:number,scale:number) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M52 75C40 44 35 34 45 27c14-10 23 11 30 10 10-23 27-25 35-3 17-22 42-19 37 0-3 12-15 26-21 41" fill="#fff8e9" stroke="#4b3726" stroke-width="3"/><path d="M53 95C27 121 3 155 8 196c5 48 163 50 174 0 8-35-14-69-56-101Z" fill="#fffaf0" stroke="#4b3726" stroke-width="3"/><rect x="47" y="70" width="88" height="22" rx="11" fill="#f9ae37" stroke="#4b3726" stroke-width="3"/><text x="94" y="193" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="114" fill="#292522">$</text></g>`;
  return `<g data-artwork="warm-rise" aria-hidden="true"><image href="${privateCardArtwork}" x="0" y="0" width="1080" height="1440"/><g data-artwork="money-bags">${bag(888,890,.90)}${bag(639,1144,.74)}</g></g>`;
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
  const profitSize = profit.length > 13 ? 46 : 52;
  const side = card.side === 'LONG' ? 'Long' : 'Short';
  const leverage = finite(card.leverage) === null ? '—' : `${card.leverage}x`;
  const badgeWidth = Math.max(152, 38 + (side.length + leverage.length) * 15);
  const priceLabel = card.status === 'OPEN' ? 'Рыночная цена' : 'Цена выхода';
  // Display rounding only. Do not change the frozen execution prices or P&L.
  const entryPrice = formatted(card.entryPrice, 2), valuationPrice = formatted(card.valuationPrice, 2);
  const fit = (text: string, size: number, max: number) =>
    text.length * size * .62 > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '';
  const historical = card.mode === 'HISTORICAL_REPLAY'
    ? '<g transform="translate(796 80)"><rect width="204" height="40" rx="20" fill="#e5b565" fill-opacity=".08" stroke="#e5b565" stroke-opacity=".30"/><text data-field="historical-label" x="102" y="27" text-anchor="middle" font-size="19" fill="#e5c98f" font-weight="600">Historical Test</text></g>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440" role="img" aria-labelledby="card-title" font-family="Arial,Helvetica,sans-serif">
<title id="card-title">VOLTEX ${escapeXml(card.symbol)} P&amp;L</title>
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#252323"/><stop offset=".52" stop-color="#2c2725"/><stop offset="1" stop-color="#493321"/></linearGradient><linearGradient id="shade" x1="0" x2="1"><stop stop-color="#201f20" stop-opacity=".72"/><stop offset=".5" stop-color="#262222" stop-opacity=".20"/><stop offset="1" stop-color="#3e2b20" stop-opacity="0"/></linearGradient></defs>
<rect width="1080" height="1440" fill="url(#bg)"/>${warmArtwork()}<rect width="1080" height="1440" fill="url(#shade)"/>${brand()}
<g font-variant-numeric="tabular-nums lining-nums"><g transform="translate(80 236)">
<text data-field="symbol" x="0" y="0" font-size="42" fill="#f5f1ea" font-weight="700" letter-spacing="-.5"${fit(card.symbol, 42, 870)}>${escapeXml(card.symbol)}</text>
<g transform="translate(0 28)"><rect width="${badgeWidth}" height="40" rx="7" fill="${card.side === 'SHORT' ? '#4a2028' : '#315744'}" fill-opacity=".38" stroke="${sideColor}" stroke-opacity=".27"/><text x="13" y="28" font-size="24" font-weight="500"><tspan data-field="side" fill="${sideColor}">${side}</tspan><tspan data-field="leverage" dx="16" fill="#ded8cf">${escapeXml(leverage)}</tspan></text></g>
<text data-field="roi-label" x="0" y="144" font-size="23" fill="#c1b9b0">ROI</text>
<text data-field="roi-line" x="0" y="${154 + roiSize}" fill="${accent}" font-weight="700"${fit(roi + (roi !== '—' ? '%' : ''), roiSize, 884)}><tspan data-field="roi-number" font-size="${roiSize}" letter-spacing="-2.7">${escapeXml(roi)}</tspan>${roi !== '—' ? `<tspan data-field="roi-unit" dx="4" dy="0" font-size="${roiSize}" letter-spacing="-2.7">%</tspan>` : ''}</text>
<text data-field="profit-label" x="0" y="314" font-size="23" fill="#c1b9b0">Profit</text>
<text data-field="profit-line" x="0" y="${326 + profitSize}" fill="#f5f1ea" font-weight="700"><tspan data-field="profit-number" font-size="${profitSize}" letter-spacing="-.65"${fit(profit, profitSize, 754)}>${escapeXml(profit)}</tspan><tspan data-field="profit-unit" dx="22" font-size="25" fill="#d9c5a3" font-weight="400" letter-spacing=".6">USDT</tspan></text>
<path d="M0 454H400" stroke="#bda586" stroke-opacity=".22"/>
<text data-field="entry-label" x="0" y="518" font-size="23" fill="#c4bab0">Цена Входа</text>
<text data-field="entry-price" x="0" y="562" font-size="34" font-weight="700" fill="#f0e9df"${fit(entryPrice, 34, 440)}>${escapeXml(entryPrice)}</text>
<text data-field="valuation-label" x="0" y="626" font-size="23" fill="#c4bab0">${priceLabel}</text>
<text data-field="valuation-price" x="0" y="670" font-size="34" font-weight="700" fill="#f0e9df"${fit(valuationPrice, 34, 440)}>${escapeXml(valuationPrice)}</text>
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
