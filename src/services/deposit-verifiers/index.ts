import { ChainConfig } from '../../config/chains';
import { DepositVerifier } from './types';
import { EvmDepositVerifier } from './EvmDepositVerifier';
import { BitcoinDepositVerifier } from './BitcoinDepositVerifier';
import { TronDepositVerifier } from './TronDepositVerifier';
import { SolanaDepositVerifier } from './SolanaDepositVerifier';
import { TonDepositVerifier } from './TonDepositVerifier';

export function createVerifier(chainConfig: ChainConfig): DepositVerifier {
  switch (chainConfig.type) {
    case 'evm':
      return new EvmDepositVerifier(chainConfig);
    case 'bitcoin':
      return new BitcoinDepositVerifier(chainConfig);
    case 'tron':
      return new TronDepositVerifier(chainConfig);
    case 'solana':
      return new SolanaDepositVerifier(chainConfig);
    case 'ton':
      return new TonDepositVerifier(chainConfig);
  }
}

export { DepositVerifier } from './types';
export { DepositVerificationError } from './errors';
