import type { FinancialData, FYMap, ManualInputs } from './types';
import { div, growth, fyStartYear, parseDate } from './utils';

export type Unit = 'inr' | 'pct' | 'x' | 'days' | 'text';
export interface Metric {
  key: string;
  name: string;
  group: string;
  formula: string;
  dax: string;
  unit: Unit;
  values: FYMap;
  yoy: FYMap;
  cagr: number | null;
  trend: string;
  better?: 'high' | 'low';
  benchmark?: string;
  note?: string;
}

export interface FinAnalysis {
  fys: string[];
  base: Record<string, FYMap>; // cleaned + derived base items
  performance: Metric[];
  ratios: Metric[];
  extra: Metric[];
  wc: { fy: string; inventoryDays: number | null; debtorDays: number | null; creditorDays: number | null; cycle: number | null; gap: number | null }[];
  wcAssessment: { cycle: string; receivables: string; inventory: string; supplierDependency: string; additionalWC: number | null; mpbf: number | null; turnoverMethod: number | null };
  notes: string[];
}

const G = (m: Record<string, FYMap>, k: string, fy: string): number | null => m[k]?.[fy] ?? null;

function trendOf(values: FYMap, fys: string[]): { yoy: FYMap; cagr: number | null; trend: string } {
  const yoy: FYMap = {};
  fys.forEach((fy, i) => (yoy[fy] = i ? growth(values[fy], values[fys[i - 1]]) : null));
  const seq = fys.map((f) => values[f]).filter((v): v is number => v !== null && v !== undefined);
  let cagr: number | null = null;
  if (seq.length >= 2 && seq[0] > 0 && seq[seq.length - 1] > 0) cagr = (seq[seq.length - 1] / seq[0]) ** (1 / (seq.length - 1)) - 1;
  let trend = 'Insufficient data';
  if (seq.length >= 2) {
    const diffs = seq.slice(1).map((v, i) => v - seq[i]);
    const first = seq[0], last = seq[seq.length - 1];
    const ch = first !== 0 ? (last - first) / Math.abs(first) : last > 0 ? 1 : last < 0 ? -1 : 0;
    if (diffs.every((d) => d >= 0) && ch > 0.05) trend = 'Consistent growth';
    else if (diffs.every((d) => d <= 0) && ch < -0.05) trend = 'Consistent decline';
    else if (Math.abs(ch) <= 0.05) trend = 'Stable';
    else trend = ch > 0 ? 'Growth (uneven)' : 'Decline (uneven)';
  }
  return { yoy, cagr, trend };
}

export function analyseFinancial(fd: FinancialData, inp: ManualInputs): FinAnalysis {
  const fys = fd.fys;
  const notes: string[] = [];
  // apply user overrides on top of parsed items
  const it: Record<string, FYMap> = {};
  for (const [k, v] of Object.entries(fd.items)) it[k] = { ...v };
  for (const [k, ov] of Object.entries(inp.financialOverrides || {})) {
    it[k] = { ...(it[k] || {}) };
    for (const [fy, v] of Object.entries(ov)) if (v !== null && v !== undefined && !Number.isNaN(v)) it[k][fy] = v;
  }

  const inc = parseDate(fd.profile['Date of Incorporation'] || '') || '';
  const incFYStart = inc ? (+inc.slice(5, 7) >= 4 ? +inc.slice(0, 4) : +inc.slice(0, 4) - 1) : null;

  const b: Record<string, FYMap> = {};
  const set = (k: string, fy: string, v: number | null) => { (b[k] ||= {})[fy] = v; };
  for (const fy of fys) {
    const g = (k: string) => G(it, k, fy);
    const z = (k: string) => G(it, k, fy) ?? 0;
    const revenue = g('revenue_ops') ?? g('gross_sales');
    const otherInc = z('other_income');
    const totalIncome = g('total_income') ?? (revenue !== null ? revenue + otherInc : null);
    const interest = z('finance_cost');
    const dep = z('depreciation');
    const pbt = g('pbt');
    const taxDirect = (g('current_tax') ?? null) !== null || (g('deferred_tax') ?? null) !== null ? z('current_tax') + z('deferred_tax') : null;
    let pat = g('pat');
    const tax = taxDirect ?? (pbt !== null && pat !== null ? pbt - pat : 0);
    if (pat === null && pbt !== null) pat = pbt - tax;
    const networth = g('networth') ?? (g('share_capital') !== null ? z('share_capital') + z('reserves') : null);
    const intangibles = z('intangible_assets');
    const unsecured = z('unsecured_lt') + z('unsecured_st');
    const borrowings = z('lt_borrowings') + z('st_borrowings');
    const securedDebt = g('secured_lt') !== null || g('secured_st') !== null ? z('secured_lt') + z('secured_st') : Math.max(0, borrowings - unsecured);
    const totalLiab = g('total_liabilities') ?? g('total_assets');
    const tca = g('total_ca') ?? z('inventories') + z('receivables') + z('cash') + z('st_loans_adv') + z('other_ca') + z('current_investments');
    const tcl = g('total_cl') ?? z('st_borrowings') + z('trade_payables') + z('other_cl') + z('st_provisions');
    const purchases = z('purchases') + z('materials');
    const cogs = z('materials') + z('purchases') + z('inventory_change');
    const ebit = pat !== null ? pat + interest + tax : null;
    const ebitda = ebit !== null ? ebit + dep : null;

    set('revenue', fy, revenue); set('other_income', fy, otherInc); set('total_income', fy, totalIncome);
    set('interest', fy, interest); set('depreciation', fy, dep); set('tax', fy, tax); set('pbt', fy, pbt ?? (pat !== null ? pat + tax : null));
    set('pat', fy, pat); set('total_expenses_incl_tax', fy, totalIncome !== null && pat !== null ? totalIncome - pat : null);
    set('ebit', fy, ebit); set('ebitda', fy, ebitda); set('operating_profit', fy, ebit);
    set('networth', fy, networth); set('intangibles', fy, intangibles); set('tnw', fy, networth !== null ? networth - intangibles : null);
    set('secured_debt', fy, securedDebt); set('unsecured', fy, unsecured); set('borrowings', fy, borrowings);
    set('tol', fy, totalLiab !== null && networth !== null ? totalLiab - networth : null);
    set('total_ca', fy, tca); set('total_cl', fy, tcl);
    set('inventories', fy, z('inventories')); set('receivables', fy, z('receivables')); set('payables', fy, z('trade_payables'));
    set('cash', fy, z('cash')); set('purchases', fy, purchases); set('cogs', fy, cogs);
    set('reserves', fy, z('reserves')); set('total_assets', fy, g('total_assets'));
    set('other_ca_ops', fy, z('st_loans_adv') + z('other_ca')); set('other_cl_ops', fy, z('other_cl') + z('st_provisions'));
    set('principal', fy, inp.principalRepayment?.[fy] ?? 0);
  }

  // operating cash flow: reported if present, else indirect method
  for (let i = 0; i < fys.length; i++) {
    const fy = fys[i];
    const rep = G(it, 'ocf', fy);
    if (rep !== null && rep !== 0) { set('ocf', fy, rep); continue; }
    const prev = i ? fys[i - 1] : null;
    const isFirstYear = !prev && incFYStart !== null && fyStartYear(fy) === incFYStart;
    if (!prev && !isFirstYear) { set('ocf', fy, null); continue; }
    const p = (k: string) => (prev ? b[k][prev] ?? 0 : 0);
    const c = (k: string) => b[k][fy] ?? 0;
    const dCA = (c('inventories') - p('inventories')) + (c('receivables') - p('receivables')) + (c('other_ca_ops') - p('other_ca_ops'));
    const dCL = (c('payables') - p('payables')) + (c('other_cl_ops') - p('other_cl_ops'));
    const pat = b.pat[fy];
    set('ocf', fy, pat === null ? null : pat + c('depreciation') + c('interest') - dCA + dCL);
  }
  if (!fys.some((f) => (G(it, 'ocf', f) ?? 0) !== 0)) notes.push('Operating cash flow is derived by the indirect method (PAT + Depreciation + Interest − increase in working capital) because no cash-flow statement was provided.');

  const mk = (key: string, name: string, group: string, formula: string, dax: string, unit: Unit, fn: (fy: string) => number | null, extra: Partial<Metric> = {}): Metric => {
    const values: FYMap = {};
    for (const fy of fys) { const v = fn(fy); values[fy] = v !== null && Number.isFinite(v) ? v : null; }
    return { key, name, group, formula, dax, unit, values, ...trendOf(values, fys), ...extra };
  };
  const v = (k: string) => (fy: string) => b[k]?.[fy] ?? null;

  const performance: Metric[] = [
    mk('revenue', 'Revenue / Turnover', 'Performance', 'Revenue from operations', 'Revenue = SUM(Financials[Revenue from Operations])', 'inr', v('revenue'), { better: 'high' }),
    mk('total_income', 'Total Income', 'Performance', 'Revenue + Other income', 'Total Income = [Revenue] + [Other Income]', 'inr', v('total_income'), { better: 'high' }),
    mk('ebitda', 'EBITDA', 'Performance', 'PAT + Interest + Tax + Depreciation & Amortisation', 'EBITDA = [PAT] + [Interest] + [Tax] + [Depreciation]', 'inr', v('ebitda'), { better: 'high' }),
    mk('ebitda_margin', 'EBITDA Margin', 'Performance', 'EBITDA ÷ Revenue', 'EBITDA Margin = DIVIDE([EBITDA], [Revenue])', 'pct', (fy) => div(b.ebitda[fy], b.revenue[fy]), { better: 'high' }),
    mk('ebit', 'EBIT', 'Performance', 'PAT + Interest + Tax', 'EBIT = [PAT] + [Interest] + [Tax]', 'inr', v('ebit'), { better: 'high' }),
    mk('operating_profit', 'Operating Profit', 'Performance', 'Net Profit + Interest + Tax', 'Operating Profit = [Net Profit] + [Interest] + [Tax]', 'inr', v('operating_profit'), { better: 'high' }),
    mk('pbt', 'Profit Before Tax (PBT)', 'Performance', 'As reported', 'PBT = SUM(Financials[Profit Before Tax])', 'inr', v('pbt'), { better: 'high' }),
    mk('pat', 'Net Profit / PAT', 'Performance', 'Total Income − Total Expenses (incl. tax)', 'Net Profit = [Total Income] - [Total Expenses incl Tax]', 'inr', v('pat'), { better: 'high' }),
    mk('pat_margin', 'PAT Margin', 'Performance', 'PAT ÷ Revenue', 'PAT Margin = DIVIDE([PAT], [Revenue])', 'pct', (fy) => div(b.pat[fy], b.revenue[fy]), { better: 'high' }),
    mk('ocf', 'Operating Cash Flow', 'Performance', 'Reported, else PAT + Dep + Interest − ΔWorking capital', 'OCF = [PAT] + [Depreciation] + [Interest] - [Change in Working Capital]', 'inr', v('ocf'), { better: 'high' }),
    mk('networth', 'Net Worth', 'Position', 'Share capital + Reserves & surplus', 'Net Worth = [Share Capital] + [Reserves]', 'inr', v('networth'), { better: 'high' }),
    mk('tnw', 'Tangible Net Worth', 'Position', 'Net worth − Intangible assets', 'TNW = [Net Worth] - [Intangible Assets]', 'inr', v('tnw'), { better: 'high' }),
    mk('total_debt', 'Total Debt', 'Position', 'Long-term + Short-term borrowings', 'Total Debt = [Long-term Borrowings] + [Short-term Borrowings]', 'inr', v('borrowings'), { better: 'low' }),
    mk('unsecured', 'Unsecured Loans', 'Position', 'Unsecured long-term + short-term borrowings', 'Unsecured Loans = [Unsecured LT] + [Unsecured ST]', 'inr', v('unsecured'), { better: 'low' }),
    mk('total_ca', 'Current Assets', 'Position', 'Total current assets', 'Current Assets = SUM(Financials[Total Current Assets])', 'inr', v('total_ca')),
    mk('total_cl', 'Current Liabilities', 'Position', 'Total current liabilities', 'Current Liabilities = SUM(Financials[Total Current Liabilities])', 'inr', v('total_cl')),
    mk('inventories', 'Inventory', 'Position', 'Inventories', 'Inventory = SUM(Financials[Inventories])', 'inr', v('inventories')),
    mk('receivables', 'Trade Receivables', 'Position', 'Trade receivables / debtors', 'Receivables = SUM(Financials[Trade Receivables])', 'inr', v('receivables')),
    mk('payables', 'Trade Payables', 'Position', 'Trade payables / creditors', 'Payables = SUM(Financials[Trade Payables])', 'inr', v('payables')),
  ];

  const dp = (fy: string) => {
    const s = b.inventories[fy] ?? 0, d = b.receivables[fy] ?? 0, c = b.payables[fy] ?? 0;
    return s * (1 - inp.stockMarginPct / 100) + d * (1 - inp.debtorMarginPct / 100) - c;
  };
  const principalKnown = fys.some((f) => (inp.principalRepayment?.[f] ?? 0) > 0);
  if (!principalKnown) notes.push('DSCR uses principal repayment = 0 (not available in the financial file). Enter yearly principal repayment in Settings for an accurate DSCR.');

  const ratios: Metric[] = [
    mk('r_ebit', '1. EBIT', 'Core', 'Net Income + Interest + Tax', 'EBIT = [Net Profit] + [Interest] + [Tax]', 'inr', v('ebit'), { better: 'high' }),
    mk('r_ebitda', '2. EBITDA', 'Core', 'Net Profit + Interest + Tax + Depreciation + Amortization', 'EBITDA = [Net Profit] + [Interest] + [Tax] + [Depreciation]', 'inr', v('ebitda'), { better: 'high' }),
    mk('r_np', '3. Net Profit', 'Core', 'Total Income – Total Expenses', 'Net Profit = [Total Income] - [Total Expenses incl Tax]', 'inr', v('pat'), { better: 'high' }),
    mk('r_op', '4. Operating Profit', 'Core', 'Net Profit + Interest + Tax', 'Operating Profit = [Net Profit] + [Interest] + [Tax]', 'inr', v('operating_profit'), { better: 'high' }),
    mk('r_pnw', '5. Promoter Net Worth', 'Core', 'As per promoter financial data (manual input)', 'Promoter Net Worth = [Input: Promoter Net Worth]', 'inr', () => inp.promoterNetWorth, { note: inp.promoterNetWorth === null ? 'Not in source files — enter in Settings' : 'Manual input' }),
    mk('r_dscr', '6. DSCR', 'Core', '(Net Profit + Depreciation + Interest) / (Principal Repayment + Interest)', 'DSCR = DIVIDE([Net Profit] + [Depreciation] + [Interest], [Principal Repayment] + [Interest])', 'x', (fy) => div((b.pat[fy] ?? 0) + (b.depreciation[fy] ?? 0) + (b.interest[fy] ?? 0), (b.principal[fy] ?? 0) + (b.interest[fy] ?? 0)), { better: 'high', benchmark: '≥ 1.25x', note: principalKnown ? undefined : 'Principal repayment not provided' }),
    mk('r_cr', '7. Current Ratio', 'Liquidity', 'Current Assets / Current Liabilities', 'Current Ratio = DIVIDE([Current Assets], [Current Liabilities])', 'x', (fy) => div(b.total_ca[fy], b.total_cl[fy]), { better: 'high', benchmark: '≥ 1.33x' }),
    mk('r_qr', '8. Quick Ratio', 'Liquidity', '(Current Assets – Inventory) / Current Liabilities', 'Quick Ratio = DIVIDE([Current Assets] - [Inventory], [Current Liabilities])', 'x', (fy) => div((b.total_ca[fy] ?? 0) - (b.inventories[fy] ?? 0), b.total_cl[fy]), { better: 'high', benchmark: '≥ 1.0x' }),
    mk('r_de', '9. Debt–Equity Ratio', 'Leverage', 'Total Debt / Net Worth (secured & bank debt)', 'Debt Equity = DIVIDE([Secured Debt], [Net Worth])', 'x', (fy) => div(b.secured_debt[fy], b.networth[fy]), { better: 'low', benchmark: '≤ 2.0x' }),
    mk('r_ade', '10. Adjusted Debt–Equity Ratio', 'Leverage', '(Total Debt + Unsecured Loans) / Net Worth', 'Adj Debt Equity = DIVIDE([Secured Debt] + [Unsecured Loans], [Net Worth])', 'x', (fy) => div((b.secured_debt[fy] ?? 0) + (b.unsecured[fy] ?? 0), b.networth[fy]), { better: 'low', benchmark: '≤ 3.0x' }),
    mk('r_icr', '11. Interest Coverage Ratio', 'Debt service', 'EBIT / Interest', 'ICR = DIVIDE([EBIT], [Interest])', 'x', (fy) => div(b.ebit[fy], b.interest[fy]), { better: 'high', benchmark: '≥ 2.0x' }),
    mk('r_toltnw', '12. TOL / TNW', 'Leverage', 'Total Outside Liabilities / Tangible Net Worth', 'TOL TNW = DIVIDE([Total Outside Liabilities], [Tangible Net Worth])', 'x', (fy) => div(b.tol[fy], b.tnw[fy]), { better: 'low', benchmark: '≤ 4.0x' }),
    mk('r_nps', '13. Net Profit to Sales', 'Profitability', '(Net Profit / Sales) × 100', 'Net Profit to Sales = DIVIDE([Net Profit], [Revenue]) * 100', 'pct', (fy) => div(b.pat[fy], b.revenue[fy]), { better: 'high', benchmark: '≥ 2%' }),
    mk('r_debitda', '14. Debt / EBITDA', 'Leverage', 'Total Debt / EBITDA', 'Debt to EBITDA = DIVIDE([Total Debt], [EBITDA])', 'x', (fy) => ((b.ebitda[fy] ?? 0) <= 0 ? null : div(b.borrowings[fy], b.ebitda[fy])), { better: 'low', benchmark: '≤ 3.5x' }),
    mk('r_ocfi', '15. Operating Cash Flow / Interest', 'Debt service', 'Operating Cash Flow / Interest Expense', 'OCF to Interest = DIVIDE([Operating Cash Flow], [Interest])', 'x', (fy) => div(b.ocf[fy], b.interest[fy]), { better: 'high', benchmark: '≥ 2.0x' }),
    mk('r_ree', '16. Retained Earnings / Equity', 'Profitability', "Retained Earnings / Shareholders' Equity", 'RE to Equity = DIVIDE([Reserves], [Net Worth])', 'x', (fy) => div(b.reserves[fy], b.networth[fy]), { better: 'high' }),
    mk('r_dcp', '17. Debtor Collection Period', 'Working capital', '(Debtors / Sales) × 365', 'Debtor Days = DIVIDE([Receivables], [Revenue]) * 365', 'days', (fy) => { const d = div(b.receivables[fy], b.revenue[fy]); return d === null ? null : d * 365; }, { better: 'low', benchmark: '≤ 90 days' }),
    mk('r_ccp', '18. Creditor Payment Period', 'Working capital', '(Creditors / Purchases) × 365', 'Creditor Days = DIVIDE([Payables], [Purchases]) * 365', 'days', (fy) => { const d = div(b.payables[fy], b.purchases[fy]); return d === null ? null : d * 365; }, { benchmark: '30–90 days' }),
    mk('r_sp', '19. Stock Period', 'Working capital', '(Inventory / Cost of Goods Sold) × 365', 'Stock Days = DIVIDE([Inventory], [COGS]) * 365', 'days', (fy) => { const d = div(b.inventories[fy], b.cogs[fy]); return d === null ? null : d * 365; }, { better: 'low', benchmark: '≤ 90 days' }),
    mk('r_wcr', '20. Working Capital Ratio', 'Liquidity', 'Current Assets / Current Liabilities', 'WC Ratio = DIVIDE([Current Assets], [Current Liabilities])', 'x', (fy) => div(b.total_ca[fy], b.total_cl[fy]), { better: 'high', benchmark: '≥ 1.33x' }),
    mk('r_dp', '21. Drawing Power', 'Working capital', `Eligible Stock (${100 - inp.stockMarginPct}%) + Eligible Debtors (${100 - inp.debtorMarginPct}%) – Creditors`, 'Drawing Power = [Inventory] * (1 - [Stock Margin]) + [Receivables] * (1 - [Debtor Margin]) - [Payables]', 'inr', dp, { better: 'high' }),
  ];

  const extra: Metric[] = [
    mk('op_ebitda', 'Operating EBITDA (excl. other income)', 'Performance', 'EBITDA − Other income', 'Operating EBITDA = [EBITDA] - [Other Income]', 'inr', (fy) => (b.ebitda[fy] === null ? null : (b.ebitda[fy] as number) - (b.other_income[fy] ?? 0)), { better: 'high' }),
    mk('op_icr', 'Operating Interest Coverage', 'Debt service', '(EBIT − Other income) ÷ Interest', 'Operating ICR = DIVIDE([EBIT] - [Other Income], [Interest])', 'x', (fy) => div((b.ebit[fy] ?? 0) - (b.other_income[fy] ?? 0), b.interest[fy]), { better: 'high' }),
    mk('roe', 'Return on Equity', 'Profitability', 'PAT ÷ Net worth', 'ROE = DIVIDE([PAT], [Net Worth])', 'pct', (fy) => div(b.pat[fy], b.networth[fy]), { better: 'high' }),
    mk('roce', 'Return on Capital Employed', 'Profitability', 'EBIT ÷ (Net worth + Total debt)', 'ROCE = DIVIDE([EBIT], [Net Worth] + [Total Debt])', 'pct', (fy) => div(b.ebit[fy], (b.networth[fy] ?? 0) + (b.borrowings[fy] ?? 0)), { better: 'high' }),
    mk('asset_turnover', 'Total Asset Turnover', 'Efficiency', 'Revenue ÷ Total assets', 'Asset Turnover = DIVIDE([Revenue], [Total Assets])', 'x', (fy) => div(b.revenue[fy], b.total_assets[fy]), { better: 'high' }),
    mk('tol', 'Total Outside Liabilities', 'Position', 'Total liabilities − Net worth', 'TOL = [Total Liabilities] - [Net Worth]', 'inr', v('tol'), { better: 'low' }),
    mk('nwc', 'Net Working Capital', 'Position', 'Current assets − Current liabilities', 'NWC = [Current Assets] - [Current Liabilities]', 'inr', (fy) => (b.total_ca[fy] ?? 0) - (b.total_cl[fy] ?? 0), { better: 'high' }),
    mk('interest', 'Finance Cost (Interest)', 'Performance', 'As reported', 'Interest = SUM(Financials[Finance Costs])', 'inr', v('interest'), { better: 'low' }),
    mk('depreciation', 'Depreciation & Amortisation', 'Performance', 'As reported', 'Depreciation = SUM(Financials[Depreciation])', 'inr', v('depreciation')),
    mk('tax', 'Tax Expense', 'Performance', 'Current tax + Deferred tax', 'Tax = [Current Tax] + [Deferred Tax]', 'inr', v('tax')),
    mk('cash', 'Cash & Bank', 'Position', 'As reported', 'Cash = SUM(Financials[Cash & Bank])', 'inr', v('cash')),
    mk('secured_debt', 'Secured / Bank Debt', 'Position', 'Secured LT + ST borrowings', 'Secured Debt = [Secured LT] + [Secured ST]', 'inr', v('secured_debt'), { better: 'low' }),
  ];

  const wc = fys.map((fy) => {
    const id = ratios.find((r) => r.key === 'r_sp')!.values[fy] ?? null;
    const dd = ratios.find((r) => r.key === 'r_dcp')!.values[fy] ?? null;
    const cd = ratios.find((r) => r.key === 'r_ccp')!.values[fy] ?? null;
    return { fy, inventoryDays: id, debtorDays: dd, creditorDays: cd, cycle: dd === null && id === null ? null : (id ?? 0) + (dd ?? 0) - (cd ?? 0), gap: (b.total_ca[fy] ?? 0) - ((b.total_cl[fy] ?? 0) - (G(it, 'st_borrowings', fy) ?? 0)) };
  });
  const last = fys[fys.length - 1];
  const prev = fys[fys.length - 2];
  const lw = wc.find((w) => w.fy === last);
  const pw = wc.find((w) => w.fy === prev);
  let cycle = 'Insufficient data';
  if (lw?.cycle != null && pw?.cycle != null) cycle = lw.cycle < pw.cycle - 10 ? 'Improving' : lw.cycle > pw.cycle + 10 ? 'Deteriorating' : 'Stable';
  const dd = lw?.debtorDays ?? null;
  const idays = lw?.inventoryDays ?? null;
  const cdays = lw?.creditorDays ?? null;
  // MPBF (Tandon method II) and turnover method (Nayak: 20% of turnover)
  const caLast = b.total_ca[last] ?? 0;
  const bankBorrowLast = G(it, 'st_borrowings', last) ?? 0;
  const otherCL = (b.total_cl[last] ?? 0) - bankBorrowLast;
  const mpbf = 0.75 * caLast - otherCL;
  const turnoverMethod = (b.revenue[last] ?? 0) * 0.2;
  const additionalWC = Math.max(0, Math.min(mpbf, turnoverMethod) - bankBorrowLast);

  return {
    fys, base: b, performance, ratios, extra, wc,
    wcAssessment: {
      cycle,
      receivables: dd === null ? 'N/A' : dd <= 90 ? 'Normal' : dd <= 180 ? 'Stretched' : 'Critical',
      inventory: idays === null ? 'N/A' : idays <= 60 ? 'Normal' : idays <= 120 ? 'High' : 'Very High',
      supplierDependency: cdays === null ? 'N/A' : cdays > 120 ? 'High' : cdays > 60 ? 'Moderate' : 'Low',
      additionalWC,
      mpbf,
      turnoverMethod,
    },
    notes,
  };
}
