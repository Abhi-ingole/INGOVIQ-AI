import type { Workbook, FinancialData, FYMap, CleaningLog, GstFiling, Matrix } from './types';
import { str, num, fyColumns, findRow, sortFYs, parseDate, daysBetween, normMonth, fyOfMonth } from './utils';

/** Canonical line items. `sec` restricts a pattern to a balance-sheet section. */
interface ItemRule { key: string; re: RegExp; sec?: string; stmt?: 'pl' | 'bs' | 'any' }
const RULES: ItemRule[] = [
  // ---- Profit & Loss
  { key: 'gross_sales', re: /^gross sales/, stmt: 'pl' },
  { key: 'revenue_ops', re: /^(total )?revenue from operations|^net sales$|^sales( turnover)?$|^turnover$/ },
  { key: 'sale_products', re: /^revenue from sale of products/ },
  { key: 'sale_services', re: /^revenue from sale of services/ },
  { key: 'other_income', re: /^other income/ },
  { key: 'total_income', re: /^total revenue$|^total income$/ },
  { key: 'materials', re: /^cost of materials? consumed|^raw materials? consumed/ },
  { key: 'purchases', re: /^purchases? of stock|^purchases?$/ },
  { key: 'inventory_change', re: /^changes? in inventor/ },
  { key: 'employee', re: /^total employee benefit|^employee benefits? expense/ },
  { key: 'other_expenses', re: /^total other expenses/ },
  { key: 'ebitda_reported', re: /^ebitda$/ },
  { key: 'finance_cost', re: /^finance costs?$|^interest( expenses?| paid)?$|^finance charges/ },
  { key: 'depreciation', re: /^(total )?depreciation/ },
  { key: 'total_expenses', re: /^total expenses?$/ },
  { key: 'exceptional', re: /^exceptional items/ },
  { key: 'pbt', re: /^profit before tax|^pbt$/ },
  { key: 'current_tax', re: /^current tax/ },
  { key: 'deferred_tax', re: /^deferred tax$|^deferred tax (charge|credit|expense)/, stmt: 'pl' },
  { key: 'pat', re: /^profit\s*\/\s*\(?loss\)?$|^profit\s*\/\s*\(?loss\)? for the (period|year)$|^net profit( after tax)?$|^pat$|^profit after tax/ },
  // ---- Balance sheet
  { key: 'share_capital', re: /^(equity )?share capital$/ },
  { key: 'reserves', re: /^reserves/ },
  { key: 'networth', re: /^net ?worth$|^total shareholders'? funds?$|^total equity$/ },
  { key: 'lt_borrowings', re: /^long[- ]term borrowings$/ },
  { key: 'secured_lt', re: /^secured long[- ]term borrowings/ },
  { key: 'unsecured_lt', re: /^unsecured long[- ]term borrowings/ },
  { key: 'term_loans_banks', re: /^from banks$/, sec: 'ncl' },
  { key: 'rp_loans_lt', re: /^loans and advances from related parties/, sec: 'ncl' },
  { key: 'rp_loans_st', re: /^loans and advances from related parties/, sec: 'cl' },
  { key: 'deferred_tax_liab', re: /^deferred tax liabilit/ },
  { key: 'other_ncl', re: /^other non[- ]current liabilities/ },
  { key: 'lt_provisions', re: /^long[- ]term provisions/ },
  { key: 'total_ncl', re: /^total non[- ]current liabilities/ },
  { key: 'st_borrowings', re: /^short[- ]term borrowings$/ },
  { key: 'secured_st', re: /^secured short[- ]term borrowings/ },
  { key: 'unsecured_st', re: /^unsecured short[- ]term borrowings/ },
  { key: 'trade_payables', re: /^trade payables|^sundry creditors|^creditors$/ },
  { key: 'other_cl', re: /^other current liabilities/ },
  { key: 'st_provisions', re: /^short[- ]term provisions/ },
  { key: 'total_cl', re: /^total current liabilities/ },
  { key: 'total_liabilities', re: /^total equity\s*(&|and)\s*liabilities|^total liabilities$/ },
  { key: 'tangible_assets', re: /^tangible assets$/ },
  { key: 'intangible_assets', re: /^intangible assets$/ },
  { key: 'net_block', re: /^net block/ },
  { key: 'cwip', re: /^capital work in progress/ },
  { key: 'total_fixed_assets', re: /^total fixed assets?/ },
  { key: 'nc_investments', re: /^non[- ]current investments?/ },
  { key: 'deferred_tax_asset', re: /^deferred tax assets/ },
  { key: 'lt_loans_adv', re: /^long[- ]term loans/ },
  { key: 'other_nca', re: /^other non[- ]current assets/ },
  { key: 'total_nca', re: /^total non[- ]current assets/ },
  { key: 'current_investments', re: /^current investments?/ },
  { key: 'inventories', re: /^inventor(y|ies)$|^stock in trade$|^closing stock$/ },
  { key: 'receivables', re: /^trade receivables|^sundry debtors|^debtors$/ },
  { key: 'cash', re: /^cash\s*(&|and)\s*(cash|bank)/ },
  { key: 'st_loans_adv', re: /^short[- ]term loans/ },
  { key: 'other_ca', re: /^other current assets/ },
  { key: 'total_ca', re: /^total current assets/ },
  { key: 'total_assets', re: /^total assets$/ },
  // ---- disclosures
  { key: 'forex_earnings', re: /^total earnings? in foreign/ },
  { key: 'forex_expenditure', re: /^total expenditure in foreign/ },
  { key: 'ocf', re: /^net cash (flow )?(from|generated from) operating|^cash flow from operations?$|^operating cash flow$/ },
];

export const ITEM_LABELS: Record<string, string> = {
  gross_sales: 'Gross Sales', revenue_ops: 'Revenue from Operations', sale_products: 'Sale of Products', sale_services: 'Sale of Services',
  other_income: 'Other Income', total_income: 'Total Income', materials: 'Cost of Materials Consumed', purchases: 'Purchases of Stock-in-Trade',
  inventory_change: 'Change in Inventories', employee: 'Employee Benefit Expense', other_expenses: 'Other Expenses', ebitda_reported: 'EBITDA (as reported)',
  finance_cost: 'Finance Costs (Interest)', depreciation: 'Depreciation & Amortisation', total_expenses: 'Total Expenses', exceptional: 'Exceptional Items',
  pbt: 'Profit Before Tax', current_tax: 'Current Tax', deferred_tax: 'Deferred Tax', pat: 'Profit After Tax (PAT)',
  share_capital: 'Share Capital', reserves: 'Reserves & Surplus', networth: 'Net Worth', lt_borrowings: 'Long-term Borrowings',
  secured_lt: 'Secured Long-term Borrowings', unsecured_lt: 'Unsecured Long-term Borrowings', term_loans_banks: 'Term Loans from Banks',
  rp_loans_lt: 'Related-party Loans (LT)', rp_loans_st: 'Related-party Loans (ST)', deferred_tax_liab: 'Deferred Tax Liabilities',
  other_ncl: 'Other Non-current Liabilities', lt_provisions: 'Long-term Provisions', total_ncl: 'Total Non-current Liabilities',
  st_borrowings: 'Short-term Borrowings', secured_st: 'Secured Short-term Borrowings', unsecured_st: 'Unsecured Short-term Borrowings',
  trade_payables: 'Trade Payables', other_cl: 'Other Current Liabilities', st_provisions: 'Short-term Provisions', total_cl: 'Total Current Liabilities',
  total_liabilities: 'Total Equity & Liabilities', tangible_assets: 'Tangible Assets', intangible_assets: 'Intangible Assets', net_block: 'Net Block',
  cwip: 'Capital Work in Progress', total_fixed_assets: 'Total Fixed Assets', nc_investments: 'Non-current Investments', deferred_tax_asset: 'Deferred Tax Assets',
  lt_loans_adv: 'Long-term Loans & Advances', other_nca: 'Other Non-current Assets', total_nca: 'Total Non-current Assets',
  current_investments: 'Current Investments', inventories: 'Inventories', receivables: 'Trade Receivables', cash: 'Cash & Bank',
  st_loans_adv: 'Short-term Loans & Advances', other_ca: 'Other Current Assets', total_ca: 'Total Current Assets', total_assets: 'Total Assets',
  forex_earnings: 'Foreign Exchange Earnings', forex_expenditure: 'Foreign Exchange Expenditure', ocf: 'Operating Cash Flow (reported)',
};

function sectionOf(label: string, cur: string): string {
  const l = label.toLowerCase();
  if (/^shareholders'? funds?|^equity$/.test(l)) return 'eq';
  if (/^non[- ]current liabilities/.test(l)) return 'ncl';
  if (/^current liabilities/.test(l)) return 'cl';
  if (/^non[- ]current assets|^fixed assets?$/.test(l)) return 'nca';
  if (/^current assets/.test(l)) return 'ca';
  return cur;
}

function sheetStatement(mx: Matrix): 'pl' | 'bs' | 'ratio' | 'snapshot' | 'other' {
  const head = mx.slice(0, 12).map((r) => (r || []).map(str).join(' ')).join(' ').toLowerCase();
  if (/balance sheet/.test(head)) return 'bs';
  if (/profit and loss|profit & loss|statement of profit/.test(head)) return 'pl';
  if (/financial ratio|ratios?\b/.test(head)) return 'ratio';
  if (/snapshot|highlights|financials\b/.test(head)) return 'snapshot';
  return 'other';
}

export function parseFinancial(wb: Workbook, log: CleaningLog[]): FinancialData {
  const src = wb.fileName;
  const items: Record<string, FYMap> = {};
  const priority: Record<string, number> = {};
  const rawRows: FinancialData['rawRows'] = [];
  const allFY = new Set<string>();
  const rank = { bs: 3, pl: 3, other: 2, snapshot: 1, ratio: 0 } as const;
  let textNumbers = 0;

  for (const sname of wb.sheetOrder) {
    const mx = wb.sheets[sname];
    const kind = sheetStatement(mx);
    // header rows with >= 2 FY columns
    let fyCols: Map<number, string> | null = null;
    let section = '';
    for (let r = 0; r < mx.length; r++) {
      const row = mx[r] || [];
      const fc = fyColumns(row);
      if (fc.size >= 2 && !str(row[0]).match(/^(financial year|fy)$/i)) {
        fyCols = fc;
        fc.forEach((f) => allFY.add(f));
        section = '';
        continue;
      }
      if (!fyCols) continue;
      const label = str(row[0]);
      if (!label) continue;
      section = sectionOf(label, section);
      const values: FYMap = {};
      let any = false;
      fyCols.forEach((fy, c) => {
        const v = row[c];
        if (typeof v === 'string' && num(v) !== null) textNumbers++;
        const n = num(v);
        values[fy] = n;
        if (n !== null || /^[-–]$/.test(str(v))) any = true;
      });
      if (!any) continue;
      const l = label.toLowerCase().replace(/\s+/g, ' ').trim();
      let key: string | null = null;
      if (kind !== 'ratio') {
        for (const rule of RULES) {
          if (rule.sec && rule.sec !== section) continue;
          if (rule.stmt === 'pl' && kind === 'bs') continue;
          if (rule.re.test(l)) { key = rule.key; break; }
        }
      }
      rawRows.push({ sheet: sname, label, key: kind === 'ratio' ? `reported:${label}` : key, values });
      if (key) {
        const p = rank[kind];
        if (priority[key] === undefined || p > priority[key]) {
          // '-' means reported nil -> treat as 0 for statements
          const clean: FYMap = {};
          for (const [fy, v] of Object.entries(values)) clean[fy] = v ?? 0;
          items[key] = clean;
          priority[key] = p;
        }
      }
    }
  }
  if (textNumbers) log.push({ source: src, level: 'info', message: `Converted ${textNumbers} numbers stored as text (e.g. "2,75,000.00") into real numbers.` });

  const fys = sortFYs(allFY);
  log.push({ source: src, level: 'info', message: `Financial years detected: ${fys.join(', ') || 'none'}; ${Object.keys(items).length} line items mapped.` });
  for (const must of ['revenue_ops', 'pat', 'networth', 'total_ca', 'total_cl']) {
    if (!items[must]) log.push({ source: src, level: 'warn', message: `Could not find "${ITEM_LABELS[must]}" — enter it in Data view → Financial overrides.` });
  }

  return {
    company: findCompany(wb),
    fys,
    items,
    rawRows,
    profile: parseProfile(wb),
    directors: parseDirectors(wb),
    charges: parseCharges(wb),
    gstFilings: parseEstablishmentFilings(wb),
    flags: parseFlags(wb),
    associates: parseAssociates(wb),
  };
}

function findCompany(wb: Workbook): string {
  for (const s of wb.sheetOrder.slice(0, 6)) {
    for (const row of wb.sheets[s].slice(0, 6)) {
      const v = str(row?.[0]);
      if (/(private limited|pvt\.? ltd|limited|llp|enterprises?|industries)/i.test(v) && v.length < 120) return v;
    }
  }
  return wb.fileName.replace(/\.[^.]+$/, '');
}

function parseProfile(wb: Workbook): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    const r0 = findRow(mx, /^profile\b/i);
    if (r0 < 0) continue;
    for (let r = r0; r < Math.min(mx.length, r0 + 40); r++) {
      const row = mx[r] || [];
      for (const [kc, vc] of [[0, 1], [3, 4]]) {
        const k = str(row[kc]);
        const v = str(row[vc]);
        if (k && v && k.length < 40 && !/^(company details|important dates|contact details)$/i.test(k)) out[k] = v;
      }
    }
    break;
  }
  return out;
}

function headerTable(mx: Matrix, required: RegExp[]): { r: number; cols: Record<string, number> } | null {
  for (let r = 0; r < mx.length; r++) {
    const row = (mx[r] || []).map(str);
    if (required.every((re) => row.some((c) => re.test(c)))) {
      const cols: Record<string, number> = {};
      row.forEach((c, i) => { if (c) cols[c.toUpperCase()] = i; });
      return { r, cols };
    }
  }
  return null;
}

function parseDirectors(wb: Workbook) {
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    const h = headerTable(mx, [/^name$/i, /designation/i]);
    if (!h) continue;
    const ci = (re: RegExp) => Object.entries(h.cols).find(([k]) => re.test(k))?.[1] ?? -1;
    const cName = ci(/^NAME$/), cDes = ci(/DESIGNATION/), cCes = ci(/CESSATION/);
    const out = [];
    for (let r = h.r + 1; r < mx.length; r++) {
      const name = str(mx[r]?.[cName]);
      if (!name) break;
      out.push({ name: name.replace(/\(DOB.*$/i, '').trim(), designation: str(mx[r]?.[cDes]), ceased: cCes >= 0 ? str(mx[r]?.[cCes]) : '' });
    }
    if (out.length) return out;
  }
  return [];
}

function parseCharges(wb: Workbook) {
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    const h = headerTable(mx, [/charge id/i, /charge amount/i]);
    if (!h) continue;
    const ci = (re: RegExp) => Object.entries(h.cols).find(([k]) => re.test(k))?.[1] ?? -1;
    const out = [];
    for (let r = h.r + 1; r < mx.length; r++) {
      const id = str(mx[r]?.[ci(/CHARGE ID/)]);
      if (!id) break;
      out.push({
        id,
        holder: str(mx[r]?.[ci(/CHARGE HOLDER/)]),
        amount: num(mx[r]?.[ci(/CHARGE AMOUNT/)]) ?? 0,
        created: str(mx[r]?.[ci(/DATE OF CREATION/)]),
        satisfied: str(mx[r]?.[ci(/SATISFACTION/)]),
        assets: str(mx[r]?.[ci(/ASSETS UNDER CHARGE/)]),
        rate: str(mx[r]?.[ci(/RATE OF INTEREST/)]),
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** Associates / group companies (holding, subsidiary, associate, JV, common directorship) — the sheet whose
    first column is "Group Company Name" (or similar); flag tables that merely mention group companies are skipped */
function parseAssociates(wb: Workbook) {
  const NAME = /^(group company name|associate( company)? name|name of (the )?(associate|group company))$/i;
  const out: { name: string; relationship: string }[] = [];
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    for (let r = 0; r < Math.min(mx.length, 40); r++) {
      const row = (mx[r] || []).map(str);
      const first = row.findIndex((c) => c !== '');
      if (first < 0 || !NAME.test(row[first])) continue;
      const rc = row.findIndex((c) => /^relationship$/i.test(c));
      for (let k = r + 1; k < mx.length; k++) {
        const name = str(mx[k]?.[first]);
        if (!name) { if (k > r + 1) break; continue; }
        if (/^[-–\s]*$|^(go to index|index)$|has not made/i.test(name)) continue;
        if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, relationship: rc >= 0 ? str(mx[k]?.[rc]) || 'Group company' : 'Group company' });
      }
      break;
    }
  }
  return out;
}

function parseFlags(wb: Workbook) {
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    const h = headerTable(mx, [/^event type$/i, /^green$/i, /^red$/i]);
    if (!h) continue;
    const out = [];
    const g = h.cols['GREEN'], y = h.cols['YELLOW'], rd = h.cols['RED'];
    for (let r = h.r + 1; r < mx.length; r++) {
      const row = mx[r] || [];
      const ev = str(row[1]);
      if (!ev) continue;
      const colour = str(row[rd]) ? 'Red' : str(row[y]) ? 'Yellow' : str(row[g]) ? 'Green' : '';
      out.push({ category: str(row[0]), event: ev, colour });
    }
    return out;
  }
  return [];
}

/** Establishment-wise GST filing table found in company reports (all GSTINs). */
function parseEstablishmentFilings(wb: Workbook): GstFiling[] {
  for (const s of wb.sheetOrder) {
    const mx = wb.sheets[s];
    const h = headerTable(mx, [/^gstin$/i, /return type/i, /tax period/i, /due date/i, /date of filing/i]);
    if (!h) continue;
    const ci = (re: RegExp) => Object.entries(h.cols).find(([k]) => re.test(k))?.[1] ?? -1;
    const out: GstFiling[] = [];
    for (let r = h.r + 1; r < mx.length; r++) {
      const row = mx[r] || [];
      const gstin = str(row[ci(/^GSTIN$/)]);
      if (!/^\d{2}[A-Z0-9]{13}$/i.test(gstin)) continue;
      const period = normMonth(str(row[ci(/TAX PERIOD/)]).replace(/-(\d{4})$/, '-$1'));
      const due = parseDate(row[ci(/DUE DATE/)]) || '';
      const filed = parseDate(row[ci(/DATE OF FILING/)]) || '';
      if (!period) continue;
      const delayRaw = num(str(row[ci(/DELAY/)]).replace(/days?/i, ''));
      out.push({
        gstin, state: str(row[ci(/STATE/)]), returnType: str(row[ci(/RETURN TYPE/)]).toUpperCase().replace(/\s/g, ''),
        fy: fyOfMonth(period), period, due, filed,
        delayDays: delayRaw ?? (due && filed ? Math.max(0, daysBetween(due, filed)) : 0),
      });
    }
    if (out.length) return out;
  }
  return [];
}
