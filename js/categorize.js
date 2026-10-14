/*
 * Auto-categorisation, duplicate detection and import of the old
 * "Money.xlsx" style tracking sheets. Pure functions (no DOM).
 */
(function (root) {
  'use strict';

  var P = typeof module !== 'undefined' && module.exports ? require('./parse.js') : root.BankParse;
  var normalize = P.normalize;

  // Generic starter rules for common merchants. `match` is a keyword that is
  // looked up (as whole words) in the normalised bank description.
  var DEFAULT_RULES = [
    ['maxi', 'Maxi', 'Supermarket'], ['lidl', 'Lidl', 'Supermarket'], ['idea', 'Idea', 'Supermarket'],
    ['univerexport', 'Univerexport', 'Supermarket'], ['tempo', 'Tempo', 'Supermarket'], ['roda', 'Roda', 'Supermarket'],
    ['aroma', 'Aroma', 'Supermarket'], ['dis', 'DIS', 'Supermarket'], ['metro cash', 'Metro', 'Supermarket'],
    ['gomex', 'Gomex', 'Supermarket'], ['shop&go', 'Shop&Go', 'Supermarket'], ['c market', 'C-Market', 'Supermarket'],
    ['wolt', 'Wolt', 'Restaurants'], ['glovo', 'Glovo', 'Restaurants'], ['donesi', 'Donesi', 'Restaurants'],
    ['mcdonald', 'McDonalds', 'Restaurants'], ['kfc', 'KFC', 'Restaurants'], ['burger king', 'Burger King', 'Restaurants'],
    ['apoteka', 'Pharmacy', 'Health'], ['benu', 'Pharmacy', 'Health'], ['lilly', 'Lilly Drogerie', 'Health'],
    ['dm drogerie', 'dm', 'Health'],
    ['nis petrol', 'NIS', 'Car Gas'], ['omv', 'OMV', 'Car Gas'], ['mol', 'MOL', 'Car Gas'], ['eko serbia', 'EKO', 'Car Gas'],
    ['lukoil', 'Lukoil', 'Car Gas'], ['putevi srbije', 'Tolls', 'Tolls'], ['enp', 'Tolls', 'Tolls'],
    ['eps', 'EPS - Electricity', 'Bills', 'Monthly'], ['infostan', 'Infostan', 'Bills', 'Monthly'],
    ['sbb', 'SBB - Internet', 'Bills', 'Monthly'], ['yettel', 'Yettel', 'Phone Credits'], ['a1', 'A1', 'Phone Credits'],
    ['mts', 'mts', 'Phone Credits'],
    ['netflix', 'Netflix', 'Software', 'Monthly'], ['spotify', 'Spotify', 'Software', 'Monthly'],
    ['youtube', 'Youtube Premium', 'Software', 'Monthly'], ['icloud', 'iCloud+', 'Software', 'Monthly'],
    ['apple com bill', 'Apple', 'Software', 'Monthly'], ['google', 'Google', 'Software', 'Monthly'],
    ['openai', 'Chat GPT', 'Software', 'Monthly'], ['chatgpt', 'Chat GPT', 'Software', 'Monthly'],
    ['anthropic', 'Claude', 'Software', 'Monthly'], ['claude ai', 'Claude', 'Software', 'Monthly'],
    ['duolingo', 'Duolingo', 'Software', 'Yearly'], ['audible', 'Audible', 'Software', 'Monthly'],
    ['crunchyroll', 'Crunchyroll', 'Software', 'Monthly'], ['playstation', 'PS Credits', 'Gaming'],
    ['steam', 'Steam', 'Gaming'],
    ['aliexpress', 'AliExpress', 'Online Shopping'], ['temu', 'Temu', 'Online Shopping'],
    ['amazon', 'Amazon', 'Online Shopping'],
    ['merkur', 'Merkur Osiguranje', 'Insurance', 'Monthly'], ['wiener', 'Wiener Osiguranje', 'Insurance', 'Monthly'],
    ['generali', 'Generali', 'Insurance'], ['dunav osiguranje', 'Dunav Osiguranje', 'Insurance'],
    ['bankomat', 'ATM', 'Cash Out'], ['atm', 'ATM', 'Cash Out'],
    ['clanarin', 'Naplata Članarine', 'Banking', 'Monthly'], ['provizija', 'Bank Fee', 'Banking'],
    ['naknada', 'Bank Fee', 'Banking'],
    ['zara', 'Zara', 'Clothing'], ['h&m', 'H&M', 'Clothing'], ['levi', "Levi's", 'Clothing'],
    ['gigatron', 'Gigatron', 'Equipment'], ['tehnomanija', 'Tehnomanija', 'Equipment'], ['istyle', 'iStyle', 'Equipment'],
    ['cineplexx', 'Movie Tickets', 'Movies'], ['cinestar', 'Movie Tickets', 'Movies'],
    ['booking com', 'Booking.com', 'Travel'], ['airbnb', 'Airbnb', 'Travel'], ['wizz', 'Wizz Air', 'Travel'],
    ['air serbia', 'Air Serbia', 'Travel'], ['ryanair', 'Ryanair', 'Travel'],
    ['zarada', 'Salary', 'Salary', 'Monthly'], ['plata', 'Salary', 'Salary', 'Monthly'], ['salary', 'Salary', 'Salary', 'Monthly']
  ].map(function (r) {
    return { match: r[0], name: r[1], type: r[2], tag: r[3] || '', source: 'default' };
  });

  // Rows from the old sheets that are bookkeeping rather than real spending.
  var CARRY_TYPES = ['remainder'];

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function keywordRegex(match) {
    var k = normalize(match);
    if (!k) return null;
    return new RegExp('(^|[^a-z0-9])' + escapeRe(k).replace(/\\? /g, '[\\s\\-_.*/]*') + '($|[^a-z0-9])');
  }

  /** Pick the best rule for a bank description: longest keyword wins, user rules beat defaults. */
  function matchRule(text, rules) {
    var n = normalize(text);
    var best = null, bestScore = -1;
    (rules || []).forEach(function (r) {
      var re = keywordRegex(r.match);
      if (!re || !re.test(n)) return;
      var score = normalize(r.match).length + (r.source === 'default' ? 0 : 1000);
      if (score > bestScore) { bestScore = score; best = r; }
    });
    return best;
  }

  var NOISE = ('pos kupovina placanje placanje karticom kartica kartice card purchase payment terminal ' +
    'trx transakcija transaction rs srb srbija serbia beograd belgrade novi sad nis kragujevac ' +
    'subotica dinacard visa mastercard maestro debit credit internet web online prodavnica ' +
    'prenos transfer nalog doo d o o ad a d pr rsd eur usd ref br broj datum uplata isplata od za').split(' ');

  function titleCase(s) {
    return s.replace(/\b([a-z])([a-z]*)/g, function (_, a, b) { return a.toUpperCase() + b; });
  }

  /**
   * Turn a raw bank line like "POS KUPOVINA 12.05 MAXI 0123 BEOGRAD RS" into
   * a short merchant guess ("maxi"), used as keyword for learned rules and
   * as a friendly description when no rule matches.
   */
  function merchantKey(text) {
    var n = normalize(String(text || '').split(' · ')[0]);
    var words = n.replace(/[^a-z0-9&+ ]/g, ' ').split(/\s+/).filter(function (w) {
      if (!w || NOISE.indexOf(w) !== -1) return false;
      if (/\d/.test(w) && !/^[a-z]+\d{1,2}$/.test(w)) return false; // card numbers, dates, store ids
      return w.length > 1 || w === '&';
    });
    return words.slice(0, 2).join(' ');
  }

  function prettyName(text) {
    var key = merchantKey(text);
    if (key) return titleCase(key);
    return String(text || '').split(' · ')[0].slice(0, 40);
  }

  /** Fill name/type/tag for a freshly parsed bank transaction. */
  function categorize(tx, rules) {
    var rule = matchRule(tx.text, rules);
    return {
      description: rule ? rule.name : prettyName(tx.text),
      type: rule ? rule.type : (tx.inflow > 0 ? 'Income' : ''),
      tag: rule ? (rule.tag || '') : '',
      rule: rule
    };
  }

  /**
   * Learn rules from transactions the user already labelled (e.g. their old
   * spreadsheet). Only descriptions that were consistently given one type
   * become rules.
   */
  function rulesFromHistory(transactions) {
    var byKey = {};
    transactions.forEach(function (t) {
      if (!t.description || !t.type) return;
      var type = String(t.type).trim();
      if (!type || type === '-' || type === '?' || CARRY_TYPES.indexOf(normalize(type)) !== -1) return;
      var key = normalize(t.description).replace(/[?¿!]/g, '').trim();
      if (key.length < 2 || key === '-') return;
      var e = byKey[key] || (byKey[key] = { name: String(t.description).trim(), types: {}, tags: {}, n: 0, out: 0, inflow: 0 });
      e.types[type] = (e.types[type] || 0) + 1;
      if (t.tag) e.tags[t.tag] = (e.tags[t.tag] || 0) + 1;
      e.n++;
      if (t.inflow > 0) e.inflow++; else e.out++;
    });
    var rules = [];
    Object.keys(byKey).forEach(function (key) {
      var e = byKey[key];
      var top = topOf(e.types);
      if (e.types[top] / e.n < 0.6) return; // ambiguous (e.g. a person you send money to for many reasons)
      var tag = topOf(e.tags);
      rules.push({
        match: key,
        name: e.name,
        type: top,
        tag: tag && e.tags[tag] / e.n >= 0.5 ? tag : '',
        source: 'history'
      });
    });
    return rules;
  }

  function topOf(counts) {
    var best = null;
    Object.keys(counts).forEach(function (k) { if (best === null || counts[k] > counts[best]) best = k; });
    return best;
  }

  function daysBetween(a, b) {
    return Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
  }

  /**
   * For each incoming transaction, find an existing one that is probably the
   * same: same bank text + date + amount (re-uploaded report), or same amount
   * and direction within `windowDays` (typed in by hand earlier).
   * Each existing transaction can only match once.
   */
  function findDuplicates(incoming, existing, windowDays) {
    if (windowDays === undefined) windowDays = 3;
    var taken = {};
    return incoming.map(function (t) {
      var exact = null, near = null, nearDist = Infinity;
      existing.forEach(function (e) {
        if (taken[e.id]) return;
        if (Math.abs((e.amount || 0) - t.out) > 0.005 || Math.abs((e.inflow || 0) - t.inflow) > 0.005) return;
        var dist = daysBetween(e.date, t.date);
        if (e.bankText && e.bankText === t.text && dist === 0) { exact = e; return; }
        if (dist <= windowDays && !e.bankText && dist < nearDist) { near = e; nearDist = dist; }
      });
      var hit = exact || near;
      if (hit) taken[hit.id] = true;
      return hit ? { match: hit, exact: !!exact } : null;
    });
  }

  // ---------- old spreadsheet import ----------

  function headerIndex(row) {
    var idx = {};
    (row || []).forEach(function (c, i) {
      var n = normalize(c);
      if (n && idx[n] === undefined) idx[n] = i;
    });
    return idx;
  }

  function num(v) {
    if (typeof v === 'number') return v;
    var n = P.parseAmount(v);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Import sheets in the "Date | Description | Type | Tag | Amount | Inflow |
   * Remaining | ..." layout. `sheets` is [{ name, rows }] with rows as arrays.
   * Each sheet's carried-over balance ("Last Month / Remainder") becomes a
   * balance checkpoint, so the running balance matches what the sheet showed.
   * Returns { transactions, checkpoints: [{ date, balance }] }.
   */
  function importTrackingSheets(sheets) {
    var txs = [];
    var checkpoints = [];
    var running = null;
    sheets.forEach(function (sheet) {
      var rows = sheet.rows || [];
      var hRow = -1, idx = null;
      for (var i = 0; i < Math.min(rows.length, 10); i++) {
        var h = headerIndex(rows[i]);
        if (h.date !== undefined && h.amount !== undefined && h.description !== undefined) { hRow = i; idx = h; break; }
      }
      if (hRow < 0) return;
      var col = function (r, name) { return idx[name] === undefined ? undefined : r[idx[name]]; };
      var firstInSheet = true;
      for (var r = hRow + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var date = P.parseDate(col(row, 'date'));
        if (!date) continue;
        var desc = col(row, 'description');
        desc = desc === undefined || desc === null ? '' : String(desc).trim();
        var amount = num(col(row, 'amount'));
        var inflow = num(col(row, 'inflow'));
        var type = String(col(row, 'type') || '').trim();
        if (!amount && !inflow) continue; // "-" placeholder days and empty rows
        var isFirst = firstInSheet;
        firstInSheet = false;

        if (CARRY_TYPES.indexOf(normalize(type)) !== -1 || normalize(desc) === 'last month') {
          checkpoints.push({ date: date, balance: inflow - amount });
          running = inflow - amount;
          continue;
        }
        if (isFirst && running === null) {
          // Very first row and no carry-over row: derive the start from "Remaining".
          var remaining = num(col(row, 'remaining'));
          if (remaining) {
            running = remaining + amount - inflow;
            checkpoints.push({ date: date, balance: running });
          }
        } else if (isFirst && inflow > 0 && running !== null &&
                   Math.abs(inflow - running) <= Math.max(0.1 * Math.abs(running), 1)) {
          // Carry-over typed into the first row's Inflow cell alongside a real expense.
          checkpoints.push({ date: date, balance: inflow });
          running = inflow;
          inflow = 0;
        }
        var t = {
          date: date,
          description: desc === '-' ? '' : desc,
          type: type === '-' ? '' : type,
          tag: String(col(row, 'tag') || '').trim(),
          amount: amount > 0 ? amount : 0,
          inflow: inflow > 0 ? inflow : (amount < 0 ? -amount : 0),
          notes: String(col(row, 'notes') || '').trim(),
          source: 'sheet'
        };
        if (running !== null) running += t.inflow - t.amount;
        txs.push(t);
      }
    });
    return { transactions: txs, checkpoints: checkpoints };
  }

  var api = {
    DEFAULT_RULES: DEFAULT_RULES,
    matchRule: matchRule,
    merchantKey: merchantKey,
    prettyName: prettyName,
    categorize: categorize,
    rulesFromHistory: rulesFromHistory,
    findDuplicates: findDuplicates,
    importTrackingSheets: importTrackingSheets
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Categorize = api;
})(this);
