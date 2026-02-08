export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const chain = (url.searchParams.get("chain") || "").toLowerCase();

  if (!chain || (chain !== "ethereum" && chain !== "avalanche")) {
    return json({ error: "missing_or_invalid_chain" }, 400);
  }

  try {
    if (chain === "ethereum") {
      const data = await getEthereumValidatorStats();
      return json(data, 200);
    }

    const data = await getAvalancheValidatorStats();
    return json(data, 200);

  } catch (e) {
    return json({ error: "upstream_failed" }, 502);
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
async function getEthereumValidatorStats() {
  const res = await fetch("https://validatorqueue.com/", {
    headers: { "user-agent": "gotnodes/1.0" },
  });
  if (!res.ok) throw new Error("validatorqueue_bad_status");
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
async function getAvalancheValidatorStats() {
  const res = await fetch("https://avascan.info/stats/staking", {
    headers: { "user-agent": "gotnodes/1.0" },
  });
  if (!res.ok) throw new Error("avascan_bad_status");
  const html = await res.text();

  // These selectors are best-effort because the site is not an API.
  const validators = pickNumber(html, /Validators[^0-9]*([0-9,]+)/i);
  const totalStake = pickText(html, /(Total Stake|Total Staked)[^0-9]*([0-9.,]+)\s*AVAX/i)?.match(/([0-9.,]+)\s*AVAX/i)?.[0]
    ?? pickText(html, /([0-9.,]+)\s*AVAX[\s\S]*?(Total Stake|Total Staked)/i);

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
