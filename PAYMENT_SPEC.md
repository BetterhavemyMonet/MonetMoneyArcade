# Monet Money Arcade — Production Payment Specification

## Token

- Name: Monet Money
- Symbol: MONET
- Network: Solana Mainnet
- Mint: `6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b`
- Decimals: 6

## Arcade Entry

### MONET

**0.0125 MONET**

**12,500 SPL base units**

The MONET game entry is fixed and does not change with MONET market price.

### SOL

Target value:

**$0.99 USD equivalent**

SOL amount is calculated server-side from live SOL/USD pricing.

## Pot Distribution

- Winner: **80%**
- Treasury: **20%**

## Security

The backend is authoritative for:

- accepted mint
- treasury address
- entry amount
- transaction verification
- payout calculation
- winner payout
- treasury payout

The frontend must never be trusted for payment amounts.

RPC/payment verification failures must fail closed.

Treasury private keys must never be exposed to frontend code or committed to Git.

## Production Domain

https://betterhavemymonet.com
