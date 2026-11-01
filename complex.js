// Economist — modo "Economia complexa".
// Camada opcional por cima da interface original: um botão de ajustes, a chave
// "Usar economia complexa" com parâmetros, e uma aba "Análise" com o painel avançado.
// Usa os mesmos dados do app (lidos de local.js); nada sai do aparelho.
(function () {
  "use strict";

  var E = window.__economist;
  if (!E) return;

  // ------------------------------------------------------------------ parâmetros
  var DEFAULTS = {
    enabled: false,
    contaSaldo: 0,          // centavos — saldo em conta hoje
    reservaSaldo: 0,        // centavos — saldo da reserva na data abaixo
    reservaData: "",        // AAAA-MM-DD; vazio = antes de todos os aportes lançados
    rendimento: 10,         // % a.a. bruto da reserva
    ir: 15,                 // % de IR sobre o rendimento
    inflacao: 4.5,          // % a.a. esperada
    metaMeses: 6,           // meses de custo essencial na reserva
    ideal: [50, 30, 20],    // necessidades / desejos / poupança (%)
    retirada: 4,            // % a.a. — taxa de retirada segura (independência financeira)
    janela: 6,              // meses usados nas médias
    metodo: "media",        // "media" ou "mediana"
    horizonte: 24,          // meses de projeção
    incluirPrevistos: false // médias com lançamentos previstos (além dos realizados)
  };
  var cfg = clone(DEFAULTS);
  var view = { open: false, month: monthOf(new Date()) };

  // Cores: 3 primeiras posições da paleta categórica validada (daltonismo, contraste).
  var C = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a" };
  var STATUS = {
    good: { color: "#0ca30c", icon: "✓", label: "Saudável" },
    warn: { color: "#e09a00", icon: "!", label: "Atenção" },
    bad: { color: "#d03b3b", icon: "✕", label: "Crítico" }
  };
  var MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  var MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  // ------------------------------------------------------------------ utilidades
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var brlCompact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
  function money(c) { return brl.format(c / 100); }
  function moneyShort(c) {
    var v = c / 100;
    return (v < 0 ? "−" : "") + "R$ " + (Math.abs(v) >= 1000 ? brlCompact.format(Math.abs(v)) : Math.round(Math.abs(v)));
  }
  function pct(x, d) {
    if (x == null || !isFinite(x)) return "—";
    return (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }) + "%";
  }
  function num(x, d) { return x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function monthOf(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function addMonth(key, n) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
    var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    return yy + "-" + String(mm + 1).padStart(2, "0");
  }
  function labelMonth(key, long) {
    var m = +key.slice(5, 7) - 1;
    return long ? MESES_LONGOS[m] + " de " + key.slice(0, 4) : MESES[m] + "/" + key.slice(2, 4);
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) { return (Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function sd(a) {
    if (a.length < 2) return 0;
    var m = mean(a);
    return Math.sqrt(a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / (a.length - 1));
  }
  function center(a) { return cfg.metodo === "mediana" ? median(a) : mean(a); }
  // Taxa mensal equivalente (juros compostos): (1 + a.a.)^(1/12) − 1
  function monthlyRate(annualPct) { return Math.pow(1 + annualPct / 100, 1 / 12) - 1; }
  function netAnnual() { return cfg.rendimento * (1 - cfg.ir / 100); }
  function parseMoney(s) {
    s = String(s || "").trim().replace(/\s|R\$/g, "");
    if (!s) return 0;
    if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
    var v = Number(s);
    if (!isFinite(v)) throw "Valor inválido: " + s;
    return Math.round(v * 100);
  }
  function parseNum(s, min, max, label) {
    var v = Number(String(s).replace(",", "."));
    if (!isFinite(v) || v < min || v > max) throw label + ": use um número entre " + num(min, 0) + " e " + num(max, 0) + ".";
    return v;
  }
  function moneyInput(c) { return c ? (c / 100).toFixed(2).replace(".", ",") : ""; }

  // ------------------------------------------------------------------ cálculos
  function emptyAgg() {
    return { income: 0, fixed: 0, debt: 0, variable: 0, reserve: 0,
      dIncome: 0, dFixed: 0, dDebt: 0, dVariable: 0, dReserve: 0, count: 0, cats: {}, dCats: {} };
  }
  function aggregate(entries) {
    var by = {};
    entries.forEach(function (e) {
      var k = e.date.slice(0, 7), a = by[k] || (by[k] = emptyAgg()), done = e.status === "done";
      var map = { income: "Income", fixed: "Fixed", debt: "Debt", variable: "Variable", reserve: "Reserve" }[e.kind];
      if (!map) return;
      a[e.kind] += e.amount;
      if (done) a["d" + map] += e.amount;
      a.count++;
      if (e.kind === "variable") {
        a.cats[e.category] = (a.cats[e.category] || 0) + e.amount;
        if (done) a.dCats[e.category] = (a.dCats[e.category] || 0) + e.amount;
      }
    });
    return by;
  }
  function get(by, k) { return by[k] || emptyAgg(); }
  // Valor de um mês para médias: realizados, ou tudo (com previstos) se o parâmetro pedir.
  function val(a, field) {
    if (cfg.incluirPrevistos) return a[field];
    return a["d" + field.charAt(0).toUpperCase() + field.slice(1)];
  }
  // Meses com movimento dentro da janela, antes do mês de referência.
  function windowMonths(by, ref) {
    var out = [];
    for (var i = 1; i <= cfg.janela; i++) {
      var k = addMonth(ref, -i), a = by[k];
      if (a && a.count) out.push(k);
    }
    if (!out.length && by[ref] && by[ref].count) out.push(ref);
    return out.reverse();
  }
  function averages(by, ref) {
    var ms = windowMonths(by, ref);
    function series(f) { return ms.map(function (k) { return val(get(by, k), f); }); }
    var inc = series("income"), fix = series("fixed"), deb = series("debt"), vari = series("variable"), res = series("reserve");
    var ess = ms.map(function (_, i) { return fix[i] + deb[i]; });
    var tot = ms.map(function (_, i) { return fix[i] + deb[i] + vari[i]; });
    var sav = ms.map(function (_, i) { return inc[i] - tot[i]; });
    return { months: ms, income: center(inc), fixed: center(fix), debt: center(deb), variable: center(vari),
      reserve: center(res), essential: center(ess), total: center(tot), saving: center(sav), variableSeries: vari };
  }

  function reserveNow(entries) {
    var today = todayISO(), rm = monthlyRate(netAnnual());
    var base = cfg.reservaSaldo, value = 0, aportes = 0;
    if (base) {
      var months = cfg.reservaData ? Math.max(0, daysBetween(cfg.reservaData, today) / 30.4375) : 0;
      value += base * Math.pow(1 + rm, months);
    }
    entries.forEach(function (e) {
      if (e.kind !== "reserve" || e.status !== "done" || e.date > today) return;
      if (cfg.reservaData && e.date <= cfg.reservaData) return;
      aportes += e.amount;
      value += e.amount * Math.pow(1 + rm, Math.max(0, daysBetween(e.date, today) / 30.4375));
    });
    return { value: Math.round(value), aportes: aportes, base: base };
  }

  function project(by, av, reserveStart) {
    var start = monthOf(new Date()), conta = cfg.contaSaldo, reserva = reserveStart;
    var rm = monthlyRate(netAnnual()), im = monthlyRate(cfg.inflacao), out = [];
    for (var k = 0; k <= cfg.horizonte; k++) {
      var key = addMonth(start, k), a = get(by, key), infl = Math.pow(1 + im, k), est = false;
      // Mês atual: só o que ainda está previsto (o realizado já está no saldo informado).
      var inc, fix, deb, vari, res;
      if (k === 0) {
        inc = a.income - a.dIncome; fix = a.fixed - a.dFixed; deb = a.debt - a.dDebt;
        vari = a.variable - a.dVariable; res = a.reserve - a.dReserve;
      } else {
        inc = a.income || (est = true, av.income);
        fix = a.fixed || (est = true, av.fixed * infl);
        deb = a.debt; // parcelas: só as cadastradas (dívidas terminam)
        vari = Math.max(a.variable, av.variable * infl);
        if (vari > a.variable) est = true;
        res = a.reserve || (av.reserve ? (est = true, av.reserve) : 0);
      }
      conta += inc - fix - deb - vari - res;
      reserva = reserva * (1 + rm) + res;
      var total = conta + reserva;
      out.push({ key: key, conta: Math.round(conta), reserva: Math.round(reserva), total: Math.round(total),
        real: Math.round(total / infl), estimated: est, debt: deb });
    }
    return out;
  }

  function installments(entries) {
    var startKey = monthOf(new Date()), groups = {}, months = {};
    entries.forEach(function (e) {
      if (e.kind !== "debt" || e.status === "done" || e.date.slice(0, 7) < startKey) return;
      var k = e.date.slice(0, 7);
      months[k] = (months[k] || 0) + e.amount;
      var g = e.group_id || ("solo:" + e.id), name = e.description.replace(/\s*\(\d+\/\d+\)\s*$/, "");
      var o = groups[g] || (groups[g] = { name: name, left: 0, count: 0, end: e.date });
      o.left += e.amount; o.count++;
      if (e.date > o.end) o.end = e.date;
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.left - a.left; });
    var bars = [];
    for (var i = 0; i < 12; i++) { var key = addMonth(startKey, i); bars.push({ key: key, v: months[key] || 0 }); }
    return { list: list, bars: bars, total: list.reduce(function (s, g) { return s + g.left; }, 0) };
  }

  function independence(av, wealth) {
    var annualCost = av.total * 12, target = cfg.retirada > 0 ? annualCost / (cfg.retirada / 100) : 0;
    var realAnnual = (1 + netAnnual() / 100) / (1 + cfg.inflacao / 100) - 1;
    var i = Math.pow(1 + realAnnual, 1 / 12) - 1, A = av.saving, P = Math.max(0, wealth), n = null;
    if (target <= 0) n = null;
    else if (P >= target) n = 0;
    else if (A > 0 || i > 0) {
      if (Math.abs(i) < 1e-9) n = A > 0 ? (target - P) / A : null;
      else {
        var x = (target * i + A) / (P * i + A);
        n = x > 0 && (P * i + A) > 0 ? Math.log(x) / Math.log(1 + i) : null;
      }
    }
    return { target: target, annualCost: annualCost, realAnnual: realAnnual, months: n, progress: target ? P / target : 0, saving: A };
  }

  // ------------------------------------------------------------------ gráficos (SVG)
  var NS = "http://www.w3.org/2000/svg";
  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (var v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v));
    return t;
  }
  function legendHTML(items) {
    return '<div class="cx-legend">' + items.map(function (it) {
      return '<span><i style="background:' + it.color + (it.dash ? ';background:repeating-linear-gradient(90deg,' + it.color + ' 0 4px,transparent 4px 7px)' : '') + '"></i>' + esc(it.name) + "</span>";
    }).join("") + "</div>";
  }
  function tableHTML(head, rows) {
    return '<details class="cx-table"><summary>Ver tabela</summary><div class="cx-table-scroll"><table><thead><tr>' +
      head.map(function (h, i) { return "<th" + (i ? ' class="r"' : "") + ">" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + r.map(function (c, i) { return "<td" + (i ? ' class="r"' : "") + ">" + esc(c) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div></details>";
  }

  // Gráfico de linhas com cruz de leitura (toque ou passe o dedo).
  function lineChart(host, opt) {
    var W = Math.max(260, host.clientWidth), H = 210, pl = 52, pr = 14, pt = 12, pb = 26;
    var n = opt.labels.length, all = [];
    opt.series.forEach(function (s) { all = all.concat(s.values); });
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, all)), Math.max.apply(null, all), 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function X(i) { return pl + (n === 1 ? 0 : i * (W - pl - pr) / (n - 1)); }
    function Y(v) { return pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0)); }
    var svg = '<svg class="cx-svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opt.aria) + '">';
    ticks.forEach(function (t) {
      svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="' + (t === 0 ? "cx-zero" : "cx-grid") + '"/>';
      svg += '<text x="' + (pl - 6) + '" y="' + (Y(t) + 3.5) + '" class="cx-ax" text-anchor="end">' + esc(moneyShort(t)) + "</text>";
    });
    var every = Math.ceil(n / 6);
    opt.labels.forEach(function (l, i) {
      if (i % every === 0) svg += '<text x="' + X(i) + '" y="' + (H - 7) + '" class="cx-ax" text-anchor="middle">' + esc(l) + "</text>";
    });
    opt.series.forEach(function (s) {
      var d = s.values.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join("");
      svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="5 4"' : "") + "/>";
      var last = s.values.length - 1;
      svg += '<circle cx="' + X(last) + '" cy="' + Y(s.values[last]) + '" r="4" fill="' + s.color + '" stroke="#fff" stroke-width="2"/>';
    });
    svg += '<g class="cx-cross" style="display:none"><line y1="' + pt + '" y2="' + (H - pb) + '" class="cx-crossline"/>' +
      opt.series.map(function (s) { return '<circle r="4.5" fill="' + s.color + '" stroke="#fff" stroke-width="2"/>'; }).join("") + "</g>";
    svg += '<rect class="cx-hit" x="' + pl + '" y="0" width="' + (W - pl - pr) + '" height="' + H + '" fill="transparent"/></svg>';
    host.innerHTML = svg + '<div class="cx-tip" hidden></div>';
    var el = host.querySelector("svg"), cross = el.querySelector(".cx-cross"), tip = host.querySelector(".cx-tip");
    function show(ev) {
      var r = el.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width;
      var i = Math.max(0, Math.min(n - 1, Math.round((x - pl) / ((W - pl - pr) / Math.max(1, n - 1)))));
      cross.style.display = "";
      var line = cross.querySelector("line"); line.setAttribute("x1", X(i)); line.setAttribute("x2", X(i));
      cross.querySelectorAll("circle").forEach(function (c, j) { c.setAttribute("cx", X(i)); c.setAttribute("cy", Y(opt.series[j].values[i])); });
      tip.hidden = false;
      tip.innerHTML = "<b>" + esc(opt.tipTitle ? opt.tipTitle(i) : opt.labels[i]) + "</b>" + opt.series.map(function (s) {
        return '<div><i style="background:' + s.color + '"></i>' + esc(s.name) + "<span>" + esc(money(s.values[i])) + "</span></div>";
      }).join("") + (opt.tipExtra ? opt.tipExtra(i) : "");
      var px = X(i) * r.width / W, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, px - tw / 2)) + "px";
    }
    function hide() { cross.style.display = "none"; tip.hidden = true; }
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", hide);
  }

  // Barras (uma série, ou positivo/negativo) com dica ao tocar.
  function barChart(host, opt) {
    var W = Math.max(260, host.clientWidth), H = 190, pl = 52, pr = 8, pt = 12, pb = 26;
    var n = opt.values.length, vals = opt.values;
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max(0, Math.max.apply(null, vals)), 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function Y(v) { return pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0)); }
    var slot = (W - pl - pr) / n, bw = Math.max(4, Math.min(28, slot - 4));
    var svg = '<svg class="cx-svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(opt.aria) + '">';
    ticks.forEach(function (t) {
      svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="' + (t === 0 ? "cx-zero" : "cx-grid") + '"/>';
      svg += '<text x="' + (pl - 6) + '" y="' + (Y(t) + 3.5) + '" class="cx-ax" text-anchor="end">' + esc(moneyShort(t)) + "</text>";
    });
    var every = Math.ceil(n / 6);
    vals.forEach(function (v, i) {
      var cx = pl + slot * i + slot / 2, x = cx - bw / 2, zero = Y(0), top = Y(v), h = Math.abs(zero - top), r = Math.min(4, h, bw / 2);
      var color = opt.color ? opt.color(v, i) : C.blue;
      if (h > 0.5) {
        var d = v >= 0
          ? "M" + x + " " + zero + "V" + (top + r) + "Q" + x + " " + top + " " + (x + r) + " " + top + "H" + (x + bw - r) + "Q" + (x + bw) + " " + top + " " + (x + bw) + " " + (top + r) + "V" + zero + "Z"
          : "M" + x + " " + zero + "V" + (top - r) + "Q" + x + " " + top + " " + (x + r) + " " + top + "H" + (x + bw - r) + "Q" + (x + bw) + " " + top + " " + (x + bw) + " " + (top - r) + "V" + zero + "Z";
        svg += '<path d="' + d + '" fill="' + color + '"/>';
      }
      svg += '<rect class="cx-bar-hit" data-i="' + i + '" x="' + (pl + slot * i) + '" y="' + pt + '" width="' + slot + '" height="' + (H - pt - pb) + '" fill="transparent"/>';
      if (i % every === 0) svg += '<text x="' + cx + '" y="' + (H - 7) + '" class="cx-ax" text-anchor="middle">' + esc(opt.labels[i]) + "</text>";
    });
    host.innerHTML = svg + '</svg><div class="cx-tip" hidden></div>';
    var el = host.querySelector("svg"), tip = host.querySelector(".cx-tip");
    function show(ev) {
      var t = ev.target.closest && ev.target.closest(".cx-bar-hit");
      if (!t) return;
      var i = +t.getAttribute("data-i"), r = el.getBoundingClientRect();
      tip.hidden = false;
      tip.innerHTML = "<b>" + esc(opt.tipTitle(i)) + "</b><div>" + esc(opt.tipLabel(vals[i], i)) + "<span>" + esc(money(vals[i])) + "</span></div>";
      var px = (pl + slot * i + slot / 2) * r.width / W, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, px - tw / 2)) + "px";
    }
    el.addEventListener("pointerover", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", function () { tip.hidden = true; });
  }

  // ------------------------------------------------------------------ interface
  var root, settingsDlg, tab, gear;

  function statusOf(kind, x) {
    if (x == null || !isFinite(x)) return null;
    if (kind === "saving") return x >= cfg.ideal[2] / 100 ? "good" : x >= cfg.ideal[2] / 200 ? "warn" : "bad";
    if (kind === "commit") return x <= cfg.ideal[0] / 100 ? "good" : x <= cfg.ideal[0] / 100 + 0.1 ? "warn" : "bad";
    if (kind === "debt") return x <= 0.15 ? "good" : x <= 0.3 ? "warn" : "bad";
    if (kind === "cover") return x >= cfg.metaMeses ? "good" : x >= cfg.metaMeses / 2 ? "warn" : "bad";
    return null;
  }
  function badge(st) {
    if (!st) return "";
    var s = STATUS[st];
    return '<span class="cx-badge"><i style="background:' + s.color + '">' + s.icon + "</i>" + s.label + "</span>";
  }
  function kpi(label, value, sub, st) {
    return '<div class="cx-kpi"><span class="cx-kpi-l">' + esc(label) + "</span><strong>" + esc(value) + "</strong>" +
      (sub ? "<small>" + esc(sub) + "</small>" : "") + badge(st) + "</div>";
  }
  function row(label, value, cls) {
    return '<div class="cx-row' + (cls ? " " + cls : "") + '"><span>' + esc(label) + "</span><b>" + esc(value) + "</b></div>";
  }

  function render() {
    if (!root || !view.open) return;
    E.snapshot().then(function (snap) {
      var entries = snap.entries, budgets = snap.budgets;
      var by = aggregate(entries), ref = view.month, cur = get(by, ref), av = averages(by, ref);
      var budget = budgets.filter(function (b) { return b.month === ref; })[0];
      var html = "";

      html += '<header class="cx-head"><div><div class="cx-eyebrow">ECONOMIA COMPLEXA</div><h1>Análise avançada</h1>' +
        "<p>Indicadores, projeções e metas com os seus parâmetros.</p></div>" +
        '<button class="cx-icon-btn" data-act="settings" aria-label="Ajustar parâmetros">' + ICON.sliders + "</button></header>";
      html += '<div class="cx-picker"><button data-act="prev" aria-label="Mês anterior">' + ICON.left + "</button><strong>" +
        esc(labelMonth(ref, true)) + '</strong><button data-act="next" aria-label="Próximo mês">' + ICON.right + "</button></div>";

      if (!entries.length) {
        html += '<section class="cx-card cx-empty"><h2>Sem dados ainda</h2><p>Cadastre receitas e despesas na aba Mensal. O painel avançado usa esses lançamentos.</p></section>';
        root.querySelector(".cx-body").innerHTML = html;
        return;
      }

      // 1) Saúde do mês
      var inc = cur.income, exp = cur.fixed + cur.debt + cur.variable;
      var dInc = cur.dIncome, dExp = cur.dFixed + cur.dDebt + cur.dVariable;
      var saving = inc ? (inc - exp) / inc : null, dSaving = dInc ? (dInc - dExp) / dInc : null;
      var commit = inc ? (cur.fixed + cur.debt) / inc : null, debtR = inc ? cur.debt / inc : null;
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Saúde do mês</h2><span class="cx-chip">PLANEJADO</span></div>';
      html += '<div class="cx-kpis">' +
        kpi("Taxa de poupança", pct(saving), "Realizado: " + pct(dSaving), statusOf("saving", saving)) +
        kpi("Renda comprometida", pct(commit), "Fixas + dívidas", statusOf("commit", commit)) +
        kpi("Endividamento", pct(debtR), "Parcelas ÷ renda", statusOf("debt", debtR)) +
        kpi("Sobra planejada", money(inc - exp), "Receitas − despesas") + "</div>";
      if (inc > 0) {
        var needs = cur.fixed + cur.debt, wants = cur.variable, save = Math.max(0, inc - needs - wants), tot = Math.max(inc, needs + wants);
        var seg = function (parts) {
          return '<div class="cx-seg">' + parts.map(function (p) {
            var w = Math.max(0, p.v * 100);
            return w > 0 ? '<span style="width:' + w + "%;background:" + p.c + '">' + (w >= 12 ? Math.round(w) + "%" : "") + "</span>" : "";
          }).join("") + "</div>";
        };
        html += '<div class="cx-sub">Divisão da renda <small>(regra ' + cfg.ideal.join("/") + ")</small></div>";
        html += legendHTML([{ name: "Necessidades", color: C.blue }, { name: "Desejos", color: C.orange }, { name: "Poupança", color: C.aqua }]);
        html += '<div class="cx-seg-row"><span>Seu mês</span>' + seg([{ v: needs / tot, c: C.blue }, { v: wants / tot, c: C.orange }, { v: save / tot, c: C.aqua }]) + "</div>";
        html += '<div class="cx-seg-row"><span>Ideal</span>' + seg([{ v: cfg.ideal[0] / 100, c: C.blue }, { v: cfg.ideal[1] / 100, c: C.orange }, { v: cfg.ideal[2] / 100, c: C.aqua }]) + "</div>";
        if (needs + wants > inc) html += '<p class="cx-note cx-warn">As despesas planejadas passam a renda em ' + esc(money(needs + wants - inc)) + ".</p>";
      }
      if (budget) html += '<p class="cx-note">Meta de reserva do mês: ' + esc(money(budget.goal)) + " · margem: " + esc(money(budget.margin)) + ".</p>";
      html += "</section>";

      // 2) Reserva de emergência
      var rsv = reserveNow(entries), cover = av.essential > 0 ? rsv.value / av.essential : null;
      var coverTotal = av.total > 0 ? rsv.value / av.total : null, target = av.essential * cfg.metaMeses;
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Reserva de emergência</h2>' + badge(statusOf("cover", cover)) + "</div>";
      html += '<div class="cx-hero"><strong>' + (cover == null ? "—" : num(cover, 1)) + '</strong><span>meses de custo essencial cobertos</span></div>';
      var prog = target > 0 ? Math.min(1, rsv.value / target) : 0;
      html += '<div class="cx-progress" role="progressbar" aria-valuenow="' + Math.round(prog * 100) + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + (prog * 100) + '%"></span></div>';
      html += '<div class="cx-progress-l"><span>' + esc(money(rsv.value)) + "</span><span>meta " + cfg.metaMeses + " meses · " + esc(money(target)) + "</span></div>";
      html += row("Reserva estimada hoje (com rendimento)", money(rsv.value)) +
        row("Aportes realizados considerados", money(rsv.aportes)) +
        row("Custo essencial médio (fixas + dívidas)", money(Math.round(av.essential)) + "/mês") +
        row("Cobertura do custo total (com variáveis)", coverTotal == null ? "—" : num(coverTotal, 1) + " meses") +
        row("Falta para a meta", money(Math.max(0, Math.round(target - rsv.value))));
      html += '<p class="cx-note">Rendimento líquido: ' + num(netAnnual(), 2) + "% a.a. (" + num(cfg.rendimento, 2) + "% − " + num(cfg.ir, 1) + "% de IR) · " +
        "equivale a " + num(monthlyRate(netAnnual()) * 100, 3) + "% a.m. em juros compostos.</p></section>";

      // 3) Projeção de patrimônio
      var proj = project(by, av, rsv.value);
      var last = proj[proj.length - 1], minConta = proj.reduce(function (m, p) { return p.conta < m.conta ? p : m; }, proj[0]);
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Projeção de patrimônio</h2><span class="cx-chip">' + cfg.horizonte + " MESES</span></div>";
      html += '<div class="cx-kpis">' +
        kpi("Patrimônio em " + labelMonth(last.key), money(last.total), "Conta + reserva") +
        kpi("Em valores de hoje", money(last.real), "Descontada a inflação de " + num(cfg.inflacao, 1) + "% a.a.") + "</div>";
      html += legendHTML([{ name: "Patrimônio total", color: C.blue }, { name: "Reserva", color: C.aqua }]);
      html += '<div class="cx-chart" data-chart="proj"></div>';
      if (minConta.conta < 0) html += '<p class="cx-note cx-warn">' + STATUS.bad.icon + " O saldo em conta fica negativo em " + esc(labelMonth(minConta.key, true)) + " (" + esc(money(minConta.conta)) + "). Revise despesas ou aportes.</p>";
      html += '<p class="cx-note">Usa os lançamentos já cadastrados (parcelas, salários futuros) e, nos meses sem dados, a ' +
        (cfg.metodo === "mediana" ? "mediana" : "média") + " de " + av.months.length + " mês(es) de histórico, com despesas reajustadas pela inflação. Receitas estimadas sem reajuste.</p>";
      html += tableHTML(["Mês", "Conta", "Reserva", "Total", "Valor de hoje"], proj.map(function (p) {
        return [labelMonth(p.key) + (p.estimated ? "*" : ""), money(p.conta), money(p.reserva), money(p.total), money(p.real)];
      }));
      html += "</section>";

      // 4) Resultado mês a mês no ano
      var year = ref.slice(0, 4), res = [];
      for (var m = 1; m <= 12; m++) {
        var k = year + "-" + String(m).padStart(2, "0"), a = get(by, k);
        res.push({ key: k, v: a.dIncome - (a.dFixed + a.dDebt + a.dVariable) });
      }
      var acc = res.reduce(function (s, r) { return s + r.v; }, 0);
      var pos = res.filter(function (r) { return r.v > 0; }).length, neg = res.filter(function (r) { return r.v < 0; }).length;
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Resultado realizado em ' + year + '</h2></div>';
      html += '<div class="cx-kpis">' + kpi("Acumulado no ano", money(acc), pos + " mês(es) no azul · " + neg + " no vermelho") + "</div>";
      html += legendHTML([{ name: "Superávit", color: C.aqua }, { name: "Déficit", color: C.orange }]);
      html += '<div class="cx-chart" data-chart="year"></div>';
      html += tableHTML(["Mês", "Resultado realizado"], res.map(function (r) { return [labelMonth(r.key), money(r.v)]; }));
      html += "</section>";

      // 5) Parcelas e dívidas futuras
      var inst = installments(entries);
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Parcelas e dívidas futuras</h2></div>';
      if (!inst.list.length) html += '<p class="cx-note">Nenhuma parcela prevista a partir deste mês. 🎉</p>';
      else {
        html += '<div class="cx-kpis">' + kpi("Total a pagar", money(inst.total), inst.list.length + " compromisso(s)") +
          kpi("Parcelas ÷ renda média", av.income ? pct(inst.bars[0].v / av.income) : "—", "No mês atual") + "</div>";
        html += '<div class="cx-sub">Compromissos por mês</div><div class="cx-chart" data-chart="debt"></div>';
        html += '<div class="cx-list">' + inst.list.slice(0, 8).map(function (g) {
          return '<div class="cx-li"><div><b>' + esc(g.name) + "</b><small>" + g.count + " parcela(s) · termina em " + esc(labelMonth(g.end.slice(0, 7), true)) + "</small></div><span>" + esc(money(g.left)) + "</span></div>";
        }).join("") + "</div>";
      }
      html += "</section>";

      // 6) Gastos variáveis
      var vs = av.variableSeries, vMean = mean(vs), vSd = sd(vs), cv = vMean ? vSd / vMean : null;
      var curVar = val(cur, "variable");
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Gastos variáveis</h2></div>';
      html += '<div class="cx-kpis">' + kpi("Média mensal", money(Math.round(vMean)), av.months.length + " mês(es) de histórico") +
        kpi("Oscilação (desvio padrão)", money(Math.round(vSd)), "Coef. de variação: " + pct(cv)) +
        kpi(ref === monthOf(new Date()) ? "Este mês (até agora)" : "Este mês", money(curVar), vMean ? (curVar >= vMean ? "▲ " : "▼ ") + pct(Math.abs(curVar - vMean) / vMean) + " vs média" : "") + "</div>";
      var atypical = av.months.filter(function (k, i) { return vs.length >= 3 && vs[i] > vMean + 1.5 * vSd; });
      if (atypical.length) html += '<p class="cx-note cx-warn">Meses atípicos (acima de média + 1,5 desvio): ' + esc(atypical.map(function (k) { return labelMonth(k); }).join(", ")) + ".</p>";
      // categorias: este mês vs média
      var catAvg = {};
      av.months.forEach(function (k) {
        var cats = cfg.incluirPrevistos ? get(by, k).cats : get(by, k).dCats;
        Object.keys(cats).forEach(function (c) { catAvg[c] = (catAvg[c] || 0) + cats[c] / av.months.length; });
      });
      var curCats = cfg.incluirPrevistos ? cur.cats : cur.dCats;
      var names = Object.keys(Object.assign({}, catAvg, curCats));
      var diffs = names.map(function (c) { return { c: c, now: curCats[c] || 0, avg: catAvg[c] || 0 }; })
        .filter(function (d) { return d.now || d.avg; })
        .sort(function (a, b) { return Math.abs(b.now - b.avg) - Math.abs(a.now - a.avg); }).slice(0, 5);
      if (diffs.length && av.months.length && av.months[0] !== ref) {
        html += '<div class="cx-sub">Variáveis por categoria <small>(este mês vs média)</small></div><div class="cx-list">' +
          diffs.map(function (d) {
            var delta = d.now - d.avg, up = delta > 0;
            return '<div class="cx-li"><div><b>' + esc(d.c) + "</b><small>média " + esc(money(Math.round(d.avg))) + "</small></div><span class=\"" + (up ? "cx-up" : "cx-down") + "\">" +
              (up ? "▲ " : "▼ ") + esc(money(Math.abs(Math.round(delta)))) + "</span></div>";
          }).join("") + "</div>";
      }
      html += "</section>";

      // 7) Independência financeira
      var wealth = cfg.contaSaldo + rsv.value, fi = independence(av, wealth);
      html += '<section class="cx-card"><div class="cx-card-head"><h2>Independência financeira</h2></div>';
      html += '<div class="cx-hero"><strong>' + (fi.months == null ? "—" : fi.months === 0 ? "Atingida" : num(fi.months / 12, 1)) + "</strong><span>" +
        (fi.months == null ? "com a sobra atual, não dá para estimar" : fi.months === 0 ? "seu patrimônio já cobre o custo de vida" : "anos até viver de renda, no ritmo atual") + "</span></div>";
      var fp = Math.min(1, fi.progress);
      html += '<div class="cx-progress"><span style="width:' + (fp * 100) + '%"></span></div>' +
        '<div class="cx-progress-l"><span>' + esc(money(wealth)) + "</span><span>" + pct(fi.progress) + " de " + esc(money(Math.round(fi.target))) + "</span></div>";
      html += row("Custo de vida anual (média)", money(Math.round(fi.annualCost))) +
        row("Patrimônio necessário (regra de " + num(cfg.retirada, 1) + "%)", money(Math.round(fi.target))) +
        row("Sobra média mensal (aporte)", money(Math.round(fi.saving))) +
        row("Rentabilidade real (acima da inflação)", pct(fi.realAnnual, 2) + " a.a.");
      html += '<p class="cx-note">Estimativa simples, com juros compostos e valores de hoje. Não é recomendação de investimento.</p></section>';

      // Premissas
      html += '<section class="cx-card cx-assume"><h2>Premissas usadas</h2><p>' +
        "Saldo em conta " + esc(money(cfg.contaSaldo)) + " · reserva informada " + esc(money(cfg.reservaSaldo)) + (cfg.reservaData ? " em " + esc(cfg.reservaData.split("-").reverse().join("/")) : "") +
        " · rendimento " + num(cfg.rendimento, 2) + "% a.a. · IR " + num(cfg.ir, 1) + "% · inflação " + num(cfg.inflacao, 2) + "% a.a. · médias: " +
        (cfg.metodo === "mediana" ? "mediana" : "média") + " de até " + cfg.janela + " meses, " + (cfg.incluirPrevistos ? "com previstos" : "só realizados") + ".</p>" +
        '<button class="cx-outline" data-act="settings">Ajustar parâmetros</button></section>';

      var body = root.querySelector(".cx-body");
      body.innerHTML = html;

      // gráficos (precisam da largura real)
      var hp = body.querySelector('[data-chart="proj"]');
      if (hp) lineChart(hp, {
        aria: "Projeção do patrimônio total e da reserva",
        labels: proj.map(function (p) { return labelMonth(p.key); }),
        series: [{ name: "Patrimônio total", color: C.blue, values: proj.map(function (p) { return p.total; }) },
                 { name: "Reserva", color: C.aqua, values: proj.map(function (p) { return p.reserva; }) }],
        tipTitle: function (i) { return labelMonth(proj[i].key, true) + (proj[i].estimated ? " (estimado)" : ""); },
        tipExtra: function (i) { return '<div class="cx-tip-muted">Em valores de hoje<span>' + esc(money(proj[i].real)) + "</span></div>"; }
      });
      var hy = body.querySelector('[data-chart="year"]');
      if (hy) barChart(hy, {
        aria: "Resultado realizado por mês",
        labels: res.map(function (r) { return MESES[+r.key.slice(5, 7) - 1]; }),
        values: res.map(function (r) { return r.v; }),
        color: function (v) { return v >= 0 ? C.aqua : C.orange; },
        tipTitle: function (i) { return labelMonth(res[i].key, true); },
        tipLabel: function (v) { return v >= 0 ? "Superávit" : "Déficit"; }
      });
      var hd = body.querySelector('[data-chart="debt"]');
      if (hd) barChart(hd, {
        aria: "Parcelas previstas por mês",
        labels: inst.bars.map(function (b) { return labelMonth(b.key); }),
        values: inst.bars.map(function (b) { return b.v; }),
        tipTitle: function (i) { return labelMonth(inst.bars[i].key, true); },
        tipLabel: function () { return "Parcelas"; }
      });
    }).catch(function (e) {
      root.querySelector(".cx-body").innerHTML = '<section class="cx-card"><p class="cx-note cx-warn">Erro ao montar a análise: ' + esc(e) + "</p></section>";
    });
  }

  // ------------------------------------------------------------------ ajustes
  function field(label, name, value, hint, attrs) {
    return '<label class="cx-field"><span>' + esc(label) + "</span><input name=\"" + name + '" value="' + esc(value) + '" ' + (attrs || 'inputmode="decimal"') + ">" +
      (hint ? "<small>" + esc(hint) + "</small>" : "") + "</label>";
  }
  function select(label, name, value, options) {
    return '<label class="cx-field"><span>' + esc(label) + '</span><select name="' + name + '">' + options.map(function (o) {
      return '<option value="' + o[0] + '"' + (String(o[0]) === String(value) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select></label>";
  }
  function openSettings() {
    var f = settingsDlg.querySelector("form");
    f.innerHTML =
      '<div class="cx-toggle-row"><div><b>Usar economia complexa</b><small>Libera a aba Análise, com indicadores, projeções e parâmetros mais precisos.</small></div>' +
      '<label class="cx-switch"><input type="checkbox" name="enabled"' + (cfg.enabled ? " checked" : "") + '><span></span></label></div>' +
      '<div class="cx-params"' + (cfg.enabled ? "" : " hidden") + ">" +
      '<h3>Seu patrimônio hoje</h3><div class="cx-grid2">' +
      field("Saldo em conta (R$)", "contaSaldo", moneyInput(cfg.contaSaldo), "Dinheiro disponível hoje") +
      field("Saldo da reserva (R$)", "reservaSaldo", moneyInput(cfg.reservaSaldo), "Valor guardado antes dos aportes lançados") +
      "</div>" + field("Data desse saldo da reserva", "reservaData", cfg.reservaData, "Aportes depois desta data são somados. Deixe vazio se o saldo é anterior a todos.", 'type="date" min="1900-01-01" max="2200-12-31"') +
      '<h3>Mercado <small>(estimativas — ajuste aos seus números)</small></h3><div class="cx-grid3">' +
      field("Rendimento (% a.a.)", "rendimento", num(cfg.rendimento, 2)) +
      field("IR sobre ganho (%)", "ir", num(cfg.ir, 1)) +
      field("Inflação (% a.a.)", "inflacao", num(cfg.inflacao, 2)) + "</div>" +
      "<h3>Metas</h3><div class=\"cx-grid3\">" +
      field("Necessidades (%)", "ideal0", cfg.ideal[0]) + field("Desejos (%)", "ideal1", cfg.ideal[1]) + field("Poupança (%)", "ideal2", cfg.ideal[2]) + "</div>" +
      '<div class="cx-grid2">' + field("Reserva ideal (meses)", "metaMeses", cfg.metaMeses) +
      field("Retirada segura (% a.a.)", "retirada", num(cfg.retirada, 1), "Para a independência financeira") + "</div>" +
      "<h3>Precisão dos cálculos</h3><div class=\"cx-grid2\">" +
      select("Histórico das médias", "janela", cfg.janela, [[3, "3 meses"], [6, "6 meses"], [12, "12 meses"], [24, "24 meses"]]) +
      select("Método", "metodo", cfg.metodo, [["media", "Média"], ["mediana", "Mediana (ignora extremos)"]]) +
      select("Horizonte da projeção", "horizonte", cfg.horizonte, [[12, "12 meses"], [24, "24 meses"], [36, "36 meses"], [60, "60 meses"]]) +
      "</div>" + '<label class="cx-check"><input type="checkbox" name="incluirPrevistos"' + (cfg.incluirPrevistos ? " checked" : "") + "> Incluir lançamentos previstos nas médias</label>" +
      "</div>" + '<p class="cx-error" role="alert" hidden></p>' +
      '<button class="cx-primary" type="submit">Salvar</button>';
    var sw = f.querySelector('[name="enabled"]');
    sw.addEventListener("change", function () { f.querySelector(".cx-params").hidden = !sw.checked; });
    settingsDlg.showModal();
  }
  function saveSettings(ev) {
    ev.preventDefault();
    var f = ev.target, g = function (n) { return f.querySelector('[name="' + n + '"]'); }, err = f.querySelector(".cx-error");
    try {
      var next = clone(cfg);
      next.enabled = g("enabled").checked;
      if (next.enabled) {
        next.contaSaldo = parseMoney(g("contaSaldo").value);
        next.reservaSaldo = parseMoney(g("reservaSaldo").value);
        if (next.reservaSaldo < 0) throw "O saldo da reserva não pode ser negativo.";
        next.reservaData = g("reservaData").value || "";
        next.rendimento = parseNum(g("rendimento").value, 0, 100, "Rendimento");
        next.ir = parseNum(g("ir").value, 0, 100, "IR");
        next.inflacao = parseNum(g("inflacao").value, -50, 100, "Inflação");
        next.ideal = [parseNum(g("ideal0").value, 0, 100, "Necessidades"), parseNum(g("ideal1").value, 0, 100, "Desejos"), parseNum(g("ideal2").value, 0, 100, "Poupança")];
        if (Math.abs(next.ideal[0] + next.ideal[1] + next.ideal[2] - 100) > 0.01) throw "Necessidades + desejos + poupança precisam somar 100%.";
        next.metaMeses = parseNum(g("metaMeses").value, 1, 60, "Reserva ideal");
        next.retirada = parseNum(g("retirada").value, 0.5, 20, "Retirada segura");
        next.janela = +g("janela").value;
        next.metodo = g("metodo").value;
        next.horizonte = +g("horizonte").value;
        next.incluirPrevistos = g("incluirPrevistos").checked;
      }
      cfg = next;
      E.setSetting("complex", cfg).then(function () {
        settingsDlg.close();
        applyEnabled();
        if (cfg.enabled) openView(); else closeView();
      }, function (e) { err.hidden = false; err.textContent = String(e); });
    } catch (e) {
      err.hidden = false;
      err.textContent = String(e);
    }
  }

  // ------------------------------------------------------------------ montagem
  var ICON = {
    gear: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
    left: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };

  function build() {
    gear = document.createElement("button");
    gear.className = "cx-gear";
    gear.setAttribute("aria-label", "Ajustes e economia complexa");
    gear.innerHTML = ICON.gear;
    gear.addEventListener("click", openSettings);
    document.body.appendChild(gear);

    root = document.createElement("section");
    root.className = "cx-view";
    root.hidden = true;
    root.setAttribute("aria-label", "Análise avançada");
    root.innerHTML = '<div class="cx-body"></div>';
    root.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "settings") openSettings();
      if (act === "prev") { view.month = addMonth(view.month, -1); render(); }
      if (act === "next") { view.month = addMonth(view.month, 1); render(); }
    });
    document.body.appendChild(root);

    settingsDlg = document.createElement("dialog");
    settingsDlg.className = "cx-dialog";
    settingsDlg.innerHTML = '<div class="cx-dialog-head"><h2>Ajustes</h2><button type="button" aria-label="Fechar">' + ICON.close + "</button></div><form novalidate></form>";
    settingsDlg.querySelector(".cx-dialog-head button").addEventListener("click", function () { settingsDlg.close(); });
    settingsDlg.addEventListener("click", function (ev) { if (ev.target === settingsDlg) settingsDlg.close(); });
    settingsDlg.querySelector("form").addEventListener("submit", saveSettings);
    document.body.appendChild(settingsDlg);

    tab = document.createElement("button");
    tab.className = "cx-tab";
    tab.type = "button";
    tab.setAttribute("aria-label", "Análise avançada");
    tab.innerHTML = ICON.chart;
    tab.addEventListener("click", function (ev) { ev.stopPropagation(); view.open ? closeView() : openView(); });

    // Outras abas fecham a análise.
    document.addEventListener("click", function (ev) {
      if (!view.open) return;
      var t = ev.target.closest && ev.target.closest(".sidebar button");
      if (t && t !== tab) closeView();
    }, true);

    // A interface original é React: garante que a aba continue no lugar após re-renderizações.
    new MutationObserver(placeTab).observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    placeTab();
    window.addEventListener("resize", function () { if (view.open) render(); });

    // Botão "voltar" (Android) / ESC: fecha a análise.
    var prevBack = window.__economistBack;
    window.__economistBack = function () {
      if (settingsDlg.open) { settingsDlg.close(); return true; }
      if (view.open) { closeView(); return true; }
      return prevBack ? prevBack() : false;
    };
  }
  function placeTab() {
    var nav = document.querySelector(".sidebar nav");
    if (nav && tab.parentNode !== nav) nav.appendChild(tab);
  }
  function applyEnabled() {
    document.body.classList.toggle("cx-on", !!cfg.enabled);
  }
  function openView() {
    if (!cfg.enabled) return;
    view.open = true;
    root.hidden = false;
    document.body.classList.add("cx-open");
    tab.classList.add("cx-active");
    root.scrollTop = 0;
    render();
  }
  function closeView() {
    view.open = false;
    root.hidden = true;
    document.body.classList.remove("cx-open");
    tab.classList.remove("cx-active");
  }

  function start() {
    build();
    E.getSetting("complex").then(function (saved) {
      if (saved) cfg = Object.assign(clone(DEFAULTS), saved);
      applyEnabled();
    }).catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // Exposto para testes.
  window.__economistComplex = { project: project, averages: averages, aggregate: aggregate, reserveNow: reserveNow,
    independence: independence, monthlyRate: monthlyRate, cfg: function () { return cfg; }, open: openView };
})();
