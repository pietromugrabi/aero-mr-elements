// Alternativa ao iniciar.ps1 para quem tem Node.js (≥ 18):  node server.mjs [porta]
// Serve esta pasta em http://localhost:<porta>/ e grava o estado em dados/estado.json.
import http from 'node:http';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dados = join(root, 'dados');
const estado = join(dados, 'estado.json');
const port = Number(process.argv[2]) || 8765;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.dat': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

await mkdir(dados, { recursive: true });

http.createServer(async (req, res) => {
  const send = (code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/api/estado') {
      if (req.method === 'GET') return existsSync(estado) ? send(200, await readFile(estado), 'application/json') : send(404, '{}', 'application/json');
      if (req.method === 'PUT' || req.method === 'POST') {
        const chunks = []; for await (const c of req) chunks.push(c);
        if (existsSync(estado)) await copyFile(estado, join(dados, 'estado.anterior.json'));
        await writeFile(estado, Buffer.concat(chunks));
        return send(200, '{"ok":true}', 'application/json');
      }
      return send(405, '');
    }
    if (path === '/api/info') return send(200, JSON.stringify({ arquivo: estado, servidor: 'node' }), 'application/json');
    let full = resolve(root, normalize('.' + (path === '/' ? '/index.html' : path)));
    if (!full.startsWith(root) || full.startsWith(dados)) return send(403, 'proibido');
    if (existsSync(full) && (await stat(full)).isDirectory()) full = join(full, 'index.html');
    if (!existsSync(full)) return send(404, 'não encontrado');
    send(200, await readFile(full), mime[extname(full).toLowerCase()] || 'application/octet-stream');
  } catch (e) { send(500, String(e)); }
}).listen(port, 'localhost', () => console.log(`AERO MULT-MR ELEMENTS em http://localhost:${port}/ — dados em ${estado}`));
