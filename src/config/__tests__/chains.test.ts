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

  it('defaults Ethereum to a free public RPC endpoint when ETHEREUM_RPC_URL is not set — same zero-config treatment as Bitcoin/Tron', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    delete process.env.ETHEREUM_RPC_URL;

    const config = loadChainConfig('ethereum');

    expect(config.rpcUrl).toBe('https://ethereum.publicnode.com');
  });

  it('still lets ETHEREUM_RPC_URL override the default when explicitly set', () => {
    process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
    process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
    process.env.ETHEREUM_RPC_URL = 'https://my-own-node.example';

    const config = loadChainConfig('ethereum');

    expect(config.rpcUrl).toBe('https://my-own-node.example');
  });

  // BSC and Polygon get the same zero-config RPC default treatment as
  // Ethereum (see DEFAULT_RPC_URL) — verified below. Other EVM chains
  // (Avalanche, Arbitrum, ...) have no universal free default and still
  // need their own explicit *_RPC_URL.
  it('throws when an EVM chain with no built-in default is missing its RPC URL', () => {
    process.env.AVALANCHE_TREASURY_ADDRESS = '0xabc';
    process.env.AVALANCHE_NATIVE_ASSET = 'AVAX';
    delete process.env.AVALANCHE_RPC_URL;

    expect(() => loadChainConfig('avalanche')).toThrow('AVALANCHE_RPC_URL');
  });

  it('defaults BSC and Polygon to their own free public RPC endpoints, same as Ethereum', () => {
    process.env.BSC_TREASURY_ADDRESS = '0xabc';
    process.env.BSC_NATIVE_ASSET = 'BNB';
    delete process.env.BSC_RPC_URL;
    process.env.POLYGON_TREASURY_ADDRESS = '0xabc';
    process.env.POLYGON_NATIVE_ASSET = 'MATIC';
    delete process.env.POLYGON_RPC_URL;

    expect(loadChainConfig('bsc').rpcUrl).toBe('https://bsc-dataseed.binance.org');
    expect(loadChainConfig('polygon').rpcUrl).toBe('https://polygon-rpc.com');
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

  it('does not throw when the treasury address env var is missing — an admin-set override can supply it instead', () => {
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    delete process.env.BITCOIN_TREASURY_ADDRESS;

    const config = loadChainConfig('bitcoin');

    expect(config.treasuryAddress).toBe('');
    expect(config.nativeAsset).toBe('BTC');
  });

  it('still throws when NATIVE_ASSET is missing — that one has no admin-editable substitute', () => {
    delete process.env.BITCOIN_NATIVE_ASSET;
    delete process.env.BITCOIN_TREASURY_ADDRESS;

    expect(() => loadChainConfig('bitcoin')).toThrow('BITCOIN_NATIVE_ASSET');
  });

  it('lets a per-chain MIN_CONFIRMATIONS override the type default', () => {
    process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
    process.env.BITCOIN_NATIVE_ASSET = 'BTC';
    process.env.BITCOIN_MIN_CONFIRMATIONS = '6';

    const config = loadChainConfig('bitcoin');

    expect(config.minConfirmations).toBe(6);
  });
});
