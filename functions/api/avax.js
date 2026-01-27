async function handler({ request, env }) {
  const key = env.GLACIER_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "Missing GLACIER_API_KEY env var" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let nodeIds = [];
  if (request.method === "GET") {
    const url = new URL(request.url);
    const ids = url.searchParams.get("nodeIds") || "";
    nodeIds = ids.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    const body = await request.json().catch(() => ({}));
    nodeIds = Array.isArray(body.nodeIds) ? body.nodeIds : [];
  }

  const network = "mainnet";
  const url = new URL(`https://glacier-api.avax.network/v1/networks/${network}/validators`);
  if (nodeIds.length) url.searchParams.set("nodeIds", nodeIds.join(","));
  url.searchParams.set("pageSize", String(Math.min(100, Math.max(1, nodeIds.length || 10))));

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "x-glacier-api-key": key,
    },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: "glacier validators failed", detail: t }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const json = await res.json();

  const nAvaxToAvax = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return null;
    return n / 1e9;
  };

  const out = (json?.validators || []).slice(0, 4).map((v) => {
    const staked = nAvaxToAvax(v?.amountStaked);
    const delegated = nAvaxToAvax(v?.amountDelegated);
    const valReward = nAvaxToAvax(v?.rewards?.validationRewardAmount);
    const delReward = nAvaxToAvax(v?.rewards?.delegationRewardAmount);

    return {
      nodeId: v?.nodeId ?? null,
      validationStatus: v?.validationStatus ?? null,
      amountStakedAvax: staked === null ? "—" : staked.toFixed(2),
      amountDelegatedAvax: delegated === null ? "—" : delegated.toFixed(2),
      delegatorCount: v?.delegatorCount ?? "—",
      delegationFeePct: v?.delegationFee ?? "—",
      validationRewardAvax: valReward === null ? "—" : valReward.toFixed(4),
      delegationRewardAvax: delReward === null ? "—" : delReward.toFixed(4),
    };
  });

  return new Response(JSON.stringify({ validators: out }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  const { request } = context;

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
