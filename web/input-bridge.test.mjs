// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputBridge, unavailableInput} from './input-bridge.mjs';

test('native input samples are shared across requests and stop after inactivity', async t => {
  const helper = `
    const readline = require('node:readline');
    let polls = 0;
    readline.createInterface({input:process.stdin}).on('line', line => {
      if (line === 'state') console.log(JSON.stringify({available:true, pads:[{pressed:++polls === 1}]}));
    });`;
  const bridge = createInputBridge({command:process.execPath,args:['-e',helper],idleMs:70});
  t.after(() => bridge.stop());
  const first = bridge.sample();
  assert.equal(first,bridge.sample());
  assert.deepEqual(await first,{available:true,pads:[{pressed:true}]});
  assert.deepEqual(await bridge.sample(),{available:true,pads:[{pressed:false}]});
  await new Promise(resolve => setTimeout(resolve,140));
  assert.deepEqual(await bridge.sample(),{available:true,pads:[{pressed:true}]});
});

test('a failing local input helper reports unavailable without rejecting requests', async t => {
  const bridge = createInputBridge({command:process.execPath,args:['-e','process.exit(1)']});
  t.after(() => bridge.stop());
  assert.deepEqual(await bridge.sample(),unavailableInput);
  assert.deepEqual(await bridge.sample(),unavailableInput);
});
