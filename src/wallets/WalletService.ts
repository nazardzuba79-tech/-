import { HDNodeWallet } from 'ethers';

/**
 * CUSTODY ARCHITECTURE — READ BEFORE TOUCHING THIS FILE
 * ========================================================
 * A real exchange must NEVER hold private keys in application memory, in the
 * database, or in environment variables on the API server. The standard,
 * battle-tested pattern is:
 *
 *   1. DEPOSIT ADDRESSES are derived from a WATCH-ONLY extended public key
 *      (xpub). This service only ever handles the xpub — it can generate an
 *      unlimited number of unique deposit addresses per user WITHOUT ever
 *      having access to the private key that controls them. That's what
 *      HDNodeWallet.fromExtendedKey(xpub) + derivePath(...) gives you below.
 *
 *   2. WITHDRAWALS require a signature. The signing key itself lives in one
 *      of: (a) an HSM (Hardware Security Module — e.g. AWS CloudHSM, Fireblocks,
 *      Copper), (b) an MPC custody provider (Fireblocks, Fordefi, Coinbase
 *      Prime custody), or (c) a self-hosted multisig cold wallet requiring
 *      M-of-N human co-signers for anything above a small hot-wallet float.
 *      This backend NEVER constructs or holds a raw private key — it only
 *      sends a "please sign this withdrawal" request to that external signer
 *      and receives back a signed transaction to broadcast.
 *
 *   3. HOT WALLET FLOAT: keep only a small operational balance (e.g. enough
 *      for 24-48h of expected withdrawal volume) in anything resembling a
 *      hot wallet. The rest sits in cold/MPC custody. This limits the blast
 *      radius of any single compromised server.
 *
 *   4. Every withdrawal above a threshold requires manual/multi-party review
 *      (see Withdrawal.status: PENDING_REVIEW -> APPROVED in the schema).
 *      This is both a security control and typically a regulatory requirement.
 *
 * This file implements (1) for real (safe to run) and stubs out (2) behind
 * an interface so you can plug in Fireblocks/HSM/multisig without touching
 * business logic elsewhere.
 */

export interface DepositAddress {
  userId: string;
  asset: string;
  chain: string;
  address: string;
  derivationPath: string;
}

export class WalletService {
  private xpub: string;

  constructor(xpub: string) {
    // xpub comes from config/secrets manager — it's not secret in the same
    // way a private key is (it can't spend funds), but it CAN reveal all
    // deposit addresses ever issued, so it's still access-controlled.
    this.xpub = xpub;
  }

  /**
   * Derives a fresh, unique deposit address for a user. Safe: this uses only
   * the extended PUBLIC key, so the resulting address's private key is never
   * computed or seen by this process.
   */
  deriveDepositAddress(userIndex: number, asset: string, chain: string): DepositAddress {
    const path = `m/44'/60'/0'/0/${userIndex}`; // BIP-44 style path; adjust coin type per chain
    const node = HDNodeWallet.fromExtendedKey(this.xpub) as HDNodeWallet;
    const child = node.derivePath(path.replace("m/44'/60'/0'/0/", '0/')); // xpub nodes derive non-hardened only
    return {
      userId: '', // filled in by caller
      asset,
      chain,
      address: child.address,
      derivationPath: path,
    };
  }
}

/**
 * External signer interface — implement this against Fireblocks/HSM/multisig.
 * The backend calls requestWithdrawalSignature() and polls/webhooks for the
 * result; it never has key material locally.
 */
export interface ExternalSigner {
  requestWithdrawalSignature(params: {
    withdrawalId: string;
    asset: string;
    chain: string;
    toAddress: string;
    amount: string;
  }): Promise<{ status: 'PENDING_APPROVAL' | 'SUBMITTED'; externalRequestId: string }>;
}

/** Dev/testnet-only stub. DO NOT use in any environment holding real funds. */
export class DevOnlySigner implements ExternalSigner {
  async requestWithdrawalSignature(params: {
    withdrawalId: string;
  }): Promise<{ status: 'PENDING_APPROVAL'; externalRequestId: string }> {
    console.warn(
      '[DevOnlySigner] Using development stub signer — this must be replaced ' +
      'with a real HSM/MPC/multisig integration before handling real funds.'
    );
    return { status: 'PENDING_APPROVAL', externalRequestId: `dev-${params.withdrawalId}` };
  }
}
