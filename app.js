/**
 * GOT NODES
 *
 * - Right side: 2 DefiLlama TVL panels (ETH + AVAX) with charts
 * - Right side: ETH live validator by PUBLIC KEY (0x…)
 * - Main panels: ETH validators by pubkey, AVAX validators by NodeID
 */

const DEFAULT_ETH_VALIDATORS = []; // keep empty by default; user can paste keys in Edit Mode
const DEFAULT_AVAX_NODE_IDS = [];  // keep empty by default; user can paste NodeIDs in Edit Mode

const REFRESH_MS = 5 * 60 * 1000;     // main panels
const REFRESH_LABEL = "5:00";
const LLAMA_REFRESH_MS = 60 * 1000;   // TVL panels
const LIVE_REFRESH_MS = 10 * 1000;    // ETH pubkey live

const LS_KEYS = {
  eth: "gotnodes.eth.pubkeys",
  avax: "gotnodes.avax.nodeids",
  ethPk: "gotnodes.eth.live.pubkey",
};

const state = {
  eth: [...DEFAULT_ETH_VALIDATORS],
  avax: [...DEFAULT_AVAX_NODE_IDS],
  liveEthPubkey: null,
};

const el = {
  ethGrid: document.getElementById("ethGrid"),
  avaxGrid: document.getElementById("avaxGrid"),
  lastUpdate: document.getElementById("lastUpdate"),
  statusLine: document.getElementById("statusLine"),
  refreshEvery: document.getElementById("refreshEvery"),

  // edit mode
  toggleEdit: document.getElementById("toggleEdit"),
  editPanel: document.getElementById("editPanel"),
  ethInput: document.getElementById("ethInput"),
  avaxInput: document.getElementById("avaxInput"),
  saveApply: document.getElementById("saveApply"),
  resetDefaults: document.getElementById("resetDefaults"),
  editMsg: document.getElementById("editMsg"),

  // DefiLlama panels
  ethTvlStatus: document.getElementById("ethTvlStatus"),
  avaxTvlStatus: document.getElementById("avaxTvlStatus"),
  ethTvlMetrics: document.getElementById("ethTvlMetrics"),
  avaxTvlMetrics: document.getElementById("avaxTvlMetrics"),
  ethTvlChart: document.getElementById("ethTvlChart"),
  avaxTvlChart: document.getElementById("avaxTvlChart"),

  // ETH live-by-pubkey
  ethLiveStatus: document.getElementById("ethLiveStatus"),
  ethPkInput: document.getElementById("ethPkInput"),
  ethPkApply: document.getElementById("ethPkApply"),
  ethPkOut: document.getElementById("ethPkOut"),
  ethPkChart: document.getElementById("ethPkChart"),
};

if (el.refreshEvery) el.refreshEvery.textContent = REFRESH_LABEL;

function nowStamp() {
  return new Date().toLocaleString();
}

function shortId(s, keep = 10) {
  const x = String(s || "");
  if (x.length <= keep + 6) return x;
  return `${x.slice(0, keep)}…${x.slice(-4)}`;
}

function sanitizeEthPubkey(x) {
  const s = String(x || "").trim();
  if (!s) return null;
  if (!s.startsWith("0x")) return null;
  if (s.length < 10) return null;
  return s;
}

function parseEthPubkeys(raw) {
  const tokens = String(raw || "")
    .split(/[\n,]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  for (const t of tokens) {
    const k = sanitizeEthPubkey(t);
    if (k) out.push(k);
  }
  return out;
}

function parseAvaxNodeIds(raw) {
  const tokens = String(raw || "")
    .split(/[\n,]+/g)
    .map(s => s.trim())
    .filter(Boolean);
  return tokens.filter(t => t.startsWith("NodeID-"));
}

function loadFromLocalStorage() {
  try {
    const ethRaw = localStorage.getItem(LS_KEYS.eth);
    const avaxRaw = localStorage.getItem(LS_KEYS.avax);
    const ethPkRaw = localStorage.getItem(LS_KEYS.ethPk);

    if (ethRaw) {
      const ethList = JSON.parse(ethRaw);
      if (Array.isArray(ethList)) state.eth = ethList;
    }

    if (avaxRaw) {
      const avaxList = JSON.parse(avaxRaw);
      if (Array.isArray(avaxList)) state.avax = avaxList;
    }

    if (ethPkRaw) {
      const k = sanitizeEthPubkey(ethPkRaw);
      if (k) state.liveEthPubkey = k;
    }
  } catch (e) {
    console.warn("localStorage load failed:", e);
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEYS.eth, JSON.stringify(state.eth));
    localStorage.setItem(LS_KEYS.avax, JSON.stringify(state.avax));
    if (state.liveEthPubkey) localStorage.setItem(LS_KEYS.ethPk, String(state.liveEthPubkey));
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }
}

function postJSON(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${r.status} ${r.statusText} ${t}`.trim());
    }
    return r.json();
  });
}

function setText(node, txt) {
  if (node) node.textContent = txt;
}

function setHTML(node, html) {
  if (node) node.innerHTML = html;
}

/* ===== Charts / metrics ===== */

function fmtUSD(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(x / 1e3).toFixed(2)}K`;
  return `$${x.toFixed(2)}`;
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}%`;
}

function drawSparkline(canvas, series) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width || 320;
  const h = canvas.height || 120;

  ctx.clearRect(0, 0, w, h);

  const pts = (Array.isArray(series) ? series : [])
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));

  if (pts.length < 2) return;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const pad = 10;
  const span = (max - min) || 1;

  // grid
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  for (let i = 1; i <= 3; i++) {
    const y = pad + (i * (h - pad * 2)) / 4;
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
  }
  ctx.strokeStyle = "rgba(0,255,170,0.25)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // line
  ctx.globalAlpha = 1;
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (pts.length - 1);
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,255,170,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // last point
  const last = pts[pts.length - 1];
  const lx = w - pad;
  const ly = pad + (1 - (last - min) / span) * (h - pad * 2);
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,255,170,0.95)";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderMiniMetrics(container, items) {
  if (!container) return;
  const xs = Array.isArray(items) ? items : [];
  container.innerHTML = xs.map(({ k, v }) => `
    <div class="kv-mini">
      <div class="k">${k}</div>
      <div class="v">${v}</div>
    </div>
  `).join("");
}

/* ===== Main panels ===== */

function renderEmptyGrid(gridEl, label) {
  if (!gridEl) return;
  gridEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <div class="card-title">${label} ${i + 1}</div>
        <div class="pill pill-warn">EMPTY</div>
      </div>
      <div class="rows">
        <div class="row"><span class="k">Add IDs</span><span class="v">Edit Mode</span></div>
        <div class="row"><span class="k">Status</span><span class="v">—</span></div>
        <div class="row"><span class="k">Updated</span><span class="v">—</span></div>
      </div>
    `;
    gridEl.appendChild(card);
  }
}

function pillClassFromStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("active") || s.includes("online") || s.includes("validating")) return "pill-ok";
  if (s.includes("pending") || s.includes("unknown")) return "pill-warn";
  if (s.includes("offline") || s.includes("exited") || s.includes("slashed") || s.includes("error")) return "pill-bad";
  return "pill-warn";
}

function makeCard(type, it, idx) {
  const card = document.createElement("div");
  card.className = "card";

  const title = type === "eth" ? `Validator ${idx + 1}` : `Node ${idx + 1}`;

  const status = it.status ?? it.validationStatus ?? "unknown";
  const online = it.online;

  const pillLabel = (type === "eth")
    ? (online === true ? "ONLINE" : online === false ? "OFFLINE" : String(status).toUpperCase())
    : String(status).toUpperCase();

  const pillClass = pillClassFromStatus(type === "eth"
    ? (online === true ? "online" : online === false ? "offline" : status)
    : status
  );

  const fields = (type === "eth")
    ? [
        ["Public Key", shortId(it.pubkey ?? "—", 18)],
        ["Index", String(it.validatorId ?? "—")],
        ["Status", String(status ?? "—")],
        ["Online", online === true ? "Yes" : online === false ? "No" : "—"],
        ["Balance (ETH)", it.balanceEth ?? "—"],
        ["Effective (ETH)", it.effectiveBalanceEth ?? "—"],
        ["Updated", it.updated ?? "—"],
      ]
    : [
        ["NodeID", shortId(it.nodeId ?? "—", 12)],
        ["Status", it.validationStatus ?? "—"],
        ["Staked (AVAX)", it.amountStakedAvax ?? "—"],
        ["Delegated (AVAX)", it.amountDelegatedAvax ?? "—"],
        ["Delegators", it.delegatorCount ?? "—"],
        ["Delegation Fee", it.delegationFeePct ?? "—"],
        ["Updated", it.updated ?? "—"],
      ];

  card.innerHTML = `
    <div class="card-top">
      <div class="card-title">${title}</div>
      <div class="pill ${pillClass}">${pillLabel}</div>
    </div>
    <div class="rows">
      ${fields.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}
    </div>
  `;

  return card;
}

function renderGrid(gridEl, type, items) {
  if (!gridEl) return;
  gridEl.innerHTML = "";
  const list = Array.isArray(items) ? items.slice(0, 4) : [];
  for (let i = 0; i < 4; i++) {
    const it = list[i] || {};
    gridEl.appendChild(makeCard(type, it, i));
  }
}

async function refreshMainPanels() {
  setText(el.statusLine, "Fetching…");
  setText(el.lastUpdate, "—");

  const ethPubkeys = (state.eth || []).filter(Boolean).slice(0, 4);
  const avaxNodeIds = (state.avax || []).filter(Boolean).slice(0, 4);

  if (!ethPubkeys.length) renderEmptyGrid(el.ethGrid, "Validator");
  if (!avaxNodeIds.length) renderEmptyGrid(el.avaxGrid, "Node");

  try {
    const [ethRes, avaxRes] = await Promise.allSettled([
      ethPubkeys.length ? postJSON("/api/eth", { pubkeys: ethPubkeys, includeBalanceSeries: false }) : Promise.resolve({ validators: [] }),
      avaxNodeIds.length ? postJSON("/api/avax", { nodeIds: avaxNodeIds }) : Promise.resolve({ validators: [] }),
    ]);

    if (ethRes.status === "fulfilled" && ethPubkeys.length) {
      renderGrid(el.ethGrid, "eth", ethRes.value?.validators || []);
    }

    if (avaxRes.status === "fulfilled" && avaxNodeIds.length) {
      renderGrid(el.avaxGrid, "avax", avaxRes.value?.validators || []);
    }

    setText(el.lastUpdate, nowStamp());
    setText(el.statusLine, "Live");
  } catch (e) {
    console.warn(e);
    setText(el.statusLine, "Offline");
  }
}

/* ===== DefiLlama TVL panels ===== */

async function fetchLlama(chain) {
  const url = new URL("/api/llama", location.origin);
  url.searchParams.set("chain", chain);
  const r = await fetch(url.toString());
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} ${t}`.trim());
  }
  return r.json();
}

async function refreshLlamaPanels() {
  // ETH
  try {
    setText(el.ethTvlStatus, "loading…");
    const d = await fetchLlama("Ethereum");
    renderMiniMetrics(el.ethTvlMetrics, [
      { k: "TVL", v: fmtUSD(d?.tvl?.current) },
      { k: "7D Change", v: pct(d?.tvl?.change7dPct) },
      { k: "30D Change", v: pct(d?.tvl?.change30dPct) },
      { k: "Updated", v: d?.updated || nowStamp() },
    ]);
    drawSparkline(el.ethTvlChart, d?.series?.tvl30d || []);
    setText(el.ethTvlStatus, "live");
  } catch (e) {
    setText(el.ethTvlStatus, "error");
    renderMiniMetrics(el.ethTvlMetrics, [
      { k: "Error", v: (e && e.message) ? e.message : "failed" },
      { k: "", v: "" },
      { k: "", v: "" },
      { k: "", v: "" },
    ]);
    drawSparkline(el.ethTvlChart, []);
  }

  // AVAX (chain name in DefiLlama = "Avalanche")
  try {
    setText(el.avaxTvlStatus, "loading…");
    const d = await fetchLlama("Avalanche");
    renderMiniMetrics(el.avaxTvlMetrics, [
      { k: "TVL", v: fmtUSD(d?.tvl?.current) },
      { k: "7D Change", v: pct(d?.tvl?.change7dPct) },
      { k: "30D Change", v: pct(d?.tvl?.change30dPct) },
      { k: "Updated", v: d?.updated || nowStamp() },
    ]);
    drawSparkline(el.avaxTvlChart, d?.series?.tvl30d || []);
    setText(el.avaxTvlStatus, "live");
  } catch (e) {
    setText(el.avaxTvlStatus, "error");
    renderMiniMetrics(el.avaxTvlMetrics, [
      { k: "Error", v: (e && e.message) ? e.message : "failed" },
      { k: "", v: "" },
      { k: "", v: "" },
      { k: "", v: "" },
    ]);
    drawSparkline(el.avaxTvlChart, []);
  }
}

/* ===== ETH live validator by pubkey ===== */

async function refreshEthLive() {
  const pk = state.liveEthPubkey;
  if (!pk) {
    setText(el.ethLiveStatus, "idle");
    setText(el.ethPkOut, "—");
    drawSparkline(el.ethPkChart, []);
    return;
  }

  try {
    setText(el.ethLiveStatus, "fetching…");
    const r = await postJSON("/api/eth", { pubkeys: [pk], includeBalanceSeries: true });
    const v = (r?.validators || [])[0];

    if (!v) {
      setText(el.ethLiveStatus, "no data");
      setText(el.ethPkOut, "No data returned.");
      drawSparkline(el.ethPkChart, []);
      return;
    }

    const onlineLabel = v.online === true
      ? "<span class='ok'>ONLINE</span>"
      : v.online === false
      ? "<span class='bad'>OFFLINE</span>"
      : "<span class='warn'>UNKNOWN</span>";

    setHTML(el.ethPkOut, [
      `Pubkey: <span class='ok'>${shortId(v.pubkey || pk, 22)}</span>`,
      `Index: <span class='ok'>${String(v.validatorId ?? "—")}</span>`,
      `Status: ${String(v.status ?? "—")}`,
      `Online: ${onlineLabel}`,
      `Balance: ${String(v.balanceEth ?? "—")} ETH`,
      `Effective: ${String(v.effectiveBalanceEth ?? "—")} ETH`,
      `Updated: ${String(v.updated ?? nowStamp())}`,
      v.error ? `<span class='bad'>Error:</span> ${String(v.error)}` : "",
    ].filter(Boolean).map(x => `<div>${x}</div>`).join(""));

    drawSparkline(el.ethPkChart, Array.isArray(v.balanceSeriesEth) ? v.balanceSeriesEth : []);
    setText(el.ethLiveStatus, "live");
  } catch (e) {
    setText(el.ethLiveStatus, "error");
    setText(el.ethPkOut, `Error: ${e.message}`);
    drawSparkline(el.ethPkChart, []);
  }
}

/* ===== Edit Mode ===== */

function hydrateEditInputs() {
  if (el.ethInput) el.ethInput.value = (state.eth || []).join("\n");
  if (el.avaxInput) el.avaxInput.value = (state.avax || []).join("\n");
  if (el.ethPkInput) el.ethPkInput.value = state.liveEthPubkey || "";
}

function setEditMsg(msg) {
  if (el.editMsg) el.editMsg.textContent = msg;
}

function bindEditMode() {
  if (!el.toggleEdit) return;

  el.toggleEdit.addEventListener("click", () => {
    const open = el.editPanel.hasAttribute("hidden");
    if (open) el.editPanel.removeAttribute("hidden");
    else el.editPanel.setAttribute("hidden", "");
    el.toggleEdit.setAttribute("aria-expanded", open ? "true" : "false");
    el.toggleEdit.textContent = open ? "CLOSE" : "OPEN";
  });

  if (el.saveApply) {
    el.saveApply.addEventListener("click", async () => {
      const ethList = parseEthPubkeys(el.ethInput.value).slice(0, 4);
      const avaxList = parseAvaxNodeIds(el.avaxInput.value).slice(0, 4);

      state.eth = ethList;
      state.avax = avaxList;

      saveToLocalStorage();
      setEditMsg("Saved. Refreshing…");
      await refreshMainPanels();
      setEditMsg(`Updated ${nowStamp()}`);
    });
  }

  if (el.resetDefaults) {
    el.resetDefaults.addEventListener("click", async () => {
      state.eth = [...DEFAULT_ETH_VALIDATORS];
      state.avax = [...DEFAULT_AVAX_NODE_IDS];
      state.liveEthPubkey = null;
      saveToLocalStorage();
      hydrateEditInputs();
      setEditMsg("Reset. Refreshing…");
      await refreshMainPanels();
      await refreshEthLive();
      setEditMsg(`Reset done ${nowStamp()}`);
    });
  }
}

function bindEthLiveBox() {
  if (el.ethPkApply && el.ethPkInput) {
    el.ethPkApply.addEventListener("click", async () => {
      const pk = sanitizeEthPubkey(el.ethPkInput.value);
      if (!pk) {
        setText(el.ethLiveStatus, "invalid");
        setText(el.ethPkOut, "Enter a valid 0x… public key.");
        drawSparkline(el.ethPkChart, []);
        return;
      }
      state.liveEthPubkey = pk;
      saveToLocalStorage();
      await refreshEthLive();
    });
  }
}

/* ===== Boot ===== */

(async function boot() {
  loadFromLocalStorage();
  hydrateEditInputs();
  bindEditMode();
  bindEthLiveBox();

  await refreshMainPanels();
  await refreshLlamaPanels();
  await refreshEthLive();

  setInterval(() => { refreshMainPanels(); }, REFRESH_MS);
  setInterval(() => { refreshLlamaPanels(); }, LLAMA_REFRESH_MS);
  setInterval(() => { refreshEthLive(); }, LIVE_REFRESH_MS);
})();
