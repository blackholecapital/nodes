/**
 * GOT NODES (beta)
 * Edit Mode + localStorage
 *
 * ETH validator data is fetched by VALIDATOR PUBLIC KEY (0x…).
 * AVAX validator data is fetched by NodeID-…
 */

const DEFAULT_ETH_VALIDATORS = [
  // Put real 0x validator pubkeys here (or use Edit Mode)
  "0x",
  "0x",
  "0x",
  "0x",
];

const DEFAULT_AVAX_NODE_IDS = [
  "NodeID-1",
  "NodeID-2",
  "NodeID-3",
  "NodeID-4",
];

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_LABEL = "5:00";
const LIVE_REFRESH_MS = 10 * 1000; // "real time" feel

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

  // ETH live-by-pubkey box
  ethLiveStatus: document.getElementById("ethLiveStatus"),
  ethPkInput: document.getElementById("ethPkInput"),
  ethPkApply: document.getElementById("ethPkApply"),
  ethPkOut: document.getElementById("ethPkOut"),
  ethPkChart: document.getElementById("ethPkChart"),
};

el.refreshEvery.textContent = REFRESH_LABEL;

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
  // Accept 0x… hex; do a light check only (length varies between pubkey formats across tooling)
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
      if (Array.isArray(ethList) && ethList.length) state.eth = ethList;
    }

    if (avaxRaw) {
      const avaxList = JSON.parse(avaxRaw);
      if (Array.isArray(avaxList) && avaxList.length) state.avax = avaxList;
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

function renderSkeleton(gridEl, titlePrefix) {
  gridEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const card = document.createElement("div");
    card.className = "card skeleton";
    card.innerHTML = `
      <div class="card-title">${titlePrefix} ${i + 1}</div>
      <div class="rows">
        <div class="row"><span class="k">Loading</span><span class="v">…</span></div>
        <div class="row"><span class="k">Loading</span><span class="v">…</span></div>
        <div class="row"><span class="k">Loading</span><span class="v">…</span></div>
      </div>
    `;
    gridEl.appendChild(card);
  }
}

function pillClassFromStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("active") || s.includes("online") || s.includes("validating")) return "pill-ok";
  if (s.includes("pending") || s.includes("unknown")) return "pill-warn";
  if (s.includes("offline") || s.includes("exited") || s.includes("slashed")) return "pill-bad";
  return "pill-warn";
}

function makeCard(type, it, idx) {
  const card = document.createElement("div");
  card.className = "card";

  const title = type === "eth" ? `Validator ${idx + 1}` : `Node ${idx + 1}`;

  const status = it.status ?? it.validationStatus ?? "unknown";
  const online = it.online;

  const fields = (type === "eth")
    ? [
        ["Public Key", shortId(it.pubkey ?? "—", 18)],
        ["Validator Index", String(it.validatorId ?? it.index ?? "—")],
        ["Status", String(status)],
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

  const pillLabel = (type === "eth")
    ? (online === true ? "ONLINE" : online === false ? "OFFLINE" : String(status).toUpperCase())
    : String(status).toUpperCase();

  const pillClass = pillClassFromStatus(type === "eth" ? (online === true ? "online" : online === false ? "offline" : status) : status);

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
  gridEl.innerHTML = "";
  const list = Array.isArray(items) ? items.slice(0, 4) : [];
  for (let i = 0; i < 4; i++) {
    const it = list[i] || {};
    gridEl.appendChild(makeCard(type, it, i));
  }
}

/* ===== ETH LIVE BOX (pubkey -> output + chart) ===== */

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

  // faint grid
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

function setText(node, txt) {
  if (node) node.textContent = txt;
}

function setHTML(node, html) {
  if (node) node.innerHTML = html;
}

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
    ].map(x => `<div>${x}</div>`).join(""));

    const series = Array.isArray(v.balanceSeriesEth) ? v.balanceSeriesEth : [];
    drawSparkline(el.ethPkChart, series);
    setText(el.ethLiveStatus, "live");
  } catch (e) {
    setText(el.ethLiveStatus, "error");
    setText(el.ethPkOut, `Error: ${e.message}`);
    drawSparkline(el.ethPkChart, []);
  }
}

/* ===== MAIN FETCH ===== */

async function refreshAll() {
  setText(el.statusLine, "Fetching…");
  setText(el.lastUpdate, "—");

  // skeletons
  renderSkeleton(el.ethGrid, "Validator");
  renderSkeleton(el.avaxGrid, "Node");

  try {
    const ethPubkeys = state.eth.filter(Boolean).slice(0, 4);
    const [ethRes, avaxRes] = await Promise.allSettled([
      postJSON("/api/eth", { pubkeys: ethPubkeys, includeBalanceSeries: false }),
      postJSON("/api/avax", { nodeIds: state.avax.filter(Boolean).slice(0, 4) }),
    ]);

    if (ethRes.status === "fulfilled") {
      renderGrid(el.ethGrid, "eth", ethRes.value?.validators || []);
    } else {
      console.warn("ETH fetch failed:", ethRes.reason);
      setText(el.statusLine, "ETH failed");
    }

    if (avaxRes.status === "fulfilled") {
      renderGrid(el.avaxGrid, "avax", avaxRes.value?.validators || []);
    } else {
      console.warn("AVAX fetch failed:", avaxRes.reason);
      setText(el.statusLine, "AVAX failed");
    }

    setText(el.lastUpdate, nowStamp());
    setText(el.statusLine, "Live");
  } catch (e) {
    console.warn(e);
    setText(el.statusLine, "Offline");
  }
}

/* ===== EDIT MODE ===== */

function hydrateEditInputs() {
  if (el.ethInput) el.ethInput.value = state.eth.join("\n");
  if (el.avaxInput) el.avaxInput.value = state.avax.join("\n");
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
      const ethList = parseEthPubkeys(el.ethInput.value);
      const avaxList = parseAvaxNodeIds(el.avaxInput.value);

      state.eth = ethList.length ? ethList : [...DEFAULT_ETH_VALIDATORS];
      state.avax = avaxList.length ? avaxList : [...DEFAULT_AVAX_NODE_IDS];

      saveToLocalStorage();
      setEditMsg("Saved. Refreshing…");
      await refreshAll();
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
      await refreshAll();
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

/* ===== BOOT ===== */

(async function boot() {
  loadFromLocalStorage();
  hydrateEditInputs();
  bindEditMode();
  bindEthLiveBox();

  await refreshAll();
  await refreshEthLive();

  setInterval(() => { refreshAll(); }, REFRESH_MS);
  setInterval(() => { refreshEthLive(); }, LIVE_REFRESH_MS);
})();
