export interface CardWaitlistSnapshot {
  joined: boolean;
  joinedAt: string | null;
  kycStatus: 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface CardWaitlistClient {
  getCardWaitlist(): Promise<CardWaitlistSnapshot>;
  joinCardWaitlist(): Promise<{ joined: boolean; joinedAt: string }>;
}

export type CardWaitlistState =
  | { status: 'review' | 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: CardWaitlistSnapshot; joining: boolean; error?: unknown };

/** Owns only the existing waitlist API flow; it cannot issue or fund a card. */
export function createCardWaitlistController(
  client: CardWaitlistClient,
  reviewOnly: boolean,
  onChange: (state: CardWaitlistState) => void,
) {
  let state: CardWaitlistState = { status: reviewOnly ? 'review' : 'loading' };
  let disposed = false;
  let revision = 0;

  function publish(next: CardWaitlistState) {
    if (!disposed) {
      state = next;
      onChange(next);
    }
  }

  async function load() {
    if (disposed || reviewOnly || (state.status === 'ready' && state.joining)) return;
    const requestRevision = ++revision;
    publish({ status: 'loading' });
    try {
      const data = await client.getCardWaitlist();
      if (requestRevision === revision) publish({ status: 'ready', data, joining: false });
    } catch (error) {
      if (requestRevision === revision) publish({ status: 'error', error });
    }
  }

  async function join() {
    if (disposed || reviewOnly || state.status !== 'ready' || state.joining
      || state.data.joined || state.data.kycStatus !== 'APPROVED') return;
    const data = state.data;
    const requestRevision = ++revision;
    publish({ status: 'ready', data, joining: true });
    try {
      const result = await client.joinCardWaitlist();
      // Use the server's persisted result, never an invented joined date.
      if (requestRevision === revision) {
        publish({ status: 'ready', data: { ...data, ...result }, joining: false });
      }
    } catch (error) {
      if (requestRevision === revision) publish({ status: 'ready', data, joining: false, error });
    }
  }

  return {
    load,
    join,
    dispose() { disposed = true; revision += 1; },
  };
}
