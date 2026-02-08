/**
 * GOT NODES — 4-card rail (layout first)
 * Text-only content placeholders.
 * No charts, no validator logic.
 */

const REFRESH_MS = 60 * 1000;
const REFRESH_LABEL = "1:00";

const el = {
  refreshEvery: document.getElementById("refreshEvery"),
  lastUpdate: document.getElementById("lastUpdate"),
  statusLine: document.getElementById("statusLine"),
  refreshAll: document.getElementById("refreshAll"),

  // ETH top
  ethTopMini: document.getElementById("ethTopMini"),
  ethTopStatus: document.getElementById("ethTopStatus"),
  ethTopError: document.getElementById("ethTopError"),
  ethTopBadge: document.getElementById("ethTopBadge"),
  ethTopFrameNote: document.getElementById("ethTopFrameNote"),

  // AVAX top
  avaxTopMini: document.getElementById("avaxTopMini"),
  avaxTopStatus: document.getElementById("avaxTopStatus"),
  avaxTopError: document.getElementById("avaxTopError"),
  avaxTopBadge: document.getElementById("avaxTopBadge"),
  avaxTopFrameNote: document.getElementById("avaxTopFrameNote"),

  // ETH bottom
  ethBottomMini: document.getElementById("ethBottomMini"),
  ethBottomStatus: document.getElementById("ethBottomStatus"),
  ethBottomError: document.getElementById("ethBottomError"),
  ethBottomBadge: document.getElementById("ethBottomBadge"),

  // AVAX bottom
  avaxBottomMini: document.getElementById("avaxBottomMini"),
  avaxBottomStatus: document.getElementById("avaxBottomStatus"),
  avaxBottomError: document.getElementById("avaxBottomError"),
  avaxBottomBadge: document.getElementById("avaxBottomBadge"),
};

if (el.refreshEvery) el.refreshEvery.textContent = REFRESH_LABEL;

function nowStamp() {
  return new Date().toLocaleString();
}

function miniRow(k, v) {
  return `<div class="mini-row"><span class="muted">${k}</span><span class="mono">${v}</span></div>`;
}

function clearError(errEl) {
  if (!errEl) return;
  errEl.style.display = "none";
  errEl.textContent = "";
}

function setError(errEl, statusEl, badgeEl, msg) {
  if (errEl) {
    errEl.style.display = "block";
    errEl.textContent = msg;
  }
  if (statusEl) statusEl.textContent = "error";
  if (badgeEl) badgeEl.textContent = "OFFLINE";
}

function renderLoading(miniEl, statusEl, badgeEl) {
  if (miniEl) miniEl.innerHTML = [
    miniRow("TVL", "—"),
    miniRow("30d", "—"),
    miniRow("1y", "—"),
    miniRow("Vol (30d)", "—"),
  ].join("");
  if (statusEl) statusEl.textContent = "loading…";
  if (badgeEl) badgeEl.textContent = "SYNC";
}

function renderTopCard(miniEl, statusEl, badgeEl, errEl, frameNoteEl, chainLabel) {
  // Placeholder text rows shaped like your example (until we wire real data)
  if (miniEl) miniEl.innerHTML = [
    miniRow("TVL", "—"),
    miniRow("30d", "—"),
    miniRow("1y", "—"),
    miniRow("Vol (30d)", "—"),
  ].join("");

  if (frameNoteEl) frameNoteEl.textContent = "365 pts (placeholder)";
  if (statusEl) statusEl.textContent = "idle";
  if (badgeEl) badgeEl.textContent = "LIVE";
  clearError(errEl);
}

function renderBottomCard(miniEl, statusEl, badgeEl, errEl, chainLabel) {
  // Placeholder token detail rows like your example’s bottom cards
  if (miniEl) miniEl.innerHTML = [
    miniRow("Chain", chainLabel),
    miniRow("Token ID", "—"),
    miniRow("Coin key", "—"),
    miniRow("Price (DefiLlama)", "—"),
    miniRow("Confidence", "—"),
    miniRow("Updated", nowStamp()),
  ].join("");

  if (statusEl) statusEl.textContent = "idle";
  if (badgeEl) badgeEl.textContent = "LIVE";
  clearError(errEl);
}

async function refreshAll() {
  if (el.statusLine) el.statusLine.textContent = "Fetching…";

  // show immediate placeholders so layout is stable
  renderLoading(el.ethTopMini, el.ethTopStatus, el.ethTopBadge);
  renderLoading(el.avaxTopMini, el.avaxTopStatus, el.avaxTopBadge);

  // layout-first: just render placeholders into all 4 cards
  try {
    renderTopCard(el.ethTopMini, el.ethTopStatus, el.ethTopBadge, el.ethTopError, el.ethTopFrameNote, "ETHEREUM");
    renderTopCard(el.avaxTopMini, el.avaxTopStatus, el.avaxTopBadge, el.avaxTopError, el.avaxTopFrameNote, "AVALANCHE");
    renderBottomCard(el.ethBottomMini, el.ethBottomStatus, el.ethBottomBadge, el.ethBottomError, "Ethereum");
    renderBottomCard(el.avaxBottomMini, el.avaxBottomStatus, el.avaxBottomBadge, el.avaxBottomError, "Avalanche");
  } catch (e) {
    setError(el.ethTopError, el.ethTopStatus, el.ethTopBadge, String(e?.message || e));
    setError(el.avaxTopError, el.avaxTopStatus, el.avaxTopBadge, String(e?.message || e));
    setError(el.ethBottomError, el.ethBottomStatus, el.ethBottomBadge, String(e?.message || e));
    setError(el.avaxBottomError, el.avaxBottomStatus, el.avaxBottomBadge, String(e?.message || e));
  }

  if (el.lastUpdate) el.lastUpdate.textContent = nowStamp();
  if (el.statusLine) el.statusLine.textContent = "Live";
}

(function boot() {
  if (el.refreshAll) el.refreshAll.addEventListener("click", refreshAll);
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
})();
