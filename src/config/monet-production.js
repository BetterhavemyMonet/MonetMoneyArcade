/**
 * Monet Money Arcade production configuration.
 *
 * IMPORTANT:
 * MONET entry is fixed at exactly 0.0125 MONET.
 *
 * 0.0125 × 10^6 = 12,500 base units.
 */

export const MONET_PRODUCTION = Object.freeze({
  name: "Monet Money",
  symbol: "MONET",

  mint:
    "6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b",

  decimals: 6,

  entryFeeMonet: 0.0125,

  entryFeeBaseUnits: 12500,

  entryFeeUsd: 0.99,

  solPayment: {
    mode: "USD_EQUIVALENT",
    usdTarget: 0.99
  },

  payout: {
    winnerPercent: 80,
    treasuryPercent: 20
  },

  network: "mainnet-beta",

  siteUrl:
    "https://betterhavemymonet.com"
});

export const MONET_MINT =
  MONET_PRODUCTION.mint;

export const MONET_ENTRY_FEE =
  MONET_PRODUCTION.entryFeeMonet;

export const MONET_ENTRY_BASE_UNITS =
  MONET_PRODUCTION.entryFeeBaseUnits;
