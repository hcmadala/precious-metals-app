// Price history and NY Close baseline both come from the server.
// This means every device — phone, laptop, recruiter's desktop — shows
// the exact same sparkline AND the exact same daily change figure.

let history  = { XAU: [], XAG: [], XPT: [], XPD: [] };
let nyClose  = { XAU: null, XAG: null, XPT: null, XPD: null };
let lastPrice = {};

// ─── Main fetch ──────────────────────────────────────────────────────────────
async function fetchAndUpdatePrices() {
  let data;

  try {
    const response = await fetch("/prices");
    data = await response.json();
  } catch (e) {
    data = {
      XAU: 4700, XAG: 73, XPT: 2000, XPD: 1530,
      history: { XAU: [], XAG: [], XPT: [], XPD: [] },
      nyClose: { XAU: null, XAG: null, XPT: null, XPD: null }
    };
  }

  // Store NY Close prices from server — same on every device
  if (data.nyClose) nyClose = data.nyClose;

  // Use server-supplied history. Append current price so chart ends at "now".
  const serverHistory = data.history || { XAU: [], XAG: [], XPT: [], XPD: [] };
  for (const code of ["XAU", "XAG", "XPT", "XPD"]) {
    const pts = Array.isArray(serverHistory[code]) ? [...serverHistory[code]] : [];
    if (data[code] != null) {
      if (pts.length === 0 || pts[pts.length - 1] !== data[code]) pts.push(data[code]);
    }
    history[code] = pts;
  }

  // Store latest prices for pricing.js (cart / product page calculations)
  localStorage.setItem("latest_prices", JSON.stringify({
    XAU: data.XAU, XAG: data.XAG, XPT: data.XPT, XPD: data.XPD
  }));

  updateMetal("gold",      "XAU", data);
  updateMetal("silver",    "XAG", data);
  updateMetal("platinum",  "XPT", data);
  updateMetal("palladium", "XPD", data);
}

// ─── Per-metal DOM update ────────────────────────────────────────────────────
function updateMetal(name, code, data) {
  const priceElement  = document.getElementById(name + "-price");
  if (!priceElement) return;

  const changeElement = document.getElementById(name + "-change");
  const arrowElement  = document.getElementById(name + "-arrow");
  const canvas        = document.getElementById(name + "-chart");
  const card          = priceElement.closest(".metal-card");

  const price = data[code];
  if (price == null) return;

  drawSparkline(code, canvas);

  // ── Daily change vs NY Close ──────────────────────────────────────────────
  const base    = nyClose[code] ?? (history[code].length > 0 ? history[code][0] : price);
  const diff    = price - base;
  const pctDiff = base > 0 ? (diff / base) * 100 : 0;
  const sign    = diff >= 0 ? "+" : "-";

  priceElement.innerText  = "$" + price.toFixed(2);
  changeElement.innerText = `${sign}$${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pctDiff).toFixed(2)}%)`;

  if (diff > 0) {
    arrowElement.innerText  = "▲";
    arrowElement.className  = "arrow positive";
    changeElement.className = "metal-change positive";
  } else if (diff < 0) {
    arrowElement.innerText  = "▼";
    arrowElement.className  = "arrow negative";
    changeElement.className = "metal-change negative";
  } else {
    arrowElement.innerText  = "•";
    arrowElement.className  = "arrow unchanged";
    changeElement.className = "metal-change unchanged";
  }

  // Flash card on price tick
  if (lastPrice[code] !== undefined && card) {
    if (price > lastPrice[code]) {
      card.classList.remove("flash-red");
      card.classList.add("flash-green");
    } else if (price < lastPrice[code]) {
      card.classList.remove("flash-green");
      card.classList.add("flash-red");
    }
    setTimeout(() => card.classList.remove("flash-green", "flash-red"), 400);
  }

  lastPrice[code] = price;
}

// ─── Sparkline renderer ───────────────────────────────────────────────────────
function drawSparkline(code, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const width  = canvas.width  = canvas.offsetWidth;
  const height = canvas.height = canvas.offsetHeight;
  ctx.clearRect(0, 0, width, height);

  const prices = history[code];
  if (!prices || prices.length < 2) return;

  const min   = Math.min(...prices);
  const max   = Math.max(...prices);
  let   range = max - min;
  if (range < 0.01) range = 0.01;

  const points = prices.map((p, i) => ({
    x: (i / (prices.length - 1)) * width,
    y: height - ((p - min) / range) * height
  }));

  const upTrend = prices[prices.length - 1] >= prices[0];

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2;
    const yc = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
  }
  const last = points.length - 1;
  ctx.quadraticCurveTo(points[last-1].x, points[last-1].y, points[last].x, points[last].y);

  ctx.lineWidth   = 2;
  ctx.strokeStyle = upTrend ? "#4ADE80" : "#F87171";
  ctx.lineJoin    = "round";
  ctx.lineCap     = "round";
  ctx.stroke();
}

// ─── Visibility change ────────────────────────────────────────────────────────
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) fetchAndUpdatePrices();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
fetchAndUpdatePrices();
setInterval(fetchAndUpdatePrices, 10 * 1000);