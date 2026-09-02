import { PrismaClient } from '@prisma/client';
import { SYNTHETIC_COPY_CONFIG } from './syntheticConfig';
import { SyntheticStateStore } from './SyntheticCopyTradingService';
import { SyntheticCopyState } from './types';

export class PrismaSyntheticStateStore implements SyntheticStateStore {
  constructor(private prisma: PrismaClient) {}
  async load(): Promise<SyntheticCopyState | null> {
    const row = await (this.prisma as any).syntheticCopyTradingState.findUnique({ where: { id: SYNTHETIC_COPY_CONFIG.stateId } });
    return row?.state as SyntheticCopyState | null;
  }
  async save(state: SyntheticCopyState): Promise<void> {
    await (this.prisma as any).syntheticCopyTradingState.upsert({
      where: { id: SYNTHETIC_COPY_CONFIG.stateId },
      create: { id: SYNTHETIC_COPY_CONFIG.stateId, seed: state.seed, simulatedAt: new Date(state.simulatedAt), mode: state.mode, state },
      update: { seed: state.seed, simulatedAt: new Date(state.simulatedAt), mode: state.mode, state },
    });
  }
}
