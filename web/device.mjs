// SPDX-License-Identifier: GPL-3.0-or-later
import {SERVICE, WRITE, NOTIFY, encode, decode, hex, same, pause, identity,
  defaultSources, decodeKeyList, remapValues, macroKeys, macroLayout, buildMacro} from './protocol.mjs';

const confirm = Uint8Array.of(2, 0xdf, 0xaa);
const power = [2, 0xdf, 0xab];
const definitions = {
  sticks: {read: 0xb1, write: 0x31, cap: 0}, triggers: {read: 0xb2, write: 0x32, cap: 1},
  motors: {read: 0xb3, write: 0x33, cap: 2}, macro: {read: 0xb5, write: 0x35, cap: 4},
  buttons: {read: 0xb6, write: 0x36, cap: 5}, lighting: {read: 0xb7, write: 0x37, cap: 6},
};

export function chooseDevice(all = false) {
  if (!globalThis.isSecureContext || !navigator.bluetooth) {
    throw new Error('请用支持网页蓝牙的 Chrome 或 Edge 打开本机地址，并开启系统蓝牙。');
  }
  const optionalServices = [SERVICE];
  return navigator.bluetooth.requestDevice(all ? {acceptAllDevices: true, optionalServices} : {
    filters: [{services: [SERVICE]}, {namePrefix: 'Xpert'}, {namePrefix: 'EasySMX'},
      {namePrefix: 'X20'}, {namePrefix: 'ESM'}], optionalServices,
  });
}

export class KeyLinker {
  #device;
  #write;
  #notify;
  #pending;
  #serial = 0;
  #proSerial = 160;
  #host = 8;
  #save = 0;
  #timeout;
  #log;
  #disconnected;
  #closed = false;
  #caps;
  #info;
  #busy = false;

  constructor(device, {timeout = 4000, log = () => {}, disconnected = () => {}} = {}) {
    this.#device = device;
    this.#timeout = timeout;
    this.#log = log;
    this.#disconnected = disconnected;
  }

  get info() { return this.#info; }
  get caps() { return this.#caps?.slice(); }
  get name() { return this.#device.name || 'KeyLinker'; }
  get slots() {
    return Array.from({length: this.#info?.pro ? 6 : 4}, (_, i) => i).filter(i => this.#caps?.[4] & (1 << i));
  }

  async connect() {
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnect);
    try {
      const server = await this.#device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE);
      this.#write = await service.getCharacteristic(WRITE);
      this.#notify = await service.getCharacteristic(NOTIFY);
      this.#notify.addEventListener('characteristicvaluechanged', this.#onNotify);
      await this.#notify.startNotifications();
      const raw = await this.#request(0x91, []);
      this.#info = Object.freeze(identity(raw));
      try { this.#caps = (await this.#record(0xb0, [0, 1])).slice(1); }
      catch (error) {
        if (!this.#device.gatt.connected) throw error;
        this.#log(`设备能力读取失败 · ${error.message}`);
      }
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  #onDisconnect = () => {
    this.disconnect();
    this.#disconnected();
  };

  disconnect() {
    this.#closed = true;
    this.#pending?.reject(new Error('蓝牙连接已断开'));
    this.#pending = undefined;
    this.#notify?.removeEventListener('characteristicvaluechanged', this.#onNotify);
    this.#device.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    if (this.#device.gatt.connected) this.#device.gatt.disconnect();
  }

  #onNotify = ({target}) => {
    const {buffer, byteOffset, byteLength} = target.value;
    try {
      const packet = decode(new Uint8Array(buffer, byteOffset, byteLength));
      const pending = this.#pending;
      if (packet.op === 0x19 && pending?.serial === packet.serial) {
        this.#log(`RX 19 · ${hex([packet.serial])} · ${hex(packet.payload)}`);
        pending.resolve(packet.payload);
      }
    } catch (error) { this.#log(error.message); }
  };

  #next() {
    this.#serial = (this.#serial + 1) & 127;
    return this.#serial | ((this.#serial & 1) ? 0 : 128);
  }

  async #request(op, payload, {serial = this.#next(), length = payload.length + 5, reply = true} = {}) {
    if (this.#closed || !this.#device.gatt.connected) throw new Error('蓝牙连接已断开');
    if (this.#pending) throw new Error('已有 KeyLinker 请求正在处理');
    const wire = encode(op, payload, serial, length);
    let timer;
    let writeCompleted = false;
    const answer = reply ? new Promise((resolve, reject) => {
      this.#pending = {serial, resolve, reject};
    }) : Promise.resolve();
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`KeyLinker 0x${hex([op])} ${writeCompleted ? '等待回包' : '蓝牙写入'}超时`));
        if (!writeCompleted) {
          this.disconnect();
          this.#disconnected();
        }
      }, this.#timeout);
    });
    try {
      this.#log(`TX ${hex([op])} · ${hex([serial])} · ${hex(payload)}`);
      const write = Promise.resolve().then(() => this.#write.writeValueWithResponse(wire)).then(() => { writeCompleted = true; });
      const [response] = await Promise.race([Promise.all([answer, write]), expiry]);
      return response;
    } finally {
      clearTimeout(timer);
      this.#pending = undefined;
    }
  }

  async #record(op, args = [0], size = first => first[0] + 1, studio = false) {
    const next = () => studio ? (++this.#proSerial & 255) : this.#next();
    const first = await this.#request(op, args, {serial: next()});
    if (!first.length) throw new Error('手柄返回了空记录');
    const expected = size(first);
    if (expected < 1 || expected > 240) throw new Error('设备记录长度超出允许范围');
    const data = [...first];
    for (let index = 1; data.length < expected && index < 16; index++) {
      const more = await this.#request(op, [index, ...args.slice(1)], {serial: next()});
      if (!more.length) break;
      data.push(...more);
    }
    if (data.length !== expected) throw new Error('设备分包记录不完整或长度不符');
    return Uint8Array.from(data);
  }

  supportsSetting(section) {
    const def = definitions[section];
    return !!def && !!this.#info?.model && !!this.#caps?.[def.cap] &&
      (section !== 'lighting' || this.#info.pro);
  }

  get hasWritableSettings() {
    return Object.keys(definitions).some(section => this.supportsSetting(section));
  }

  async #exclusive(action) {
    if (this.#busy) throw new Error('手柄正在处理另一项操作');
    this.#busy = true;
    try { return await action(); }
    finally { this.#busy = false; }
  }

  // Pro lighting uses Studio chunk counters, and Pro macros use an entry count
  // after querying slot limits. Basic settings also have shared host commands.
  #studio(section) {
    return this.#info.pro && (section === 'macro' || section === 'lighting' ||
      (section !== 'motors' && this.#info.verified));
  }

  async #read(section, slot) {
    if (!this.supportsSetting(section)) throw new Error('当前设备未开放此项设置');
    const {read} = definitions[section];
    const studio = this.#studio(section);
    if (section === 'macro') {
      if (!this.slots.includes(slot)) throw new Error('该背键不支持宏');
      // The Pro Studio requests limits first to select the entry-count form.
      const sizes = studio || (this.#caps[7] & 2) ? await this.#record(0xb0, [0, 6], undefined, studio) : null;
      const at = 1 + slot * 2;
      const reported = sizes && at + 1 < sizes.length ? sizes[at] | sizes[at + 1] << 8 : 0;
      const limit = Math.min(reported || 42, 47);
      let keys = macroKeys;
      if (!studio) {
        try {
          const reportedKeys = decodeKeyList(await this.#record(0xb0, [0, 5]));
          if (reportedKeys.length) keys = reportedKeys;
        } catch { /* The measured X20 layout is the upstream fallback. */ }
      }
      const raw = await this.#record(read, [0, slot], first => studio && first[0] ? 3 + 5 * first[0] : first[0] + 1, studio);
      if (raw.length !== 1 && (raw.length < 3 || (raw.length - 3) % 5)) throw new Error('宏记录格式无效');
      return {raw, limit, layout: macroLayout(keys), slot};
    }
    const raw = await this.#record(read, [0], undefined, studio);
    if (section === 'buttons') {
      let sources;
      try { sources = decodeKeyList(await this.#record(0xb0, [0, 3], undefined, studio)); }
      catch (error) {
        if (this.#info.pro || !this.#info.verified) throw error;
        sources = defaultSources;
      }
      if (!sources.length) throw new Error('设备未返回可映射按键');
      remapValues(raw, sources);
      return {raw, sources};
    }
    if (section === 'lighting' && raw.length !== 25) throw new Error('灯光记录长度无效');
    if (section === 'motors' && (raw.length < 3 || raw.length > 15)) throw new Error('振动记录长度无效');
    if ((section === 'sticks' || section === 'triggers') && ![8, 15].includes(raw.length)) throw new Error('响应曲线记录长度无效');
    return {raw};
  }

  read(section, slot) { return this.#exclusive(() => this.#read(section, slot)); }

  battery() {
    return this.#exclusive(async () => {
      if (!this.#info.model) throw new Error('无法读取未知型号的电量');
      try {
        const raw = await this.#request(0x1d, power);
        if (raw.length < 5 || raw[0] < 4) throw new Error('电量回包不完整');
        const status = raw[4];
        return {level: status & 32 ? 2 : status & 64 ? 3 : status & 128 ? 4 : 1, charging: !!(status & 16)};
      } finally {
        if (this.#device.gatt.connected) {
          try { await this.#request(0x1e, power, {reply: false}); }
          catch (error) {
            this.disconnect();
            this.#disconnected();
            throw error;
          }
        }
      }
    });
  }

  save(section, baseline, edits) {
    return this.#exclusive(async () => {
      if (!this.supportsSetting(section)) throw new Error('当前设备未开放此项写入');
      const held = await this.#read(section, baseline.slot);
      const studio = this.#studio(section);
      if (!same(held.raw, baseline.raw) || (held.sources && !same(held.sources, baseline.sources))) {
        throw new Error('手柄上的设置已变化，请重新读取后编辑');
      }
      let desired = held.raw.slice();
      if (section === 'buttons') {
        if (this.#info.pro && !same(held.sources, defaultSources)) throw new Error('此 X20 Pro 的按键顺序与已验证布局不符');
        const targets = remapValues(held.raw, held.sources);
        for (const [index, target] of edits) {
          if (!held.sources[index] || (target !== 0 && !held.sources.includes(target))) throw new Error('此按键映射未受支持');
          if (!this.#info.pro && [93, 94].includes(held.sources[index])) throw new Error('X20 的选择键和开始键仅可作为目标');
          targets[index] = target === held.sources[index] ? 0 : target;
        }
        if (same(targets, remapValues(held.raw, held.sources))) return held;
        desired = Uint8Array.of(targets.length, ...targets);
      } else if (section === 'macro') {
        const layout = section => JSON.stringify([...section.layout.digital, ...section.layout.analog]);
        if (layout(baseline) !== layout(held) || baseline.limit !== held.limit) throw new Error('宏按键布局已变化，请重新读取');
        desired = buildMacro(edits, held.layout, studio, held.limit, held.raw);
      } else {
        desired = edits(held.raw.slice());
        if (desired.length !== held.raw.length || desired[0] !== held.raw[0]) throw new Error('写入记录长度与设备不符');
      }
      if (same(desired, held.raw)) return held;
      return this.#writeRecord(section, held, desired);
    });
  }

  testVibration() {
    return this.#exclusive(async () => {
      if (!this.supportsSetting('motors') || !(this.#caps[2] & 1)) throw new Error('此手柄未开放左握把振动试写');
      const original = await this.#read('motors');
      const target = original.raw.slice();
      target[1] += target[1] >= 13 ? -13 : 13;
      let changed;
      try {
        changed = await this.#writeRecord('motors', original, target);
      } finally {
        // An acknowledgement may be lost even if the device applied the write.
        // Restore only when the held bytes still match the test value.
        try {
          const held = changed ?? await this.#read('motors');
          if (same(held.raw, target)) await this.#writeRecord('motors', held, original.raw);
          else if (!same(held.raw, original.raw)) throw new Error('当前记录与试写值及原值均不匹配');
        } catch (error) {
          this.#log(`试写前的振动记录 · ${hex(original.raw)}`);
          throw new Error(`未能确认振动设置已恢复，请重新读取。${error.message}`, {cause: error});
        }
      }
      return {original, testLevel: target[1]};
    });
  }

  async #writeRecord(section, held, desired) {
    const studio = this.#studio(section);
    try {
      for (let index = 0; index * 15 < desired.length; index++) {
        const part = desired.slice(index * 15, (index + 1) * 15);
        let counter = index + 1;
        let host = counter;
        if (!studio) {
          counter = ++this.#save;
          if (!this.#host) this.#host = 8;
          if (section !== 'macro') host = --this.#host;
        }
        let serial = ((counter & 1) << 7) | (index << 3) | (counter & 7);
        if (section === 'macro') {
          host = held.slot;
          if (studio) serial = (index << 3) | ((index & 1) << 7);
        }
        const ack = await this.#request(definitions[section].write, part, {serial, length: ((host & 7) << 5) | (part.length + 5)});
        if (!same(ack, confirm)) throw new Error('手柄未返回预期的写入应答');
        await pause(studio ? 150 : 250);
      }
      const observed = await this.#read(section, held.slot);
      const matches = section === 'buttons' ? same(observed.sources, held.sources) &&
        same(remapValues(observed.raw, observed.sources), remapValues(desired, held.sources)) : same(observed.raw, desired);
      if (!matches) throw new Error('读回值与请求写入的值不同');
      return observed;
    } catch (error) {
      this.#log(`写入前的记录 · ${hex(held.raw)}`);
      throw new Error(`写入结果待确认，请重新读取手柄设置。${error.message}`, {cause: error});
    }
  }
}
