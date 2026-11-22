// SPDX-License-Identifier: GPL-3.0-or-later
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createInputBridge, unavailableInput} from './input-bridge.mjs';

const port = Number(process.argv[2] ?? 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('端口必须在 1 到 65535 之间');
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'application/javascript; charset=utf-8',png:'image/png'};
const assets = /^\/src\/assets\/controllers\/(x20|x20_pro)\/native\/(front|rear)-full\.png$/;
const pages = /^\/web\/(index\.html|style\.css|app\.mjs|device\.mjs|protocol\.mjs|demo\.mjs)$/;
const input = process.platform === 'win32' ? createInputBridge() : null;
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

const server = createServer(async (request,response) => {
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
  const path = request.url.split('?')[0];
  if (path === '/api/input') {
    const {host, origin, 'sec-fetch-site': site, 'x-x20ctl-input': access} = request.headers;
    if (request.method !== 'GET' || access !== '1' || !localHosts.has(host) ||
        (site && site !== 'same-origin') || (origin && origin !== `http://${host}`)) {
      response.writeHead(403).end(); return;
    }
    const state = input ? await input.sample() : unavailableInput;
    response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      'Cross-Origin-Resource-Policy':'same-origin'}).end(JSON.stringify(state));
    return;
  }
  if (path === '/' || path === '/web' || path === '/web/') {
    response.writeHead(302, {Location:'/web/index.html'}).end(); return;
  }
  if (!pages.test(path) && !assets.test(path) && path !== '/assets/x20ctl.png') { response.writeHead(404).end(); return; }
  try {
    const contents = await readFile(new URL(`..${path}`, import.meta.url));
    response.writeHead(200, {
      'Content-Type':types[path.split('.').at(-1)], 'Content-Length':contents.length,
      'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    }).end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); }
});
server.on('close', () => input?.stop());
server.listen(port,'127.0.0.1',() => console.log(`X20CTL Web: http://localhost:${port}/`));
