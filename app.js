const REFRESH_MS = 60_000;

function $(id){ return document.getElementById(id); }

function setText(id, v){
  const el = $(id);
  if (el) el.textContent = v ?? "—";
}

function setBadge(id, ok){
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? "LIVE" : "SYNC";
}

function fmtNumber(n){
  if (n === null || n === undefined) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toLocaleString();
}

function fmtPct(n){
  if (n === null || n === undefined) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return `${x.toFixed(2)}%`;
}

async function fetchJson(url){
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function applyChain(prefix, data){
  // expected shape:
  // {
  //   activeValidators, totalStaked, apr,
  //   entryQueue, exitQueue, churnLimit,
  //   updatedAt
  // }
  setText(`${prefix}Active`, fmtNumber(data.activeValidators));
  setText(`${prefix}Staked`, data.totalStaked ?? "—");
  setText(`${prefix}Apr`, fmtPct(data.apr));
  setText(`${prefix}Entry`, data.entryQueue ?? "—");
  setText(`${prefix}Exit`, data.exitQueue ?? "—");
  setText(`${prefix}Churn`, data.churnLimit ?? "—");
}

async function refreshAll(){
  setText("uiStatus", "Syncing…");
  setBadge("ethBadge", false);
  setBadge("avaxBadge", false);

  try{
    const [eth, avax] = await Promise.all([
      fetchJson(`/api/llama?chain=ethereum`),
      fetchJson(`/api/llama?chain=avalanche`)
    ]);

    applyChain("eth", eth);
    applyChain("avax", avax);

    const ts = eth.updatedAt || avax.updatedAt || Date.now();
    const d = new Date(ts);
    setText("uiLastUpdate", d.toLocaleString());

    setBadge("ethBadge", true);
    setBadge("avaxBadge", true);
    setText("uiStatus", "Live");
  }catch(e){
    // keep whatever was on screen, just mark status
    setText("uiStatus", "Error");
  }
}

function startTimer(){
  let left = Math.floor(REFRESH_MS / 1000);
  setText("uiRefresh", `1:00`);

  setInterval(() => {
    left -= 1;
    if (left <= 0) left = Math.floor(REFRESH_MS / 1000);

    const m = Math.floor(left / 60);
    const s = left % 60;
    setText("uiRefresh", `${m}:${String(s).padStart(2,"0")}`);
  }, 1000);
}

window.addEventListener("DOMContentLoaded", () => {
  const btn = $("btnRefresh");
  if (btn){
    btn.addEventListener("click", () => refreshAll());
  }
  startTimer();
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
});
