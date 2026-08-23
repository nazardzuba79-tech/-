import { PrismaClient } from '@prisma/client';
import { ChainConfig } from '../config/chains';

export interface TreasuryWalletRow {
  chain: string;
  address: string;
  updatedByAdminId: string | null;
  updatedAt: Date;
}

/**
 * Admin-editable override for each chain's treasury deposit address — the
 * one users actually send crypto to. config/chains.ts's env-var value stays
 * the deployment default (and the only thing that works before an admin
 * ever touches this), but the moment a row exists here, it wins: every
 * place that resolves a treasury address for real work (showing it to a
 * user, verifying a claimed deposit, listing incoming transfers, checking
 * reserves) goes through applyOverride() below, so a change here takes
 * effect on the very next request — no redeploy, no env var edit.
 */
export class TreasuryWalletService {
  constructor(private prisma: PrismaClient) {}

  async list(): Promise<TreasuryWalletRow[]> {
    return this.prisma.treasuryWallet.findMany({ orderBy: { chain: 'asc' } });
  }

  async upsert(chain: string, address: string, adminId: string): Promise<TreasuryWalletRow> {
    return this.prisma.treasuryWallet.upsert({
      where: { chain },
      create: { chain, address, updatedByAdminId: adminId },
      update: { address, updatedByAdminId: adminId },
    });
  }

  /** Deletes the override, reverting that chain back to its env-var
   * default — a no-op (not an error) if there was no override to remove. */
  async remove(chain: string): Promise<void> {
    await this.prisma.treasuryWallet.deleteMany({ where: { chain } });
  }

  /** Returns `config` unchanged if no override exists for this chain. */
  async applyOverride(config: ChainConfig): Promise<ChainConfig> {
    const row = await this.prisma.treasuryWallet.findUnique({ where: { chain: config.chain } });
    return row ? { ...config, treasuryAddress: row.address } : config;
  }
}
