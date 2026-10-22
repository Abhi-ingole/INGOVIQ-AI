<p align="center"><img src="public/logo-full.png" alt="INGOVIZ AI" width="460"></p>

<h3 align="center">Turn Data Into Intelligence.</h3>
<p align="center">AI-Powered Business Intelligence Platform — a Power BI Desktop–style web app for credit, financial, GST and banking analysis.<br>Created by <b>Abhishek Ingole</b></p>

---

## What it does

Drop three Excel reports — **Financial statements**, **GST analysis** and **Banking analysis / bank statement** — and INGOVIZ AI:

1. **Recognises each file and cleans it automatically** (no Power Query): finds the right sheets, converts numbers stored as text (`2,75,000.00`), aligns financial years, skips duplicated account blocks, maps line items, and writes a cleaning log.
2. **Calculates every credit parameter with fixed formulas** — same files, same answer, every time:
   - 3-year financial performance, each year presented separately, YoY growth / decline, CAGR, trend
   - All **21 core parameters** (EBIT, EBITDA, Net Profit, Operating Profit, Promoter Net Worth, DSCR, Current, Quick, Debt–Equity, Adjusted D/E, ICR, TOL/TNW, Net Profit to Sales, Debt/EBITDA, OCF/Interest, Retained Earnings/Equity, Debtor / Creditor / Stock periods, Working Capital Ratio, Drawing Power)
   - Working-capital cycle, MPBF and turnover-method gap
   - GST: sales vs purchases, buyer & supplier concentration (top 5 / top 10 / largest / HHI), exports, filing delays & late fee, state-wise, intra-group, GSTR-1 vs 3B, HSN (when provided)
   - Banking: monthly trend, internal transfers (own accounts incl. CMS-A2A transfers, group / associate companies read from the company report, promoter accounts), loan and NBFC credits, **adjusted business inflow**, cheque / ECS / NACH / EMI returns, penal charges, credit entries, BTO, party-wise flows, loan disbursals, cash deposits, **daily CC/OD utilisation**
   - **Reconciliation**: Financial vs GST vs Banking by year and on matching months, plus party-wise (triangular) buyer and supplier matching
3. **Builds the dashboard** — 11 report pages that follow the 40-section credit-analysis format, with an integrated credit score (13 dimensions), red flags, SWOT, funding capacity, product mapping and GO / CONDITIONAL GO / NO-GO recommendation.

## Power BI–style features

| | |
|---|---|
| Report / Data / Model views | Left rail like Power BI Desktop |
| Filters pane | Financial-year slicer; click a chart bar to cross-filter |
| Editable visuals | Every chart: switch type (column, bar, line, area, stacked, pie, donut, table), see data, download PNG, focus mode |
| My Visuals | Build your own visuals from any cleaned dataset |
| DAX-style measures | `DIVIDE`, `IF`, `YOY`, `PREVIOUSYEAR`, `MIN`, `MAX`, `ROUND`… on all financial fields |
| Live data | In Chrome / Edge, opened files are watched — save the Excel and the dashboard refreshes |
| Overrides | Correct any financial value or bank-party classification; everything recalculates |
| Export | **Interactive HTML** (one offline file with the full dashboard + data), full **PDF credit report** (disclaimer on every page), **Excel** workbook of all tables, PNG of any page |
| Private | Runs entirely in the browser. Files never leave the computer. |
| Light / dark | Theme toggle |

No API key or server is needed. The "AI" narrative (trend comments, SWOT, red flags, analyst note, answers to the 18 credit questions) is produced by a transparent rule engine from the calculated numbers.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

Developer check against your own sample files (not committed):

```bash
SAMPLES=/path/to/excel/folder npm test
```

## Deploy to GitHub Pages

1. Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes the site.
3. The app is then live at `https://<your-user>.github.io/INGOVIQ-AI/`.

## Supported inputs

- **Financial report** — any workbook with statements laid out as *line item × financial year* (e.g. Corpository-style company reports, CMA-style sheets). Directors, charges and GST establishment filings are read when present.
- **GST analysis report** — summary, customer-wise, supplier-wise, state-wise, intra-group, GSTR-3B and filing sheets.
- **Banking analysis report** — the consolidated raw-transaction sheet (plus executive summary), or a plain bank statement with Date / Narration / Debit / Credit / Balance columns.

- **A complete loan file — folder or zip** (*Get data → Upload folder / Upload zip*). Every file inside is classified and read in the browser:
  - **Bank-statement PDFs** (HDFC, YES, ICICI, SBI, Axis and similar layouts) — columns found from the header, running balance checked, overlapping statements of the same account merged and de-duplicated. Passwords written in folder / file names (e.g. `pass-1234`) are tried automatically; others can be added under *PDF passwords*.
  - **GSTR-3B PDFs** (all GSTINs) — monthly outward supplies, zero-rated, nil / exempt, output tax, ITC, filing date vs due date.
  - **CIBIL** consumer reports and **CMR** commercial report, **net-worth certificates**, **MCA master data**, **GST registration certificates**.
  - **Tally "Ledger Vouchers" export** — party-wise sales and purchases (feeds buyer / supplier concentration), receipts, payments, closing balances.
  - **Invoice ageing** (debtors / creditors), **MOM sales / purchase bills**, **loan obligation sheet**.
  - KYC, images, scanned PDFs and other documents are listed in the **Loan File** page inventory with their status (used / scanned / needs password / duplicate).
  - Scanned audited statements cannot be read as text: add the years in **Data view → Financial line items** and type the figures, or download the **financial input template**, fill it and upload it.

**Ask INGOVIZ:** a built-in assistant (no API key) that answers questions about the loaded report — in English, Hinglish or Marathi — from the analysed data only, with the evidence for each answer.

**Evidence-based SWOT:** generated automatically; every point carries its metric, value, benchmark, source documents and report section; weaknesses and threats get a severity (Low / Medium / High) and a recommendation. Download as PDF or Excel.

**Power BI:** *Power BI* in the ribbon downloads a Power BI Project (.pbip) laid out exactly like the 40-section *Integrated Financial, GST, Banking & Credit Analysis Report*: 17 pages carrying sections 1–40 in the same order and with the same headings (snapshot, executive summary, 3-year financials, 21 ratios, working capital, GST 6–13, banking 14–25, reconciliation 26–28, ageing & bureau, red flags & SWOT, scorecard, funding, product mapping, recommendation, analyst remarks with the 18 questions), cards, charts (columns, lines, combo, waterfall, gauge, bars) and tables on every page, and the Section 40 disclaimer at the bottom of every page. The analysed data is embedded in the model; unzip and open the .pbip in Power BI Desktop.

**Show / hide:** ribbon → *Show / hide* puts tick boxes on page tabs, section titles and visuals. Unticked items disappear from the dashboard, the PDF report, the Excel export (pages) and the HTML export.

**Full exports:** the PDF contains every row of every table and every financial year separately (page breaks fall between rows); the Excel workbook adds the loan-file sheets (documents, GSTR-3B, loans, bureau, ageing, Tally parties).

If a file is laid out differently, use **Treat as…** on the Get-data screen and correct any missing value in **Data view → Financial line items**.

## Project structure

```
src/engine/   parsing, cleaning and every calculation (pure TypeScript, unit-testable)
src/ui/       React pages, charts (ECharts), exporters
public/       logo and favicon
```

## Disclaimer

This software produces decision-support analysis only. Indicative eligibility, funding capacity, product recommendation, risk classification and credit score remain subject to independent due diligence, applicable regulations and the lender's own credit policy. Scoring weights, benchmarks and cut-offs should be approved before production use.

---
© 2026 Abhishek Ingole · MIT License
