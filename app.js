/**
 * GOT NODES - TEXT ONLY MODE
 * - NO charts, NO canvas.
 * - ETH/AVAX main panels still render.
 * - Right side: ETH DefiLlama TVL (text), AVAX DefiLlama TVL (text), ETH Live Validator (pubkey, text).
 * - Each box prints raw error/response details so we can see what is failing.
 */

const DEFAULT_ETH_VALIDATORS = [];
const DEFAULT_AVAX_NODE_IDS = [];

const REFRESH_MS = 5 * 60 * 1000;
const REFRESH_LABEL = "5:00";
const LLAMA_REFRESH_MS = 60 * 1000;
const LIVE_REFRESH_MS = 10 * 1000;

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

  // llama text boxes
  ethTvlStatus: document.getElementById("ethTvlStatus"),
  avaxTvlStatus: document.getElementById("avaxTvlStatus"),
  ethTvlOut: document.getElementById("ethTvlOut"),
  avaxTvlOut: document.getElementById("avaxTvlOut"),
  ethTvlRefresh: document.getElementById("ethTvlRefresh"),
  avaxTvlRefresh: document.getElementById("avaxTvlRefresh"),

  // ETH live
  ethLiveStatus: document.getElementById("ethLiveStatus"),
  ethPkInput: document.getElementById("ethPkInput"),
  ethPkApply: document.getElementById("ethPkApply"),
  ethPkOut: document.getElementById("ethPkOut"),
};

if (el.refreshEvery) el.refreshEvery.textContent = REFRESH_LABEL;

function nowStamp() {
  return new Date().toLocaleString();
}

function setText(node, txt) {
  if (node) node.textContent = String(txt ?? "");
}

function setHTML(node, html) {
  if (node) node.innerHTML = html;
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

async function postJSON(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // include body in error for debug
    throw new Error(`${res.status} ${res.statusText} :: ${text}`.trim());
  }

  // parse json
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error(`Invalid JSON from ${path} :: ${text}`.trim());
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} :: ${text}`.trim());
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error(`Invalid JSON from ${url} :: ${text}`.trim());
  }
}

/* ===== MAIN PANELS (unchanged visual cards) ===== */

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
        it.error ? ["Error", String(it.error)] : null,
      ].filter(Boolean)
    : [
        ["NodeID", shortId(it.nodeId ?? "—", 12)],
        ["Status", it.validationStatus ?? "—"],
        ["Staked (AVAX)", it.amountStakedAvax ?? "—"],
        ["Delegated (AVAX)", it.amountDelegatedAvax ?? "—"],
        ["Delegators", it.delegatorCount ?? "—"],
        ["Delegation Fee", it.delegationFeePct ?? "—"],
        ["Updated", it.updated ?? "—"],
        it.error ? ["Error", String(it.error)] : null,
      ].filter(Boolean);

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
    } else if (ethRes.status === "rejected") {
      console.warn("ETH main failed:", ethRes.reason);
    }

    if (avaxRes.status === "fulfilled" && avaxNodeIds.length) {
      renderGrid(el.avaxGrid, "avax", avaxRes.value?.validators || []);
    } else if (avaxRes.status === "rejected") {
      console.warn("AVAX main failed:", avaxRes.reason);
    }

    setText(el.lastUpdate, nowStamp());
    setText(el.statusLine, "Live");
  } catch (e) {
    console.warn(e);
    setText(el.statusLine, "Offline");
  }
}

/* ===== RIGHT SIDE: TEXT ONLY (DefiLlama) ===== */

async function refreshLlamaOne(chain, statusEl, outEl) {
  try {
    setText(statusEl, "loading…");

    const url = new URL("/api/llama", location.origin);
    url.searchParams.set("chain", chain);

    const d = await getJSON(url.toString());

    // Print only text; includes raw debug.
    const lines = [
      `Chain: ${String(d?.chain ?? chain)}`,
      `TVL current: ${String(d?.tvl?.current ?? "—")}`,
      `7d change %: ${String(d?.tvl?.change7dPct ?? "—")}`,
      `30d change %: ${String(d?.tvl?.change30dPct ?? "—")}`,
      `Updated: ${String(d?.updated ?? nowStamp())}`,
      ``,
      `DEBUG:`,
      `${escapeHtml(JSON.stringify(d, null, 2))}`,
    ];

    setHTML(outEl, `<pre style="white-space:pre-wrap;margin:0;">${lines.join("\n")}</pre>`);
    setText(statusEl, "live");
  } catch (e) {
    setText(statusEl, "error");
    setHTML(outEl, `<pre style="white-space:pre-wrap;margin:0;">ERROR:\n${escapeHtml(String(e?.message || e))}</pre>`);
  }
}

async function refreshLlamaPanels() {
  await Promise.all([
    refreshLlamaOne("Ethereum", el.ethTvlStatus, el.ethTvlOut),
    refreshLlamaOne("Avalanche", el.avaxTvlStatus, el.avaxTvlOut),
  ]);
}

/* ===== RIGHT SIDE: ETH LIVE (TEXT ONLY) ===== */

async function refreshEthLive() {
  const pk = state.liveEthPubkey;
  if (!pk) {
    setText(el.ethLiveStatus, "idle");
    setText(el.ethPkOut, "—");
    return;
  }

  try {
    setText(el.ethLiveStatus, "fetching…");

    const d = await postJSON("/api/eth", { pubkeys: [pk], includeBalanceSeries: false });
    const v = (d?.validators || [])[0];

    if (!v) {
      setText(el.ethLiveStatus, "no data");
      setText(el.ethPkOut, "No validator returned. (See console)");
      return;
    }

    const lines = [
      `Pubkey: ${String(v.pubkey ?? pk)}`,
      `Index: ${String(v.validatorId ?? "—")}`,
      `Status: ${String(v.status ?? "—")}`,
      `Online: ${String(v.online ?? "—")}`,
      `Balance ETH: ${String(v.balanceEth ?? "—")}`,
      `Effective ETH: ${String(v.effectiveBalanceEth ?? "—")}`,
      `Updated: ${String(v.updated ?? nowStamp())}`,
      v.error ? `ERROR: ${String(v.error)}` : "",
      ``,
      `DEBUG:`,
      `${escapeHtml(JSON.stringify(d, null, 2))}`,
    ].filter(Boolean);

    setHTML(el.ethPkOut, `<pre style="white-space:pre-wrap;margin:0;">${lines.join("\n")}</pre>`);
    setText(el.ethLiveStatus, "live");
  } catch (e) {
    setText(el.ethLiveStatus, "error");
    setHTML(el.ethPkOut, `<pre style="white-space:pre-wrap;margin:0;">ERROR:\n${escapeHtml(String(e?.message || e))}</pre>`);
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

function bindRightSideButtons() {
  if (el.ethTvlRefresh) el.ethTvlRefresh.addEventListener("click", () => refreshLlamaOne("Ethereum", el.ethTvlStatus, el.ethTvlOut));
  if (el.avaxTvlRefresh) el.avaxTvlRefresh.addEventListener("click", () => refreshLlamaOne("Avalanche", el.avaxTvlStatus, el.avaxTvlOut));

  if (el.ethPkApply && el.ethPkInput) {
    el.ethPkApply.addEventListener("click", async () => {
      const pk = sanitizeEthPubkey(el.ethPkInput.value);
      if (!pk) {
        setText(el.ethLiveStatus, "invalid");
        setText(el.ethPkOut, "Enter a valid 0x… public key.");
        return;
      }
      state.liveEthPubkey = pk;
      saveToLocalStorage();
      await refreshEthLive();
    });
  }
}

/* ===== tiny helper ===== */
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* ===== Boot ===== */

(async function boot() {
  loadFromLocalStorage();
  hydrateEditInputs();
  bindEditMode();
  bindRightSideButtons();

  await refreshMainPanels();
  await refreshLlamaPanels();
  await refreshEthLive();

  setInterval(() => { refreshMainPanels(); }, REFRESH_MS);
  setInterval(() => { refreshLlamaPanels(); }, LLAMA_REFRESH_MS);
  setInterval(() => { refreshEthLive(); }, LIVE_REFRESH_MS);
})();
