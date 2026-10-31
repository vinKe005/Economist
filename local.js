// Economist — versão independente para celular.
// Substitui o backend Rust/Tauri: as mesmas regras de src/finance.rs, rodando no próprio
// aparelho, com os dados guardados no IndexedDB (não saem do celular).
(function () {
  "use strict";

  var MAX_AMOUNT = 100000000000; // centavos
  var MAX_BACKUP = 20 * 1024 * 1024;
  var KINDS = ["income", "fixed", "variable", "debt", "reserve"];

  // ---------------- Armazenamento (IndexedDB) ----------------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open("economist", 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        d.createObjectStore("entries", { keyPath: "id" });
        d.createObjectStore("budgets", { keyPath: "month" });
        d.createObjectStore("safety", { keyPath: "stamp" }); // cópias antes de restaurar
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject("Não foi possível abrir o armazenamento deste celular."); };
    });
    return dbp;
  }
  function done(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () { res(); };
      tx.onerror = tx.onabort = function () { rej("Erro ao salvar no celular: " + (tx.error && tx.error.message)); };
    });
  }
  function all(store) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var r = d.transaction(store).objectStore(store).getAll();
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej("Erro ao ler os dados."); };
      });
    });
  }
  function getOne(store, key) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var r = d.transaction(store).objectStore(store).get(key);
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej("Erro ao ler os dados."); };
      });
    });
  }
  function write(fn, stores) {
    return db().then(function (d) {
      var tx = d.transaction(stores || ["entries", "budgets"], "readwrite");
      fn(tx);
      return done(tx);
    });
  }

  // ---------------- Regras (iguais ao desktop) ----------------
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  var lastSnap = null; // cópia em memória: o backup precisa começar logo após o toque (regra do Safari)
  function snapshot() {
    return Promise.all([all("entries"), all("budgets")]).then(function (r) {
      var entries = r[0].sort(function (a, b) { return cmp(b.date, a.date) || cmp(a.id, b.id); });
      var budgets = r[1].sort(function (a, b) { return cmp(a.month, b.month); });
      lastSnap = { version: 1, entries: entries, budgets: budgets };
      return lastSnap;
    });
  }

  // teto = receitas − fixas − dívidas − max(meta, aportes) − margem
  function summarize(month, entries, budget) {
    var s = { month: month, income: 0, expenses: 0, actual_income: 0, actual_expenses: 0, fixed: 0, debt: 0,
      variable: 0, goal: 0, margin: 0, ceiling: 0, available: 0, projected: 0, actual: 0, reserved: 0 };
    var reserves = 0;
    entries.forEach(function (e) {
      if (e.date.indexOf(month) !== 0) return;
      var ok = e.status === "done", a = e.amount;
      if (e.kind === "income") { s.income += a; if (ok) s.actual_income += a; }
      else if (e.kind === "reserve") { reserves += a; if (ok) s.reserved += a; }
      else {
        s.expenses += a; if (ok) s.actual_expenses += a;
        if (e.kind === "fixed") s.fixed += a; else if (e.kind === "debt") s.debt += a; else s.variable += a;
      }
    });
    if (budget) { s.goal = budget.goal; s.margin = budget.margin; }
    s.ceiling = s.income - s.fixed - s.debt - Math.max(s.goal, reserves) - s.margin;
    s.available = s.ceiling - s.variable;
    s.projected = s.income - s.expenses;
    s.actual = s.actual_income - s.actual_expenses;
    return s;
  }

  function dashboard(year) {
    year = Number(year);
    if (!(year >= 1900 && year <= 2200)) return Promise.reject("Ano inválido.");
    return snapshot().then(function (data) {
      var months = [];
      for (var m = 1; m <= 12; m++) {
        var key = year + "-" + String(m).padStart(2, "0");
        months.push(summarize(key, data.entries, data.budgets.find(function (b) { return b.month === key; })));
      }
      return { data: data, months: months };
    });
  }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) throw "Data inválida.";
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) throw "Data inválida.";
    return { y: y, m: mo, d: d };
  }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fmt(d) { return d.y + "-" + String(d.m).padStart(2, "0") + "-" + String(d.d).padStart(2, "0"); }
  function addMonths(d, n) {
    var total = d.y * 12 + (d.m - 1) + n;
    var y = Math.floor(total / 12), m = (total % 12) + 1;
    if (y > 2200) throw "Data inválida.";
    return { y: y, m: m, d: Math.min(d.d, daysIn(y, m)) };
  }
  function isInt(n) { return typeof n === "number" && Number.isSafeInteger(n); }

  function validate(e) {
    var d = String(e.description || "").trim(), c = String(e.category || "").trim();
    if (!d || d.length > 200 || !c || c.length > 60) throw "Descrição ou categoria inválida.";
    if (KINDS.indexOf(e.kind) < 0 || (e.status !== "planned" && e.status !== "done")) throw "Tipo ou situação inválida.";
    if (!isInt(e.amount) || e.amount <= 0 || e.amount > MAX_AMOUNT) throw "Valor fora do intervalo permitido.";
    if (typeof e.id !== "string" || !e.id) throw "Lançamento inválido.";
    parseDate(e.date);
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function clean(e) {
    return { id: e.id, description: e.description, date: e.date, amount: e.amount, kind: e.kind,
      category: e.category, status: e.status, group_id: e.group_id == null ? null : e.group_id };
  }

  function saveEntry(input) {
    var base = {
      description: String(input.description || "").trim(), date: input.date, amount: input.amount,
      kind: input.kind, category: String(input.category || "").trim(), status: input.status,
    };
    if (input.id) {
      return getOne("entries", input.id).then(function (old) {
        if (!old) throw "Lançamento não encontrado.";
        var e = clean(Object.assign({ id: input.id, group_id: old.group_id }, base));
        validate(e);
        return write(function (tx) { tx.objectStore("entries").put(e); }, ["entries"]);
      });
    }
    var mode = input.mode;
    if (["single", "repeat", "installments"].indexOf(mode) < 0) return Promise.reject("Repetição inválida.");
    var count = mode === "single" ? 1 : Number(input.count);
    if (mode !== "single" && !(Number.isInteger(count) && count >= 2 && count <= 120))
      return Promise.reject("Repetição inválida: use de 2 a 120 meses.");
    if (mode === "installments" && (input.kind === "income" || input.kind === "reserve" || input.amount < count))
      return Promise.reject("Parcelamento inválido.");
    var list;
    try {
      validate(Object.assign({ id: "x" }, base));
      var start = parseDate(input.date), group = count > 1 ? uuid() : null;
      list = [];
      for (var i = 0; i < count; i++) {
        var amount = mode === "installments"
          ? Math.floor(input.amount / count) + (i < input.amount % count ? 1 : 0)
          : input.amount;
        var e = clean({
          id: uuid(),
          description: mode === "installments" ? base.description + " (" + (i + 1) + "/" + count + ")" : base.description,
          date: fmt(addMonths(start, i)), amount: amount, kind: base.kind, category: base.category,
          status: i === 0 ? base.status : "planned", group_id: group,
        });
        validate(e);
        list.push(e);
      }
    } catch (err) { return Promise.reject(err); }
    return write(function (tx) { var st = tx.objectStore("entries"); list.forEach(function (e) { st.put(e); }); }, ["entries"]);
  }

  function setStatus(id, status) {
    if (status !== "planned" && status !== "done") return Promise.reject("Tipo ou situação inválida.");
    return getOne("entries", id).then(function (e) {
      if (!e) throw "Lançamento não encontrado.";
      e.status = status;
      return write(function (tx) { tx.objectStore("entries").put(e); }, ["entries"]);
    });
  }

  function deleteEntry(id) {
    return write(function (tx) { tx.objectStore("entries").delete(id); }, ["entries"]);
  }

  function okMoney(v) { return isInt(v) && v >= 0 && v <= MAX_AMOUNT; }

  function saveBudget(b) {
    var ok = /^\d{4}-\d{2}$/.test(b.month || "");
    try { if (ok) parseDate(b.month + "-01"); } catch (e) { ok = false; }
    if (!ok || !okMoney(b.goal) || !okMoney(b.margin)) return Promise.reject("Meta ou margem inválida.");
    return write(function (tx) { tx.objectStore("budgets").put({ month: b.month, goal: b.goal, margin: b.margin }); }, ["budgets"]);
  }

  function importBackup(text) {
    var snap;
    try { snap = JSON.parse(text); } catch (e) { return Promise.reject("Backup incompatível."); }
    if (!snap || snap.version !== 1 || !Array.isArray(snap.entries) || !Array.isArray(snap.budgets))
      return Promise.reject("Backup incompatível.");
    try {
      var ids = {}, months = {};
      snap.entries.forEach(function (e) {
        validate(e);
        if (ids[e.id]) throw "Lançamentos duplicados no backup.";
        ids[e.id] = 1;
      });
      snap.budgets.forEach(function (b) {
        if (months[b.month]) throw "Metas duplicadas no backup.";
        months[b.month] = 1;
        if (!/^\d{4}-\d{2}$/.test(b.month || "") || !okMoney(b.goal) || !okMoney(b.margin)) throw "Meta ou margem inválida.";
      });
    } catch (err) { return Promise.reject(err); }

    return snapshot().then(function (current) {
      var stamp = new Date().toISOString();
      return write(function (tx) {
        tx.objectStore("safety").put({ stamp: stamp, data: current });
        var es = tx.objectStore("entries"), bs = tx.objectStore("budgets");
        es.clear(); bs.clear();
        snap.entries.forEach(function (e) { es.put(clean(e)); });
        snap.budgets.forEach(function (b) { bs.put({ month: b.month, goal: b.goal, margin: b.margin }); });
      }, ["entries", "budgets", "safety"]).then(function () {
        // mantém só as 5 cópias de segurança mais recentes
        return all("safety").then(function (list) {
          list.sort(function (a, b) { return cmp(b.stamp, a.stamp); });
          var old = list.slice(5);
          if (!old.length) return;
          return write(function (tx) { old.forEach(function (o) { tx.objectStore("safety").delete(o.stamp); }); }, ["safety"]);
        });
      }).then(function () {
        return "Backup restaurado. Uma cópia dos dados anteriores foi guardada neste celular.";
      });
    });
  }

  // ---------------- Arquivos (backup) ----------------
  function pickFile() {
    return new Promise(function (resolve, reject) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.style.display = "none";
      document.body.appendChild(input);
      var fin = false;
      function end(fn, v) { if (fin) return; fin = true; input.remove(); fn(v); }
      input.addEventListener("change", function () {
        var f = input.files && input.files[0];
        f ? end(resolve, f) : end(reject, "Restauração cancelada.");
      });
      input.addEventListener("cancel", function () { end(reject, "Restauração cancelada."); });
      input.click();
    });
  }

  function exportBackup() {
    // A interface recarrega o painel após cada alteração, então lastSnap está sempre em dia.
    return (lastSnap ? Promise.resolve(lastSnap).then(shareSnap) : snapshot().then(shareSnap));
  }
  function shareSnap(snap) {
    {
      var d = new Date();
      var name = "economist-backup-" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0") + ".json";
      var text = JSON.stringify(snap, null, 2);
      var file;
      try { file = new File([text], name, { type: "application/json" }); } catch (e) { file = null; }
      // No iPhone, a folha de compartilhamento permite "Salvar em Arquivos", AirDrop para o PC etc.
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: "Backup do Economist" })
          .then(function () { return "Backup salvo."; })
          .catch(function (e) {
            if (e && e.name === "AbortError") throw "Exportação cancelada.";
            throw "Não foi possível compartilhar o backup.";
          });
      }
      var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return "Backup salvo.";
    }
  }

  // ---------------- Ponte com a interface ----------------
  var NULL = function () { return null; };
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: function () { return 0; },
    invoke: function (cmd, args) {
      args = args || {};
      switch (cmd) {
        case "dashboard": return dashboard(args.year);
        case "save_entry": return saveEntry(args.input || {}).then(NULL);
        case "save_budget": return saveBudget(args.budget || {}).then(NULL);
        case "set_status": return setStatus(args.id, args.status).then(NULL);
        case "delete_entry": return deleteEntry(args.id).then(NULL);
        case "export_backup": return exportBackup();
        case "import_backup":
          return pickFile().then(function (f) {
            if (f.size > MAX_BACKUP) throw "Backup excede 20 MB.";
            return f.text();
          }).then(importBackup);
        default: return Promise.reject("Comando desconhecido: " + cmd);
      }
    },
  };

  // Pede ao sistema para não apagar os dados em caso de pouco espaço.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // Funciona offline depois da primeira abertura.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }

  // Exposto para testes.
  window.__economist = { summarize: summarize, addMonths: addMonths };
})();
