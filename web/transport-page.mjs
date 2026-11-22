// SPDX-License-Identifier: GPL-3.0-or-later
import {probeTransport, hidSummary} from './usb-probe.mjs';

const connection = document.querySelector('#connection');
const status = document.querySelector('#notice');
const report = document.querySelector('#report');
const summary = document.querySelector('#summary');
const copy = document.querySelector('#copy');
const controls = [...document.querySelectorAll('[data-probe]')];
const labels = {hid: 'WebHID', usb: 'WebUSB', serial: 'Web Serial'};
const links = {cable: 'USB 有线', receiver: '2.4 GHz 接收器'};
const entries = new Map();
let working = false;

function message(text, error = false) {
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('error', error);
}

function updateControls() {
  const cable = connection.value === 'cable';
  connection.disabled = working;
  for (const button of controls) {
    const api = button.dataset.probe;
    button.hidden = api === 'serial' && !cable;
    button.disabled = working || !globalThis.isSecureContext || !navigator[api];
  }
  document.querySelector('#connection-help').textContent = cable
    ? '拔下 2.4 GHz 接收器，用数据线直连手柄。检查 X20 Pro 小屏串口时，按住 M 键插入数据线。'
    : '拔掉手柄数据线，接入接收器，并让手柄通过 2.4 GHz 联机。X20 的有线和接收器可能显示相同的 ID。';
  document.querySelector('#capabilities').textContent = Object.entries(labels).map(([api, label]) =>
    `${label} ${globalThis.isSecureContext && navigator[api] ? '可用' : '不可用'}`).join(' · ');
}

function updateReport() {
  const captures = [...entries.values()];
  const rows = document.createElement('dl');
  rows.className = 'device-data';
  for (const {mode, api, devices} of captures) {
    for (const device of devices) {
      const row = document.createElement('div');
      const key = document.createElement('dt');
      const value = document.createElement('dd');
      key.textContent = `${links[mode]} · ${labels[api]}`;
      const identities = [device.name, device.usbId].filter(Boolean).join(' · ');
      if (api === 'hid') {
        const {collections, featureReports, vendorPages} = hidSummary(device);
        value.textContent = `${identities} · ${collections} 个集合 · ${featureReports} 个 Feature Report · ${vendorPages.length ? vendorPages.join(' / ') : '未显示厂商集合'}`;
      } else value.textContent = `${identities} · ${api === 'usb' ? `${device.configurations.length} 个 USB 配置` : device.purpose}`;
      row.append(key, value);
      rows.append(row);
    }
  }
  summary.replaceChildren(rows);
  report.textContent = JSON.stringify(captures, null, 2);
  document.querySelector('#raw').hidden = false;
  copy.disabled = !navigator.clipboard;
}

async function inspect(api) {
  if (working) return;
  const mode = connection.value;
  const request = probeTransport(navigator, api, mode);
  working = true;
  message('请在浏览器弹窗中选择手柄、接收器或对应串口。');
  updateControls();
  try {
    const devices = await request;
    if (!devices.length) message('本次没有选中设备。');
    else {
      entries.set(`${mode}:${api}`, {mode, api, devices});
      updateReport();
      message('已获取描述信息。两种连接方式的结果会分别保留。');
    }
  } catch (error) {
    if (error.name === 'NotFoundError') message('本次没有选中设备。');
    else if (error.name === 'SecurityError') message('浏览器限制了设备访问。请在 Chrome 或 Edge 的独立标签页打开本机地址。', true);
    else message(`接口检查失败。${error.message}`, true);
  } finally {
    working = false;
    updateControls();
  }
}

connection.addEventListener('change', updateControls);
for (const button of controls) button.addEventListener('click', () => { void inspect(button.dataset.probe); });
copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(report.textContent); message('已复制探测报告。'); }
  catch { message('复制失败，可展开描述符明细后手动复制。', true); }
});
updateControls();
