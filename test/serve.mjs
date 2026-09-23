import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 8087);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png' };
createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (process.env.FAIL_THREADS === '1' && url.pathname.endsWith('/basis_encoder_threads.wasm')) {
      res.writeHead(503).end('Intentional threaded-backend failure');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || !statSync(path).isFile()) throw new Error('Not found');
    if (process.env.ISOLATED === '1') {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port} (isolated=${process.env.ISOLATED === '1'})`));
