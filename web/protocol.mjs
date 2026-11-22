// SPDX-License-Identifier: GPL-3.0-or-later
// Port of x20ctl/protocol.py and X20Ctl.Zone/Capture/KeyLinkerCodec.cs.
export const SERVICE = 'd7f010e0-660d-46e9-96c3-19c4148bdab5';
export const WRITE = 'd7f010e1-660d-46e9-96c3-19c4148bdab5';
export const NOTIFY = 'd7f010e2-660d-46e9-96c3-19c4148bdab5';

const dataKey = [51, 99, 157, 121, 242, 219, 162, 26, 170, 33, 139, 232, 116, 211, 88];
const serialKey = [161, 82, 213, 163, 245, 137, 246, 143, 240, 157, 72, 147, 234, 52, 49, 186, 195, 77, 198, 235,
  73, 96, 216, 163, 218, 42, 83, 141, 244, 97, 24, 191, 174, 215, 111, 81, 228, 160, 217, 146];
const crcTable = Uint8Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xeb : 0);
  return value;
});

export function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) crc = crcTable[crc ^ byte];
  return crc;
}

export function encode(op, payload, serial, length = payload.length + 5, nonce = crypto.getRandomValues(new Uint8Array(1))[0]) {
  const size = payload.length + 5;
  if (size > 20 || (length & 31) !== size) throw new RangeError('KeyLinker 报文长度无效');
  const bytes = Uint8Array.of(op, length, serial, nonce, ...payload, 0);
  bytes[size - 1] = crc8(bytes.subarray(0, -1));
  const sum = serial + nonce;
  bytes[0] ^= sum - 154;
  bytes[1] ^= sum + 155;
  bytes[2] = (serial - 173) ^ nonce;
  bytes[3] = (nonce + 191) ^ 219;
  for (let i = 4; i < size - 1; i++) bytes[i] ^= sum - dataKey[i - 4];
  const offset = (bytes[3] & 2) * 10;
  return bytes.map((value, i) => value ^ serialKey[offset + i]);
}

export function decode(wire) {
  if (wire.length < 5 || wire.length > 20) throw new RangeError('KeyLinker 回包长度无效');
  const offset = ((wire[3] ^ serialKey[3]) & 2) * 10;
  const bytes = wire.map((value, i) => value ^ serialKey[offset + i]);
  const nonce = ((bytes[3] ^ 219) - 191) & 255;
  const serial = ((bytes[2] ^ nonce) + 173) & 255;
  const sum = serial + nonce;
  bytes[0] ^= sum - 154;
  bytes[1] ^= sum + 155;
  bytes[2] = serial;
  bytes[3] = nonce;
  for (let i = 4; i < bytes.length - 1; i++) bytes[i] ^= sum - dataKey[i - 4];
  if ((bytes[1] & 31) !== bytes.length) throw new Error('KeyLinker 回包长度字段无效');
  if (crc8(bytes.subarray(0, -1)) !== bytes.at(-1)) throw new Error('KeyLinker CRC 校验失败');
  return {op: bytes[0], length: bytes[1], serial, payload: bytes.slice(4, -1)};
}

export const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
export const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
export const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const defaultSources = [1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16, 11, 12, 93, 94];
export const macroKeys = [18, 19, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 93, 94];
export const slotNames = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'ML', 'MR'];

export function identity(record) {
  if (record.length < 7 || record[0] !== record.length - 1) throw new Error('设备身份记录不完整');
  const id = hex(record.slice(1, 5)).replaceAll(' ', '');
  const model = {10132009: 'X20', 10202006: 'X20 Pro'}[id] ?? '';
  const firmware = `${record[5].toString(16)}.${hex(record.slice(6, 7))}`;
  const mode = record[0] === 7 ? record[7] & 15 : null;
  const pro = model === 'X20 Pro';
  const verified = !!model && mode === (pro ? 6 : 2) && firmware === (pro ? '1.44' : '1.23');
  return {model, pro, firmware, mode, verified, vid: id.slice(0, 4), pid: id.slice(4)};
}

export function decodeKeyList(record) {
  const keys = [];
  const count = record[1];
  for (const value of record.slice(2)) {
    if (keys.length >= count) break;
    if (value & 128) {
      if (!keys.length || (value & 127) < 2) throw new Error('设备按键列表格式无效');
      for (let run = 1; run < (value & 127); run++) keys.push(keys.at(-1) + 1);
    } else keys.push(value);
  }
  if (keys.length !== count || new Set(keys).size !== count || keys.some(key => key < 1 || key > 127)) {
    throw new Error('设备按键列表格式无效');
  }
  return keys;
}

export function remapValues(record, sources) {
  if (record.length === 1 && !record[0]) return sources.map(() => 0);
  if (record.length !== sources.length + 1 || record[0] !== sources.length) throw new Error('按键映射记录与设备按键列表不匹配');
  return Array.from(record.slice(1), (target, i) => target === sources[i] ? 0 : target);
}

export function macroLayout(keys) {
  const digital = new Map();
  const analog = new Map();
  let bit = 0;
  for (const key of keys) {
    if (key === 18 || key === 19) {
      analog.set(key, bit);
      bit += 4;
    } else digital.set(key, bit++);
  }
  if (bit > 24) throw new Error('宏按键布局超出设备报文范围');
  return {digital, analog};
}

export function macroSteps(record, layout) {
  const steps = [];
  for (let at = 3; at < record.length; at += 5) {
    const mask = record[at] | record[at + 1] << 8 | record[at + 2] << 16;
    const keys = [...layout.digital].filter(([, bit]) => mask & (1 << bit)).map(([key]) => key);
    const direction = (key) => layout.analog.has(key) ? (mask >>> layout.analog.get(key)) & 15 : 8;
    steps.push({keys, left: direction(18), right: direction(19), ms: (record[at + 3] | record[at + 4] << 8) * 5});
  }
  return steps;
}

export function buildMacro(steps, layout, pro, limit, held) {
  if (steps.length > limit) throw new Error(`此背键最多支持 ${limit} 个步骤`);
  // Upstream's Pro editor writes a neutral step for an empty timeline.
  if (!steps.length) {
    if (!pro) return Uint8Array.of(0);
    steps = [{keys: [], left: 8, right: 8, ms: 40}];
  }
  const body = [];
  for (const step of steps) {
    if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 327675 || step.ms % 5) throw new Error('宏时长必须是 5 毫秒的整数倍');
    let mask = 0;
    for (const key of step.keys) {
      if (!layout.digital.has(key)) throw new Error('设备不支持此宏按键');
      mask |= 1 << layout.digital.get(key);
    }
    for (const [key, direction] of [[18, step.left], [19, step.right]]) {
      if (layout.analog.has(key)) {
        if (!Number.isInteger(direction) || direction < 0 || direction > 15) throw new Error('摇杆方向无效');
        mask |= direction << layout.analog.get(key);
      }
    }
    const ticks = step.ms / 5;
    body.push(mask & 255, (mask >>> 8) & 255, mask >>> 16, ticks & 255, ticks >>> 8);
  }
  return Uint8Array.of(pro ? steps.length : body.length + 2, held[1] ?? 0, held[2] ?? 0, ...body);
}
