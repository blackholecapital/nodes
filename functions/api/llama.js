export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const chain = (url.searchParams.get("chain") || "").toLowerCase();

  if (!chain || (chain !== "ethereum" && chain !== "avalanche")) {
    return json({ error: "missing_or_invalid_chain" }, 400);
  }

  const BEACON_KEY = env?.BEACONCHA_IN_API_KEY || null;
  const GLACIER_KEY = env?.GLACIER_API_KEY || null;
  const LLAMA_KEY = env?.VITE_LLAMA_API_KEY || null;

  try {
    if (chain === "ethereum") {
      const data = await getEthereumValidatorStats({ BEACON_KEY, LLAMA_KEY });
      return json(data, 200);
    }

    const data = await getAvalancheValidatorStats({ GLACIER_KEY, LLAMA_KEY });
    return json(data, 200);
  } catch (e) {
    return json(
      {
        error: "upstream_failed",
        message: String(e?.message || e),
      },
      502
    );
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hdrs() {
  return {
    accept: "application/json,text/plain;q=0.9,text/html;q=0.8,*/*;q=0.1",
    "user-agent": "gotnodes/1.0 (+https://gotnodes.xyz)",
  };
}

async function getEthereumValidatorStats({ BEACON_KEY } = {}) {
  // Prefer the official beaconcha.in API (less brittle than HTML parsing).
  // If the API call fails (missing key or rate limit), fall back to validatorqueue.com parsing.
  const apiKey = BEACON_KEY || null;

  // 1) Try beaconcha.in V1 queue endpoint (entry/exit + churn + wait)
  // Docs indicate API key can be provided via query param `apikey`.
  let queue = null;
  if (apiKey) {
    try {
      const u = new URL("https://beaconcha.in/api/v1/validators/queue");
      u.searchParams.set("apikey", apiKey);

      const r = await fetch(u.toString(), { headers: hdrs() });
      if (r.ok) {
        const j = await r.json();
        // beaconcha.in uses a common envelope: { status: "OK", data: ... }
        queue = j?.data ?? null;
      }
    } catch (_) {
      // ignore; we'll fall back
    }
  }

  // 2) Network stats + fallback queue parsing from validatorqueue.com (public page)
  const res = await fetch("https://validatorqueue.com/?nocache=" + Date.now(), {
    headers: {
      ...hdrs(),
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`validatorqueue_bad_status_${res.status}`);

  const html = await res.text();
  const text = toPlainText(html);

  // If the page content is not what we expect (e.g., bot challenge), fail fast.
  if (
    !/Active\s+Validators\s*:/i.test(text) &&
    !/Ethereum\s+Validator\s+Queue/i.test(text)
  ) {
    throw new Error("validatorqueue_unexpected_content");
  }

  // Network
  const activeValidators = pickNumber(
    text,
    /Active\s+Validators\s*:\s*([0-9,]+)/i
  );
  const stakedEthM = pickText(text, /Staked\s+ETH\s*:\s*([0-9.]+)\s*M/i); // e.g. 36.5M
  const apr = pickNumber(text, /APR\s*:\s*([0-9.]+)\s*%/i);

  // Entry queue section
  const entryEth =
    pickNumber(text, /Entry\s+Queue[\s\S]*?ETH\s*:\s*([0-9,]+)/i) ??
    pickNumber(
      text,
      /Deposit\s+Queue[\s\S]*?Queued\s+ETH\s*:\s*([0-9,]+)/i
    );
  const entryWait =
    pickText(text, /Entry\s+Queue[\s\S]*?Wait\s*:\s*([0-9a-z ,]+)\s*/i) ??
    pickText(
      text,
      /Deposit\s+Queue[\s\S]*?Estimated\s+Wait\s+Time\s*:\s*([0-9a-z ,]+)\s*/i
    );
  const entryChurn =
    pickText(
      text,
      /Entry\s+Queue[\s\S]*?Churn\s*:\s*([0-9/]+\s*\/\s*epoch)/i
    ) ??
    pickText(
      text,
      /Churn\s*Limit\s+per\s+Epoch\s*:\s*([0-9,]+)\s*ETH/i
    ) ??
    pickText(text, /Churn\s*:\s*([0-9/]+\s*\/\s*epoch)/i);

  // Exit queue section
  const exitEth =
    pickNumber(text, /Exit\s+Queue[\s\S]*?ETH\s*:\s*([0-9,]+)/i) ??
    pickNumber(text, /Withdrawal\s+Queue[\s\S]*?Queued\s+ETH\s*:\s*([0-9,]+)/i);
  const exitWait =
    pickText(text, /Exit\s+Queue[\s\S]*?Wait\s*:\s*([0-9a-z ,]+)\s*/i) ??
    pickText(
      text,
      /Withdrawal\s+Queue[\s\S]*?Estimated\s+Wait\s+Time\s*:\s*([0-9a-z ,]+)\s*/i
    );
  const exitChurn = pickText(
    text,
    /Exit\s+Queue[\s\S]*?Churn\s*:\s*([0-9/]+\s*\/\s*epoch)/i
  );

  const churnLimit = clean(entryChurn || exitChurn || "");

  // If beaconcha queue API worked, allow it to override queue-specific fields.
  // We keep parsing fallback values in place because queue API field names can change.
  const entryQueue =
    formatQueue(queue, "entry") ??
    ((entryEth || entryWait)
      ? `${entryEth ?? "—"} ETH${entryWait ? ` • ${clean(entryWait)}` : ""}`
      : null);
  const exitQueue =
    formatQueue(queue, "exit") ??
    ((exitEth || exitWait)
      ? `${exitEth ?? "—"} ETH${exitWait ? ` • ${clean(exitWait)}` : ""}`
      : null);
  const churnOut = formatChurn(queue) ?? (churnLimit ? churnLimit : null);

  return {
    chain: "ethereum",
    activeValidators: activeValidators ?? null,
    totalStaked: stakedEthM ? `${stakedEthM}M ETH` : null,
    apr: apr ?? null,
    entryQueue,
    exitQueue,
    churnLimit: churnOut,
    updatedAt: Date.now(),
    source: apiKey
      ? "beaconcha.in API + validatorqueue.com"
      : "validatorqueue.com (beaconcha.in)",
  };
}

async function getAvalancheValidatorStats({ GLACIER_KEY } = {}) {
  // Avalanche global validator stats are sourced from Glacier (Avalanche official API)
  // using the provided GLACIER_API_KEY (env). If missing, we still try (some endpoints may be public).
  const key = GLACIER_KEY || null;

  // We fetch:
  // - active validators count
  // - total staked (AVAX)
  // - staking APR (if available)
  // - entry queue (best-effort: pending validators)
  // - exit queue (best-effort)
  // - churn limit (best-effort / not always exposed on Avalanche)

  // NOTE: Glacier endpoints and shapes can vary by version; we keep this defensive.

  const headers = {
    ...hdrs(),
    ...(key ? { "x-glacier-api-key": key } : {}),
  };

  // Try a few common Glacier paths in order until we get something useful.
  const tryUrls = [
    "https://glacier-api.avax.network/v1/networks/mainnet/validators",
    "https://glacier-api.avax.network/v1/networks/mainnet/staking/validators",
    "https://glacier-api.avax.network/v2/networks/mainnet/validators",
  ];

  let data = null;
  for (const u of tryUrls) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      const j = await r.json();
      data = j;
      break;
    } catch (_) {
      // continue
    }
  }

  // If Glacier didn't respond with validator list data, return null fields (UI will show —)
  if (!data) {
    return {
      chain: "avalanche",
      activeValidators: null,
      totalStaked: null,
      apr: null,
      entryQueue: null,
      exitQueue: null,
      churnLimit: null,
      updatedAt: Date.now(),
      source: "glacier-api.avax.network",
    };
  }

  // Extract validator list (shape varies)
  const validators =
    data?.validators ||
    data?.data?.validators ||
    data?.data ||
    data?.items ||
    [];

  // active validators = count of validators in "active"/"current" state if present; else list length
  let activeValidators = null;
  if (Array.isArray(validators)) {
    const active = validators.filter((v) => {
      const st = (v?.status || v?.state || "").toString().toLowerCase();
      if (!st) return true; // if no status provided, count it
      return st.includes("active") || st.includes("current") || st === "validated";
    });
    activeValidators = active.length;
  }

  // total staked: sum stake or weight fields
  let totalStakedNAVAX = null;
  if (Array.isArray(validators)) {
    let sum = 0n;
    for (const v of validators) {
      const w =
        v?.stakeAmount ??
        v?.stake ??
        v?.weight ??
        v?.delegatorWeight ??
        v?.stakedAmount ??
        null;
      const bi = safeBigInt(w);
      if (bi != null) sum += bi;
    }
    if (sum > 0n) totalStakedNAVAX = sum; // nAVAX
  }

  // APR: try to fetch a dedicated APR endpoint, otherwise null
  let apr = null;
  const aprUrls = [
    "https://glacier-api.avax.network/v1/networks/mainnet/staking/apr",
    "https://glacier-api.avax.network/v1/networks/mainnet/apr",
    "https://glacier-api.avax.network/v2/networks/mainnet/staking/apr",
  ];
  for (const u of aprUrls) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      const j = await r.json();
      const val =
        j?.apr ??
        j?.data?.apr ??
        j?.data?.value ??
        j?.value ??
        j?.data ??
        null;
      const n = typeof val === "string" ? Number(val) : typeof val === "number" ? val : null;
      if (Number.isFinite(n)) {
        apr = n;
        break;
      }
    } catch (_) {
      // continue
    }
  }

  // Entry/exit queue + churn limit are not universally exposed on Avalanche via Glacier.
  // Keep these as null for now (wireframe boxes can remain empty or display "—").
  return {
    chain: "avalanche",
    activeValidators: activeValidators ?? null,
    totalStaked: totalStakedNAVAX != null ? `${formatAVAXfromnAVAX(totalStakedNAVAX)} AVAX` : null,
    apr: apr ?? null,
    entryQueue: null,
    exitQueue: null,
    churnLimit: null,
    updatedAt: Date.now(),
    source: "glacier-api.avax.network",
  };
}

function toPlainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Best-effort parsing of beaconcha.in queue payload.
// We intentionally support multiple possible field names because the v1 payload is not documented
// in the public v2 reference pages.
function formatQueue(queue, kind /* 'entry'|'exit' */) {
  if (!queue) return null;

  // common patterns seen in queue trackers: { entry: { eth: ..., wait: ... }, exit: ... }
  const q = queue?.[kind] || queue?.[kind + "Queue"] || null;
  if (q && typeof q === "object") {
    const eth = q.eth ?? q.queuedEth ?? q.amount ?? q.total ?? null;
    const wait = q.wait ?? q.estimatedWaitTime ?? q.estimated_wait_time ?? null;
    const ethNum =
      typeof eth === "number"
        ? eth
        : typeof eth === "string"
        ? Number(String(eth).replace(/,/g, ""))
        : null;
    const ethOut = Number.isFinite(ethNum)
      ? ethNum.toLocaleString("en-US")
      : eth
      ? String(eth)
      : "—";
    const waitOut = wait ? clean(String(wait)) : null;
    return `${ethOut} ETH${waitOut ? ` • ${waitOut}` : ""}`;
  }

  // alternative: flat keys
  const ethFlat = queue?.[kind + "Eth"] ?? queue?.[kind + "_eth"] ?? null;
  const waitFlat = queue?.[kind + "Wait"] ?? queue?.[kind + "_wait"] ?? null;
  if (ethFlat || waitFlat) {
    const ethOut = ethFlat ? String(ethFlat) : "—";
    const waitOut = waitFlat ? clean(String(waitFlat)) : null;
    return `${ethOut} ETH${waitOut ? ` • ${waitOut}` : ""}`;
  }

  return null;
}

function formatChurn(queue) {
  if (!queue) return null;
  const churn =
    queue?.churnLimit ??
    queue?.churn_limit ??
    queue?.churn ??
    queue?.churnPerEpoch ??
    queue?.churn_per_epoch ??
    null;

  if (churn == null) return null;

  // If churn is numeric ETH-per-epoch, normalize to "X/epoch"
  if (typeof churn === "number") return `${churn}/epoch`;
  const s = String(churn).trim();
  if (!s) return null;
  if (/\/\s*epoch/i.test(s)) return clean(s.replace(/\s+/g, ""));
  return clean(s);
}

function pickText(src, re) {
  const m = re.exec(src || "");
  return m && m[1] != null ? String(m[1]).trim() : null;
}

function pickNumber(src, re) {
  const s = pickText(src, re);
  if (!s) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeBigInt(v) {
  try {
    if (v == null) return null;
    if (typeof v === "bigint") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      return BigInt(Math.trunc(v));
    }
    const s = String(v).trim();
    if (!s) return null;
    // allow commas
    return BigInt(s.replace(/,/g, ""));
  } catch {
    return null;
  }
}

function formatAVAXfromnAVAX(n) {
  // n is bigint in nAVAX (1e9)
  const denom = 1_000_000_000n;
  const whole = n / denom;
  const frac = n % denom;

  // show 2 decimals
  const frac2 = (frac * 100n) / denom;
  const s = `${whole.toString()}.${frac2.toString().padStart(2, "0")}`;

  // add commas to whole part
  const [w, f] = s.split(".");
  const withCommas = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withCommas}.${f}`;
}
