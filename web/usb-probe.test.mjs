// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {probeTransport, hidSummary} from './usb-probe.mjs';

const receiver = {vendorId: 0x413d, productId: 0x2131};
const screen = {vendorId: 0xeeef, productId: 0x268a};
const neverOpen = () => assert.fail('Descriptor discovery must not open a device or exchange reports');

test('receiver scan reports vendor collections but only requests known device IDs', async () => {
  const vendor = {usagePage:0xff70, usage:1, inputReports:[{reportId:2}], outputReports:[], featureReports:[], children:[]};
  const pad = {usagePage:1, usage:5, inputReports:[{reportId:0}], outputReports:[], featureReports:[{reportId:8}], children:[vendor]};
  const browser = {hid: {async requestDevice({filters}) {
    assert.ok(filters.some(item => item.vendorId === receiver.vendorId && item.productId === receiver.productId));
    assert.ok(filters.every(item => item.vendorId && item.productId));
    return [{...receiver, productName:'Receiver', collections:[pad], open:neverOpen, receiveFeatureReport:neverOpen}];
  }}};
  const [device] = await probeTransport(browser,'hid','receiver');
  assert.equal(device.usbId,'413D:2131');
  assert.deepEqual(hidSummary(device),{collections:2, featureReports:1, vendorPages:['0xFF70']});
});

test('USB descriptors are captured without claiming the device or its interfaces', async () => {
  const usb = {vendorId:0x045e, productId:0x028e, configurations:[{configurationValue:1, interfaces:[{
    interfaceNumber:0, alternates:[{alternateSetting:0, interfaceClass:255, interfaceSubclass:93, interfaceProtocol:1,
      endpoints:[{endpointNumber:1, direction:'in', type:'interrupt', packetSize:32}]}],
  }]}], open:neverOpen, claimInterface:neverOpen};
  const [device] = await probeTransport({usb:{async requestDevice({filters}) {
    assert.ok(filters.some(item => item.vendorId === screen.vendorId && item.productId === screen.productId));
    assert.ok(!filters.some(item => item.vendorId === receiver.vendorId));
    return usb;
  }}},'usb','cable');
  assert.equal(device.usbId,'045E:028E');
  const [alternate] = device.configurations[0].interfaces[0].alternates;
  assert.equal(alternate.interfaceClass,'0xFF');
  assert.equal(alternate.endpoints[0].type,'interrupt');
});

test('wired screen discovery matches the known USB serial ID without opening the port', async () => {
  const browser = {serial:{async requestPort({filters}) {
    assert.deepEqual(filters,[{usbVendorId:screen.vendorId, usbProductId:screen.productId}]);
    return {getInfo:() => ({usbVendorId:screen.vendorId, usbProductId:screen.productId}), open:neverOpen};
  }}};
  assert.equal((await probeTransport(browser,'serial','cable'))[0].usbId,'EEEF:268A');
  await assert.rejects(probeTransport(browser,'serial','receiver'),/不提供/);
  await assert.rejects(probeTransport({serial:{requestPort:async () => ({getInfo:() => ({})})}},'serial','cable'),/不符/);
});
