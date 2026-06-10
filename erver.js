diff --git a/server.js b/server.js
index 94b6f52..45847eb 100644
--- a/server.js
+++ b/server.js
@@ -125,7 +125,7 @@ app.use(express.json());
 // ─── Config ───────────────────────────────────────────────────────────────────
 const MINT_ADDRESS    = '6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b';
 const TREASURY_ADDR   = '4Uuga2iskhPvJyVAysQufh3vDwF9NRLmZQzHECwx8Cb4';
-const ENTRY_FEE       = 5;   // fallback only — dynamic fee targets $0.99 USD
+const ENTRY_FEE       = 100;   // fallback only — dynamic fee targets $0.99 USD
 const TARGET_USD      = 0.99; // entry fee target in USD
 const PRICE_CACHE_MS  = 5 * 60 * 1000; // cache MONET price for 5 minutes
 
@@ -194,7 +194,7 @@ async function getMonetPrice() {
 // Returns the current MONET entry fee (how many MONET = $0.99 USD)
 // Falls back to ENTRY_FEE (5) if price cannot be fetched.
 async function getDynamicEntryFee() {
-  return 10;
+  return 100;
 }
 
 // Warm the price cache at startup
@@ -525,71 +525,61 @@ function calcPot(n, fee = ENTRY_FEE) {
 // Intentionally lenient on RPC failures (warns + allows through) to avoid
 // blocking legitimate players during RPC outages; strict on bad amounts/recipients.
 async function verifyEntryFee(txId, expectedFee = ENTRY_FEE) {
-  const mint     = MINT_ADDRESS;
+  const mint = MINT_ADDRESS;
   const treasury = TREASURY_ADDR;
   const rawExpected = Math.round(expectedFee * Math.pow(10, DECIMALS));
 
   let tx;
   try {
-    tx = await withRpc(async conn =>
-      conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
-    , 14000);
-  } catch(e) {
+    tx = await withRpc(
+      async conn => conn.getParsedTransaction(txId, {
+        maxSupportedTransactionVersion: 0,
+        commitment: 'confirmed'
+      }),
+      14000
+    );
+  } catch (e) {
     console.warn(`[VERIFY] RPC error checking tx ${txId.slice(0,12)}…: ${e.message} — allowing through`);
     return { ok: true, rpcFailed: true };
   }
 
   if (!tx) {
-    // Tx not found — retry up to 3× with 2 s delay (tx may still be propagating)
-    for (let retry = 0; retry < 3; retry++) {
-      await new Promise(r => setTimeout(r, 2000));
-      try {
-        tx = await withRpc(async conn =>
-          conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
-        , 8000);
-        if (tx) break;
-      } catch(_) {}
-    }
-    if (!tx) {
-      console.warn(`[VERIFY] tx ${txId.slice(0,12)}… not found after retries — allowing through`);
-      return { ok: true, rpcFailed: true };
-    }
+    return { ok: true, rpcFailed: true };
   }
 
   if (tx.meta?.err) {
     console.error("[VERIFY TX ERROR]", txId, JSON.stringify(tx.meta.err), tx.meta.logMessages || []);
-    throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`);
-    throw new Error("Transaction failed: " + JSON.stringify(tx.meta.err) + " LOGS: " + JSON.stringify(tx.meta.logMessages || []));
+    throw new Error(
+      "Transaction failed: " +
+      JSON.stringify(tx.meta.err) +
+      " LOGS: " +
+      JSON.stringify(tx.meta.logMessages || [])
+    );
+  }
 
-  // Inspect all token balance changes for a MONET transfer to treasury
-  const pre  = tx.meta?.preTokenBalances  ?? [];
+  const pre = tx.meta?.preTokenBalances ?? [];
   const post = tx.meta?.postTokenBalances ?? [];
 
-  // Build a map of accountIndex → delta
-  const deltaMap = new Map();
+  let treasuryCredit = 0;
+  let senderWallet = null;
+
   for (const p of post) {
     if (p.mint !== mint) continue;
-    const pre_ = pre.find(x => x.accountIndex === p.accountIndex && x.mint === mint);
-    const before = pre_?.uiTokenAmount?.uiAmount ?? 0;
-    const after  = p.uiTokenAmount?.uiAmount ?? 0;
-    deltaMap.set(p.accountIndex, { delta: after - before, owner: p.owner, uiAmount: after });
-  }
-  for (const p of pre) {
-    if (p.mint !== mint || deltaMap.has(p.accountIndex)) continue;
-    const after_ = post.find(x => x.accountIndex === p.accountIndex && x.mint === mint);
-    const before = p.uiTokenAmount?.uiAmount ?? 0;
-    const after  = after_?.uiTokenAmount?.uiAmount ?? 0;
-    deltaMap.set(p.accountIndex, { delta: after - before, owner: p.owner, uiAmount: after });
-  }
 
-  // Find treasury credit
-  let treasuryCredit = 0, senderWallet = null;
-  for (const [, info] of deltaMap) {
-    if (info.owner === treasury && info.delta > 0) {
-      treasuryCredit = info.delta;
+    const preBal = pre.find(
+      x => x.accountIndex === p.accountIndex && x.mint === mint
+    );
+
+    const before = preBal?.uiTokenAmount?.uiAmount ?? 0;
+    const after = p.uiTokenAmount?.uiAmount ?? 0;
+    const delta = after - before;
+
+    if (p.owner === treasury && delta > 0) {
+      treasuryCredit += delta;
     }
-    if (info.delta < 0) {
-      senderWallet = info.owner;
+
+    if (delta < 0) {
+      senderWallet = p.owner;
     }
   }
 
@@ -598,60 +588,68 @@ async function verifyEntryFee(txId, expectedFee = ENTRY_FEE) {
   }
 
   const rawActual = Math.round(treasuryCredit * Math.pow(10, DECIMALS));
+
   if (rawActual < rawExpected) {
     throw new Error(
       `Transaction sent ${treasuryCredit.toFixed(DECIMALS)} MONET but expected ${expectedFee}`
     );
   }
 
-  console.log(`[VERIFY] ✓ tx ${txId.slice(0,12)}… verified: ${treasuryCredit} MONET → treasury from ${(senderWallet||'?').slice(0,8)}…`);
   return { ok: true, senderWallet, amount: treasuryCredit };
 }
 
-// Verify a SOL (lamport) payment to treasury — for the SOL entry-fee option.
 async function verifySOLPayment(txId, expectedLamports = SOL_ENTRY_LAMPORTS) {
   let tx;
+
   try {
-    tx = await withRpc(async conn =>
-      conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
-    , 14000);
-  } catch(e) {
+    tx = await withRpc(
+      async conn => conn.getParsedTransaction(txId, {
+        maxSupportedTransactionVersion: 0,
+        commitment: 'confirmed'
+      }),
+      14000
+    );
+  } catch (e) {
     console.warn(`[VERIFY-SOL] RPC error ${txId.slice(0,12)}…: ${e.message} — allowing through`);
     return { ok: true, rpcFailed: true };
   }
+
   if (!tx) {
-    for (let retry = 0; retry < 3; retry++) {
-      await new Promise(r => setTimeout(r, 2000));
-      try {
-        tx = await withRpc(async conn =>
-          conn.getParsedTransaction(txId, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
-        , 8000);
-        if (tx) break;
-      } catch(_) {}
-    }
-    if (!tx) {
-      console.warn(`[VERIFY-SOL] tx ${txId.slice(0,12)}… not found after retries — allowing through`);
-      return { ok: true, rpcFailed: true };
-    }
+    return { ok: true, rpcFailed: true };
+  }
+
   if (tx.meta?.err) {
     console.error("[VERIFY SOL ERROR]", txId, JSON.stringify(tx.meta.err), tx.meta.logMessages || []);
-    throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`);
-    throw new Error("Transaction failed: " + JSON.stringify(tx.meta.err) + " LOGS: " + JSON.stringify(tx.meta.logMessages || []));
+    throw new Error(
+      "Transaction failed: " +
+      JSON.stringify(tx.meta.err) +
+      " LOGS: " +
+      JSON.stringify(tx.meta.logMessages || [])
+    );
+  }
 
-  // Find treasury account index and check SOL balance delta
   const keys = tx.transaction.message.accountKeys || [];
-  const tIdx = keys.findIndex(a => (typeof a === 'string' ? a : a.pubkey?.toString()) === TREASURY_ADDR);
-  if (tIdx === -1) throw new Error(`Transaction ${txId.slice(0,12)}… did not involve treasury`);
 
-  const delta = (tx.meta.postBalances[tIdx] ?? 0) - (tx.meta.preBalances[tIdx] ?? 0);
+  const tIdx = keys.findIndex(
+    a => (typeof a === 'string' ? a : a.pubkey?.toString()) === TREASURY_ADDR
+  );
+
+  if (tIdx === -1) {
+    throw new Error(`Transaction ${txId.slice(0,12)}… did not involve treasury`);
+  }
+
+  const delta =
+    (tx.meta.postBalances[tIdx] ?? 0) -
+    (tx.meta.preBalances[tIdx] ?? 0);
+
   if (delta < expectedLamports) {
-    throw new Error(`SOL payment too small: got ${delta} lamports, expected ${expectedLamports}`);
+    throw new Error(
+      `SOL payment too small: got ${delta} lamports, expected ${expectedLamports}`
+    );
   }
-  console.log(`[VERIFY-SOL] ✓ tx ${txId.slice(0,12)}… verified: ${delta} lamports → treasury`);
+
   return { ok: true, delta };
 }
-
-// ─── CPU score ranges per game/difficulty ─────────────────────────────────────
 const CPU_RANGES = {
   easy:   { frogger:[100,350],    snake:[6,16],   pacman:[1000,3500],   pong:[2,4], dino:[300,900],   mario:[100,300]   },
   medium: { frogger:[500,1100],   snake:[22,50],  pacman:[5000,11000],  pong:[5,7], dino:[1200,3000], mario:[300,800]   },
