/* global XLSX, BankParse, Categorize, Ledger */
(function () {
  'use strict';

  var P = BankParse, C = Categorize, L = Ledger;
  var STORE_KEY = 'moneyTracker.v1';
  var DEFAULT_TAGS = ['Monthly', 'Weekly', 'Yearly', 'Luxury'];

  // ---------- state ----------

  var state = load();
  var ui = { month: null, search: '', onlyUncat: false };

  function emptyState() {
    return { version: 1, transactions: [], checkpoints: [], rules: [], useDefaultRules: true, nextId: 1 };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.transactions)) return Object.assign(emptyState(), s);
      }
    } catch (e) { /* storage unavailable or corrupt: start empty */ }
    return emptyState();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save in this browser (' + e.message + '). Download a backup to keep your data.');
    }
  }

  function newTx(fields) {
    var id = state.nextId++;
    return Object.assign({
      id: id, seq: id, date: '', description: '', type: '', tag: '',
      amount: 0, inflow: 0, notes: '', bankText: '', source: 'manual'
    }, fields, { id: id, seq: id });
  }

  function allRules() {
    return state.useDefaultRules ? state.rules.concat(C.DEFAULT_RULES) : state.rules;
  }

  function learnRule(bankText, description, type, tag) {
    var key = C.merchantKey(bankText);
    if (!key || key.length < 2 || !type) return;
    var existing = state.rules.filter(function (r) { return P.normalize(r.match) === key; })[0];
    if (existing) {
      existing.name = description; existing.type = type; existing.tag = tag || ''; existing.source = 'user';
    } else {
      state.rules.push({ match: key, name: description, type: type, tag: tag || '', source: 'user' });
    }
  }

  // ---------- helpers ----------

  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function fmt(n, blankZero) {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '';
    if (blankZero && !n) return '';
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
  }

  function fmtDate(iso) {
    var p = iso.split('-');
    return +p[2] + '/' + +p[1] + '/' + p[0];
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 4500);
  }

  function amountInput(v) {
    var n = P.parseAmount(v);
    return isNaN(n) ? 0 : Math.abs(n);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function download(name, blob) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function knownTypes() {
    var set = {};
    state.transactions.forEach(function (t) { if (t.type) set[t.type] = true; });
    allRules().forEach(function (r) { if (r.type) set[r.type] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function knownTags() {
    var set = {};
    DEFAULT_TAGS.forEach(function (t) { set[t] = true; });
    state.transactions.forEach(function (t) { if (t.tag) set[t.tag] = true; });
    return Object.keys(set).sort();
  }

  function fillDatalists() {
    var fill = function (id, values) {
      var dl = document.getElementById(id);
      dl.replaceChildren.apply(dl, values.map(function (v) { return el('option', { value: v }); }));
    };
    fill('type-list', knownTypes());
    fill('tag-list', knownTags());
    var descs = {};
    state.transactions.forEach(function (t) { if (t.description) descs[t.description] = true; });
    fill('desc-list', Object.keys(descs).sort());
  }

  // ---------- main view ----------

  function render() {
    var ledger = L.computeLedger(state.transactions, state.checkpoints);
    $('#balance').textContent = fmt(ledger.balance) || '0';
    $('#balance').className = 'value' + (ledger.balance < 0 ? ' neg' : '');
    fillDatalists();

    var empty = !ledger.months.length;
    $('#empty').hidden = !empty;
    $('#month-view').hidden = empty;
    if (empty) return;

    var keys = ledger.months.map(function (m) { return m.key; });
    if (!ui.month || keys.indexOf(ui.month) === -1) ui.month = keys[keys.length - 1];
    var month = ledger.months[keys.indexOf(ui.month)];

    var tabs = $('#month-tabs');
    tabs.replaceChildren.apply(tabs, ledger.months.map(function (m) {
      return el('button', {
        type: 'button', role: 'tab', 'aria-selected': String(m.key === ui.month), text: L.sheetName(m.key),
        title: L.monthLabel(m.key),
        onclick: function () { ui.month = m.key; render(); }
      });
    }));
    var sel = tabs.querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    $('#sum-start').textContent = fmt(month.start) || '0';
    $('#sum-in').textContent = fmt(month.totalIn) || '0';
    $('#sum-out').textContent = fmt(month.totalOut) || '0';
    $('#sum-end').textContent = fmt(month.end) || '0';

    renderBreakdown(month);
    renderSheet(month);
  }

  function renderBreakdown(month) {
    var types = Object.keys(month.byType).sort(function (a, b) { return month.byType[b] - month.byType[a]; });
    var max = types.length ? month.byType[types[0]] : 1;
    var box = $('#breakdown');
    box.replaceChildren.apply(box, types.map(function (t) {
      var v = month.byType[t];
      return el('div', { class: 'bar-row', title: t + ': ' + fmt(v) + ' (' + Math.round(v / month.totalOut * 100) + '%)' }, [
        el('span', { class: 'name', text: t }),
        el('span', { class: 'track' }, [el('span', { class: 'fill', style: 'display:block;width:' + Math.max(1, v / max * 100) + '%' })]),
        el('span', { class: 'amt', text: fmt(v) })
      ]);
    }));
    $('#breakdown-wrap').hidden = !types.length;
  }

  function renderSheet(month) {
    var q = P.normalize(ui.search);
    var body = $('#sheet tbody');
    var rows = [];
    var uncat = 0;

    rows.push(el('tr', { class: 'carry' }, [
      el('td', { class: 'date', text: fmtDate(month.key + '-01') }),
      el('td', { text: month.startIsCheckpoint ? 'Last Month' : 'Carried over' }),
      el('td', { text: 'Remainder' }), el('td'), el('td', { class: 'num' }), el('td', { class: 'num' }),
      el('td', { class: 'num', text: fmt(month.start) }), el('td'), el('td'), el('td')
    ]));

    month.rows.forEach(function (row) {
      var t = row.tx;
      var isUncat = !t.type;
      if (isUncat) uncat++;
      if (ui.onlyUncat && !isUncat) return;
      if (q && P.normalize([t.description, t.type, t.tag, t.notes, t.bankText, t.amount, t.inflow].join(' ')).indexOf(q) === -1) return;

      var typeInput = el('input', {
        class: 'type-select', value: t.type || '', list: 'type-list', placeholder: 'Pick a type…',
        'aria-label': 'Type for ' + (t.description || 'transaction'),
        onchange: function (e) {
          var v = e.target.value.trim();
          if (v === t.type) return;
          t.type = v;
          if (t.bankText) learnRule(t.bankText, t.description, v, t.tag);
          save(); render();
        }
      });
      rows.push(el('tr', {
        class: [row.dayTotal !== null ? 'day-start' : '', isUncat ? 'uncat' : ''].join(' ').trim() || null,
        ondblclick: function (e) { if (e.target.tagName !== 'INPUT') openTx(t); }
      }, [
        el('td', { class: 'date', text: fmtDate(t.date) }),
        el('td', { text: t.description || '—', title: t.bankText || null }),
        el('td', { class: 'type' }, [typeInput]),
        el('td', { text: t.tag || '' }),
        el('td', { class: 'num neg', text: fmt(t.amount, true) }),
        el('td', { class: 'num pos', text: fmt(t.inflow, true) }),
        el('td', { class: 'num' + (row.remaining < 0 ? ' neg' : ''), text: fmt(row.remaining) }),
        el('td', { class: 'num muted', text: row.dayTotal ? fmt(row.dayTotal) : (row.dayTotal === 0 ? '-' : '') }),
        el('td', { class: 'notes', text: t.notes || '', title: t.notes || null }),
        el('td', { class: 'edit' }, [el('button', { type: 'button', text: 'Edit', onclick: function () { openTx(t); } })])
      ]));
    });
    body.replaceChildren.apply(body, rows);
    $('#uncat-count').textContent = uncat ? uncat + ' without a type' : '';
  }

  // ---------- add / edit ----------

  var editing = null;

  function openTx(tx) {
    editing = tx || null;
    var f = $('#tx-form');
    f.reset();
    $('#tx-title').textContent = tx ? 'Edit transaction' : 'Add transaction';
    $('#tx-delete').hidden = !tx;
    var d = tx ? tx.date : (ui.month && ui.month !== todayIso().slice(0, 7) ? lastDateOf(ui.month) : todayIso());
    f.date.value = d;
    f.description.value = tx ? tx.description : '';
    f.type.value = tx ? tx.type : '';
    f.tag.value = tx ? tx.tag : '';
    f.amount.value = tx && tx.amount ? tx.amount : '';
    f.inflow.value = tx && tx.inflow ? tx.inflow : '';
    f.notes.value = tx ? tx.notes : '';
    $('#tx-bank').textContent = tx && tx.bankText ? 'From the bank: ' + tx.bankText : '';
    $('#tx-dialog').showModal();
  }

  function lastDateOf(monthKey) {
    var txs = state.transactions.filter(function (t) { return t.date.slice(0, 7) === monthKey; });
    return txs.reduce(function (m, t) { return t.date > m ? t.date : m; }, monthKey + '-01');
  }

  $('#tx-form').addEventListener('submit', function (e) {
    var f = e.target;
    var fields = {
      date: f.date.value,
      description: f.description.value.trim(),
      type: f.type.value.trim(),
      tag: f.tag.value.trim(),
      amount: amountInput(f.amount.value),
      inflow: amountInput(f.inflow.value),
      notes: f.notes.value.trim()
    };
    if (!fields.amount && !fields.inflow) {
      e.preventDefault();
      f.amount.setCustomValidity('Enter an amount or an inflow');
      f.amount.reportValidity();
      f.amount.addEventListener('input', function () { f.amount.setCustomValidity(''); }, { once: true });
      return;
    }
    if (editing) {
      var typeChanged = fields.type !== editing.type || fields.description !== editing.description;
      Object.assign(editing, fields);
      if (editing.bankText && typeChanged) learnRule(editing.bankText, fields.description, fields.type, fields.tag);
    } else {
      state.transactions.push(newTx(fields));
    }
    ui.month = fields.date.slice(0, 7);
    save(); render();
  });

  $('#tx-delete').addEventListener('click', function () {
    if (!editing || !confirm('Delete "' + (editing.description || 'this transaction') + '"?')) return;
    var id = editing.id;
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    $('#tx-dialog').close();
    save(); render();
  });

  // ---------- balance ----------

  function balanceAt(date) {
    return L.computeLedger(
      state.transactions.filter(function (t) { return t.date <= date; }),
      state.checkpoints.filter(function (c) { return c.date <= date; })
    ).balance;
  }

  function hasHistoryBefore(date) {
    return state.transactions.some(function (t) { return t.date < date; }) ||
      state.checkpoints.some(function (c) { return c.date <= date; });
  }

  /** Make the balance at the end of `date` equal `balance` (adds a "Missing Balance" row like the old sheet). */
  function adjustTo(date, balance) {
    var anyUpTo = state.transactions.some(function (t) { return t.date <= date; }) ||
      state.checkpoints.some(function (c) { return c.date <= date; });
    if (!anyUpTo) {
      state.checkpoints.push({ date: date, balance: balance });
      return balance;
    }
    var diff = Math.round((balance - balanceAt(date)) * 100) / 100;
    if (Math.abs(diff) < 0.01) return 0;
    state.transactions.push(newTx({
      date: date, description: '¿?', type: 'Missing Balance',
      amount: diff < 0 ? -diff : 0, inflow: diff > 0 ? diff : 0,
      notes: 'Adjusted to match the bank balance of ' + fmt(balance)
    }));
    return diff;
  }

  $('#balance-form').addEventListener('submit', function (e) {
    var f = e.target;
    var b = P.parseAmount(f.balance.value);
    if (isNaN(b)) { e.preventDefault(); return; }
    var diff = adjustTo(f.date.value, b);
    ui.month = f.date.value.slice(0, 7);
    save(); render();
    toast(diff ? 'Added a difference of ' + fmt(diff) : 'Balance already matches.');
  });

  // ---------- bank import ----------

  var imp = null; // current import session

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = el('script', { src: src });
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function pdfRows(buf) {
    var ready = window.pdfjsLib ? Promise.resolve()
      // Loading the worker as a normal script lets pdf.js run without a Web Worker,
      // which also works when the app is opened straight from disk (file://).
      : loadScript('vendor/pdf.worker.min.js').then(function () { return loadScript('vendor/pdf.min.js'); });
    return ready.then(function () {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    }).then(function (pdf) {
      var pages = [];
      for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
      return Promise.all(pages.map(function (n) {
        return pdf.getPage(n).then(function (page) { return page.getTextContent(); }).then(function (tc) {
          var offset = (pdf.numPages - n) * 100000;
          return tc.items.filter(function (it) { return it.str !== undefined && it.transform; }).map(function (it) {
            return { str: it.str, x: it.transform[4], y: it.transform[5] + offset, w: it.width };
          });
        });
      }));
    }).then(function (pages) {
      var items = [].concat.apply([], pages);
      var rows = P.itemsToRows(items);
      return { rows: rows, lines: rows.map(function (r) { return r.join('   '); }), empty: !items.length };
    });
  }

  function sheetRowsFromWorkbook(wb) {
    var best = null;
    wb.SheetNames.forEach(function (name) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      var score = (P.findHeaderRow(rows) >= 0 ? 100000 : 0) + rows.length;
      if (!best || score > best.score) best = { rows: rows, score: score };
    });
    return best ? best.rows : [];
  }

  function handleBankFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    readFile(file).then(function (buf) {
      if (ext === 'pdf') return pdfRows(buf);
      if (ext === 'csv' || ext === 'txt') return { rows: P.parseCsv(P.decodeText(new Uint8Array(buf))) };
      var wb = XLSX.read(buf, { type: 'array' });
      return { rows: sheetRowsFromWorkbook(wb) };
    }).then(function (res) {
      if (res.empty) throw new Error('This PDF has no text in it (it is probably a scan). Download the report as CSV or Excel from your e-banking instead.');
      imp = { file: file.name, rows: res.rows, lines: res.lines || null, mapping: P.guessMapping(res.rows) };
      $('#import-file').textContent = file.name;
      buildMapping();
      buildPreview();
      $('#mapping').open = imp.mapping.headerRow < 0 || !imp.items.length;
      $('#import-dialog').showModal();
    }).catch(function (err) {
      console.error(err);
      toast('Could not read ' + file.name + ': ' + err.message);
    });
  }

  function columnOptions() {
    var header = imp.mapping.headerRow >= 0 ? imp.rows[imp.mapping.headerRow] : [];
    var sample = imp.rows[imp.mapping.headerRow + 1] || [];
    var n = imp.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var opts = [{ v: -1, t: '—' }];
    for (var i = 0; i < n; i++) {
      var name = header[i] ? String(header[i]) : 'Column ' + (i + 1);
      var ex = sample[i] !== undefined && sample[i] !== '' ? ' (e.g. ' + String(sample[i]).slice(0, 18) + ')' : '';
      opts.push({ v: i, t: name + ex });
    }
    return opts;
  }

  function buildMapping() {
    var m = imp.mapping;
    var opts = columnOptions();
    var select = function (label, get, set) {
      var s = el('select', {
        onchange: function (e) { set(+e.target.value); buildPreview(); }
      }, opts.map(function (o) { return el('option', { value: String(o.v), text: o.t }); }));
      s.value = String(get());
      return el('label', null, [label, s]);
    };
    var check = function (label, key) {
      return el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: !!m[key], onchange: function (e) { m[key] = e.target.checked; buildPreview(); } }),
        label
      ]);
    };
    var grid = $('#mapping-grid');
    var headerRow = el('input', {
      type: 'number', min: '0', value: String(m.headerRow + 1),
      onchange: function (e) { m.headerRow = Math.max(-1, (+e.target.value || 0) - 1); buildMapping(); buildPreview(); }
    });
    grid.replaceChildren(
      el('label', null, ['Header row (0 = none)', headerRow]),
      select('Date', function () { return m.date; }, function (v) { m.date = v; }),
      select('Description', function () { return m.text[0] === undefined ? -1 : m.text[0]; }, function (v) { m.text = [v].concat(m.text.slice(1)).filter(function (x) { return x >= 0; }); }),
      select('Description (extra)', function () { return m.text[1] === undefined ? -1 : m.text[1]; }, function (v) { m.text = [m.text[0]].concat(v >= 0 ? [v] : []).filter(function (x) { return x !== undefined && x >= 0; }); }),
      select('Money out', function () { return m.out; }, function (v) { m.out = v; }),
      select('Money in', function () { return m.inflow; }, function (v) { m.inflow = v; }),
      select('Signed amount (− = out)', function () { return m.amount; }, function (v) { m.amount = v; }),
      select('Balance', function () { return m.balance; }, function (v) { m.balance = v; }),
      check('Flip signed amounts', 'invert'),
      check('Dates are month/day', 'monthFirst')
    );
  }

  function buildPreview() {
    var txs = P.extractTransactions(imp.rows, imp.mapping);
    imp.fallback = false;
    if (!txs.length && imp.lines) {
      txs = P.linesToTransactions(imp.lines);
      imp.fallback = txs.length > 0;
    }
    // Bank reports are often newest-first; work oldest-first like the sheet.
    if (txs.length > 1 && txs[0].date > txs[txs.length - 1].date) txs.reverse();
    txs = txs.map(function (t, i) { t.order = i; return t; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order; });

    var dups = C.findDuplicates(txs, state.transactions);
    var rules = allRules();
    imp.items = txs.map(function (t, i) {
      var cat = C.categorize(t, rules);
      return {
        t: t, dup: dups[i], include: !dups[i],
        suggested: { description: cat.description, type: cat.type, tag: cat.tag },
        description: cat.description, type: cat.type, tag: cat.tag, notes: ''
      };
    });

    // Statement closing balance, if the report has a balance column.
    var withBal = txs.filter(function (t) { return t.balance !== null && t.balance !== undefined; });
    imp.closing = withBal.length ? withBal[withBal.length - 1] : null;

    var m = imp.mapping;
    var names = function (i) { return i >= 0 ? (columnOptions()[i + 1] || {}).t.replace(/ \(e\.g\..*$/, '') : null; };
    $('#mapping-summary').textContent = imp.fallback ? '(read line by line from the PDF)' :
      [names(m.date) && 'date: ' + names(m.date), m.text.length && 'description: ' + m.text.map(names).join(' + '),
        names(m.out) && 'out: ' + names(m.out), names(m.inflow) && 'in: ' + names(m.inflow),
        names(m.amount) && 'amount: ' + names(m.amount), names(m.balance) && 'balance: ' + names(m.balance)]
        .filter(Boolean).join(' · ');

    renderPreview();
  }

  function renderPreview() {
    var msg = $('#import-msg');
    var items = imp.items;
    msg.className = 'msg';
    if (!items.length) {
      msg.className = 'msg error';
      msg.textContent = 'No transactions found. Open "Columns" above and tell the app which column holds the date and the amounts.';
    } else {
      var dupN = items.filter(function (i) { return i.dup; }).length;
      var uncat = items.filter(function (i) { return !i.type; }).length;
      var range = fmtDate(items[0].t.date) + ' – ' + fmtDate(items[items.length - 1].t.date);
      msg.textContent = items.length + ' transactions, ' + range + '.' +
        (dupN ? ' ' + dupN + ' look like rows you already have and are unticked.' : '') +
        (uncat ? ' ' + uncat + ' need a type (highlighted).' : ' All categorised.');
    }

    var body = $('#preview tbody');
    body.replaceChildren.apply(body, items.map(function (it) {
      var tr = el('tr', { class: [it.dup ? 'dup' : '', it.include ? '' : 'off', it.type ? '' : 'uncat'].join(' ').trim() || null });
      var input = function (key, list, cls) {
        return el('input', {
          value: it[key] || '', list: list || null, class: cls || null,
          oninput: function (e) {
            it[key] = e.target.value;
            if (key === 'type') tr.classList.toggle('uncat', !it.type.trim());
          }
        });
      };
      var typeCell = el('td', { class: 'type' }, [input('type', 'type-list')]);
      tr.append(
        el('td', null, [el('input', {
          type: 'checkbox', checked: it.include, 'aria-label': 'Include',
          onchange: function (e) { it.include = e.target.checked; tr.classList.toggle('off', !it.include); updateImportButton(); }
        })]),
        el('td', { class: 'date', text: fmtDate(it.t.date) }),
        el('td', null, [input('description', 'desc-list')]),
        typeCell,
        el('td', null, [input('tag', 'tag-list')]),
        el('td', { class: 'num neg', text: fmt(it.t.out, true) }),
        el('td', { class: 'num pos', text: fmt(it.t.inflow, true) }),
        el('td', { class: 'bank', text: it.t.text })
      );
      return tr;
    }));
    $('#preview-all').checked = items.every(function (i) { return i.include; });

    var wrap = $('#match-balance-wrap');
    wrap.hidden = !imp.closing;
    if (imp.closing) {
      $('#match-balance-label').textContent = 'Match my balance to the statement: ' + fmt(imp.closing.balance) +
        ' at the end of ' + fmtDate(imp.closing.date);
    }
    updateImportButton();
  }

  function updateImportButton() {
    var n = imp.items.filter(function (i) { return i.include; }).length;
    $('#import-go').textContent = 'Add ' + n + ' transaction' + (n === 1 ? '' : 's');
    $('#import-go').disabled = !n;
  }

  $('#preview-all').addEventListener('change', function (e) {
    imp.items.forEach(function (i) { i.include = e.target.checked; });
    renderPreview();
  });

  $('#import-form').addEventListener('submit', function (e) {
    if (!imp) return;
    var chosen = imp.items.filter(function (i) { return i.include; });
    if (!chosen.length) { e.preventDefault(); return; }

    var first = chosen[0].t.date;
    var noHistory = !hasHistoryBefore(first);

    chosen.forEach(function (it) {
      var description = String(it.description || '').trim() || C.prettyName(it.t.text);
      var type = String(it.type || '').trim();
      var tag = String(it.tag || '').trim();
      if (type && (type !== it.suggested.type || description !== it.suggested.description || tag !== it.suggested.tag)) {
        learnRule(it.t.text, description, type, tag);
      }
      state.transactions.push(newTx({
        date: it.t.date, description: description, type: type, tag: tag,
        amount: it.t.out, inflow: it.t.inflow, bankText: it.t.text, source: 'bank'
      }));
    });

    var note = '';
    if (imp.closing && $('#match-balance').checked) {
      if (noHistory) {
        // Opening balance = closing balance with the whole statement undone.
        var net = imp.items.reduce(function (s, i) { return s + i.t.inflow - i.t.out; }, 0);
        state.checkpoints.push({ date: imp.items[0].t.date, balance: Math.round((imp.closing.balance - net) * 100) / 100 });
      }
      var diff = adjustTo(imp.closing.date, imp.closing.balance);
      if (diff) note = ' Balance differed by ' + fmt(diff) + ', added a "Missing Balance" row.';
    }

    ui.month = chosen[chosen.length - 1].t.date.slice(0, 7);
    save(); render();
    toast('Added ' + chosen.length + ' transactions.' + note);
  });

  // ---------- old spreadsheet import ----------

  function handleSheetFile(file) {
    readFile(file).then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      var sheets = wb.SheetNames.map(function (name) {
        return { name: name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) };
      });
      var res = C.importTrackingSheets(sheets);
      if (!res.transactions.length) {
        toast('No sheets with Date / Description / Amount columns found in ' + file.name + '.');
        return;
      }
      if (state.transactions.length &&
          !confirm('Replace the ' + state.transactions.length + ' transactions in the app with the ' +
            res.transactions.length + ' from ' + file.name + '?')) return;
      state.nextId = 1;
      state.transactions = res.transactions.map(function (t) { return newTx(t); });
      state.checkpoints = res.checkpoints;
      var learned = C.rulesFromHistory(res.transactions);
      state.rules = state.rules.filter(function (r) { return r.source === 'user'; }).concat(learned);
      ui.month = null;
      save(); render();
      toast('Imported ' + res.transactions.length + ' transactions and learned ' + learned.length + ' categories.');
    }).catch(function (err) {
      console.error(err);
      toast('Could not read ' + file.name + ': ' + err.message);
    });
  }

  // ---------- export ----------

  function isoToSerial(iso) {
    return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569;
  }

  function exportExcel() {
    var ledger = L.computeLedger(state.transactions, state.checkpoints);
    if (!ledger.months.length) { toast('Nothing to export yet.'); return; }
    var wb = XLSX.utils.book_new();
    ledger.months.forEach(function (m) {
      var rows = L.sheetRows(m);
      var ws = {};
      rows.forEach(function (row, r) {
        row.forEach(function (v, c) {
          if (v === '' || v === null || v === undefined) return;
          var addr = XLSX.utils.encode_cell({ r: r, c: c });
          if (typeof v === 'object') ws[addr] = { t: 'n', f: v.f, v: v.v };
          else if (c === 0 && r > 0) ws[addr] = { t: 'n', v: isoToSerial(v), z: 'm/d/yyyy' };
          else ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v: v };
        });
      });
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: 8 } });
      ws['!cols'] = [12, 26, 18, 10, 11, 12, 11, 30, 11].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, L.sheetName(m.key));
    });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download('Money ' + todayIso() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }

  // ---------- rules dialog ----------

  function renderRules() {
    var q = P.normalize($('#rules-search').value);
    var body = $('#rules-table tbody');
    var rows = state.rules
      .map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return !q || P.normalize([x.r.match, x.r.name, x.r.type, x.r.tag].join(' ')).indexOf(q) !== -1; })
      .sort(function (a, b) { return (a.r.source === 'user' ? 0 : 1) - (b.r.source === 'user' ? 0 : 1) || a.r.match.localeCompare(b.r.match); });
    body.replaceChildren.apply(body, rows.map(function (x) {
      var r = x.r;
      var input = function (key, list) {
        return el('input', {
          value: r[key] || '', list: list || null,
          onchange: function (e) { r[key] = e.target.value.trim(); r.source = 'user'; save(); }
        });
      };
      return el('tr', null, [
        el('td', null, [input('match')]),
        el('td', null, [input('name', 'desc-list')]),
        el('td', null, [input('type', 'type-list')]),
        el('td', null, [input('tag', 'tag-list')]),
        el('td', { class: 'muted small', text: r.source === 'history' ? 'learned from sheet' : 'yours' }),
        el('td', null, [el('button', {
          type: 'button', class: 'icon', text: '✕', 'aria-label': 'Delete rule',
          onclick: function () { state.rules.splice(state.rules.indexOf(r), 1); save(); renderRules(); }
        })])
      ]);
    }));
    $('#rules-defaults').checked = state.useDefaultRules;
  }

  $('#rules-search').addEventListener('input', renderRules);
  $('#rules-defaults').addEventListener('change', function (e) { state.useDefaultRules = e.target.checked; save(); });
  $('#rule-add').addEventListener('click', function () {
    state.rules.unshift({ match: '', name: '', type: '', tag: '', source: 'user' });
    $('#rules-search').value = '';
    renderRules();
    var first = $('#rules-table tbody input');
    if (first) first.focus();
  });
  $('#rules-apply').addEventListener('click', function () {
    var rules = allRules(), n = 0;
    state.transactions.forEach(function (t) {
      if (t.type || !t.bankText) return;
      var rule = C.matchRule(t.bankText, rules);
      if (!rule) return;
      t.description = rule.name; t.type = rule.type; t.tag = t.tag || rule.tag || ''; n++;
    });
    save(); render();
    toast(n ? 'Categorised ' + n + ' rows.' : 'No uncategorised rows matched a rule.');
  });
  $('#rules-dialog').addEventListener('close', function () {
    state.rules = state.rules.filter(function (r) { return r.match && r.type; });
    save(); render();
  });

  // ---------- wiring ----------

  function closeMenu() { var m = document.querySelector('.menu'); if (m) m.open = false; }

  $('#btn-upload').addEventListener('click', function () { $('#file-bank').click(); });
  $('#btn-import-sheet').addEventListener('click', function () { closeMenu(); $('#file-sheet').click(); });
  $('#btn-add').addEventListener('click', function () { openTx(null); });
  $('#btn-export').addEventListener('click', exportExcel);
  $('#btn-rules').addEventListener('click', function () { closeMenu(); renderRules(); $('#rules-dialog').showModal(); });
  $('#btn-balance').addEventListener('click', function () {
    closeMenu();
    var f = $('#balance-form');
    f.reset();
    f.date.value = todayIso();
    $('#balance-dialog').showModal();
  });
  $('#btn-backup').addEventListener('click', function () {
    closeMenu();
    download('Money backup ' + todayIso() + '.json', new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' }));
  });
  $('#btn-restore').addEventListener('click', function () { closeMenu(); $('#file-backup').click(); });
  $('#btn-clear').addEventListener('click', function () {
    closeMenu();
    if (!confirm('Delete all transactions, balances and rules from this browser? Download a backup first if you might need them.')) return;
    state = emptyState();
    ui.month = null;
    save(); render();
  });

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });
  // Enter inside an editable table cell commits the cell instead of submitting the dialog.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('table')) {
      e.preventDefault();
      e.target.blur();
    }
  });
  $('#import-dialog').addEventListener('close', function () { imp = null; });

  document.querySelectorAll('[data-click]').forEach(function (b) {
    b.addEventListener('click', function () { document.getElementById(b.getAttribute('data-click')).click(); });
  });

  function onFile(input, handler) {
    input.addEventListener('change', function () {
      var f = input.files[0];
      input.value = '';
      if (f) handler(f);
    });
  }
  onFile($('#file-bank'), handleBankFile);
  onFile($('#file-sheet'), handleSheetFile);
  onFile($('#file-backup'), function (file) {
    readFile(file).then(function (buf) {
      var s = JSON.parse(new TextDecoder().decode(buf));
      if (!s || !Array.isArray(s.transactions)) throw new Error('not a Money backup file');
      if (!confirm('Replace everything in the app with this backup (' + s.transactions.length + ' transactions)?')) return;
      state = Object.assign(emptyState(), s);
      ui.month = null;
      save(); render();
      toast('Backup restored.');
    }).catch(function (err) { toast('Could not restore: ' + err.message); });
  });

  // Drag a bank report anywhere onto the page.
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleBankFile(f);
  });

  $('#search').addEventListener('input', function (e) { ui.search = e.target.value; render(); });
  $('#only-uncat').addEventListener('change', function (e) { ui.onlyUncat = e.target.checked; render(); });
  document.addEventListener('click', function (e) {
    var m = document.querySelector('.menu');
    if (m && m.open && !m.contains(e.target)) m.open = false;
  });

  render();
})();
