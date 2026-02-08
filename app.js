/**
 * GOT NODES — layout-first, text-only feeds
 *
 * FULL DELETE:
 * - per-validator tracking UI
 * - validator edit mode / grids
 * - charts / canvas
 *
 * KEEP:
 * - two right-side wireframe cards matching BridgeCard.css
 * - text-only metrics, fed by /api/llama (for now placeholders match example rows)
 */

const REFRESH_MS = 60 * 1000; // 1 minute
const REFRESH_LABEL = "1:00";

const el = {
  refreshEvery: document.getElementById("refreshEvery"),
  lastUpdate: document.getElementById("lastUpdate"),
  statusLine: document.getElementById("statusLine"),
  refreshAll: document.getElementById("refreshAll"),

  ethMini: document.getElementById("ethMini"),
  ethStatus: document.getElementById("ethStatus"),
  ethError: document.getElementById("ethError"),
  ethBadge: document.getElementById("ethBadge"),

  avaxMini: document.getElementById("avaxMini"),
  avaxStatus: document.getElementById("avaxStatus"),
  avaxError: document.getElementById("avaxError"),
  avaxBadge: document.getElementById("avaxBadge"),
};

if (el.refreshEvery) el.refreshEvery.textContent = REFRESH_LABEL;

function nowStamp() {
  return new Date().toLocaleString();
}

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

function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}%`;
}

async function getJSON(url) {
  const res = await fetch(url);
  const txt = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${txt}`.trim());
  try {
    return JSON.parse(txt || "{}");
  } catch {
    throw new Error(`Invalid JSON :: ${txt}`.trim());
  }
}

function miniRow(k, v) {
  return `<div class="mini-row"><span class="muted">${k}</span><span class="mono">${v}</span></div>`;
}

function setError(errEl, statusEl, badgeEl, msg) {
  if (errEl) {
    errEl.style.display = "block";
    errEl.textContent = msg;
  }
  if (statusEl) statusEl.textContent = "error";
  if (badgeEl) badgeEl.textContent = "OFFLINE";
}

function clearError(errEl) {
  if (errEl) {
    errEl.style.display = "none";
    errEl.textContent = "";
  }
}

function renderCard(miniEl, statusEl, badgeEl, errEl, data) {
  // Text-only rows shaped like your example.
  // We will later replace these rows with ETH validator total metrics / % locked, etc.
  const tvl = fmtUSD(data?.tvl?.current);
  const d30 = fmtPct(data?.tvl?.change30dPct);
  const d7 = fmtPct(data?.tvl?.change7dPct);

  const html = [
    miniRow("TVL", tvl),
    miniRow("30d", d30),
    miniRow("7d", d7),
    miniRow("Updated", data?.updated || nowStamp()),
  ].join("");

  if (miniEl) miniEl.innerHTML = html;

  if (statusEl) statusEl.textContent = "live";
  if (badgeEl) badgeEl.textContent = "LIVE";
  clearError(errEl);
}

async function refreshOne(chain, refs) {
  const url = new URL("/api/llama", location.origin);
  url.searchParams.set("chain", chain);

  try {
    if (refs.statusEl) refs.statusEl.textContent = "loading…";
    if (refs.badgeEl) refs.badgeEl.textContent = "SYNC";

    const data = await getJSON(url.toString());
    renderCard(refs.miniEl, refs.statusEl, refs.badgeEl, refs.errEl, data);
  } catch (e) {
    setError(refs.errEl, refs.statusEl, refs.badgeEl, String(e?.message || e));
  }
}

async function refreshAll() {
  if (el.statusLine) el.statusLine.textContent = "Fetching…";

  await Promise.allSettled([
    refreshOne("Ethereum", { miniEl: el.ethMini, statusEl: el.ethStatus, badgeEl: el.ethBadge, errEl: el.ethError }),
    refreshOne("Avalanche", { miniEl: el.avaxMini, statusEl: el.avaxStatus, badgeEl: el.avaxBadge, errEl: el.avaxError }),
  ]);

  if (el.lastUpdate) el.lastUpdate.textContent = nowStamp();
  if (el.statusLine) el.statusLine.textContent = "Live";
}

(function boot() {
  if (el.refreshAll) el.refreshAll.addEventListener("click", refreshAll);
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
})();
