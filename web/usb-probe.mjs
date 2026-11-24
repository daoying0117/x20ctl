// SPDX-License-Identifier: GPL-3.0-or-later
const gameInterfaces = [
  {vendorId: 0x045e, productId: 0x028e}, // Xbox 360-compatible XInput
  {vendorId: 0x0079, productId: 0x181c}, // Shared DInput fingerprint
  {vendorId: 0x057e, productId: 0x2009}, // Switch-compatible fingerprint
];
const receiver = {vendorId: 0x413d, productId: 0x2131};
const screen = {vendorId: 0xeeef, productId: 0x268a};
const modes = {
  cable: gameInterfaces,
  receiver: [...gameInterfaces, receiver],
};
const hex = (value, digits) => `0x${value.toString(16).padStart(digits, '0').toUpperCase()}`;
const id = (vendor, product) => `${hex(vendor, 4).slice(2)}:${hex(product, 4).slice(2)}`;

function captureHid(device) {
  function collect(collection) {
    return {
      usagePage: hex(collection.usagePage, 4), usage: hex(collection.usage, 4),
      vendorDefined: collection.usagePage >= 0xff00,
      inputReports: collection.inputReports.map(report => report.reportId),
      outputReports: collection.outputReports.map(report => report.reportId),
      featureReports: collection.featureReports.map(report => report.reportId),
      children: collection.children.map(collect),
    };
  }
  return {name: device.productName || '', usbId: id(device.vendorId, device.productId), collections: device.collections.map(collect)};
}

function captureUsb(device) {
  return {
    name: device.productName || '', usbId: id(device.vendorId, device.productId),
    configurations: device.configurations.map(configuration => ({
      value: configuration.configurationValue,
      interfaces: configuration.interfaces.map(entry => ({
        number: entry.interfaceNumber,
        alternates: entry.alternates.map(alternate => ({
          number: alternate.alternateSetting,
          interfaceClass: hex(alternate.interfaceClass, 2),
          interfaceSubclass: hex(alternate.interfaceSubclass, 2),
          interfaceProtocol: hex(alternate.interfaceProtocol, 2),
          endpoints: alternate.endpoints.map(endpoint => ({
            number: endpoint.endpointNumber, direction: endpoint.direction,
            type: endpoint.type, packetSize: endpoint.packetSize,
          })),
        })),
      })),
    })),
  };
}

export async function probeTransport(browser, api, mode) {
  if (!Object.hasOwn(modes, mode)) throw new TypeError('请先选择实际连接方式');
  if (api === 'hid' && browser.hid) {
    const devices = await browser.hid.requestDevice({filters: modes[mode]});
    return devices.map(captureHid);
  }
  if (api === 'usb' && browser.usb) {
    const filters = mode === 'cable' ? [...modes[mode], screen] : modes[mode];
    return [captureUsb(await browser.usb.requestDevice({filters}))];
  }
  if (api === 'serial' && browser.serial && mode === 'cable') {
    const port = await browser.serial.requestPort({filters: [{usbVendorId: screen.vendorId, usbProductId: screen.productId}]});
    const {usbVendorId, usbProductId} = port.getInfo();
    if (usbVendorId !== screen.vendorId || usbProductId !== screen.productId) throw new Error('所选串口与已记录的小屏 USB ID 不符');
    return [{usbId: id(usbVendorId, usbProductId), purpose: 'X20 Pro 小屏串口候选'}];
  }
  throw new Error('此浏览器或连接方式不提供该探测接口');
}

export function hidSummary(device) {
  let collections = 0;
  let featureReports = 0;
  const vendorPages = new Set();
  function count(collection) {
    collections++;
    featureReports += collection.featureReports.length;
    if (collection.vendorDefined) vendorPages.add(collection.usagePage);
    collection.children.forEach(count);
  }
  device.collections.forEach(count);
  return {collections, featureReports, vendorPages: [...vendorPages].sort()};
}
