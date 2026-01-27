async function handler({ request, env }) {
  const key = env.BEACONCHA_IN_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing BEACONCHA_IN_API_KEY env var" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let validators = [];
  let window = "30d";

  if (request.method === "GET") {
    const url = new URL(request.url);
    const v = url.searchParams.get("validators") || "";
    window = url.searchParams.get("window") || "30d";
    validators = v.split(",").map(x => x.trim()).filter(Boolean).map(x => Number(x)).filter(n => Number.isInteger(n));
  } else {
    const body = await request.json().catch(() => ({}));
    validators = Array.isArray(body.validators) ? body.validators : [];
    window = body.window || "30d";
  }

  const base = "https://beaconcha.in";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const overviewReq = fetch(`${base}/api/v2/ethereum/validators`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chain: "mainnet",
      page_size: Math.min(50, Math.max(1, validators.length || 1)),
      cursor: "",
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
    return new Response(JSON.stringify({ error: "beaconcha validators failed", detail: t }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!apyRes.ok) {
    const t = await apyRes.text().catch(() => "");
    return new Response(JSON.stringify({ error: "beaconcha apy-roi failed", detail: t }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const overviewJson = await overviewRes.json();
  const apyJson = await apyRes.json();

  // common in beacon APIs: balances in Gwei (if yours look off by 1e9, tell me)
  const gweiToEth = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return null;
    return n / 1e9;
  };

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
      balanceEth: balEth === null ? "—" : balEth.toFixed(5),
      effectiveBalanceEth: effEth === null ? "—" : effEth.toFixed(5),
      apy30d: apyTotal === null ? "—" : `${Number(apyTotal).toFixed(2)}%`,
      roi30d: roiTotal === null ? "—" : `${Number(roiTotal).toFixed(2)}%`,
      finality: finality ?? "—",
    };
  });

  return new Response(JSON.stringify({ validators: out }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  const { request } = context;

  // allow preflight (some browsers/extensions will trigger it)
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

  const res = await handler(context);
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
