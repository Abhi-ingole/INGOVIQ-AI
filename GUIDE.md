# INGOVIQ AI — Step-by-step Guide (Marathi + English)

## Part 1 · Website live karne (ekdach karayche)

1. GitHub var repo **INGOVIQ-AI** open kar.
2. **Settings → Pages** madhe jaa. *Build and deployment → Source* madhe **GitHub Actions** select kar.
3. **Actions** tab madhe "Deploy INGOVIQ AI to GitHub Pages" workflow green ✅ hoiparyant thamb (2–3 min). Green nasel tar **Run workflow** dabav.
4. Website link: **https://abhi-ingole.github.io/INGOVIQ-AI/**
   Pudhe code madhe kahi badal push kela ki website automatic update hote.

## Part 2 · Dashboard vaparne

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
11. **Download:** ribbon madhe **PDF report** (purna credit report, pratyek page var disclaimer), **Excel** (sagle tables), **PNG page**.
12. **Navin company:** tichya files upload kar — same type chi juni file replace hote. Sagla clear karayla **Clear**.

## Part 3 · Accuracy kashi check karaychi

- **Ratios page → "Source cross-check"** madhe uploaded report madhle ratios dakhavle aahet; INGOVIQ che numbers tyachyashi compare karta yetat.
- Pratyek measure cha formula ani DAX **Ratios** ani **Model** madhe disto.
- **Data view → Cleaning log** madhe app ne kay detect / convert / skip kele te disto.
- Sarangi Metal sample var 21/21 key numbers source files shi match zale (current ratio, quick ratio, D/E, debtor/creditor/stock days, ROE, bank credits/debits, returns, loans, cash, GST totals, buyer concentration, export %).

## Part 4 · Privacy

Files fakt tujhya browser madhech process hotat — kuthlyahi server var jaat nahit. Client chi Excel files GitHub repo madhe **commit karu naka** (`.gitignore` already .xlsx block karto).
