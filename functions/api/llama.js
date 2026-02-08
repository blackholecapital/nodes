export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const chain = (url.searchParams.get("chain") || "").toLowerCase();

  if (!chain || (chain !== "ethereum" && chain !== "avalanche")) {
    return json({ error: "missing_or_invalid_chain" }, 400);
  }

  // NOTE: DefiLlama Pro docs authenticate by placing the key in the URL path,
  // and do not document validator/queue endpoints. We keep this here only
  // because you store it as VITE_LLAMA_API_KEY.
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
 * ETH source: validatorqueue.com (public dashboard with the exact metrics you want)
 * We parse:
 * - Active Validators
 * - Staked ETH
 * - APR
 * - Entry Queue (ETH + wait)
 * - Exit Queue (ETH + wait)
 * - Churn (e.g. "256/epoch")
 */
async function getEthereumValidatorStats({ LLAMA_KEY } = {}) {
  const res = await fetch("https://validatorqueue.com/", {
    headers: {
      "user-agent": "Mozilla/5.0 (gotnodes.xyz; +https://gotnodes.xyz)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      // Some hosts behave better if an auth header exists; harmless if ignored.
      ...(LLAMA_KEY ? { "x-llama-key-present": "1" } : {}),
    },
  });
  if (!res.ok) throw new Error(`validatorqueue_bad_status_${res.status}`);
  const html = await res.text();

  const activeValidators = pickNumber(html, /Active Validators:\s*<\/[^>]+>\s*([0-9,]+)/i)
    ?? pickNumber(html, /Active Validators:\s*([0-9,]+)/i);

  const stakedEth = pickText(html, /Staked ETH:\s*<\/[^>]+>\s*([0-9.,]+M)/i)
    ?? pickText(html, /Staked ETH:\s*([0-9.,]+M)/i);

  const apr = pickNumber(html, /APR:\s*<\/[^>]+>\s*([0-9.]+)%/i)
    ?? pickNumber(html, /APR:\s*([0-9.]+)%/i);

  const entryEth = pickText(html, /Entry Queue[\s\S]*?ETH:\s*<\/[^>]+>\s*([0-9,]+)/i)
    ?? pickText(html, /Entry Queue[\s\S]*?ETH:\s*([0-9,]+)/i);

  const entryWait = pickText(html, /Entry Queue[\s\S]*?Wait:\s*<\/[^>]+>\s*([^<\n\r]+)/i)
    ?? pickText(html, /Entry Queue[\s\S]*?Wait:\s*([^<\n\r]+)/i);

  const exitEth = pickText(html, /Exit Queue[\s\S]*?ETH:\s*<\/[^>]+>\s*([0-9,]+)/i)
    ?? pickText(html, /Exit Queue[\s\S]*?ETH:\s*([0-9,]+)/i);

  const exitWait = pickText(html, /Exit Queue[\s\S]*?Wait:\s*<\/[^>]+>\s*([^<\n\r]+)/i)
    ?? pickText(html, /Exit Queue[\s\S]*?Wait:\s*([^<\n\r]+)/i);

  const churn = pickText(html, /Churn:\s*<\/[^>]+>\s*([^<\n\r]+)/i)
    ?? pickText(html, /Churn:\s*([^<\n\r]+)/i);

  return {
    chain: "ethereum",
    activeValidators: activeValidators ?? null,
    totalStaked: stakedEth ? `${stakedEth} ETH` : null,
    apr: (apr ?? null),
    entryQueue: entryEth && entryWait ? `${entryEth} ETH • ${clean(entryWait)}` : (entryEth ? `${entryEth} ETH` : null),
    exitQueue: exitEth && exitWait ? `${exitEth} ETH • ${clean(exitWait)}` : (exitEth ? `${exitEth} ETH` : null),
    churnLimit: churn ? clean(churn) : null,
    updatedAt: Date.now(),
  };
}

/**
 * AVAX source: avascan staking stats page (public)
 * We parse best-effort:
 * - Validators count
 * - Total stake
 * - Reward/APR-ish (if present)
 *
 * Note: Avalanche doesn’t have ETH-style entry/exit queues; we keep those as "—"
 * and churnLimit as "—" unless present.
 */
async function getAvalancheValidatorStats({ LLAMA_KEY } = {}) {
  // Prefer official avax.network validators page (tends to be more stable than scrapers)
  let html = null;

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

  try {
    html = await tryFetch("https://www.avax.network/build/validators");
  } catch (e1) {
    // fallback
    html = await tryFetch("https://avascan.info/stats/staking");
  }

  // APR is not always displayed; keep null if not found.
  const apr = pickNumber(html, /(Staking Rewards|Rewards|APR)[^0-9]*([0-9.]+)\s*%/i);

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
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}

function pickNumber(src, re) {
  const m = src.match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "").trim();
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}
