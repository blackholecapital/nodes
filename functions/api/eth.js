/**
 * /api/eth
 *
 * Fetch Ethereum validator data by VALIDATOR PUBLIC KEY (0x…).
 *
 * POST JSON:
 *   {
 *     "pubkeys": ["0xabc...", ...],
 *     "includeBalanceSeries": true|false
 *   }
 *
 * Source: beaconcha.in v1
 * Optional env:
 *   BEACONCHA_IN_API_KEY (Bearer token)
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizePubkey(x) {
  const s = String(x || "").trim();
  if (!s) return null;
  if (!s.startsWith("0x")) return null;
  if (s.length < 10) return null;
  return s;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function gweiToEth(x) {
  const n = toNum(x);
  if (n == null) return null;
  return n / 1e9;
}

function fmtEth(x, digits = 5) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

async function readBody(request) {
  const body = await request.json().catch(() => ({}));
  const pubkeys = Array.isArray(body.pubkeys) ? body.pubkeys : [];
  const includeBalanceSeries = Boolean(body.includeBalanceSeries);
  return {
    pubkeys: pubkeys.map(sanitizePubkey).filter(Boolean),
    includeBalanceSeries,
  };
}

async function fetchV1Validator({ key, pubkey }) {
  const headers = {
    accept: "application/json",
    "User-Agent": "GotNodes/1.0",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const url = `https://beaconcha.in/api/v1/validator/${encodeURIComponent(pubkey)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`validator fetch failed: ${res.status} ${t}`.trim());
  }

  const j = await res.json().catch(() => ({}));
  const data = Array.isArray(j?.data) ? j.data[0] : j?.data;
  return data || null;
}

async function fetchV1BalanceSeries({ key, pubkey }) {
  const headers = {
    accept: "application/json",
    "User-Agent": "GotNodes/1.0",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const url = `https://beaconcha.in/api/v1/validator/${encodeURIComponent(pubkey)}/balance`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`balance fetch failed: ${res.status} ${t}`.trim());
  }

  const j = await res.json().catch(() => ({}));
  const rows = Array.isArray(j?.data) ? j.data : [];

  const parsed = rows.map(r => {
    const bal = r?.balance ?? r?.balance_gwei ?? r?.balanceGwei ?? null;
    const ts = toNum(r?.timestamp ?? r?.ts ?? r?.time ?? null) ?? 0;
    return { ts, balEth: gweiToEth(bal) };
  }).filter(x => x.balEth != null);

  parsed.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return parsed.slice(-30).map(x => x.balEth);
}

function mapValidator(v1, pubkey, series) {
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

  if (Array.isArray(series) && series.length) {
    out.balanceSeriesEth = series.map(Number).filter(Number.isFinite);
  }

  return out;
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method !== "POST") {
      return json({ error: "POST only" }, 405);
    }

    const key = env.BEACONCHA_IN_API_KEY || "";
    const { pubkeys, includeBalanceSeries } = await readBody(request);

    if (!pubkeys.length) {
      return json({ validators: [], ts: Date.now() }, 200);
    }

    const limited = pubkeys.slice(0, 50);

    const validators = await Promise.all(limited.map(async (pk) => {
      try {
        const v1 = await fetchV1Validator({ key, pubkey: pk });
        let series = null;
        if (includeBalanceSeries) {
          try {
            series = await fetchV1BalanceSeries({ key, pubkey: pk });
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
    }));

    return json({ validators, ts: Date.now() }, 200);
  } catch (e) {
    return json({ error: "eth function crashed", detail: String(e?.message || e) }, 502);
  }
}
