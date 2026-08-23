import { loadChainConfig } from '../chains';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV };
});
afterAll(() => {
  process.env = OLD_ENV;
});

describe('loadChainConfig', () => {
  it('infers type "evm" for an unrecognized chain name and requires an RPC URL', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    process.env.ETHEREUM_RPC_URL = 'https://rpc.example';

    const config = loadChainConfig('ethereum');

    expect(config.type).toBe('evm');
    expect(config.rpcUrl).toBe('https://rpc.example');
    expect(config.minConfirmations).toBe(12);
  });

  it('defaults an EVM chain to the Etherscan API and picks up an optional API key', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    process.env.ETHEREUM_RPC_URL = 'https://rpc.example';
    process.env.ETHEREUM_API_KEY = 'secret-key';

    const config = loadChainConfig('ethereum');

    expect(config.apiUrl).toBe('https://api.etherscan.io/api');
    expect(config.apiKey).toBe('secret-key');
  });

  it('lets ETHEREUM_API_URL override the default Etherscan-style endpoint', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    process.env.ETHEREUM_RPC_URL = 'https://rpc.example';
    process.env.ETHEREUM_API_URL = 'https://my-explorer.example/api';

    const config = loadChainConfig('ethereum');

    expect(config.apiUrl).toBe('https://my-explorer.example/api');
  });

  it('throws when an EVM chain is missing its RPC URL', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    delete process.env.ETHEREUM_RPC_URL;

    expect(() => loadChainConfig('ethereum')).toThrow('ETHEREUM_RPC_URL');
  });

  it('infers type "bitcoin" and defaults the API URL and confirmations', () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';

    const config = loadChainConfig('bitcoin');

    expect(config.type).toBe('bitcoin');
    expect(config.apiUrl).toBe('https://blockstream.info/api');
    expect(config.minConfirmations).toBe(2);
    expect(config.rpcUrl).toBeUndefined();
  });

  it('lets BITCOIN_API_URL override the default explorer', () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    process.env.BITCOIN_API_URL = 'https://my-esplora.example/api';

    const config = loadChainConfig('bitcoin');

    expect(config.apiUrl).toBe('https://my-esplora.example/api');
  });

  it('infers type "tron", defaults TronGrid, and parses TRC-20 tokens', () => {
    process.env.TRON_TREASURY_ADDRESS = 'Texample';
    process.env.TRON_NATIVE_ASSET = 'TRX';
    process.env.TRON_TOKENS = 'USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6';

    const config = loadChainConfig('tron');

    expect(config.type).toBe('tron');
    expect(config.apiUrl).toBe('https://api.trongrid.io');
    expect(config.minConfirmations).toBe(19);
    expect(config.tokens.USDT).toEqual({ contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 });
  });

  it('picks up an optional TRON_API_KEY', () => {
    process.env.TRON_TREASURY_ADDRESS = 'Texample';
    process.env.TRON_NATIVE_ASSET = 'TRX';
    process.env.TRON_API_KEY = 'secret-key';

    const config = loadChainConfig('tron');

    expect(config.apiKey).toBe('secret-key');
  });

  it('lets a per-chain MIN_CONFIRMATIONS override the type default', () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    process.env.BITCOIN_MIN_CONFIRMATIONS = '6';

    const config = loadChainConfig('bitcoin');

    expect(config.minConfirmations).toBe(6);
  });
});
