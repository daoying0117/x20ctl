// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import test from 'node:test';
import {startConsole} from './launch.mjs';
import {consoleId, createX20Server, listenLocal, parsePort} from './serve.mjs';

function closeAfter(t,server) {
  t.after(() => new Promise(resolve => server.close(resolve)));
}

test('the launcher reuses its existing server and verifies its local identity', async t => {
  const server = createX20Server();
  const url = await listenLocal(server,0);
  closeAfter(t,server);
  const port = server.address().port;
  assert.deepEqual(await startConsole(port),{url});
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/api/launch`)).status,403);
  const response = await fetch(`${base}/api/launch`,{headers:{'X-X20CTL-Launch':'1'}});
  assert.deepEqual(await response.json(),{app:'x20ctl-web',id:consoleId});
});

test('the launcher uses a free port when another application is already listening', async t => {
  const other = createServer((_,response) => response.writeHead(404).end());
  await listenLocal(other,0);
  closeAfter(t,other);
  const port = other.address().port;
  const started = await startConsole(port);
  assert.ok(started.server);
  closeAfter(t,started.server);
  assert.ok(started.server.address().port > port);
  const page = await fetch(started.url.replace('localhost','127.0.0.1'));
  assert.match(await page.text(),/X20CTL/);
});

test('a source checkout can select a valid port explicitly', () => {
  assert.equal(parsePort(),8765);
  assert.equal(parsePort('8766'),8766);
  assert.throws(() => parsePort('not-a-port'),/端口/);
});
