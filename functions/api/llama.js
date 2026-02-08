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
  const apiKey = BEACON_KEY || null;

  // 1) Try beaconcha.in queue endpoint (entry/exit + churn + wait)
  let queue = null;
  if (apiKey) {
    try {
      const u = new URL("https://beaconcha.in/api/v1/validators/queue");
      u.searchParams.set("apikey", apiKey);

      const r = await fetch(u.toString(), { headers: hdrs() });
      if (r.ok) {
        const j = await r.json();
        queue = j?.data ?? null;
      }
    } catch (_) {
      // ignore; we'll fall back
    }
  }

  // 2) Network stats + fallback queue parsing from validatorqueue.com
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

  if (
    !/Active\s+Validators\s*:/i.test(text) &&
    !/Ethereum\s+Validator\s+Queue/i.test(text)
  ) {
    throw new Error("validatorqueue_unexpected_content");
  }

  const activeValidators = pickNumber(
    text,
    /Active\s+Validators\s*:\s*([0-9,]+)/i
  );
  const stakedEthM = pickText(text, /Staked\s+ETH\s*:\s*([0-9.]+)\s*M/i);
  const apr = pickNumber(text, /APR\s*:\s*([0-9.]+)\s*%/i);

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

  const exitEth =
    pickNumber(text, /Exit\s+Queue[\s\S]*?ETH\s*:\s*([0-9,]+)/i) ??
    pickNumber(
      text,
      /Withdrawal\s+Queue[\s\S]*?Queued\s+ETH\s*:\s*([0-9,]+)/i
    );

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
  const keyPresent = !!GLACIER_KEY;
  if (!GLACIER_KEY) throw new Error("missing_GLACIER_API_KEY");

  // Try both hosts (some accounts/projects are routed differently)
  const hosts = [
    "https://data-api.avax.network",
    "https://glacier-api.avax.network",
  ];

  let res = null;
  let lastStatus = null;

  for (const host of hosts) {
    const r = await fetch(`${host}/v1/networks/mainnet`, {
      headers: {
        "x-glacier-api-key": GLACIER_KEY,
        accept: "application/json",
      },
    });

    lastStatus = r.status;
    if (r.ok) {
      res = r;
      break;
    }
  }

  if (!res) {
    throw new Error(`avax_network_details_bad_status_${lastStatus ?? "unknown"}`);
  }

  const j = await res.json();

  const vd = j?.validatorDetails || {};
  const dd = j?.delegatorDetails || {};

  const validatorCount = Number(vd?.validatorCount);
  const totalAmountStaked_nAVAX = safeBigInt(vd?.totalAmountStaked) ?? 0n;
  const annualReward_nAVAX = safeBigInt(vd?.estimatedAnnualStakingReward) ?? 0n;

  const delegatorCount = Number(dd?.delegatorCount);
  const delegatorStaked_nAVAX = safeBigInt(dd?.totalAmountStaked) ?? 0n;

  const apr = calcAprPct(annualReward_nAVAX, totalAmountStaked_nAVAX);

  const totalStaked_AVAX =
    totalAmountStaked_nAVAX > 0n ? formatAVAXfromnAVAX(totalAmountStaked_nAVAX) : null;

  const delegatorStaked_AVAX =
    delegatorStaked_nAVAX > 0n ? formatAVAXfromnAVAX(delegatorStaked_nAVAX) : null;

  const stakingRatioRaw = vd?.stakingRatio;
  const stakingRatio =
    stakingRatioRaw != null && String(stakingRatioRaw).trim() !== ""
      ? String(stakingRatioRaw).trim()
      : null;

  return {
    chain: "avalanche",
    activeValidators: Number.isFinite(validatorCount) ? validatorCount : null,
    totalStaked: totalStaked_AVAX ? `${totalStaked_AVAX} AVAX` : null,
    apr: apr ?? null,

    // 3 extra top metrics (mapped into your 6 slots)
    entryQueue: Number.isFinite(delegatorCount) ? delegatorCount.toLocaleString("en-US") : "—",
    exitQueue: delegatorStaked_AVAX ? `${delegatorStaked_AVAX} AVAX` : "—",
    churnLimit: stakingRatio ? stakingRatio : "—",

    updatedAt: Date.now(),
    source: "avax network details (data-api/glacier-api)",
    glacierKeyPresent: keyPresent,
  };
}

function calcAprPct(annualReward_nAVAX, totalStaked_nAVAX) {
  try {
    if (annualReward_nAVAX <= 0n) return null;
    if (totalStaked_nAVAX <= 0n) return null;

    // scaled = reward * 10000 / staked  => percent with 2 decimals
    const scaled = (annualReward_nAVAX * 10000n) / totalStaked_nAVAX;
    const whole = Number(scaled / 100n);
    const frac = Number(scaled % 100n);
    return Number(`${whole}.${String(frac).padStart(2, "0")}`);
  } catch {
    return null;
  }
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

function formatQueue(queue, kind) {
  if (!queue) return null;

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
    return BigInt(s.replace(/,/g, ""));
  } catch {
    return null;
  }
}

function formatAVAXfromnAVAX(n) {
  const denom = 1_000_000_000n;
  const whole = n / denom;
  const frac = n % denom;

  const frac2 = (frac * 100n) / denom;
  const s = `${whole.toString()}.${frac2.toString().padStart(2, "0")}`;

  const [w, f] = s.split(".");
  const withCommas = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withCommas}.${f}`;
}
