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
  "NodeID-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "NodeID-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
  "NodeID-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
  "NodeID-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
];

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_LABEL = "5:00";

const LS_KEYS = {
  eth: "gotnodes.eth.validators",
  avax: "gotnodes.avax.nodeids",
};

const state = {
  eth: [...DEFAULT_ETH_VALIDATORS],
  avax: [...DEFAULT_AVAX_NODE_IDS],
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

    if (ethRaw) {
      const ethList = JSON.parse(ethRaw);
      if (Array.isArray(ethList) && ethList.length) state.eth = ethList;
    }
    if (avaxRaw) {
      const avaxList = JSON.parse(avaxRaw);
      if (Array.isArray(avaxList) && avaxList.length) state.avax = avaxList;
    }
  } catch (e) {
    console.warn("localStorage load failed:", e);
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEYS.eth, JSON.stringify(state.eth));
    localStorage.setItem(LS_KEYS.avax, JSON.stringify(state.avax));
  } catch (e) {
    console.warn("localStorage save failed:", e);
  }
}

function hydrateEditInputs() {
  el.ethInput.value = state.eth.join("\n");
  el.avaxInput.value = state.avax.join("\n");
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

  const [eth, avax] = await Promise.all([
    postJSON("/api/eth", { validators: ethIds, window: "30d" }),
    postJSON("/api/avax", { nodeIds: avaxIds }),
  ]);

  renderCards(el.ethGrid, eth.validators || [], "eth");
  renderCards(el.avaxGrid, avax.validators || [], "avax");

  el.lastUpdate.textContent = nowStamp();
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

(async function boot() {
  loadFromLocalStorage();
  hydrateEditInputs();
  bindEditMode();

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
})();
