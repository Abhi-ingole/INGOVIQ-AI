import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// In the single-file build, keep a pristine copy of this document (before React renders)
// so an exported HTML can itself export a fresh HTML snapshot.
if (__INGOVIQ_STANDALONE__) window.__INGOVIQ_TEMPLATE__ = '<!doctype html>\n' + document.documentElement.outerHTML;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
