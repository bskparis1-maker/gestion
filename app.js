const SHEET_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbyF1qbLnw0b9LfRbLwx1tvXqlc7RogHatoigJtG1EzjAUkOGRZNML4_UISB0oniqg/exec";
console.log("app.js chargé ✅");

const STORAGE_KEY = "moneyflow-v1";

let data = {
  transactions: [],
  coffrets: [],
  metals: { goldGrams: 0, silverGrams: 0 },
  cryptos: [],
  rates: {
    // 1 FCFA = ...
    EUR: 0.0015,
    USD: 0.0017,
  },
  metalsHistory: [], // { date, totalXOF }
  cryptoHistory: [], // { date, totalXOF }
  budget: {
    period: "monthly",
    limit: 0,
  },
};

let state = {
  activeCurrency: "XOF",
  filterFrom: null,
  filterTo: null,
  txTypeFilter: "all", // ✅ all | income | expense
  quickRange: "custom", // ✅ custom | day | week | month | year
};

let balanceChart = null;
let categoryChart = null;
let metalsChart = null;
let cryptoChart = null;

// ---------- LOCALSTORAGE ----------

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    data = { ...data, ...parsed };
  } catch (e) {
    console.error("Erreur lecture localStorage :", e);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ---------- UTIL : DATE (corrige les dates Sheets type ...Z) ----------

function normalizeDate(dateVal) {
  const d = new Date(dateVal);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    return dateVal;
  }
  return "";
}

// ---------- SYNC LECTURE GOOGLE SHEETS (JSONP pour éviter CORS) ----------

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = `__cb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");

    const cleanup = () => {
      try {
        delete window[cbName];
      } catch {}
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP error"));
    };

    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cbName}`;
    document.body.appendChild(script);
  });
}

async function syncFromSheetOnStartup() {
  if (!SHEET_WEBHOOK_URL) return;

  try {
    const payload = await jsonp(`${SHEET_WEBHOOK_URL}?kind=all`);

    // transactions
    if (Array.isArray(payload.transactions) && data.transactions.length === 0) {
      data.transactions = payload.transactions
        .map((t) => ({ ...t, date: normalizeDate(t.date) }))
        .filter((t) => t.date);
    }

    // coffrets
    if (Array.isArray(payload.coffrets) && data.coffrets.length === 0) {
      data.coffrets = payload.coffrets;
    }

    // metals
    if (
      payload.metals &&
      data.metals.goldGrams === 0 &&
      data.metals.silverGrams === 0
    ) {
      data.metals = {
        goldGrams: Number(payload.metals.goldGrams) || 0,
        silverGrams: Number(payload.metals.silverGrams) || 0,
      };
    }

    // cryptos
    if (Array.isArray(payload.cryptos) && data.cryptos.length === 0) {
      data.cryptos = payload.cryptos;
    }

    // init historique si vide
    const today = new Date().toISOString().slice(0, 10);

    if (data.metalsHistory.length === 0) {
      const goldPriceXOF = 40000;
      const silverPriceXOF = 500;
      const total =
        (data.metals.goldGrams || 0) * goldPriceXOF +
        (data.metals.silverGrams || 0) * silverPriceXOF;
      if (total > 0) data.metalsHistory.push({ date: today, totalXOF: total });
    }

    if (data.cryptoHistory.length === 0) {
      const totalValue = (data.cryptos || []).reduce(
        (sum, c) => sum + (Number(c.quantity) || 0) * (Number(c.price) || 0),
        0
      );
      if (totalValue > 0)
        data.cryptoHistory.push({ date: today, totalXOF: totalValue });
    }

    saveData();
    console.log("Sync depuis Google Sheets ✅");
  } catch (err) {
    console.warn("Sync Google Sheets impossible (offline ou accès) :", err);
  }
}

// ---------- UTILITAIRES ----------

function formatNumber(n) {
  return Math.round(n).toLocaleString("fr-FR");
}

function formatByCurrency(amountXOF) {
  const xof = amountXOF || 0;
  const eur = xof * data.rates.EUR;
  const usd = xof * data.rates.USD;

  let mainStr;
  let detailStr;

  if (state.activeCurrency === "XOF") {
    mainStr = `${formatNumber(xof)} FCFA`;
    detailStr = `≈ ${formatNumber(eur)} € • ${formatNumber(usd)} $`;
  } else if (state.activeCurrency === "EUR") {
    mainStr = `${formatNumber(eur)} €`;
    detailStr = `≈ ${formatNumber(xof)} FCFA • ${formatNumber(usd)} $`;
  } else {
    mainStr = `${formatNumber(usd)} $`;
    detailStr = `≈ ${formatNumber(xof)} FCFA • ${formatNumber(eur)} €`;
  }

  return { mainStr, detailStr };
}

function convertXOFToActiveNumber(xof) {
  if (state.activeCurrency === "XOF") return xof;
  if (state.activeCurrency === "EUR") return xof * data.rates.EUR;
  return xof * data.rates.USD;
}

function isWithinFilter(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return false;

  if (state.filterFrom) {
    const from = new Date(state.filterFrom);
    from.setHours(0, 0, 0, 0);
    if (d < from) return false;
  }
  if (state.filterTo) {
    const to = new Date(state.filterTo);
    to.setHours(23, 59, 59, 999);
    if (d > to) return false;
  }
  return true;
}

function getFilteredTransactions() {
  const base = data.transactions || [];
  const byDate =
    !state.filterFrom && !state.filterTo
      ? base
      : base.filter((t) => isWithinFilter(t.date));

  // ✅ filtre type (all/income/expense) pour les graphiques et tableaux
  return state.txTypeFilter === "all"
    ? byDate
    : byDate.filter((t) => t.type === state.txTypeFilter);
}

// ---------- ENVOI GOOGLE SHEETS ----------

function sendToSheet(payload) {
  if (!SHEET_WEBHOOK_URL) return;

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Erreur envoi vers Sheets :", err));
}

function sendTransactionToSheet(tx) {
  sendToSheet({ kind: "transaction", ...tx });
}
function sendCoffretEventToSheet(evt) {
  sendToSheet({ kind: "coffret", ...evt });
}
function sendMetalsToSheet(metals) {
  sendToSheet({ kind: "metals", ...metals });
}
function sendCryptoToSheet(cr) {
  sendToSheet({ kind: "crypto", ...cr });
}

// ---------- BUDGET ----------

function computeExpenseSumForPeriod(period) {
  const now = new Date();
  let from = new Date(now);

  if (period === "weekly") {
    from.setDate(now.getDate() - 7);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  let sum = 0;
  data.transactions.forEach((t) => {
    if (t.type !== "expense") return;
    const d = new Date(t.date);
    if (isNaN(d)) return;
    if (d >= from && d <= now) sum += Number(t.amount) || 0;
  });
  return sum;
}

function renderBudgetInfo() {
  const info = document.getElementById("budget-info");
  if (!info || !data.budget || !data.budget.limit) {
    if (info) info.textContent = "Aucun budget défini pour le moment.";
    return;
  }

  const period = data.budget.period;
  const limit = data.budget.limit;
  const spent = computeExpenseSumForPeriod(period);
  const remaining = limit - spent;

  const periodText = period === "weekly" ? "cette semaine" : "ce mois";

  info.textContent =
    `Budget ${periodText} : ${formatNumber(limit)} FCFA • ` +
    `Dépensé : ${formatNumber(spent)} FCFA • ` +
    `Reste : ${formatNumber(Math.max(remaining, 0))} FCFA`;
}

function setupBudgetForm() {
  const form = document.getElementById("budget-form");
  if (!form) return;

  const periodSelect = document.getElementById("budget-period");
  if (data.budget && data.budget.limit) {
    periodSelect.value = data.budget.period || "monthly";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const period = fd.get("period");
    const limit = Number(fd.get("limit"));

    if (isNaN(limit) || limit <= 0) {
      alert("Montant de budget invalide.");
      return;
    }

    data.budget = { period, limit };
    saveData();
    renderBudgetInfo();
  });
}

// ---------- DASHBOARD (✅ respecte période De/À) ----------

function renderDashboard() {
  const filtered = getFilteredTransactions();

  let incomeSum = 0;
  let expenseSum = 0;

  filtered.forEach((t) => {
    const amount = Number(t.amount) || 0;
    if (t.type === "income") incomeSum += amount;
    else expenseSum += amount;
  });

  const net = incomeSum - expenseSum;

  const incomeFmt = formatByCurrency(incomeSum);
  const expenseFmt = formatByCurrency(expenseSum);
  const balanceFmt = formatByCurrency(net);

  document.getElementById("dash-income").textContent = incomeFmt.mainStr;
  document.getElementById("dash-income-detail").textContent = incomeFmt.detailStr;

  document.getElementById("dash-expense").textContent = expenseFmt.mainStr;
  document.getElementById("dash-expense-detail").textContent = expenseFmt.detailStr;

  document.getElementById("dash-balance").textContent = balanceFmt.mainStr;
  document.getElementById("dash-balance-detail").textContent = balanceFmt.detailStr;

  renderCharts();
}

// ---------- TRANSACTIONS (table + delete + filtre type) ----------

function renderTransactions() {
  const tbody = document.getElementById("transactions-body");
  tbody.innerHTML = "";

  const filtered = data.transactions
    .map((t, index) => ({ ...t, _index: index }))
    .filter((t) => isWithinFilter(t.date))
    .filter((t) =>
      state.txTypeFilter === "all" ? true : t.type === state.txTypeFilter
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  filtered.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.type === "income" ? "Entrée" : "Sortie"}</td>
      <td>${formatNumber(t.amount)} FCFA</td>
      <td>${normalizeDate(t.date)}</td>
      <td>${t.category || ""}</td>
      <td>${t.note || ""}</td>
      <td>
        <button class="btn small danger delete-tx" data-index="${t._index}">
          Supprimer
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.onclick = (e) => {
    const target = e.target;
    if (!target.classList.contains("delete-tx")) return;

    const idx = Number(target.dataset.index);
    if (Number.isNaN(idx)) return;

    const ok = confirm("Supprimer cette ligne ?");
    if (!ok) return;

    data.transactions.splice(idx, 1);
    saveData();

    renderTransactions();
    renderDashboard();
    renderBudgetInfo();
  };
}

// ✅ filtre tableau : Toutes / Entrées / Sorties
function setupTxTableFilter() {
  const sel = document.getElementById("tx-filter-type");
  if (!sel) return;

  sel.value = state.txTypeFilter || "all";
  sel.addEventListener("change", () => {
    state.txTypeFilter = sel.value;
    renderTransactions();
    renderDashboard(); // pour que stats + graphiques suivent le filtre
  });
}

// ---------- COFFRETS ----------

function renderCoffrets() {
  const list = document.getElementById("coffrets-list");
  const select = document.getElementById("coffret-select");
  if (!list || !select) return;

  list.innerHTML = "";
  select.innerHTML = `<option value="">Choisir un coffret</option>`;

  data.coffrets.forEach((c, index) => {
    const item = document.createElement("div");
    item.className = "coffret-item";
    const progress = c.goal > 0 ? Math.min((c.balance / c.goal) * 100, 100) : 0;

    item.innerHTML = `
      <div>
        <strong>${c.name}</strong><br/>
        <span>${formatNumber(c.balance)} / ${formatNumber(c.goal)} FCFA (${Math.round(progress)}%)</span>
      </div>
      <div>
        <button class="btn small" data-edit-index="${index}">Modifier</button>
      </div>
    `;
    list.appendChild(item);

    const opt = document.createElement("option");
    opt.value = index;
    opt.textContent = c.name;
    select.appendChild(opt);
  });

  list.querySelectorAll("button[data-edit-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.editIndex);
      const coffret = data.coffrets[idx];
      if (!coffret) return;

      const newName = prompt("Nouveau nom du coffret :", coffret.name);
      if (!newName) return;

      const newGoalStr = prompt(
        "Nouvel objectif (FCFA) :",
        coffret.goal.toString()
      );
      const newGoal = Number(newGoalStr);
      if (isNaN(newGoal) || newGoal <= 0) {
        alert("Objectif invalide.");
        return;
      }

      coffret.name = newName;
      coffret.goal = newGoal;
      saveData();
      renderCoffrets();

      sendCoffretEventToSheet({
        action: "update",
        name: newName,
        goal: newGoal,
        balance: coffret.balance,
      });
    });
  });
}

// ---------- METAUX ----------

function renderMetals() {
  const goldPriceXOF = 40000;
  const silverPriceXOF = 500;

  const total =
    (data.metals.goldGrams || 0) * goldPriceXOF +
    (data.metals.silverGrams || 0) * silverPriceXOF;

  const eur = total * data.rates.EUR;
  const usd = total * data.rates.USD;

  const el = document.getElementById("metals-value");
  el.textContent = `${formatNumber(total)} FCFA • ${formatNumber(
    eur
  )} € • ${formatNumber(usd)} $`;
}

// ---------- CRYPTOS ----------

function renderCryptos() {
  const tbody = document.getElementById("crypto-body");
  const totalEl = document.getElementById("crypto-total");

  tbody.innerHTML = "";
  let total = 0;

  data.cryptos.forEach((c) => {
    const value = (Number(c.quantity) || 0) * (Number(c.price) || 0);
    total += value;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.symbol}</td>
      <td>${c.quantity}</td>
      <td>${formatNumber(value)} FCFA</td>
    `;
    tbody.appendChild(tr);
  });

  const eur = total * data.rates.EUR;
  const usd = total * data.rates.USD;

  totalEl.textContent = `${formatNumber(total)} FCFA • ${formatNumber(
    eur
  )} € • ${formatNumber(usd)} $`;
}

// ---------- GRAPHIQUES DASHBOARD ----------

function renderCharts() {
  const lineCanvas = document.getElementById("balance-chart");
  const pieCanvas = document.getElementById("category-chart");
  if (!lineCanvas || !pieCanvas || typeof Chart === "undefined") return;

  const txs = getFilteredTransactions()
    .slice()
    .map((t) => ({ ...t, date: normalizeDate(t.date) }))
    .filter((t) => t.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // solde cumulé
  const byDate = new Map();
  txs.forEach((t) => {
    const d = t.date;
    const amount = Number(t.amount) || 0;
    const delta = t.type === "income" ? amount : -amount;
    byDate.set(d, (byDate.get(d) || 0) + delta);
  });

  const lineLabels = [];
  const lineData = [];
  let cumulative = 0;

  const entries = Array.from(byDate.entries()).sort(
    (a, b) => new Date(a[0]) - new Date(b[0])
  );
  entries.forEach(([date, delta]) => {
    cumulative += delta;
    lineLabels.push(date);
    lineData.push(convertXOFToActiveNumber(cumulative));
  });

  if (lineLabels.length === 0) {
    lineLabels.push("Aucune donnée");
    lineData.push(0);
  }

  // camembert (sorties par catégorie)
  const catMap = new Map();
  txs.forEach((t) => {
    if (t.type !== "expense") return;
    const amount = Number(t.amount) || 0;
    const cat = (t.category && t.category.toString().trim()) || "Autre";
    catMap.set(cat, (catMap.get(cat) || 0) + amount);
  });

  let pieLabels = [];
  let pieData = [];
  catMap.forEach((amount, cat) => {
    pieLabels.push(cat);
    pieData.push(convertXOFToActiveNumber(amount));
  });

  if (pieLabels.length === 0) {
    pieLabels = ["Aucune dépense"];
    pieData = [1];
  }

  const pieColors = [
    "#34d399",
    "#60a5fa",
    "#f472b6",
    "#facc15",
    "#fb923c",
    "#a78bfa",
    "#4ade80",
    "#fca5a5",
  ];

  if (!balanceChart) {
    const ctx = lineCanvas.getContext("2d");
    balanceChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: lineLabels,
        datasets: [
          {
            label: "Solde",
            data: lineData,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0,
            borderColor: "#22c55e",
            fill: true,
            backgroundColor: (context) => {
              const { chart } = context;
              const { ctx, chartArea } = chart;
              if (!chartArea) return "rgba(34, 197, 94, 0)";
              const gradient = ctx.createLinearGradient(
                0,
                chartArea.top,
                0,
                chartArea.bottom
              );
              gradient.addColorStop(0, "rgba(34, 197, 94, 0.35)");
              gradient.addColorStop(1, "rgba(34, 197, 94, 0)");
              return gradient;
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "#111827" } },
        },
      },
    });
  } else {
    balanceChart.data.labels = lineLabels;
    balanceChart.data.datasets[0].data = lineData;
    balanceChart.update();
  }

  if (!categoryChart) {
    categoryChart = new Chart(pieCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: pieLabels,
        datasets: [
          {
            data: pieData,
            backgroundColor: pieColors,
            borderColor: "#020617",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#e5e7eb", font: { size: 10 } },
          },
        },
      },
    });
  } else {
    categoryChart.data.labels = pieLabels;
    categoryChart.data.datasets[0].data = pieData;
    categoryChart.update();
  }
}

// ---------- GRAPHIQUES METAUX / CRYPTO ----------

function renderMetalsCryptoCharts() {
  if (typeof Chart === "undefined") return;

  const metalsCanvas = document.getElementById("metals-chart");
  const cryptoCanvas = document.getElementById("crypto-chart");

  if (metalsCanvas) {
    const labels = (data.metalsHistory || []).map((h) => normalizeDate(h.date));
    const values = (data.metalsHistory || []).map((h) =>
      convertXOFToActiveNumber(h.totalXOF)
    );

    if (!metalsChart) {
      metalsChart = new Chart(metalsCanvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Valeur métaux",
              data: values,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              borderColor: "#facc15",
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
            y: { ticks: { color: "#9ca3af" }, grid: { color: "#111827" } },
          },
        },
      });
    } else {
      metalsChart.data.labels = labels;
      metalsChart.data.datasets[0].data = values;
      metalsChart.update();
    }
  }

  if (cryptoCanvas) {
    const labels = (data.cryptoHistory || []).map((h) => normalizeDate(h.date));
    const values = (data.cryptoHistory || []).map((h) =>
      convertXOFToActiveNumber(h.totalXOF)
    );

    if (!cryptoChart) {
      cryptoChart = new Chart(cryptoCanvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Valeur crypto",
              data: values,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              borderColor: "#3b82f6",
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
            y: { ticks: { color: "#9ca3af" }, grid: { color: "#111827" } },
          },
        },
      });
    } else {
      cryptoChart.data.labels = labels;
      cryptoChart.data.datasets[0].data = values;
      cryptoChart.update();
    }
  }
}

// ---------- UI : devise / filtres / catégories ----------

function setupCurrencySwitch() {
  const buttons = document.querySelectorAll(".currency-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeCurrency = btn.dataset.currency;
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      renderDashboard();
      renderMetalsCryptoCharts();
      renderBudgetInfo();
    });
  });
}

// ✅ filtres avec quick-range (jour/semaine/mois/année)
function setupFilters() {
  const fromInput = document.getElementById("filter-from");
  const toInput = document.getElementById("filter-to");
  const applyBtn = document.getElementById("filter-apply");
  const resetBtn = document.getElementById("filter-reset");
  const quick = document.getElementById("quick-range");

  function setRange(mode) {
    const ref = toInput.value ? new Date(toInput.value) : new Date();
    const to = new Date(ref);
    to.setHours(23, 59, 59, 999);

    let from = new Date(ref);

    if (mode === "day") {
      from.setHours(0, 0, 0, 0);
    } else if (mode === "week") {
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
    } else if (mode === "month") {
      from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    } else if (mode === "year") {
      from = new Date(ref.getFullYear(), 0, 1);
    } else {
      return;
    }

    fromInput.value = from.toISOString().slice(0, 10);
    toInput.value = ref.toISOString().slice(0, 10);
  }

  if (quick) {
    quick.addEventListener("change", () => {
      state.quickRange = quick.value;
      if (state.quickRange !== "custom") {
        setRange(state.quickRange);
      }
    });
  }

  applyBtn.addEventListener("click", () => {
    state.filterFrom = fromInput.value || null;
    state.filterTo = toInput.value || null;

    renderDashboard();
    renderTransactions();
    renderBudgetInfo();
  });

  resetBtn.addEventListener("click", () => {
    state.filterFrom = null;
    state.filterTo = null;
    state.quickRange = "custom";

    fromInput.value = "";
    toInput.value = "";

    if (quick) quick.value = "custom";

    renderDashboard();
    renderTransactions();
    renderBudgetInfo();
  });
}

const EXPENSE_CATEGORIES = [
  "dépense boutique",
  "dépense maison",
  "GP",
  "achat Chine",
  "livraison Chine",
  "école enfants",
  "voyage affaire",
  "autres",
];

const INCOME_CATEGORIES = [
  "recettes Dkr",
  "recettes marché",
  "vente en gros",
  "BSK couture",
  "autres",
];

function fillCategorySelect(type) {
  const select = document.getElementById("tx-category");
  const otherInput = document.getElementById("tx-category-other");
  if (!select) return;

  const categories = type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  select.innerHTML = "";

  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });

  if (select.value === "autres") otherInput.style.display = "block";
  else {
    otherInput.style.display = "none";
    otherInput.value = "";
  }
}

// ---------- FORMULAIRES ----------

function setupTransactionForm() {
  const form = document.getElementById("transaction-form");
  const typeSelect = document.getElementById("tx-type");
  const categorySelect = document.getElementById("tx-category");
  const otherInput = document.getElementById("tx-category-other");
  const dateInput = form.querySelector('input[name="date"]');

  fillCategorySelect("income");

  typeSelect.addEventListener("change", () =>
    fillCategorySelect(typeSelect.value)
  );
  categorySelect.addEventListener("change", () => {
    if (categorySelect.value === "autres") otherInput.style.display = "block";
    else {
      otherInput.style.display = "none";
      otherInput.value = "";
    }
  });

  const today = new Date().toISOString().split("T")[0];
  dateInput.value = today;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const type = fd.get("type");
    const rawAmount = Number(fd.get("amount"));
    const currency = fd.get("currency");
    const date = fd.get("date");
    let category = fd.get("category");
    const note = fd.get("note");

    if (!date || isNaN(rawAmount) || rawAmount <= 0) {
      alert("Vérifie le montant et la date 😉");
      return;
    }

    if (category === "autres") {
      const custom = otherInput.value.trim();
      if (custom) category = custom;
    }

    let amountXOF = rawAmount;
    if (currency === "EUR") amountXOF = rawAmount / data.rates.EUR;
    else if (currency === "USD") amountXOF = rawAmount / data.rates.USD;

    const tx = {
      type,
      amount: amountXOF,
      date: normalizeDate(date),
      category,
      note,
      originalAmount: rawAmount,
      originalCurrency: currency,
    };

    data.transactions.push(tx);
    saveData();
    sendTransactionToSheet(tx);

    form.reset();
    typeSelect.value = "income";
    fillCategorySelect("income");
    dateInput.value = today;

    renderTransactions();
    renderDashboard();
    renderBudgetInfo();
  });
}

function setupCoffretForms() {
  const createForm = document.getElementById("coffret-create-form");
  const select = document.getElementById("coffret-select");
  const amountInput = document.getElementById("coffret-amount");
  const addBtn = document.getElementById("coffret-add");

  createForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(createForm);
    const name = (fd.get("name") || "").toString().trim();
    const goal = Number(fd.get("goal"));

    if (!name || isNaN(goal) || goal <= 0) {
      alert("Nom ou objectif invalide");
      return;
    }

    data.coffrets.push({ name, goal, balance: 0 });
    saveData();

    sendCoffretEventToSheet({
      action: "create",
      name,
      goal,
      amount: 0,
      balance: 0,
    });

    createForm.reset();
    renderCoffrets();
  });

  addBtn.addEventListener("click", () => {
    const index = select.value;
    const amount = Number(amountInput.value);

    if (index === "") return alert("Choisis un coffret d'abord.");
    if (isNaN(amount) || amount <= 0) return alert("Montant invalide.");

    data.coffrets[index].balance += amount;
    const newBalance = data.coffrets[index].balance;
    const name = data.coffrets[index].name;

    amountInput.value = "";
    saveData();

    sendCoffretEventToSheet({
      action: "deposit",
      name,
      amount,
      balance: newBalance,
    });

    renderCoffrets();
  });
}

function setupMetalsForm() {
  const form = document.getElementById("metals-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const gold = Number(fd.get("gold"));
    const silver = Number(fd.get("silver"));

    data.metals.goldGrams = isNaN(gold) ? 0 : gold;
    data.metals.silverGrams = isNaN(silver) ? 0 : silver;

    const goldPriceXOF = 40000;
    const silverPriceXOF = 500;
    const total =
      data.metals.goldGrams * goldPriceXOF +
      data.metals.silverGrams * silverPriceXOF;

    const today = new Date().toISOString().slice(0, 10);
    data.metalsHistory.push({ date: today, totalXOF: total });

    saveData();
    sendMetalsToSheet({
      goldGrams: data.metals.goldGrams,
      silverGrams: data.metals.silverGrams,
    });

    renderMetals();
    renderMetalsCryptoCharts();
  });
}

function setupCryptoForm() {
  const form = document.getElementById("crypto-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const symbol = (fd.get("symbol") || "").toUpperCase();
    const quantity = Number(fd.get("amount"));
    const price = Number(fd.get("price"));

    if (
      !symbol ||
      isNaN(quantity) ||
      quantity < 0 ||
      isNaN(price) ||
      price <= 0
    ) {
      alert("Vérifie les infos crypto.");
      return;
    }

    const existing = data.cryptos.find((c) => c.symbol === symbol);
    if (existing) {
      existing.quantity = quantity;
      existing.price = price;
    } else {
      data.cryptos.push({ symbol, quantity, price });
    }

    const totalValue = data.cryptos.reduce(
      (sum, c) => sum + (Number(c.quantity) || 0) * (Number(c.price) || 0),
      0
    );
    const today = new Date().toISOString().slice(0, 10);
    data.cryptoHistory.push({ date: today, totalXOF: totalValue });

    saveData();
    sendCryptoToSheet({ symbol, quantity, price });

    form.reset();
    renderCryptos();
    renderMetalsCryptoCharts();
  });
}

// ---------- INIT ----------

document.addEventListener("DOMContentLoaded", async () => {
  loadData();

  // Si le navigateur efface localStorage, on récupère depuis Sheets
  await syncFromSheetOnStartup();

  setupCurrencySwitch();
  setupFilters();
  setupTxTableFilter(); // ✅
  setupTransactionForm();
  setupCoffretForms();
  setupMetalsForm();
  setupCryptoForm();
  setupBudgetForm();

  renderDashboard();
  renderTransactions();
  renderCoffrets();
  renderMetals();
  renderCryptos();
  renderBudgetInfo();
  renderMetalsCryptoCharts();
});
