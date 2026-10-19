/* Small document parsers: CIBIL (commercial & consumer), CA net-worth certificate, MCA master data,
   GST registration certificate. Each returns facts plus the text evidence it used. */
import { num, parseDate } from '../utils';

export interface CibilCommercial { kind: 'commercial'; name: string; cmr: number | null; reportDate: string; facilities: number | null; outstanding: number | null; overdue: number | null }
export interface CibilConsumer { kind: 'consumer'; name: string; score: number | null; reportDate: string; accounts: number | null; sanctioned: number | null; current: number | null; overdue: number | null; zeroBalance: number | null; dpdMax: number; delinquencyFlag: boolean }

export function looksLikeCibil(t: string) { return /CIBIL|TRANSUNION/i.test(t) && /(COMMERCIAL CREDIT INFORMATION|CONSUMER INFORMATION REPORT|CONSUMER CIR|CREDITVISION|CIBIL RANK)/i.test(t); }

export function parseCibil(text: string, fileName = ''): CibilCommercial | CibilConsumer {
  const date = parseDate(fileName.match(/(\d{2}-\d{2}-20\d{2})/)?.[1] || '') || parseDate(text.match(/REPORT ORDER DATE\s*:?\s*(\d{2}-[A-Za-z]{3}-\s*\d{4})/i)?.[1]?.replace(/\s/g, '') || '') || '';
  if (/COMMERCIAL CREDIT INFORMATION/i.test(text)) {
    const cmr = text.match(/CMR\s*-\s*(\d{1,2})/i)?.[1];
    const name = text.match(/SEARCH CRITERIA\s*:\s*([^,\n]+)/i)?.[1]?.trim() || '';
    const nd = num(text.match(/Non-Delinquent CF\s*₹?\s*([\d,]+)/i)?.[1]);
    const dl = num(text.match(/(?<!Non-)Delinquent CF\s*₹?\s*([\d,]+)/i)?.[1]);
    const out = nd !== null || dl !== null ? (nd ?? 0) + (dl ?? 0) : null;
    const ovd = dl;
    const fac = num(text.match(/Total CF.{0,3}s?\s*:\s*(\d+)/i)?.[1]);
    return { kind: 'commercial', name, cmr: cmr ? +cmr : null, reportDate: date, facilities: fac, outstanding: out, overdue: ovd };
  }
  const name = text.match(/NAME:\s*([A-Z .]+?)(?:\s{2,}|\n|DATE OF BIRTH)/)?.[1]?.trim() || text.match(/CONSUMER:\s*\n?\s*([A-Z .]+)/)?.[1]?.trim() || '';
  // scores are printed zero-padded ("00774"), often on their own line
  const score = text.slice(0, 4000).match(/\b0{1,2}([3-8]\d{2}|900)\b/)?.[1];
  const sum = text.match(/All Accounts\s+TOTAL:\s*(\d+)\s+HIGH CR\/SANC\. AMT:\s*([\d,]+)\s+CURRENT:\s*([\d,]+)/i);
  const overdue = num(text.match(/All Accounts[\s\S]{0,200}?OVERDUE:\s*([\d,]+)/i)?.[1]);
  const zero = num(text.match(/ZERO-BALANCE:\s*(\d+)/i)?.[1]);
  // DPD grids are not reliably extractable as text; use the bureau's own delinquency factors + asset-class words
  const dpdMax = /\b(SUB|DBT|LSS)\b/.test(text) ? 90 : /PRESENCE OF SEVERE DELINQUENCY/i.test(text) ? 60 : /PRESENCE OF DELINQUENCY/i.test(text) ? 30 : 0;
  return {
    kind: 'consumer', name, score: score ? +score : null, reportDate: date,
    accounts: sum ? +sum[1] : null, sanctioned: sum ? num(sum[2]) : null, current: sum ? num(sum[3]) : null, overdue, zeroBalance: zero, dpdMax,
    delinquencyFlag: /PRESENCE OF (SEVERE )?DELINQUENCY/i.test(text),
  };
}

export interface NetWorthCert { name: string; pan: string; total: number | null; date: string }
export function looksLikeNetworth(t: string) { return /net\s*worth\s*certificate|certify[\s\S]{0,300}net\s*worth/i.test(t) && /total\s*net\s*worth/i.test(t); }
export function parseNetworth(text: string): NetWorthCert {
  const total = num(text.match(/Total\s*Net\s*worth[^\d]{0,30}([\d,]+(?:\.\s?\d+)?)/i)?.[1]?.replace(/\s/g, ''));
  const name = text.match(/Full Name\s*:\s*(.+)/i)?.[1]?.replace(/^(mr|mrs|ms|smt|shri)\.?\s*/i, '').trim() || text.match(/financial condition of\s*(?:mr|mrs|ms|smt)?\.?\s*([A-Za-z .]+?)\s*(?:s\/o|d\/o|w\/o|,)/i)?.[1]?.trim() || '';
  return { name, pan: text.match(/PAN\s*:?\s*([A-Z]{5}\d{4}[A-Z])/)?.[1] || '', total, date: parseDate(text.match(/Date\s*:\s*(\d{2}[-/]\d{2}[-/]\d{4})/i)?.[1] || '') || '' };
}

export interface CompanyProfile { [k: string]: string }
export function looksLikeMca(t: string) { return /Ministry Of Corporate Affairs/i.test(t) && /Company Information|CIN/i.test(t); }
export function parseMca(text: string): { profile: CompanyProfile; directors: { name: string; designation: string; appointed: string }[] } {
  const profile: CompanyProfile = {};
  const lines = text.split('\n').map((l) => l.trim());
  const pick = (label: RegExp, key: string) => { const l = lines.find((x) => label.test(x)); if (l) { const v = l.replace(label, '').trim(); if (v) profile[key] = v; } };
  pick(/^CIN\b/, 'CIN'); pick(/^Company Name\b/i, 'Name'); pick(/^Date of Incorporation\b/i, 'Date of Incorporation');
  pick(/^Category of Company\b/i, 'Category'); pick(/^Class of Company\b/i, 'Type'); pick(/^Authori[sz]ed Capital \(Rs\)/i, 'Authorized Capital');
  pick(/^Paid up Capital \(Rs\)/i, 'Paid up Capital'); pick(/^Company Status\b/i, 'Status'); pick(/^Date of last AGM\b/i, 'Date of Last AGM');
  pick(/^Date of Balance Sheet\b/i, 'Date of Last Balance Sheet'); pick(/^ROC Name\b/i, 'ROC');
  const ra = lines.findIndex((l) => /^Registered Address$/i.test(l));
  if (ra > 0) profile['Full Address'] = `${lines[ra - 1]} ${lines[ra + 1] || ''}`.trim();
  const directors: { name: string; designation: string; appointed: string }[] = [];
  const di = lines.findIndex((l) => /Director\/Signatory Details/i.test(l));
  for (let i = Math.max(0, di); di >= 0 && i < lines.length; i++) {
    const m = lines[i].match(/^\d+\s+(\d{8})\s+([A-Za-z -]*Director|Designated Partner)\s+\w+\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (!m) continue;
    const nm = [lines[i - 1], lines[i + 1]].filter((x) => x && /^[A-Z][A-Z .]+$/.test(x)).join(' ');
    directors.push({ name: nm, designation: m[2], appointed: m[3] });
  }
  return { profile, directors };
}

export function looksLikeGstCertificate(t: string) { return /Form GST REG-06|Registration Certificate/i.test(t) && /GSTIN|Registration Number/i.test(t); }
export function parseGstCertificate(text: string): { gstin: string; state: string; legalName: string; regDate: string; constitution?: string; tradeName?: string; address?: string } {
  const gstin = text.match(/Registration Number\s*:?\s*([0-9]{2}[A-Z0-9]{13})/i)?.[1] || text.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z])\b/)?.[1] || '';
  const state = text.match(/State\s*:?\s*([A-Za-z ]+?)\s*(?:\n|PIN|Pin)/)?.[1]?.trim() || '';
  const addr = text.match(/Address of Principal Place of\s*([\s\S]*?)\n\s*5\.\s*Date of Liability/i)?.[1]?.replace(/^\s*|\bBusiness\b\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    gstin, state, legalName: text.match(/Legal Name\s*:?\s*(.+)/i)?.[1]?.trim() || '', regDate: parseDate(text.match(/Date of Liability\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || '') || '',
    constitution: text.match(/Constitution of Business\s*:?\s*(.+)/i)?.[1]?.trim(), tradeName: text.match(/Trade Name,? if any\s*:?\s*(.+)/i)?.[1]?.trim(), address: addr,
  };
}

/* Udyam (MSME) registration certificate */
export function looksLikeUdyam(t: string) { return /UDYAM REGISTRATION/i.test(t) && /UDYAM-[A-Z]{2}-\d{2}-\d+/.test(t); }
export function parseUdyam(text: string): Record<string, string> {
  const o: Record<string, string> = {};
  const num = text.match(/(UDYAM-[A-Z]{2}-\d{2}-\d+)/)?.[1]; if (num) o['Udyam Registration'] = num;
  const type = text.match(/\d\s+(20\d{2}-\d{2})\s+(Micro|Small|Medium)\b/i); if (type) o['MSME Category'] = `${type[2]} enterprise (${type[1]})`;
  const act = text.match(/MAJOR ACTIVITY\s+([A-Z ]+?)\s*\n/i)?.[1]; if (act) o['Major Activity'] = act.trim();
  const nic = text.match(/\b(\d{2}) - ([A-Za-z ,]+?)\s+(\d{4}) - ([A-Za-z ,]+?)\s+(\d{5}) - ([A-Za-z ,.]+?)\s+(Trading|Manufacturing|Services)/i);
  if (nic) {
    // the NIC description wraps over the next lines: pick the continuation words column-wise is not possible, so keep the first line of each
    o['NIC Code'] = `${nic[5]} (${nic[3]} / ${nic[1]})`;
    o['Industry (NIC)'] = `${nic[2].replace(/,$/, '')}`;
    o['Activity (NIC)'] = nic[7];
  }
  const comm = text.match(/COMMENCEMENT OF\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1]; if (comm) o['Commencement of Business'] = comm;
  const email = text.match(/Email:\s*(\S+@\S+)/i)?.[1]; if (email) o['Email'] = email;
  return o;
}
export function looksLikeLei(t: string) { return /LEI code of/i.test(t); }
export function parseLei(text: string): Record<string, string> {
  const m = text.match(/LEI code of .+? is:\s*([A-Z0-9]{20})/i);
  const v = text.match(/Valid till\s+([0-9]{1,2} [A-Za-z]{3} \d{4})/i);
  return m ? { LEI: `${m[1]}${v ? ` (valid till ${v[1]})` : ''}` } : {};
}
