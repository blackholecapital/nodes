/**
 * /api/llama
 *
 * DefiLlama Pro API proxy (key kept server-side).
 * Auth model (per DefiLlama docs): key is inserted in the URL path:
 *   https://pro-api.llama.fi/{API_KEY}/{endpoint}
 *
 * Env var:
 *   - VITE_LLAMA_API_KEY (preferred, per your note)
 *   - LLAMA_API_KEY (fallback)
 */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pick30dSeries(arr, valueKey) {
  const xs = Array.isArray(arr) ? arr : [];
  const vals = [];
  for (const it of xs.slice(-30)) {
    const v = valueKey ? it?.[valueKey] : (it?.tvl ?? it?.totalLiquidityUSD ?? it?.value ?? it?.fees ?? it?.revenue);
    const n = toNum(v);
    if (n != null) vals.push(n);
  }
  return vals;
}

async function proGet({ key, path, cache, cacheTtl = 60 }) {
  const url = `https://pro-api.llama.fi/${encodeURIComponent(key)}${path.startsWith("/") ? "" : "/"}${path}`;

  const cacheKey = new Request(url, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();
  }

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DefiLlama ${path} failed: ${res.status} ${res.statusText} ${text}`.trim());
  }

  const data = await res.json();

  if (cache) {
    const cached = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${cacheTtl}`,
      },
    });
    await cache.put(cacheKey, cached);
  }

  return data;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    const key = env.VITE_LLAMA_API_KEY || env.LLAMA_API_KEY;
    if (!key) {
      return json({ error: "Missing VITE_LLAMA_API_KEY env var" }, 500, {
        "Access-Control-Allow-Origin": "*",
      });
    }

    const url = new URL(request.url);
    const chain = url.searchParams.get("chain") || "Ethereum";
    const cache = caches?.default;

    // Chain TVL history
    const hist = await proGet({
      key,
      path: `/api/v2/historicalChainTvl/${encodeURIComponent(chain)}`,
      cache,
      cacheTtl: 120,
    });

    const tvlSeries = pick30dSeries(hist, "tvl");
    const tvlCurrent = tvlSeries.length ? tvlSeries[tvlSeries.length - 1] : null;

    // Fees overview (may include charts)
    let fees = null;
    let feesSeries = [];
    try {
      const feesRaw = await proGet({
        key,
        path: `/api/overview/fees/${encodeURIComponent(chain)}`,
        cache,
        cacheTtl: 120,
      });

      fees = {
        totalFees24h: toNum(feesRaw?.totalFees24h ?? feesRaw?.fees24h),
        totalRevenue24h: toNum(feesRaw?.totalRevenue24h ?? feesRaw?.revenue24h),
        change_1d: toNum(feesRaw?.change_1d),
      };

      const tdc = feesRaw?.totalDataChart;
      if (Array.isArray(tdc)) {
        feesSeries = tdc
          .slice(-30)
          .map(row => toNum(Array.isArray(row) ? row[1] : null))
          .filter(n => n != null);
      }
    } catch {
      fees = null;
      feesSeries = [];
    }

    // Stablecoin dominance
    let stable = null;
    try {
      const st = await proGet({
        key,
        path: `/stablecoins/stablecoindominance/${encodeURIComponent(chain)}`,
        cache,
        cacheTtl: 300,
      });
      stable = {
        dominance: toNum(st?.dominance),
        totalCirculating: toNum(st?.totalCirculating),
        largestStablecoin: st?.largestStablecoin ? {
          name: String(st.largestStablecoin.name || ""),
          symbol: String(st.largestStablecoin.symbol || ""),
          circulating: toNum(st.largestStablecoin.circulating),
          dominance: toNum(st.largestStablecoin.dominance),
        } : null,
      };
    } catch {
      stable = null;
    }

    const payload = {
      chain,
      tvl: { current: tvlCurrent },
      fees,
      stablecoins: stable,
      series: {
        tvl30d: tvlSeries,
        fees30d: feesSeries,
      },
      ts: Date.now(),
    };

    return json(payload, 200, { "Access-Control-Allow-Origin": "*" });
  } catch (e) {
    return json({ error: "llama function crashed", detail: String(e?.message || e) }, 502, {
      "Access-Control-Allow-Origin": "*",
    });
  }
}
