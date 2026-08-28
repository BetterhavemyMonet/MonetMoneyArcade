export const PAYMENT_CONFIG = Object.freeze({
  network: "mainnet-beta",

  monet: {
    name: "Monet Money",
    symbol: "MONET",
    mint: "6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b",
    decimals: 6,

    entryFee: 0.0125,
    entryFeeBaseUnits: 12500
  },

  usd: {
    entryFee: 0.99
  },

  sol: {
    mode: "USD_EQUIVALENT",
    targetUsd: 0.99
  },

  payout: {
    winnerPercent: 80,
    treasuryPercent: 20
  },

  site: {
    url: "https://betterhavemymonet.com"
  }
});
