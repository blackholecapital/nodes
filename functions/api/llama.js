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
    return json({
      error: "upstream_failed",
      message: String(e?.message || e),
    }, 502);
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
    "user-agent": "Mozilla/5.0 (gotnodes.xyz; +https://gotnodes.xyz)",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };
}

/**
 * ETH GLOBAL VALIDATOR STATS
 * Source: validatorqueue.com (explicitly states data provided by beaconcha.in)
 * We parse these 6 metrics:
 * 1) Active validators
 * 2) Total staked
 * 3) Staking APR
 * 4) Entry queue (ETH + wait)
 * 5) Exit queue (ETH + wait)
 * 6) Churn limit
 */
async function getEthereumValidatorStats({ BEACON_KEY, LLAMA_KEY } = {}) {
  const res = await fetch("https://validatorqueue.com/", { headers: hdrs() });
  if (!res.ok) throw new Error(`validatorqueue_bad_status_${res.status}`);
  const text = await res.text();

  // Network (these appear as plain text on the page)
  const activeValidators = pickNumber(text, /Active Validators:\s*([0-9,]+)/i);
  const stakedEthM = pickText(text, /Staked ETH:\s*([0-9.]+)M/i); // e.g. 36.5M
  const apr = pickNumber(text, /APR:\s*([0-9.]+)%/i);

  // Entry queue section
  const entryEth = pickNumber(text, /Entry Queue[\s\S]*?ETH:\s*([0-9,]+)/i);
  const entryWait = pickText(text, /Entry Queue[\s\S]*?Wait:\s*([0-9a-z ,]+)\s*/i);
  const entryChurn = pickText(text, /Entry Queue[\s\S]*?Churn:\s*([0-9/]+\/epoch)/i)
    ?? pickText(text, /Churn:\s*([0-9/]+\/epoch)/i);

  // Exit queue section
  const exitEth = pickNumber(text, /Exit Queue[\s\S]*?ETH:\s*([0-9,]+)/i);
  const exitWait = pickText(text, /Exit Queue[\s\S]*?Wait:\s*([0-9a-z ,]+)\s*/i);
  const exitChurn = pickText(text, /Exit Queue[\s\S]*?Churn:\s*([0-9/]+\/epoch)/i);

  const churnLimit = entryChurn || exitChurn || null;

  return {
    chain: "ethereum",
    activeValidators: activeValidators ?? null,
    totalStaked: stakedEthM ? `${stakedEthM}M ETH` : null,
    apr: (apr ?? null),

    entryQueue: (entryEth || entryWait)
      ? `${entryEth ?? "—"} ETH${entryWait ? ` • ${clean(entryWait)}` : ""}`
      : null,

    exitQueue: (exitEth || exitWait)
      ? `${exitEth ?? "—"} ETH${exitWait ? ` • ${clean(exitWait)}` : ""}`
      : null,

    churnLimit: churnLimit ? clean(churnLimit) : null,
    updatedAt: Date.now(),
    source: "validatorqueue.com (beaconcha.in)",
  };
}

/**
 * AVAX GLOBAL VALIDATOR STATS (PRIMARY NETWORK)
 * Source: AvaCloud / Glacier Data API "List validators"
 * Auth header required: x-glacier-api-key
 * We compute:
 * 1) Active validators (count)
 * 2) Total staked (sum(amountStaked) across active validators)
 *
 * NOTE: Avalanche does not have ETH-style entry/exit queues publicly in the same way.
 * We keep entry/exit/churn as "—" unless you specify the exact metric source you want.
 */
async function getAvalancheValidatorStats({ GLACIER_KEY } = {}) {
  if (!GLACIER_KEY) throw new Error("missing_GLACIER_API_KEY");

  const base = "https://glacier-api.avax.network";
  const path = "/v1/networks/mainnet/validators";
  const pageSize = 100;

  let nextPageToken = null;
  let count = 0;
  let totalStaked_nAVAX = 0n;

  // paginate through active validators
  for (let i = 0; i < 50; i++) { // safety cap
    const u = new URL(base + path);
    u.searchParams.set("validationStatus", "active");
    u.searchParams.set("pageSize", String(pageSize));
    if (nextPageToken) u.searchParams.set("pageToken", nextPageToken);

    const res = await fetch(u.toString(), {
      headers: {
        "x-glacier-api-key": GLACIER_KEY,
        "accept": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`glacier_bad_status_${res.status}`);
    }

    const j = await res.json();
    const validators = Array.isArray(j?.validators) ? j.validators : [];

    for (const v of validators) {
      count += 1;

      // amountStaked is a string; docs use nAVAX in query params; amountStaked also comes as string. :contentReference[oaicite:2]{index=2}
      // We treat it as nAVAX (1 AVAX = 1e9 nAVAX).
      const amt = safeBigInt(v?.amountStaked);
      totalStaked_nAVAX += amt;
    }

    nextPageToken = j?.nextPageToken || null;
    if (!nextPageToken) break;
  }

  const totalStaked_AVAX = formatAVAXfromnAVAX(totalStaked_nAVAX);

  return {
    chain: "avalanche",
    activeValidators: count || null,
    totalStaked: totalStaked_AVAX ? `${totalStaked_AVAX} AVAX` : null,
    apr: null,
    entryQueue: "—",
    exitQueue: "—",
    churnLimit: "—",
    updatedAt: Date.now(),
    source: "AvaCloud/Glacier Data API (Primary Network validators)",
  };
}

function pickText(src, re) {
  const m = src.match(re);
  return m ? String(m[1] ?? "").trim() : null;
}

function pickNumber(src, re) {
  const m = src.match(re);
  if (!m) return null;
  const raw = String(m[1] ?? "").replace(/,/g, "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function safeBigInt(v) {
  try {
    if (v === null || v === undefined) return 0n;
    const s = String(v).trim();
    if (!s) return 0n;
    // strip decimals if any (shouldn't happen, but just in case)
    const t = s.includes(".") ? s.split(".")[0] : s;
    return BigInt(t);
  } catch {
    return 0n;
  }
}

// nAVAX is nano-AVAX (1e9). Docs use nAVAX in parameters and constraints align with 1e9. :contentReference[oaicite:3]{index=3}
function formatAVAXfromnAVAX(n) {
  const denom = 1000000000n; // 1e9
  const whole = n / denom;
  const frac = n % denom;

  // show 2 decimals (truncate)
  const frac2 = (frac * 100n) / denom;
  const s = `${whole.toString()}.${frac2.toString().padStart(2, "0")}`;

  // add commas to whole part
  const [w, f] = s.split(".");
  const withCommas = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withCommas}.${f}`;
}
