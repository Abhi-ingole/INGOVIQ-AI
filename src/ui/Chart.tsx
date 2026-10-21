import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, GaugeChart, RadarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, RadarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { fmtCr, fmtPct, fmtX, fmtNum, fmtINR } from '../engine/format';
import { HideCtx, HideBox, vizKey, ExportMode } from './common';

echarts.use([BarChart, LineChart, PieChart, GaugeChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, RadarComponent, CanvasRenderer]);

export type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'stacked' | 'pie' | 'donut' | 'table';
export type ValUnit = 'inr' | 'pct' | 'x' | 'days' | 'num';
export interface Series { name: string; data: (number | null)[]; slot?: number }
export interface ChartSpec { categories: string[]; series: Series[]; unit: ValUnit; type?: ChartType; allowed?: ChartType[] }

const TYPE_LABEL: Record<ChartType, string> = { bar: '▮ Column', hbar: '▬ Bar', line: '📈 Line', area: '◢ Area', stacked: '▤ Stacked', pie: '◔ Pie', donut: '◎ Donut', table: '▦ Table' };

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export function seriesColor(slot: number): string {
  return cssVar(`--s${(slot % 8) + 1}`) || '#2a78d6';
}

export function fmtVal(v: number | null | undefined, unit: ValUnit, compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'inr': return compact ? fmtCr(v) : fmtINR(v);
    case 'pct': return fmtPct(v);
    case 'x': return fmtX(v);
    case 'days': return `${Math.round(v)}d`;
    default: return fmtNum(v, Math.abs(v) < 10 && v % 1 ? 2 : 0);
  }
}

function axisFmt(unit: ValUnit) {
  return (v: number) => {
    if (unit === 'inr') {
      const a = Math.abs(v);
      return a >= 1e7 ? `${(v / 1e7).toFixed(a >= 1e9 ? 0 : 1)}Cr` : a >= 1e5 ? `${(v / 1e5).toFixed(0)}L` : fmtNum(v);
    }
    if (unit === 'pct') return `${(v * 100).toFixed(0)}%`;
    if (unit === 'x') return `${v}x`;
    return fmtNum(v);
  };
}

export function buildOption(spec: ChartSpec, type: ChartType): echarts.EChartsCoreOption {
  const text = cssVar('--text-2'), grid = cssVar('--grid'), surface = cssVar('--chart-surface');
  const multi = spec.series.length > 1;
  const baseTooltip = {
    trigger: type === 'pie' || type === 'donut' ? 'item' : 'axis',
    axisPointer: { type: type === 'line' || type === 'area' ? 'line' : 'shadow' },
    valueFormatter: (v: number) => fmtVal(v, spec.unit),
    backgroundColor: cssVar('--surface'), borderColor: cssVar('--border'), textStyle: { color: cssVar('--text'), fontSize: 12 },
  };
  if (type === 'pie' || type === 'donut') {
    const s = spec.series[0];
    const data = spec.categories.map((c, i) => ({ name: c, value: s?.data[i] ?? 0, itemStyle: { color: seriesColor(i) } })).filter((d) => (d.value ?? 0) > 0);
    // more than 7 slices -> fold to Other (never generate a 9th hue)
    let shown = data.sort((a, b) => (b.value as number) - (a.value as number));
    if (shown.length > 7) {
      const other = shown.slice(6).reduce((a, d) => a + (d.value as number), 0);
      shown = [...shown.slice(0, 6), { name: 'Other', value: other, itemStyle: { color: cssVar('--text-3') } }];
    }
    return {
      tooltip: { ...baseTooltip, formatter: (p: { name: string; value: number; percent: number }) => `${p.name}<br/><b>${fmtVal(p.value, spec.unit)}</b> (${p.percent}%)` },
      legend: { type: 'scroll', bottom: 0, textStyle: { color: text } },
      series: [{ type: 'pie', radius: type === 'donut' ? ['48%', '72%'] : '70%', center: ['50%', '45%'], data: shown, label: { color: text, formatter: '{b}: {d}%', fontSize: 11 }, itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 } }],
    };
  }
  const horizontal = type === 'hbar';
  const cat = { type: 'category', data: spec.categories, axisLabel: { color: text, fontSize: 11, hideOverlap: true }, axisLine: { lineStyle: { color: cssVar('--border-strong') } }, axisTick: { show: false } };
  const val = { type: 'value', axisLabel: { color: text, fontSize: 11, formatter: axisFmt(spec.unit) }, splitLine: { lineStyle: { color: grid } } };
  return {
    animationDuration: 250,
    grid: { left: 8, right: 16, top: multi ? 34 : 14, bottom: spec.categories.length > 14 && !horizontal ? 40 : 8, containLabel: true },
    tooltip: baseTooltip,
    legend: multi ? { top: 0, left: 0, textStyle: { color: text }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' } : undefined,
    dataZoom: spec.categories.length > 14 && !horizontal ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 4, borderColor: 'transparent' }] : undefined,
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? { ...cat, inverse: true } : val,
    series: spec.series.map((s, i) => {
      const color = seriesColor(s.slot ?? i);
      const isLine = type === 'line' || type === 'area';
      return {
        name: s.name,
        type: isLine ? 'line' : 'bar',
        data: s.data,
        stack: type === 'stacked' ? 'total' : undefined,
        smooth: false,
        symbol: spec.categories.length > 40 ? 'none' : 'circle', symbolSize: 8,
        lineStyle: { width: 2, color },
        areaStyle: type === 'area' ? { color, opacity: 0.15 } : undefined,
        itemStyle: { color, borderRadius: type === 'stacked' ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], borderColor: type === 'stacked' ? surface : undefined, borderWidth: type === 'stacked' ? 1 : 0 },
        barMaxWidth: 42, barGap: '12%',
        connectNulls: true,
        emphasis: { focus: 'series' },
      };
    }),
  };
}

export function EChart({ option, height = 280, onReady, onClick }: { option: echarts.EChartsCoreOption; height?: number; onReady?: (c: echarts.ECharts) => void; onClick?: (name: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  // charts below the fold are drawn only when scrolled near (exports draw everything at once)
  const exporting = useContext(ExportMode);
  const [visible, setVisible] = useState(exporting || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || !ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    inst.current = c;
    c.on('click', (p: { name?: string }) => { if (p?.name) clickRef.current?.(p.name); });
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { c.resize(); } catch (e) { console.warn('chart resize', e); } }); });
    ro.observe(ref.current);
    onReady?.(c);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); c.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // one bad chart must never take the whole dashboard down
    try { inst.current?.setOption(option, { notMerge: true, lazyUpdate: true }); setFailed(false); } catch (e) { console.warn('chart render failed', e); setFailed(true); try { inst.current?.clear(); } catch { /* ignore */ } }
  }, [option, visible]);
  return <div style={{ position: 'relative', width: '100%', height }}><div ref={ref} style={{ width: '100%', height }} />{failed && <div className="muted small" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>This chart could not be drawn for the current data</div>}</div>;
}

export function ChartCard({ title, sub, spec, height = 280, onCategoryClick, note, themeKey, className, id }: {
  title: string; sub?: string; spec: ChartSpec; height?: number; onCategoryClick?: (c: string) => void; note?: string; themeKey: string; className?: string; id?: string;
}) {
  const allowed = spec.allowed || (['bar', 'hbar', 'line', 'area', 'stacked', 'pie', 'donut', 'table'] as ChartType[]);
  const [type, setType] = useState<ChartType>(spec.type || 'bar');
  const [menu, setMenu] = useState(false);
  const [big, setBig] = useState(false);
  const hide = useContext(HideCtx);
  const hk = vizKey(hide.page, title);
  const isHiddenViz = hide.hidden.includes(hk);
  const chartRef = useRef<echarts.ECharts | null>(null);
  useEffect(() => { setType(spec.type || 'bar'); }, [spec.type]);
  const option = useMemo(() => (type === 'table' ? null : buildOption(spec, type)), [spec, type, themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = !spec.categories.length || spec.series.every((s) => s.data.every((v) => v === null || v === 0));

  const download = () => {
    const c = chartRef.current;
    if (!c) return;
    const url = c.getDataURL({ pixelRatio: 2, backgroundColor: cssVar('--chart-surface') || '#fff' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w]+/g, '_')}.png`;
    a.click();
  };
  const body = empty ? (
    <div className="muted small" style={{ height, display: 'grid', placeItems: 'center' }}>No data for the current selection</div>
  ) : type === 'table' ? (
    <div className="tbl-wrap" style={{ maxHeight: height }}>
      <table className="tbl">
        <thead><tr><th></th>{spec.series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
        <tbody>{spec.categories.map((c, i) => <tr key={c}><td>{c}</td>{spec.series.map((s) => <td key={s.name} className="num">{fmtVal(s.data[i], spec.unit)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  ) : (
    <EChart option={option!} height={big ? Math.min(window.innerHeight * 0.7, 640) : height} onReady={(c) => (chartRef.current = c)} onClick={onCategoryClick} />
  );
  if (isHiddenViz && !hide.customize) return null;
  const card = (
    <div className={`card ${className || ''} ${isHiddenViz ? 'viz-dim' : ''}`} id={id}>
      <div className="card-head">
        <div>
          <div className="card-title"><HideBox k={hk} />{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
        <div className="card-tools">
          <button className="icon-btn" title="Change visual type" onClick={() => setMenu((m) => !m)}>⇄</button>
          <button className="icon-btn" title={type === 'table' ? 'Show chart' : 'Show data table'} onClick={() => setType(type === 'table' ? spec.type || 'bar' : 'table')}>▦</button>
          {type !== 'table' && <button className="icon-btn" title="Download PNG" onClick={download}>⤓</button>}
          <button className="icon-btn" title={big ? 'Close focus mode' : 'Focus mode'} onClick={() => setBig(!big)}>{big ? '✕' : '⤢'}</button>
        </div>
      </div>
      {menu && (
        <div className="type-menu" onMouseLeave={() => setMenu(false)}>
          {allowed.map((t) => <button key={t} className={t === type ? 'on' : ''} onClick={() => { setType(t); setMenu(false); }}>{TYPE_LABEL[t]}</button>)}
        </div>
      )}
      {body}
      {note && <div className="card-sub" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
  if (big) return <div className="overlay" onClick={(e) => e.target === e.currentTarget && setBig(false)}><div className="modal">{card}</div></div>;
  return card;
}

export function Gauge({ value, label, height = 200, themeKey }: { value: number | null; label: string; height?: number; themeKey: string }) {
  const option = useMemo(() => {
    const text = cssVar('--text');
    const v = value ?? 0;
    return {
      animation: false,
      series: [{
        type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '95%', center: ['50%', '62%'],
        progress: { show: true, width: 14, itemStyle: { color: v >= 75 ? cssVar('--good') : v >= 60 ? cssVar('--warn') : v >= 45 ? cssVar('--serious') : cssVar('--critical') } },
        axisLine: { lineStyle: { width: 14, color: [[1, cssVar('--grid')]] } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
        title: { offsetCenter: [0, '38%'], color: cssVar('--text-2'), fontSize: 12 },
        detail: { valueAnimation: false, offsetCenter: [0, '0%'], fontSize: 30, fontWeight: 700, color: text, formatter: value === null ? '—' : '{value}' },
        data: [{ value: value ?? 0, name: label }],
      }],
    };
  }, [value, label, themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return <EChart option={option} height={height} />;
}

export function Radar({ indicators, values, height = 300, themeKey }: { indicators: string[]; values: (number | null)[]; height?: number; themeKey: string }) {
  const option = useMemo(() => ({
    tooltip: { trigger: 'item' },
    radar: { indicator: indicators.map((n) => ({ name: n, max: 100 })), radius: '62%', axisName: { color: cssVar('--text-2'), fontSize: 10.5 }, splitLine: { lineStyle: { color: cssVar('--grid') } }, splitArea: { show: false }, axisLine: { lineStyle: { color: cssVar('--grid') } } },
    series: [{ type: 'radar', data: [{ value: values.map((v) => v ?? 0), name: 'Score', areaStyle: { color: seriesColor(0), opacity: 0.18 }, lineStyle: { color: seriesColor(0), width: 2 }, itemStyle: { color: seriesColor(0) } }] }],
  }), [indicators, values, themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // ECharts' radar needs at least 3 axes (fewer crashes its layout)
  if (indicators.length < 3) return <div className="muted small" style={{ height, display: 'grid', placeItems: 'center', textAlign: 'center' }}>Not enough scored dimensions for a radar yet — upload more data.</div>;
  return <EChart option={option} height={height} />;
}
