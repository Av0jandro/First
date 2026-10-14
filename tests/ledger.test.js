const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/ledger.js');

const txs = [
  { date: '2026-05-02', description: 'Dima', type: 'Supermarket', amount: 783, inflow: 0, seq: 1 },
  { date: '2026-05-04', description: 'Salary', type: 'Salary', amount: 0, inflow: 150000, seq: 2 },
  { date: '2026-05-04', description: 'Vero', type: 'Supermarket', amount: 3410, inflow: 0, seq: 3 },
  { date: '2026-05-04', description: 'Aroma', type: '', amount: 875, inflow: 0, seq: 4 },
  { date: '2026-06-01', description: 'Maxi', type: 'Supermarket', amount: 100, inflow: 0, seq: 5 },
];

test('running balance, day totals and month summaries', () => {
  const { months, balance } = L.computeLedger(txs, [{ date: '2026-05-01', balance: 5000 }]);
  assert.equal(months.length, 2);
  const may = months[0];
  assert.equal(may.start, 5000);
  assert.equal(may.startIsCheckpoint, true);
  assert.deepEqual(may.rows.map(r => r.remaining), [4217, 154217, 150807, 149932]);
  assert.deepEqual(may.rows.map(r => r.dayTotal), [783, 4285, null, null]);
  assert.equal(may.totalIn, 150000);
  assert.equal(may.totalOut, 5068);
  assert.deepEqual(may.byType, { Supermarket: 4193, Uncategorised: 875 });
  assert.equal(months[1].start, 149932);
  assert.equal(balance, 149832);
});

test('sheetRows writes formulas in the old workbook layout', () => {
  const may = L.computeLedger(txs, [{ date: '2026-05-01', balance: 5000 }]).months[0];
  const rows = L.sheetRows(may);
  assert.deepEqual(rows[0], ['Date', 'Description', 'Type', 'Tag', 'Amount', 'Remaining', 'Total Day', 'Notes', 'Inflow']);
  assert.equal(rows[1][1], 'Last Month');
  assert.equal(rows[1][8], 5000);
  assert.equal(rows[2][5].f, 'F2-E3+I3');
  assert.equal(rows[2][6].f, 'E3');
  assert.equal(rows[3][6].f, 'SUM(E4:E6)');
  assert.equal(rows[4][6], '');
  assert.equal(L.sheetName('2026-05'), 'May 26');
});
