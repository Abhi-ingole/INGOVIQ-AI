// Copies the single-file build next to the main build so the app can offer it as an HTML download.
import { copyFileSync, rmSync } from 'node:fs';
copyFileSync('dist-standalone/index.html', 'dist/ingoviq-standalone.html');
rmSync('dist-standalone', { recursive: true, force: true });
console.log('dist/ingoviq-standalone.html ready');
