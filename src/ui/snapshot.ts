/* Section 1 — Company & Credit Snapshot, from every source available (financial report, MCA, GST
   certificates, Udyam, LEI, bank statements, loan sheet, CIBIL / CMR, net-worth certificates). */
import type { Analysis } from '../engine/analyse';
import type { Dataset, ManualInputs } from '../engine/types';
import { fmtCr, fmtINR } from '../engine/format';

export function companySnapshot(a: Analysis, ds: Dataset, inp: ManualInputs) {
  const fin = a.fin, gst = a.gst, risk = a.risk;
  const lastFY = fin?.fys[fin.fys.length - 1];
  const fd = ds.financial;
  const x = ds.extra;
  const prof: Record<string, string> = { ...(x?.profile || {}), ...Object.fromEntries(Object.entries(fd?.profile || {}).filter(([, v]) => v)) };
  const incorporated = prof['Date of Incorporation'];
  const vintage = incorporated ? (() => { const m = incorporated.match(/(\d{4})/); return m ? `${new Date().getFullYear() - +m[1]} years (incorporated ${incorporated})` : incorporated; })() : '—';
  const openCharges = (fd?.charges || []).filter((c) => !c.satisfied || c.satisfied === '-');
  const wcCharges = openCharges.filter((c) => /book debts|current|stock|hypothecation/i.test(c.assets)).reduce((s, c) => s + c.amount, 0);
  const wcLoans = (x?.loans || []).filter((l) => /od|cc|cash credit|overdraft|dlod|working/i.test(l.facility));
  const val = (k: string) => (lastFY ? fin?.performance.find((m) => m.key === k)?.values[lastFY] ?? null : null);
  const gstins = (ds.gst?.gstins.length ? ds.gst.gstins : [...new Set([...(fd?.gstFilings || []).map((f) => f.gstin), ...(x?.gstCerts || []).map((g) => g.gstin)])]);
  const pan = prof['PAN'] || (gstins[0] ? `${gstins[0].slice(2, 12)} (from GSTIN)` : '—');
  const directors = (fd?.directors || []).filter((d) => !d.ceased || d.ceased === '-').map((d) => d.name);
  const dirList = directors.length ? directors : (x?.directors || []).map((d) => `${d.name} (${d.designation}, since ${d.appointed})`);
  const noFin = !fin;
  const scannedFin = (ds.docs || []).some((d) => d.status === 'scanned' && /financial|itr/i.test(d.type));
  const finMissing = noFin ? (scannedFin ? 'Audited statements are scanned — enter figures in Data view' : 'Financial statements not provided') : '—';
  const gFull = gst ? [...gst.fys].reverse().find((f) => gst.monthly.filter((m) => m.fy === f && m.revenue).length >= 12) : undefined;
  const gLast = gst?.fys[gst.fys.length - 1];
  const gMonths = (f?: string) => (f && gst ? gst.monthly.filter((m) => m.fy === f && m.revenue).length : 0);
  const turnover = !noFin
    ? `${fmtCr(val('revenue'))} (${lastFY || '—'}, audited)`
    : gst ? `${fmtCr(gst.revenueFY[gFull || gLast!])} (${gFull || gLast}, GST returns${gFull ? '' : `, ${gMonths(gLast)} months`})` : finMissing;
  const loansOut = (x?.loans || []).reduce((s, l) => s + (l.outstanding || 0), 0);
  const cmr = x?.cibil.find((c) => c.kind === 'commercial');
  const totalDebt = !noFin && val('total_debt') !== null ? fmtCr(val('total_debt')) : loansOut ? `${fmtCr(loansOut)} (loan obligation sheet)` : cmr?.outstanding ? `${fmtCr(cmr.outstanding)} (CMR report)` : finMissing;
  const banks = ds.banking ? (ds.banking.accounts.length ? ds.banking.accounts.map((ac) => `${ac.bank || 'Bank'} …${ac.account.slice(-4)} (${ac.type})`).join(', ') : `${new Set(ds.banking.txns.map((t) => t.account)).size} account(s)`) : '—';

  const snapshotRows: [string, string][] = [
    ['Company Name', a.company],
    ['CIN', prof['CIN'] || '—'],
    ['Constitution', [prof['Constitution (GST)'] || prof['Type'], prof['Category'], prof['Sub Category']].filter(Boolean).join(' · ') || '—'],
    ['Industry', prof['Corpository Sector'] || prof['Industry'] || prof['Industry (NIC)'] || '—'],
    ['Business Activity', prof['Product/Services'] || [prof['Major Activity'] && `Major activity (Udyam): ${prof['Major Activity']}`, prof['Activity (NIC)'] && `NIC activity: ${prof['Activity (NIC)']}`].filter(Boolean).join(' · ') || '—'],
    ['NIC Code', prof['NIC Code'] || '—'],
    ['MSME / Udyam', [prof['MSME Category'], prof['Udyam Registration']].filter(Boolean).join(' · ') || '—'],
    ['Business Vintage', vintage],
    ['Promoters / Directors', dirList.join(', ') || '—'],
    ['Registered Office', prof['Full Address'] || '—'],
    ...Object.entries(prof).filter(([k]) => k.startsWith('Place of business')).map(([k, v]) => [k, v] as [string, string]),
    ['Authorised / Paid-up Capital', [prof['Authorized Capital'] && `Authorised ₹${prof['Authorized Capital']}`, prof['Paid up Capital'] && `Paid-up ₹${prof['Paid up Capital']}`].filter(Boolean).join(' · ') || '—'],
    ['Company Status (MCA)', [prof['Status'], prof['Date of Last AGM'] && `last AGM ${prof['Date of Last AGM']}`, prof['Date of Last Balance Sheet'] && `last balance sheet ${prof['Date of Last Balance Sheet']}`].filter(Boolean).join(' · ') || '—'],
    ['PAN', pan],
    ['GSTIN', gstins.map((g) => `${g} (${(x?.gstCerts || []).find((c) => c.gstin === g)?.state || ''})`.replace(' ()', '')).join(', ') || '—'],
    ['LEI', prof['LEI'] || '—'],
    ['Bank Accounts', banks],
    ['Latest Turnover', turnover],
    ['EBITDA', noFin ? finMissing : fmtCr(val('ebitda'))],
    ['PAT', noFin ? finMissing : fmtCr(val('pat'))],
    ['Tangible Net Worth', noFin ? finMissing : fmtCr(val('tnw'))],
    ['Total Debt', totalDebt],
    ['Existing Working Capital Limits', wcCharges ? `${fmtCr(wcCharges)} (open charges on current assets)` : wcLoans.length ? wcLoans.map((l) => `${l.lender} ${l.facility} ${fmtCr(l.sanction)}`).join(', ') : '—'],
    ['Existing Loans / EMI', x?.loans.length ? `${x.loans.length} facilities · outstanding ${fmtCr(loansOut)} · EMI ${fmtINR(x.loans.reduce((s, l) => s + (l.emi || 0), 0))}/month` : '—'],
    ['Promoter Net Worth', inp.promoterNetWorth ? `${fmtCr(inp.promoterNetWorth)}${x?.networth.length ? ` (${x.networth.map((n) => `${n.name} ${fmtCr(n.total)}`).join(', ')})` : ''}` : 'Not provided'],
    ['CIBIL', x?.cibil.some((c) => c.kind === 'consumer') ? x.cibil.filter((c) => c.kind === 'consumer').map((c) => `${c.name}: ${c.kind === 'consumer' ? c.score ?? '?' : ''}`).join(' · ') : inp.cibilScore ? String(inp.cibilScore) : 'Not provided'],
    ['CMR', inp.cmrRank ? `CMR-${inp.cmrRank}${cmr ? ` · ${cmr.facilities ?? '?'} facilities, outstanding ${fmtCr(cmr.outstanding)}, overdue ${fmtINR(cmr.overdue)}` : ''}` : 'Not provided'],
    ['External Rating, if available', prof['Rating'] || '—'],
    ['Funding Requirement', inp.fundingRequirement ? fmtCr(inp.fundingRequirement) : 'Not provided'],
    ['Purpose of Funding', inp.purpose || '—'],
    ['Proposed Product', inp.proposedProduct || risk.decision.product],
  ];

  return { rows: snapshotRows, openCharges, noFin, finMissing, totalDebt, gFull, gLast, gMonths, val, lastFY };
}
