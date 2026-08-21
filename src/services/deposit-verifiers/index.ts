import { ChainConfig } from '../../config/chains';
import { DepositVerifier } from './types';
import { EvmDepositVerifier } from './EvmDepositVerifier';
import { BitcoinDepositVerifier } from './BitcoinDepositVerifier';
import { TronDepositVerifier } from './TronDepositVerifier';

export function createVerifier(chainConfig: ChainConfig): DepositVerifier {
  switch (chainConfig.type) {
    case 'evm':
      return new EvmDepositVerifier(chainConfig);
    case 'bitcoin':
      return new BitcoinDepositVerifier(chainConfig);
    case 'tron':
      return new TronDepositVerifier(chainConfig);
  }
}

export { DepositVerifier } from './types';
export { DepositVerificationError } from './errors';
