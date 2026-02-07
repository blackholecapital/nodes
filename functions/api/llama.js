/**
 * /api/llama?chain=Ethereum|Avalanche
 *
 * DefiLlama Pro API proxy (key kept server-side).
 * Auth: https://pro-api.llama.fi/{API_KEY}/{endpoint}
 *
 * Env:
 *  - VITE_LLAMA_API_KEY (preferred)
 *  - LLAMA_API_KEY (fallback)
 */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pickVals(hist) {
  // pro endpoint commonly returns an array of { date, tvl } or similar
  const rows = Array.isArray(hist) ? hist : (Array.isArray(hist?.data) ? hist.data : []);
  const vals = [];
  for (const r of rows) {
    const v = toNum(r?.tvl ?? r?.value ?? r?.totalLiquidityUSD);
    if (v != null) vals.push(v);
  }
  return vals;
}

function pctChange(a, b) {
  const x = toNum(a);
  const y = toNum(b);
  if (x == null || y == null || y === 0) return null;
  return ((x - y) / y) * 100;
}

async function proFetch({ key, path, cache, ttl = 60 }) {
  const url = `https://pro-api.llama.fi/${encodeURIComponent(key)}${path.startsWith("/") ? "" : "/"}${path}`;
  const cacheKey = new Request(url, { method: "GET" });

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();
  }

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DefiLlama failed ${res.status}: ${text}`.trim());
  }
  const data = await res.json();

  if (cache) {
    const cached = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttl}`,
      },
    });
    await cache.put(cacheKey, cached);
  }
  return data;
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const key = env.VITE_LLAMA_API_KEY || env.LLAMA_API_KEY;
    if (!key) return json({ error: "Missing VITE_LLAMA_API_KEY" }, 500);

    const url = new URL(request.url);
    const chain = url.searchParams.get("chain") || "Ethereum";

    const cache = caches?.default;

    // Historical chain TVL (v2 path)
    const hist = await proFetch({
      key,
      path: `/api/v2/historicalChainTvl/${encodeURIComponent(chain)}`,
      cache,
      ttl: 120,
    });

    const vals = pickVals(hist);
    const tvl30d = vals.slice(-30);
    const current = tvl30d.length ? tvl30d[tvl30d.length - 1] : (vals.length ? vals[vals.length - 1] : null);

    // changes
    const idx7 = tvl30d.length >= 8 ? tvl30d.length - 8 : null;   // 7 days back
    const idx30 = tvl30d.length >= 30 ? 0 : null;

    const change7dPct = idx7 != null ? pctChange(current, tvl30d[idx7]) : null;
    const change30dPct = idx30 != null ? pctChange(current, tvl30d[idx30]) : null;

    return json({
      chain,
      tvl: {
        current,
        change7dPct,
        change30dPct,
      },
      series: {
        tvl30d,
      },
      updated: new Date().toLocaleString(),
      ts: Date.now(),
    }, 200);
  } catch (e) {
    return json({ error: "llama function crashed", detail: String(e?.message || e) }, 502);
  }
}
