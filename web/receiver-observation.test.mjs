// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {encode} from './protocol.mjs';
import {chooseReceiver, observeReceiver} from './receiver-observation.mjs';

const collection = (usagePage, ...ids) => ({
  usagePage, inputReports: ids.map(reportId => ({reportId})), children: [],
});

class Receiver extends EventTarget {
  vendorId = 0x413d;
  productId = 0x2131;
  collections = [collection(0xff10, 0, 3), collection(1, 0, 4)];
  opened = false;
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport() { assert.fail('Passive testing must not send output reports'); }
  async receiveFeatureReport() { assert.fail('Passive testing must not request feature reports'); }
  emit(reportId, bytes) {
    const event = new Event('inputreport');
    Object.assign(event, {reportId, data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)});
    this.dispatchEvent(event);
  }
}

test('the chooser requests only the known receiver vendor collections', async () => {
  const hid = {requestDevice({filters}) {
    assert.deepEqual(filters, [
      {vendorId: 0x413d, productId: 0x2131, usagePage: 0xff10},
      {vendorId: 0x413d, productId: 0x2131, usagePage: 0xff70},
    ]);
    return Promise.resolve([]);
  }};
  assert.deepEqual(await chooseReceiver(hid), []);
});

test('passive observation excludes shared and game report IDs and validates a padded identity', async () => {
  const hid = new EventTarget();
  const device = new Receiver();
  const stop = new AbortController();
  const frame = encode(0x19, Uint8Array.of(7, 0x10, 0x20, 0x20, 0x06, 1, 0x31, 2), 1, 13, 42);
  const padded = new Uint8Array(63);
  padded.set(frame);
  const damaged = padded.slice();
  damaged[frame.length - 1] ^= 1;
  const result = await observeReceiver(hid, [device], {signal: stop.signal, onStart() {
    device.emit(0, padded);
    device.emit(4, padded);
    device.emit(3, damaged);
    device.emit(3, padded);
    device.emit(3, padded);
    stop.abort();
  }});
  assert.equal(result.end, 'stopped');
  assert.equal(result.total, 3);
  assert.deepEqual(result.samples.map(sample => sample.count), [1, 2]);
  assert.deepEqual(result.deviceIdentity, {model: 'X20 Pro', firmware: '1.31', mode: 2});
  assert.equal(device.opened, false);
});

test('passive observation times out, rejects an ambiguous collection and never opens it', async () => {
  const hid = new EventTarget();
  const device = new Receiver();
  assert.deepEqual(await observeReceiver(hid, [device], {durationMs: 1}), {
    usbId: '413D:2131', usagePages: ['FF10'], end: 'timeout',
    total: 0, omitted: 0, samples: [], deviceIdentity: undefined,
  });
  device.collections = [collection(0xff10, 0), collection(1, 0)];
  device.open = () => assert.fail('An ambiguous report should never be opened');
  await assert.rejects(observeReceiver(hid, [device]), /未找到可单独监听/);
});

test('passive observation closes a disconnected device and bounds unique samples', async () => {
  const hid = new EventTarget();
  const device = new Receiver();
  const disconnect = Object.assign(new Event('disconnect'), {device});
  const result = await observeReceiver(hid, [device], {onStart() {
    queueMicrotask(() => {
      for (let i = 0; i < 29; i++) device.emit(3, Uint8Array.of(i));
      hid.dispatchEvent(disconnect);
    });
  }});
  assert.equal(result.end, 'disconnected');
  assert.equal(result.total, 29);
  assert.equal(result.samples.length, 24);
  assert.equal(result.omitted, 5);
  assert.equal(device.opened, false);
});
