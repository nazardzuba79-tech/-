import { PrismaClient } from '@prisma/client';
import { SYNTHETIC_COPY_CONFIG } from './syntheticConfig';
import { SyntheticStateStore } from './SyntheticCopyTradingService';
import { SyntheticCopyState } from './types';

export interface PrismaSyntheticStateStoreOptions {
  // Opt in only from a controlled review backend. Existing callers retain
  // their persisted legacy row; no environment variable enables this scope.
  scope: 'review';
}

export class PrismaSyntheticStateStore implements SyntheticStateStore {
  private readonly stateId: string;

  constructor(private prisma: PrismaClient, options?: PrismaSyntheticStateStoreOptions) {
    if (options && options.scope !== 'review') throw new Error('Unsupported synthetic state scope');
    this.stateId = options?.scope === 'review'
      ? `nazara-review-v${SYNTHETIC_COPY_CONFIG.stateVersion}`
      : SYNTHETIC_COPY_CONFIG.stateId;
  }

  async load(): Promise<SyntheticCopyState | null> {
    // A missing review-version row is intentionally empty. The service can
    // bootstrap it without reading, overwriting or deleting older histories.
    const row = await (this.prisma as any).syntheticCopyTradingState.findUnique({ where: { id: this.stateId } });
    return row ? row.state as SyntheticCopyState : null;
  }
  async save(state: SyntheticCopyState): Promise<void> {
    await (this.prisma as any).syntheticCopyTradingState.upsert({
      where: { id: this.stateId },
      create: { id: this.stateId, seed: state.seed, simulatedAt: new Date(state.simulatedAt), mode: state.mode, state },
      update: { seed: state.seed, simulatedAt: new Date(state.simulatedAt), mode: state.mode, state },
    });
  }
}
