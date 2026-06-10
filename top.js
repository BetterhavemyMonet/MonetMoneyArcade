import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  Keypair, SystemProgram,
} from '@solana/web3.js';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Stripe (env vars take priority; Replit connector as fallback) ───────────
async function _getStripeCredentials() {
  // Explicit env vars always win — use these for live/production keys
  const sk = process.env.STRIPE_SECRET_KEY;
  const pk = process.env.STRIPE_PUBLISHABLE_KEY;
  if (sk && pk) return { secretKey: sk, publishableKey: pk };

  const hostname     = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) throw new Error('Stripe not configured');

  const fetchConn = async (env) => {
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets',  'true');
    url.searchParams.set('connector_names',  'stripe');
    url.searchParams.set('environment',      env);
    const resp = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'X-Replit-Token': xReplitToken },
    });
    const data = await resp.json();
    return data.items?.[0];
  };

  // Try production first (when deployed), fall back to development
  const envOrder = process.env.REPLIT_DEPLOYMENT === '1'
    ? ['production', 'development']
    : ['development'];

  let conn;
  for (const env of envOrder) {
    conn = await fetchConn(env);
    if (conn?.settings?.secret) break;
  }

  if (!conn?.settings?.secret) throw new Error('Stripe connection not found');
  // publishable key may be in different fields depending on connector version
  const publishableKey = conn.settings.publishable || conn.settings.publishableKey
    || conn.settings.pk || conn.settings.public_key || '';
  return { secretKey: conn.settings.secret, publishableKey };
}

// Never cache — always call this to get a fresh client (per Replit guidelines)
async function _getStripeClient() {
  const { secretKey } = await _getStripeCredentials();
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

const CARD_SESSION_TTL = 60 * 60 * 1000; // 1 hour

function getCardSessions() {
  const f = path.join(DATA_DIR, 'card-sessions.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveCardSessions(data) {
  fs.writeFileSync(path.join(DATA_DIR, 'card-sessions.json'), JSON.stringify(data, null, 2));
}
function createCardSession(game, paymentIntentId) {
  const token    = crypto.randomUUID();
  const sessions = getCardSessions().filter(s => Date.now() < s.expiresAt);
  sessions.push({ token, game, paymentIntentId, createdAt: Date.now(), expiresAt: Date.now() + CARD_SESSION_TTL, confirmed: false });
  saveCardSessions(sessions);
  return token;
}

const app = express();

app.use(cors({ origin: '*' }));

// Stripe webhook — raw body MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Without a webhook secret we cannot verify the signature — reject to prevent
    // unsigned payload spoofing. Sessions are confirmed lazily via direct Stripe
    // API lookup in /api/card-session/validate instead.
    console.warn('[STRIPE] Webhook received but STRIPE_WEBHOOK_SECRET not set — rejecting');
    return res.status(400).json({ error: 'Webhook secret not configured' });
  }
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
  try {
    const stripe = await _getStripeClient().catch(() => null);
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    const event = stripe.webhooks.constructEvent(req.body, sig, secret);
    if (event.type === 'payment_intent.succeeded') {
      const pi    = event.data.object;
      const token = pi.metadata?.sessionToken;
      if (token) {
        const sessions = getCardSessions();
        const s = sessions.find(s => s.token === token);
        if (s) { s.confirmed = true; saveCardSessions(sessions); }
      }
    }
    res.json({ received: true });
  } catch(e) {
    console.error('[STRIPE] Webhook error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const MINT_ADDRESS    = '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b';
const TREASURY_ADDR   = '4Uuga2iskhPvJyVAysQufh3vDwF9NRLmZQzHECwx8Cb4';
const ENTRY_FEE       = 5;   // fallback only — dynamic fee targets $0.99 USD
const TARGET_USD      = 0.99; // entry fee target in USD
const PRICE_CACHE_MS  = 5 * 60 * 1000; // cache MONET price for 5 minutes

// ─── Dynamic SOL pricing ───────────────────────────────────────────────────
let _solPriceUsd = null;
let _solPriceTs  = 0;

async function fetchSolPrice() {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      { headers: { 'User-Agent': 'monet-arcade/1.0' } }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const p = d?.solana?.usd;
    if (p > 0) { _solPriceUsd = p; _solPriceTs = Date.now(); }
  } catch(e) {
    console.warn('[PRICE] CoinGecko SOL fetch failed:', e.message);
  }
  return _solPriceUsd;
}

async function getSolPrice() {
  if (_solPriceUsd && Date.now() - _solPriceTs < PRICE_CACHE_MS) return _solPriceUsd;
  return fetchSolPrice();
}

// Returns lamports equivalent to TARGET_USD worth of SOL ($0.99)
// Falls back to 5_000_000 lamports (~$0.99 at ~$100/SOL) if price unavailable
async function getDynamicSolLamports() {
  const p = await getSolPrice();
  if (!p) return 5_000_000;
  return Math.max(100_000, Math.round((TARGET_USD / p) * 1e9));
}

// ─── Dynamic MONET pricing ─────────────────────────────────────────────────
let _monetPriceUsd = null;
let _monetPriceTs  = 0;

async function fetchMonetPrice() {
  try {
    // DexScreener — reliable, no API key required
    const r = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${MINT_ADDRESS}`,
      { headers: { 'User-Agent': 'monet-arcade/1.0' } }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    // Use the first pair with a valid USD price (highest liquidity usually first)
    const pairs = d?.pairs || [];
    const best  = pairs.find(p => p.priceUsd && parseFloat(p.priceUsd) > 0);
    const p     = best ? parseFloat(best.priceUsd) : 0;
    if (p > 0) { _monetPriceUsd = p; _monetPriceTs = Date.now(); }
  } catch(e) {
    console.warn('[PRICE] DexScreener fetch failed:', e.message);
  }
  return _monetPriceUsd;
}

async function getMonetPrice() {
  if (_monetPriceUsd && Date.now() - _monetPriceTs < PRICE_CACHE_MS) return _monetPriceUsd;
  return fetchMonetPrice();
}

// Returns the current MONET entry fee (how many MONET = $0.99 USD)
// Falls back to ENTRY_FEE (5) if price cannot be fetched.
async function getDynamicEntryFee() {
  return 10;
}

// Warm the price cache at startup
fetchMonetPrice().then(p => {
  if (p) console.log(`[PRICE] MONET = $${p.toExponential(3)} → entry fee ≈ ${Math.round(TARGET_USD/p)} MONET ($${TARGET_USD})`);
}).catch(() => {});

const DECIMALS = 6;
const HOUSE_RAKE      = 0.10;
const CPU_PAYOUT_MAX  = 9;
const SOL_ENTRY_LAMPORTS = 5_000_000;   // fallback only — dynamic fee targets $0.99 USD
const PRIZE_CUTS      = [0.50, 0.30, 0.10];
const CHALLENGE_TTL   = 24 * 60 * 60 * 1000;
const TOURNEY_WINDOW  = 60 * 60 * 1000;
const MIN_PLAYERS     = 2;
const MAX_PLAYERS     = 16;

// ─── Anti-cheat config ────────────────────────────────────────────────────────
// Hard caps: scores above these are physically impossible and are hard-rejected.
// Based on known game mechanics (e.g. Pac-Man max is 3,333,360; a single session
// is much shorter so session caps are lower).
const SCORE_HARD_CAP = {
  pacman:   500_000,
  snake:    10_000,
  frogger:  50_000,
  pong:     500,
  dino:     100_000,
  invaders: 100_000,
  mario:    999_999,
  duckhunt: 999_999,
  fighter:  999_999,
};
const SCORE_DEFAULT_HARD_CAP = 999_999;

// Soft caps: scores above these are flagged as suspicious but still accepted
// (to avoid blocking genuine high-scorers while we monitor).
const SCORE_SOFT_CAP = {
  pacman:   100_000,
  snake:    3_000,
  frogger:  15_000,
  pong:     200,
  dino:     30_000,
  invaders: 30_000,
  mario:    100_000,
  duckhunt: 100_000,
  fighter:  100_000,
};
const SCORE_DEFAULT_SOFT_CAP = 100_000;

// Minimum seconds a game session must exist before a score can be submitted.
// Prevents instant bot-speed submissions.
const MIN_GAME_DURATION_S = {
  pacman:   8,
  snake:    5,
  frogger:  5,
  pong:     10,
  dino:     5,
  invaders: 8,
  mario:    10,
  duckhunt: 8,
  fighter:  8,
};
const MIN_GAME_DURATION_DEFAULT_S = 5;

// Per-wallet rate limit: max submissions per window
const SUBMIT_RATE_LIMIT   = 5;   // max N submissions …
const SUBMIT_RATE_WINDOW  = 60_000; // … per 60 s per wallet
const _submitRateMap      = new Map(); // wallet -> [timestamp, ...]

// Score-secret HMAC key — stays stable per server process.
// Even if an attacker learns the key from a previous game, each session uses
// a fresh one-time scoreSecret so old keys cannot be replayed.
const SCORE_HMAC_KEY = crypto.randomBytes(32);

function genScoreSecret() {
  return crypto.randomBytes(16).toString('hex');
}

function verifyScoreHash(scoreSecret, score, hash) {
  if (!hash || !scoreSecret) return false;
  const expected = crypto.createHmac('sha256', SCORE_HMAC_KEY)
    .update(`${scoreSecret}:${Math.round(score)}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

function makeScoreHash(scoreSecret, score) {
  return crypto.createHmac('sha256', SCORE_HMAC_KEY)
    .update(`${scoreSecret}:${Math.round(score)}`)
    .digest('hex');
}

// Returns { ok, reason } — reason is set only when ok === false
function checkScoreSanity(game, score, sessionStartMs) {
  const s = Number(score);
  if (!Number.isFinite(s) || s < 0) return { ok: false, reason: 'invalid score value' };
  if (!Number.isInteger(s))          return { ok: false, reason: 'score must be an integer' };

  const hardCap = SCORE_HARD_CAP[game] ?? SCORE_DEFAULT_HARD_CAP;
  if (s > hardCap) return { ok: false, reason: `score ${s} exceeds hard cap ${hardCap} for ${game}` };

  if (sessionStartMs) {
    const elapsedS = (Date.now() - sessionStartMs) / 1000;
    const minS     = MIN_GAME_DURATION_S[game] ?? MIN_GAME_DURATION_DEFAULT_S;
    if (elapsedS < minS) return { ok: false, reason: `submitted too fast (${elapsedS.toFixed(1)}s < ${minS}s min)` };
  }
  return { ok: true };
}

function flagSuspicious(ctx) {
  try {
    const line = JSON.stringify({ ...ctx, ts: Date.now() }) + '\n';
    fs.appendFileSync(path.join(DATA_DIR, 'suspicious_scores.log'), line);
  } catch {}
  console.warn('[ANTI-CHEAT] suspicious score:', JSON.stringify(ctx));
}

function checkRateLimit(wallet) {
  const now  = Date.now();
  const hits  = (_submitRateMap.get(wallet) || []).filter(t => now - t < SUBMIT_RATE_WINDOW);
  if (hits.length >= SUBMIT_RATE_LIMIT) return false;
  hits.push(now);
  _submitRateMap.set(wallet, hits);
  return true;
}

const TOKEN_PROG   = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_PROG   = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bT3');
// Primary: user-configured via env var (recommended for production).
// Fallback: best-effort free public endpoints — server-side Node.js bypasses
// the browser CORS/rate-limit 403s that hit these from the frontend.
// Set SOLANA_RPC_URL secret for a dedicated RPC (Helius free tier recommended).
// Fallbacks are public endpoints that work from Node.js (no browser CORS issues).
const RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana'
].filter(Boolean);

// ─── Data helpers ──────────────────────────────────────────────────────────────
function dbRead(name) {
  const f = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function dbWrite(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// ─── Treasury keypair ─────────────────────────────────────────────────────────
function getTreasuryKP() {
  const key = process.env.TREASURY_PRIVATE_KEY;
  if (!key) return null;
  try {
    const bytes = JSON.parse(key);
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    console.warn('[MONET] TREASURY_PRIVATE_KEY must be a JSON array of 64 bytes');
    return null;
  }
}

// ─── Solana utilities ─────────────────────────────────────────────────────────
async function withRpc(fn, timeoutMs = 15000) {
  let last;
  for (const rpc of RPCS) {
    const conn = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: false });
    try {
      return await Promise.race([
        fn(conn),
        new Promise((_, r) => setTimeout(() => r(new Error(`timeout:${rpc}`)), timeoutMs)),
      ]);
    } catch(e) { last = e; console.warn(`[RPC] ${rpc} failed:`, e.message); }
  }
  throw last ?? new Error('All RPCs failed');
}

function getATA(mint, owner) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ASSOC_PROG
  )[0];
}

function makeCreateATAIx(payer, ata, owner, mint) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer,                    isSigner: true,  isWritable: true  },
      { pubkey: ata,                      isSigner: false, isWritable: true  },
      { pubkey: owner,                    isSigner: false, isWritable: false },
      { pubkey: mint,                     isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROG,               isSigner: false, isWritable: false },
    ],
    programId: ASSOC_PROG,
    data: Buffer.from([0]),
  });
}

function makeTransferIx(src, dst, owner, rawAmt) {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(rawAmt), 1);
  return new TransactionInstruction({
    keys: [
      { pubkey: src,   isSigner: false, isWritable: true  },
      { pubkey: dst,   isSigner: false, isWritable: true  },
      { pubkey: owner, isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROG,
    data,
  });
}

async function sendPayout(toAddress, amount) {
  const kp = getTreasuryKP();
  if (!kp) throw new Error('Treasury keypair not configured — set TREASURY_PRIVATE_KEY');

  const mint     = new PublicKey(MINT_ADDRESS);
  const treasury = new PublicKey(TREASURY_ADDR);
  const winner   = new PublicKey(toAddress);
  const rawAmt   = Math.round(amount * Math.pow(10, DECIMALS));

  // Phase 1: build + send. Look up actual token accounts via getParsedTokenAccountsByOwner
  // rather than computing with getATA — handles non-standard account addresses correctly.
  let sig = null;
  await withRpc(async conn => {
    // Find the treasury's actual MONET token account
    const srcAccounts = await conn.getParsedTokenAccountsByOwner(treasury, { mint });
    if (!srcAccounts.value.length) throw new Error('Treasury has no MONET token account');
    const srcATA = new PublicKey(srcAccounts.value[0].pubkey);

    // Find or prepare the winner's MONET token account
    const dstAccounts = await conn.getParsedTokenAccountsByOwner(winner, { mint });

    const tx = new Transaction();
    tx.feePayer = treasury;
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    tx.recentBlockhash      = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    let dstATA;
    if (dstAccounts.value.length) {
      dstATA = new PublicKey(dstAccounts.value[0].pubkey);
    } else {
      // Recipient has no MONET account — creating ATA costs ~0.002 SOL rent from treasury
      const MIN_SOL_FOR_ATA = 0.0025; // 0.002 rent + buffer for tx fees
      const tSOL = await getTreasurySOLBalance();
      if (tSOL < MIN_SOL_FOR_ATA) {
        throw new Error(
          `Treasury SOL too low (${tSOL.toFixed(5)} SOL) to create recipient token account. ` +
          `Please top up the treasury with at least 0.01 SOL, or have the recipient create a MONET ` +
          `token account first by receiving any MONET or using a wallet like Phantom.`
        );
      }
      dstATA = getATA(mint, winner);
      tx.add(makeCreateATAIx(treasury, dstATA, winner, mint));
      console.log(`[PAYOUT] Creating MONET ATA for ${toAddress.slice(0,8)}… (treasury SOL: ${tSOL.toFixed(5)})`);
    }

    tx.add(makeTransferIx(srcATA, dstATA, treasury, rawAmt));
    tx.sign(kp);
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    console.log(`[PAYOUT] sent ${amount} MONET → ${toAddress.slice(0,8)}… sig: ${sig.slice(0,12)}…`);
  });

  // Phase 2: poll for confirmation (public RPCs don't support signatureSubscribe WebSocket).
  // Poll every 2 s for up to 60 s — tx is in-flight and will confirm regardless.
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const status = await withRpc(conn => conn.getSignatureStatus(sig));
      const conf = status?.value?.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') {
        console.log(`[PAYOUT] confirmed (${conf}) sig: ${sig.slice(0,12)}…`);
        break;
      }
    } catch(e) {
      if (e.message.startsWith('Transaction failed')) throw e;
      // RPC error — keep polling
    }
  }
  return sig;
}

// ─── Treasury SOL balance (cached 30 s) ───────────────────────────────────────
let _tSOL = 0, _tSOLTs = 0;
async function getTreasurySOLBalance(force = false) {
  if (!force && Date.now() - _tSOLTs < 30_000) return _tSOL;
  try {
    const treasury = new PublicKey(TREASURY_ADDR);
    const lamports = await withRpc(conn => conn.getBalance(treasury), 8000);
    _tSOL   = lamports / 1e9;
    _tSOLTs = Date.now();
  } catch(e) { console.warn('[TREASURY-SOL] balance fetch failed:', e.message); }
  return _tSOL;
}

let _tBal = 0, _tBalTs = 0;
async function getTreasuryBalance() {
  if (Date.now() - _tBalTs < 60_000) return _tBal;
  try {
    const mint  = new PublicKey(MINT_ADDRESS);
    const owner = new PublicKey(TREASURY_ADDR);
    const bal = await withRpc(async conn => {
      const res = await conn.getParsedTokenAccountsByOwner(owner, { mint });
      return res?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    });
    _tBal = bal; _tBalTs = Date.now();
    return bal;
  } catch { return _tBal; }
}

// ─── ID generators ────────────────────────────────────────────────────────────
function genCode()  { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function genId()    { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function calcPot(n, fee = ENTRY_FEE) {
  const gross = n * fee;
  const rake  = Math.floor(gross * HOUSE_RAKE * 100) / 100;
  return { gross, rake, net: gross - rake };
}

// ─── On-chain payment verification ────────────────────────────────────────────
// Confirms txId is a real Solana tx that sent ≥ `expectedFee` MONET tokens
// to the treasury. Returns { ok, senderWallet, amount } on success or throws.
// Intentionally lenient on RPC failures (warns + allows through) to avoid
// blocking legitimate players during RPC outages; strict on bad amounts/recipients.
