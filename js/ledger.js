/*
 * Running balance, monthly sheets and summaries — the maths the old
 * spreadsheet did with formulas. Pure functions (no DOM).
 */
(function (root) {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function monthKey(date) { return date.slice(0, 7); }

  /** "2026-05" -> "May 26", the sheet names used in the old workbook. */
  function sheetName(key) {
    var y = key.slice(2, 4), m = +key.slice(5, 7);
    return MONTHS[m - 1] + ' ' + y;
  }

  function monthLabel(key) {
    return MONTHS[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4);
  }

  function sortTransactions(txs) {
    return txs.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.seq || 0) - (b.seq || 0);
    });
  }

  /**
   * Walk every transaction in date order, keeping a running balance.
   * A checkpoint { date, balance } sets the balance at the start of that day
   * (like the "Last Month / Remainder" rows of the old sheets).
   * Returns { months: [{ key, start, end, totalOut, totalIn, rows, byType }], balance }.
   */
  function computeLedger(transactions, checkpoints) {
    var txs = sortTransactions(transactions);
    var cps = (checkpoints || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var balance = 0, ci = 0;
    var months = [], byKey = {};

    function ensureMonth(key) {
      if (!byKey[key]) {
        byKey[key] = { key: key, start: balance, startIsCheckpoint: false, end: balance, totalOut: 0, totalIn: 0, rows: [], byType: {}, checks: [] };
        months.push(byKey[key]);
      }
      return byKey[key];
    }

    function applyCheckpointsUpTo(date) {
      while (ci < cps.length && cps[ci].date <= date) {
        var cp = cps[ci++];
        var m = ensureMonth(monthKey(cp.date));
        var diff = cp.balance - balance;
        if (!m.rows.length && cp.date.slice(0, 7) === m.key) {
          m.start = cp.balance;
          m.startIsCheckpoint = true;
        }
        m.checks.push({ date: cp.date, balance: cp.balance, diff: diff });
        balance = cp.balance;
      }
    }

    txs.forEach(function (t) {
      applyCheckpointsUpTo(t.date);
      var m = ensureMonth(monthKey(t.date));
      var out = +t.amount || 0, inflow = +t.inflow || 0;
      balance = round2(balance - out + inflow);
      m.totalOut = round2(m.totalOut + out);
      m.totalIn = round2(m.totalIn + inflow);
      if (out) {
        var type = t.type || 'Uncategorised';
        m.byType[type] = round2((m.byType[type] || 0) + out);
      }
      m.rows.push({ tx: t, remaining: balance, dayTotal: null });
      m.end = balance;
    });
    applyCheckpointsUpTo('9999-12-31');

    months.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    months.forEach(function (m) {
      // "Total Day": spending per day, shown on the first row of that day.
      var i = 0;
      while (i < m.rows.length) {
        var j = i, sum = 0;
        while (j < m.rows.length && m.rows[j].tx.date === m.rows[i].tx.date) { sum += +m.rows[j].tx.amount || 0; j++; }
        m.rows[i].dayTotal = round2(sum);
        i = j;
      }
      if (!m.rows.length) m.end = m.checks.length ? m.checks[m.checks.length - 1].balance : m.start;
    });
    return { months: months, balance: balance };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * Build the rows for one exported sheet in the old workbook's layout:
   * Date | Description | Type | Tag | Amount | Remaining | Total Day | Notes | Inflow
   * Cells are plain values or { f: formula } objects (Excel formulas, 1-based rows).
   */
  function sheetRows(month) {
    var header = ['Date', 'Description', 'Type', 'Tag', 'Amount', 'Remaining', 'Total Day', 'Notes', 'Inflow'];
    var rows = [header];
    rows.push([month.key + '-01', 'Last Month', 'Remainder', '', '', { f: 'I2-E2', v: month.start }, '', '', month.start]);
    var r = 3;
    var dayStart = null;
    month.rows.forEach(function (row, i) {
      var t = row.tx;
      var dayCell = '';
      if (row.dayTotal !== null) {
        var end = i;
        while (end + 1 < month.rows.length && month.rows[end + 1].dayTotal === null) end++;
        dayStart = r;
        var last = r + (end - i);
        dayCell = { f: last === dayStart ? 'E' + r : 'SUM(E' + dayStart + ':E' + last + ')', v: row.dayTotal };
      }
      rows.push([
        t.date,
        t.description || '',
        t.type || '',
        t.tag || '',
        t.amount ? +t.amount : '',
        { f: 'F' + (r - 1) + '-E' + r + '+I' + r, v: row.remaining },
        dayCell,
        t.notes || '',
        t.inflow ? +t.inflow : ''
      ]);
      r++;
    });
    return rows;
  }

  var api = {
    monthKey: monthKey,
    sheetName: sheetName,
    monthLabel: monthLabel,
    sortTransactions: sortTransactions,
    computeLedger: computeLedger,
    sheetRows: sheetRows
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ledger = api;
})(this);
