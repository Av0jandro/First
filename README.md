# Money

A small expense tracker that works like a monthly money spreadsheet, but fills
itself in from your bank report.

Upload the statement you download from e-banking (CSV, Excel or PDF). Every
payment and every incoming amount lands in that month's sheet with a
description, type and tag, and the running **Remaining** balance and
**Total Day** are worked out for you, the same columns as the old `Money.xlsx`:

| Date | Description | Type | Tag | Amount | Inflow | Remaining | Total Day | Notes |
|------|-------------|------|-----|--------|--------|-----------|-----------|-------|

Everything runs in your browser. Your bank data is never uploaded anywhere.

## Getting started

1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open `index.html` in Chrome, Edge or Firefox. There is nothing to install.
3. **Import your old spreadsheet** (⋯ menu → *Import my old spreadsheet*) and pick
   `Money.xlsx`. All your months come in. Each month's carried-over balance is
   kept, and the app learns which type you give each place (Maxi → Supermarket,
   Pharmacy → Health, and so on).
4. **Upload bank report** and pick the file from your bank.
   - The app finds the date, description, money out / money in and balance
     columns by itself, in Serbian (Latin or Cyrillic) or English. If it guesses
     wrong, open **Columns** in the import window and pick them yourself.
   - Each row is named and categorised using what it learned, plus a built-in list
     of common shops and services. Rows it doesn't recognise are highlighted:
     type a type, and it will remember that merchant next time.
   - Rows you already have (from an earlier upload, or typed in by hand) are
     detected and left unticked, so uploading overlapping reports is safe.
   - If the report has a balance column, tick *Match my balance to the
     statement*. When the app's balance differs from the bank's, a `¿? / Missing
     Balance` row covers the difference, as in the old sheet.
5. **Export Excel** gives you a workbook with one sheet per month ("May 26",
   "June 26", …) in the old layout, with working formulas.

You can also add cash payments by hand (**+ Add**), edit any row (**Edit** or
double-click), change a row's type straight in the table, and set your real
balance at any time (⋯ → *Set actual balance*).

## Your data

The data is stored in the browser you use (local storage). Clearing site data
deletes it. Use ⋯ → **Download backup** now and then; *Restore backup* loads one
back, on this computer or another.

## Category rules

⋯ → **Category rules** lists what the app has learned. When a bank description
contains the keyword, the row gets that description, type and tag. You can edit,
add and delete rules, turn the built-in merchant list off, and re-categorise
rows that still have no type.

## Supported bank reports

- **CSV / TXT**: any delimiter (`;` `,` tab), UTF-8 or Windows-1250, with or
  without lines before the header.
- **Excel** (`.xlsx`, `.xls`, `.ods`): the sheet that contains the transaction table.
- **PDF**: statements with selectable text. Scanned PDFs (images) can't be read.
  For those, download CSV or Excel from your e-banking instead.

Amounts can be `1.234,56` or `1,234.56`, in separate debit/credit columns or as
one signed column. Dates can be `14.12.2025.`, `2025-12-14` or `14/12/2025`.

## Development

Plain HTML, CSS and JavaScript. There is no build step.

```
js/parse.js       bank file parsing (CSV, columns, numbers, dates, PDF text)
js/categorize.js  rules, merchant names, duplicates, old-sheet import
js/ledger.js      running balance, months, day totals, Excel layout
js/app.js         the user interface
vendor/           SheetJS (Excel) and pdf.js (PDF), bundled so it works offline
```

Run the tests with Node 18+:

```
npm test
```
