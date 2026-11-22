// SPDX-License-Identifier: GPL-3.0-or-later
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {consoleId, createX20Server, listenLocal, parsePort} from './serve.mjs';

async function isThisConsole(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/launch`, {
      headers:{'X-X20CTL-Launch':'1'}, signal:AbortSignal.timeout(700), redirect:'error',
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.app === 'x20ctl-web' && body.id === consoleId;
  } catch { return false; }
}

export async function startConsole(preferred = 8765) {
  for (let port = preferred; port <= Math.min(65535,preferred + 20); port++) {
    const server = createX20Server();
    try { return {server,url:await listenLocal(server,port)}; }
    catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
      if (error.code === 'EADDRINUSE' && await isThisConsole(port)) return {url:`http://localhost:${port}/`};
    }
  }
  throw new Error(`在 ${preferred} 附近找不到空闲端口。可以在脚本后指定另一个端口。`);
}

async function openWindowsBrowser(url) {
  const programs = [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe'];
  const browser = candidates.flatMap(name => programs.map(dir => join(dir,name))).find(existsSync);
  const executable = browser ?? join(process.env.SystemRoot || 'C:\\Windows','System32','rundll32.exe');
  const args = browser ? [url] : ['url.dll,FileProtocolHandler',url];
  await new Promise((resolve,reject) => {
    const child = spawn(executable,args,{detached:true,stdio:'ignore',windowsHide:true});
    child.once('error',reject);
    child.once('spawn',() => { child.unref(); resolve(); });
  });
}

async function main(args) {
  const port = parsePort(args.find(arg => arg !== '--no-open'));
  const {server,url} = await startConsole(port);
  console.log(`X20CTL Web: ${url}`);
  if (server) {
    console.log('保持此窗口打开。按 Ctrl+C 停止服务。');
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => server.close());
  } else console.log('已找到正在运行的同一份 X20CTL Web。');
  if (!args.includes('--no-open') && process.platform === 'win32') {
    try { await openWindowsBrowser(url); }
    catch { console.log('请在 Chrome 或 Edge 中打开上面的地址。'); }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
