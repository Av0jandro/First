const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parse.js');

test('parseAmount handles Serbian and English formats', () => {
  assert.equal(P.parseAmount('1.234,56'), 1234.56);
  assert.equal(P.parseAmount('1,234.56'), 1234.56);
  assert.equal(P.parseAmount('-2.500,00'), -2500);
  assert.equal(P.parseAmount('2 500,00 RSD'), 2500);
  assert.equal(P.parseAmount('(45.10)'), -45.1);
  assert.equal(P.parseAmount('120,5'), 120.5);
  assert.equal(P.parseAmount('17.607'), 17607);
  assert.equal(P.parseAmount('17.607', false), 17.607);
  assert.equal(P.parseAmount('300'), 300);
  assert.equal(P.parseAmount(42), 42);
  assert.ok(Number.isNaN(P.parseAmount('')));
  assert.ok(Number.isNaN(P.parseAmount('abc')));
});

test('parseDate handles common bank formats', () => {
  assert.equal(P.parseDate('14.12.2025.'), '2025-12-14');
  assert.equal(P.parseDate('14.12.2025 13:45'), '2025-12-14');
  assert.equal(P.parseDate('2026-05-04'), '2026-05-04');
  assert.equal(P.parseDate('03/04/2026'), '2026-04-03');
  assert.equal(P.parseDate('03/04/2026', true), '2026-03-04');
  assert.equal(P.parseDate('12/25/2025'), '2025-12-25');
  assert.equal(P.parseDate(46143), '2026-05-01');
  assert.equal(P.parseDate('31.02.2026'), null);
  assert.equal(P.parseDate('Total'), null);
});

test('CSV with semicolons, quotes and a preamble is mapped and extracted', () => {
  const csv = [
    'Izvod po računu;;;;',
    'Račun:;265-0000000000000-00;;;',
    '',
    'Datum transakcije;Opis;Zaduženje;Odobrenje;Stanje',
    '04.05.2026;"POS KUPOVINA MAXI 0123 BEOGRAD";3.410,00;;168.821,00',
    '04.05.2026;Zarada ACME DOO;;150.000,00;318.821,00',
    '05.05.2026;"Naplata članarine; paket";200,00;;318.621,00',
    ';Ukupno;3.610,00;150.000,00;',
  ].join('\r\n');
  const rows = P.parseCsv(csv);
  const m = P.guessMapping(rows);
  assert.equal(m.headerRow, 3);
  assert.equal(m.date, 0);
  assert.deepEqual(m.text, [1]);
  assert.equal(m.out, 2);
  assert.equal(m.inflow, 3);
  assert.equal(m.balance, 4);
  const txs = P.extractTransactions(rows, m);
  assert.equal(txs.length, 3);
  assert.deepEqual(txs[0], { date: '2026-05-04', text: 'POS KUPOVINA MAXI 0123 BEOGRAD', out: 3410, inflow: 0, balance: 168821 });
  assert.equal(txs[1].inflow, 150000);
  assert.equal(txs[2].text, 'Naplata članarine; paket');
});

test('signed amount column and Cyrillic headers', () => {
  const rows = [
    ['Датум', 'Опис', 'Износ'],
    ['01.06.2026', 'Wolt', '-1.250,00'],
    ['02.06.2026', 'Povraćaj', '500,00'],
  ];
  const m = P.guessMapping(rows);
  const txs = P.extractTransactions(rows, m);
  assert.deepEqual(txs.map(t => [t.out, t.inflow]), [[1250, 0], [0, 500]]);
});

test('continuation lines are appended to the previous description', () => {
  const rows = [
    ['Date', 'Description', 'Amount'],
    ['2026-06-01', 'CARD PAYMENT', '-10.00'],
    ['', 'ZARA BELGRADE', ''],
    ['2026-06-02', 'SALARY', '100.00'],
  ];
  const txs = P.extractTransactions(rows, P.guessMapping(rows));
  assert.equal(txs[0].text, 'CARD PAYMENT · ZARA BELGRADE');
});

test('PDF text items group into rows and the line fallback finds direction from balance', () => {
  const rows = P.itemsToRows([
    { str: 'Datum', x: 10, y: 700, w: 30 }, { str: 'Opis', x: 100, y: 700, w: 20 }, { str: 'Iznos', x: 300, y: 700, w: 25 },
    { str: '01.06.2026', x: 10, y: 680, w: 50 }, { str: 'MAXI', x: 100, y: 680, w: 20 }, { str: '-1.000,00', x: 300, y: 681, w: 40 },
  ]);
  assert.deepEqual(rows, [['Datum', 'Opis', 'Iznos'], ['01.06.2026', 'MAXI', '-1.000,00']]);

  const txs = P.linesToTransactions([
    '01.06.2026  Opening   10.000,00',
    '02.06.2026  MAXI BEOGRAD   1.000,00   9.000,00',
    '03.06.2026  UPLATA   5.000,00   14.000,00',
  ]);
  assert.equal(txs[1].out, 1000);
  assert.equal(txs[2].inflow, 5000);
  assert.equal(txs[2].out, 0);
});
