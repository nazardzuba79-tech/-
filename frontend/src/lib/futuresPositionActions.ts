/** Display precision only. Closing always uses the position ID and server size. */
export function formatPositionQuantity(size: string, symbol: string): string {
  if (symbol.split('/')[0] !== 'BTC') return size;
  const value = Number(size);
  return size.trim() && Number.isFinite(value) ? value.toFixed(3) : '—';
}

export type CloseCandidate = { id: string; symbol: string; side: string; size: string };

/** P&L/mark updates do not invalidate consent; changes to exposure do. */
export function positionSelectionKey(positions: readonly CloseCandidate[]): string {
  return JSON.stringify(positions.map(p => [p.id, p.symbol, p.side, p.size]).sort((a, b) => a[0].localeCompare(b[0])));
}

export async function closeConfirmedPositions(
  positions: readonly CloseCandidate[],
  close: (id: string) => Promise<void>,
  isCurrent: (position: CloseCandidate) => boolean,
): Promise<{ closed: string[]; failed: { position: CloseCandidate; error: unknown }[] }> {
  const closed: string[] = [];
  const failed: { position: CloseCandidate; error: unknown }[] = [];
  for (const position of positions) {
    try {
      if (!isCurrent(position)) throw new Error('POSITION_CHANGED');
      await close(position.id);
      closed.push(position.id);
    } catch (error) {
      failed.push({ position, error });
    }
  }
  return { closed, failed };
}
