const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/categorize.js');

test('default rules match whole words in messy bank text', () => {
  const r = C.categorize({ text: 'POS KUPOVINA 12.05 MAXI 0123 BEOGRAD RS', out: 100, inflow: 0 }, C.DEFAULT_RULES);
  assert.equal(r.description, 'Maxi');
  assert.equal(r.type, 'Supermarket');
  // "maxi" must not match inside another word
  assert.equal(C.categorize({ text: 'MAXIMUS SHOP', out: 1, inflow: 0 }, C.DEFAULT_RULES).type, '');
});

test('user rules beat default rules, longer keywords beat shorter', () => {
  const rules = C.DEFAULT_RULES.concat([
    { match: 'maxi', name: 'Maxi', type: 'Groceries', source: 'user' },
    { match: 'wiener osiguranje', name: 'Wiener', type: 'Insurance', tag: 'Monthly', source: 'history' },
  ]);
  assert.equal(C.matchRule('MAXI 22', rules).type, 'Groceries');
  assert.equal(C.matchRule('WIENER STADTISCHE OSIGURANJE', rules).name, 'Wiener Osiguranje');
  assert.equal(C.matchRule('Wiener osiguranje a.d.o.', rules).name, 'Wiener');
});

test('merchantKey strips bank noise', () => {
  assert.equal(C.merchantKey('POS KUPOVINA 12.05.2026 COFFEE VIBES 0021 BEOGRAD RS'), 'coffee vibes');
  assert.equal(C.merchantKey('Plaćanje karticom ZDRAVA HRANA DOO · ref 123'), 'zdrava hrana');
});

test('rulesFromHistory keeps only consistently-labelled descriptions', () => {
  const rules = C.rulesFromHistory([
    { description: 'Sunce', type: 'Supermarket' }, { description: 'Sunce', type: 'Supermarket' },
    { description: 'Friend', type: 'Loan' }, { description: 'Friend', type: 'Return' }, { description: 'Friend', type: 'Bills' },
    { description: 'Therapy', type: 'Health', tag: 'Weekly' },
    { description: 'Last Month', type: 'Remainder' },
  ]);
  const byKey = Object.fromEntries(rules.map(r => [r.match, r]));
  assert.equal(byKey.sunce.type, 'Supermarket');
  assert.equal(byKey.therapy.tag, 'Weekly');
  assert.equal(byKey.friend, undefined);
  assert.equal(byKey['last month'], undefined);
});

test('findDuplicates matches re-uploads and hand-typed rows once each', () => {
  const existing = [
    { id: 1, date: '2026-05-04', amount: 3410, inflow: 0, bankText: '' },
    { id: 2, date: '2026-05-05', amount: 200, inflow: 0, bankText: 'CLANARINA' },
  ];
  const incoming = [
    { date: '2026-05-05', text: 'MAXI', out: 3410, inflow: 0 },
    { date: '2026-05-05', text: 'MAXI', out: 3410, inflow: 0 },
    { date: '2026-05-05', text: 'CLANARINA', out: 200, inflow: 0 },
    { date: '2026-05-20', text: 'X', out: 200, inflow: 0 },
  ];
  const d = C.findDuplicates(incoming, existing);
  assert.equal(d[0].match.id, 1);
  assert.equal(d[1], null);
  assert.equal(d[2].match.id, 2);
  assert.equal(d[2].exact, true);
  assert.equal(d[3], null);
});

test('importTrackingSheets reads both old layouts and carry-over rows', () => {
  const dec = [
    ['Date', 'Description', 'Type', 'Tag', 'Amount', 'Inflow', 'Remaining', 'Total Day', 'Notes'],
    [46005, 'Lens', 'Equipment', '', 4800, '', 162590, 4800, ''],
    [46006, '-', '-', '', '-', '', 162590, '-', ''],
    [46010, 'Salary+', '', '', '', 1000, 163590, '', ''],
  ];
  const jan = [
    ['Date', 'Description', 'Type', 'Tag', 'Amount', 'Remaining', 'Total Day', 'Notes', 'Inflow'],
    [46030, 'Breakfast', 'Food', '', 177, '', '', '', 163000],
    [46031, 'Sunce', 'Supermarket', '', 100, '', '', 'note', ''],
  ];
  const feb = [
    ['Date', 'Description', 'Type', 'Tag', 'Amount', 'Remaining', 'Total Day', 'Notes', 'Inflow'],
    [46054, 'Last Month', 'Remainder', '', '', '', '', '', 160000],
    [46055, 'Maxi', 'Supermarket', '', 50, '', '', '', ''],
  ];
  const r = C.importTrackingSheets([{ rows: dec }, { rows: jan }, { rows: feb }]);
  assert.deepEqual(r.checkpoints.map(c => c.balance), [167390, 163000, 160000]);
  assert.equal(r.transactions.length, 5);
  assert.equal(r.transactions[2].description, 'Breakfast');
  assert.equal(r.transactions[2].inflow, 0);
  assert.equal(r.transactions[3].notes, 'note');
});
