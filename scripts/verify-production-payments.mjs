import fs from 'node:fs';

const MINT = '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b';
const MONET_ENTRY = '0.0125';
const BASE_UNITS = '12500';
const USD_ENTRY = '0.99';

const server = fs.readFileSync('server.js', 'utf8');
const wallet = fs.readFileSync('wallet.js', 'utf8');

let failed = false;

function check(label, condition, value = '') {
  if (condition) {
    console.log(`✓ ${label}${value ? `: ${value}` : ''}`);
  } else {
    console.error(`✗ ${label}${value ? `: ${value}` : ''}`);
    failed = true;
  }
}

console.log('');
console.log('============================================================');
console.log(' MONET MONEY ARCADE — PAYMENT VERIFICATION V4');
console.log('============================================================');
console.log('');

check(
  'Canonical MONET mint',
  server.includes(MINT) && wallet.includes(MINT),
  MINT
);

check(
  'Canonical MONET entry',
  server.includes('const MONET_ENTRY_FEE = 0.0125'),
  '0.0125 MONET'
);

check(
  'Canonical base units',
  server.includes('const MONET_ENTRY_BASE_UNITS = 12500'),
  '12,500'
);

check(
  'USD target',
  server.includes('const TARGET_USD = 0.99'),
  '$0.99'
);

check(
  '80% winner payout',
  server.includes('const WINNER_PERCENT = 80'),
  '80%'
);

check(
  '20% treasury payout',
  server.includes('const TREASURY_PERCENT = 20'),
  '20%'
);

check(
  '20% house rake',
  server.includes('const HOUSE_RAKE = 0.20'),
  '0.20'
);

check(
  'Payout helper',
  server.includes('function calculatePayout(potAmount)'),
  'installed'
);

check(
  'SOL destination is treasury',
  wallet.includes('toPubkey: treasury'),
  'treasury'
);

check(
  'No challenge escrow in wallet',
  !wallet.includes('challenge.escrow'),
  'removed'
);

check(
  'No DexScreener server dependency',
  !server.includes('api.dexscreener.com/latest/dex/tokens/'),
  'removed'
);

check(
  'Production domain',
  server.includes('betterhavemymonet.com'),
  'betterhavemymonet.com'
);

check(
  'SOL RPC failure does not auto-accept',
  !server.includes('VERIFY-SOL] RPC error ${txId.slice(0,12)}…: ${e.message} — allowing through'),
  'fail-closed'
);

const targetMatches =
  server.match(/const TARGET_USD = 0\.99;/g) || [];

check(
  'TARGET_USD declared exactly once',
  targetMatches.length === 1,
  `${targetMatches.length} declaration`
);

const monetMatches =
  server.match(/const MONET_ENTRY_FEE = 0\.0125;/g) || [];

check(
  'MONET_ENTRY_FEE declared exactly once',
  monetMatches.length === 1,
  `${monetMatches.length} declaration`
);

console.log('');

if (failed) {
  console.error('❌ PAYMENT VERIFICATION FAILED');
  process.exit(1);
}

console.log('============================================================');
console.log(' ✅ PAYMENT CONFIGURATION VERIFIED');
console.log('============================================================');
console.log('');
console.log(`MONET:       ${MONET_ENTRY}`);
console.log(`BASE UNITS:  ${BASE_UNITS}`);
console.log(`USD:         $${USD_ENTRY}`);
console.log('SOL:         live $0.99 equivalent');
console.log('WINNER:      80%');
console.log('TREASURY:    20%');
console.log('');
