import { PrismaClient } from '@prisma/client';
import { ChainConfig, loadChainConfig } from '../config/chains';

export interface TreasuryWalletRow {
  chain: string;
  address: string;
  updatedByAdminId: string | null;
  updatedAt: Date;
}

/**
 * A change counter per database client, bumped by every write below. The
 * deposit panel's address list is served from memory (see deposits.ts) and
 * compares this counter to know when an admin has changed an address — so
 * the list is re-read the moment it changes, and not on every open.
 */
const generations = new WeakMap<object, number>();
export function treasuryGeneration(prisma: object): number {
  return generations.get(prisma) ?? 0;
}
function bumpGeneration(prisma: object): void {
  generations.set(prisma, treasuryGeneration(prisma) + 1);
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
    const row = await this.prisma.treasuryWallet.upsert({
      where: { chain },
      create: { chain, address, updatedByAdminId: adminId },
      update: { address, updatedByAdminId: adminId },
    });
    bumpGeneration(this.prisma);
    return row;
  }

  /** Deletes the override, reverting that chain back to its env-var
   * default — a no-op (not an error) if there was no override to remove. */
  async remove(chain: string): Promise<void> {
    await this.prisma.treasuryWallet.deleteMany({ where: { chain } });
    bumpGeneration(this.prisma);
  }

  /** Returns `config` unchanged if no override exists for this chain. */
  async applyOverride(config: ChainConfig): Promise<ChainConfig> {
    const row = await this.prisma.treasuryWallet.findUnique({ where: { chain: config.chain } });
    return row ? { ...config, treasuryAddress: row.address } : config;
  }

  /** loadChainConfig() + this override applied on top — the one call every
   * route/service resolves a chain through, so an admin's address change is
   * reflected everywhere consistently.
   *
   * loadChainConfig() itself never requires a treasury address (an admin
   * override can supply one with no env var and no redeploy — see this
   * class's own doc comment above), so this is the one place that actually
   * enforces *some* address exists — env or override — before treating the
   * chain as usable. Throws the same way an unconfigured chain always has,
   * so every existing caller's try/catch-and-skip already does the right
   * thing. */
  async resolve(chain: string): Promise<ChainConfig> {
    const config = await this.applyOverride(loadChainConfig(chain));
    if (!config.treasuryAddress) {
      throw new Error(`No treasury address configured for chain: ${chain}`);
    }
    return config;
  }

  /** resolve() for several chains with ONE override read instead of one
   * per chain. The deposit panel lists every chain on each open; resolving
   * them one by one was six sequential database round trips before the
   * panel could draw. Same rules as resolve(): a chain whose env config does
   * not load, or that ends up with no address from env or override, is left
   * out; the order of `chains` is kept. It caches nothing itself; the
   * panel's in-memory copy (deposits.ts) is dropped through
   * treasuryGeneration() the moment upsert() or remove() runs. */
  async resolveMany(chains: readonly string[]): Promise<ChainConfig[]> {
    const configs: ChainConfig[] = [];
    for (const chain of chains) {
      try { configs.push(loadChainConfig(chain)); } catch { /* not configured on this deployment */ }
    }
    if (configs.length === 0) return [];
    const rows = await this.prisma.treasuryWallet.findMany({ where: { chain: { in: configs.map((c) => c.chain) } } });
    const overrides = new Map(rows.map((row) => [row.chain, row.address]));
    return configs
      .map((config) => (overrides.has(config.chain) ? { ...config, treasuryAddress: overrides.get(config.chain)! } : config))
      .filter((config) => !!config.treasuryAddress);
  }
}
