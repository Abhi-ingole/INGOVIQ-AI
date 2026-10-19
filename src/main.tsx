import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// In the single-file build, keep a pristine copy of this document (before React renders)
// so an exported HTML can itself export a fresh HTML snapshot.
if (__INGOVIQ_STANDALONE__) window.__INGOVIQ_TEMPLATE__ = '<!doctype html>\n' + document.documentElement.outerHTML;

// a stale chunk after a new deploy → reload once
window.addEventListener('vite:preloadError', () => {
  try { if (sessionStorage.getItem('ingoviq.reloaded')) return; sessionStorage.setItem('ingoviq.reloaded', '1'); } catch { return; }
  location.reload();
});
try { setTimeout(() => sessionStorage.removeItem('ingoviq.reloaded'), 10000); } catch { /* storage blocked */ }

/** Never a blank page: show what went wrong and a way out (reset the data saved in this browser). */
export class Guard extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error('INGOVIQ crashed:', err); }
  reset = async () => {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('ingoviq.')) localStorage.removeItem(k); } catch { /* blocked */ }
    try { await new Promise((res) => { const r = indexedDB.deleteDatabase('ingoviq-ai'); r.onsuccess = r.onerror = r.onblocked = () => res(null); }); } catch { /* blocked */ }
    location.reload();
  };
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ maxWidth: 720, margin: '60px auto', padding: 24, font: '15px system-ui, sans-serif', background: '#fff', border: '1px solid #ddd', borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>INGOVIQ AI could not open</h2>
        <p>Something in the data saved in this browser stopped the dashboard from loading.</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 10, borderRadius: 6, fontSize: 12 }}>{String(this.state.err?.stack || this.state.err).slice(0, 1200)}</pre>
        <button onClick={() => location.reload()} style={{ padding: '8px 14px', marginRight: 8 }}>Try again</button>
        <button onClick={this.reset} style={{ padding: '8px 14px', background: '#1f4fd1', color: '#fff', border: 0, borderRadius: 6 }}>Reset saved data &amp; reload</button>
        <p style={{ fontSize: 12, color: '#666' }}>Reset removes the files and settings stored in this browser only. Upload the files again afterwards.</p>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Guard><App /></Guard>
  </StrictMode>,
);
