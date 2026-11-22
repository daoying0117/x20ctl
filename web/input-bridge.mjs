// SPDX-License-Identifier: GPL-3.0-or-later
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

export const unavailableInput = Object.freeze({available: false, pads: []});

export function createInputBridge({command = 'python', args = ['-B', '-u', '-m', 'web.input_bridge'],
  idleMs = 2500, timeoutMs = 3000} = {}) {
  let child;
  let pending;
  let idleTimer;
  let retryAfter = 0;

  function finish(state) {
    if (!pending) return;
    const {resolve, timer} = pending;
    pending = undefined;
    clearTimeout(timer);
    resolve(state);
    if (child) {
      idleTimer = setTimeout(stop, idleMs);
      idleTimer.unref();
    }
  }

  function stop() {
    clearTimeout(idleTimer);
    const process = child;
    child = undefined;
    process?.kill();
    finish(unavailableInput);
  }

  function failed(process) {
    if (process !== child) return;
    retryAfter = Date.now() + 5000;
    stop();
  }

  function start() {
    const process = spawn(command, args, {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    child = process;
    process.on('error', () => failed(process));
    process.on('exit', () => failed(process));
    process.stdin.on('error', () => failed(process));
    const output = createInterface({input: process.stdout});
    output.on('line', line => {
      if (process !== child || !pending) return;
      try { finish(JSON.parse(line)); }
      catch { failed(process); }
    });
    return process;
  }

  function sample() {
    if (Date.now() < retryAfter) return Promise.resolve(unavailableInput);
    if (pending) return pending.promise;
    const process = child ?? start();
    clearTimeout(idleTimer);
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pending = {promise, resolve, timer: setTimeout(() => failed(process), timeoutMs)};
    process.stdin.write('state\n');
    return promise;
  }

  return {sample, stop};
}
