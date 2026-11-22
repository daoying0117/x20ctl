// SPDX-License-Identifier: GPL-3.0-or-later
// In-memory GATT peripheral used by the labeled demo and the Node integration tests.
import {SERVICE, WRITE, NOTIFY, decode, encode} from './protocol.mjs';

export function demoDevice({pro = true, firmware = pro ? 0x44 : 0x23, mode = pro ? 6 : 2, lighting = pro,
  onPacket = () => {}, fault = () => null} = {}) {
  const device = new EventTarget();
  const notification = new EventTarget();
  device.name = 'Xpert2';
  const stick = [8,8,85,85,170,170,0];
  const trigger = [4,34,82,133,229,235,0];
  const limits = Array.from({length:8}, (_, i) => [i < (pro ? 6 : 4) ? 42 : 0,0]).flat();
  const records = new Map([
    [0xb1,[14,...stick,...stick]], [0xb2,[14,...trigger,...trigger]],
    [0xb3,[8,76,76,0,0,0xc0,0xd4,1,0]], [0xb6,[0]],
    [0xb7,[24,170,240,70,0,0,153,2, ...Array(17).fill(0)]],
  ]);
  const macros = new Map();
  let pending = [];
  let subscribed = false;
  const chunk = (data, index) => data.slice(index * 15, index * 15 + 15);
  function answer({op, payload, length, serial}) {
    if (op === 0x91) return pro ? [7,0x10,0x20,0x20,6,1,firmware,0x50 | mode] : [7,0x10,0x13,0x20,9,1,firmware,0x50 | mode];
    if (op === 0x1d) return [4,0,0,0,0x80];
    if (op === 0x1e) return null;
    const [position, kind] = payload;
    if (op === 0xb0) {
      const menu = {
        1:[10,3,3,pro ? 15 : 3,pro ? 1 : 0,pro ? 63 : 15,1,lighting ? 15 : 0,2,0,0],
        3:[9,16,1,136,13,132,11,130,93,130],
        5:[11,18,18,130,13,132,1,136,11,130,93,130],
        6:[16,...limits],
      };
      return menu[kind] && chunk(menu[kind],position);
    }
    if (op === 0xb5) return chunk(macros.get(kind) ?? [0],position);
    if (records.has(op)) return chunk(records.get(op),position);
    if (op >= 0x31 && op <= 0x37) {
      const index = (serial >>> 3) & 15;
      pending = index === 0 ? [...payload] : [...pending,...payload];
      const size = op === 0x35 && pro && pending[0] ? 3 + pending[0] * 5 : pending[0] + 1;
      if (pending.length === size) {
        if (op === 0x35) macros.set(length >>> 5,pending);
        else records.set(op + 0x80,pending);
        pending = [];
      }
      return [2,0xdf,0xaa];
    }
    return null;
  }
  notification.startNotifications = async () => { subscribed = true; return notification; };
  const writer = {async writeValueWithResponse(wire) {
    if (!subscribed || !device.gatt.connected) throw new Error('演示手柄连接已断开');
    const packet = decode(wire);
    onPacket(packet);
    const problem = fault(packet);
    if (problem === 'disconnect') { device.gatt.disconnect(); return; }
    if (problem === 'drop') return;
    const body = problem === 'ignore-write' ? [2,0xdf,0xaa] : answer(packet);
    if (problem === 'drop-ack') return;
    if (body) {
      const response = encode(0x19,body,problem === 'serial' ? packet.serial ^ 1 : packet.serial,undefined,0x37);
      if (problem === 'crc') response[response.length-1] ^= 1;
      notification.value = new DataView(response.buffer);
      notification.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  }};
  device.gatt = {
    connected:false,
    async connect() { this.connected = true; return this; },
    async getPrimaryService(uuid) {
      if (uuid !== SERVICE) throw new Error('演示手柄缺少此服务');
      return {async getCharacteristic(uuid) {
        if (uuid === WRITE) return writer;
        if (uuid === NOTIFY) return notification;
        throw new Error('演示手柄缺少此特征');
      }};
    },
    disconnect() {
      this.connected = false; subscribed = false;
      device.dispatchEvent(new Event('gattserverdisconnected'));
    },
  };
  return device;
}
