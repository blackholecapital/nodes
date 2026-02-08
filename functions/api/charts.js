export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const chain = (url.searchParams.get("chain") || "").toLowerCase();

  if (!chain || (chain !== "ethereum" && chain !== "avalanche")) {
    return json({ error: "missing_or_invalid_chain" }, 400);
  }

  const LLAMA_KEY = env?.VITE_LLAMA_API_KEY || null;

  try {
    const out = await getChainCharts({ chain, LLAMA_KEY });
    return json(out, 200);
  } catch (e) {
    return json(
      { error: "upstream_failed", message: String(e?.message || e) },
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
    accept: "application/json,text/plain;q=0.9,*/*;q=0.1",
    "user-agent": "gotnodes/1.0 (+https://gotnodes.xyz)",
  };
}

async function getChainCharts({ chain, LLAMA_KEY }) {
  const chainName = chain === "ethereum" ? "Ethereum" : "Avalanche";

  const [tvlSeries, volSeries] = await Promise.all([
    fetchChainTvl({ chainName, LLAMA_KEY }),
    fetchDexVolumeSeries({ chain, LLAMA_KEY }),
  ]);

  const tvl = tail(tvlSeries, 180);
  const candles = toWeeklyCandles(tail(volSeries, 180));

  return {
    chain,
    tvl,
    volumeWeekly: candles,
    updatedAt: Date.now(),
    source: {
      tvl: "pro-api.llama.fi /api/v2/historicalChainTvl/{chain}",
      volume: "pro-api.llama.fi /overview/dexs/{chain} (fallback api.llama.fi)",
    },
  };
}

async function fetchChainTvl({ chainName, LLAMA_KEY }) {
  const headers = hdrs();

  // Pro endpoint (key in path) per DefiLlama docs.
  // https://pro-api.llama.fi/<KEY>/api/v2/historicalChainTvl/<Chain>
  const urls = [];
  if (LLAMA_KEY) {
    urls.push(
      `https://pro-api.llama.fi/${encodeURIComponent(
        LLAMA_KEY
      )}/api/v2/historicalChainTvl/${encodeURIComponent(chainName)}`
    );
  }
  // Fallback to open API (some deployments allow it without a key)
  urls.push(
    `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chainName)}`
  );

  let arr = null;
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      const j = await r.json();
      if (Array.isArray(j)) {
        arr = j;
        break;
      }
    } catch (_) {}
  }

  if (!arr) throw new Error("tvl_upstream_unavailable");

  // Normalize => [{ t: ms, v: number }]
  const out = [];
  for (const it of arr) {
    const dateSec = it?.date ?? it?.timestamp ?? null;
    const tvl = it?.tvl ?? it?.totalLiquidityUSD ?? it?.value ?? null;
    const t = toMs(dateSec);
    const v = toNum(tvl);
    if (t != null && v != null) out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function fetchDexVolumeSeries({ chain, LLAMA_KEY }) {
  const headers = hdrs();

  // API docs list /overview/dexs/{chain}. We'll try pro first, then open.
  const urls = [];
  if (LLAMA_KEY) {
    urls.push(
      `https://pro-api.llama.fi/${encodeURIComponent(
        LLAMA_KEY
      )}/overview/dexs/${encodeURIComponent(chain)}`
    );
  }
  urls.push(`https://api.llama.fi/overview/dexs/${encodeURIComponent(chain)}`);

  let j = null;
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      j = await r.json();
      if (j) break;
    } catch (_) {}
  }

  if (!j) throw new Error("volume_upstream_unavailable");

  // Find an array that looks like a date/value series.
  const series =
    pickSeries(j, ["totalDataChart", "totalDataChartBreakdown"]) ||
    pickSeries(j, ["chart", "chartData", "data", "volumeChart", "totalVolumeChart"]) ||
    null;

  if (!Array.isArray(series)) {
    throw new Error("volume_series_missing");
  }

  const out = [];
  for (const it of series) {
    const dateSec =
      it?.date ?? it?.timestamp ?? it?.time ?? it?.t ?? (Array.isArray(it) ? it[0] : null);
    const vol =
      it?.totalVolume ?? it?.volume ?? it?.value ?? it?.dailyVolume ?? it?.v ?? (Array.isArray(it) ? it[1] : null);

    const t = toMs(dateSec);
    const v = toNum(vol);
    if (t != null && v != null) out.push({ t, v });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

function pickSeries(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (Array.isArray(v) && v.length) return v;
    const v2 = obj?.data?.[k];
    if (Array.isArray(v2) && v2.length) return v2;
  }
  return null;
}

function toWeeklyCandles(points) {
  if (!Array.isArray(points) || !points.length) return [];
  // Group by ISO week start (Mon) at 00:00 UTC
  const buckets = new Map();
  for (const p of points) {
    const d = new Date(p.t);
    const utcDay = d.getUTCDay(); // 0 Sun ... 6 Sat
    const diffToMon = (utcDay + 6) % 7; // days since Monday
    const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMon);
    const key = String(mon);
    const arr = buckets.get(key) || [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const candles = [];
  const keys = [...buckets.keys()].map((k) => Number(k)).sort((a, b) => a - b);
  for (const k of keys) {
    const arr = buckets.get(String(k)) || [];
    arr.sort((a, b) => a.t - b.t);
    const open = arr[0]?.v ?? null;
    const close = arr[arr.length - 1]?.v ?? null;
    let high = -Infinity;
    let low = Infinity;
    for (const p of arr) {
      if (p.v > high) high = p.v;
      if (p.v < low) low = p.v;
    }
    if (open == null || close == null || !Number.isFinite(high) || !Number.isFinite(low)) continue;
    candles.push({ t: k, o: open, h: high, l: low, c: close });
  }
  return candles;
}

function toMs(secOrMs) {
  const n = toNum(secOrMs);
  if (n == null) return null;
  // heuristics: if it's in seconds (10 digits), convert
  if (n < 10_000_000_000) return Math.trunc(n * 1000);
  return Math.trunc(n);
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function tail(arr, n) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= n) return arr;
  return arr.slice(arr.length - n);
}
