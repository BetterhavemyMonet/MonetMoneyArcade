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
    const conn = new Connection("https://api.mainnet-beta.solana.com","confirmed");
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
  res.json({ ok: true, url });
});

// ─── Routes: MONET price / dynamic entry fee ──────────────────────────────
app.get('/api/monet-price', async (_req, res) => {
  const solPriceUsd = await getSolPrice().catch(() => null);
  const solEntryLamports = solPriceUsd ? Math.max(100_000, Math.round((0.99 / solPriceUsd) * 1e9)) : SOL_ENTRY_LAMPORTS;
  res.json({
    ok: true,
    priceUsd: 0.0099,
    entryFeeMonet: 10,
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
    c.winner = (c.player1.score >= c.player2.score) ? c.player1.wallet : c.player2.wallet;
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

// ─── Routes: CPU challenges ───────────────────────────────────────────────────
app.post('/api/cpu/start', async (req, res) => {
  const { wallet, txId, game, paymentType } = req.body;
  if (!wallet || !txId || !game) return res.status(400).json({ error: 'wallet, txId, game required' });

  // Verify payment — MONET or SOL
  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId); }
    else { await verifyEntryFee(txId, await getDynamicEntryFee()); }
  } catch(e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  // Reject duplicate txIds (replay prevention)
  const allCpuGames = dbRead('cpu_games');
  if (allCpuGames.some(g => g.txId === txId)) {
    return res.status(400).json({ error: 'Transaction ID already used' });
  }

  // CPU is always expert
  const diff   = 'expert';
  const range  = CPU_RANGES[diff]?.[game] || [2000, 4000];
  const cpuScore = Math.floor(range[0] + Math.random() * (range[1] - range[0]));

  // Issue a one-time scoreSecret — client must echo it back on submit so we
  // know the submission came from the session that paid, not a forged request.
  const scoreSecret = genScoreSecret();
  const id = genId();
  const now = Date.now();
  allCpuGames.push({
    id, wallet, txId, game, difficulty: diff, cpuScore,
    scoreSecret, playerScore: null, won: null, payoutTxId: null,
    status: 'active', createdAt: now,
  });
  dbWrite('cpu_games', allCpuGames);
  res.json({ ok: true, cpuGameId: id, cpuScore, difficulty: diff, scoreSecret });
});

app.post('/api/cpu/submit', async (req, res) => {
  const { cpuGameId, wallet, playerScore, scoreSecret } = req.body;
  if (!cpuGameId || !wallet || playerScore == null) return res.status(400).json({ error: 'cpuGameId, wallet, playerScore required' });

  // Rate limit
  if (!checkRateLimit(wallet)) return res.status(429).json({ error: 'Too many score submissions — slow down' });

  const cpuGames = dbRead('cpu_games');
  const idx = cpuGames.findIndex(g => g.id === cpuGameId && g.wallet === wallet);
  if (idx === -1) return res.status(404).json({ error: 'CPU game not found' });

  const g = cpuGames[idx];
  const dynFee = await getDynamicEntryFee();
  const CPU_PAYOUT = Math.min(dynFee * 2 * (1 - HOUSE_RAKE), CPU_PAYOUT_MAX * (dynFee / ENTRY_FEE));
  if (g.status === 'complete') return res.json({ ok: true, won: g.won, cpuScore: g.cpuScore, playerScore: g.playerScore, payout: g.won ? CPU_PAYOUT : 0, payoutTxId: g.payoutTxId });

  // Verify scoreSecret token — ensures submission came from the paid session
  if (g.scoreSecret && scoreSecret !== g.scoreSecret) {
    flagSuspicious({ reason: 'bad_score_secret', wallet, game: g.game, score: playerScore, cpuGameId });
    return res.status(403).json({ error: 'Invalid score token — session mismatch' });
  }

  // Score sanity checks
  const sanity = checkScoreSanity(g.game, playerScore, g.createdAt);
  if (!sanity.ok) {
    flagSuspicious({ reason: 'score_sanity_fail', detail: sanity.reason, wallet, game: g.game, score: playerScore, cpuGameId });
    return res.status(400).json({ error: `Score rejected: ${sanity.reason}` });
  }

  // Soft cap — flag but allow
  const softCap = SCORE_SOFT_CAP[g.game] ?? SCORE_DEFAULT_SOFT_CAP;
  if (playerScore > softCap) {
    flagSuspicious({ reason: 'above_soft_cap', wallet, game: g.game, score: playerScore, softCap, cpuGameId });
  }

  g.playerScore = playerScore;
  g.won         = playerScore > g.cpuScore;
  g.status      = 'complete';
  const payout  = CPU_PAYOUT;

  if (g.won) {
    try {
      g.payoutTxId = await sendPayout(wallet, payout);
      console.log(`[CPU] ${wallet.slice(0,8)}… beat CPU (${playerScore} vs ${g.cpuScore}) — paid ${payout} MONET`);
    } catch(e) {
      console.error(`[CPU] payout failed:`, e.message);
      const claims = dbRead('claims');
      claims.push({ id: genId(), type: 'cpu', refId: g.id, wallet, amount: payout, status: 'pending', error: e.message, createdAt: Date.now() });
      dbWrite('claims', claims);
    }
  }

  dbWrite('cpu_games', cpuGames);
  res.json({ ok: true, won: g.won, cpuScore: g.cpuScore, playerScore, payout: g.won ? payout : 0 });
});

// ─── Auto-retry pending payouts ───────────────────────────────────────────────
// Runs every 90 seconds. Any claim still in 'pending' state (failed on first
// attempt) is retried automatically as long as TREASURY_PRIVATE_KEY is set.
async function retryPendingClaims() {
  if (!getTreasuryKP()) return; // no key — nothing to do
  const claims = dbRead('claims');
  const pending = claims.filter(c => c.status === 'pending');
  if (!pending.length) return;
  console.log(`[PAYOUT-RETRY] ${pending.length} pending claim(s) — retrying…`);
  let changed = false;
  for (const claim of pending) {
    try {
      // If sendPayout already got a sig (tx sent but confirm timed out), just
      // re-confirm instead of sending a second transaction (avoids double-pay).
      if (claim.payoutTxId) {
        await withRpc(conn => conn.confirmTransaction(claim.payoutTxId, 'confirmed'), 60_000);
        console.log(`[PAYOUT-RETRY] ✓ confirmed existing tx ${claim.payoutTxId.slice(0,12)}… for ${claim.wallet.slice(0,8)}…`);
      } else {
        claim.payoutTxId = await sendPayout(claim.wallet, claim.amount);
        console.log(`[PAYOUT-RETRY] ✓ ${claim.type} ${claim.id.slice(0,8)} → ${claim.wallet.slice(0,8)}… ${claim.amount} MONET`);
      }
      claim.status      = 'paid';
      claim.processedAt = Date.now();
      delete claim.error;
      changed = true;
    } catch(e) {
      claim.error       = e.message;
      claim.lastRetryAt = Date.now();
      console.warn(`[PAYOUT-RETRY] ✗ ${claim.id.slice(0,8)} failed again: ${e.message}`);
    }
  }
  if (changed) dbWrite('claims', claims);
}
setInterval(retryPendingClaims, 90_000);
// Also run once 15 s after boot so fresh deploys pick up any queued claims fast
setTimeout(retryPendingClaims, 15_000);

// ─── Auto-refund expired open challenges ──────────────────────────────────────
// Runs every 5 minutes. Any challenge that is still 'open' but past its
// expiresAt gets marked 'expired' and a full entry-fee refund is queued for P1.
function refundExpiredChallenges() {
  const challenges = dbRead('challenges');
  const claims     = dbRead('claims');
  const now        = Date.now();
  let changed = false;

  for (const c of challenges) {
    if (c.status !== 'open' || now <= c.expiresAt) continue;
    c.status = 'expired';
    changed  = true;

    // Only queue a refund if one hasn't been created yet for this challenge
    const alreadyQueued = claims.some(cl => cl.refId === c.id && cl.type === 'challenge_expired_refund');
    if (!alreadyQueued && c.player1?.wallet && c.player1.txId !== 'practice-mode') {
      const amount = c.entryFee || ENTRY_FEE;
      claims.push({
        id:        'refund_' + c.code,
        type:      'challenge_expired_refund',
        refId:     c.id,
        wallet:    c.player1.wallet,
        amount,
        status:    'pending',
        error:     `Challenge ${c.code} expired with no opponent — full entry-fee refund`,
        createdAt: now,
      });
      console.log(`[REFUND] Queued ${amount} MONET refund for ${c.player1.wallet.slice(0,8)}… (challenge ${c.code} expired)`);
    }
  }

  if (changed) {
    dbWrite('challenges', challenges);
    dbWrite('claims', claims);
  }
}
setInterval(refundExpiredChallenges, 5 * 60_000);
setTimeout(refundExpiredChallenges, 5_000);

// ─── Admin: server-side process all pending claims ────────────────────────────
// Protected by ADMIN_TOKEN env var. Attempts sendPayout for every pending claim.
// Returns per-claim results so the UI can show pass/fail without wallet signing.
app.post('/api/admin/process-claims', async (req, res) => {
  const token = (req.headers['x-admin-token'] || '').trim();
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }

  const claims = dbRead('claims');
  const pending = claims.filter(c => c.status === 'pending');
  if (!pending.length) return res.json({ ok: true, processed: 0, results: [] });

  const results = [];
  for (const claim of pending) {
    try {
      claim.payoutTxId   = await sendPayout(claim.wallet, claim.amount);
      claim.status       = 'paid';
      claim.processedAt  = Date.now();
      delete claim.error;
      results.push({ id: claim.id, wallet: claim.wallet, amount: claim.amount, ok: true, txId: claim.payoutTxId });
      console.log(`[ADMIN] ✓ paid ${claim.wallet.slice(0,8)}… ${claim.amount} MONET`);
    } catch(e) {
      claim.error       = e.message;
      claim.lastRetryAt = Date.now();
      results.push({ id: claim.id, wallet: claim.wallet, amount: claim.amount, ok: false, error: e.message });
      console.warn(`[ADMIN] ✗ ${claim.id} failed: ${e.message}`);
    }
  }
  dbWrite('claims', claims);
  res.json({ ok: true, processed: pending.length, results });
});

// ─── Buy MONET with card ──────────────────────────────────────────────────────
const BUY_PACKAGES_USD = [10, 20, 50, 100];
const BUY_SESSION_TTL  = 2 * 60 * 60 * 1000; // 2 hours

function getBuySessions() {
  const f = path.join(DATA_DIR, 'buy-sessions.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveBuySessions(data) {
  fs.writeFileSync(path.join(DATA_DIR, 'buy-sessions.json'), JSON.stringify(data, null, 2));
}

// Embedded Checkout Session (primary flow)
app.post('/api/buy-monet/create-checkout-session', async (req, res) => {
  try {
    const { usdAmount, walletAddress } = req.body;
    const usd = Number(usdAmount);
    if (!BUY_PACKAGES_USD.includes(usd))
      return res.status(400).json({ error: 'Invalid amount. Choose 10, 20, 50, or 100.' });
    if (!walletAddress)
      return res.status(400).json({ error: 'walletAddress required' });

    const stripe = await _getStripeClient();

    // Fetch price — retry once if cold cache returns null
    let priceUsd = await getMonetPrice();
    if (!priceUsd) {
      await new Promise(r => setTimeout(r, 2500));
      priceUsd = await fetchMonetPrice();
    }
    if (!priceUsd) return res.status(503).json({ error: 'MONET price unavailable — please try again in a moment' });

    const monetAmount = Math.floor(usd / priceUsd);
    if (monetAmount <= 0) return res.status(503).json({ error: 'Could not calculate MONET amount — please try again' });

    const sessionToken = crypto.randomUUID();

    // Store buy session first so return_url can reference it
    const sessions = getBuySessions().filter(s => Date.now() < s.expiresAt);
    const buyEntry = {
      token: sessionToken, walletAddress,
      usdAmount: usd, monetAmount,
      createdAt: Date.now(), expiresAt: Date.now() + BUY_SESSION_TTL,
      confirmed: false, paid: false,
    };
    sessions.push(buyEntry);
    saveBuySessions(sessions);

    const origin = `${req.protocol}://${req.headers.host}`;
    const checkoutSession = await stripe.checkout.sessions.create({
      ui_mode:              'embedded',
      mode:                 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  usd * 100,
          product_data: {
            name:        `${monetAmount.toLocaleString()} MONET Tokens`,
            description: `$${usd} USD at live market rate — sent to your Solana wallet`,
          },
        },
        quantity: 1,
      }],
      return_url: `${origin}/exchange.html?session_id={CHECKOUT_SESSION_ID}&buy_token=${sessionToken}`,
      metadata:   { sessionToken, walletAddress, usdAmount: String(usd), monetAmount: String(monetAmount) },
    });

    buyEntry.stripeSessionId = checkoutSession.id;
    saveBuySessions(sessions);

    console.log(`[BUY] checkout session $${usd} → ${monetAmount} MONET → ${walletAddress.slice(0,8)}…`);
    res.json({ ok: true, clientSecret: checkoutSession.client_secret, sessionToken, monetAmount, priceUsd });
  } catch(e) {
    console.error('[BUY-MONET] create-checkout-session:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Called from return_url after Stripe redirects back
app.get('/api/buy-monet/session-status', async (req, res) => {
  const { session_id, buy_token } = req.query;
  if (!session_id && !buy_token) return res.status(400).json({ error: 'session_id or buy_token required' });
  try {
    const sessions = getBuySessions();
    const s = sessions.find(s =>
      (buy_token  && s.token          === buy_token)  ||
      (session_id && s.stripeSessionId === session_id)
    );
    if (!s) return res.status(404).json({ error: 'Session not found' });
    if (s.paid) return res.json({ ok: true, status: 'paid', monetAmount: s.monetAmount, txId: s.txId || null, queued: s.queued || false });

    const stripe   = await _getStripeClient();
    const csession = await stripe.checkout.sessions.retrieve(s.stripeSessionId || session_id);
    if (csession.payment_status !== 'paid')
      return res.json({ ok: true, status: csession.payment_status, monetAmount: s.monetAmount });

    s.confirmed = true;
    const { monetAmount, walletAddress } = s;
    let txId = null; let queued = false;
    try {
      txId = await sendPayout(walletAddress, monetAmount);
      s.paid = true; s.txId = txId;
      console.log(`[BUY] payout sent ${monetAmount} MONET → ${walletAddress.slice(0,8)}… tx:${txId.slice(0,12)}…`);
    } catch(pe) {
      const claims = dbRead('claims');
      claims.push({ id: crypto.randomUUID(), wallet: walletAddress, amount: monetAmount,
        reason: `card-buy $${s.usdAmount}`, createdAt: new Date().toISOString(), sessionToken: s.token });
      dbWrite('claims', claims);
      s.paid = true; s.queued = true; queued = true;
      console.warn(`[BUY] payout queued ${monetAmount} MONET → ${walletAddress.slice(0,8)}…`);
    }
    saveBuySessions(sessions);
    res.json({ ok: true, status: 'paid', monetAmount, txId, queued });
  } catch(e) {
    console.error('[BUY-MONET] session-status:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Admin: manual correction payout ─────────────────────────────────────────
app.post('/api/admin/manual-payout', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { wallet, amount, reason } = req.body;
  if (!wallet || !amount || Number(amount) <= 0)
    return res.status(400).json({ error: 'wallet and positive amount required' });
  try {
    const monetAmount = Number(amount);
    let txId = null; let queued = false;
    try {
      txId = await sendPayout(wallet, monetAmount);
      console.log(`[ADMIN] manual payout ${monetAmount} MONET → ${wallet.slice(0,8)}… tx:${txId.slice(0,12)}…`);
    } catch(pe) {
      const claims = dbRead('claims');
      claims.push({ id: crypto.randomUUID(), wallet, amount: monetAmount,
        reason: reason || 'admin-manual-correction', createdAt: new Date().toISOString(), status: 'pending' });
      dbWrite('claims', claims);
      queued = true;
      console.warn(`[ADMIN] manual payout queued ${monetAmount} MONET → ${wallet.slice(0,8)}…`);
    }
    res.json({ ok: true, wallet, monetAmount, txId, queued });
  } catch(e) {
    console.error('[ADMIN] manual-payout:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Legacy PaymentIntent flow (kept for backward compat)
app.post('/api/buy-monet/create-intent', async (req, res) => {
  try {
    const { usdAmount, walletAddress } = req.body;
    const usd = Number(usdAmount);
    if (!BUY_PACKAGES_USD.includes(usd))
      return res.status(400).json({ error: 'Invalid amount. Choose 10, 20, 50, or 100.' });
    if (!walletAddress)
      return res.status(400).json({ error: 'walletAddress required' });

    const stripe = await _getStripeClient();
    let priceUsd = await getMonetPrice();
    if (!priceUsd) {
      await new Promise(r => setTimeout(r, 2500));
      priceUsd = await fetchMonetPrice();
    }
    if (!priceUsd) return res.status(503).json({ error: 'MONET price unavailable — please try again' });
    const monetAmount = Math.floor(usd / priceUsd);
    if (monetAmount <= 0) return res.status(503).json({ error: 'Could not calculate MONET amount' });
    const sessionToken = crypto.randomUUID();

    const pi = await stripe.paymentIntents.create({
      amount:   usd * 100,
      currency: 'usd',
      metadata: { sessionToken, walletAddress, usdAmount: String(usd), monetAmount: String(monetAmount), source: 'monet-buy' },
    });

    const sessions = getBuySessions().filter(s => Date.now() < s.expiresAt);
    sessions.push({
      token: sessionToken, walletAddress,
      usdAmount: usd, monetAmount,
      paymentIntentId: pi.id,
      createdAt: Date.now(), expiresAt: Date.now() + BUY_SESSION_TTL,
      confirmed: false, paid: false,
    });
    saveBuySessions(sessions);

    console.log(`[BUY] intent created $${usd} → ${monetAmount} MONET → ${walletAddress.slice(0,8)}…`);
    res.json({ ok: true, clientSecret: pi.client_secret, sessionToken, monetAmount, priceUsd });
  } catch(e) {
    console.error('[BUY-MONET] create-intent:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/buy-monet/confirm', async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.status(400).json({ error: 'sessionToken required' });
  try {
    const sessions = getBuySessions();
    const s = sessions.find(s => s.token === sessionToken);
    if (!s)                      return res.status(404).json({ error: 'Session not found' });
    if (Date.now() > s.expiresAt) return res.status(410).json({ error: 'Session expired' });
    if (s.paid) return res.json({ ok: true, alreadyPaid: true, monetAmount: s.monetAmount, txId: s.txId || null, queued: s.queued || false });

    // Verify with Stripe directly
    const stripe = await _getStripeClient();
    const pi = await stripe.paymentIntents.retrieve(s.paymentIntentId);
    if (pi.status !== 'succeeded')
      return res.status(402).json({ error: `Payment not confirmed (status: ${pi.status})` });

    s.confirmed = true;
    const { monetAmount, walletAddress } = s;

    let txId = null; let queued = false;
    try {
      txId = await sendPayout(walletAddress, monetAmount);
      s.paid = true; s.txId = txId;
      console.log(`[BUY] payout sent ${monetAmount} MONET → ${walletAddress.slice(0,8)}… tx:${txId.slice(0,12)}…`);
    } catch(pe) {
      // Treasury key not set or payout failed — queue the claim
      const claims = dbRead('claims');
      claims.push({ id: crypto.randomUUID(), wallet: walletAddress, amount: monetAmount,
        reason: `card-buy $${s.usdAmount}`, createdAt: new Date().toISOString(), sessionToken });
      dbWrite('claims', claims);
      s.paid = true; s.queued = true; queued = true;
      console.warn(`[BUY] payout queued (${pe.message}) ${monetAmount} MONET → ${walletAddress.slice(0,8)}…`);
    }
    saveBuySessions(sessions);
    res.json({ ok: true, monetAmount, txId, queued });
  } catch(e) {
    console.error('[BUY-MONET] confirm:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── SOL entry fee info ───────────────────────────────────────────────────────
app.get('/api/sol-entry-fee', async (_req, res) => {
  const lam = await getDynamicSolLamports();
  res.json({ ok: true, lamports: lam, sol: lam / 1e9, approxUsd: TARGET_USD });
});

// ─── Monet Maker Shop ─────────────────────────────────────────────────────────
const SHOP_ITEMS = [
  { id: 'spike_wall',   name: 'Spike Wall',    desc: 'Razor-sharp red barrier — extra-tall & narrow',       monetPrice: 1, lamports:  300_000, row: 3, icon: '🔺', solLabel: '~$0.05' },
  { id: 'mega_bird',    name: 'Mega Bird',     desc: 'Giant gold bird that dominates the airspace',          monetPrice: 1, lamports:  300_000, row: 4, icon: '🦅', solLabel: '~$0.05' },
  { id: 'speed_burst',  name: 'Speed Burst',   desc: 'Cyan zone that triples runner speed for 2 seconds',    monetPrice: 2, lamports:  600_000, row: 5, icon: '⚡', solLabel: '~$0.10' },
  { id: 'double_stack', name: 'Double Stack',  desc: 'Ground + air combo — requires both jump and duck',     monetPrice: 2, lamports:  600_000, row: 6, icon: '📦', solLabel: '~$0.10' },
  { id: 'boss_block',   name: 'Boss Block',    desc: 'Massive pulsing wall — nearly impossible to survive',  monetPrice: 3, lamports:  900_000, row: 7, icon: '💀', solLabel: '~$0.15' },
];

app.get('/api/shop/items', (_req, res) => {
  res.json({ items: SHOP_ITEMS });
});

app.get('/api/shop/owned/:wallet', (req, res) => {
  const { wallet } = req.params;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });
  const purchases = dbRead('shop_purchases');
  const owned = [...new Set(purchases.filter(p => p.wallet === wallet).map(p => p.itemId))];
  res.json({ owned });
});

app.post('/api/shop/purchase', async (req, res) => {
  const { wallet, txId, itemId, paymentType } = req.body;
  if (!wallet || !txId || !itemId) return res.status(400).json({ error: 'wallet, txId, itemId required' });

  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(400).json({ error: 'Unknown item' });

  const purchases = dbRead('shop_purchases');
  if (purchases.some(p => p.txId === txId)) return res.status(400).json({ error: 'Transaction already used' });
  if (purchases.some(p => p.wallet === wallet && p.itemId === itemId)) return res.json({ ok: true, alreadyOwned: true });

  try {
    if (paymentType === 'sol') { await verifySOLPayment(txId, item.lamports); }
    else { await verifyEntryFee(txId, item.monetPrice); }
  } catch (e) { return res.status(402).json({ error: `Payment verification failed: ${e.message}` }); }

  purchases.push({ wallet, txId, itemId, paymentType: paymentType || 'monet', purchasedAt: Date.now() });
  dbWrite('shop_purchases', purchases);
  console.log(`[SHOP] ${wallet.slice(0,8)} purchased ${itemId} via ${paymentType || 'monet'} (${paymentType === 'sol' ? item.lamports + ' lam' : item.monetPrice + ' MONET'})`);
  res.json({ ok: true, item });
});

// ─── Terms acceptance log ─────────────────────────────────────────────────────
app.post('/api/terms/accept', (req, res) => {
  const { username } = req.body || {};
  const record = {
    id: Math.random().toString(36).slice(2),
    username: username || 'anonymous',
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || '',
    timestamp: Date.now(),
    date: new Date().toISOString(),
  };
  const logs = dbRead('terms_log');
  logs.push(record);
  dbWrite('terms_log', logs);
  console.log(`[TERMS] accepted by ${record.username} from ${record.ip}`);
  res.json({ ok: true });
});

// ─── Static files ─────────────────────────────────────────────────────────────
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
app.post("/api/dino-realms/finish", async (req, res) => {
  try {
    const { wallet, score } = req.body;
    if (!wallet) return res.status(400).json({ ok:false, error:"wallet required" });

    const claims = dbRead("claims");

    claims.push({
      id: genId(),
      type: "dino_realms",
      wallet,
      amount: Number(score || 0),
      status: "pending",
      createdAt: Date.now()
    });

    dbWrite("claims", claims);

    res.json({
      ok:true,
      winner: wallet,
      prize: Number(score || 0)
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.post("/api/dino-realms/finish", async (req, res) => {
  try {
    const { wallet, score } = req.body;

    if (!wallet) {
      return res.status(400).json({ ok:false, error:"wallet required" });
    }

    const claims = dbRead("claims");

    claims.push({
      id: genId(),
      type: "dino_realms",
      wallet,
      amount: Number(score || 0),
      status: "pending",
      createdAt: Date.now()
    });

    dbWrite("claims", claims);

    res.json({
      ok:true,
      winner: wallet,
      prize: Number(score || 0)
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  const kp = getTreasuryKP();
  if (kp) {
    const kpAddr = kp.publicKey.toString();
    if (kpAddr !== TREASURY_ADDR) {
      console.error('');
      console.error('╔══════════════════════════════════════════════════════════════╗');
      console.error('║  ⚠️  TREASURY KEY MISMATCH — PAYOUTS WILL FAIL              ║');
      console.error('╠══════════════════════════════════════════════════════════════╣');
      console.error(`║  Expected: ${TREASURY_ADDR}`);
      console.error(`║  Got:      ${kpAddr}`);
      console.error('║                                                              ║');
      console.error('║  Fix: update TREASURY_PRIVATE_KEY secret to the 64-byte     ║');
      console.error(`║  private key for address: ${TREASURY_ADDR.slice(0,20)}…   ║`);
      console.error('╚══════════════════════════════════════════════════════════════╝');
      console.error('');
    } else {
      console.log(`[MONET] API+WS server :${PORT} | treasury payouts: ENABLED ✓ (key verified)`);
    }
  } else {
    console.log(`[MONET] API+WS server :${PORT} | treasury payouts: QUEUED (set TREASURY_PRIVATE_KEY)`);
  }
});
	
