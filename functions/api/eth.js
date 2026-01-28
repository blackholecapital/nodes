/**
 * /api/eth
 *
 * Beaconcha.in has multiple API surfaces and (depending on plan) some v2 "selector" types
 * are restricted. Your error:
 *   "validator selector type not allowed for your subscription tier"
 *
 * This function:
 *  1) Tries the v2 batch endpoints (fast, richer).
 *  2) If Beaconcha rejects the selector type (or other auth/plan issues), falls back to
 *     per-validator v1 calls that work on more tiers.
 *
 * Output shape stays stable for the frontend.
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

function isSelectorTierError(text = "") {
  const t = String(text).toLowerCase();
  return t.includes("validator selector type not allowed") ||
         t.includes("subscription tier") ||
         t.includes("upgrade your subscription");
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

async function readBody(request) {
  let validators = [];
  let window = "30d";

  if (request.method === "GET") {
    const url = new URL(request.url);
    const v = url.searchParams.get("validators") || "";
    window = url.searchParams.get("window") || "30d";
    validators = v
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => Number(x))
      .filter(n => Number.isInteger(n));
  } else {
    const body = await request.json().catch(() => ({}));
    validators = Array.isArray(body.validators) ? body.validators : [];
    window = body.window || "30d";
  }

  // clamp / sanitize
  validators = validators
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n >= 0);

  return { validators, window };
}

async function tryV2({ key, validators, window }) {
  const base = "https://beaconcha.in";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "User-Agent": "GotNodes/1.0 (validators dashboard)",
  };

  const overviewReq = fetch(`${base}/api/v2/ethereum/validators`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chain: "mainnet",
      page_size: Math.min(50, Math.max(1, validators.length || 1)),
      cursor: "",
      // This selector is what some tiers reject.
      validator: { validator_identifiers: validators },
    }),
  });

  const apyReq = fetch(`${base}/api/v2/ethereum/validators/apy-roi`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chain: "mainnet",
      validator: { validator_identifiers: validators },
      range: { evaluation_window: window },
    }),
  });

  const [overviewRes, apyRes] = await Promise.all([overviewReq, apyReq]);

  if (!overviewRes.ok) {
    const t = await overviewRes.text().catch(() => "");
    return { ok: false, why: "overview", text: t, status: overviewRes.status };
  }
  if (!apyRes.ok) {
    const t = await apyRes.text().catch(() => "");
    return { ok: false, why: "apy", text: t, status: apyRes.status };
  }

  const overviewJson = await overviewRes.json();
  const apyJson = await apyRes.json();

  const apyTotal = apyJson?.data?.combined?.apy?.total ?? null;
  const roiTotal = apyJson?.data?.combined?.roi?.total ?? null;
  const finality = apyJson?.data?.finality ?? null;

  const out = (overviewJson?.data || []).map((v) => {
    const idx = v?.validator?.index ?? null;
    const balCur = v?.balances?.current ?? null;
    const balEff = v?.balances?.effective ?? null;

    const balEth = gweiToEth(balCur);
    const effEth = gweiToEth(balEff);

    return {
      validatorId: idx,
      status: v?.status ?? null,
      online: v?.online ?? null,
      balanceEth: balEth === null ? "—" : fmtEth(balEth),
      effectiveBalanceEth: effEth === null ? "—" : fmtEth(effEth),
      apy30d: apyTotal === null ? "—" : `${Number(apyTotal).toFixed(2)}%`,
      roi30d: roiTotal === null ? "—" : `${Number(roiTotal).toFixed(2)}%`,
      finality: finality ?? "—",
    };
  });

  return { ok: true, validators: out };
}

async function v1Validator({ base, headers, index }) {
  // v1 paths are plan-friendly; we keep the dependency surface small.
  // Response shapes vary a bit, so we defensive-parse.
  const url = `${base}/api/v1/validator/${index}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`beaconcha v1 validator ${index} failed: ${res.status} ${t}`);
  }
  return res.json();
}

async function v1Balances({ base, headers, index }) {
  // Optional: some tiers allow this, others might not. We'll ignore failure.
  const url = `${base}/api/v1/validator/${index}/balance`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function fallbackV1({ key, validators }) {
  const base = "https://beaconcha.in";
  const headers = {
    // v1 often works without auth, but keep bearer if you have it.
    Authorization: key ? `Bearer ${key}` : undefined,
    "User-Agent": "GotNodes/1.0 (validators dashboard)",
  };
  // remove undefined header values
  Object.keys(headers).forEach(k => headers[k] === undefined && delete headers[k]);

  const out = await Promise.all(
    validators.slice(0, 50).map(async (index) => {
      const v = await v1Validator({ base, headers, index });
      const bal = await v1Balances({ base, headers, index });

      // v1 "status" can be string or number; we keep it raw-ish.
      const status = v?.data?.status ?? v?.status ?? v?.data?.state ?? "unknown";
      const idx = v?.data?.validatorindex ?? v?.data?.index ?? v?.validatorindex ?? index;

      // balances: try to find the newest balance snapshot
      let balanceEth = "—";
      let effectiveBalanceEth = "—";

      const balRow = Array.isArray(bal?.data) ? bal.data[0] : null;
      // Many beacon APIs use gwei.
      const b1 = balRow?.balance ?? v?.data?.balance ?? null;
      const eb1 = v?.data?.effectivebalance ?? v?.data?.effective_balance ?? null;

      const be = gweiToEth(b1);
      const ebe = gweiToEth(eb1);

      if (be !== null) balanceEth = fmtEth(be);
      if (ebe !== null) effectiveBalanceEth = fmtEth(ebe);

      return {
        validatorId: idx,
        status,
        online: null, // v1 doesn't reliably expose online; UI will show status pill.
        balanceEth,
        effectiveBalanceEth,
        apy30d: "—",
        roi30d: "—",
        finality: "—",
      };
    })
  );

  return out;
}

async function handler({ request, env }) {
  const key = env.BEACONCHA_IN_API_KEY || "";
  const { validators, window } = await readBody(request);

  if (!validators.length) {
    return json({ validators: [] }, 200);
  }

  // Try v2 first (best data).
  const v2 = await tryV2({ key, validators, window });
  if (v2.ok) {
    return json({ validators: v2.validators });
  }

  // If v2 fails due to plan/tier selector limits, fall back to v1.
  const failText = v2?.text || "";
  if (isSelectorTierError(failText)) {
    const v1 = await fallbackV1({ key, validators });
    return json({
      validators: v1,
      note: "Beaconcha v2 selector restricted on this API plan. Served via v1 fallback (no APY/ROI).",
    });
  }

  // Any other failure: forward a clean error.
  return json(
    { error: "beaconcha request failed", detail: failText, where: v2?.why || "unknown" },
    502
  );
}

export async function onRequest(context) {
  const { request } = context;

  // allow preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const res = await handler(context);
    res.headers.set("Access-Control-Allow-Origin", "*");
    return res;
  } catch (e) {
    // Prevent Cloudflare's HTML 502 page from leaking into the UI.
    return json({ error: "eth function crashed", detail: String(e?.message || e) }, 502, {
      "Access-Control-Allow-Origin": "*",
    });
  }
}
