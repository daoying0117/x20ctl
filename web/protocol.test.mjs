// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyLinker} from './device.mjs';
import {demoDevice} from './demo.mjs';
import {decode, encode, hex, identity, macroSteps, remapValues} from './protocol.mjs';

const bytes = value => Uint8Array.from(value.split(' '), part => parseInt(part,16));

test('X20 hardware capture matches encoded query and decoded identity', () => {
  // docs/01-protocol.md §4a, X20 firmware 1.23 capture.
  assert.equal(hex(encode(0x91,[],1,5,0x43)),'9a 88 c2 7a 4b');
  const packet = decode(bytes('26 8c b6 8e f7 4c 7e 10 bf c1 fd df 62'));
  assert.equal(packet.op,0x19);
  assert.equal(packet.serial,1);
  assert.deepEqual(identity(packet.payload), {model:'X20',pro:false,firmware:'1.23',mode:2,verified:true,vid:'1013',pid:'2009'});
  assert.throws(() => decode(bytes('26 8c b6 8e f7 4c 7e 10 bf c1 fd df 63')), /CRC/);
});

for (const pro of [false,true]) test(`${pro ? 'X20 Pro' : 'X20'} GATT reads, writes, chunks and preserves settings`, async t => {
  const sent = [];
  const link = new KeyLinker(demoDevice({pro,onPacket: packet => sent.push(packet)}));
  t.after(() => link.disconnect());
  await link.connect();
  assert.equal(link.info.verified,true);
  assert.equal(link.slots.length,pro ? 6 : 4);
  assert.deepEqual(await link.battery(),{level:4,charging:false});
  assert.equal(sent.at(-1).op,0x1e);

  const motor = await link.read('motors');
  const updatedMotor = await link.save('motors',motor,raw => { raw[1] = 99; return raw; });
  assert.equal(updatedMotor.raw[1],99);
  assert.deepEqual(updatedMotor.raw.slice(2),motor.raw.slice(2));
  const motorFrame = sent.find(packet => packet.op === 0x33);
  assert.equal(motorFrame.serial,0x81);
  assert.equal(motorFrame.length,0xee);
  await assert.rejects(link.save('motors',motor,raw => raw),/已变化/);

  const remap = await link.read('buttons');
  const mapped = await link.save('buttons',remap,[[0,2],[1,1]]);
  assert.deepEqual(remapValues(mapped.raw,mapped.sources).slice(0,2),[2,1]);
  const cleared = await link.save('buttons',mapped,[[1,0]]);
  assert.deepEqual(remapValues(cleared.raw,cleared.sources).slice(0,2),[2,0]);
  const frames = sent.filter(packet => packet.op === 0x36).slice(0,2);
  assert.deepEqual(frames.map(packet => packet.payload.length),[15,2]);
  assert.deepEqual(frames.map(packet => [packet.serial,packet.length >>> 5]),pro ? [[0x81,1],[0x0a,2]] : [[0x02,6],[0x8b,5]]);

  const macro = await link.read('macro',3);
  const steps = [{keys:[1,2],left:8,right:0,ms:120},{keys:[],left:8,right:8,ms:50},{keys:[14],left:2,right:8,ms:250}];
  const edited = await link.save('macro',macro,steps);
  assert.equal(edited.raw[0],pro ? 3 : 17);
  assert.deepEqual(macroSteps(edited.raw,edited.layout),steps);
  const macroFrames = sent.filter(packet => packet.op === 0x35);
  assert.deepEqual(macroFrames.map(packet => packet.length >>> 5),[3,3]);
  if (pro) assert.deepEqual(macroFrames.map(packet => packet.serial),[0,0x88]);
  const limitRequests = sent.filter(packet => packet.op === 0xb0 && packet.payload[1] === 6);
  assert.deepEqual(limitRequests.slice(0,2).map(packet => [...packet.payload]),[[0,6],[1,6]]);
  if (pro) {
    const lighting = await link.read('lighting');
    const updated = await link.save('lighting',lighting,raw => { raw[6] = 1; return raw; });
    assert.equal(updated.raw[6],1);
    assert.deepEqual(updated.raw.slice(7),lighting.raw.slice(7));
    assert.deepEqual(sent.filter(packet => packet.op === 0x37).map(packet => packet.payload.length),[15,10]);
  } else assert.equal(link.supportsSetting('lighting'),false);
});

test('settings are selected by the device capabilities, independently of operating mode', async t => {
  const sent = [];
  const link = new KeyLinker(demoDevice({mode:7,lighting:false,onPacket:packet => sent.push(packet)}));
  t.after(() => link.disconnect());
  await link.connect();
  assert.equal(link.info.verified,false);
  assert.equal(link.supportsSetting('sticks'),true);
  assert.equal(link.supportsSetting('macro'),true);
  assert.equal(link.supportsSetting('lighting'),false);
  await assert.rejects(link.save('lighting',{},[]),/未开放此项写入/);
  assert.ok(sent.every(packet => packet.op >= 0x90));
});

test('X20 Pro 1.31 in mode 2 can write remaps, macros and RGB, and restore exact motor bytes', async t => {
  const sent = [];
  const link = new KeyLinker(demoDevice({firmware:0x31,mode:2,onPacket:packet => sent.push(packet)}));
  t.after(() => link.disconnect());
  await link.connect();
  assert.equal(link.info.verified,false);
  assert.equal(link.info.mode,2);
  assert.equal(link.hasWritableSettings,true);
  assert.equal(link.supportsSetting('buttons'),true);
  assert.equal(link.supportsSetting('macro'),true);
  assert.equal(link.supportsSetting('lighting'),true);
  assert.deepEqual(await link.battery(),{level:4,charging:false});
  const held = await link.read('motors');
  const {original,testLevel} = await link.testVibration();
  assert.deepEqual(original.raw,held.raw);
  assert.equal(testLevel,held.raw[1]-13);
  const writes = sent.filter(packet => packet.op === 0x33);
  assert.deepEqual(writes.map(packet => [packet.serial,packet.length >>> 5]),[[0x81,7],[0x02,6]]);
  assert.deepEqual(writes[0].payload.slice(2),held.raw.slice(2));
  assert.deepEqual(writes[1].payload,held.raw);
  assert.deepEqual((await link.read('motors')).raw,held.raw);
  const buttons = await link.read('buttons');
  const mapped = await link.save('buttons',buttons,[[0,2]]);
  assert.equal(remapValues(mapped.raw,mapped.sources)[0],2);
  const macro = await link.read('macro',4);
  const steps = [{keys:[1,2],left:8,right:8,ms:120},{keys:[],left:8,right:8,ms:50},{keys:[13],left:3,right:8,ms:100}];
  const saved = await link.save('macro',macro,steps);
  assert.equal(saved.raw[0],3);
  assert.deepEqual(macroSteps(saved.raw,saved.layout),steps);
  const lighting = await link.read('lighting');
  const illuminated = await link.save('lighting',lighting,raw => { raw[6] = 99; return raw; });
  assert.equal(illuminated.raw[6],99);
  assert.deepEqual(sent.filter(packet => packet.op === 0x37).map(packet => packet.payload.length),[15,10]);
});

test('a lost motor acknowledgement still triggers restoration if the setting changed', async t => {
  let writes = 0;
  const link = new KeyLinker(demoDevice({fault:packet => packet.op === 0x33 && ++writes === 1 ? 'drop-ack' : null}),{timeout:35});
  t.after(() => link.disconnect());
  await link.connect();
  const held = await link.read('motors');
  await assert.rejects(link.testVibration(),/等待回包超时/);
  assert.equal(writes,2);
  assert.deepEqual((await link.read('motors')).raw,held.raw);
});

test('bad CRC, wrong serial, disconnect and mismatched read-back cannot verify a write', async t => {
  for (const problem of ['crc','serial','disconnect','ignore-write']) {
    const link = new KeyLinker(demoDevice({fault: packet => packet.op === 0x33 ? problem : null}),{timeout:35});
    t.after(() => link.disconnect());
    await link.connect();
    const before = await link.read('motors');
    await assert.rejects(link.save('motors',before,raw => { raw[1] = 99; return raw; }),/写入结果待确认/);
  }
});
