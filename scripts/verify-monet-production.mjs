import fs from "node:fs";

const EXPECTED_MINT =
  "6eACLGXCGdw9D5zb5eBKyFnFNTX9pTihDEpZQ7gYAX1b";

const EXPECTED_MONET =
  "0.0125";

const EXPECTED_BASE =
  "12500";

const EXPECTED_USD =
  "0.99";

const EXPECTED_WINNER =
  80;

const EXPECTED_TREASURY =
  20;

let failed = false;

function check(label, condition, actual = "") {
  const ok = Boolean(condition);

  console.log(
    `${ok ? "✓" : "✗"} ${label}` +
    (actual ? `: ${actual}` : "")
  );

  if (!ok) failed = true;
}

console.log("");
console.log("=================================================");
console.log(" MONET MONEY ARCADE PRODUCTION VERIFICATION");
console.log("=================================================");
console.log("");

const config =
  fs.readFileSync(
    "src/config/monet-production.js",
    "utf8"
  );

check(
  "Correct MONET mint",
  config.includes(EXPECTED_MINT),
  EXPECTED_MINT
);

check(
  "MONET entry = 0.0125",
  config.includes("entryFeeMonet: 0.0125"),
  "0.0125 MONET"
);

check(
  "MONET base units = 12500",
  config.includes("entryFeeBaseUnits: 12500"),
  "12,500"
);

check(
  "USD reference = $0.99",
  config.includes("entryFeeUsd: 0.99"),
  "$0.99"
);

check(
  "Winner payout = 80%",
  config.includes("winnerPercent: 80"),
  "80%"
);

check(
  "Treasury = 20%",
  config.includes("treasuryPercent: 20"),
  "20%"
);

if (fs.existsSync("wallet.js")) {
  const wallet =
    fs.readFileSync(
      "wallet.js",
      "utf8"
    );

  check(
    "wallet.js contains correct mint",
    wallet.includes(EXPECTED_MINT)
  );
}

if (fs.existsSync("server.js")) {
  const server =
    fs.readFileSync(
      "server.js",
      "utf8"
    );

  check(
    "server.js does not contain wrong mint",
    !server.includes(
      "BYqHJvvtJSgXQi9iuL6PcXmVNADqBDxNGkyAhY8zwTWR"
    )
  );
}

console.log("");

if (failed) {
  console.error(
    "❌ PRODUCTION VERIFICATION FAILED"
  );

  process.exit(1);
}

console.log(
  "✅ PRODUCTION CONFIGURATION VERIFIED"
);

console.log("");
console.log(
  "MONET: 0.0125"
);

console.log(
  "BASE UNITS: 12,500"
);

console.log(
  "USD: $0.99"
);

console.log(
  "SOL: $0.99 equivalent"
);

console.log(
  "PAYOUT: 80 / 20"
);

console.log("");
