/**
 * serve.mjs
 * -----------------------------------------------------------------------------
 * Zero-dependency static file server for previewing the site locally exactly as
 * GitHub Pages would serve it (`npm run serve`, then open http://localhost:8080).
 *
 * This is a dev convenience only — it is never deployed.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number.parseInt(process.env.PORT || '8080', 10);

/** Minimal content-type map for the asset types this site ships. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    // Strip query string and prevent path traversal outside the repo root.
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(ROOT, safePath);

    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, 'index.html');

    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});
