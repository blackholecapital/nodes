/**
 * /api/eth
 *
 * Fetch Ethereum validator data by VALIDATOR PUBLIC KEY (0x…).
 *
 * Input (POST JSON):
 *   {
 *     "pubkeys": ["0xabc...", ...],
 *     "includeBalanceSeries": true|false
 *   }
 *
 * Output:
 *   { validators: [{ pubkey, validatorId, status, online, balanceEth, effectiveBalanceEth, balanceSeriesEth? }], ts }
 *
 * Data source: beaconcha.in v1 API (works on more tiers than some v2 selectors).
 * If env.BEACONCHA_IN_API_KEY exists, it will be used as Authorization Bearer header.
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

function gweiToEth(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return n / 1e9;
}

function fmtEth(x, digits = 5) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function sanitizePubkey(x) {
  const s = String(x || "").trim();
  if (!s) return null;
  if (!s.startsWith("0x")) return null;
  if (s.length < 10) return null;
  return s;
}

async function readBody(request) {
  let pubkeys = [];
  let includeBalanceSeries = false;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const v = url.searchParams.get("pubkeys") || "";
    includeBalanceSeries = (url.searchParams.get("includeBalanceSeries") || "") === "true";
    pubkeys = v.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    const body = await request.json().catch(() => ({}));
    pubkeys = Array.isArray(body.pubkeys) ? body.pubkeys : [];
    includeBalanceSeries = Boolean(body.includeBalanceSeries);
  }

  pubkeys = pubkeys
    .map(sanitizePubkey)
    .filter(Boolean);

  return { pubkeys, includeBalanceSeries };
}

async function fetchV1({ key, pubkey }) {
  const base = "https://beaconcha.in";
  const headers = {
    "accept": "application/json",
    "User-Agent": "GotNodes/1.0 (validators dashboard)",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const url = `${base}/api/v1/validator/${encodeURIComponent(pubkey)}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`beaconcha validator failed: ${res.status} ${res.statusText} ${t}`.trim());
  }

  const j = await res.json().catch(() => ({}));
  // beaconcha v1 commonly returns { status: "OK", data: [...] } (sometimes data object)
  const data = Array.isArray(j?.data) ? j.data[0] : (j?.data || null);
  return data;
}

async function fetchBalanceSeriesV1({ key, pubkey }) {
  const base = "https://beaconcha.in";
  const headers = {
    "accept": "application/json",
    "User-Agent": "GotNodes/1.0 (validators dashboard)",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const url = `${base}/api/v1/validator/${encodeURIComponent(pubkey)}/balance`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`beaconcha balance failed: ${res.status} ${res.statusText} ${t}`.trim());
  }

  const j = await res.json().catch(() => ({}));
  const rows = Array.isArray(j?.data) ? j.data : [];

  // rows are usually newest-first or oldest-first depending on endpoint; we just take last 30 by time
  const parsed = rows
    .map(r => {
      // known fields often include balance (gwei) and effectivebalance (gwei)
      const bal = r?.balance ?? r?.balance_gwei ?? r?.balanceWei ?? r?.balancewei ?? null;
      const eff = r?.effectivebalance ?? r?.effective_balance ?? r?.effectiveBalance ?? null;
      const ts = Number(r?.timestamp ?? r?.ts ?? r?.time ?? r?.day ?? 0);
      return {
        ts: Number.isFinite(ts) ? ts : 0,
        balEth: gweiToEth(bal),
        effEth: gweiToEth(eff),
      };
    })
    .filter(x => x.balEth != null);

  // sort by ts if present
  parsed.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  const balSeries = parsed.slice(-30).map(x => x.balEth);
  const effSeries = parsed.slice(-30).map(x => x.effEth).filter(v => v != null);

  return { balSeries, effSeries };
}

function mapValidator(v1, pubkey, balanceSeries) {
  // Beaconcha field names vary. Try common ones.
  const idx =
    v1?.validatorindex ??
    v1?.validatorIndex ??
    v1?.index ??
    v1?.validator_id ??
    null;

  const status =
    v1?.status ??
    v1?.state ??
    v1?.validatorstatus ??
    null;

  // Online is not always present in v1; if missing we leave null.
  const online =
    typeof v1?.online === "boolean" ? v1.online :
    (typeof v1?.is_online === "boolean" ? v1.is_online : null);

  const balEth = gweiToEth(
    v1?.balance ??
    v1?.balance_gwei ??
    v1?.currentbalance ??
    v1?.current_balance ??
    null
  );

  const effEth = gweiToEth(
    v1?.effectivebalance ??
    v1?.effective_balance ??
    v1?.effectiveBalance ??
    null
  );

  const out = {
    pubkey: v1?.pubkey || pubkey,
    validatorId: idx,
    status,
    online,
    balanceEth: balEth == null ? "—" : fmtEth(balEth),
    effectiveBalanceEth: effEth == null ? "—" : fmtEth(effEth),
    updated: new Date().toLocaleString(),
  };

  if (balanceSeries?.balSeries?.length) {
    out.balanceSeriesEth = balanceSeries.balSeries.map(n => Number(n)).filter(Number.isFinite);
  }

  return out;
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const key = env.BEACONCHA_IN_API_KEY || "";
    const { pubkeys, includeBalanceSeries } = await readBody(request);

    if (!pubkeys.length) {
      return json({ validators: [], ts: Date.now() }, 200);
    }

    const limited = pubkeys.slice(0, 50);

    const tasks = limited.map(async (pk) => {
      try {
        const v1 = await fetchV1({ key, pubkey: pk });
        let series = null;
        if (includeBalanceSeries) {
          try {
            series = await fetchBalanceSeriesV1({ key, pubkey: pk });
          } catch {
            series = null;
          }
        }
        return mapValidator(v1, pk, series);
      } catch (e) {
        return {
          pubkey: pk,
          validatorId: null,
          status: "error",
          online: null,
          balanceEth: "—",
          effectiveBalanceEth: "—",
          updated: new Date().toLocaleString(),
          error: String(e?.message || e),
        };
      }
    });

    const validators = await Promise.all(tasks);

    return json({ validators, ts: Date.now() }, 200);
  } catch (e) {
    return json({ error: "eth function crashed", detail: String(e?.message || e) }, 502);
  }
}
