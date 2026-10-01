import { checkWithdrawAddress, withdrawNetworks } from '../withdrawNetworks';

const EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const TRON = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BTC_LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const SOLANA = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TON = 'EQD4FPq-PRDieyQKkizFTRtSDyucUIqrj0v_zXJmqaDp6_0t';

const net = (asset: string, code: string) => withdrawNetworks(asset).find((n) => n.code === code)!;

describe('withdrawal networks', () => {
  it('offers the usual networks per asset, TRC20 first for USDT', () => {
    expect(withdrawNetworks('USDT').map((n) => n.code)).toEqual(['TRC20', 'ERC20', 'BEP20', 'TON', 'SOL']);
    expect(withdrawNetworks('btc').map((n) => n.code)).toEqual(['BTC']);
    expect(withdrawNetworks('XYZ').map((n) => n.code)).toEqual(['ERC20', 'BEP20']);
  });

  it.each([
    ['USDT', 'TRC20', TRON],
    ['USDT', 'ERC20', EVM],
    ['USDT', 'BEP20', EVM],
    ['USDT', 'TON', TON],
    ['USDT', 'SOL', SOLANA],
    ['BTC', 'BTC', BTC_BECH32],
    ['BTC', 'BTC', BTC_LEGACY],
  ])('accepts a %s address on %s', (asset, code, address) => {
    expect(checkWithdrawAddress(net(asset, code), `  ${address} `)).toBe('ok');
  });

  it.each([
    ['USDT', 'TRC20', EVM],
    ['USDT', 'ERC20', TRON],
    ['USDT', 'SOL', TRON],
    ['BTC', 'BTC', EVM],
    ['USDT', 'TON', SOLANA],
  ])('refuses on %s/%s an address of another network', (asset, code, address) => {
    expect(checkWithdrawAddress(net(asset, code), address)).toBe('wrongNetwork');
  });

  it('refuses spaces, nonsense and says nothing about an empty field', () => {
    expect(checkWithdrawAddress(net('USDT', 'TRC20'), 'T La2f6')).toBe('spaces');
    expect(checkWithdrawAddress(net('USDT', 'TRC20'), 'hello')).toBe('unrecognised');
    expect(checkWithdrawAddress(net('USDT', 'TRC20'), '   ')).toBe('empty');
  });
});
