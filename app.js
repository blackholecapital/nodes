/**
 * GOT NODES (beta)
 * Edit Mode + localStorage
 *
 * ✅ You can still hardcode defaults here, but UI overrides via localStorage.
 */

const DEFAULT_ETH_VALIDATORS = [
  1, 2, 3, 4, // set decent placeholders; you'll overwrite via Edit Mode
];

const DEFAULT_AVAX_NODE_IDS = [
  "NodeID-1",
  "NodeID-2",
  "NodeID-3",
  "NodeID-4",
];

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_LABEL = "5:00";

const LS_KEYS = {
  eth: "gotnodes.eth.validators",
  avax: "gotnodes.avax.nodeids",
  trackEth: "gotnodes.track.eth",
  trackAvax: "gotnodes.track.avax",
};

const state = {
  eth: [...DEFAULT_ETH_VALIDATORS],
  avax: [...DEFAULT_AVAX_NODE_IDS],
  trackEth: null,
  trackAvax: null,
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

  // network intel (DefiLlama + live track)
  ethIntelMetrics: document.getElementById("ethIntelMetrics"),
  avaxIntelMetrics: document.getElementById("avaxIntelMetrics"),
  ethIntelChart: document.getElementById("ethIntelChart"),
  avaxIntelChart: document.getElementById("avaxIntelChart"),
  ethIntelStatus: document.getElementById("ethIntelStatus"),
  avaxIntelStatus: document.getElementById("avaxIntelStatus"),
  ethTrackInput: document.getElementById("ethTrackInput"),
  avaxTrackInput: document.getElementById("avaxTrackInput"),
  ethTrackApply: document.getElementById("ethTrackApply"),
  avaxTrackApply: document.getElementById("avaxTrackApply"),
  ethTrackOut: document.getElementById("ethTrackOut"),
  avaxTrackOut: document.getElementById("avaxTrackOut"),
};

el.refreshEvery.textContent = REFRESH_LABEL;

function nowStamp() {
  return new Date().toLocaleString();
}

function parseEthIds(raw) {
  // accept lines and commas; keep numeric-ish tokens
  const tokens = String(raw || "")
    .split(/[\n,]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const nums = [];
  for (const t of tokens) {
    // allow "12345" or " 12345 "
    const n = Number(t);
    if (Number.isInteger(n) && n >= 0) nums.push(n);
  }
  return nums;
}

function parseAvaxNodeIds(raw) {
  // one per line (also tolerate commas)
  const tokens = String(raw || "")
    .split(/[\n,]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  // basic sanity: keep things that look like NodeID-...
  return tokens.filter(t => t.startsWith("NodeID-"));
}

function loadFromLocalStorage() {
  try {
    const ethRaw = localStorage.getItem(LS_KEYS.eth);
       const avaxRaw = localStorage.getItem(LS_KEYS.avax);
    const trackEthRaw = localStorage.getItem(LS_KEYS.trackEth);
    const trackAvaxRaw = localStorage.getItem(LS_KEYS.trackAvax);

    if (ethRaw) {
      const ethList = JSON.parse(ethRaw);
      if (Array.isArray(ethList) && ethList.length) state.eth = ethList;
    }
       if (avaxRaw) {
      const avaxList = JSON.parse(avaxRaw);
      if (Array.isArray(avaxList) && avaxList.length) state.avax = avaxList;
    }

    if (trackEthRaw) {
      const v = Number(trackEthRaw);
      if (Number.isInteger(v) && v >= 0) state.trackEth = v;
    }
    if (trackAvaxRaw) {
      const v = String(trackAvaxRaw).trim();
      if (v) state.trackAvax = v;
    }

  } catch (e) {
    console.warn("localStorage load failed:", e);
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEYS.eth, JSON.stringify(state.eth));
       localStorage.setItem(LS_KEYS.avax, JSON.stringify(state.avax));
    if (state.trackEth != null) localStorage.setItem(LS_KEYS.trackEth, String(state.trackEth));
    if (state.trackAvax) localStorage.setItem(LS_KEYS.trackAvax, String(state.trackAvax));
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }
}

function hydrateEditInputs() {
  el.ethInput.value = state.eth.join("\n");
   el.avaxInput.value = state.avax.join("\n");
  if (el.ethTrackInput) el.ethTrackInput.value = state.trackEth != null ? String(state.trackEth) : "";
  if (el.avaxTrackInput) el.avaxTrackInput.value = state.trackAvax ? String(state.trackAvax) : "";
}

function setEditMsg(msg) {
  el.editMsg.textContent = msg;
}

function pillClassFromStatus(s) {
  const st = String(s || "").toLowerCase();
  if (st.includes("active") || st === "ok" || st === "online") return "ok";
  if (st.includes("pending") || st.includes("unknown")) return "warn";
  if (st.includes("slashed") || st.includes("offline") || st.includes("removed")) return "bad";
  return "warn";
}

function shortId(id, keep = 10) {
  const s = String(id);
  if (s.length <= keep * 2 + 3) return s;
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

// ===== NETWORK INTEL (DefiLlama) =====
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

function drawSparkline(canvas, series, opts = {}) {
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

  // backdrop grid
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

  ctx.globalAlpha = 1;
  ctx.beginPath();
  pts.forEach((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (pts.length - 1);
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.stroke || "rgba(0,255,170,0.9)";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.stroke();

  // last point glow
  const last = pts[pts.length - 1];
  const lx = w - pad;
  const ly = pad + (1 - (last - min) / span) * (h - pad * 2);
  ctx.beginPath();
  ctx.arc(lx, ly, 3, 0, Math.PI * 2);
  ctx.fillStyle = opts.fill || "rgba(0,255,170,0.95)";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function renderIntelMetrics(container, data) {
  if (!container) return;
  const items = Array.isArray(data) ? data : [];
  container.innerHTML = items.map(({ k, v }) => `
    <div class="kv-mini">
      <div class="k">${k}</div>
      <div class="v">${v}</div>
    </div>
  `).join("");
}

async function fetchIntel(chain) {
  const url = new URL("/api/llama", location.origin);
  url.searchParams.set("chain", chain);
  return fetch(url.toString()).then(r => r.json());
}

function safeText(elm, txt) {
  if (elm) elm.textContent = txt;
}

function renderTrackedOut(elm, lines) {
  if (!elm) return;
  elm.innerHTML = (Array.isArray(lines) ? lines : [])
    .map(l => `<div>${l}</div>`)
    .join("") || "—";
}
// ===== /NETWORK INTEL (DefiLlama) =====

function renderSkeleton(gridEl, titlePrefix) {
  gridEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const card = document.createElement("div");
    card.className = "card skel";
    card.innerHTML = `
      <div class="card-top">
        <div>
          <h3 class="card-title">${titlePrefix} ${i + 1}</h3>
          <div class="card-sub">Loading…</div>
        </div>
        <div class="pill">WAIT</div>
      </div>
      <div class="kv">
        ${Array.from({ length: 8 }).map(() => `
          <div class="kv-row">
            <div class="k">…</div>
            <div class="v">…</div>
          </div>
        `).join("")}
      </div>
    `;
    gridEl.appendChild(card);
  }
}

function renderCards(gridEl, items, type) {
  gridEl.innerHTML = "";

  const take4 = (Array.isArray(items) ? items : []).slice(0, 4);

  take4.forEach((it, idx) => {
    const card = document.createElement("div");
    card.className = "card";

    const title = type === "eth" ? `Validator ${idx + 1}` : `Node ${idx + 1}`;
    const idLine = type === "eth"
      ? String(it.validatorId ?? it.index ?? "—")
      : String(it.nodeId ?? "—");

    const status = it.status ?? it.validationStatus ?? "unknown";
    const online = it.online;

    const fields = (type === "eth")
      ? [
          ["Validator ID", idLine],
          ["Status", status],
          ["Online", online === true ? "Yes" : online === false ? "No" : "—"],
          ["Balance (ETH)", it.balanceEth ?? "—"],
          ["Effective (ETH)", it.effectiveBalanceEth ?? "—"],
          ["APY (30d)", it.apy30d ?? "—"],
          ["ROI (30d)", it.roi30d ?? "—"],
          ["Finality", it.finality ?? "—"],
        ]
      : [
          ["NodeID", shortId(it.nodeId ?? "—", 12)],
          ["Status", it.validationStatus ?? "—"],
          ["Staked (AVAX)", it.amountStakedAvax ?? "—"],
          ["Delegated (AVAX)", it.amountDelegatedAvax ?? "—"],
          ["Delegators", it.delegatorCount ?? "—"],
          ["Delegation Fee", it.delegationFeePct ?? "—"],
          ["Val Reward (AVAX)", it.validationRewardAvax ?? "—"],
          ["Del Reward (AVAX)", it.delegationRewardAvax ?? "—"],
        ];

    const pillLabel = (type === "eth")
      ? (online === true ? "ONLINE" : online === false ? "OFFLINE" : String(status).toUpperCase())
      : String(status).toUpperCase();

    const pillStatusKey = type === "eth"
      ? (online === true ? "online" : online === false ? "offline" : status)
      : status;

    card.innerHTML = `
      <div class="card-top">
        <div>
          <h3 class="card-title">${title}</h3>
          <div class="card-sub">${type === "eth" ? "ID: " : "NodeID: "}${idLine}</div>
        </div>
        <div class="pill ${pillClassFromStatus(pillStatusKey)}">${pillLabel}</div>
      </div>

      <div class="kv">
        ${fields.map(([k, v]) => `
          <div class="kv-row">
            <div class="k">${k}</div>
            <div class="v ${k.includes("APY") ? "green" : ""}">${v}</div>
          </div>
        `).join("")}
      </div>
    `;

    gridEl.appendChild(card);
  });
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} failed: ${res.status} ${res.statusText} ${text}`.trim());
  }
  return res.json();
}

async function refreshAll() {
  el.statusLine.textContent = "Fetching validator telemetry…";
  renderSkeleton(el.ethGrid, "ETH");
  renderSkeleton(el.avaxGrid, "AVAX");

  // only show first 4 on UI, but backend can accept more if you want later
  const ethIds = state.eth.slice(0, 4);
  const avaxIds = state.avax.slice(0, 4);

  const results = await Promise.allSettled([
    postJSON("/api/eth", { validators: ethIds, window: "30d" }),
    postJSON("/api/avax", { nodeIds: avaxIds }),
  ]);

  const eth = results[0].status === "fulfilled" ? results[0].value : null;
  const avax = results[1].status === "fulfilled" ? results[1].value : null;

  if (eth) renderCards(el.ethGrid, eth.validators || [], "eth");
  if (avax) renderCards(el.avaxGrid, avax.validators || [], "avax");

  el.lastUpdate.textContent = nowStamp();

  const errs = [];
  if (!eth) errs.push(`ETH: ${String(results[0].reason || "failed")}`);
  if (!avax) errs.push(`AVAX: ${String(results[1].reason || "failed")}`);
  if (errs.length) {
    el.statusLine.textContent = `Partial: ${errs.join(" | ")}`;
  } else {
    el.statusLine.textContent = "Locked. Loaded. Updating on schedule.";
  }

function bindEditMode() {
  if (!el.toggleEdit) return; // safety

  el.toggleEdit.addEventListener("click", () => {
    const isOpen = !el.editPanel.hidden;
    el.editPanel.hidden = isOpen;
    el.toggleEdit.textContent = isOpen ? "OPEN" : "CLOSE";
    el.toggleEdit.setAttribute("aria-expanded", String(!isOpen));
    setEditMsg(isOpen ? "—" : "Paste IDs, SAVE + APPLY.");
  });

  el.saveApply.addEventListener("click", async () => {
    const ethList = parseEthIds(el.ethInput.value);
    const avaxList = parseAvaxNodeIds(el.avaxInput.value);

    if (ethList.length < 1) {
      setEditMsg("ETH list looks empty. Paste validator indices (numbers).");
      return;
    }
    if (avaxList.length < 1) {
      setEditMsg("AVAX list looks empty. Paste NodeID-… lines.");
      return;
    }

    state.eth = ethList;
    state.avax = avaxList;
    saveToLocalStorage();

    setEditMsg(`Saved. Applying now (${Math.min(4, ethList.length)} ETH / ${Math.min(4, avaxList.length)} AVAX)…`);
    try {
      await refreshAll();
      setEditMsg(`Applied ✅ ${nowStamp()}`);
    } catch (e) {
      console.error(e);
      setEditMsg(`Applied, but fetch failed: ${e.message}`);
      el.statusLine.textContent = `Error: ${e.message}`;
    }
  });

  el.resetDefaults.addEventListener("click", async () => {
    state.eth = [...DEFAULT_ETH_VALIDATORS];
    state.avax = [...DEFAULT_AVAX_NODE_IDS];
    saveToLocalStorage();
    hydrateEditInputs();
    setEditMsg("Reset to defaults. Applying…");
    try {
      await refreshAll();
      setEditMsg(`Defaults applied ✅ ${nowStamp()}`);
    } catch (e) {
      console.error(e);
      setEditMsg(`Defaults applied, but fetch failed: ${e.message}`);
      el.statusLine.textContent = `Error: ${e.message}`;
    }
  });
}

function bindIntelAndTracking() {
  if (el.ethTrackApply && el.ethTrackInput) {
    el.ethTrackApply.addEventListener("click", async () => {
      const v = Number(el.ethTrackInput.value.trim());
      if (!Number.isInteger(v) || v < 0) {
        renderTrackedOut(el.ethTrackOut, ["<span class='warn'>Enter a valid validator index (number).</span>"]);
        return;
      }
      state.trackEth = v;
      saveToLocalStorage();
      await refreshTracked();
    });
  }

  if (el.avaxTrackApply && el.avaxTrackInput) {
    el.avaxTrackApply.addEventListener("click", async () => {
      const v = String(el.avaxTrackInput.value || "").trim();
      if (!v || !v.startsWith("NodeID-")) {
        renderTrackedOut(el.avaxTrackOut, ["<span class='warn'>Enter a valid NodeID-…</span>"]);
        return;
      }
      state.trackAvax = v;
      saveToLocalStorage();
      await refreshTracked();
    });
  }
}

async function refreshIntel() {
  try {
    safeText(el.ethIntelStatus, "fetching…");
    const eth = await fetchIntel("Ethereum");
    const ethSeries = eth?.series?.tvl30d || eth?.series?.fees30d || [];
    renderIntelMetrics(el.ethIntelMetrics, [
      { k: "TVL", v: fmtUSD(eth?.tvl?.current) },
      { k: "Fees (24h)", v: fmtUSD(eth?.fees?.totalFees24h) },
      { k: "Revenue (24h)", v: fmtUSD(eth?.fees?.totalRevenue24h) },
      { k: "Stablecoin Dom", v: eth?.stablecoins?.dominance != null ? `${(Number(eth.stablecoins.dominance) * 100).toFixed(2)}%` : "—" },
    ]);
    drawSparkline(el.ethIntelChart, ethSeries);
    safeText(el.ethIntelStatus, "live");
  } catch (e) {
    console.warn("ETH intel failed:", e);
    safeText(el.ethIntelStatus, "offline");
  }

  try {
    safeText(el.avaxIntelStatus, "fetching…");
    const avax = await fetchIntel("Avalanche");
    const avaxSeries = avax?.series?.tvl30d || avax?.series?.fees30d || [];
    renderIntelMetrics(el.avaxIntelMetrics, [
      { k: "TVL", v: fmtUSD(avax?.tvl?.current) },
      { k: "Fees (24h)", v: fmtUSD(avax?.fees?.totalFees24h) },
      { k: "Revenue (24h)", v: fmtUSD(avax?.fees?.totalRevenue24h) },
      { k: "Stablecoin Dom", v: avax?.stablecoins?.dominance != null ? `${(Number(avax.stablecoins.dominance) * 100).toFixed(2)}%` : "—" },
    ]);
    drawSparkline(el.avaxIntelChart, avaxSeries);
    safeText(el.avaxIntelStatus, "live");
  } catch (e) {
    console.warn("AVAX intel failed:", e);
    safeText(el.avaxIntelStatus, "offline");
  }
}

async function refreshTracked() {
  if (state.trackEth != null && el.ethTrackOut) {
    try {
      const r = await postJSON("/api/eth", { validators: [state.trackEth], window: "30d" });
      const v = (r?.validators || [])[0];
      if (!v) {
        renderTrackedOut(el.ethTrackOut, ["No data"]);
      } else {
        const online = v.online === true ? "<span class='ok'>ONLINE</span>" : v.online === false ? "<span class='bad'>OFFLINE</span>" : "<span class='warn'>UNKNOWN</span>";
        renderTrackedOut(el.ethTrackOut, [
          `ID: <span class='ok'>${v.validatorId ?? state.trackEth}</span>`,
          `Status: ${String(v.status ?? "—")}`,
          `Online: ${online}`,
          `Balance: ${String(v.balanceEth ?? "—")} ETH`,
          `Effective: ${String(v.effectiveBalanceEth ?? "—")} ETH`,
          `APY (30d): ${String(v.apy30d ?? "—")}`,
          `ROI (30d): ${String(v.roi30d ?? "—")}`,
          `Updated: ${nowStamp()}`,
        ]);
      }
    } catch (e) {
      renderTrackedOut(el.ethTrackOut, [`<span class='bad'>Error:</span> ${e.message}`]);
    }
  }

  if (state.trackAvax && el.avaxTrackOut) {
    try {
      const r = await postJSON("/api/avax", { nodeIds: [state.trackAvax] });
      const v = (r?.validators || [])[0];
      if (!v) {
        renderTrackedOut(el.avaxTrackOut, ["No data"]);
      } else {
        const st = String(v.validationStatus || "unknown");
        const klass = pillClassFromStatus(st);
        renderTrackedOut(el.avaxTrackOut, [
          `NodeID: <span class='ok'>${shortId(state.trackAvax, 14)}</span>`,
          `Status: <span class='${klass}'>${st.toUpperCase()}</span>`,
          `Staked: ${String(v.amountStakedAvax ?? "—")} AVAX`,
          `Delegated: ${String(v.amountDelegatedAvax ?? "—")} AVAX`,
          `Delegators: ${String(v.delegatorCount ?? "—")}`,
          `Fee: ${String(v.delegationFeePct ?? "—")}`,
          `Updated: ${nowStamp()}`,
        ]);
      }
    } catch (e) {
      renderTrackedOut(el.avaxTrackOut, [`<span class='bad'>Error:</span> ${e.message}`]);
    }
  }
}

(async function boot() {
  loadFromLocalStorage();
  hydrateEditInputs();
   bindEditMode();
  bindIntelAndTracking();

  // fire sidebar immediately (non-blocking)
  refreshIntel();
  refreshTracked();

  try {
    await refreshAll();
  } catch (e) {
    console.error(e);
    el.statusLine.textContent = `Error: ${e.message}`;
  }

  setInterval(async () => {
    try {
      await refreshAll();
    } catch (e) {
      console.error(e);
      el.statusLine.textContent = `Error: ${e.message}`;
    }
   }, REFRESH_MS);

  // near-real-time tracking (15s) + intel refresh (60s)
  setInterval(() => { refreshTracked(); }, 15 * 1000);
  setInterval(() => { refreshIntel(); }, 60 * 1000);
})();
