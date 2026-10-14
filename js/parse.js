/*
 * Bank report parsing: turns CSV text or spreadsheet rows into a list of
 * { date, text, out, inflow, balance } transactions.
 *
 * Pure functions only (no DOM), so they can be unit tested with Node.
 */
(function (root) {
  'use strict';

  // ---------- text helpers ----------

  function stripDiacritics(s) {
    return String(s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'dj')
      .replace(/Đ/g, 'Dj');
  }

  // Serbian Cyrillic -> Latin, so headers and descriptions match the same keywords.
  var CYR = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj', 'е': 'e', 'ж': 'z', 'з': 'z',
    'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
    'ч': 'c', 'џ': 'dz', 'ш': 's'
  };

  function normalize(s) {
    if (s === null || s === undefined) return '';
    var lower = String(s).toLowerCase();
    var out = '';
    for (var i = 0; i < lower.length; i++) {
      var ch = lower[i];
      out += CYR[ch] !== undefined ? CYR[ch] : ch;
    }
    return stripDiacritics(out).replace(/\s+/g, ' ').trim();
  }

  // ---------- numbers ----------

  /**
   * Parse a money string. `decimalComma` forces "1.234,56" style; when
   * undefined the format is guessed from the string itself.
   * Returns NaN when the value is not a number.
   */
  function parseAmount(value, decimalComma) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;
    var s = String(value).trim();
    if (!s) return NaN;
    var negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ''); }
    s = s.replace(/[\s '’]/g, '').replace(/[^0-9,.\-+]/g, '');
    if (s.charAt(0) === '-') { negative = !negative; s = s.slice(1); }
    if (s.charAt(0) === '+') s = s.slice(1);
    if (!/\d/.test(s) || /[-+]/.test(s)) return NaN;

    var hasDot = s.indexOf('.') !== -1;
    var hasComma = s.indexOf(',') !== -1;
    var dec;
    if (hasDot && hasComma) {
      dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    } else if (hasComma) {
      if (decimalComma === false) dec = '.';
      else if (decimalComma === true) dec = ',';
      else dec = (s.split(',').length === 2 && /,\d{1,2}$/.test(s)) ? ',' : '.';
    } else if (hasDot) {
      if (decimalComma === true) dec = ',';
      else if (decimalComma === false) dec = '.';
      else dec = (s.split('.').length > 2 || /^\d{1,3}\.\d{3}$/.test(s)) ? ',' : '.';
    } else {
      dec = '.';
    }
    var thousands = dec === ',' ? '.' : ',';
    s = s.split(thousands).join('');
    if (dec === ',') s = s.replace(',', '.');
    if (s.split('.').length > 2) return NaN;
    var n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return negative ? -n : n;
  }

  /** Looks at a column of strings and decides whether it uses a decimal comma. */
  function detectDecimalComma(values) {
    var comma = 0, dot = 0;
    values.forEach(function (v) {
      if (typeof v !== 'string') return;
      var s = v.replace(/[^0-9,.]/g, '');
      if (/,\d{1,2}$/.test(s)) comma++;
      else if (/\.\d{1,2}$/.test(s)) dot++;
      else if (/\.\d{3}(\.\d{3})*,?/.test(s) && s.indexOf(',') === -1 && s.split('.').length > 2) comma++;
    });
    if (comma === 0 && dot === 0) return undefined;
    return comma >= dot;
  }

  // ---------- dates ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoDate(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function excelSerialToIso(n) {
    // Excel day 25569 = 1970-01-01
    var ms = Math.round((n - 25569) * 86400000);
    var dt = new Date(ms);
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /**
   * Parse a date from many bank formats. `monthFirst` switches ambiguous
   * "03/04/2026" to US order. Returns "YYYY-MM-DD" or null.
   */
  function parseDate(value, monthFirst) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      // Spreadsheet dates come in as local midnight; use local parts.
      return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === 'number') {
      if (value > 20000 && value < 80000) return excelSerialToIso(value);
      return null;
    }
    var s = String(value).trim();
    var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return isoDate(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2,4})\.?(?:$|[\sT,])/);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (monthFirst && a <= 12) return isoDate(y, a, b);
      if (b > 12 && a <= 12) return isoDate(y, a, b);
      return isoDate(y, b, a);
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return isoDate(+m[1], +m[2], +m[3]);
    return null;
  }

  // ---------- CSV ----------

  function detectDelimiter(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 20);
    var best = ',', bestScore = -1;
    [';', ',', '\t', '|'].forEach(function (d) {
      var counts = lines.map(function (l) { return splitCsvLine(l, d).length; });
      var many = counts.filter(function (c) { return c > 1; });
      if (!many.length) return;
      // Prefer delimiters that produce a consistent, large column count.
      var mode = many.sort(function (x, y) { return x - y; })[Math.floor(many.length / 2)];
      var score = counts.filter(function (c) { return c === mode; }).length * mode;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function splitCsvLine(line, d) {
    return parseCsv(line, d)[0] || [];
  }

  function parseCsv(text, delimiter) {
    text = String(text).replace(/^﻿/, '');
    var d = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === d) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); });
  }

  /** Decode file bytes: UTF-8 if valid, otherwise Windows-1250 (common for Serbian banks). */
  function decodeText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try { return new TextDecoder('windows-1250').decode(bytes); }
      catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
    }
  }

  // ---------- column detection ----------

  var HEADER_WORDS = {
    date: ['datum transakcije', 'datum placanja', 'datum knjizenja', 'datum valute', 'transaction date',
      'booking date', 'posting date', 'value date', 'datum', 'date'],
    text: ['opis transakcije', 'opis', 'description', 'naziv primaoca', 'naziv platioca', 'primalac',
      'platilac', 'naziv', 'svrha placanja', 'svrha', 'details', 'merchant', 'partner', 'narration',
      'payee', 'beneficiary', 'trgovac', 'mesto', 'transaction', 'reference', 'poruka'],
    out: ['zaduzenje', 'duguje', 'isplata', 'isplate', 'debit', 'withdrawal', 'money out', 'out',
      'rashod', 'troskovi', 'paid out'],
    inflow: ['odobrenje', 'potrazuje', 'uplata', 'uplate', 'credit', 'deposit', 'money in', 'in',
      'prihod', 'paid in'],
    amount: ['iznos transakcije', 'iznos u valuti racuna', 'iznos', 'amount', 'suma', 'value'],
    balance: ['stanje', 'saldo', 'balance', 'raspolozivo']
  };

  function headerMatch(cell, words) {
    var n = normalize(cell);
    if (!n) return 0;
    var best = 0;
    words.forEach(function (w, i) {
      var score = 0;
      if (n === w) score = 100 - i;
      else if (new RegExp('(^|[^a-z])' + w.replace(/ /g, '\\s*') + '($|[^a-z])').test(n)) score = 50 - i;
      if (score > best) best = score;
    });
    return best;
  }

  function classifyHeader(cell) {
    var best = null, bestScore = 0;
    Object.keys(HEADER_WORDS).forEach(function (k) {
      var s = headerMatch(cell, HEADER_WORDS[k]);
      if (s > bestScore) { bestScore = s; best = k; }
    });
    return best;
  }

  /** Finds the header row: the first row (of the first 40) with a date column and an amount-ish column. */
  function findHeaderRow(rows) {
    var bestIdx = -1, bestScore = 0;
    for (var i = 0; i < Math.min(rows.length, 40); i++) {
      var kinds = {};
      (rows[i] || []).forEach(function (c) {
        if (typeof c !== 'string' || c.length > 60) return;
        var k = classifyHeader(c);
        if (k) kinds[k] = true;
      });
      var money = kinds.out || kinds.inflow || kinds.amount;
      if (!kinds.date || !money) continue;
      var score = Object.keys(kinds).length;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return bestIdx;
  }

  /**
   * Guess the column mapping from the header row. Returns
   * { headerRow, date, text: [..], out, inflow, amount, balance } (column indexes, -1 if absent).
   * Falls back to sniffing the data when there is no recognisable header.
   */
  function guessMapping(rows) {
    var mapping = { headerRow: -1, date: -1, text: [], out: -1, inflow: -1, amount: -1, balance: -1, monthFirst: false, invert: false };
    var h = findHeaderRow(rows);
    if (h >= 0) {
      mapping.headerRow = h;
      var scores = {};
      rows[h].forEach(function (c, idx) {
        if (typeof c !== 'string') return;
        var k = classifyHeader(c);
        if (!k) return;
        var s = headerMatch(c, HEADER_WORDS[k]);
        if (k === 'text') { mapping.text.push(idx); return; }
        if (scores[k] === undefined || s > scores[k]) { scores[k] = s; mapping[k] = idx; }
      });
      // An "in"/"out" style pair wins over a plain amount column.
      if (mapping.out >= 0 && mapping.inflow >= 0) mapping.amount = -1;
      if (!mapping.text.length) mapping.text = guessTextColumns(rows, h + 1, mapping);
    } else {
      sniffMapping(rows, mapping);
    }
    mapping.monthFirst = guessMonthFirst(rows, mapping);
    return mapping;
  }

  function columnCount(rows) {
    return rows.reduce(function (m, r) { return Math.max(m, (r || []).length); }, 0);
  }

  function used(mapping) {
    return [mapping.date, mapping.out, mapping.inflow, mapping.amount, mapping.balance];
  }

  function guessTextColumns(rows, start, mapping) {
    var n = columnCount(rows), best = -1, bestLen = 0;
    for (var c = 0; c < n; c++) {
      if (used(mapping).indexOf(c) !== -1) continue;
      var len = 0;
      for (var r = start; r < Math.min(rows.length, start + 30); r++) {
        var v = (rows[r] || [])[c];
        if (typeof v === 'string' && isNaN(parseAmount(v)) && !parseDate(v)) len += v.length;
      }
      if (len > bestLen) { bestLen = len; best = c; }
    }
    return best >= 0 ? [best] : [];
  }

  function sniffMapping(rows, mapping) {
    var n = columnCount(rows);
    var dateHits = [], numHits = [];
    for (var c = 0; c < n; c++) { dateHits.push(0); numHits.push(0); }
    rows.slice(0, 50).forEach(function (r) {
      for (var c = 0; c < n; c++) {
        var v = (r || [])[c];
        if (v === undefined || v === '') continue;
        if (parseDate(v)) dateHits[c]++;
        else if (!isNaN(parseAmount(v))) numHits[c]++;
      }
    });
    mapping.date = dateHits.indexOf(Math.max.apply(null, dateHits));
    var numCols = [];
    numHits.forEach(function (h, c) { if (h > 0 && c !== mapping.date) numCols.push(c); });
    mapping.amount = numCols.length ? numCols[0] : -1;
    mapping.text = guessTextColumns(rows, 0, mapping);
  }

  function guessMonthFirst(rows, mapping) {
    if (mapping.date < 0) return false;
    var dayFirst = 0, monthFirst = 0;
    rows.slice(mapping.headerRow + 1).forEach(function (r) {
      var v = (r || [])[mapping.date];
      if (typeof v !== 'string') return;
      var m = v.trim().match(/^(\d{1,2})[/](\d{1,2})[/]\d{2,4}/);
      if (!m) return;
      if (+m[1] > 12) dayFirst++;
      if (+m[2] > 12) monthFirst++;
    });
    return monthFirst > dayFirst;
  }

  // ---------- rows -> transactions ----------

  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return '';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  /**
   * Apply a mapping to raw rows. Rows that have no date but some text are
   * treated as continuation lines of the previous transaction (common in PDFs).
   */
  function extractTransactions(rows, mapping) {
    var body = rows.slice(mapping.headerRow + 1);
    var colValues = function (c) { return c < 0 ? [] : body.map(function (r) { return (r || [])[c]; }); };
    var dc = {};
    ['out', 'inflow', 'amount', 'balance'].forEach(function (k) {
      dc[k] = detectDecimalComma(colValues(mapping[k]));
    });

    var result = [];
    var last = null;
    body.forEach(function (r) {
      r = r || [];
      var date = mapping.date >= 0 ? parseDate(r[mapping.date], mapping.monthFirst) : null;
      var text = mapping.text.map(function (c) { return cellText(r[c]); })
        .filter(Boolean)
        .filter(function (t, i, arr) { return arr.indexOf(t) === i; })
        .join(' · ');

      var out = 0, inflow = 0, has = false;
      if (mapping.out >= 0 || mapping.inflow >= 0) {
        var o = mapping.out >= 0 ? parseAmount(r[mapping.out], dc.out) : NaN;
        var i = mapping.inflow >= 0 ? parseAmount(r[mapping.inflow], dc.inflow) : NaN;
        if (!isNaN(o) && o !== 0) { has = true; if (o < 0) inflow += -o; else out += o; }
        if (!isNaN(i) && i !== 0) { has = true; if (i < 0) out += -i; else inflow += i; }
      }
      if (!has && mapping.amount >= 0) {
        var a = parseAmount(r[mapping.amount], dc.amount);
        if (!isNaN(a) && a !== 0) {
          has = true;
          if (mapping.invert) a = -a;
          if (a < 0) out = -a; else inflow = a;
        }
      }
      var balance = mapping.balance >= 0 ? parseAmount(r[mapping.balance], dc.balance) : NaN;

      if (date && has) {
        last = {
          date: date,
          text: text,
          out: round2(out),
          inflow: round2(inflow),
          balance: isNaN(balance) ? null : balance
        };
        result.push(last);
      } else if (!date && !has && last && text && text.length < 200) {
        if (last.text.indexOf(text) === -1) last.text = (last.text ? last.text + ' · ' : '') + text;
      } else if (!date) {
        last = null; // totals rows, page footers, etc. end a continuation run
      }
    });
    return result;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ---------- PDF text -> rows ----------

  /**
   * Group positioned text items ({str, x, y, w}) into table rows.
   * Items on (almost) the same baseline form a row; a horizontal gap wider
   * than `gap` starts a new cell. PDFs leave empty cells out, so once a
   * header row is found every cell is moved under the nearest header column.
   */
  function itemsToRows(items, gap) {
    gap = gap || 8;
    var sorted = items.filter(function (it) { return it.str && it.str.trim(); })
      .slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    sorted.forEach(function (it) {
      var line = lines.length ? lines[lines.length - 1] : null;
      if (line && Math.abs(line.y - it.y) <= 3) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    });
    var positioned = lines.map(function (line) {
      var its = line.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [], cur = null;
      its.forEach(function (it) {
        var w = it.w || it.str.length * 4;
        if (cur && it.x - cur.x1 < gap) {
          cur.text += (it.x - cur.x1 > 1.5 ? ' ' : '') + it.str;
          cur.x1 = it.x + w;
        } else {
          cur = { text: it.str, x0: it.x, x1: it.x + w };
          cells.push(cur);
        }
      });
      cells.forEach(function (c) { c.text = c.text.trim(); });
      return cells;
    });
    return alignToHeader(positioned);
  }

  function alignToHeader(positioned) {
    var texts = positioned.map(function (cells) { return cells.map(function (c) { return c.text; }); });
    var h = findHeaderRow(texts);
    if (h < 0) return texts;
    var header = positioned[h];
    return positioned.map(function (cells, i) {
      if (i <= h) return texts[i];
      var row = header.map(function () { return ''; });
      cells.forEach(function (c) {
        // Pick the header column this cell overlaps most, else the nearest one.
        var best = 0, bestScore = -Infinity;
        header.forEach(function (hc, j) {
          var overlap = Math.min(c.x1, hc.x1) - Math.max(c.x0, hc.x0);
          var dist = Math.abs((c.x0 + c.x1) / 2 - (hc.x0 + hc.x1) / 2);
          var score = overlap > 0 ? 1000 + overlap : -dist;
          if (score > bestScore) { bestScore = score; best = j; }
        });
        row[best] = row[best] ? row[best] + ' ' + c.text : c.text;
      });
      return row;
    });
  }

  /**
   * Fallback for PDFs whose columns don't line up: read each text line,
   * take the leading date and the money values on it.
   */
  function linesToTransactions(lines) {
    var out = [];
    var money = /-?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}(?!\d)/g;
    var last = null;
    lines.forEach(function (line) {
      var m = line.match(/^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\.?|\d{4}-\d{2}-\d{2})/);
      var date = m ? parseDate(m[1]) : null;
      var rest = m ? line.slice(m[0].length) : line;
      var amounts = (rest.match(money) || []).map(function (a) { return parseAmount(a); });
      if (date && amounts.length) {
        var text = rest.replace(money, '').replace(/\s+/g, ' ').trim();
        // Statements usually end a line with "amount  balance".
        var a = amounts.length > 1 ? amounts[amounts.length - 2] : amounts[0];
        last = { date: date, text: text, out: a < 0 ? -a : a, inflow: 0, balance: amounts.length > 1 ? amounts[amounts.length - 1] : null, direction: a < 0 ? 'out' : 'unknown' };
        out.push(last);
      } else if (last && !date && line.trim() && line.length < 120 && !amounts.length) {
        last.text += ' · ' + line.trim();
      } else {
        last = null;
      }
    });
    // When a running balance is printed, it tells us the direction of each amount.
    for (var i = 1; i < out.length; i++) {
      var prev = out[i - 1].balance, cur = out[i].balance;
      if (prev === null || cur === null || out[i].direction === 'out') continue;
      if (Math.abs(prev + out[i].out - cur) < 0.01) { out[i].inflow = out[i].out; out[i].out = 0; }
    }
    out.forEach(function (t) { delete t.direction; });
    return out;
  }

  var api = {
    normalize: normalize,
    parseAmount: parseAmount,
    detectDecimalComma: detectDecimalComma,
    parseDate: parseDate,
    parseCsv: parseCsv,
    detectDelimiter: detectDelimiter,
    decodeText: decodeText,
    classifyHeader: classifyHeader,
    findHeaderRow: findHeaderRow,
    guessMapping: guessMapping,
    extractTransactions: extractTransactions,
    itemsToRows: itemsToRows,
    linesToTransactions: linesToTransactions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BankParse = api;
})(this);
