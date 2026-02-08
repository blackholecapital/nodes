const REFRESH_MS = 60_000;

function $(id){ return document.getElementById(id); }

function setText(id, v){
  const el = $(id);
  if (el) el.textContent = v ?? "—";
}

function fmtUsdShort(n){
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n){
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtRange(r){
  if (!r) return "—";
  const a = new Date(r.from);
  const b = new Date(r.to);
  return `${a.toLocaleDateString()}–${b.toLocaleDateString()}`;
}

function fmtUsdCompact(n){
  if (n == null) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `$${(x/1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(x/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x/1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(x/1e3).toFixed(2)}K`;
  return `$${x.toFixed(2)}`;
}

function fmtDateShort(ms){
  const d = new Date(ms);
  return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
}

function applyChartMeta(prefix, meta){
  if (!meta) return;
  setText(`${prefix}TvlNow`, `TVL: ${fmtUsdShort(meta.tvlNow)}`);
  setText(`${prefix}TvlChg30`, `30d: ${fmtPct(meta.tvlChg30)}`);
  setText(`${prefix}TvlRange`, `Range: ${fmtRange(meta.tvlRange)}`);
  setText(
    `${prefix}VolRange`,
    `Vol: ${fmtUsdShort(meta.volNow)} • ${fmtRange(meta.volRange)}`
  );
}

function setBadge(id, ok){
  // badges removed from UI; keep function as no-op
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

function cssVar(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v && v.trim()) ? v.trim() : fallback;
}

function setupCanvas(id){
  const c = $(id);
  if (!c) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  // Only resize when needed (prevents flicker)
  if (c.width !== Math.floor(w * dpr) || c.height !== Math.floor(h * dpr)){
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawLineChart(canvasId, points){
  const c = setupCanvas(canvasId);
  if (!c) return;
  const { ctx, w, h } = c;

  if (!Array.isArray(points) || points.length < 2){
    return;
  }

  const pad = 10;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const line = cssVar("--line", "rgba(0,255,170,.45)");
  const grid = cssVar("--line2", "rgba(0,255,170,.22)");
  const fg = cssVar("--fg", "#bfffe6");

  // reserve room for scale labels and x-axis dates
  const labelPadTop = 14;
  const labelPadBot = 16;

  const xFor = (x) => pad + ((x - minX) / Math.max(1, (maxX - minX))) * (w - pad*2);
  const yFor = (y) =>
    (h - pad - labelPadBot) -
    ((y - minY) / Math.max(1, (maxY - minY))) * (h - pad*2 - labelPadTop - labelPadBot);

  // baseline
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad - labelPadBot);
  ctx.lineTo(w - pad, h - pad - labelPadBot);
  ctx.stroke();

  // scale + date context text
  ctx.fillStyle = fg;
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

  // High / Low
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`H ${fmtUsdCompact(maxY)}`, pad, pad);
  ctx.textBaseline = "bottom";
  ctx.fillText(`L ${fmtUsdCompact(minY)}`, pad, h - pad);

  // Date range
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(fmtDateShort(minX), pad, h - pad);
  ctx.textAlign = "right";
  ctx.fillText(fmtDateShort(maxX), w - pad, h - pad);

  // reset
  ctx.textAlign = "left";

  // plot
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xFor(points[0].t), yFor(points[0].v));
  for (let i=1;i<points.length;i++){
    ctx.lineTo(xFor(points[i].t), yFor(points[i].v));
  }
  ctx.stroke();
}

function drawCandles(canvasId, candles){
  const c = setupCanvas(canvasId);
  if (!c) return;
  const { ctx, w, h } = c;

  if (!Array.isArray(candles) || candles.length < 2){
    return;
  }

  const pad = 10;
  const line = cssVar("--line", "rgba(0,255,170,.45)");
  const grid = cssVar("--line2", "rgba(0,255,170,.22)");
  const fg = cssVar("--fg", "#bfffe6");

  const lows = candles.map(c => c.l);
  const highs = candles.map(c => c.h);
  const minY = Math.min(...lows);
  const maxY = Math.max(...highs);

  const xStep = (w - pad*2) / Math.max(1, candles.length);
  const candleW = Math.max(2, Math.floor(xStep * 0.6));

  // reserve room for scale labels and x-axis dates
  const labelPadTop = 14;
  const labelPadBot = 16;

  const yFor = (y) =>
    (h - pad - labelPadBot) -
    ((y - minY) / Math.max(1, (maxY - minY))) * (h - pad*2 - labelPadTop - labelPadBot);

  // baseline grid
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad - labelPadBot);
  ctx.lineTo(w - pad, h - pad - labelPadBot);
  ctx.stroke();

  // scale + date context text
  ctx.fillStyle = fg;
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

  // High / Low
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`H ${fmtUsdCompact(maxY)}`, pad, pad);
  ctx.textBaseline = "bottom";
  ctx.fillText(`L ${fmtUsdCompact(minY)}`, pad, h - pad);

  // Date range
  const t0 = candles[0].t;
  const t1 = candles[candles.length - 1].t;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(fmtDateShort(t0), pad, h - pad);
  ctx.textAlign = "right";
  ctx.fillText(fmtDateShort(t1), w - pad, h - pad);

  // reset
  ctx.textAlign = "left";

  for (let i=0;i<candles.length;i++){
    const cdl = candles[i];
    const xMid = pad + xStep * i + xStep/2;

    const yH = yFor(cdl.h);
    const yL = yFor(cdl.l);
    const yO = yFor(cdl.o);
    const yC = yFor(cdl.c);

    // wick
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xMid, yH);
    ctx.lineTo(xMid, yL);
    ctx.stroke();

    // body
    const top = Math.min(yO, yC);
    const bot = Math.max(yO, yC);
    const x0 = Math.floor(xMid - candleW/2);

    ctx.fillStyle = (cdl.c >= cdl.o) ? fg : "rgba(0,0,0,.35)";
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;

    const bodyH = Math.max(1, bot - top);
    ctx.fillRect(x0, top, candleW, bodyH);
    ctx.strokeRect(x0 + 0.5, top + 0.5, candleW - 1, bodyH - 1);
  }
}

async function refreshAll(){
  setText("uiStatus", "Syncing…");

  try{
    const [eth, avax, ethCharts, avaxCharts] = await Promise.all([
      fetchJson(`/api/llama?chain=ethereum`),
      fetchJson(`/api/llama?chain=avalanche`),
      fetchJson(`/api/charts?chain=ethereum`),
      fetchJson(`/api/charts?chain=avalanche`)
    ]);

    applyChain("eth", eth);
    applyChain("avax", avax);

    // Charts (eye candy)
       drawLineChart("ethTvlChart", ethCharts.tvl);
    drawCandles("ethVolChart", ethCharts.volumeWeekly);
    applyChartMeta("eth", ethCharts.meta);

    drawLineChart("avaxTvlChart", avaxCharts.tvl);
    drawCandles("avaxVolChart", avaxCharts.volumeWeekly);
    applyChartMeta("avax", avaxCharts.meta);

    const ts = eth.updatedAt || avax.updatedAt || Date.now();
    const d = new Date(ts);
    setText("uiLastUpdate", d.toLocaleString());

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
