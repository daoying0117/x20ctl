// SPDX-License-Identifier: GPL-3.0-or-later
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createInputBridge, unavailableInput} from './input-bridge.mjs';

const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',mjs:'application/javascript; charset=utf-8',png:'image/png'};
const assets = /^\/src\/assets\/controllers\/(x20|x20_pro)\/native\/(front|rear)-full\.png$/;
const pages = /^\/web\/(index\.html|style\.css|app\.mjs|device\.mjs|protocol\.mjs|demo\.mjs|transport\.html|transport-page\.mjs|usb-probe\.mjs|receiver-observation\.mjs)$/;
export const consoleId = createHash('sha256').update(fileURLToPath(new URL('../', import.meta.url))).digest('hex');

export function parsePort(value = 8765) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('端口必须在 1 到 65535 之间');
  return port;
}

function localRequest(request, port) {
  const {host, origin, 'sec-fetch-site': site} = request.headers;
  return request.method === 'GET' && (host === `localhost:${port}` || host === `127.0.0.1:${port}`) &&
    (!site || site === 'same-origin') && (!origin || origin === `http://${host}`);
}

function localJson(response, body) {
  response.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Cross-Origin-Resource-Policy':'same-origin'}).end(JSON.stringify(body));
}

export function createX20Server() {
  const packagedPython = fileURLToPath(new URL('../runtime/python/python.exe', import.meta.url));
  const input = process.platform === 'win32' ?
    createInputBridge({command:existsSync(packagedPython) ? packagedPython : 'python'}) : null;
  const server = createServer(async (request,response) => {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405,{Allow:'GET, HEAD'}).end(); return; }
    const path = request.url.split('?')[0];
    if (path === '/api/input' || path === '/api/launch') {
      const launch = path === '/api/launch';
      const access = request.headers[launch ? 'x-x20ctl-launch' : 'x-x20ctl-input'];
      if (access !== '1' || !localRequest(request,server.address()?.port)) { response.writeHead(403).end(); return; }
      localJson(response,launch ? {app:'x20ctl-web',id:consoleId} : input ? await input.sample() : unavailableInput);
      return;
    }
    if (path === '/' || path === '/web' || path === '/web/') {
      response.writeHead(302,{Location:'/web/index.html'}).end(); return;
    }
    if (!pages.test(path) && !assets.test(path) && path !== '/assets/x20ctl.png') { response.writeHead(404).end(); return; }
    try {
      const contents = await readFile(new URL(`..${path}`,import.meta.url));
      response.writeHead(200,{
        'Content-Type':types[path.split('.').at(-1)], 'Content-Length':contents.length,
        'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      }).end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(); }
  });
  server.on('close',() => input?.stop());
  return server;
}

export async function listenLocal(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error',reject);
    server.listen(port,'127.0.0.1',() => {
      server.off('error',reject);
      resolve();
    });
  });
  return `http://localhost:${server.address().port}/`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const url = await listenLocal(createX20Server(),parsePort(process.argv[2]));
  console.log(`X20CTL Web: ${url}`);
}
