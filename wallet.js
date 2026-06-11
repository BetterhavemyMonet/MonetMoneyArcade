// ─── MONET ARCADE WALLET UTILITIES ───────────────────────────────────────────
// Multi-wallet adapter: Phantom, Coinbase Wallet, Solflare, Backpack, Glow, Coin98, Trust

const MONET_CONFIG = {
  MINT:         '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b',
  TREASURY:     '4Uuga2iskhPvJyVAysQufh3vDwF9NRLmZQzHECwx8Cb4',
  ENTRY_FEE:    5,      // updated dynamically by fetchEntryFee()
  ENTRY_FEE_USD: 0.99,  // target USD value per entry
  PAYOUT_RATE: 0.90,
  DECIMALS: 6,
  SYMBOL:       'MONET',
};

// ─── Dynamic entry fee ───────────────────────────────────────────────────────
// Fetches the current MONET price from the server and updates MONET_CONFIG.ENTRY_FEE
// so that it always equals $0.99 worth of MONET. Cached by the server for 5 min.
let _entryFeeFetched = false;
async function fetchEntryFee() {
  try {
    const r = await fetch('https://api.betterhavemymonet.com/api/monet-price');
    if (!r.ok) return;
    const d = await r.json();
    if (d.entryFeeMonet && d.entryFeeMonet > 0) {
      MONET_CONFIG.ENTRY_FEE = d.entryFeeMonet;
      MONET_CONFIG._priceUsd  = d.priceUsd;
      _entryFeeFetched = true;
    }
    if (d.solEntryLamports && d.solEntryLamports > 0) {
      MONET_CONFIG.SOL_ENTRY_LAMPORTS = d.solEntryLamports;
      MONET_CONFIG._solPriceUsd = d.solPriceUsd;
    }
    // Notify pay gate if it's already open
    document.dispatchEvent(new CustomEvent('entryFeeUpdated', { detail: d }));
  } catch(_) {}
}

// Fetch on load, refresh every 5 minutes
fetchEntryFee();
setInterval(fetchEntryFee, 5 * 60 * 1000);

// Client-side RPC endpoints — last-resort fallback only.
// All balance/account queries now go through /api/balance (server-side) to
// avoid browser CORS rate-limit 403s on these public endpoints.
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://mainnet.helius-rpc.com/',
];

const RPC_TIMEOUT_MS = 10000;

const TOKEN_PROGRAM_ID_STR       = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_STR = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ─── Wallet Definitions ──────────────────────────────────────────────────────
const WALLET_DEFS = [
  {
    name:     'Phantom',
    icon:     'https://phantom.app/img/phantom-logo.svg',
    detect:   () => window.phantom?.solana?.isPhantom ? window.phantom.solana
                  : window.solana?.isPhantom           ? window.solana
                  : null,
    install:  'https://phantom.app/',
    deeplink: () => `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
  },
  {
    name:     'Coinbase Wallet',
    icon:     'https://images.ctfassets.net/q5ulk4bp65r7/3TBS4oVkD1ghowTqylkAtz/ceeb33e43f8e3e3b4e2baf4c2d46d2e7/product-identity-cb-wallet-logo.svg',
    detect:   () => {
      if (window.coinbaseSolana)                       return window.coinbaseSolana;
      if (window.coinbaseWalletExtension?.solana)      return window.coinbaseWalletExtension.solana;
      if (window.solana?.isCoinbaseWallet)             return window.solana;
      return null;
    },
    install:  'https://www.coinbase.com/wallet',
    deeplink: () => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}`,
  },
  {
    name:     'Solflare',
    icon:     'https://solflare.com/assets/logo.svg',
    detect:   () => window.solflare?.isSolflare ? window.solflare : null,
    install:  'https://solflare.com/',
    deeplink: () => `https://solflare.com/ul/v1/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
  },
  {
    name:     'Backpack',
    icon:     'https://avatars.githubusercontent.com/u/97015936?s=48',
    detect:   () => window.backpack?.isBackpack ? window.backpack
                  : window.xnft?.solana         ? window.xnft.solana
                  : null,
    install:  'https://backpack.app/',
    deeplink: null,
  },
  {
    name:     'Glow',
    icon:     '',
    detect:   () => window.glowSolana?.isGlow ? window.glowSolana
                  : window.glow?.isGlow        ? window.glow
                  : null,
    install:  'https://glow.app/',
    deeplink: null,
  },
  {
    name:     'Coin98',
    icon:     '',
    detect:   () => window.coin98?.sol ?? null,
    install:  'https://coin98.com/wallet',
    deeplink: null,
  },
  {
    name:     'Trust Wallet',
    icon:     '',
    detect:   () => window.trustwallet?.solana ?? null,
    install:  'https://trustwallet.com/',
    deeplink: null,
  },
  {
    name:     'Math Wallet',
    icon:     '',
    detect:   () => window.solana?.isMathWallet ? window.solana : null,
    install:  'https://mathwallet.org/',
    deeplink: null,
  },
];

// ─── State ──────────────────────────────────────────────────────────
window.WalletState = {
  connected:    false,
  address:      null,
  monetBalance: 0,
  tokens:       [],
  solBalance:   0,
  walletName:   null,
  _provider:    null,
};

// ─── Provider Access ───────────────────────────────────────────────
function getProvider() {
  if (WalletState._provider) return WalletState._provider;
  for (const def of WALLET_DEFS) {
    const p = def.detect();
    if (p) return p;
  }
  return null;
}

function getAvailableWallets() {
  return WALLET_DEFS
    .map(def => ({ ...def, provider: def.detect() }))
    .filter(w => w.provider !== null);
}

// ─── Helpers ────────────────────────────────────────────────��─────
function getSolanaWeb3() {
  if (!window.solanaWeb3) throw new Error('solanaWeb3 not loaded');
  return window.solanaWeb3;
}

function _makeConnection(rpc) {
  const w = getSolanaWeb3();
  return new w.Connection(rpc, 'confirmed');
}

async function withRpcFallback(fn) {
  let lastErr;
  for (const rpc of RPC_ENDPOINTS) {
    const conn = _makeConnection(rpc);
    try {
      const result = await Promise.race([
        fn(conn),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`RPC timeout: ${rpc}`)), RPC_TIMEOUT_MS)
        ),
      ]);
      return result;
    } catch (e) {
      console.warn(`[MONET] RPC failed (${rpc}):`, e.message ?? e);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All RPC endpoints failed');
}

async function getWorkingConnection() {
  let lastErr;
  for (const rpc of RPC_ENDPOINTS) {
    const conn = _makeConnection(rpc);
    try {
      await Promise.race([
        conn.getSlot(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout`)), RPC_TIMEOUT_MS)
        ),
      ]);
      return conn;
    } catch (e) {
      console.warn(`[MONET] Connection probe failed (${rpc}):`, e.message ?? e);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No working RPC found');
}

function toRawAmount(uiAmount) {
  return Math.round(uiAmount * Math.pow(10, MONET_CONFIG.DECIMALS));
}

function getATA(mintPubkey, ownerPubkey) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const ASSOC_PROGRAM_ID = new w.PublicKey(ASSOCIATED_TOKEN_PROGRAM_STR);
  return w.PublicKey.findProgramAddressSync(
    [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
    ASSOC_PROGRAM_ID
  )[0];
}

function createATAInstruction(payerPubkey, ataPubkey, ownerPubkey, mintPubkey) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const ASSOC_PROGRAM_ID = new w.PublicKey(ASSOCIATED_TOKEN_PROGRAM_STR);
  return new w.TransactionInstruction({
    keys: [
      { pubkey: payerPubkey, isSigner: true,  isWritable: true  },
      { pubkey: ataPubkey,   isSigner: false, isWritable: true  },
      { pubkey: ownerPubkey, isSigner: false, isWritable: false },
      { pubkey: mintPubkey,  isSigner: false, isWritable: false },
      { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
    ],
    programId: ASSOC_PROGRAM_ID,
    data: new Uint8Array([0]),
  });
}

function createTransferInstruction(sourcePubkey, destPubkey, ownerPubkey, rawAmount) {
  const w = getSolanaWeb3();
  const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, BigInt(rawAmount), true);
  return new w.TransactionInstruction({
    keys: [
      { pubkey: sourcePubkey, isSigner: false, isWritable: true  },
      { pubkey: destPubkey,   isSigner: false, isWritable: true  },
      { pubkey: ownerPubkey,  isSigner: true,  isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function createMemoInstruction(signerPubkey, text) {
  const w = getSolanaWeb3();
  const encoder = new TextEncoder();
  return new w.TransactionInstruction({
    keys:      [{ pubkey: signerPubkey, isSigner: true, isWritable: false }],
    programId: new w.PublicKey(MEMO_PROGRAM_ID),
    data:      encoder.encode(text),
  });
}

// ─── Wallet Picker Modal ──────────────────────────────────────────────────────
function _injectModalStyles() {
  if (document.getElementById('wm-styles')) return;
  const s = document.createElement('style');
  s.id = 'wm-styles';
  s.textContent = `
    #wm-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999;
      display:flex; align-items:center; justify-content:center;
      font-family:'Orbitron',sans-serif;
    }
    #wm-box {
      background:#0b0f1a; border:1px solid #a855ff;
      border-radius:16px; padding:24px 20px 20px;
      width:min(340px, 94vw); box-shadow:0 0 40px #a855ff44;
      color:#fff; text-align:center;
    }
    #wm-title { font-size:14px; font-weight:800; color:#a855ff; margin-bottom:6px; }
    #wm-sub   { font-size:11px; color:#888; margin-bottom:16px; }
    .wm-btn {
      display:flex; align-items:center; gap:12px;
      width:100%; padding:11px 14px; margin-bottom:9px;
      border-radius:10px; border:1px solid #333;
      background:#111827; color:#fff; cursor:pointer;
      font-family:'Orbitron',sans-serif; font-size:12px; font-weight:600;
      transition:border-color .15s, box-shadow .15s;
    }
    .wm-btn:hover { border-color:#a855ff; box-shadow:0 0 12px #a855ff44; }
    .wm-btn img  { width:24px; height:24px; border-radius:6px; object-fit:contain; background:#fff; }
    .wm-btn .wm-icon-fallback { width:24px; height:24px; border-radius:6px; background:#222; display:flex; align-items:center; justify-content:center; font-size:16px; }
    .wm-btn .wm-badge { margin-left:auto; font-size:9px; color:#00ff9d; border:1px solid #00ff9d44; padding:2px 7px; border-radius:20px; }
    .wm-btn .wm-badge-install { color:#888; border-color:#33333380; }
    #wm-cancel { color:#555; font-size:11px; cursor:pointer; margin-top:6px; background:none; border:none; font-family:inherit; }
    #wm-cancel:hover { color:#ff4488; }
    #wm-deeplink-notice { font-size:10px; color:#555; margin-top:12px; line-height:1.5; }
  `;
  document.head.appendChild(s);
}

function showWalletPicker() {
  return new Promise((resolve, reject) => {
    _injectModalStyles();
    const overlay = document.createElement('div');
    overlay.id = 'wm-overlay';

    const available = getAvailableWallets();
    const isMobile  = /iPhone|iPad|Android/i.test(navigator.userAgent);

    let buttonsHtml = '';

    if (available.length > 0) {
      available.forEach(w => {
        const iconHtml = w.icon
          ? `<img src="${w.icon}" alt="${w.name}" onerror="this.style.display='none'">`
          : `<span class="wm-icon-fallback">💳</span>`;
        buttonsHtml += `
          <button class="wm-btn" data-wallet="${w.name}">
            ${iconHtml}
            <span>${w.name}</span>
            <span class="wm-badge">Detected</span>
          </button>`;
      });
    }

    if (isMobile) {
      WALLET_DEFS.filter(d => !available.find(a => a.name === d.name) && d.deeplink).forEach(w => {
        buttonsHtml += `
          <button class="wm-btn" data-deeplink="${w.deeplink()}">
            ${w.icon ? `<img src="${w.icon}" alt="${w.name}" onerror="this.style.display='none'">` : `<span class="wm-icon-fallback">📲</span>`}
            <span>${w.name}</span>
            <span class="wm-badge wm-badge-install">Open app</span>
          </button>`;
      });
    }

    if (available.length === 0 && !isMobile) {
      buttonsHtml = `<p style="color:#888;font-size:12px">No Solana wallet detected.<br>Install <a href="https://phantom.app" target="_blank" style="color:#a855ff">Phantom</a></p>`;
    }

    overlay.innerHTML = `
      <div id="wm-box">
        <div id="wm-title">SELECT WALLET</div>
        <div id="wm-sub">Choose your Solana wallet to connect</div>
        ${buttonsHtml}
        <button id="wm-cancel">Cancel</button>
        ${isMobile && available.length === 0 ? '<div id="wm-deeplink-notice">Tap an app above to open it, then return to this page.</div>' : ''}
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelectorAll('.wm-btn[data-wallet]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.wallet;
        const def  = WALLET_DEFS.find(d => d.name === name);
        overlay.remove();
        resolve({ provider: def.detect(), name });
      });
    });

    overlay.querySelectorAll('.wm-btn[data-deeplink]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.remove();
        window.location.href = btn.dataset.deeplink;
        reject(new Error('Redirecting to wallet app…'));
      });
    });

    document.getElementById('wm-cancel').addEventListener('click', () => {
      overlay.remove();
      reject(new Error('Wallet selection cancelled'));
    });
  });
}

// ─── Connect Wallet ───────────────────────────────────────────────────────
async function connectWallet() {
  const available = getAvailableWallets();

  let chosen;
  if (available.length === 1) {
    chosen = { provider: available[0].provider, name: available[0].name };
  } else {
    chosen = await showWalletPicker();
  }

  const provider = chosen.provider;
  const resp = await provider.connect();
  const address = (resp.publicKey || provider.publicKey).toString();

  WalletState._provider    = provider;
  WalletState.walletName   = chosen.name;
  WalletState.connected    = true;
  WalletState.address      = address;
  localStorage.setItem('wallet_address', address);
  localStorage.setItem('wallet_name', chosen.name);

  document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address, walletName: chosen.name } }));
  await refreshBalances();
  if (WalletState.monetBalance === 0) {
    setTimeout(async () => { await refreshBalances(); }, 4000);
  }
  ensureMonetAccount();
  return address;
}

async function disconnectWallet() {
  const p = getProvider();
  if (p && p.disconnect) await p.disconnect().catch(() => {});
  WalletState.connected    = false;
  WalletState.address      = null;
  WalletState.monetBalance = 0;
  WalletState.tokens       = [];
  WalletState._provider    = null;
  WalletState.walletName   = null;
  localStorage.removeItem('wallet_address');
  localStorage.removeItem('wallet_name');
  document.dispatchEvent(new CustomEvent('walletDisconnected'));
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────
async function tryAutoConnect() {
  const savedName    = localStorage.getItem('wallet_name');
  const savedAddress = localStorage.getItem('wallet_address');
  if (!savedAddress) return;

  const def = WALLET_DEFS.find(d => d.name === savedName);
  const provider = def ? def.detect() : getAvailableWallets()[0]?.provider;
  if (!provider) return;

  try {
    const resp = await provider.connect({ onlyIfTrusted: true });
    const address = (resp.publicKey || provider.publicKey).toString();
    WalletState._provider    = provider;
    WalletState.walletName   = savedName || def?.name;
    WalletState.connected    = true;
    WalletState.address      = address;
    localStorage.setItem('wallet_address', address);
    document.dispatchEvent(new CustomEvent('walletConnected', { detail: { address } }));
    await refreshBalances();
    if (WalletState.monetBalance === 0) {
      setTimeout(async () => { await refreshBalances(); }, 4000);
    }
    ensureMonetAccount();
  } catch(e) { /* not previously trusted */ }
}

// ─── Balances ─────────────────────────────────────────────────────────
async function refreshBalances() {
  if (!WalletState.address) return;
  let updated = false;
  try {
    const res  = await fetch(`https://api.betterhavemymonet.com/api/balance/${WalletState.address}`);
    if (res.ok) {
      const data = await res.json();
      WalletState.monetBalance = data.monet ?? WalletState.monetBalance;
      WalletState.solBalance   = data.sol   ?? WalletState.solBalance;
      WalletState.hasMonetAta  = data.hasAta ?? WalletState.hasMonetAta;
      updated = true;

      if (!data.hasAta && WalletState.address) {
        fetch('https://api.betterhavemymonet.com/api/create-token-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: WalletState.address }),
        })
          .then(r => r.json())
          .then(d => {
            if (d.created) {
              console.log('[MONET] Token account created for', WalletState.address?.slice(0, 8));
              WalletState.hasMonetAta = true;
              setTimeout(refreshBalances, 3000);
            }
          })
          .catch(() => {});
      }
    }
  } catch(_) {}

  if (!updated) {
    await Promise.allSettled([
      getMonetBalanceDirect().then(b => { if (b > 0) WalletState.monetBalance = b; }).catch(() => {}),
      getSolBalanceDirect().then(b   => { if (b >= 0) WalletState.solBalance = b; }).catch(() => {}),
    ]);
  }
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));
}

async function getMonetBalance() {
  if (!WalletState.address) return 0;
  try {
    const res = await fetch(`https://api.betterhavemymonet.com/api/balance/${WalletState.address}`);
    if (res.ok) { const d = await res.json(); return d.monet ?? 0; }
  } catch(_) {}
  return getMonetBalanceDirect();
}

async function getSolBalance() {
  if (!WalletState.address) return 0;
  try {
    const res = await fetch(`https://api.betterhavemymonet.com/api/balance/${WalletState.address}`);
    if (res.ok) { const d = await res.json(); return d.sol ?? 0; }
  } catch(_) {}
  return getSolBalanceDirect();
}

async function getMonetBalanceDirect() {
  try {
    const w     = getSolanaWeb3();
    const mint  = new w.PublicKey(MONET_CONFIG.MINT);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await withRpcFallback(conn =>
      conn.getParsedTokenAccountsByOwner(owner, { mint })
    );
    if (!accounts || accounts.value.length === 0) return 0;
    return accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
  } catch(e) {
    console.warn('[MONET] getMonetBalanceDirect failed:', e.message);
    return 0;
  }
}

async function getSolBalanceDirect() {
  try {
    const w = getSolanaWeb3();
    const owner = new w.PublicKey(WalletState.address);
    const lamports = await withRpcFallback(conn => conn.getBalance(owner));
    return (lamports ?? 0) / 1e9;
  } catch(e) {
    console.warn('[MONET] getSolBalanceDirect failed:', e.message);
    return 0;
  }
}

async function ensureMonetAccount() {
  if (!WalletState.address) return;
  if (WalletState.hasMonetAta) return;
  try {
    const res  = await fetch('https://api.betterhavemymonet.com/api/create-token-account', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ wallet: WalletState.address }),
    });
    const data = await res.json();
    if (data.created) {
      console.log('[MONET] Token account created for player:', data.ata);
      WalletState.hasMonetAta = true;
      setTimeout(refreshBalances, 2000);
    } else if (data.ok) {
      WalletState.hasMonetAta = true;
    }
  } catch(e) {
    console.warn('[MONET] ensureMonetAccount failed:', e.message);
  }
}

async function getAllTokens() {
  if (!WalletState.address) return [];
  try {
    const w = getSolanaWeb3();
    const TOKEN_PROGRAM_ID = new w.PublicKey(TOKEN_PROGRAM_ID_STR);
    const owner = new w.PublicKey(WalletState.address);
    const accounts = await withRpcFallback(conn =>
      conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    );
    if (!accounts) return [];
    return accounts.value
      .map(a => {
        const info = a.account.data.parsed.info;
        return {
          mint:     info.mint,
          balance:  info.tokenAmount.uiAmount || 0,
          decimals: info.tokenAmount.decimals,
          isMonet:  info.mint === MONET_CONFIG.MINT,
          address:  a.pubkey.toString(),
        };
      })
      .filter(t => t.balance > 0)
      .sort((a, b) => b.isMonet - a.isMonet);
  } catch(e) {
    console.warn('[MONET] getAllTokens failed after all RPCs:', e);
    return [];
  }
}

// ─── Pay Entry Fee ────────────────────────────────────────────────────────
// FIXED: Properly check simulation errors before signing
async function payEntryFee(gameName, onProgress, amount) {
  const fee = (amount && Number(amount) > 0) ? Number(amount) : MONET_CONFIG.ENTRY_FEE;
  const report = (step) => { try { onProgress && onProgress(step); } catch(_) {} };

  report('checking');
  if (!WalletState.connected || !WalletState.address) throw new Error('Connect wallet first');

  await refreshBalances().catch(() => {});
  console.log("[PLAY CHECK]",{balance:WalletState.monetBalance,fee,address:WalletState.address});
  if (WalletState.monetBalance < fee) {
    throw new Error(`Insufficient MONET. Need ${fee}, have ${WalletState.monetBalance.toFixed(2)}`);
  }

  const provider = getProvider();
  if (!provider)  throw new Error('No wallet provider found');

  const w        = getSolanaWeb3();
  const payer    = new w.PublicKey(WalletState.address);
  const mint     = new w.PublicKey(MONET_CONFIG.MINT);
  const treasury = new w.PublicKey(MONET_CONFIG.TREASURY);
  const sourceATA = getATA(mint, payer);
  const destATA   = getATA(mint, treasury);

  // Step 1: get blockhash
  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    try {
      const r = await fetch('https://api.betterhavemymonet.com/api/blockhash');
      if (!r.ok) throw new Error(`/api/blockhash ${r.status}`);
      ({ blockhash } = await r.json());
    } catch(e) {
      throw new Error(`Could not fetch blockhash: ${e.message}`);
    }
  }

  // Step 2: check treasury ATA, build transaction
  let tx;
  try {
    tx = new w.Transaction();
    tx.feePayer = payer;
    tx.recentBlockhash = blockhash;

    let destATAExists = false;
    try {
      const r = await fetch(`https://api.betterhavemymonet.com/api/account-exists/${destATA.toString()}`);
      if (r.ok) { const d = await r.json(); destATAExists = d.exists; }
    } catch(_) {
      const conn = await getWorkingConnection().catch(() => null);
      if (conn) {
        const info = await conn.getAccountInfo(destATA).catch(() => null);
        destATAExists = !!info;
      }
    }
    if (!destATAExists) tx.add(createATAInstruction(payer, destATA, treasury, mint));
  } catch(e) {
    throw new Error(`Transaction preparation failed: ${e.message}`);
  }

  tx.add(createTransferInstruction(sourceATA, destATA, payer, toRawAmount(fee)));
  const gameLabel = (gameName || 'GAME').toUpperCase();
  tx.add(createMemoInstruction(payer, `Monet Arcade | ${gameLabel} | ${fee} MONET entry fee`));

  // ── FIXED: Step 3: SIMULATE TRANSACTION & CHECK FOR ERRORS ────────────────
  report('checking');
  try {
    const conn = await getWorkingConnection();
    const sim = await conn.simulateTransaction(tx);
    
    // ✅ CHECK FOR SIMULATION ERRORS BEFORE SIGNING
    if (sim.value?.err) {
      const errMsg = JSON.stringify(sim.value.err);
      const logs = (sim.value?.logs || []).join('\n');
      console.error('[MONET] Simulation error:', errMsg);
      console.error('[MONET] Simulation logs:', logs);
      throw new Error(`Transaction would fail on-chain: ${errMsg}\n\nRPC Logs:\n${logs}`);
    }
    
    console.log('[MONET] ✓ Transaction simulation successful');
    if (sim.value?.logs) console.log('[MONET] Simulation logs:', sim.value.logs);
  } catch(e) {
    console.error('[MONET] Simulation failed:', e.message);
    throw new Error(`Simulation check failed: ${e.message}`);
  }

  // ── Step 4: Sign & send via wallet ────────────────���─────────────────────
  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      const conn = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) {
    throw new Error(`Signing failed: ${e.message}`);
  }

  // ── Step 5: Confirm ────────────────────────────────────────────────────
  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {
    console.warn('[MONET] confirmTransaction failed (tx may still confirm):', txId);
  }

  WalletState.monetBalance -= fee;
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));

  const session = { game: gameName, txId, paidAt: Date.now(), wallet: WalletState.address, entryFee: fee };
  sessionStorage.setItem('game_session', JSON.stringify(session));
  return txId;
}

window.payEntryFee        = payEntryFee;
window.ensureMonetAccount = ensureMonetAccount;
window.refreshBalances    = refreshBalances;

// ─── Pay Entry Fee (SOL) ──────────────────────────────────────────────────────
// FIXED: Now uses correct treasury address instead of undefined 'challenge.escrow'
MONET_CONFIG.SOL_ENTRY_LAMPORTS = 5_000_000;

async function payEntryFeeSOL(gameName, onProgress, lamports) {
  const lam    = (lamports && lamports > 0) ? lamports : (MONET_CONFIG.SOL_ENTRY_LAMPORTS || 5_000_000);
  const report = (step) => { try { onProgress && onProgress(step); } catch(_) {} };

  report('checking');
  if (!WalletState.connected || !WalletState.address) throw new Error('Connect wallet first');

  await refreshBalances().catch(() => {});
  const solNeeded = lam / 1e9 + 0.001;
  if (WalletState.solBalance < solNeeded) {
    throw new Error(`Insufficient SOL. Need ~${(lam/1e6).toFixed(4)}, have ${WalletState.solBalance.toFixed(4)}`);
  }

  const provider = getProvider();
  if (!provider)  throw new Error('No wallet provider found');

  const w       = getSolanaWeb3();
  const payer   = new w.PublicKey(WalletState.address);
  const treasury = new w.PublicKey(MONET_CONFIG.TREASURY);

  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    try {
      const r = await fetch('https://api.betterhavemymonet.com/api/blockhash');
      if (!r.ok) throw new Error(`/api/blockhash ${r.status}`);
      ({ blockhash } = await r.json());
    } catch(e) { throw new Error(`Could not fetch blockhash: ${e.message}`); }
  }

  const tx = new w.Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  // ✅ FIXED: Use 'treasury' instead of undefined 'challenge.escrow'
  tx.add(w.SystemProgram.transfer({ 
    fromPubkey: payer, 
    toPubkey: treasury,
    lamports: lam 
  }));

  const gameLabel = (gameName || 'GAME').toUpperCase();
  tx.add(createMemoInstruction(payer, `Monet Arcade | ${gameLabel} | SOL entry fee`));

  // ✅ Simulate before signing
  report('checking');
  try {
    const conn = await getWorkingConnection();
    const sim = await conn.simulateTransaction(tx);
    
    if (sim.value?.err) {
      const errMsg = JSON.stringify(sim.value.err);
      const logs = (sim.value?.logs || []).join('\n');
      console.error('[MONET] SOL Simulation error:', errMsg);
      throw new Error(`SOL transaction would fail: ${errMsg}\n\nLogs:\n${logs}`);
    }
    
    console.log('[MONET] ✓ SOL simulation successful');
  } catch(e) {
    console.error('[MONET] SOL simulation failed:', e.message);
    throw new Error(`SOL simulation failed: ${e.message}`);
  }

  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      const conn   = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) { throw new Error(`Signing failed: ${e.message}`); }

  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {
    console.warn('[MONET] SOL confirmTransaction timed out (tx may still confirm):', txId);
  }

  WalletState.solBalance -= lam / 1e9;
  document.dispatchEvent(new CustomEvent('balanceUpdated', { detail: { ...WalletState } }));

  const session = { game: gameName, txId, paidAt: Date.now(), wallet: WalletState.address, paymentType: 'sol', lamports: lam };
  sessionStorage.setItem('game_session', JSON.stringify(session));
  return txId;
}

window.payEntryFeeSOL = payEntryFeeSOL;

async function payShopItem(amountMonet, itemId, onProgress) {
  return payEntryFee(`SHOP_${(itemId || 'ITEM').toUpperCase()}`, onProgress, amountMonet);
}
async function payShopItemSOL(lamports, itemId, onProgress) {
  return payEntryFeeSOL(`SHOP_${(itemId || 'ITEM').toUpperCase()}`, onProgress, lamports);
}
window.payShopItem    = payShopItem;
window.payShopItemSOL = payShopItemSOL;

function recordWin(gameName, score) {
  const session = JSON.parse(sessionStorage.getItem('game_session') || 'null');
  if (!session) return false;
  const payout = (session.entryFee || MONET_CONFIG.ENTRY_FEE) * MONET_CONFIG.PAYOUT_RATE;
  const claim = {
    id:        Date.now().toString(36),
    wallet:    WalletState.address || session.wallet,
    game:      gameName,
    score,
    payout,
    entryTx:   session.txId,
    claimedAt: new Date().toISOString(),
    status:    'pending',
  };
  const claims = JSON.parse(localStorage.getItem('pending_claims') || '[]');
  claims.push(claim);
  localStorage.setItem('pending_claims', JSON.stringify(claims));
  sessionStorage.removeItem('game_session');
  return claim;
}

function hasValidSession(gameName) {
  try {
    const s = JSON.parse(sessionStorage.getItem('game_session') || 'null');
    if (!s) return false;
    if (s.game !== gameName) return false;
    if (Date.now() - s.paidAt > 30 * 60 * 1000) return false;
    return true;
  } catch { return false; }
}

function renderWalletBar(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  function render() {
    if (WalletState.connected) {
      const short = WalletState.address.slice(0,4) + '...' + WalletState.address.slice(-4);
      const wname = WalletState.walletName ? `<span style="color:#888;font-size:10px;margin-right:6px">${WalletState.walletName}</span>` : '';
      el.innerHTML = `
        ${wname}
        <span style="color:#00ff9d;font-size:12px">&#9679; ${short}</span>
        <span style="color:#a855ff;font-size:13px;margin:0 10px"><b>${WalletState.monetBalance.toFixed(2)} MONET</b></span>
        <span style="color:#888;font-size:11px">${WalletState.solBalance.toFixed(3)} SOL</span>
      `;
    } else {
      el.innerHTML = `<button onclick="connectWallet().then(()=>renderWalletBar('${containerId}')).catch(e=>alert(e.message))" style="padding:6px 16px">Connect Wallet</button>`;
    }
  }
  render();
  document.addEventListener('walletConnected',   render);
  document.addEventListener('walletDisconnected', render);
  document.addEventListener('balanceUpdated',     render);
}

async function treasuryPayout(toAddress, amount, claimId, onProgress) {
  const report = (s) => { try { onProgress && onProgress(s); } catch(_) {} };

  if (!WalletState.connected) throw new Error('Connect treasury wallet first');
  if (WalletState.address !== MONET_CONFIG.TREASURY)
    throw new Error('Connected wallet is not the treasury');

  const provider = getProvider();
  const w        = getSolanaWeb3();
  const payer    = new w.PublicKey(WalletState.address);
  const mint     = new w.PublicKey(MONET_CONFIG.MINT);
  const winner   = new w.PublicKey(toAddress);
  const srcATA   = getATA(mint, payer);
  const dstATA   = getATA(mint, winner);

  report('building');

  let blockhash;
  try {
    const conn = await getWorkingConnection();
    ({ blockhash } = await conn.getLatestBlockhash());
  } catch(_) {
    const r = await fetch('https://api.betterhavemymonet.com/api/blockhash');
    if (!r.ok) throw new Error('Could not fetch blockhash');
    ({ blockhash } = await r.json());
  }

  const tx = new w.Transaction();
  tx.feePayer        = payer;
  tx.recentBlockhash = blockhash;

  try {
    const r = await fetch(`https://api.betterhavemymonet.com/api/account-exists/${dstATA.toString()}`);
    if (r.ok) {
      const d = await r.json();
      if (!d.exists) tx.add(createATAInstruction(payer, dstATA, winner, mint));
    }
  } catch(_) {}

  tx.add(createTransferInstruction(srcATA, dstATA, payer, toRawAmount(amount)));
  tx.add(createMemoInstruction(payer, `Monet Arcade | Payout | ${amount} MONET${claimId ? ' | ' + claimId.slice(0,8) : ''}`));

  report('signing');
  let txId;
  try {
    if (provider.signAndSendTransaction) {
      const result = await provider.signAndSendTransaction(tx);
      txId = result.signature || result;
    } else {
      const conn   = await getWorkingConnection();
      const signed = await provider.signTransaction(tx);
      txId = await conn.sendRawTransaction(signed.serialize());
    }
  } catch(e) {
    throw new Error('Signing failed: ' + e.message);
  }

  report('confirming');
  try {
    const conn = await getWorkingConnection();
    await conn.confirmTransaction(txId, 'confirmed');
  } catch(_) {}

  if (claimId) {
    try {
      await fetch('https://api.betterhavemymonet.com/api/payout/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ claimId, txId }),
      });
    } catch(_) {}
  }

  await refreshBalances().catch(() => {});
  return txId;
}

function isTreasuryWallet() {
  return WalletState.connected && WalletState.address === MONET_CONFIG.TREASURY;
}

window.treasuryPayout   = treasuryPayout;
window.isTreasuryWallet = isTreasuryWallet;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryAutoConnect);
} else {
  tryAutoConnect();
}

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const API_BASE = 'https://api.betterhavemymonet.com';
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}
