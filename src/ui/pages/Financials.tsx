import { useState } from 'react';
import type { PageCtx } from '../ctx';
import { pickFYs } from '../ctx';
import { ChartCard } from '../Chart';
import { Section, Chip, Disclaimer, Arrow, NoData, Kpi } from '../common';
import { fmtUnit, fmtCr, fmtINR, fmtPct, fmtX, fmtDays } from '../../engine/format';
import { ITEM_LABELS } from '../../engine/parseFinancial';
import type { Metric } from '../../engine/calcFinancial';
import { shortFY } from '../../engine/utils';

const PL_KEYS = ['revenue_ops', 'sale_products', 'sale_services', 'other_income', 'total_income', 'materials', 'purchases', 'inventory_change', 'employee', 'other_expenses', 'finance_cost', 'depreciation', 'total_expenses', 'exceptional', 'pbt', 'current_tax', 'deferred_tax', 'pat'];
const BS_LIAB = ['share_capital', 'reserves', 'networth', 'lt_borrowings', 'secured_lt', 'unsecured_lt', 'deferred_tax_liab', 'other_ncl', 'lt_provisions', 'total_ncl', 'st_borrowings', 'secured_st', 'unsecured_st', 'trade_payables', 'other_cl', 'st_provisions', 'total_cl', 'total_liabilities'];
const BS_ASSET = ['tangible_assets', 'intangible_assets', 'cwip', 'total_fixed_assets', 'nc_investments', 'deferred_tax_asset', 'lt_loans_adv', 'other_nca', 'total_nca', 'current_investments', 'inventories', 'receivables', 'cash', 'st_loans_adv', 'other_ca', 'total_ca', 'total_assets'];
const BOLD = new Set(['total_income', 'total_expenses', 'pbt', 'pat', 'networth', 'total_ncl', 'total_cl', 'total_liabilities', 'total_nca', 'total_ca', 'total_assets', 'revenue_ops']);

function MetricTable({ metrics, fys }: { metrics: Metric[]; fys: string[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Financial Parameter</th>
            {fys.map((f) => <th key={f} className="num">{f}</th>)}
            {fys.slice(1).map((f, i) => <th key={'y' + f} className="num">YoY {shortFY(fys[i])}→{shortFY(f)}</th>)}
            <th className="num">CAGR</th>
            <th>3-Year Trend</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key}>
              <td title={`${m.formula}\n${m.dax}`}><b>{m.name}</b><div className="small muted">{m.formula}</div></td>
              {fys.map((f) => <td key={f} className="num">{fmtUnit(m.values[f], m.unit)}</td>)}
              {fys.slice(1).map((f, i) => (
                <td key={'y' + f} className="num">
                  {m.unit === 'inr' ? <Arrow v={m.yoy[f]} better={m.better || 'high'} /> : (() => {
                    const c = m.values[f], p = m.values[fys[i]];
                    if (c == null || p == null) return '—';
                    const d = c - p;
                    const good = (m.better || 'high') === 'high' ? d >= 0 : d <= 0;
                    return <span className={good ? 'up' : 'down'}>{d >= 0 ? '▲' : '▼'} {m.unit === 'pct' ? `${(Math.abs(d) * 100).toFixed(2)} pp` : m.unit === 'days' ? `${Math.abs(Math.round(d))} d` : Math.abs(d).toFixed(2)}</span>;
                  })()}
                </td>
              ))}
              <td className="num">{m.unit === 'inr' ? fmtPct(m.cagr) : '—'}</td>
              <td><Chip s={m.trend} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Financials({ a, ds, fySel, toggleFY, themeKey }: PageCtx) {
  const fin = a.fin;
  const [yearTab, setYearTab] = useState<string | null>(null);
  if (!fin || !ds.financial) return <><NoData what="Audited financial statements" /><Disclaimer /></>;
  const fys = pickFYs(fin.fys, fySel);
  const yr = yearTab && fin.fys.includes(yearTab) ? yearTab : fys[fys.length - 1];
  const P = (k: string) => fin.performance.find((m) => m.key === k)!;
  const items = ds.financial.items;
  const revY = items.revenue_ops?.[yr] || null;
  const taY = items.total_assets?.[yr] || null;
  const stmt = (keys: string[], denom: number | null, denomLabel: string) => (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Particulars</th><th className="num">{yr}</th><th className="num">% of {denomLabel}</th>{fin.fys.indexOf(yr) > 0 && <th className="num">vs {fin.fys[fin.fys.indexOf(yr) - 1]}</th>}</tr></thead>
        <tbody>
          {keys.filter((k) => items[k]).map((k) => {
            const v = items[k][yr] ?? null;
            const p = fin.fys.indexOf(yr) > 0 ? items[k][fin.fys[fin.fys.indexOf(yr) - 1]] ?? null : null;
            return (
              <tr key={k} className={BOLD.has(k) ? 'sub' : ''}>
                <td>{ITEM_LABELS[k] || k}</td>
                <td className="num">{fmtINR(v)}</td>
                <td className="num">{denom && v !== null ? fmtPct(v / denom) : '—'}</td>
                {fin.fys.indexOf(yr) > 0 && <td className="num">{p === null || v === null ? '—' : <Arrow v={p ? (v - p) / Math.abs(p) : null} />}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Section num="3" title="Each financial year — presented separately" right={
        <div style={{ display: 'flex', gap: 4 }}>{fin.fys.map((f) => <button key={f} className={`btn small ${f === yr ? 'primary' : ''}`} onClick={() => setYearTab(f)}>{f}</button>)}</div>
      } />
      <div className="grid g5">
        <Kpi label={`Revenue ${shortFY(yr)}`} value={fmtCr(P('revenue').values[yr])} delta={<Arrow v={P('revenue').yoy[yr]} />} />
        <Kpi label="EBITDA" value={fmtCr(P('ebitda').values[yr])} delta={`Margin ${fmtPct(P('ebitda_margin').values[yr])}`} />
        <Kpi label="PAT" value={fmtCr(P('pat').values[yr])} delta={`Margin ${fmtPct(P('pat_margin').values[yr])}`} />
        <Kpi label="Net Worth" value={fmtCr(P('networth').values[yr])} delta={<Arrow v={P('networth').yoy[yr]} />} />
        <Kpi label="Total Debt" value={fmtCr(P('total_debt').values[yr])} delta={<Arrow v={P('total_debt').yoy[yr]} better="low" />} />
      </div>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <div><div className="card-title" style={{ margin: '4px 0 6px' }}>Profit & Loss — {yr}</div>{stmt(PL_KEYS, revY, 'revenue')}</div>
        <div>
          <div className="card-title" style={{ margin: '4px 0 6px' }}>Equity & Liabilities — {yr}</div>{stmt(BS_LIAB, taY, 'total')}
          <div className="card-title" style={{ margin: '12px 0 6px' }}>Assets — {yr}</div>{stmt(BS_ASSET, taY, 'total')}
        </div>
      </div>

      <Section num="3" title="Three-year financial performance — comparison, growth / decline" />
      <MetricTable metrics={fin.performance} fys={fys} />

      <div className="grid g2" style={{ marginTop: 12 }}>
        <ChartCard title="Revenue & Total Income" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'inr', type: 'bar', series: [{ name: 'Revenue', data: fys.map((f) => P('revenue').values[f]) }, { name: 'Total Income', data: fys.map((f) => P('total_income').values[f]), slot: 2 }] }} />
        <ChartCard title="EBITDA, EBIT & PAT" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'inr', type: 'bar', series: ['ebitda', 'ebit', 'pat'].map((k, i) => ({ name: P(k).name, data: fys.map((f) => P(k).values[f]), slot: i })) }} />
        <ChartCard title="Margins" sub="EBITDA and PAT as % of revenue" themeKey={themeKey} spec={{ categories: fys, unit: 'pct', type: 'line', series: [{ name: 'EBITDA margin', data: fys.map((f) => P('ebitda_margin').values[f]) }, { name: 'PAT margin', data: fys.map((f) => P('pat_margin').values[f]), slot: 1 }] }} />
        <ChartCard title="Net Worth vs Total Debt" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'inr', type: 'bar', series: [{ name: 'Net Worth', data: fys.map((f) => P('networth').values[f]) }, { name: 'Total Debt', data: fys.map((f) => P('total_debt').values[f]), slot: 1 }, { name: 'Unsecured Loans', data: fys.map((f) => P('unsecured').values[f]), slot: 3 }] }} />
        <ChartCard title="Current Assets vs Current Liabilities" themeKey={themeKey} spec={{ categories: fys, unit: 'inr', type: 'bar', series: [{ name: 'Current Assets', data: fys.map((f) => P('total_ca').values[f]) }, { name: 'Current Liabilities', data: fys.map((f) => P('total_cl').values[f]), slot: 1 }] }} />
        <ChartCard title="Inventory, Receivables & Payables" themeKey={themeKey} spec={{ categories: fys, unit: 'inr', type: 'bar', series: ['inventories', 'receivables', 'payables'].map((k, i) => ({ name: P(k).name, data: fys.map((f) => P(k).values[f]), slot: i + 2 })) }} />
        <ChartCard title="Operating Cash Flow" sub={fin.notes.find((n) => /cash flow/i.test(n)) ? 'Derived by indirect method' : 'As reported'} themeKey={themeKey} spec={{ categories: fys, unit: 'inr', type: 'bar', series: [{ name: 'Operating Cash Flow', data: fys.map((f) => P('ocf').values[f]), slot: 2 }] }} />
        <ChartCard title="Revenue mix" sub={`Products vs services · ${yr}`} themeKey={themeKey} spec={{ categories: ['Sale of products', 'Sale of services', 'Other income'], unit: 'inr', type: 'donut', allowed: ['donut', 'pie', 'bar', 'table'], series: [{ name: yr, data: [items.sale_products?.[yr] ?? null, items.sale_services?.[yr] ?? null, items.other_income?.[yr] ?? null] }] }} />
      </div>

      <Section title="AI Financial Trend" />
      <div className="card"><ul className="clean">{a.risk.trendComments.map((t, i) => <li key={i}>{t}</li>)}</ul>{fin.notes.map((n, i) => <div key={i} className="note">{n}</div>)}</div>
      <Disclaimer />
    </>
  );
}

export function Ratios({ a, ds, fySel, toggleFY, themeKey }: PageCtx) {
  const fin = a.fin;
  if (!fin) return <><NoData what="Audited financial statements" /><Disclaimer /></>;
  const fys = pickFYs(fin.fys, fySel);
  const last = fys[fys.length - 1];
  const R = (k: string) => fin.ratios.find((m) => m.key === k)!;
  const statusOfRatio = (m: Metric): string => {
    const v = m.values[last];
    if (v === null || v === undefined || !m.benchmark) return '';
    const n = parseFloat(m.benchmark.replace(/[^\d.]/g, ''));
    if (m.benchmark.startsWith('≥')) return v >= n ? 'Good' : v >= n * 0.8 ? 'Moderate' : 'Weak';
    if (m.benchmark.startsWith('≤')) return v <= n ? 'Good' : v <= n * 1.5 ? 'Moderate' : 'Weak';
    return '';
  };
  const reported = (ds.financial?.rawRows || []).filter((r) => r.key?.startsWith('reported:'));
  return (
    <>
      <Section num="4" title="Core financial calculations & ratios — 21 parameters" />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>No. / Parameter</th><th>Formula / Calculation</th>{fys.map((f) => <th key={f} className="num">{shortFY(f)}</th>)}<th>Benchmark</th><th>Latest status</th><th>Trend</th></tr></thead>
          <tbody>
            {fin.ratios.map((m) => (
              <tr key={m.key}>
                <td><b>{m.name}</b>{m.note && <div className="small muted">{m.note}</div>}</td>
                <td className="wrap small"><div>{m.formula}</div><div className="code muted">{m.dax}</div></td>
                {fys.map((f) => <td key={f} className="num">{fmtUnit(m.values[f], m.unit)}</td>)}
                <td className="small">{m.benchmark || '—'}</td>
                <td>{statusOfRatio(m) ? <Chip s={statusOfRatio(m)} /> : <span className="muted">—</span>}</td>
                <td><Chip s={m.trend} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note small">Note: Promoter Net Worth has no formula in the source sheet; it is captured separately from promoter financial / net-worth information (Settings). EBITDA and EBIT follow the prescribed formulas (they include other income); operating versions are shown below for comparison.</div>

      <Section title="Additional ratios" />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Parameter</th><th>Formula</th>{fys.map((f) => <th key={f} className="num">{shortFY(f)}</th>)}<th>Trend</th></tr></thead>
          <tbody>{fin.extra.map((m) => <tr key={m.key}><td><b>{m.name}</b></td><td className="small">{m.formula}</td>{fys.map((f) => <td key={f} className="num">{fmtUnit(m.values[f], m.unit)}</td>)}<td><Chip s={m.trend} /></td></tr>)}</tbody>
        </table>
      </div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        <ChartCard title="Liquidity" sub="Current & quick ratio (benchmark 1.33x)" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'x', type: 'bar', series: [{ name: 'Current Ratio', data: fys.map((f) => R('r_cr').values[f]) }, { name: 'Quick Ratio', data: fys.map((f) => R('r_qr').values[f]), slot: 2 }] }} />
        <ChartCard title="Leverage" sub="Debt–Equity, Adjusted D/E, TOL/TNW" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'x', type: 'bar', series: [{ name: 'Debt–Equity', data: fys.map((f) => R('r_de').values[f]) }, { name: 'Adj. Debt–Equity', data: fys.map((f) => R('r_ade').values[f]), slot: 1 }, { name: 'TOL/TNW', data: fys.map((f) => R('r_toltnw').values[f]), slot: 6 }] }} />
        <ChartCard title="Debt service" sub="Interest coverage, DSCR, OCF/Interest" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'x', type: 'bar', series: [{ name: 'Interest Coverage', data: fys.map((f) => R('r_icr').values[f]) }, { name: 'DSCR', data: fys.map((f) => R('r_dscr').values[f]), slot: 2 }, { name: 'OCF / Interest', data: fys.map((f) => R('r_ocfi').values[f]), slot: 3 }] }} />
        <ChartCard title="Working-capital days" themeKey={themeKey} onCategoryClick={toggleFY} spec={{ categories: fys, unit: 'days', type: 'bar', series: [{ name: 'Debtor days', data: fys.map((f) => R('r_dcp').values[f]) }, { name: 'Creditor days', data: fys.map((f) => R('r_ccp').values[f]), slot: 1 }, { name: 'Stock days', data: fys.map((f) => R('r_sp').values[f]), slot: 2 }] }} />
      </div>

      {reported.length > 0 && (
        <>
          <Section title="Source cross-check — ratios as printed in the uploaded report" />
          <div className="note small">These are read directly from the source file for comparison. Differences arise where the source uses operating EBITDA (excluding other income) or different debt definitions; INGOVIQ follows the prescribed formulas above.</div>
          <div className="tbl-wrap" style={{ maxHeight: 360 }}>
            <table className="tbl">
              <thead><tr><th>Ratio (source)</th>{Object.keys(reported[0].values).map((f) => <th key={f} className="num">{f}</th>)}</tr></thead>
              <tbody>{reported.map((r, i) => <tr key={i}><td>{r.label}</td>{Object.values(r.values).map((v, j) => <td key={j} className="num">{v === null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <Disclaimer />
    </>
  );
}

export function WorkingCapital({ a, ds, fySel, themeKey, inp }: PageCtx) {
  const fin = a.fin;
  if (!fin) return <><NoData what="Audited financial statements" /><Disclaimer /></>;
  const fys = pickFYs(fin.fys, fySel);
  const wc = fin.wc.filter((w) => fys.includes(w.fy));
  const w = fin.wcAssessment;
  const last = fin.fys[fin.fys.length - 1];
  const dp = fin.ratios.find((r) => r.key === 'r_dp')!;
  const caL = fin.base.total_ca[last] ?? 0;
  const clL = fin.base.total_cl[last] ?? 0;
  const stb = ds.financial?.items.st_borrowings?.[last] ?? 0;
  return (
    <>
      <Section num="5" title="Working capital cycle" />
      <div className="note">Inventory Days + Debtor Days − Creditor Days = Net Working Capital Cycle</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Financial year</th><th className="num">Inventory days</th><th className="num">Debtor days</th><th className="num">Creditor days</th><th className="num">Net cycle</th><th className="num">Working-capital gap</th><th className="num">Drawing power</th></tr></thead>
          <tbody>{wc.map((r) => <tr key={r.fy}><td>{r.fy}</td><td className="num">{fmtDays(r.inventoryDays)}</td><td className="num">{fmtDays(r.debtorDays)}</td><td className="num">{fmtDays(r.creditorDays)}</td><td className="num"><b>{fmtDays(r.cycle)}</b></td><td className="num">{fmtINR(r.gap)}</td><td className="num">{fmtINR(dp.values[r.fy])}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid g2" style={{ marginTop: 12 }}>
        <ChartCard title="Operating cycle components" sub="Days of revenue / purchases / COGS" themeKey={themeKey} spec={{ categories: wc.map((r) => r.fy), unit: 'days', type: 'bar', series: [{ name: 'Inventory days', data: wc.map((r) => r.inventoryDays), slot: 2 }, { name: 'Debtor days', data: wc.map((r) => r.debtorDays) }, { name: 'Creditor days', data: wc.map((r) => r.creditorDays), slot: 1 }] }} />
        <ChartCard title="Net working-capital cycle" themeKey={themeKey} spec={{ categories: wc.map((r) => r.fy), unit: 'days', type: 'line', series: [{ name: 'Net cycle (days)', data: wc.map((r) => r.cycle) }] }} />
      </div>
      <Section title="AI Assessment" />
      <div className="snap">
        <div className="item"><div className="k">Working Capital Cycle</div><Chip s={w.cycle} /></div>
        <div className="item"><div className="k">Receivables</div><Chip s={w.receivables} /></div>
        <div className="item"><div className="k">Inventory</div><Chip s={w.inventory} /></div>
        <div className="item"><div className="k">Supplier Dependency</div><Chip s={w.supplierDependency} /></div>
        <div className="item"><div className="k">Additional WC Requirement</div><b>{fmtCr(w.additionalWC)}</b></div>
      </div>
      <Section title={`Working-capital gap & bank finance — ${last}`} />
      <div className="tbl-wrap">
        <table className="tbl">
          <tbody>
            <tr><td>Total current assets</td><td className="num">{fmtINR(caL)}</td></tr>
            <tr><td>Less: current liabilities other than bank borrowing</td><td className="num">{fmtINR(clL - stb)}</td></tr>
            <tr className="sub"><td>MPBF — Tandon method II (75% of CA − other CL)</td><td className="num">{fmtINR(w.mpbf)}</td></tr>
            <tr className="sub"><td>Turnover method (20% of {last} turnover)</td><td className="num">{fmtINR(w.turnoverMethod)}</td></tr>
            <tr><td>Existing short-term bank borrowing</td><td className="num">{fmtINR(stb)}</td></tr>
            <tr className="sub"><td>Indicative additional working-capital requirement (lower of the two methods − existing)</td><td className="num">{fmtINR(w.additionalWC)}</td></tr>
            <tr><td>Drawing power (stock margin {inp.stockMarginPct}%, debtor margin {inp.debtorMarginPct}%)</td><td className="num">{fmtINR(dp.values[last])}</td></tr>
            <tr><td>Current ratio / Quick ratio</td><td className="num">{fmtX(fin.ratios.find((r) => r.key === 'r_cr')!.values[last])} / {fmtX(fin.ratios.find((r) => r.key === 'r_qr')!.values[last])}</td></tr>
          </tbody>
        </table>
      </div>
      <Disclaimer />
    </>
  );
}
