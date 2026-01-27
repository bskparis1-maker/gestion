const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyF1qbLnw0b9LfRbLwx1tvXqlc7RogHatoigJtG1EzjAUkOGRZNML4_UISB0oniqg/exec";
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
};

let state = {
  activeCurrency: "XOF",
  filterFrom: null,
  filterTo: null,
};

let balanceChart = null;
let categoryChart = null;

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

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

function isWithinFilter(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  if (state.filterFrom) {
    const from = new Date(state.filterFrom);
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
  if (!state.filterFrom && !state.filterTo) return data.transactions;
  return data.transactions.filter((t) => isWithinFilter(t.date));
}

// ---------- ENVOI GOOGLE SHEETS ----------

function sendToSheet(payload) {
  if (!SHEET_WEBHOOK_URL) return;

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error("Erreur envoi vers Sheets :", err);
  });
}

function sendTransactionToSheet(tx) {
  // tx = { type, amount, date, category, note }
  sendToSheet({
    kind: "transaction",
    ...tx,
  });
}

function sendCoffretEventToSheet(evt) {
  // evt = { action, name, goal?, amount?, balance? }
  sendToSheet({
    kind: "coffret",
    ...evt,
  });
}

function sendMetalsToSheet(metals) {
  // metals = { goldGrams, silverGrams }
  sendToSheet({
    kind: "metals",
    ...metals,
  });
}

function sendCryptoToSheet(cr) {
  // cr = { symbol, quantity, price }
  sendToSheet({
    kind: "crypto",
    ...cr,
  });
}
// ---------- RENDU : DASHBOARD ----------

function renderDashboard() {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`;

  const filtered = getFilteredTransactions();

  let total = 0;
  let monthIncome = 0;
  let monthExpense = 0;

  filtered.forEach((t) => {
    const amount = Number(t.amount) || 0;
    if (t.type === "income") {
      total += amount;
    } else {
      total -= amount;
    }

    if (getMonthKey(t.date) === currentKey) {
      if (t.type === "income") monthIncome += amount;
      else monthExpense += amount;
    }
  });

  const incomeFmt = formatByCurrency(monthIncome);
  const expenseFmt = formatByCurrency(monthExpense);
  const balanceFmt = formatByCurrency(total);

  document.getElementById("dash-income").textContent = incomeFmt.mainStr;
  document.getElementById("dash-income-detail").textContent = incomeFmt.detailStr;

  document.getElementById("dash-expense").textContent = expenseFmt.mainStr;
  document.getElementById("dash-expense-detail").textContent = expenseFmt.detailStr;

  document.getElementById("dash-balance").textContent = balanceFmt.mainStr;
  document.getElementById("dash-balance-detail").textContent = balanceFmt.detailStr;

  renderCharts();
}

// ---------- RENDU : TRANSACTIONS ----------

function renderTransactions() {
  const tbody = document.getElementById("transactions-body");
  tbody.innerHTML = "";

  // On garde l'index réel de chaque transaction
  const filtered = data.transactions
    .map((t, index) => ({ ...t, _index: index }))
    .filter((t) => isWithinFilter(t.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  filtered.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.type === "income" ? "Entrée" : "Sortie"}</td>
      <td>${formatNumber(t.amount)} FCFA</td>
      <td>${t.date}</td>
      <td>${t.category || ""}</td>
      <td>${t.note || ""}</td>
      <td>
        <button
          class="btn small danger delete-tx"
          data-index="${t._index}"
        >
          Supprimer
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Un seul écouteur pour tout le tableau (délégation d'événement)
  tbody.onclick = (e) => {
    const target = e.target;
    if (!target.classList.contains("delete-tx")) return;

    const idx = Number(target.dataset.index);
    if (Number.isNaN(idx)) return;

    const ok = confirm("Supprimer cette ligne ?");
    if (!ok) return;

    // On enlève la transaction du tableau principal
    data.transactions.splice(idx, 1);
    saveData();

    // On rafraîchit tout
    renderTransactions();
    renderDashboard();
  };
}

// ---------- RENDU : COFFRETS ----------

function renderCoffrets() {
  const list = document.getElementById("coffrets-list");
  const select = document.getElementById("coffret-select");

  list.innerHTML = "";
  select.innerHTML = `<option value="">Choisir un coffret</option>`;

  data.coffrets.forEach((c, index) => {
    const item = document.createElement("div");
    item.className = "coffret-item";
    const progress = c.goal > 0 ? Math.min((c.balance / c.goal) * 100, 100) : 0;

    item.innerHTML = `
      <div>
        <strong>${c.name}</strong><br/>
        <span>${formatNumber(c.balance)} / ${formatNumber(c.goal)} FCFA (${Math.round(
      progress
    )}%)</span>
      </div>
    `;
    list.appendChild(item);

    const opt = document.createElement("option");
    opt.value = index;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

// ---------- RENDU : METAUX ----------

function renderMetals() {
  const goldPriceXOF = 40000; // FCFA / g
  const silverPriceXOF = 500; // FCFA / g

  const goldValue = data.metals.goldGrams * goldPriceXOF;
  const silverValue = data.metals.silverGrams * silverPriceXOF;
  const total = goldValue + silverValue;

  const eur = total * data.rates.EUR;
  const usd = total * data.rates.USD;

  const el = document.getElementById("metals-value");
  el.textContent = `${formatNumber(total)} FCFA • ${formatNumber(
    eur
  )} € • ${formatNumber(usd)} $`;
}

// ---------- RENDU : CRYPTOS ----------

function renderCryptos() {
  const tbody = document.getElementById("crypto-body");
  const totalEl = document.getElementById("crypto-total");

  tbody.innerHTML = "";
  let total = 0;

  data.cryptos.forEach((c) => {
    const value = c.quantity * c.price;
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

// ---------- GRAPHIQUES (Chart.js) ----------

function renderCharts() {
  const lineCanvas = document.getElementById("balance-chart");
  const pieCanvas = document.getElementById("category-chart");
  if (!lineCanvas || !pieCanvas || typeof Chart === "undefined") return;

  const txs = getFilteredTransactions()
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Ligne : solde cumulé
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
  byDate.forEach((delta, date) => {
    cumulative += delta;
    lineLabels.push(date);
    lineData.push(convertXOFToActiveNumber(cumulative));
  });

  if (lineLabels.length === 0) {
    lineLabels.push("Aucune donnée");
    lineData.push(0);
  }

  // Camembert : dépenses par catégorie
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

  // palette pastel
  const pieColors = [
    "#34d399", // vert
    "#60a5fa", // bleu
    "#f472b6", // rose
    "#facc15", // jaune
    "#fb923c", // orange
    "#a78bfa", // violet
    "#4ade80", // vert clair
    "#fca5a5", // rouge clair
  ];

  // Création / maj graphique ligne
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
            pointHitRadius: 8,
            borderColor: "#22c55e",
            fill: true,
            backgroundColor: (context) => {
              const { chart } = context;
              const { ctx, chartArea } = chart;
              if (!chartArea) return "rgba(34, 197, 94, 0)"; // au premier rendu
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
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af" },
            grid: { display: false },
          },
          y: {
            ticks: { color: "#9ca3af" },
            grid: {
              color: "#111827",
            },
          },
        },
      },
    });
  } else {
    balanceChart.data.labels = lineLabels;
    balanceChart.data.datasets[0].data = lineData;
    balanceChart.update();
  }

  // Création / maj camembert
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

// ---------- NAV / CURRENCY / FILTRES ----------

function setupCurrencySwitch() {
  const buttons = document.querySelectorAll(".currency-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const cur = btn.dataset.currency;
      state.activeCurrency = cur;

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      renderDashboard();
    });
  });
}

function setupFilters() {
  const fromInput = document.getElementById("filter-from");
  const toInput = document.getElementById("filter-to");
  const applyBtn = document.getElementById("filter-apply");
  const resetBtn = document.getElementById("filter-reset");

  applyBtn.addEventListener("click", () => {
    state.filterFrom = fromInput.value || null;
    state.filterTo = toInput.value || null;
    renderDashboard();
    renderTransactions();
  });

  resetBtn.addEventListener("click", () => {
    state.filterFrom = null;
    state.filterTo = null;
    fromInput.value = "";
    toInput.value = "";
    renderDashboard();
    renderTransactions();
  });
}

// ---------- FORMULAIRES ----------

function setupTransactionForm() {
  const form = document.getElementById("transaction-form");
  const dateInput = form.querySelector('input[name="date"]');

  const today = new Date().toISOString().split("T")[0];
  dateInput.value = today;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    const type = fd.get("type");
    const amount = Number(fd.get("amount"));
    const date = fd.get("date");
    const category = fd.get("category");
    const note = fd.get("note");

    if (!date || isNaN(amount) || amount <= 0) {
      alert("Vérifie le montant et la date 😉");
      return;
    }

    const tx = { type, amount, date, category, note };

data.transactions.push(tx);
saveData();

// 🔁 envoi vers Google Sheets
sendTransactionToSheet(tx);

form.reset();
dateInput.value = today;

renderTransactions();
renderDashboard();
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
    const name = fd.get("name");
    const goal = Number(fd.get("goal"));

    if (!name || isNaN(goal) || goal <= 0) {
      alert("Nom ou objectif invalide");
      return;
    }

     data.coffrets.push({ name, goal, balance: 0 });
  saveData();

  // 🔁 sync Google Sheets : création coffret
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

    if (index === "") {
      alert("Choisis un coffret d'abord.");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      alert("Montant invalide.");
      return;
    }

      data.coffrets[index].balance += amount;
  const newBalance = data.coffrets[index].balance;
  const name = data.coffrets[index].name;

  amountInput.value = "";
  saveData();

  // 🔁 sync Google Sheets : ajout d'argent
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

    saveData();

    // 🔁 sync Google Sheets : patrimoine métaux
    sendMetalsToSheet({
      goldGrams: data.metals.goldGrams,
      silverGrams: data.metals.silverGrams,
    });

    renderMetals();
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

    if (!symbol || isNaN(quantity) || quantity < 0 || isNaN(price) || price <= 0) {
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

    saveData();

// 🔁 sync Google Sheets : crypto
sendCryptoToSheet({
  symbol,
  quantity,
  price,
});

form.reset();
renderCryptos();
  });
}

// ---------- INIT ----------

document.addEventListener("DOMContentLoaded", () => {
  loadData();

  setupCurrencySwitch();
  setupFilters();
  setupTransactionForm();
  setupCoffretForms();
  setupMetalsForm();
  setupCryptoForm();

  renderDashboard();
  renderTransactions();
  renderCoffrets();
  renderMetals();
  renderCryptos();
});