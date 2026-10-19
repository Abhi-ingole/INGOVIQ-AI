/* Evidence register: every uploaded file that supplied figures gets an ID (E1, E2 …) so a
   number on any page, in the SWOT, the assistant or the PDF can be traced back to its source. */
import type { Dataset, DocEntry } from './types';

export interface EvidenceItem { id: string; file: string; type: string; used: string }
export interface Evidence {
  items: EvidenceItem[];
  docs: DocEntry[];
  ref: (re: RegExp, fallback?: string) => string;
  fin: string; gst: string; gstSales: string; gstParties: string; bank: string; bureau: string; ageing: string; loans: string; profile: string;
}

export function buildEvidence(ds: Dataset): Evidence {
  const docs: DocEntry[] = ds.docs?.length ? ds.docs : ds.files.map((f) => ({
    path: f.name, size: f.size, note: '', status: f.kind === 'unknown' ? 'not used' : 'used',
    type: f.kind === 'financial' ? 'Financial analysis report' : f.kind === 'gst' ? 'GST analysis report' : f.kind === 'banking' ? 'Banking analysis report' : 'Other document',
  }));
  const items = docs.filter((d) => d.status === 'used').map((d, i) => ({ id: `E${i + 1}`, file: d.path, type: d.type, used: d.note }));
  const ref = (re: RegExp, fallback = 'calculated') => {
    const ids = items.filter((e) => re.test(e.type)).map((e) => e.id);
    if (!ids.length) return fallback;
    // compress consecutive runs only: E4–E34, E56, E57
    const nums = ids.map((x) => +x.slice(1));
    const parts: string[] = [];
    for (let i = 0; i < nums.length;) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(j - i >= 2 ? `E${nums[i]}–E${nums[j]}` : nums.slice(i, j + 1).map((n) => `E${n}`).join(', '));
      i = j + 1;
    }
    return parts.join(', ');
  };
  return {
    items, docs, ref,
    fin: ref(/financial|template/i, 'Data view (typed)'),
    gst: ref(/gst|gstr|tally/i),
    gstSales: ref(/gstr-3b|gst analysis/i, ref(/gst|gstr/i)),
    gstParties: ref(/tally|mom|gst analysis/i, ref(/gst|gstr/i)),
    bank: ref(/bank/i),
    bureau: ref(/cibil|net-worth/i, 'Settings / manual input'),
    ageing: ref(/ageing/i, 'Ageing & Bureau page (typed)'),
    loans: ref(/loan obligation/i, ref(/cibil commercial/i, 'not provided')),
    profile: ref(/mca|udyam|lei|gst registration|financial analysis/i, 'not provided'),
  };
}
