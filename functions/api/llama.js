export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const chain = (url.searchParams.get("chain") || "").toLowerCase();

  if (!chain || (chain !== "ethereum" && chain !== "avalanche")) {
    return json({ error: "missing_or_invalid_chain" }, 400);
  }

  // You said your key is stored as VITE_LLAMA_API_KEY.
  // DefiLlama Pro docs authenticate via URL path (pro-api.llama.fi/<KEY>/...),
  // and do not document validator/queue endpoints. We keep the env read here
  // only so it’s available if/when you provide a specific Pro endpoint later.
  const LLAMA_KEY = env?.VITE_LLAMA_API_KEY;

  try {
    if (chain === "ethereum") {
      const data = await getEthereumValidatorStats({ LLAMA_KEY });
      return json(data, 200);
    }

    const data = await getAvalancheValidatorStats({ LLAMA_KEY });
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

/**
 * ETH source: validatorqueue.com (public dashboard)
 * Metrics:
 * - Active Validators
 * - Staked ETH
 * - APR
 * - Entry Queue (ETH + wait)
 * - Exit Queue (ETH + wait)
 * - Churn
 */
async function getEthereumValidatorStats({ LLAMA_KEY } = {}) {
  const res = await fetch("https://validatorqueue.com/", {
    headers: {
      "user-agent": "Mozilla/5.0 (gotnodes.xyz; +https://gotnodes.xyz)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      // harmless signal header (does not claim to be DefiLlama auth)
      ...(LLAMA_KEY ? { "x-llama-key-present": "1" } : {}),
    },
  });
  if (!res.ok) throw new Error(`validatorqueue_bad_status_${res.status}`);
  const html = await res.text();

  const activeValidators =
    pickNumber(html, /Active Validators:\s*<\/[^>]+>\s*([0-9,]+)/i) ??
    pickNumber(html, /Active Validators:\s*([0-9,]+)/i);

  const stakedEth =
    pickText(html, /Staked ETH:\s*<\/[^>]+>\s*([0-9.,]+M)/i) ??
    pickText(html, /Staked ETH:\s*([0-9.,]+M)/i);

  const apr =
    pickNumber(html, /APR:\s*<\/[^>]+>\s*([0-9.]+)%/i) ??
    pickNumber(html, /APR:\s*([0-9.]+)%/i);

  const entryEth =
    pickText(html, /Entry Queue[\s\S]*?ETH:\s*<\/[^>]+>\s*([0-9,]+)/i) ??
    pickText(html, /Entry Queue[\s\S]*?ETH:\s*([0-9,]+)/i);

  const entryWait =
    pickText(html, /Entry Queue[\s\S]*?Wait:\s*<\/[^>]+>\s*([^<\n\r]+)/i) ??
    pickText(html, /Entry Queue[\s\S]*?Wait:\s*([^<\n\r]+)/i);

  const exitEth =
    pickText(html, /Exit Queue[\s\S]*?ETH:\s*<\/[^>]+>\s*([0-9,]+)/i) ??
    pickText(html, /Exit Queue[\s\S]*?ETH:\s*([0-9,]+)/i);

  const exitWait =
    pickText(html, /Exit Queue[\s\S]*?Wait:\s*<\/[^>]+>\s*([^<\n\r]+)/i) ??
    pickText(html, /Exit Queue[\s\S]*?Wait:\s*([^<\n\r]+)/i);

  const churn =
    pickText(html, /Churn:\s*<\/[^>]+>\s*([^<\n\r]+)/i) ??
    pickText(html, /Churn:\s*([^<\n\r]+)/i);

  return {
    chain: "ethereum",
    activeValidators: activeValidators ?? null,
    totalStaked: stakedEth ? `${stakedEth} ETH` : null,
    apr: (apr ?? null),
    entryQueue: entryEth && entryWait
      ? `${entryEth} ETH • ${clean(entryWait)}`
      : (entryEth ? `${entryEth} ETH` : null),
    exitQueue: exitEth && exitWait
      ? `${exitEth} ETH • ${clean(exitWait)}`
      : (exitEth ? `${exitEth} ETH` : null),
    churnLimit: churn ? clean(churn) : null,
    updatedAt: Date.now(),
  };
}

/**
 * AVAX sources:
 * - Primary: https://www.avax.network/build/validators
 * - Fallback: https://avascan.info/stats/staking
 *
 * Avalanche does NOT have ETH-style entry/exit queues publicly in the same way.
 * We keep those as "—" unless/until you provide a specific source/endpoint.
 */
async function getAvalancheValidatorStats({ LLAMA_KEY } = {}) {
  const tryFetch = async (u) => {
    const r = await fetch(u, {
      headers: {
        "user-agent": "Mozilla/5.0 (gotnodes.xyz; +https://gotnodes.xyz)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...(LLAMA_KEY ? { "x-llama-key-present": "1" } : {}),
      },
    });
    if (!r.ok) throw new Error(`upstream_bad_status_${r.status}`);
    return r.text();
  };

  let html;
  try {
    html = await tryFetch("https://www.avax.network/build/validators");
  } catch (e1) {
    html = await tryFetch("https://avascan.info/stats/staking");
  }

  // Validators (best-effort across both pages)
  const validators =
    pickNumber(html, /staking validators[^0-9]*([0-9,]+)/i) ??
    pickNumber(html, /Total Validators[^0-9]*([0-9,]+)/i) ??
    pickNumber(html, /Validators[^0-9]*([0-9,]+)/i);

  // Total staked (best-effort across both pages)
  const totalStakeFromAvascan =
    pickText(html, /(Total Stake|Total Staked)[^0-9]*([0-9.,]+)\s*AVAX/i);

  const totalStake =
    (pickText(html, /Total Stake[\s\S]*?([0-9,]{3,})/i)
      ? `${pickText(html, /Total Stake[\s\S]*?([0-9,]{3,})/i)} AVAX`
      : null) ??
    (pickText(html, /validation stake[\s\S]*?([0-9,]{3,})/i)
      ? `${pickText(html, /validation stake[\s\S]*?([0-9,]{3,})/i)} AVAX`
      : null) ??
    (totalStakeFromAvascan ? clean(totalStakeFromAvascan) : null);

  // APR (not always present)
  const apr =
    pickNumber(html, /Annual Percentage Yield[^0-9]*([0-9.]+)\s*%/i) ??
    pickNumber(html, /(Staking Rewards|Rewards|APR)[^0-9]*([0-9.]+)\s*%/i);

  return {
    chain: "avalanche",
    activeValidators: validators ?? null,
    totalStaked: totalStake ? clean(totalStake) : null,
    apr: (apr ?? null),
    entryQueue: "—",
    exitQueue: "—",
    churnLimit: "—",
    updatedAt: Date.now(),
  };
}

function pickText(src, re) {
  const m = src.match(re);
  if (!m) return null;
  // return the first non-empty capture group (supports 1 or 2 groups)
  return String(m[2] ?? m[1] ?? "").trim();
}

function pickNumber(src, re) {
  const m = src.match(re);
  if (!m) return null;
  const raw = String(m[2] ?? m[1] ?? "").replace(/,/g, "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}
