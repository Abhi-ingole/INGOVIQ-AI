# INGOVIQ AI — Step-by-step Guide (Marathi + English)

## Part 1 · Website live karne (ekdach karayche)

1. GitHub var repo **INGOVIQ-AI** open kar.
2. **Settings → Pages** madhe jaa. *Build and deployment → Source* madhe **GitHub Actions** select kar.
3. **Actions** tab madhe "Deploy INGOVIQ AI to GitHub Pages" workflow green ✅ hoiparyant thamb (2–3 min). Green nasel tar **Run workflow** dabav.
4. Website link: **https://abhi-ingole.github.io/INGOVIQ-AI/**
   Pudhe code madhe kahi badal push kela ki website automatic update hote.

## Part 2 · Dashboard vaparne

0. **Purna loan file (folder / zip):** *Get data → 🗂 Upload folder* (kiva *🗜 Upload zip / files*) — company cha purna folder / zip nivad. Bank statement PDF, GSTR-3B, CIBIL / CMR, net-worth, MCA, Tally ledger, ageing, loan obligation, KYC — sagle files automatic vachle jatat ani purna report tayar hoto. Progress khali disto.
   - Password asleli PDF: folder / file navat `pass-1234` asel tar automatic try hoto. Nahitar *PDF passwords* box madhe password takun **Add & retry**.
   - **Loan File** page var pratyek file chi list — used / scanned / needs password / duplicate.
   - Audited financials scanned (photo) PDF astil tar: **Data view → Financial line items → Add last 3 years** ani figures type kar, kiva **⤓ Financial input template** download karun Excel madhe bhar ani parat upload kar.
1. **Get data** — Chrome / Edge madhe website open kar. *Choose Excel files* var click karun 3 files nivad: Financial report, GST analysis report, Banking analysis report. (Ek-don files pan chaltat.)
   - Prateyk file samor tichi type disel (📊 Financial / 🧾 GST / 🏦 Banking). Chukichi asel tar *Treat as…* madhun badal.
2. **Open dashboard →** dabav. Data automatic clean hoto, sagle calculations hotat.
3. **Pages (khali tabs):** Overview → Financials → Ratios → Working Capital → GST → Banking → Reconciliation → Ageing & Bureau → Risk & SWOT → Credit Decision → My Visuals. Section numbers (1–40) credit report format pramane aahet.
4. **Filters (right side):** financial year select kar. Chart madhla year bar click kela tari filter lagto.
5. **Graph badalne:** chart var mouse ne → **⇄** (type badal: column / bar / line / area / stacked / pie / donut / table), **▦** (data table), **⤓** (PNG), **⤢** (motha kar).
6. **Data view (▦ left side):** clean kelela data, source rows mapping ani *Cleaning log*. Ekhadi value chukli asel tar *override* column madhe type kar — sagla dashboard recalculate hoto.
7. **Model (ƒ):** DAX sarkhe swatache measures — e.g. `DIVIDE([EBITDA], [Interest])`, `YOY([Revenue])`.
8. **My Visuals:** data → fields → visual type nivad ani *Add* kar. Browser madhe save rahte.
9. **Files madhe nasleli mahiti:**
   - **Settings:** funding requirement, promoter net worth, principal repayment (DSCR sathi), CC limit, DP margins, GST rate.
   - **Ageing & Bureau page:** debtor / creditor ageing, CIBIL, CMR.
   - **Banking → section 22:** party classification badal (Business / Internal / Promoter / Loan…).
10. **Live data:** files *Get data* ne Chrome/Edge madhe open kelya (kiva drag-drop kelya) ki **Live 🟢** on hote. Excel save kela ki 3 second madhe dashboard update. Page reload kelyavar "Reconnect files" dabav.
11. **Download:** ribbon madhe
    - **🌐 HTML** — ekach `.html` file madhe purna dashboard + data. Internet nastana pan kontyahi browser madhe open hote. Sagle pages, filters, chart badalne, PDF/Excel export tyatun pan chalte. Email / WhatsApp var pathavta yete.
    - **PDF report** (purna credit report, pratyek page var disclaimer), **Excel** (sagle tables), **PNG page**.
    - Downloaded HTML madhe navin Excel data pahije tar **Get data / Refresh** dabav ani updated files nivad (Chrome/Edge madhe Live pan on hote). Mag tithunach parat **🌐 HTML** download kar — navin data sahit.
12. **Nako asleli mahiti lapvne (Show / hide):** ribbon madhe **☑ Show / hide** dabav. Page tabs, section titles ani pratyek graph var tick box yeto — untick kela ki te dashboard, PDF, Excel (page) ani HTML madhun nighte. **Done** dabav. Parat sagla dakhvaycha asel tar *Show everything*.
13. **PDF madhe sagla data:** PDF madhe pratyek table chya sagle rows, pratyek financial year vegla (statements, buyers, suppliers, states) yetat; page break row chya madhe yeto, row tutat nahi.
14. **Fakt data asalele tabs:** jya prakarchya files upload kelya, tyache ch report tabs distat (e.g. financials nastil tar Financials / Ratios / Working Capital tabs disat nahit).
15. **Pratyek report vegla download:** pratyek page chya varti **⤓ <page> PDF**, **⤓ <page> Excel** ani **⤓ PNG** buttons aahet. Ribbon madhla **PDF report** / **Excel** purna report deto. Excel madhe Indian number format (₹ lakh / crore grouping), column widths ani filter set astat.
16. **Data sources tick box (Filters pane):** ekhada source untick kela (e.g. Banking) tar to sagla report madhun vagalla jato; parat tick kela ki parat yeto. Financial year tick kela ki Overview, GST ani Banking charts tya varshapurte filter hotat.
17. **Navin company:** tichya files upload kar — same type chi juni file replace hote. Sagla clear karayla **Clear**.

## Part 3 · Accuracy kashi check karaychi

- **Ratios page → "Source cross-check"** madhe uploaded report madhle ratios dakhavle aahet; INGOVIQ che numbers tyachyashi compare karta yetat.
- Pratyek measure cha formula ani DAX **Ratios** ani **Model** madhe disto.
- **Data view → Cleaning log** madhe app ne kay detect / convert / skip kele te disto.
- Sarangi Metal sample var 21/21 key numbers source files shi match zale (current ratio, quick ratio, D/E, debtor/creditor/stock days, ROE, bank credits/debits, returns, loans, cash, GST totals, buyer concentration, export %).

## Part 4 · Privacy

Files fakt tujhya browser madhech process hotat — kuthlyahi server var jaat nahit. Client chi Excel files GitHub repo madhe **commit karu naka** (`.gitignore` already .xlsx block karto).
