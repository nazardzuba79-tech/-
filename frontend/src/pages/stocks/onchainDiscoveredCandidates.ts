/**
 * 2026-10-25 issuer Solana mints and reported USDC DEX pools, selected from a bounded 200-token sample.
 * CANDIDATES, NOT on-chain verified by this step. DEX Screener counts and liquidity are reported snapshot estimates.
 * NOT a license to display tokenized-securities charts publicly. Keep localhost-only preview.
 * Verification: https://github.com/nazardzuba79-tech/-/actions/runs/40174085251
 */
export type OnchainDiscoveredCandidate = Readonly<{
  ticker: string; name: string; mint: string; pool: string; dex: string;
  liquidityUSD: number; tx24hReported: number; label: string;
  verifiedOnChain: false;
}>;
export const STOCKS_DISCOVERED_CANDIDATES: readonly OnchainDiscoveredCandidate[] = Object.freeze(
[
  {
    "ticker": "SPYx",
    "name": "SP500 xStock",
    "mint": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    "pool": "4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw",
    "dex": "raydium",
    "liquidityUSD": 414669,
    "tx24hReported": 7513,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "NVDAx",
    "name": "NVIDIA xStock",
    "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    "pool": "6R4r93V5fcMzc13CL2enEepDSYcr4Qx3ptZBDwudTXCo",
    "dex": "orca",
    "liquidityUSD": 278813,
    "tx24hReported": 6858,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "TSLAx",
    "name": "Tesla xStock",
    "mint": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    "pool": "9p7abUFv31ycgu9kckvnoqMMvBy67dqTDM2m6HP9xokN",
    "dex": "orca",
    "liquidityUSD": 106772,
    "tx24hReported": 6070,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "CRCLx",
    "name": "Circle xStock",
    "mint": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    "pool": "GYqHjuDzTiw7i52Xv1qohDE6eJr6eSZpsrBVikGZyaFV",
    "dex": "raydium",
    "liquidityUSD": 4592975,
    "tx24hReported": 4823,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "GLDx",
    "name": "Gold xStock",
    "mint": "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    "pool": "5tGLudhm9pHtqbtfymvdarbD59AyMyYimXXwbFfzETV9",
    "dex": "orca",
    "liquidityUSD": 163949,
    "tx24hReported": 3575,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "MSFTx",
    "name": "Microsoft xStock",
    "mint": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    "pool": "CLu4kFM4nb67xrdN7vJnMxXXir8Z5hA4HJUzPFccXjsL",
    "dex": "raydium",
    "liquidityUSD": 416681,
    "tx24hReported": 3113,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "SPCXx",
    "name": "SpaceX xStock",
    "mint": "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    "pool": "ASAxmEaTT1HFe3mVC3zbKDE4tuB28W7732XQrEMBM5W2",
    "dex": "orca",
    "liquidityUSD": 241917,
    "tx24hReported": 2917,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "AAPLx",
    "name": "Apple xStock",
    "mint": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    "pool": "9JsDnmZonykBmrybuYaZUYxr4DCbZZQTdYQzdFXtDr5F",
    "dex": "orca",
    "liquidityUSD": 31866,
    "tx24hReported": 2305,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "GOOGLx",
    "name": "Alphabet xStock",
    "mint": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    "pool": "B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw",
    "dex": "raydium",
    "liquidityUSD": 1262455,
    "tx24hReported": 2130,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "MSTRx",
    "name": "MicroStrategy xStock",
    "mint": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    "pool": "RyhF4cksVZY7vcqJpoytHcxcGNKRp27PEGhSnEPpbGv",
    "dex": "raydium",
    "liquidityUSD": 786186,
    "tx24hReported": 1090,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "MCDx",
    "name": "McDonald's xStock",
    "mint": "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    "pool": "6C1qAWcBV6NARdhCwf39tnhVavNF2k4S7wDXGyixMjku",
    "dex": "orca",
    "liquidityUSD": 25028,
    "tx24hReported": 938,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "QQQx",
    "name": "Nasdaq xStock",
    "mint": "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    "pool": "GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG",
    "dex": "raydium",
    "liquidityUSD": 2234940,
    "tx24hReported": 936,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "METAx",
    "name": "Meta xStock",
    "mint": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    "pool": "3L7KbPVaAQA4UTecaGQYsm6UCq5F3sZM9zAYkxqYt63j",
    "dex": "raydium",
    "liquidityUSD": 834074,
    "tx24hReported": 908,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "GMEx",
    "name": "Gamestop xStock",
    "mint": "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc",
    "pool": "yrNqjGSrZmUdcSNqzEjbrEouvazH9XbpxRCiJEa8AVJ",
    "dex": "raydium",
    "liquidityUSD": 2080,
    "tx24hReported": 582,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "TSMx",
    "name": "TSMC xStock",
    "mint": "XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV",
    "pool": "E1YZTLM1grafroWt34o3vN9pygwhJf45wUqEF96fkdGc",
    "dex": "orca",
    "liquidityUSD": 7001,
    "tx24hReported": 565,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "AVGOx",
    "name": "Broadcom xStock",
    "mint": "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo",
    "pool": "Dprwg5xHQ8jJryfh3okeTDCZK16Gz1wtX47JeZZv3HXZ",
    "dex": "meteora",
    "liquidityUSD": 26742,
    "tx24hReported": 538,
    "label": "DLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "SNDKx",
    "name": "Sandisk Corporation xStock",
    "mint": "Xswbpc8UqU6e1j9QZEWCjBMjyvz4twqD7PCy6j2e7jj",
    "pool": "8i7eHkYWCT6drxktZVSbJYHgbFjeYyz1q9mJRkvSokMQ",
    "dex": "raydium",
    "liquidityUSD": 24909,
    "tx24hReported": 488,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "COINx",
    "name": "Coinbase xStock",
    "mint": "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    "pool": "7ouGUDRMy4C9RJpTgPizRyfcxyJusAEe9ZbjqYv7BSqe",
    "dex": "orca",
    "liquidityUSD": 38167,
    "tx24hReported": 483,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "PLTRx",
    "name": "Palantir xStock",
    "mint": "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
    "pool": "5bY2fh9rgTYaBDxFGFJmddhaDkm5zwiWP6b2ZsjJZyP",
    "dex": "orca",
    "liquidityUSD": 198155,
    "tx24hReported": 401,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "HOODx",
    "name": "Robinhood xStock",
    "mint": "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    "pool": "48dhPm83sXfnRMxKRfv2YuE45DPqrhwPMvGrnTLufvFf",
    "dex": "orca",
    "liquidityUSD": 91368,
    "tx24hReported": 365,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "STRCx",
    "name": "Strategy PP Variable xStock",
    "mint": "Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH",
    "pool": "DU9dgBU6Yh2JjsYcjtRY21G14dhQxn6Xm5PT949Sa4tA",
    "dex": "raydium",
    "liquidityUSD": 254383,
    "tx24hReported": 345,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "AMZNx",
    "name": "Amazon.com xStock",
    "mint": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    "pool": "6m5aXAve4uh6Kt4ytKyCLWNMjd8PYP5vujwNCtycrUiD",
    "dex": "raydium",
    "liquidityUSD": 351684,
    "tx24hReported": 293,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "KOx",
    "name": "Coca-Cola xStock",
    "mint": "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
    "pool": "HwFVDs5f79oZk1J8QH9oc8t3VA5VrWDCGWHihj747xGC",
    "dex": "orca",
    "liquidityUSD": 11498,
    "tx24hReported": 206,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "JPMx",
    "name": "JPMorgan Chase xStock",
    "mint": "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C",
    "pool": "BxT1o9XsnbAPpQnRgfBoh77gcQH4EarYMBwHTcDhVQca",
    "dex": "raydium",
    "liquidityUSD": 2504,
    "tx24hReported": 188,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "BRK.Bx",
    "name": "Berkshire Hathaway xStock",
    "mint": "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x",
    "pool": "2xF9iz2aNXKE8TYDsZBtWi8777XMF1ZZRFd6gAqNWSd4",
    "dex": "orca",
    "liquidityUSD": 4540,
    "tx24hReported": 137,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "Vx",
    "name": "Visa xStock",
    "mint": "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p",
    "pool": "7ViDiiS2jjhLvorRgxtSmY434LBgrPVzXrud1zidyYwo",
    "dex": "raydium",
    "liquidityUSD": 698,
    "tx24hReported": 120,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "NFLXx",
    "name": "Netflix xStock",
    "mint": "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL",
    "pool": "7RQXW5KEBgHCcy1eSNs1Kh7BWaEL46q8jb9t18S151bL",
    "dex": "raydium",
    "liquidityUSD": 14959,
    "tx24hReported": 101,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "XOMx",
    "name": "Exxon Mobil xStock",
    "mint": "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh",
    "pool": "7KUvutxy36jwu7vjfTT37cGyMZ1fpWVTAUKGRfPe3MEL",
    "dex": "meteora",
    "liquidityUSD": 10193,
    "tx24hReported": 90,
    "label": "DYN2",
    "verifiedOnChain": false
  },
  {
    "ticker": "SGOVx",
    "name": "iShares 0-3 Month Treasury Bond ETF xStock",
    "mint": "XsYD72ntjj7ZwoFDZCDmN2gamTcLpnywqvG7PQN5vCN",
    "pool": "5Th52E1VPP7FAQQXnpV4Jz6cYPXqQVWg3aL2983QCS1v",
    "dex": "fluxbeam",
    "liquidityUSD": 2,
    "tx24hReported": 89,
    "label": "",
    "verifiedOnChain": false
  },
  {
    "ticker": "SLVx",
    "name": "iShares Silver Trust xStock",
    "mint": "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm",
    "pool": "nSs4EWNvgiVhu45riDkkVUbzjsexYm27r6Q9hvJWPLp",
    "dex": "orca",
    "liquidityUSD": 1420,
    "tx24hReported": 80,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "INTCx",
    "name": "Intel xStock",
    "mint": "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM",
    "pool": "2ZWHRV1XND2kEUiSizsWHTV8ZHoNxe9afCNLg5Xb6aJV",
    "dex": "raydium",
    "liquidityUSD": 1711,
    "tx24hReported": 74,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "MAx",
    "name": "Mastercard xStock",
    "mint": "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC",
    "pool": "6y9sGdHQQEacKfAxVUTA8HRUCWmKYrbwZd3sFxxda23s",
    "dex": "raydium",
    "liquidityUSD": 513,
    "tx24hReported": 61,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "AMBRx",
    "name": "Amber xStock",
    "mint": "XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb",
    "pool": "2DHt38DfCB4tSzbKrfgUBsiwUQMBc1oGAwWQWfRJCPut",
    "dex": "raydium",
    "liquidityUSD": 21499,
    "tx24hReported": 56,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "ORCLx",
    "name": "Oracle xStock",
    "mint": "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL",
    "pool": "GWjPMHYsmdosbMCPx14N627qf5WhpaxAwNBRCfqP9CM9",
    "dex": "raydium",
    "liquidityUSD": 14411,
    "tx24hReported": 44,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "NVOx",
    "name": "Novo Nordisk xStock",
    "mint": "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n",
    "pool": "4UitVa7GtLPVJ7TFMvou3uUQvJJ123U2PDsJ8th2nb4g",
    "dex": "orca",
    "liquidityUSD": 4541,
    "tx24hReported": 41,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "UBERx",
    "name": "Uber xStock",
    "mint": "XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB",
    "pool": "Grbgeue4XL4M5tcw6vJ7YZv7CtbwaqLDGgpCAAt35M3q",
    "dex": "orca",
    "liquidityUSD": 1362,
    "tx24hReported": 29,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "WMTx",
    "name": "Walmart xStock",
    "mint": "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci",
    "pool": "CnWMKwyRBAX4SmkT2Bxk9EDgn9YSAhg8KsredteGcjew",
    "dex": "orca",
    "liquidityUSD": 4392,
    "tx24hReported": 24,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "TQQQx",
    "name": "TQQQ xStock",
    "mint": "XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc",
    "pool": "7Mt2zB4JUV5VNPXzYaW6kG3xkaq7zKsBuZKZhNq6AVV4",
    "dex": "raydium",
    "liquidityUSD": 6306,
    "tx24hReported": 19,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "AMDx",
    "name": "AMD xStock",
    "mint": "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF",
    "pool": "DsxZiQTsdJbGJojzbdAy9yK7absibgAgUnMLTdNaWr4c",
    "dex": "meteora",
    "liquidityUSD": 3241,
    "tx24hReported": 18,
    "label": "DLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "UNHx",
    "name": "UnitedHealth xStock",
    "mint": "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe",
    "pool": "5xm6QUDxRyMg3Gx59CxXB6VZnRKs4bVu44DS6DzZr3Bp",
    "dex": "raydium",
    "liquidityUSD": 12917,
    "tx24hReported": 17,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "PGx",
    "name": "Procter & Gamble xStock",
    "mint": "XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV",
    "pool": "2ENFJDyjcPC2jAtGkiZEoNNswxNE9kwTvGVbndZkV2RP",
    "dex": "raydium",
    "liquidityUSD": 3241,
    "tx24hReported": 14,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "LLYx",
    "name": "Eli Lilly xStock",
    "mint": "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH",
    "pool": "D6qd9W868h6Jw318vhLSYyymDycydYPEkfsCGDKSzf34",
    "dex": "raydium",
    "liquidityUSD": 5066,
    "tx24hReported": 11,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "ASMLx",
    "name": "ASML xStock",
    "mint": "XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq",
    "pool": "DioZDLto4ASwBRJecyX73Cb14jGM9hNNFUscoemkkzNi",
    "dex": "orca",
    "liquidityUSD": 176,
    "tx24hReported": 10,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "DFDVx",
    "name": "DFDV xStock",
    "mint": "Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy",
    "pool": "EjKgT6qpSjgocwFAetsdJVA3XVRMh7EhnUuY3dJ8CwCh",
    "dex": "orca",
    "liquidityUSD": 2134,
    "tx24hReported": 9,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "CVXx",
    "name": "Chevron xStock",
    "mint": "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts",
    "pool": "5v5prv4UMT8fhzYjYwxUmvFuSQiGqF45vuNcmTkHTmi",
    "dex": "raydium",
    "liquidityUSD": 3819,
    "tx24hReported": 8,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "PEPx",
    "name": "PepsiCo xStock",
    "mint": "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF",
    "pool": "GmcGvaTDhwScEKcmDPsBiLxbgHtvTEGp89kHjpsHZjD2",
    "dex": "raydium",
    "liquidityUSD": 18554,
    "tx24hReported": 8,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "MRVLx",
    "name": "Marvell xStock",
    "mint": "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA",
    "pool": "BceYQ6QpGyCWDgWW3Yg24PCDcacxhSinvRU7dxKqScHJ",
    "dex": "raydium",
    "liquidityUSD": 447,
    "tx24hReported": 7,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "AZNx",
    "name": "AstraZeneca xStock",
    "mint": "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU",
    "pool": "BpqSiDKD3PKhg65M35wGML84r2kkV4MFEhikGbLNM5sc",
    "dex": "raydium",
    "liquidityUSD": 4046,
    "tx24hReported": 6,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "BMNRx",
    "name": "Bitmine xStock",
    "mint": "XsrBCwaH8c46xiqXBChzobgufRKxQxAWUWbndgBNzFn",
    "pool": "Dgd6PLs3MUuvfqauRFg9oRUq9qLdHUMhRcCAFMeXnHJj",
    "dex": "raydium",
    "liquidityUSD": 5586,
    "tx24hReported": 6,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "CRMx",
    "name": "Salesforce xStock",
    "mint": "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN",
    "pool": "DSpE6aBWD54Wz71yF7UHtYEPhsadN18zY7kMWiH78AGw",
    "dex": "orca",
    "liquidityUSD": 247,
    "tx24hReported": 4,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "APPx",
    "name": "AppLovin xStock",
    "mint": "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV",
    "pool": "91vXzR7coZZBDpheejXrBWMVunusDNQhkMHtNsiDRdi1",
    "dex": "fluxbeam",
    "liquidityUSD": 1,
    "tx24hReported": 4,
    "label": "",
    "verifiedOnChain": false
  },
  {
    "ticker": "ABTx",
    "name": "Abbott xStock",
    "mint": "XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7",
    "pool": "8YQvLk8cuMuaQHGnkQfB7UyG6xYGJyDueFRmfjs9m3Qw",
    "dex": "raydium",
    "liquidityUSD": 1711,
    "tx24hReported": 3,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "PFEx",
    "name": "Pfizer xStock",
    "mint": "XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw",
    "pool": "GNNmZSdUhP74AkM2D6U1qef1yXdSUoyWXLRUPGPSLt2s",
    "dex": "orca",
    "liquidityUSD": 1976,
    "tx24hReported": 2,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "VIDAx",
    "name": "Vida Global xStock",
    "mint": "XsfCC9VL4DamVGNgdJpfLXB3sBVa158Gbx8sh7NzmTk",
    "pool": "91SCMm7RyYFVMkdHWTTTmbDxfFnnUSdWeLEp3GEDBXJW",
    "dex": "orca",
    "liquidityUSD": 82,
    "tx24hReported": 2,
    "label": "wp",
    "verifiedOnChain": false
  },
  {
    "ticker": "CSCOx",
    "name": "Cisco xStock",
    "mint": "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf",
    "pool": "AXyFo4i37CUfGnv5BrMUubqxNJJSRQqJuEgVoLyokmkQ",
    "dex": "raydium",
    "liquidityUSD": 439,
    "tx24hReported": 1,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "TMOx",
    "name": "Thermo Fisher xStock",
    "mint": "Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57",
    "pool": "7eT7W5fek6gu2EizyQpjHHgr12Hg8NcutE7zR4Up6wF1",
    "dex": "raydium",
    "liquidityUSD": 89,
    "tx24hReported": 1,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "RIOTx",
    "name": "Riot Platforms xStock",
    "mint": "Xs31mE5EiqjSHEaiX9QDKCN6NvSGCqpJ6f1FNq2wri5",
    "pool": "J6CSQkrgGW6A8Dmux2wVfN3NRNaz8kwUBWjzynpLJNyW",
    "dex": "raydium",
    "liquidityUSD": 5205,
    "tx24hReported": 1,
    "label": "CLMM",
    "verifiedOnChain": false
  },
  {
    "ticker": "ITAx",
    "name": "iShares U.S. Aerospace & Defense ETF xStock",
    "mint": "XsXoAR52Q2NYFkYiNqhCq4FauvyA1tdRsrmEYNf9fuh",
    "pool": "7xubifERLKWFf9SKngjXSAbL75hJaJRRBT5XYydtkEiQ",
    "dex": "fluxbeam",
    "liquidityUSD": 2,
    "tx24hReported": 1,
    "label": "",
    "verifiedOnChain": false
  }
]
);
