/* Loan-file pack ingestion: a folder or zip with many documents → one Dataset.
   Every file is classified, parsed if INGOVIZ understands it, and listed in the
   documents inventory with what happened to it (used / duplicate / scanned / needs password …). */
import { unzipSync } from 'fflate';
import type { Dataset, CleaningLog, GstData, GstParty, GstFiling, BankingData, BankTxn, BankAccount, FinancialData, FYMap, DocEntry, ExtraData, ManualInputs } from '../types';
import { readWorkbook, detectKind } from '../workbook';
import { parseFinancial } from '../parseFinancial';
import { parseGst } from '../parseGst';
import { parseBanking } from '../parseBanking';
import { fyOfMonth, sortFYs, nameTokens, daysBetween } from '../utils';
import { type PdfLoader, type PdfDoc, PdfPasswordError, docText, passwordsFromPath } from './pdf';
import { looksLikeBankStatement, parseBankStatement, chainByBalance, type ParsedStatement } from './bankPdf';
import { looksLikeGstr3b, parseGstr3b, gstr3bDue, type Gstr3b } from './gstr3b';
import { looksLikeCibil, parseCibil, looksLikeNetworth, parseNetworth, looksLikeMca, parseMca, looksLikeGstCertificate, parseGstCertificate, looksLikeUdyam, parseUdyam, looksLikeLei, parseLei } from './docsMisc';
import { detectExcelFormat, parseTallyLedgers, parseMom, parseAgeing, parseLoanObligation, parseFinancialTemplate, AGE_BUCKETS, type LedgerParty, type MomParty } from './excelFormats';
import { STATE_CODES } from '../calcGst';

export interface PackFile { path: string; data: ArrayBuffer; size: number; forceKind?: 'financial' | 'gst' | 'banking' | 'unknown' }
export interface PackOptions { passwords?: string[]; onProgress?: (done: number, total: number, path: string) => void }

const baseName = (p: string) => p.split('/').pop() || p;
const ext = (p: string) => (p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '');
const SKIP = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)|(^|\/)\._/i;

/** Expand zips (nested too) into flat files with their folder path kept. */
export function expandZips(files: PackFile[]): PackFile[] {
  const out: PackFile[] = [];
  for (const f of files) {
    if (SKIP.test(f.path)) continue;
    if (ext(f.path) !== 'zip') { out.push(f); continue; }
    try {
      const entries = unzipSync(new Uint8Array(f.data));
      const inner: PackFile[] = [];
      for (const [p, u8] of Object.entries(entries)) {
        if (p.endsWith('/') || !u8.length || SKIP.test(p)) continue;
        inner.push({ path: `${f.path.replace(/\.zip$/i, '')}/${p}`, data: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer, size: u8.byteLength });
      }
      out.push(...expandZips(inner));
    } catch {
      out.push(f);
    }
  }
  return out;
}

/** Guess a readable document type from the path alone (for files INGOVIZ does not parse). */
function typeFromPath(p: string): string {
  const s = p.toLowerCase();
  const rules: [RegExp, string][] = [
    [/aadha?r/, 'KYC – Aadhaar'], [/pan\s*card|pan\b/, 'KYC – PAN'], [/photo/, 'KYC – Photo'], [/electric|electricty/, 'Utility bill'],
    [/sanction/, 'Sanction letter'], [/26\s*as/, 'Form 26AS'], [/\back\b|itr|coi|computation/, 'ITR / computation'], [/audit|3c[abd]|p&l|balance sheet|\bbs\b|provisional/, 'Financial statements'],
    [/moa|aoa/, 'MoA / AoA'], [/incorporation/, 'Certificate of incorporation'], [/shareholding/, 'Shareholding pattern'], [/udyam/, 'Udyam certificate'],
    [/lei/, 'LEI certificate'], [/tan/, 'TAN certificate'], [/rental|rent agreement|lease/, 'Rental agreement'], [/search report/, 'ROC search report'],
    [/invoice|sales.*bill/, 'Sales invoices'], [/profile/, 'Business profile'], [/ledger/, 'Ledger'],
  ];
  return rules.find(([re]) => re.test(s))?.[1] || 'Other document';
}

function emptyExtra(): ExtraData {
  return { loans: [], ageing: [], cibil: [], networth: [], gstr3b: [], profile: {}, directors: [], gstCerts: [], ledgerParties: [], ledgerPeriod: '', momSales: [], momPurchase: [], statements: [] };
}

/** Build the dataset from any mix of analysis reports, raw PDFs, Excel exports and zips. */
export async function buildDatasetFromFiles(input: PackFile[], loader: PdfLoader | null, opts: PackOptions = {}): Promise<Dataset> {
  const log: CleaningLog[] = [];
  const ds: Dataset = { financial: null, gst: null, banking: null, files: [], log, docs: [], extra: emptyExtra() };
  const extra = ds.extra!;
  const docs = ds.docs!;
  const files = expandZips(input);
  const statements: { file: string; st: ParsedStatement }[] = [];
  let finTemplate: FinancialData | null = null;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    opts.onProgress?.(i, files.length, f.path);
    const e = ext(f.path);
    const doc: DocEntry = { path: f.path, size: f.size, type: typeFromPath(f.path), status: 'not used', note: '' };
    docs.push(doc);
    try {
      if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) {
        const wb = readWorkbook(f.data, baseName(f.path));
        const fmt = f.forceKind && f.forceKind !== 'unknown' ? null : detectExcelFormat(wb);
        if (fmt) {
          doc.status = 'used';
          if (fmt === 'tally-ledger') { const r = parseTallyLedgers(wb, log); extra.ledgerParties = r.parties; extra.ledgerPeriod = r.period; doc.type = 'Tally ledger vouchers'; doc.note = `${r.parties.length} trading parties`; }
          else if (fmt === 'mom-sales') { extra.momSales = parseMom(wb, log); doc.type = 'MOM sales bills'; doc.note = `${extra.momSales.length} parties`; }
          else if (fmt === 'mom-purchase') { extra.momPurchase = parseMom(wb, log); doc.type = 'MOM purchase bills'; doc.note = `${extra.momPurchase.length} parties`; }
          else if (fmt === 'ageing-debtors' || fmt === 'ageing-creditors') { const a = parseAgeing(wb, fmt === 'ageing-debtors' ? 'receivable' : 'payable', log); extra.ageing = extra.ageing.filter((x) => x.side !== a.side).concat(a); doc.type = fmt === 'ageing-debtors' ? 'Debtors ageing' : 'Creditors ageing'; doc.note = `${a.invoices} invoices`; }
          else if (fmt === 'loan-obligation') { extra.loans = parseLoanObligation(wb, log); doc.type = 'Loan obligation sheet'; doc.note = `${extra.loans.length} facilities`; }
          else if (fmt === 'financial-template') { finTemplate = parseFinancialTemplate(wb, log); doc.type = 'Financial input template'; doc.note = finTemplate ? finTemplate.fys.join(', ') : 'no values'; if (!finTemplate) doc.status = 'error'; }
          else { doc.status = 'skipped'; doc.type = 'Blank template'; doc.note = 'Form not filled'; }
        } else {
          const kind = f.forceKind && f.forceKind !== 'unknown' ? f.forceKind : detectKind(wb);
          log.push({ source: baseName(f.path), level: 'info', message: `Detected as ${kind.toUpperCase()} report (${wb.sheetOrder.length} sheets).` });
          if (kind === 'financial') { ds.financial = parseFinancial(wb, log); doc.type = 'Financial analysis report'; doc.status = 'used'; }
          else if (kind === 'gst') { ds.gst = parseGst(wb, log); doc.type = 'GST analysis report'; doc.status = 'used'; }
          else if (kind === 'banking') { ds.banking = parseBanking(wb, log); doc.type = 'Banking analysis report'; doc.status = 'used'; }
          else { doc.status = 'skipped'; doc.note = 'Layout not recognised'; log.push({ source: baseName(f.path), level: 'warn', message: 'Could not recognise this workbook.' }); }
          ds.files.push({ name: baseName(f.path), kind, size: f.size, loadedAt: new Date().toISOString() });
        }
      } else if (e === 'pdf') {
        if (!loader) { doc.status = 'skipped'; doc.note = 'PDF reader not available'; continue; }
        const pwds = [undefined, ...passwordsFromPath(f.path), ...(opts.passwords || [])];
        let pdf: PdfDoc | null = null;
        let needPwd = false;
        for (const pw of pwds) {
          try { pdf = await loader(f.data, { password: pw, maxPages: 400 }); needPwd = false; break; }
          catch (err) { if (err instanceof PdfPasswordError || (err as Error).name === 'PdfPasswordError') needPwd = true; else throw err; }
        }
        if (!pdf) { doc.status = needPwd ? 'needs password' : 'error'; doc.note = needPwd ? 'Enter the PDF password under Get data → Passwords' : 'Could not open'; continue; }
        const text = docText(pdf, 3);
        if (text.replace(/\s/g, '').length < 80) { doc.status = 'scanned'; doc.note = 'Scanned image – no text layer. Enter key figures manually (Data view) or use the financial input template.'; if (doc.type === 'Other document') doc.type = 'Scanned document'; continue; }
        if (looksLikeGstr3b(text)) {
          const r = parseGstr3b(pdf);
          if (r) {
            r.file = baseName(f.path);
            const dup = extra.gstr3b.findIndex((x) => x.gstin === r.gstin && x.period === r.period);
            if (dup >= 0) { doc.status = 'duplicate'; doc.note = `Same return as another file (${r.period})`; if (r.filedOn > extra.gstr3b[dup].filedOn) extra.gstr3b[dup] = r; }
            else { extra.gstr3b.push(r); doc.status = 'used'; doc.note = `${r.gstin} · ${r.period}`; }
            doc.type = 'GSTR-3B return';
          }
        } else if (looksLikeCibil(text)) {
          const full = docText(pdf, 40);
          const c = parseCibil(full, baseName(f.path));
          extra.cibil.push(c); doc.type = c.kind === 'commercial' ? 'CIBIL commercial (CMR)' : 'CIBIL consumer report'; doc.status = 'used';
          doc.note = c.kind === 'commercial' ? `CMR-${c.cmr ?? '?'}` : `Score ${c.score ?? '?'}`;
        } else if (looksLikeNetworth(text)) {
          const n = parseNetworth(docText(pdf, 10)); extra.networth.push(n); doc.type = 'Net-worth certificate'; doc.status = 'used'; doc.note = n.name;
        } else if (looksLikeMca(text)) {
          const m = parseMca(docText(pdf, 10)); Object.assign(extra.profile, m.profile); if (m.directors.length) extra.directors = m.directors; doc.type = 'MCA master data'; doc.status = 'used'; doc.note = `${m.directors.length} directors`;
        } else if (looksLikeGstCertificate(text)) {
          const g = parseGstCertificate(text); g.state ||= STATE_CODES[g.gstin.slice(0, 2)] || ''; if (g.constitution) extra.profile['Constitution (GST)'] ||= g.constitution; if (g.tradeName) extra.profile['Trade Name'] ||= g.tradeName; if (g.address) extra.profile[`Place of business – ${g.state || g.gstin.slice(0, 2)}`] = g.address; if (g.gstin && !extra.gstCerts.some((x) => x.gstin === g.gstin)) extra.gstCerts.push(g); doc.type = 'GST registration certificate'; doc.status = 'used'; doc.note = g.gstin;
        } else if (looksLikeUdyam(text)) {
          const u = parseUdyam(text); for (const [k, v] of Object.entries(u)) extra.profile[k] ||= v; doc.type = 'Udyam (MSME) certificate'; doc.status = 'used'; doc.note = u['MSME Category'] || u['Udyam Registration'] || '';
        } else if (looksLikeLei(text)) {
          const l = parseLei(text); Object.assign(extra.profile, l); doc.type = 'LEI certificate'; doc.status = 'used'; doc.note = l.LEI || '';
        } else if (looksLikeBankStatement(text) || /statement/i.test(f.path) || /bank/i.test(f.path)) {
          const st = parseBankStatement(pdf, baseName(f.path));
          if (st.txns.length) { statements.push({ file: f.path, st }); doc.type = 'Bank statement'; doc.status = 'used'; doc.note = `${st.account.bank} ${st.account.account.slice(-4)} · ${st.txns.length} txns${st.balanceMismatches ? ` · ${st.balanceMismatches} balance breaks` : ''}`; }
          else { doc.note = 'No transaction table found'; }
        } else {
          doc.status = 'not used'; doc.note = 'Kept for reference (no figures INGOVIZ uses)';
        }
      } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'webp'].includes(e)) {
        doc.status = 'not used'; doc.note = 'Image (KYC / photo) – listed only';
      } else {
        doc.status = 'not used'; doc.note = `.${e || '?'} file – listed only`;
      }
    } catch (err) {
      doc.status = 'error'; doc.note = (err as Error).message.slice(0, 120);
      log.push({ source: baseName(f.path), level: 'warn', message: `Failed to read: ${(err as Error).message}` });
    }
  }
  opts.onProgress?.(files.length, files.length, '');

  if (!ds.financial && finTemplate) ds.financial = finTemplate;
  const company = ds.financial?.company || extra.profile['Name'] || extra.gstr3b[0]?.legalName || (extra.cibil.find((c) => c.kind === 'commercial')?.name ?? '') || '';
  if (ds.financial) {
    if (!ds.financial.company && company) ds.financial.company = company;
    if (!Object.keys(ds.financial.profile).length) ds.financial.profile = { ...extra.profile };
    if (!ds.financial.directors.length && extra.directors.length) ds.financial.directors = extra.directors.map((d) => ({ name: d.name, designation: d.designation, ceased: '' }));
  }

  // bank statements → one BankingData (overlapping statements deduplicated per account)
  if (!ds.banking && statements.length) ds.banking = mergeStatements(statements, company, extra, log);
  extra.statements = statements.map(({ file, st }) => ({ file, account: st.account.account, bank: st.account.bank, from: st.txns[0]?.date || '', to: st.txns[st.txns.length - 1]?.date || '', txns: st.txns.length, mismatches: st.balanceMismatches }));

  // GSTR-3B returns (+ Tally / MOM party data) → GstData
  if (!ds.gst && extra.gstr3b.length) ds.gst = gstFromReturns(extra, company, log);
  else if (ds.gst && !ds.gst.customers.length && (extra.ledgerParties.length || extra.momSales.length)) addParties(ds.gst, extra, ds.gst.taxRateEstimate ?? 0.05);

  for (const d of docs) if (d.status === 'used') ds.files.some((x) => x.name === baseName(d.path)) || ds.files.push({ name: baseName(d.path), kind: /bank/i.test(d.type) ? 'banking' : /gst/i.test(d.type) ? 'gst' : /financial/i.test(d.type) ? 'financial' : 'unknown', size: d.size, loadedAt: new Date().toISOString() });
  const by = (s: string) => docs.filter((d) => d.status === s).length;
  log.unshift({ source: 'Loan file', level: 'info', message: `${docs.length} files: ${by('used')} used, ${by('duplicate')} duplicates, ${by('scanned')} scanned (no text), ${by('needs password')} need a password, ${by('not used')} listed only, ${by('error')} errors.` });
  return ds;
}

function mergeStatements(statements: { file: string; st: ParsedStatement }[], company: string, extra: ExtraData, log: CleaningLog[]): BankingData {
  const byAcc = new Map<string, { account: BankAccount; txns: Omit<BankTxn, 'id'>[] }>();
  for (const { st } of statements) {
    // statements of one account may show the full number or only the last 4 digits
    const key = [...byAcc.keys()].find((k) => k.slice(-4) === st.account.account.slice(-4) && (byAcc.get(k)!.account.bank === st.account.bank || !st.account.bank)) || st.account.account;
    const cur = byAcc.get(key) || { account: { ...st.account, account: key }, txns: [] };
    if (st.account.account.length > cur.account.account.length) cur.account.account = st.account.account;
    cur.txns.push(...st.txns.map((t) => ({ ...t, account: key })));
    byAcc.set(key, cur);
  }
  const txns: BankTxn[] = [];
  const accounts: BankAccount[] = [];
  for (const [, v] of byAcc) {
    const seen = new Set<string>();
    let dups = 0;
    const uniq = v.txns.filter((t) => {
      const k = `${t.date}|${t.debit.toFixed(2)}|${t.credit.toFixed(2)}|${t.balance === null ? t.description.slice(0, 30) : t.balance.toFixed(2)}`;
      if (seen.has(k)) { dups++; return false; }
      seen.add(k); return true;
    });
    const sorted = uniq.map((t, i) => ({ t, i })).sort((a, b) => a.t.date.localeCompare(b.t.date) || a.i - b.i).map((x) => x.t);
    const chained = chainByBalance(sorted);
    const acc = v.account.account;
    for (const t of chained) txns.push({ ...t, account: acc, id: txns.length + 1 });
    const from = chained[0]?.date || '', to = chained[chained.length - 1]?.date || '';
    accounts.push({ ...v.account, account: acc, period: `${from} to ${to}` });
    log.push({ source: `${v.account.bank} ${acc}`, level: dups ? 'info' : 'info', message: `Bank statements merged: ${chained.length} transactions ${from} → ${to}${dups ? `, ${dups} overlapping duplicates removed` : ''}.` });
    // gaps between statements
    for (let i = 1; i < chained.length; i++) if (daysBetween(chained[i - 1].date, chained[i].date) > 20) log.push({ source: `${v.account.bank} ${acc}`, level: 'warn', message: `No transactions between ${chained[i - 1].date} and ${chained[i].date} – a statement may be missing.` });
  }
  const months = [...new Set(txns.map((t) => t.month))].sort();
  const relatedParties = [
    ...extra.directors.map((d) => ({ name: d.name, relationship: 'Director' })),
    ...extra.cibil.filter((c) => c.kind === 'consumer' && c.name).map((c) => ({ name: c.name, relationship: 'Promoter (CIBIL)' })),
    ...extra.networth.filter((n) => n.name).map((n) => ({ name: n.name, relationship: 'Promoter (net-worth certificate)' })),
  ].filter((r) => nameTokens(r.name).length >= 2);
  return { company, accounts, txns, months, summary: { Source: 'Bank statement PDFs (parsed by INGOVIZ)' }, flags: [], relatedParties };
}

function gstFromReturns(extra: ExtraData, company: string, log: CleaningLog[]): GstData {
  const rs = [...extra.gstr3b].sort((a, b) => a.period.localeCompare(b.period));
  const revenueMonthly: Record<string, number> = {};
  const exportM: Record<string, number> = {};
  const byState = new Map<string, Record<string, number>>();
  let tax = 0, taxable = 0;
  const filings: GstFiling[] = [];
  for (const r of rs) {
    const sales = r.taxable + r.zeroRated + r.nilExempt + r.nonGst;
    revenueMonthly[r.period] = (revenueMonthly[r.period] || 0) + sales;
    exportM[r.period] = (exportM[r.period] || 0) + r.zeroRated;
    const st = STATE_CODES[r.gstin.slice(0, 2)] || r.gstin.slice(0, 2);
    const sm = byState.get(st) || {}; sm[fyOfMonth(r.period)] = (sm[fyOfMonth(r.period)] || 0) + sales; byState.set(st, sm);
    tax += r.outputTax; taxable += r.taxable + r.zeroRated;
    const due = gstr3bDue(r.period);
    filings.push({ gstin: r.gstin, state: st, returnType: 'GSTR3B', fy: fyOfMonth(r.period), period: r.period, due, filed: r.filedOn, delayDays: r.filedOn ? Math.max(0, daysBetween(due, r.filedOn)) : 0 });
  }
  const rate = taxable ? tax / taxable : null;
  const months = Object.keys(revenueMonthly).sort();
  const fys = sortFYs(new Set(months.map(fyOfMonth)));
  const fyMap = (m: Record<string, number>) => { const o: FYMap = {}; for (const [k, v] of Object.entries(m)) o[fyOfMonth(k)] = (o[fyOfMonth(k)] || 0) + v; return o; };
  const g: GstData = {
    company: company + ' (GSTR-3B)', gstins: [...new Set(rs.map((r) => r.gstin))], fys, months, revenueMonthly, purchaseMonthly: {}, revenueFY: fyMap(revenueMonthly), purchaseFY: {},
    customers: [], suppliers: [], statesRevenue: [...byState].map(([state, byFY]) => ({ state, code: Object.entries(STATE_CODES).find(([, v]) => v === state)?.[0] || '', byFY })),
    statesPurchase: [], exportFY: fyMap(exportM), domesticFY: {}, intraGroupFY: {}, gstr1vs3b: [], filings, taxRateEstimate: rate, hsn: [],
  };
  for (const f of fys) g.domesticFY[f] = (g.revenueFY[f] ?? 0) - (g.exportFY[f] ?? 0);
  addParties(g, extra, rate ?? 0.05);
  // purchases: Tally purchase vouchers (net of GST) when available, else ITC ÷ effective rate (estimate)
  if (!Object.keys(g.purchaseMonthly).length && rate) {
    for (const r of rs) if (r.itc) g.purchaseMonthly[r.period] = (g.purchaseMonthly[r.period] || 0) + r.itc / rate;
    log.push({ source: 'GSTR-3B', level: 'warn', message: `Purchases estimated as ITC ÷ effective GST rate (${(rate * 100).toFixed(2)}%) – upload a Tally ledger export for actual purchases.` });
  }
  g.purchaseFY = fyMap(g.purchaseMonthly);
  const missing = gstMissingMonths(rs);
  log.push({ source: 'GSTR-3B', level: 'info', message: `${rs.length} GSTR-3B returns for ${g.gstins.length} GSTIN(s), ${months[0]} → ${months[months.length - 1]}. Sales = taxable + zero-rated + nil/exempt + non-GST supplies.` });
  for (const m of missing) log.push({ source: 'GSTR-3B', level: 'warn', message: `GSTR-3B not in the file for ${m}.` });
  return g;
}

function gstMissingMonths(rs: Gstr3b[]): string[] {
  const out: string[] = [];
  for (const gstin of new Set(rs.map((r) => r.gstin))) {
    const ps = rs.filter((r) => r.gstin === gstin).map((r) => r.period).sort();
    if (!ps.length) continue;
    let [y, m] = ps[0].split('-').map(Number);
    const last = ps[ps.length - 1];
    for (;;) {
      const p = `${y}-${String(m).padStart(2, '0')}`;
      if (p > last) break;
      if (!ps.includes(p)) out.push(`${gstin} ${p}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

/** Party-wise sales / purchases from Tally ledgers (net of GST at the effective rate), else MOM bills. */
function addParties(g: GstData, extra: ExtraData, rate: number) {
  const toParty = (name: string, monthly: Record<string, number>, divisor: number): GstParty => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(monthly)) if (v) m[k] = v / divisor;
    const byFY: FYMap = {};
    for (const [k, v] of Object.entries(m)) byFY[fyOfMonth(k)] = (byFY[fyOfMonth(k)] || 0) + v;
    return { name: name.replace(/,\s*[A-Z ]+$/, (s) => s), gstin: '', monthly: m, byFY };
  };
  const total = (p: GstParty) => Object.values(p.monthly).reduce((a, b) => a + b, 0);
  const div = 1 + rate;
  if (extra.ledgerParties.length) {
    g.customers = extra.ledgerParties.filter((p: LedgerParty) => Object.values(p.sales).some((v) => v > 0)).map((p) => toParty(p.name, p.sales, div)).filter((p) => total(p) > 0).sort((a, b) => total(b) - total(a));
    g.suppliers = extra.ledgerParties.filter((p: LedgerParty) => Object.values(p.purchases).some((v) => v > 0)).map((p) => toParty(p.name, p.purchases, div)).filter((p) => total(p) > 0).sort((a, b) => total(b) - total(a));
    if (!Object.keys(g.purchaseMonthly).length) for (const s of g.suppliers) for (const [k, v] of Object.entries(s.monthly)) g.purchaseMonthly[k] = (g.purchaseMonthly[k] || 0) + v;
  } else {
    g.customers = extra.momSales.map((p: MomParty) => toParty(p.name, p.monthly, 1)).sort((a, b) => total(b) - total(a));
    g.suppliers = extra.momPurchase.map((p: MomParty) => toParty(p.name, p.monthly, 1)).sort((a, b) => total(b) - total(a));
  }
}

/** Inputs INGOVIZ can fill itself from the documents (user-typed values always win). */
export function autoInputs(ds: Dataset): Partial<ManualInputs> {
  const x = ds.extra;
  if (!x) return {};
  const out: Partial<ManualInputs> = {};
  const consumer = x.cibil.filter((c) => c.kind === 'consumer');
  const scores = consumer.map((c) => c.score).filter((s): s is number => s !== null);
  if (scores.length) out.cibilScore = Math.min(...scores);
  const cmr = x.cibil.find((c) => c.kind === 'commercial');
  if (cmr && cmr.cmr !== null) out.cmrRank = cmr.cmr;
  const nw = x.networth.map((n) => n.total).filter((v): v is number => v !== null);
  if (nw.length) out.promoterNetWorth = nw.reduce((a, b) => a + b, 0);
  if (consumer.some((c) => c.delinquencyFlag)) out.dpdObserved = true;
  const notes: string[] = [];
  for (const c of x.cibil) notes.push(c.kind === 'commercial' ? `${c.name}: CMR-${c.cmr ?? '?'}, ${c.facilities ?? '?'} facilities, outstanding ₹${(c.outstanding ?? 0).toLocaleString('en-IN')}, overdue ₹${(c.overdue ?? 0).toLocaleString('en-IN')}` : `${c.name}: score ${c.score ?? '?'}${c.accounts !== null ? `, ${c.accounts} accounts` : ''}${c.overdue ? `, overdue ₹${c.overdue.toLocaleString('en-IN')}` : ''}${c.delinquencyFlag ? ' – bureau notes delinquency in history' : ''}`);
  if (notes.length) out.bureauNotes = notes.join('\n');
  if (x.ageing.length) {
    out.ageing = AGE_BUCKETS.map((b) => ({ bucket: b, receivable: Math.round(x.ageing.find((a) => a.side === 'receivable')?.buckets[b] ?? 0), payable: Math.round(x.ageing.find((a) => a.side === 'payable')?.buckets[b] ?? 0) }));
  }
  if (ds.gst?.taxRateEstimate && ds.gst.taxRateEstimate > 0.001 && ds.gst.taxRateEstimate < 0.3) out.gstGrossUpPct = Math.round(ds.gst.taxRateEstimate * 1000) / 10;
  const od = x.loans.find((l) => /od|cc|cash credit|overdraft/i.test(l.facility));
  if (od?.sanction) out.sanctionLimit = od.sanction;
  return out;
}

/** user value wins when it differs from the default; otherwise the auto value is used */
export function mergeInputs(user: ManualInputs, auto: Partial<ManualInputs>, defaults: ManualInputs): ManualInputs {
  const out = { ...user } as ManualInputs;
  for (const [k, v] of Object.entries(auto) as [keyof ManualInputs, unknown][]) {
    if (JSON.stringify(user[k]) === JSON.stringify(defaults[k])) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Leave unticked data sources out of the analysis (Filters pane → Data sources). */
export function selectSources(ds: Dataset, excluded: string[]): Dataset {
  if (!excluded.length) return ds;
  const off = (k: string) => excluded.includes(k);
  const x = ds.extra;
  return {
    ...ds,
    financial: off('financial') ? null : ds.financial,
    gst: off('gst') ? null : ds.gst,
    banking: off('banking') ? null : ds.banking,
    extra: x && {
      ...x,
      cibil: off('bureau') ? [] : x.cibil,
      ledgerParties: off('ledgers') ? [] : x.ledgerParties, ageing: off('ledgers') ? [] : x.ageing, momSales: off('ledgers') ? [] : x.momSales, momPurchase: off('ledgers') ? [] : x.momPurchase,
      loans: off('loans') ? [] : x.loans, networth: off('loans') ? [] : x.networth,
      gstr3b: off('gst') ? [] : x.gstr3b, statements: off('banking') ? [] : x.statements,
    },
  };
}
