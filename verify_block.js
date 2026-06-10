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
