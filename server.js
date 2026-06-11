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
const TREASURY_ADDR = process.env.TREASURY_ADDRESS;
if (!TREASURY_ADDR) {
  throw new Error("TREASURY_ADDRESS environment variable is required");
}

const ENTRY_FEE       = 100;   // fallback only — dynamic fee targets $0.99 USD
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
  return 100;
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
  'https://solana-mainnet.g.alchemy.com/v2/5f2UJclPRZdXt_Lfg5RMx',
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
async function verifyEntryFee(txId, expectedFee = ENTRY_FEE) {
  const mint = MINT_ADDRESS;
  const treasury = TREASURY_ADDR;
  const rawExpected = Math.round(expectedFee * Math.pow(10, DECIMALS));

  let tx;
  try {
    tx = await withRpc(
      async conn => conn.getParsedTransaction(txId, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      }),
      14000
    );
  } catch (e) {
    console.warn(`[VERIFY] RPC error checking tx ${txId.slice(0,12)}…: ${e.message} — allowing through`);
    return { ok: true, rpcFailed: true };
  }

  if (!tx) {
    return { ok: true, rpcFailed: true };
  }

  if (tx.meta?.err) {
    console.error("[VERIFY TX ERROR]", txId, JSON.stringify(tx.meta.err), tx.meta.logMessages || []);
    throw new Error(
      "Transaction failed: " +
      JSON.stringify(tx.meta.err) +
      " LOGS: " +
      JSON.stringify(tx.meta.logMessages || [])
    );
  }

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  let treasuryCredit = 0;
  let senderWallet = null;

  for (const p of post) {
    if (p.mint !== mint) continue;

    const preBal = pre.find(
      x => x.accountIndex === p.accountIndex && x.mint === mint
    );

    const before = preBal?.uiTokenAmount?.uiAmount ?? 0;
    const after = p.uiTokenAmount?.uiAmount ?? 0;
    const delta = after - before;

    if (p.owner === treasury && delta > 0) {
      treasuryCredit += delta;
    }

    if (delta < 0) {
      senderWallet = p.owner;
    }
  }

  if (treasuryCredit <= 0) {
    throw new Error(`Transaction ${txId.slice(0,12)}… did not send MONET to treasury`);
  }

  const rawActual = Math.round(treasuryCredit * Math.pow(10, DECIMALS));

  if (rawActual < rawExpected) {
    throw new Error(
      `Transaction sent ${treasuryCredit.toFixed(DECIMALS)} MONET but expected ${expectedFee}`
    );
  }

  return { ok: true, senderWallet, amount: treasuryCredit };
}

async function verifySOLPayment(txId, expectedLamports = SOL_ENTRY_LAMPORTS) {
  let tx;

  try {
    tx = await withRpc(
      async conn => conn.getParsedTransaction(txId, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      }),
      14000
    );
  } catch (e) {
    console.warn(`[VERIFY-SOL] RPC error ${txId.slice(0,12)}…: ${e.message} — allowing through`);
    return { ok: true, rpcFailed: true };
  }

  if (!tx) {
    return { ok: true, rpcFailed: true };
  }

  if (tx.meta?.err) {
    console.error("[VERIFY SOL ERROR]", txId, JSON.stringify(tx.meta.err), tx.meta.logMessages || []);
    throw new Error(
      "Transaction failed: " +
      JSON.stringify(tx.meta.err) +
      " LOGS: " +
      JSON.stringify(tx.meta.logMessages || [])
    );
  }

  const keys = tx.transaction.message.accountKeys || [];

  const tIdx = keys.findIndex(
    a => (typeof a === 'string' ? a : a.pubkey?.toString()) === TREASURY_ADDR
  );

  if (tIdx === -1) {
    throw new Error(`Transaction ${txId.slice(0,12)}… did not involve treasury`);
  }

  const delta =
    (tx.meta.postBalances[tIdx] ?? 0) -
    (tx.meta.preBalances[tIdx] ?? 0);

  if (delta < expectedLamports) {
    throw new Error(
      `SOL payment too small: got ${delta} lamports, expected ${expectedLamports}`
    );
  }

  return { ok: true, delta };
}
const CPU_RANGES = {
  easy:   { frogger:[100,350],    snake:[6,16],   pacman:[1000,3500],   pong:[2,4], dino:[300,900],   mario:[100,300]   },
  medium: { frogger:[500,1100],   snake:[22,50],  pacman:[5000,11000],  pong:[5,7], dino:[1200,3000], mario:[300,800]   },
  hard:   { frogger:[1800,4000],  snake:[80,140], pacman:[20000,40000], pong:[7,9], dino:[5000,12000], mario:[800,1500] },
  expert: { frogger:[5000,9000],  snake:[200,400],pacman:[60000,99000], pong:[9,10],dino:[15000,30000],mario:[2000,4000]},
};

// ─── Balance cache (stale-while-revalidate) ───────────────────────────────────
// Keeps the last known-good balance per wallet for up to 90 seconds.
// When RPCs are rate-limited the cached value is returned instead of 0,
// so the user sees a correct balance even during 429 windows.
const BALANCE_CACHE     = new Map();  // wallet → { monet, sol, ata, hasAta, ts }
const BALANCE_CACHE_TTL = 90_000;    // ms

// ─── Routes: wallet utilities ────────────────────────────────────────────────
app.get('/api/balance/:wallet', async (req, res) => {
  const walletAddr = req.params.wallet;
  const cached     = BALANCE_CACHE.get(walletAddr);

  // Serve stale cache while a fresh fetch runs in the background
  if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) {
    return res.json({ ok: true, ...cached, cached: true });
  }

  try {
    const owner = new PublicKey(walletAddr);
    const mint  = new PublicKey(MINT_ADDRESS);

    // getParsedTokenAccountsByOwner is the most reliable method — returns
    // fully parsed data regardless of which RPC node answers.
    const conn = new Connection("https://solana-mainnet.g.alchemy.com/v2/5f2UJclPRZdXt_Lfg5RMx","confirmed");
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner,{ mint });
    const solLamports = await conn.getBalance(owner);
    const tokenOk = true;
    const solOk = true;
    const tokenResult = { value: tokenAccounts };
    const solResult = { value: solLamports };

    // Token RPC failed — serve stale cache or 503 rather than a false 0
    if (!tokenOk) {
      if (cached) {
        console.warn(`[MONET] balance ${walletAddr.slice(0,8)}… token RPC failed, serving cache`);
        const solBalance = solOk ? (solResult.value ?? 0) / 1e9 : cached.sol;
        return res.json({ ok: true, ...cached, sol: solBalance, cached: true, stale: !solOk });
      }
      // No cache and token RPC failed — tell client to keep whatever it has
      console.warn(`[MONET] balance ${walletAddr.slice(0,8)}… token RPC failed, no cache`);
      return res.status(503).json({ error: 'Token RPC unavailable, no cached balance' });
    }

    let monetBalance = 0;
    let hasAta       = false;
    let ata          = null;
    if (tokenResult.value?.value?.length > 0) {
      const acct   = tokenResult.value.value[0];
      monetBalance = acct.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
      hasAta       = true;
      ata          = acct.pubkey.toString();
    } else {
      ata = getATA(mint, owner).toString();
    }

    const solBalance = solOk ? (solResult.value ?? 0) / 1e9 : (cached?.sol ?? 0);
    const entry = { monet: monetBalance, sol: solBalance, ata, hasAta, ts: Date.now() };
    BALANCE_CACHE.set(walletAddr, entry);

    console.log(`[MONET] balance ${walletAddr.slice(0,8)}… monet=${monetBalance} sol=${solBalance} hasAta=${hasAta}`);
    res.json({ ok: true, ...entry });
  } catch(e) {
    if (cached) {
      console.warn(`[MONET] /api/balance error (serving cache):`, e.message);
      return res.json({ ok: true, ...cached, cached: true, stale: true });
    }
    console.error('[MONET] /api/balance error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// Treasury auto-creates the player's MONET Associated Token Account.
// New players don't have an ATA until they acquire MONET, which means
// they also can't receive payouts. Treasury pays the ~0.002 SOL rent.
app.post('/api/create-token-account', async (req, res) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  try {
    const mint  = new PublicKey(MINT_ADDRESS);
    const owner = new PublicKey(wallet);
    const ata   = getATA(mint, owner);

    // Check if ATA already exists — skip if so
    const existing = await withRpc(conn => conn.getAccountInfo(ata));
    if (existing) return res.json({ ok: true, ata: ata.toString(), created: false });

    const kp = getTreasuryKP();
    if (!kp) {
      // No key — tell client the ATA address so it can display it, but skip creation
      return res.json({ ok: false, ata: ata.toString(), created: false, error: 'Treasury key not set' });
    }

    // Build + sign + send the create-ATA transaction (treasury is payer)
    const txId = await withRpc(async conn => {
      const tx = new Transaction();
      tx.feePayer = kp.publicKey;
      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.add(makeCreateATAIx(kp.publicKey, ata, owner, mint));
      tx.sign(kp);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction(sig, 'confirmed');
      return sig;
    }, 30000);

    console.log(`[MONET] ATA created for ${wallet.slice(0,8)}… txId: ${txId}`);
    res.json({ ok: true, ata: ata.toString(), created: true, txId });
  } catch(e) {
    console.error('[MONET] create-token-account failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Returns the latest blockhash for clients to build transactions.
// Bypasses browser 403s — the client uses this when direct RPC calls fail.
app.get('/api/blockhash', async (req, res) => {
  try {
    const { blockhash, lastValidBlockHeight } = await withRpc(conn => conn.getLatestBlockhash());
    res.json({ ok: true, blockhash, lastValidBlockHeight });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Returns whether an account (e.g. treasury ATA) exists on-chain.
app.get('/api/account-exists/:address', async (req, res) => {
  try {
    const info = await withRpc(conn => conn.getAccountInfo(new PublicKey(req.params.address)));
    res.json({ ok: true, exists: !!info });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: Stripe card payments ─────────────────────────────────────────────
app.get('/api/stripe/config', async (_req, res) => {
  try {
    const { publishableKey } = await _getStripeCredentials();
    res.json({ ok: true, publishableKey });
  } catch(e) {
    res.json({ ok: false, publishableKey: null, reason: e.message });
  }
});

app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    const stripe       = await _getStripeClient();
    const game         = (req.body.game || 'game').toLowerCase();
    const sessionToken = crypto.randomUUID();
    const pi = await stripe.paymentIntents.create({
      amount:   99,          // $0.99 USD in cents
      currency: 'usd',
      metadata: { game, sessionToken, source: 'monet-arcade' },
    });
    // Pre-create card session (confirmed once payment webhook fires)
    createCardSession(game, pi.id);
    // Patch the stored session with the token we already embedded in metadata
    const sessions = getCardSessions();
    const s = sessions.find(s => s.paymentIntentId === pi.id);
    if (s) { s.token = sessionToken; saveCardSessions(sessions); }
    res.json({ ok: true, clientSecret: pi.client_secret, sessionToken });
  } catch(e) {
    console.error('[STRIPE] create-payment-intent error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/card-session/validate', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const sessions = getCardSessions();
    let s = sessions.find(s => s.token === token);
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (Date.now() > s.expiresAt) return res.status(410).json({ error: 'Session expired' });

    // If not yet confirmed by webhook, verify directly with Stripe API
    if (!s.confirmed) {
      try {
        const stripe = await _getStripeClient();
        const pi = await stripe.paymentIntents.retrieve(s.paymentIntentId);
        if (pi.status === 'succeeded') { s.confirmed = true; saveCardSessions(sessions); }
      } catch(_) {}
    }
    if (!s.confirmed) return res.status(402).json({ error: 'Payment not confirmed yet' });

    res.json({ ok: true, game: s.game, expiresAt: s.expiresAt });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: status ───────────────────────────────────────────────────────────
app.get('/api/rpc-url', (_req, res) => {
  res.json({ ok: true, url: process.env.SOLANA_RPC_URL || 'https://solana-mainnet.g.alchemy.com/v2/KPQ8ePE-ENpVCyrvI6bdY' });
});

// ─── Routes: MONET price / dynamic entry fee ──────────────────────────────
app.get('/api/monet-price', async (_req, res) => {
  const solPriceUsd = await getSolPrice().catch(() => null);
  const solEntryLamports = solPriceUsd ? Math.max(100_000, Math.round((0.99 / solPriceUsd) * 1e9)) : SOL_ENTRY_LAMPORTS;
  res.json({
    ok: true,
    priceUsd: 0.0099,
    entryFeeMonet: ENTRY_FEE,
    entryFeeUsd: 0.99,
    solPriceUsd,
    solEntryLamports,
    cached: true
  });
});

app.get('/api/status', async (req, res) => {
  const balance    = await getTreasuryBalance().catch(() => 0);
  const challenges = dbRead('challenges');
  const tourneys   = dbRead('tournaments');
  const claims     = dbRead('claims');
  res.json({
    ok: true,
    treasury:          TREASURY_ADDR,
    balance,
    hasTreasuryKey:    !!getTreasuryKP(),
    openChallenges:    challenges.filter(c => c.status === 'open').length,
    activeChallenges:  challenges.filter(c => c.status === 'active').length,
    activeTournaments: tourneys.filter(t => ['registration','active'].includes(t.status)).length,
    pendingClaims:     claims.filter(c => c.status === 'pending').length,
  });
});

// ─── Routes: challenges ───────────────────────────────────────────────────────
app.post('/api/challenge/create', async (req, res) => {
  const { wallet, txId, game, entryFee: reqFee, paymentType } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  const challenges = dbRead('challenges');
  challenges.forEach(c => { if (c.status === 'open' && Date.now() > c.expiresAt) c.status = 'expired'; });

  const baseFee = await getDynamicEntryFee();
  const fee = (reqFee && Number(reqFee) > 0) ? Number(reqFee) : baseFee;
  // Accept any fee >= 0.4x and <= 12x of the current dynamic base fee (tolerant of price swings)
  if (fee <= 0 || fee < baseFee * 0.4 || fee > baseFee * 12) {
    return res.status(400).json({ error: `Invalid entry fee: ${fee} MONET (current base: ${baseFee} MONET)` });
  }
  // Reject duplicate txIds to prevent replay
  const allForDedup = dbRead('challenges');
  if (allForDedup.some(c => c.player1?.txId === txId || c.player2?.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, fee); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  const code      = genCode();
  const pot       = calcPot(2, fee);

  const escrowKP = Keypair.generate();

  const challenge = {
    escrow: {
      publicKey: escrowKP.publicKey.toBase58(),
      secretKey: Array.from(escrowKP.secretKey)
    },
    id:        genId(),
    code,
    game,
    player1:   { wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null },
    player2:   null,
    entryFee:  fee,
    pot:       pot.net,
    rake:      pot.rake,
    status:    'open',
    winner:    null,
    payoutTxId: null,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL,
  };
  challenges.push(challenge);
  dbWrite('challenges', challenges);
  res.json({ ok: true, code, challengeId: challenge.id, pot: pot.net, entryFee: fee });
});

app.get('/api/challenge/:code', (req, res) => {
  const challenges = dbRead('challenges');
  const c = challenges.find(ch => ch.code === req.params.code.toUpperCase());
  if (!c) return res.status(404).json({ error: 'Challenge not found' });
  res.json({ ok: true, challenge: c });
});

app.get('/api/challenges', (req, res) => {
  const { wallet } = req.query;
  let list = dbRead('challenges').filter(c => c.status !== 'expired');
  if (wallet) list = list.filter(c => c.player1?.wallet === wallet || c.player2?.wallet === wallet);
  res.json({ ok: true, challenges: list });
});

app.post('/api/challenge/join', async (req, res) => {
  const { code, wallet, txId, paymentType } = req.body;
  if (!code || !wallet || !txId) return res.status(400).json({ error: 'code, wallet, txId required' });

  const challenges = dbRead('challenges');
  const idx = challenges.findIndex(c => c.code === code.toUpperCase());
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });

  const c = challenges[idx];
  if (c.status !== 'open')          return res.status(409).json({ error: `Challenge is ${c.status}` });
  if (Date.now() > c.expiresAt)     { c.status = 'expired'; dbWrite('challenges', challenges); return res.status(410).json({ error: 'Challenge has expired' }); }
  if (c.player1.wallet === wallet)  return res.status(409).json({ error: 'Cannot challenge yourself' });
  // Reject duplicate txIds to prevent replay
  if (challenges.some(ch => ch.player1?.txId === txId || ch.player2?.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, c.entryFee || ENTRY_FEE); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  c.player2      = { wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null };
  c.status       = 'active';
  c.activatedAt  = Date.now();  // used by anti-cheat min-duration check
  dbWrite('challenges', challenges);
  res.json({ ok: true, challenge: c });
});

app.post('/api/challenge/submit', async (req, res) => {
  const { challengeId, wallet, score } = req.body;
  if (!challengeId || !wallet || score == null) return res.status(400).json({ error: 'challengeId, wallet, score required' });

  // Rate limit
  if (!checkRateLimit(wallet)) return res.status(429).json({ error: 'Too many score submissions — slow down' });

  const challenges = dbRead('challenges');
  const idx = challenges.findIndex(c => c.id === challengeId);
  if (idx === -1) return res.status(404).json({ error: 'Challenge not found' });

  const c = challenges[idx];
  if (c.status === 'complete')  return res.json({ ok: true, challenge: c });
  if (Date.now() > c.expiresAt) { c.status = 'expired'; dbWrite('challenges', challenges); return res.status(410).json({ error: 'Challenge expired' }); }

  // Score sanity — use challenge activatedAt (when P2 joined) or createdAt as session start
  const sessionStart = c.activatedAt || c.createdAt;
  const sanity = checkScoreSanity(c.game, score, sessionStart);
  if (!sanity.ok) {
    flagSuspicious({ reason: 'score_sanity_fail', detail: sanity.reason, wallet, game: c.game, score, challengeId });
    return res.status(400).json({ error: `Score rejected: ${sanity.reason}` });
  }
  const softCap = SCORE_SOFT_CAP[c.game] ?? SCORE_DEFAULT_SOFT_CAP;
  if (score > softCap) {
    flagSuspicious({ reason: 'above_soft_cap', wallet, game: c.game, score, softCap, challengeId });
  }

  if (c.player1.wallet === wallet) {
    if (c.player1.score === null || score > c.player1.score) { c.player1.score = score; c.player1.submittedAt = Date.now(); }
  } else if (c.player2?.wallet === wallet) {
    if (c.player2.score === null || score > c.player2.score) { c.player2.score = score; c.player2.submittedAt = Date.now(); }
  } else {
    return res.status(403).json({ error: 'Not a participant in this challenge' });
  }

  if (c.player1.score !== null && c.player2?.score !== null) {
    if (c.player1.score === c.player2.score) { const rematchCode = genCode(); challenges.push({ ...JSON.parse(JSON.stringify(c)), id: genId(), code: rematchCode, status: "active", winner: null, payoutTxId: null, player1: { ...c.player1, score: null, submittedAt: null }, player2: { ...c.player2, score: null, submittedAt: null }, createdAt: Date.now(), expiresAt: Date.now() + CHALLENGE_TTL }); c.status = "rematch"; c.rematchCode = rematchCode; dbWrite("challenges", challenges); return res.json({ ok:true, challenge:c, rematchCode }); }

    c.winner = (c.player1.score > c.player2.score) ? c.player1.wallet : c.player2.wallet;
    c.status = 'complete';
    try {
      c.payoutTxId = await sendPayout(c.winner, c.pot);
      console.log(`[PAYOUT] Challenge ${c.code} winner ${c.winner.slice(0,8)}… paid ${c.pot} MONET`);
    } catch(e) {
      console.error(`[PAYOUT] Challenge ${c.code} payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'challenge', refId: c.id, wallet: c.winner, amount: c.pot, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
  }

  dbWrite('challenges', challenges);
  res.json({ ok: true, challenge: c });
});

// ─── Routes: tournaments ──────────────────────────────────────────────────────
app.get('/api/tournament/list', (req, res) => {
  const list = dbRead('tournaments');
  res.json({ ok: true, tournaments: list });
});

app.post('/api/tournament/create', async (req, res) => {
  const { game, title, maxPlayers } = req.body;
  if (!game) return res.status(400).json({ error: 'game required' });
  const max = Math.min(MAX_PLAYERS, Math.max(2, parseInt(maxPlayers) || 8));
  const t = {
    id:         genId(),
    game,
    title:      title || `${game.toUpperCase()} TOURNAMENT`,
    maxPlayers: max,
    minPlayers: MIN_PLAYERS,
    players:    [],
    entryFee:   await getDynamicEntryFee(),
    prizePool:  0,
    rake:       0,
    prizes:     PRIZE_CUTS,
    status:     'registration',
    startTime:  null,
    endTime:    null,
    createdAt:  Date.now(),
    winners:    [],
  };
  const tourneys = dbRead('tournaments');
  tourneys.push(t);
  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.get('/api/tournament/:id', (req, res) => {
  const t = dbRead('tournaments').find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/register', async (req, res) => {
  const { tournamentId, wallet, txId, paymentType } = req.body;
  if (!tournamentId || !wallet || !txId) return res.status(400).json({ error: 'tournamentId, wallet, txId required' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'registration')       return res.status(409).json({ error: `Tournament is ${t.status}` });
  if (t.players.find(p => p.wallet === wallet)) return res.status(409).json({ error: 'Already registered' });
  if (t.players.length >= t.maxPlayers)  return res.status(409).json({ error: 'Tournament is full' });

  // Verify payment on-chain — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, t.entryFee || ENTRY_FEE); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }
  // Reject duplicate txIds across tournament entries
  if (tourneys.some(tt =>
    tt.players?.some(p => p.txId === txId)
  )) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  t.players.push({ wallet, txId, paymentType: paymentType || 'monet', score: null, submittedAt: null, rank: null });

  const pot = calcPot(t.players.length, t.entryFee || ENTRY_FEE);
  t.prizePool = pot.net;
  t.rake      = pot.rake;

  if (t.players.length >= t.maxPlayers) {
    t.status    = 'active';
    t.startTime = Date.now();
    t.endTime   = Date.now() + TOURNEY_WINDOW;
  }

  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/start/:id', (req, res) => {
  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const t = tourneys[idx];
  if (t.status !== 'registration') return res.status(409).json({ error: 'Cannot start' });
  if (t.players.length < t.minPlayers) return res.status(409).json({ error: `Need at least ${t.minPlayers} players` });
  t.status    = 'active';
  t.startTime = Date.now();
  t.endTime   = Date.now() + TOURNEY_WINDOW;
  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: t });
});

app.post('/api/tournament/submit', async (req, res) => {
  const { tournamentId, wallet, score } = req.body;
  if (!tournamentId || !wallet || score == null) return res.status(400).json({ error: 'tournamentId, wallet, score required' });

  // Rate limit
  if (!checkRateLimit(wallet)) return res.status(429).json({ error: 'Too many score submissions — slow down' });

  const tourneys = dbRead('tournaments');
  const idx = tourneys.findIndex(t => t.id === tournamentId);
  if (idx === -1) return res.status(404).json({ error: 'Tournament not found' });

  const t = tourneys[idx];
  if (t.status !== 'active') return res.status(409).json({ error: `Tournament is ${t.status}` });

  const playerIdx = t.players.findIndex(p => p.wallet === wallet);
  if (playerIdx === -1) return res.status(403).json({ error: 'Not registered' });

  // Score sanity — session starts when tournament goes active
  const sanity = checkScoreSanity(t.game, score, t.startTime);
  if (!sanity.ok) {
    flagSuspicious({ reason: 'score_sanity_fail', detail: sanity.reason, wallet, game: t.game, score, tournamentId });
    return res.status(400).json({ error: `Score rejected: ${sanity.reason}` });
  }
  const softCap = SCORE_SOFT_CAP[t.game] ?? SCORE_DEFAULT_SOFT_CAP;
  if (score > softCap) {
    flagSuspicious({ reason: 'above_soft_cap', wallet, game: t.game, score, softCap, tournamentId });
  }

  if (t.players[playerIdx].score === null || score > t.players[playerIdx].score) {
    t.players[playerIdx].score       = score;
    t.players[playerIdx].submittedAt = Date.now();
  }

  const timeUp   = Date.now() > t.endTime;
  const allDone  = t.players.every(p => p.score !== null);
  if (timeUp || allDone) await settleTournament(tourneys, idx);

  dbWrite('tournaments', tourneys);
  res.json({ ok: true, tournament: tourneys[idx] });
});

async function settleTournament(tourneys, idx) {
  const t = tourneys[idx];
  if (t.status === 'complete') return;
  t.status = 'complete';

  const ranked = [...t.players]
    .filter(p => p.score !== null)
    .sort((a, b) => b.score - a.score);

  ranked.forEach((p, i) => {
    const pl = t.players.find(x => x.wallet === p.wallet);
    if (pl) pl.rank = i + 1;
  });

  const netPool = t.prizePool;
  t.winners = [];

  for (let i = 0; i < Math.min(3, ranked.length); i++) {
    const pct    = PRIZE_CUTS[i] ?? 0;
    const payout = Math.floor(netPool * pct * 100) / 100;
    if (payout <= 0) continue;
    const w = { wallet: ranked[i].wallet, rank: i + 1, payout, payoutTxId: null };
    try {
      w.payoutTxId = await sendPayout(w.wallet, payout);
      console.log(`[PAYOUT] Tournament rank #${i+1} ${w.wallet.slice(0,8)}… paid ${payout} MONET`);
    } catch(e) {
      console.error(`[PAYOUT] Tournament rank #${i+1} payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'tournament', refId: t.id, wallet: w.wallet, rank: i + 1, amount: payout, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
    t.winners.push(w);
  }
}

// ─── Admin auth helper ────────────────────────────────────────────────────────
function requireAdmin(req, res) {
  const token    = (req.headers['x-admin-token'] || '').trim();
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ error: 'Invalid admin token' });
    return false;
  }
  return true;
}

app.get('/api/admin/verify', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true });
});

// ─── Routes: claims ───────────────────────────────────────────────────────────
app.get('/api/claims', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { wallet } = req.query;
  let list = dbRead('claims');
  if (wallet) list = list.filter(c => c.wallet === wallet);
  res.json({ ok: true, claims: list });
});

app.get('/api/claims/pending', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const claims = dbRead('claims').filter(c => c.status === 'pending');
  res.json({ ok: true, claims, count: claims.length });
});

// Mark a claim paid after the browser-connected treasury wallet broadcasts the tx.
// Idempotent: safe to call twice with the same txId.
app.post('/api/payout/complete', async (req, res) => {
  const { claimId, txId } = req.body;
  if (!claimId || !txId) return res.status(400).json({ error: 'claimId and txId required' });

  const claims = dbRead('claims');
  const idx = claims.findIndex(c => c.id === claimId);
  if (idx === -1) return res.status(404).json({ error: 'Claim not found' });

  const claim = claims[idx];
  if (claim.status === 'paid') return res.json({ ok: true, claim }); // already done

  claim.payoutTxId  = txId;
  claim.status      = 'paid';
  claim.processedAt = Date.now();
  delete claim.error;
  dbWrite('claims', claims);

  console.log(`[PAYOUT] Browser-signed: ${claim.type} ${claim.id.slice(0,8)} → ${claim.wallet.slice(0,8)}… ${claim.amount} MONET | tx: ${txId.slice(0,12)}…`);
  res.json({ ok: true, claim });
});

app.post('/api/claims/process', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { claimId } = req.body;
  const claims = dbRead('claims');
  const idx = claims.findIndex(c => c.id === claimId);
  if (idx === -1) return res.status(404).json({ error: 'Claim not found' });
  const claim = claims[idx];
  if (claim.status !== 'pending') return res.status(409).json({ error: 'Already processed' });
  try {
    claim.payoutTxId   = await sendPayout(claim.wallet, claim.amount);
    claim.status       = 'paid';
    claim.processedAt  = Date.now();
    dbWrite('claims', claims);
    res.json({ ok: true, claim });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Routes: leaderboard ──────────────────────────────────────────────────────

// POST /api/leaderboard/submit — record a solo-play score (no payout, leaderboard only)
app.post('/api/leaderboard/submit', (req, res) => {
  const { wallet, game, score, txId } = req.body || {};
  if (!wallet || !game || score == null) return res.status(400).json({ error: 'wallet, game, score required' });
  const soloScores = dbRead('solo_scores');
  soloScores.push({ wallet, game, score: Number(score), txId: txId || null, submittedAt: new Date().toISOString() });
  dbWrite('solo_scores', soloScores);
  console.log(`[SOLO] ${wallet.slice(0,8)}… scored ${score} on ${game}`);
  res.json({ ok: true });
});

app.get('/api/leaderboard/:game', (req, res) => {
  const { game } = req.params;
  const challenges  = dbRead('challenges').filter(c => c.game === game && c.status === 'complete');
  const tourneys    = dbRead('tournaments').filter(t => t.game === game && t.status === 'complete');
  const cpuGames    = dbRead('cpu_games').filter(g => g.game === game && g.status === 'complete');
  const soloEntries = dbRead('solo_scores').filter(s => s.game === game);

  // Track best score + the tx that paid out for each wallet
  const scores = {}; // wallet -> { score, payoutTxId, entryTxId, source }
  const addScore = (wallet, score, payoutTxId, entryTxId, source) => {
    if (!scores[wallet] || score > scores[wallet].score) {
      scores[wallet] = { score, payoutTxId: payoutTxId || null, entryTxId: entryTxId || null, source: source || 'challenge' };
    }
  };

  challenges.forEach(c => {
    if (c.player1?.score) addScore(c.player1.wallet, c.player1.score, c.payoutTxId, c.player1.txId, 'h2h');
    if (c.player2?.score) addScore(c.player2.wallet, c.player2.score, c.payoutTxId, c.player2.txId, 'h2h');
  });
  tourneys.forEach(t => {
    t.players.forEach(p => {
      if (p.score) {
        const winner = t.winners?.find(w => w.wallet === p.wallet);
        addScore(p.wallet, p.score, winner?.payoutTxId, p.txId, 'tournament');
      }
    });
  });
  cpuGames.forEach(g => {
    if (g.playerScore) addScore(g.wallet, g.playerScore, g.payoutTxId, g.txId, 'cpu');
  });
  soloEntries.forEach(s => addScore(s.wallet, s.score, null, s.txId, 'solo'));

  const board = Object.entries(scores)
    .map(([wallet, d]) => ({ wallet, ...d }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  res.json({ ok: true, game, leaderboard: board });
});

// Global leaderboard across all games
app.get('/api/leaderboard', (req, res) => {
  const games = ['pacman','snake','frogger','pong','dino','invaders','mario','duckhunt','fighter'];
  const scores = {}; // wallet -> { score, game, payoutTxId, source }

  games.forEach(game => {
    const challenges = dbRead('challenges').filter(c => c.game === game && c.status === 'complete');
    const cpuGames   = dbRead('cpu_games').filter(g => g.game === game && g.status === 'complete');
    const tourneys   = dbRead('tournaments').filter(t => t.game === game && t.status === 'complete');

    const addScore = (wallet, score, payoutTxId, source) => {
      const key = wallet + ':' + game;
      if (!scores[key] || score > scores[key].score) {
        scores[key] = { wallet, score, game, payoutTxId: payoutTxId || null, source: source || 'challenge' };
      }
    };
    challenges.forEach(c => {
      if (c.player1?.score) addScore(c.player1.wallet, c.player1.score, c.payoutTxId, 'h2h');
      if (c.player2?.score) addScore(c.player2.wallet, c.player2.score, c.payoutTxId, 'h2h');
    });
    cpuGames.forEach(g => { if (g.playerScore) addScore(g.wallet, g.playerScore, g.payoutTxId, 'cpu'); });
    tourneys.forEach(t => {
      t.players.forEach(p => {
        if (p.score) {
          const winner = t.winners?.find(w => w.wallet === p.wallet);
          addScore(p.wallet, p.score, winner?.payoutTxId, 'tournament');
        }
      });
    });
  });

  const board = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  res.json({ ok: true, leaderboard: board });
});

// Token-gate check — returns whether a wallet holds enough MONET to access premium content
app.get('/api/token-gate/:wallet', async (req, res) => {
  const { wallet } = req.params;
  const { threshold = 1 } = req.query;
  try {
    const cached = BALANCE_CACHE.get(wallet);
    let monet = cached?.monet ?? null;
    if (monet === null) {
      const mint  = new PublicKey(MINT_ADDRESS);
      const owner = new PublicKey(wallet);
      const result = await withRpc(conn => conn.getParsedTokenAccountsByOwner(owner, { mint }), 8000);
      monet = result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      BALANCE_CACHE.set(wallet, { monet, sol: cached?.sol ?? 0, ts: Date.now() });
    }
    const passes = monet >= Number(threshold);
    res.json({ ok: true, wallet, monet, threshold: Number(threshold), passes });
  } catch(e) {
    console.warn('[TOKEN-GATE] balance check failed:', e.message);
    res.json({ ok: true, wallet, monet: 0, threshold: Number(threshold), passes: false, error: e.message });
  }
});

