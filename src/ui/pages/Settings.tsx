import type { PageCtx } from '../ctx';
import { Section } from '../common';
import { DEFAULT_INPUTS } from '../../engine/types';
import { fmtPct } from '../../engine/format';

const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

export function Settings({ a, ds, inp, setInp }: PageCtx) {
  const fys = a.fin?.fys || [];
  return (
    <>
      <div className="page-head"><div><h1>Settings & manual inputs</h1><div className="sub">Values that the uploaded files do not contain. Saved in this browser; every page recalculates instantly.</div></div>
        <button className="btn" onClick={() => { if (confirm('Reset all manual inputs, overrides and classifications?')) setInp({ ...DEFAULT_INPUTS }); }}>Reset inputs</button></div>

      <Section title="Proposal" />
      <div className="form">
        <label>Funding requirement (₹)<input value={inp.fundingRequirement ?? ''} onChange={(e) => setInp({ fundingRequirement: n(e.target.value) })} placeholder="e.g. 50000000" /></label>
        <label>Purpose of funding<input value={inp.purpose} onChange={(e) => setInp({ purpose: e.target.value })} placeholder="e.g. Working capital enhancement" /></label>
        <label>Proposed product<input value={inp.proposedProduct} onChange={(e) => setInp({ proposedProduct: e.target.value })} placeholder="e.g. CC / OD" /></label>
        <label>Promoter net worth (₹)<input value={inp.promoterNetWorth ?? ''} onChange={(e) => setInp({ promoterNetWorth: n(e.target.value) })} /></label>
      </div>

      <Section title="Debt service (for DSCR)" />
      <div className="form">
        {fys.map((f) => <label key={f}>Principal repaid in {f} (₹)<input value={inp.principalRepayment[f] ?? ''} onChange={(e) => setInp({ principalRepayment: { ...inp.principalRepayment, [f]: n(e.target.value) ?? 0 } })} placeholder="0" /></label>)}
        {!fys.length && <div className="muted small">Load financials first.</div>}
      </div>

      <Section title="Working capital & banking" />
      <div className="form">
        <label>Stock margin for drawing power (%)<input type="number" value={inp.stockMarginPct} onChange={(e) => setInp({ stockMarginPct: Number(e.target.value) || 0 })} /></label>
        <label>Debtor margin for drawing power (%)<input type="number" value={inp.debtorMarginPct} onChange={(e) => setInp({ debtorMarginPct: Number(e.target.value) || 0 })} /></label>
        <label>CC / OD sanctioned limit (₹) — leave blank to auto-detect<input value={inp.sanctionLimit ?? ''} onChange={(e) => setInp({ sanctionLimit: n(e.target.value) })} placeholder={a.bank?.utilisation[0]?.limitSource || 'auto'} /></label>
        <label>GST rate used to gross-up sales for bank matching (%)<input type="number" value={inp.gstGrossUpPct} onChange={(e) => setInp({ gstGrossUpPct: Number(e.target.value) || 0 })} />
          {ds.gst?.taxRateEstimate && <span className="small muted">GST file implies {fmtPct(ds.gst.taxRateEstimate)} (tax ÷ taxable value)</span>}</label>
      </div>

      <Section title="Credit bureau" />
      <div className="form">
        <label>CIBIL score<input type="number" value={inp.cibilScore ?? ''} onChange={(e) => setInp({ cibilScore: n(e.target.value) })} /></label>
        <label>CMR rank (1–10)<input type="number" value={inp.cmrRank ?? ''} onChange={(e) => setInp({ cmrRank: n(e.target.value) })} /></label>
        <label>DPD / SMA / NPA observed<select value={inp.dpdObserved ? 'yes' : 'no'} onChange={(e) => setInp({ dpdObserved: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select></label>
      </div>
      <div className="note small" style={{ marginTop: 16 }}>Invoice ageing is entered on the <b>Ageing & Bureau</b> page. Party classifications are edited on the <b>Banking</b> page (section 22). Financial overrides are in <b>Data view</b>.</div>
    </>
  );
}
