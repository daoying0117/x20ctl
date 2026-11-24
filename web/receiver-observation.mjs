// SPDX-License-Identifier: GPL-3.0-or-later
import {decode, hex, identity} from './protocol.mjs';

const receiver = {vendorId: 0x413d, productId: 0x2131};
const usagePages = [0xff10, 0xff70];
const sampleLimit = 24;

export function chooseReceiver(hid) {
  return hid.requestDevice({filters: usagePages.map(usagePage => ({...receiver, usagePage}))});
}

function inputIds(collection) {
  return [...collection.inputReports.map(report => report.reportId), ...collection.children.flatMap(inputIds)];
}

function candidate(devices) {
  for (const device of devices) {
    if (device.vendorId !== receiver.vendorId || device.productId !== receiver.productId) continue;
    const allowed = device.collections.filter(collection => usagePages.includes(collection.usagePage));
    const otherIds = new Set(device.collections.filter(collection => !allowed.includes(collection)).flatMap(inputIds));
    const reportIds = new Set(allowed.flatMap(inputIds).filter(id => !otherIds.has(id)));
    if (reportIds.size) return {device, reportIds, usagePages: allowed.map(collection => collection.usagePage)};
  }
  throw new Error('未找到可单独监听的 FF10 或 FF70 输入报告。请查看 HID 描述符。');
}

function framedIdentity(bytes) {
  // These are the two exact sizes of a KeyLinker identity reply. A HID report
  // may pad the payload with zeros. Never infer an identity from a partial frame.
  for (const size of [12, 13]) {
    if (bytes.length < size || bytes.subarray(size).some(Boolean)) continue;
    try {
      const frame = decode(bytes.subarray(0, size));
      if (frame.op !== 0x19) continue;
      const info = identity(frame.payload);
      if (info.model && (frame.payload[0] === 6 || frame.payload[0] === 7)) {
        return {model: info.model, firmware: info.firmware, mode: info.mode};
      }
    } catch {
      // Most device reports have a different format.
    }
  }
}

export async function observeReceiver(hid, devices, {signal, durationMs = 20000, onStart = () => {}} = {}) {
  const {device, reportIds, usagePages} = candidate(devices);
  const wasOpen = device.opened;
  const samples = new Map();
  let total = 0;
  let omitted = 0;
  let deviceIdentity;
  function receive({reportId, data}) {
    if (!reportIds.has(reportId)) return;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, 128));
    total++;
    if (data.byteLength === bytes.length) deviceIdentity ??= framedIdentity(bytes);
    const payload = hex(bytes);
    const key = `${reportId}:${payload}`;
    const sample = samples.get(key);
    if (sample) sample.count++;
    else if (samples.size < sampleLimit) samples.set(key, {reportId, payload, count: 1});
    else omitted++;
  }

  if (signal?.aborted) return;
  device.addEventListener('inputreport', receive);
  try {
    if (!wasOpen) await device.open();
    let end = 'stopped';
    if (!signal?.aborted) {
      onStart();
      end = await new Promise(resolve => {
        const timer = setTimeout(() => finish('timeout'), durationMs);
        const stop = () => finish('stopped');
        const disconnected = event => { if (event.device === device) finish('disconnected'); };
        function finish(reason) {
          clearTimeout(timer);
          signal?.removeEventListener('abort', stop);
          hid.removeEventListener('disconnect', disconnected);
          resolve(reason);
        }
        signal?.addEventListener('abort', stop, {once: true});
        hid.addEventListener('disconnect', disconnected);
        if (signal?.aborted) stop();
      });
    }
    return {usbId: '413D:2131', usagePages: usagePages.map(page => page.toString(16).toUpperCase()),
      end, total, omitted, samples: [...samples.values()], deviceIdentity};
  } finally {
    device.removeEventListener('inputreport', receive);
    if (!wasOpen && device.opened) await device.close().catch(() => {});
  }
}
