import * as echarts from 'echarts/core';
import { buildOption, type ChartSpec, type ChartType } from '../Chart';

/** Render a chart off-screen (light theme) and return it as a PNG data URL for the PDF. */
export async function chartImage(spec: ChartSpec, type: ChartType, w: number, h: number): Promise<string | null> {
  const root = document.documentElement;
  const prevTheme = root.dataset.theme;
  root.dataset.theme = 'light';
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-30000px;top:0;width:${w}px;height:${h}px;background:#fff`;
  document.body.appendChild(el);
  try {
    const c = echarts.init(el, undefined, { renderer: 'canvas', width: w, height: h });
    const opt = buildOption(spec, type) as Record<string, unknown>;
    c.setOption({ ...opt, animation: false, dataZoom: [] }, true);
    const url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    c.dispose();
    return url;
  } catch { return null; } finally {
    el.remove();
    if (prevTheme) root.dataset.theme = prevTheme;
  }
}

export async function toDataUrl(src: string): Promise<string | undefined> {
  if (src.startsWith('data:')) return src;
  try {
    const b = await (await fetch(src)).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });
  } catch { return undefined; }
}
