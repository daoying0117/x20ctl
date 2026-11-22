// SPDX-License-Identifier: GPL-3.0-or-later
import {KeyLinker, chooseDevice} from './device.mjs';
import {defaultSources, remapValues, macroSteps, pause, slotNames} from './protocol.mjs';

const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  buttons: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 8v5m-2.5-2.5h5M16 8h.01M18 11h.01M14 11h.01M16 14h.01"/>',
  sticks: '<path d="M3 19h18M5 16c5 0 7-9 14-9"/><circle cx="5" cy="16" r="1.7"/><circle cx="19" cy="7" r="1.7"/>',
  triggers: '<path d="M4 6h16v5c0 3-3 6-6 6H8c-2 0-4-2-4-4zM8 10h8"/>',
  motors: '<path d="M3 10v4m3-7v10m4-12v14m4-12v10m4-8v6m3-5v4"/>',
  lighting: '<path d="M9 18h6m-5 3h4m-6-6c0-2-2.5-3-2.5-6a6.5 6.5 0 0 1 13 0c0 3-2.5 4-2.5 6"/>',
  tester: '<path d="M7 7h10a3 3 0 0 1 3 2.4l1.2 5.2a2.6 2.6 0 0 1-4.4 2.4L15 15H9l-1.8 2a2.6 2.6 0 0 1-4.4-2.4L4 9.4A3 3 0 0 1 7 7Z"/><path d="M7 10v4m-2-2h4m6-1h.01m3 2h.01"/>',
  diagnostics: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  bluetooth: '<path d="m12 3 5 5-10 8m5 5 5-5L7 8m5-5v18"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const pages = {
  overview: ['设备概览', '连接手柄，开始配置或测试输入。'],
  buttons: ['按键与背键', '从手柄图选键，再设置按键输出或背键动作。'],
  sticks: ['摇杆曲线', '分别调整左右摇杆的死区和响应曲线。'],
  triggers: ['扳机曲线', '分别调整 LT 和 RT 的死区和响应曲线。'],
  motors: ['振动与电源', '设置振动强度和闲置自动关机。'],
  lighting: ['RGB 灯效', '设置灯效模式、颜色和亮度。'],
  tester: ['输入测试', '查看按键、扳机和摇杆的实时输入。'],
  diagnostics: ['连接诊断', '查看设备身份、蓝牙状态与最近的 KeyLinker 报文。'],
  license: ['开源许可', '查看网页改版和上游项目的授权。'],
};
const padKeys = {1:'A',2:'B',3:'X',4:'Y',5:'LB',6:'RB',7:'LT',8:'RT',9:'选择键',10:'开始键',
  11:'L3 · 左摇杆按下',12:'R3 · 右摇杆按下',13:'方向键 ↓',14:'方向键 ↑',15:'方向键 →',16:'方向键 ←',
  17:'主页键',93:'选择键（View）',94:'开始键（Menu）',95:'截图键',96:'连发键'};
const keyLabel = code => padKeys[code] ?? `按键 ${code}`;
const main = document.querySelector('main');
const models = {'X20':'x20', 'X20 Pro':'x20_pro'};
const controllerImage = (model, view) => `../src/assets/controllers/${models[model]}/native/${view}-full.png`;
// Centers on the original 1536 × 1024 art, from control-shapes, native-layers and X20 rear-geometry.
const controlCenters = {
  X20: {
    front: {1:[1108,401],2:[1198,315],3:[1021,313],4:[1114,223],11:[401,308],12:[933,511],
      13:[580,578],14:[580,473],15:[633,525],16:[528,525],93:[548,184],94:[988,184]},
    rear: {0:[468,578],1:[1062,578],2:[614,548],3:[913,550]},
  },
  'X20 Pro': {
    front: {1:[1107,387],2:[1192,317],3:[1020,311],4:[1108,232],11:[433,310],12:[942,486],
      13:[597,534],14:[597,427],15:[651,480],16:[544,480],93:[672,303],94:[864,302]},
    rear: {0:[474,623],1:[1062,623],2:[631,561],3:[905,561],4:[962,177],5:[575,177]},
  },
};
const shortKeys = {11:'L3',12:'R3',13:'↓',14:'↑',15:'→',16:'←',93:'View',94:'Menu'};
const shortKey = code => shortKeys[code] ?? keyLabel(code);
const button = (action, label, {primary = false, disabled = false, compact = false, glyph = ''} = {}) =>
  `<button type="button" class="btn ${primary ? 'primary' : ''} ${compact ? 'compact' : ''}" data-action="${action}" ${disabled ? 'disabled' : ''}>${glyph ? icon(glyph) : ''}${label}</button>`;
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const options = (list, selected) => list.map(([value, label]) => `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`).join('');
const defaults = {linear:[85,85,170,170], quick:[64,102,166,217], slow:[89,51,191,140], smooth:[77,59,178,196], fine:[77,89,178,196]};
const settingPages = ['buttons','sticks','triggers','motors','lighting'];

let page = 'overview';
let session = null;
let work = '';
let queuedRead = false;
let demo = false;
let battery = null;
let preview = 'X20 Pro';
let side = 'front';
let mapSide = 'front';
let selectedKey = 1;
let slot = 0;
let testerRun;
let rememberedDevice;
let noticeTimer;
const cache = new Map();
const logs = [];

function message(content = '', error = false) {
  const box = document.querySelector('#notice');
  clearTimeout(noticeTimer);
  document.querySelector('#notice-text').textContent = content;
  box.hidden = !content;
  box.classList.toggle('error', error);
  if (content && !error) noticeTimer = setTimeout(() => message(), 5000);
}

function log(content) {
  logs.push(`${new Date().toLocaleTimeString('zh-CN', {hour12:false})}  ${content}`);
  if (logs.length > 100) logs.shift();
  const element = document.querySelector('#log');
  if (element) element.textContent = logs.join('\n');
}

function navigation() {
  const link = key => `<a class="nav-link" href="#${key}" ${key === page ? 'aria-current="page"' : ''}>${icon(key === 'license' ? 'diagnostics' : key)}${pages[key][0]}</a>`;
  document.querySelector('#nav').innerHTML = `${link('overview')}<div class="nav-label">配置手柄</div>${settingPages.map(link).join('')}
    <div class="nav-label">工具</div>${link('tester')}${link('diagnostics')}${link('license')}`;
  document.querySelector('#page-select').innerHTML = options(['overview',...settingPages,'tester','diagnostics','license'].map(key => [key,pages[key][0]]),page);
}

function connectionActions() {
  return rememberedDevice ? `${button('reconnect','重新连接',{primary:true,disabled:!!work,glyph:'bluetooth'})}${button('connect','选择设备',{disabled:!!work})}` :
    button('connect','连接手柄',{primary:true,disabled:!!work,glyph:'bluetooth'});
}

function header() {
  if (page === 'tester' || page === 'license') return '';
  const status = work || (demo ? '演示模式' : session ? '配置蓝牙已连接' : '配置蓝牙未连接');
  return `<span class="state ${session && !work ? 'active' : ''}">${status}</span>${
    session ? button('disconnect', demo ? '退出演示' : '断开', {compact:true, disabled:!!work}) : page === 'overview' ? '' : connectionActions()}`;
}

function pendingDrafts() {
  return [...cache].filter(([,entry]) => entry.dirty).map(([key]) => {
    if (key.startsWith('macro:')) {
      const name = slotNames[Number(key.slice(6))];
      return [ `macro/${name}`, `${name} 背键宏` ];
    }
    return [key === 'buttons' ? 'buttons/front' : key, pages[key][0]];
  });
}

function preventDraftLoss(event) {
  event.preventDefault();
  event.returnValue = true;
}

function refreshDraftMenu() {
  const drafts = pendingDrafts();
  const host = document.querySelector('#draft-menu');
  const signature = JSON.stringify(drafts);
  if (host.dataset.entries !== signature) {
    const open = host.querySelector('details')?.open;
    host.dataset.entries = signature;
    host.innerHTML = drafts.length ? `<details ${open ? 'open' : ''}><summary><span>待写入</span><strong>${drafts.length}</strong></summary>
      <ul>${drafts.map(([route,title]) => `<li><a href="#${route}" data-draft-link>${escape(title)}</a></li>`).join('')}</ul></details>` : '';
  }
  if (drafts.length) window.addEventListener('beforeunload',preventDraftLoss);
  else window.removeEventListener('beforeunload',preventDraftLoss);
}

function overview() {
  const info = session?.info;
  const model = info?.model || preview;
  const rows = info ? [['固件版本',info.firmware],['工作模式',info.mode ?? '未知'],
    ['电量',battery ? `${battery.level}/4 档${battery.charging ? ' · 充电中' : ''}` : '待读取']] : [];
  const selectedImage = controllerImage(model, side);
  return `<div class="dashboard">
    <section class="panel hero" aria-label="手柄外观">
      <div class="hero-top"><div><small>${info?.model ? '当前设备' : '外观预览'}</small><strong>EasySMX ${model}</strong></div>
      ${info?.model ? '' : `<label class="hero-model"><span class="visually-hidden">预览型号</span><select data-field="preview">${options(Object.keys(models).map(name => [name, name]), preview)}</select></label>`}</div>
      <img class="pad-image" src="${selectedImage}" alt="EasySMX ${model} 手柄${side === 'front' ? '正面' : '背面'}">
      <div class="hero-bottom"><div class="segmented" aria-label="选择视图">
        <button type="button" data-action="front" aria-pressed="${side === 'front'}">正面</button>
        <button type="button" data-action="rear" aria-pressed="${side === 'rear'}">背面</button>
      </div></div>
    </section>
    <section class="panel device-card ${session ? '' : 'device-card-offline'}"><div class="card-top"><span class="icon-tile">${icon('bluetooth')}</span><h2>${session ? '设备信息' : '蓝牙配置'}</h2></div>
      ${session ? `<dl class="device-data">${rows.map(([label,value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        <p>${demo ? '演示设置只在当前会话有效。' : session.hasWritableSettings ? '进入设置页即可读取，修改后手动写入。' : '已读取设备身份。当前设备未提供可写设置。'}</p>` :
        '<p class="connect-copy">打开手柄和电脑蓝牙，在设备列表里选择手柄。</p>'}
      <div class="device-actions">${session ? button('battery','读取电量',{disabled:!!work || !info?.model}) :
        `${connectionActions()}${button('demo','体验演示',{disabled:!!work})}`}</div>
      ${session ? '' : '<a class="text-link device-help" href="#diagnostics">找不到设备？</a>'}
    </section>
  </div><div class="section-title"><h2>常用操作</h2></div>
  <div class="shortcuts">${['buttons','sticks','tester','triggers','motors','lighting'].map((key, i) => `<a class="panel shortcut" href="#${key}">
    <span class="icon-tile">${icon(key)}</span><div><h3>${pages[key][0]}</h3><p>${['改键和编排背键动作','调整死区与响应曲线','查看按键与摇杆输入','调整 LT / RT 响应','调节振动与关机时间','调整颜色与亮度'][i]}</p></div></a>`).join('')}</div>`;
}

function activeSection() { return page === 'buttons' && mapSide === 'rear' ? 'macro' : page; }
function cacheKey(section = activeSection(), selectedSlot = slot) { return section === 'macro' ? `macro:${selectedSlot}` : section; }
const field = (label, input) => `<label class="field"><span>${label}</span>${input}</label>`;
const numeric = (name, value, min, max, step = 1) => `<input type="number" data-edit="${name}" value="${escape(value)}" min="${min}" max="${max}" step="${step}" required>`;
const range = (name, value) => `<span class="range-row"><input type="range" data-edit="${name}" value="${value}" min="0" max="100"><output>${value}%</output></span>`;
const check = (label, name, value) => `<label class="switch"><input type="checkbox" data-edit="${name}" ${value ? 'checked' : ''}>${label}</label>`;

function draftFor(section, record) {
  const {raw} = record;
  if (section === 'buttons') return remapValues(raw, record.sources);
  if (section === 'macro') return macroSteps(raw, record.layout);
  if (section === 'lighting') return {color:`#${[...raw.slice(1,4)].map(v => v.toString(16).padStart(2,'0')).join('')}`, mode:raw[7], brightness:Math.round(raw[6]*100/255)};
  if (section === 'motors') {
    const out = {};
    for (let i = 0; i < Math.min(4, raw.length - 1); i++) out[`motor${i}`] = Math.round(raw[1+i]*100/255);
    if (raw.length >= 9) {
      const ticks = new DataView(raw.buffer, raw.byteOffset).getUint32(5, true);
      out.shutdown = ticks === 0xffffffff ? 'off' : String(Math.floor(ticks / 12000));
    }
    return out;
  }
  const scale = section === 'triggers' ? 2 : 1;
  const channels = {};
  for (let i = 0; i < (raw.length - 1)/7; i++) {
    const at = 1+i*7;
    channels[i] = {inner:raw[at]/scale, outer:raw[at+1]/scale, x1:raw[at+2], y1:raw[at+3], x2:raw[at+4], y2:raw[at+5],
      invertX:!!(raw[at+6]&1), invertY:!!(raw[at+6]&2), swap:!!(raw[at+6]&4)};
  }
  return channels;
}

function graph(channel) {
  const x = raw => 15 + raw * 270 / 255;
  const y = raw => 126 - raw * 112 / 255;
  return `<svg class="curve" viewBox="0 0 300 140" role="img" aria-label="输入行程与输出响应曲线示意">
    <path class="curve-grid" d="M15 14v112h270M15 70h270M150 14v112" fill="none"/>
    <path class="curve-base" d="M15 126 285 14"/><path class="curve-line" d="M15 126 ${x(channel.x1)} ${y(channel.y1)} ${x(channel.x2)} ${y(channel.y2)} 285 14"/>
    <circle class="curve-dot" cx="${x(channel.x1)}" cy="${y(channel.y1)}" r="3.5"/><circle class="curve-dot" cx="${x(channel.x2)}" cy="${y(channel.y2)}" r="3.5"/>
  </svg>`;
}

function curves(draft, trigger) {
  return `<div class="form-grid">${Object.entries(draft).map(([i, channel]) => {
    const prefix = i === '0' ? '左' : '右';
    const matched = Object.entries(defaults).find(([,values]) => values.every((v,j) => v === [channel.x1,channel.y1,channel.x2,channel.y2][j]));
    return `<section class="subpanel"><h3>${prefix}${trigger ? '扳机' : '摇杆'}</h3><div data-curve="${i}">${graph(channel)}</div>
      ${field('曲线预设', `<select data-preset="${i}">${options([['custom','自定义'],['linear','线性'],['quick','灵敏'],['slow','缓升'],['smooth','平滑'],['fine','微调']], matched?.[0] ?? 'custom')}</select>`)}
      <div class="form-grid curve-controls">${field('内死区（%）', numeric(`${i}.inner`, channel.inner, 0, 100, trigger ? .5 : 1))}${field('外死区（%）', numeric(`${i}.outer`, channel.outer, 0, 100, trigger ? .5 : 1))}</div>
      <details class="curve-advanced"><summary>${trigger ? '自定义控制点' : '自定义控制点与轴设置'}</summary>
        <div class="form-grid curve-controls">${['x1','y1','x2','y2'].map((key, j) => field(`控制点 ${j < 2 ? '1' : '2'} ${j % 2 === 0 ? '输入' : '输出'}`, numeric(`${i}.${key}`, channel[key], 0, 255))).join('')}</div>
        ${trigger ? '' : `<div class="curve-switches">${check('反转 X 轴',`${i}.invertX`,channel.invertX)}${check('反转 Y 轴',`${i}.invertY`,channel.invertY)}${check('交换 X / Y 轴',`${i}.swap`,channel.swap)}</div>`}</details></section>`;
  }).join('')}</div>`;
}

const dirs = [[8,'回中'],[0,'上'],[1,'右上'],[2,'右'],[3,'右下'],[4,'下'],[5,'左下'],[6,'左'],[7,'左上']];
function stepLabel(step) {
  const name = direction => dirs.find(([code]) => code === direction)?.[1] ?? `方向码 ${direction}`;
  const inputs = step.keys.map(shortKey);
  if (step.left !== 8) inputs.push(`左摇杆 ${name(step.left)}`);
  if (step.right !== 8) inputs.push(`右摇杆 ${name(step.right)}`);
  return inputs.join(' + ') || '停顿';
}

function macroEditor(entry) {
  const {draft, record} = entry;
  return `<div class="macro-toolbar"><div class="action-group">${button('add-step','添加动作',{disabled:draft.length>=record.limit})}${button('add-pause','添加停顿',{disabled:draft.length>=record.limit})}</div><span class="muted">${draft.length} / ${record.limit} 步</span></div>
    ${draft.length ? `<ol class="macro-list">${draft.map((step, i) => {
      const expanded = entry.step === i;
      const orderButton = (direction, label, disabled) => `<button type="button" class="mini" data-move="${i}" data-direction="${direction}" ${disabled ? 'disabled' : ''} aria-label="${label}第 ${i+1} 步">${label}</button>`;
      return `<li class="macro-card"><div class="macro-row">
        <button type="button" class="macro-summary" data-step="${i}" aria-expanded="${expanded}" ${expanded ? `aria-controls="step-${i}"` : ''}>
          <span class="step-no">${i+1}</span><strong data-step-label="${i}">${escape(stepLabel(step))}</strong><span data-step-time="${i}">${Number.isFinite(step.ms) ? `${step.ms} 毫秒` : '待填写'}</span>
        </button>
        <div class="action-group macro-order">${orderButton(-1,'上移',i === 0)}${orderButton(1,'下移',i === draft.length - 1)}<button type="button" class="mini" data-remove="${i}" aria-label="移除第 ${i+1} 步">移除</button></div>
      </div>${expanded ? `<div class="macro-detail" id="step-${i}">
        <div class="field"><span>同一步按下的按键</span><div class="mapping-options">${[...record.layout.digital.keys()].map(key => `<button type="button" class="mapping-option" data-step-key="${key}" aria-label="切换 ${escape(keyLabel(key))}" aria-pressed="${step.keys.includes(key)}">${escape(shortKey(key))}</button>`).join('')}</div></div>
        <div class="macro-fields">${field('时长（毫秒）', `<input type="number" data-macro="${i}.ms" value="${Number.isFinite(step.ms) ? step.ms : ''}" step="5" min="0" max="327675" required>`)}${['left','right'].map((key,j) => field(j ? '右摇杆' : '左摇杆', `<select data-macro="${i}.${key}" ${record.layout.analog.has(j ? 19 : 18) ? '' : 'disabled'}>${options(step[key] > 8 ? [...dirs,[step[key],`方向码 ${step[key]}`]] : dirs, step[key])}</select>`)).join('')}</div>
      </div>` : ''}</li>`;
    }).join('')}</ol>` : '<p class="mapping-empty">这个背键还没有动作。添加一个按键动作或一段停顿。</p>'}`;
}

function frontKeyEditor(entry) {
  const {draft, record} = entry;
  const index = record.sources.indexOf(selectedKey);
  if (index < 0) return '<p class="mapping-empty">请选择一个手柄按键。</p>';
  const key = record.sources[index];
  const target = draft[index];
  const targets = [[0,'保持原功能'], ...record.sources.filter(code => code !== key).map(code => [code,shortKey(code)])];
  if (target && !targets.some(([code]) => code === target)) targets.push([target, shortKey(target)]);
  const targetOnly = !session.info.pro && [93,94].includes(key);
  return `<div class="mapping-flow"><div><span>按下</span><strong>${escape(shortKey(key))}</strong></div><span aria-hidden="true">→</span><div><span>输出</span><strong>${escape(shortKey(target || key))}</strong></div></div>
    ${targetOnly ? '<p class="help">此型号的选择键和开始键可用作其他按键的输出。</p>' : `<div class="field"><span>选择输出按键</span><div class="mapping-options">${targets.map(([code,label]) => `<button type="button" class="mapping-option${code === 0 ? ' default-option' : ''}" data-map-target="${code}" aria-label="${code === 0 ? '保持原功能' : `输出 ${escape(keyLabel(code))}`}" aria-pressed="${code === target}">${escape(label)}</button>`).join('')}</div></div>`}`;
}

function editorFields(section, entry) {
  const {draft} = entry;
  if (section === 'buttons') return frontKeyEditor(entry);
  if (section === 'sticks' || section === 'triggers') return curves(draft,section === 'triggers');
  if (section === 'macro') return macroEditor(entry);
  if (section === 'lighting') {
    const modes = [[0,'关闭'],[1,'彩虹'],[2,'常亮'],[3,'呼吸'],[4,'色彩循环']];
    if (!modes.some(([mode]) => mode === draft.mode)) modes.push([draft.mode, `设备模式 ${draft.mode}`]);
    return `<div class="form-grid">${field('灯效模式',`<select data-edit="mode">${options(modes,draft.mode)}</select>`)}
      ${field('主灯颜色',`<input class="swatch" type="color" data-edit="color" value="${draft.color}">`)}${field('亮度',range('brightness',draft.brightness))}</div>`;
  }
  const labels = ['左握把','右握把','左扳机','右扳机'];
  const mask = session.caps[2];
  const levels = labels.map((label,i) => (mask & (1 << i)) && `motor${i}` in draft ? field(`${label}振动`,range(`motor${i}`,draft[`motor${i}`])) : '').join('');
  const times = [['off','从不关机'], ...Array.from({length:30},(_,i) => [String(i+1),`${i+1} 分钟`])];
  if ('shutdown' in draft && !times.some(([value]) => value === draft.shutdown)) times.push([draft.shutdown, `设备当前值（${draft.shutdown} 分钟）`]);
  return `<div class="form-grid">${levels}${'shutdown' in draft ? field('闲置自动关机',`<select data-edit="shutdown">${options(times,draft.shutdown)}</select>`) : ''}</div>`;
}

function pendingMappingCount() {
  const buttons = cache.get('buttons');
  const baseline = buttons && draftFor('buttons', buttons.record);
  const keyCount = buttons?.draft.filter((target,i) => target !== baseline[i]).length ?? 0;
  return keyCount + [...cache].filter(([key,entry]) => key.startsWith('macro:') && entry.dirty).length;
}

function mappingWorkspace() {
  const model = session?.info.model || preview;
  const rear = mapSide === 'rear';
  const record = cache.get('buttons');
  const keys = rear ? session?.slots ?? (model === 'X20' ? [0,1,2,3] : [0,1,2,3,4,5]) :
    record?.record.sources ?? defaultSources;
  const centers = controlCenters[model][mapSide];
  const picked = rear ? slot : selectedKey;
  const base = record && draftFor('buttons', record.record);
  const items = keys.map((key, i) => {
    const saved = rear ? cache.get(cacheKey('macro',key)) : null;
    return {
      key, label:rear ? slotNames[key] : keyLabel(key),
      face:rear ? slotNames[key] : shortKey(key),
      center:centers[key],
      target:!rear && record?.draft[i],
      dirty:rear ? saved?.dirty : !!record && record.draft[i] !== base[i],
      configured:rear && !!saved?.draft.length,
    };
  });
  const count = pendingMappingCount();
  return `<div class="mapping-workspace">
    <section class="panel mapping-device" aria-label="选择要配置的按键">
      <div class="mapping-device-heading"><strong>EasySMX ${model}</strong><span id="mapping-drafts" class="mapping-drafts" ${count ? '' : 'hidden'}>${count} 处未写入</span></div>
      <div class="segmented mapping-switch" aria-label="切换手柄视图">
        <button type="button" data-map-side="front" aria-pressed="${!rear}" ${work ? 'disabled' : ''}>正面按键</button>
        <button type="button" data-map-side="rear" aria-pressed="${rear}" ${work ? 'disabled' : ''}>背键宏</button>
      </div>
      <div class="mapping-photo">
        <img src="${controllerImage(model,mapSide)}" width="1536" height="1024" alt="EasySMX ${model} 手柄${rear ? '背面' : '正面'}">
        ${items.filter(item => item.center).map(({key,label,face,center:[x,y]}) => `<button type="button" class="mapping-hotspot ${!rear && key >= 13 && key <= 16 ? 'direction' : ''}" data-map-key="${key}" data-map-hotspot style="--x:${x/15.36}%;--y:${y/10.24}%" tabindex="-1" aria-label="在手柄图上选择 ${escape(label)}" aria-pressed="${picked === key}" ${work ? 'disabled' : ''}>${escape(rear ? face : face === 'View' ? '▣' : face === 'Menu' ? '☰' : face)}</button>`).join('')}
      </div>
      <div class="mapping-inputs ${rear ? 'paddle-inputs' : ''}" aria-label="${rear ? '背键列表' : '按键列表'}">
        ${items.map(({key,label,face,target,dirty,configured}) => `<button type="button" class="mapping-input ${dirty ? 'pending' : ''}" data-map-key="${key}" aria-label="选择 ${escape(label)}" aria-pressed="${key === picked}" ${work ? 'disabled' : ''}><span>${escape(face)}</span>${rear ? dirty ? '<small>未写入</small>' : configured ? '<small>已配置</small>' : '' : target || dirty ? `<small>→ ${escape(shortKey(target || key))}</small>` : ''}</button>`).join('')}
      </div>
    </section>
    ${editor(activeSection())}
  </div>`;
}

function editor(section = page) {
  const mapping = section === 'buttons' || section === 'macro';
  const title = section === 'buttons' ? `${escape(shortKey(selectedKey))} · 按键映射` : section === 'macro' ? `${slotNames[slot]} · 背键宏` : '板载设置';
  const slots = session?.slots;
  const supported = session?.supportsSetting(section) && (section !== 'macro' || slots.length > 0);
  const entry = cache.get(cacheKey(section));
  const saveLabel = section === 'buttons' ? '写入按键映射' : section === 'macro' ? `写入 ${slotNames[slot]} 宏` : '写入手柄';
  const revertLabel = section === 'buttons' ? '撤销映射更改' : section === 'macro' ? `撤销 ${slotNames[slot]} 更改` : '撤销当前更改';
  return `<section class="panel edit-panel ${mapping ? 'mapping-editor' : ''}">
    <div class="editor-bar"><h2>${title}</h2>${supported ? button('read',entry ? '重新读取' : '读取手柄设置',{disabled:!!work,primary:!entry}) : ''}</div>
    ${!session ? '<p class="mapping-empty">连接手柄后，这里会自动读取设置。</p>' :
      !supported ? '<p class="mapping-empty">当前手柄未报告此项设置。</p><a class="text-link" href="#diagnostics">查看设备诊断</a>' :
      entry ? `<form id="editor-form"><fieldset ${work ? 'disabled' : ''} style="border:0;margin:0;padding:0;min-width:0">${editorFields(section,entry)}</fieldset></form>
      <div class="editor-actions"><span class="muted" id="draft-state">${entry.dirty ? '有未写入的更改' : '已读取手柄设置'}</span>
      <div class="action-group">${section === 'motors' && (session.caps[2] & 1) ? button('test-vibration','试写振动并恢复',{disabled:!!work}) : ''}${button('revert',revertLabel,{disabled:!!work || !entry.dirty})}${button('save',saveLabel,{primary:true,disabled:!!work || !entry.dirty})}</div></div>` :
      `<p class="mapping-empty">${work || '读取手柄当前值后即可编辑。'}</p>`}
  </section>`;
}

function diagnostics() {
  const info = session?.info;
  const facts = [['网页蓝牙', !globalThis.isSecureContext ? '需要 HTTPS 或本机地址' : navigator.bluetooth ? '浏览器已提供 Web Bluetooth' : '当前浏览器暂不可用'],
    ['设备身份',info ? `${info.vid}:${info.pid} · ${info.firmware} · 模式 ${info.mode ?? '未知'}` : '等待连接'],
    ['板载写入', info?.verified ? '已匹配验证机型，具体项目由设备能力决定' :
      session?.hasWritableSettings ? '设备开放的设置可试写并读回' : info ? '当前设备未开放可写设置' : '等待连接']];
  return `<section class="panel edit-panel"><div class="editor-bar"><h2>设备与浏览器</h2>${session ? '' : button('connect-all','扩大蓝牙搜索',{disabled:!!work})}</div>
    <dl class="device-data">${facts.map(([key,value]) => `<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <p class="help">搜不到手柄时，先退出手机上的 KeyLinker 或其他配置工具，再让手柄保持开机。扩大搜索会同时显示附近其他低功耗蓝牙设备。</p></section>
    <section class="panel edit-panel" style="margin-top:14px"><div class="editor-bar"><h2>KeyLinker 报文</h2>${button('copy-log','复制日志',{disabled:!logs.length})}</div>
    <pre class="log" id="log">${escape(logs.join('\n') || '暂无报文。连接手柄后可查看收发记录。')}</pre></section>`;
}

function tester() {
  return `<section class="panel edit-panel"><div class="editor-bar"><h2>实时输入</h2>${button('test',testerRun?'暂停测试':'开始测试',{primary:!testerRun})}</div>
    <p id="input-status" class="muted" role="status">${testerRun ? '正在检测手柄…' : '测试已暂停。'}</p>
    <div id="gamepads" class="help"></div></section>`;
}

function licensePanel() {
  const upstream = 'https://github.com/AmjadAAYD/x20ctl/blob/9d64ed1c039964b3e805b9ffbb42d9762995c02e';
  return `<section class="panel edit-panel">
    <div class="editor-bar"><h2>GPL-3.0-or-later</h2></div>
    <p>原项目版权 © 2026 Amjad AAYD。此网页版本基于 X20CTL 修改，修改日期为 2026-11-22。</p>
    <p class="help">你可按 GPL 第 3 版或任何后续版本的条款复制、修改和再分发。软件按现状提供，详见许可证。</p>
    <div class="action-group help"><a class="text-link" href="${upstream}/LICENSE">许可证全文</a><a class="text-link" href="${upstream}/NOTICE">原作者声明</a><a class="text-link" href="${upstream}/THIRD_PARTY.md">第三方许可证</a></div>
  </section>`;
}

function render() {
  navigation();
  const [title, description] = pages[page];
  main.innerHTML = `<header class="page-header"><div class="heading"><h1>${title}</h1><p>${description}</p></div>
    <div class="page-tools"><div id="draft-menu" class="draft-menu"></div><div id="session" class="session">${header()}</div></div></header>${
    page === 'buttons' ? mappingWorkspace() : settingPages.includes(page) ? editor() : page === 'overview' ? overview() : page === 'tester' ? tester() : page === 'license' ? licensePanel() : diagnostics()}`;
  refreshDraftMenu();
}

function updateDraftState(entry) {
  entry.dirty = JSON.stringify(entry.draft) !== JSON.stringify(draftFor(activeSection(),entry.record));
  const text = document.querySelector('#draft-state');
  if (text) text.textContent = entry.dirty ? '有未写入的更改' : '已读取手柄设置';
  for (const action of ['save','revert']) {
    const control = main.querySelector(`[data-action="${action}"]`);
    if (control) control.disabled = !entry.dirty || !!work;
  }
  refreshDraftMenu();
  const drafts = document.querySelector('#mapping-drafts');
  if (drafts) {
    const count = pendingMappingCount();
    drafts.hidden = !count;
    drafts.textContent = `${count} 处未写入`;
  }
}

function store(key, section, record) {
  cache.set(key, {record, draft:draftFor(section,record), dirty:false});
  if (section === 'buttons' && !record.sources.includes(selectedKey)) selectedKey = record.sources[0];
}

function readSettings() {
  const section = activeSection();
  const key = cacheKey(section);
  const selectedSlot = slot;
  const current = session;
  return run('正在读取…',async () => {
    const record = await current.read(section,selectedSlot);
    if (session === current) store(key,section,record);
  });
}

function loadPageSettings() {
  if (!settingPages.includes(page) || cache.has(cacheKey())) return null;
  const section = activeSection();
  if (!session?.supportsSetting(section) || (section === 'macro' && !session.slots.includes(slot))) return null;
  if (work) { queuedRead = true; return null; }
  return readSettings();
}

async function run(label, action, success) {
  if (work) return;
  message(); work = label; render();
  try {
    await action();
    if (success) message(success);
  } catch (error) {
    if (error.name === 'NotFoundError' && label === '正在连接…') message('没有选中蓝牙设备，可以重新搜索。');
    else {
      const detail = error.name === 'SecurityError' ? '此页面无法申请蓝牙权限，请在 Chrome 或 Edge 的独立标签页打开。' :
        error.name === 'NetworkError' ? `蓝牙通信失败。请检查手柄是否开机，并关闭其他配置工具。${error.message}` : error.message;
      log(detail);
      message(detail,true);
    }
  } finally {
    work = ''; render();
    if (queuedRead) {
      queuedRead = false;
      void loadPageSettings();
    }
  }
}

function clearSession() {
  session?.disconnect(); session = null; demo = false; battery = null; cache.clear(); slot = 0; selectedKey = 1;
}

function connect(action) {
  return run(action === 'demo' ? '载入演示…' : '正在连接…', async () => {
    // requestDevice must run directly within the click's transient user activation.
    const simulated = action === 'demo';
    const device = action === 'demo' ? (await import('./demo.mjs')).demoDevice() :
      action === 'reconnect' ? rememberedDevice : await chooseDevice(action === 'connect-all');
    if (!simulated) rememberedDevice = device;
    for (let attempt = 1; ; attempt++) {
      const candidate = new KeyLinker(device, {log, disconnected() {
        if (session !== candidate) return;
        clearSession(); message('手柄已断开，请重新连接。',true); render();
      }});
      try { await candidate.connect(); }
      catch (error) {
        if (!simulated && attempt < 3 && error.name === 'NetworkError') {
          log(`蓝牙连接中断，准备重连 · ${error.message}`);
          await pause(1000);
          continue;
        }
        if (error.name === 'NotFoundError') throw new Error('该蓝牙接口没有 KeyLinker 配置服务，请在设备列表中选择手柄的配置接口。', {cause:error});
        throw error;
      }
      session = candidate; demo = simulated;
      if (candidate.info.model) preview = candidate.info.model;
      if (!candidate.slots.includes(slot)) slot = candidate.slots[0] ?? 0;
      log(`${demo ? '演示' : 'BLE'} 已连接 · ${candidate.info.vid}:${candidate.info.pid} · ${candidate.info.firmware}`);
      break;
    }
  }).then(() => loadPageSettings());
}

function toByte(percent) {
  const value = percent * 255 / 100;
  return value % 1 === .5 && Math.floor(value) % 2 === 0 ? Math.floor(value) : Math.round(value);
}

function prepareSave(section, entry) {
  const {record,draft} = entry;
  const baseline = draftFor(section,record);
  if (section === 'buttons') return draft.flatMap((value,i) => value === baseline[i] ? [] : [[i,value]]);
  if (section === 'macro') return draft;
  return raw => {
    if (section === 'motors') {
      for (let i = 0; i < 4; i++) if (draft[`motor${i}`] !== baseline[`motor${i}`]) raw[i+1] = toByte(draft[`motor${i}`]);
      if (draft.shutdown !== baseline.shutdown) new DataView(raw.buffer,raw.byteOffset).setUint32(5,draft.shutdown === 'off' ? 0xffffffff : +draft.shutdown*12000,true);
    } else if (section === 'lighting') {
      if (draft.mode !== baseline.mode) raw[7] = draft.mode;
      if (draft.brightness !== baseline.brightness) raw[6] = toByte(draft.brightness);
      if (draft.color !== baseline.color) {
        if (![0,1,2,3,4].includes(draft.mode)) throw new Error('请先选择一种已知灯效模式');
        raw.set(draft.color.slice(1).match(/../g).map(v => parseInt(v,16)),1); raw[5] = 0;
      }
    } else {
      const scale = section === 'triggers' ? 2 : 1;
      for (const [index, channel] of Object.entries(draft)) {
        if (JSON.stringify(channel) === JSON.stringify(baseline[index])) continue;
        if (channel.inner + channel.outer >= 100) throw new Error('内死区与外死区之和必须小于 100%');
        if (channel.x1 > channel.x2) throw new Error('控制点 1 的输入值须小于或等于控制点 2');
        const at = 1 + index*7;
        raw.set([channel.inner*scale,channel.outer*scale,channel.x1,channel.y1,channel.x2,channel.y2],at);
        if (section === 'sticks') raw[at+6] = (raw[at+6] & 0xf8) | +channel.invertX | (+channel.invertY << 1) | (+channel.swap << 2);
      }
    }
    return raw;
  };
}

function gamepadCards(pads) {
  const names = ['A','B','X','Y','LB','RB','LT','RT','View','Menu','L3','R3','↑','↓','←','→','主页'];
  return pads.length ? `<div class="test-grid">${pads.map(pad => `<section class="subpanel"><h3>${escape(pad.id || `手柄 ${pad.index+1}`)}</h3>
      <div class="button-test">${pad.buttons.map((value,i) => `<span class="test-chip ${value.pressed ? 'pressed' : ''}">${pad.mapping === 'standard' ? names[i] ?? i+1 : i+1}${value.value > 0 && value.value < 1 ? ` · ${Math.round(value.value*100)}%` : ''}</span>`).join('')}</div>
      ${pad.axes.length ? `<dl class="axis-list">${pad.axes.map((axis,i) => {
        const name = pad.mapping === 'standard' ? ['左摇杆 X','左摇杆 Y','右摇杆 X','右摇杆 Y'][i] ?? `轴 ${i+1}` : `轴 ${i+1}`;
        const position = 50 + Math.max(-1,Math.min(1,axis)) * 50;
        return `<div><dt>${name}</dt><dd><span class="axis-track" aria-hidden="true" style="--position:${position}%"></span><span>${axis.toFixed(3)}</span></dd></div>`;
      }).join('')}</dl>` : ''}</section>`).join('')}</div>` : '';
}

function stopTester() {
  if (!testerRun) return;
  clearTimeout(testerRun.timer);
  testerRun.controller.abort();
  testerRun = undefined;
}

function startTester() {
  stopTester();
  testerRun = {controller:new AbortController(), native:{available:false,pads:[]}, nextNative:0};
  render();
  void pollTester(testerRun);
}

async function pollTester(run) {
  if (testerRun !== run) return;
  if (document.hidden) {
    run.timer = setTimeout(() => { void pollTester(run); }, 200);
    return;
  }

  let browserPads = [];
  let browserAvailable = typeof navigator.getGamepads === 'function';
  if (browserAvailable) {
    try { browserPads = Array.from(navigator.getGamepads()).filter(pad => pad?.connected); }
    catch { browserAvailable = false; }
  }
  if (!browserPads.length && Date.now() >= run.nextNative) {
    // Keep a single request in flight and leave the native helper idle when a
    // browser pad is visible. The server accepts same-origin test requests only.
    try {
      const response = await fetch('/api/input', {headers:{'X-X20CTL-Input':'1'}, signal:run.controller.signal});
      const state = response.ok ? await response.json() : null;
      run.native = Array.isArray(state?.pads) ? state : {available:false,pads:[]};
    } catch { run.native = {available:false,pads:[]}; }
    run.nextNative = Date.now() + (run.native.pads.length ? 0 : run.native.available ? 150 : 1500);
  }
  if (testerRun !== run) return;

  const status = document.querySelector('#input-status');
  const container = document.querySelector('#gamepads');
  if (!status || !container) return;
  const native = !browserPads.length && run.native.pads.length > 0;
  const pads = native ? run.native.pads : browserPads;
  const text = pads.length ? `已收到 ${pads.length} 个手柄的输入 · ${native ? 'Windows XInput' : '浏览器 Gamepad API'}` :
    run.native.available ? '未检测到手柄。连接数据线、2.4 GHz 接收器或游戏蓝牙后，按一下手柄按键。' :
      browserAvailable ? '等待浏览器识别手柄。请保持此页打开，按一下手柄按键。' : '当前浏览器和本机服务未提供输入接口。';
  if (status.textContent !== text) status.textContent = text;
  const markup = gamepadCards(pads);
  if (run.container !== container || run.markup !== markup) container.innerHTML = markup;
  run.container = container;
  run.markup = markup;
  run.timer = setTimeout(() => { void pollTester(run); }, pads.length ? 30 : 100);
}

function navigate({moveFocus = false} = {}) {
  const key = location.hash.slice(1);
  if (key === 'main') return;
  const macro = /^macro(?:\/(M[1-6]|ML|MR))?$/.exec(key);
  if (macro) {
    mapSide = 'rear';
    const index = slotNames.indexOf(macro[1]);
    if (index !== -1 && (!session || session.slots.includes(index))) slot = index;
  } else if (key === 'buttons/front') mapSide = 'front';
  page = macro || key === 'buttons/front' ? 'buttons' : Object.hasOwn(pages,key) ? key : 'overview';
  message();
  if (page === 'tester') startTester();
  else { stopTester(); render(); void loadPageSettings(); }
  if (moveFocus) {
    window.scrollTo(0,0);
    main.focus({preventScroll:true});
  }
}

document.addEventListener('click', event => {
  const draftLink = event.target.closest('[data-draft-link]');
  if (draftLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (location.hash === draftLink.hash) navigate({moveFocus:true});
    else location.hash = draftLink.hash;
    return;
  }
  const control = event.target.closest('[data-action], [data-map-side], [data-map-key], [data-map-target], [data-step], [data-step-key], [data-remove], [data-move]');
  if (!control || control.disabled || (work && control.dataset.action !== 'test')) return;
  const {action, mapKey, mapTarget, step, stepKey, remove, move, direction} = control.dataset;
  const entry = cache.get(cacheKey());
  const renderAndFocus = selector => { render(); main.querySelector(selector)?.focus(); };
  if (control.dataset.mapSide !== undefined || mapKey !== undefined) {
    if (control.dataset.mapSide !== undefined) mapSide = control.dataset.mapSide;
    if (mapKey !== undefined) {
      if (mapSide === 'rear') slot = +mapKey;
      else selectedKey = +mapKey;
    }
    const selector = mapKey === undefined ? `[data-map-side="${mapSide}"]` :
      `[data-map-key="${mapKey}"]${'mapHotspot' in control.dataset ? '[data-map-hotspot]' : ':not([data-map-hotspot])'}`;
    message();
    const loading = loadPageSettings();
    if (loading) void loading.then(() => main.querySelector(selector)?.focus());
    else renderAndFocus(selector);
    return;
  }
  if (mapTarget !== undefined) {
    entry.draft[entry.record.sources.indexOf(selectedKey)] = +mapTarget;
    updateDraftState(entry); renderAndFocus(`[data-map-target="${mapTarget}"]`);
    return;
  }
  if (step !== undefined) {
    entry.step = entry.step === +step ? undefined : +step;
    renderAndFocus(`[data-step="${step}"]`);
    return;
  }
  if (stepKey !== undefined) {
    const selected = new Set(entry.draft[entry.step].keys);
    if (!selected.delete(+stepKey)) selected.add(+stepKey);
    entry.draft[entry.step].keys = [...entry.record.layout.digital.keys()].filter(key => selected.has(key));
    updateDraftState(entry); renderAndFocus(`[data-step-key="${stepKey}"]`);
    return;
  }
  if (['connect','connect-all','reconnect','demo'].includes(action)) { void connect(action); return; }
  if (action === 'disconnect') {
    const drafts = pendingDrafts();
    if (drafts.length && !confirm(`还有 ${drafts.length} 项更改待写入。断开会清除这些草稿，继续吗？`)) return;
    clearSession(); message('已断开连接。'); render();
  }
  if (action === 'front' || action === 'rear') { side = action; render(); main.querySelector(`[data-action="${side}"]`)?.focus(); }
  if (action === 'battery') void run('读取电量…',async () => { const current = session; const result = await current.battery(); if (session === current) battery = result; });
  if (action === 'read') {
    if (entry?.dirty && !confirm('重新读取会丢弃当前设置中未写入的更改。继续读取？')) return;
    void readSettings();
  }
  if (action === 'revert') { store(cacheKey(),activeSection(),entry.record); render(); }
  if (action === 'save') {
    const form = document.querySelector('#editor-form');
    const invalid = form.querySelector('input:invalid, select:invalid');
    const details = invalid?.closest('details');
    if (details) details.open = true;
    if (!form.reportValidity()) return;
    const section = activeSection(), key = cacheKey(), current = session;
    const edits = prepareSave(section,entry);
    void run('写入并读回…',async () => { const record = await current.save(section,entry.record,edits); if (session === current) store(key,section,record); },
      demo ? '演示设置已写入并核对。' : '已写入手柄并读回核对。');
  }
  if (action === 'test-vibration') {
    const current = session;
    void run('试写并恢复…', async () => {
      const {original,testLevel} = await current.testVibration();
      if (session === current && !entry.dirty) store('motors','motors',original);
      const percent = byte => Math.round(byte * 100 / 255);
      const result = `左握把振动 ${percent(original.raw[1])}% → ${percent(testLevel)}% → ${percent(original.raw[1])}%，试写与恢复均已读回核对。`;
      log(result); message(result);
    });
  }
  if (action === 'copy-log') {
    if (!navigator.clipboard) message('无法自动复制，请手动选择日志。',true);
    else void navigator.clipboard.writeText(logs.join('\n')).then(() => message('日志已复制。'), () => message('无法自动复制，请手动选择日志。',true));
  }
  if (action === 'test') {
    if (testerRun) { stopTester(); render(); }
    else startTester();
  }
  if (action === 'add-step' || action === 'add-pause' || remove !== undefined || move !== undefined) {
    let focus = '[data-action="add-step"]';
    if (action === 'add-step' || action === 'add-pause') {
      entry.step = entry.draft.length;
      entry.draft.push({keys:[],left:8,right:8,ms:action === 'add-pause' ? 150 : 100});
      focus = action === 'add-pause' ? `[data-macro="${entry.step}.ms"]` : `[data-step="${entry.step}"]`;
    } else if (remove !== undefined) {
      entry.draft.splice(+remove,1);
      if (entry.step === +remove) entry.step = undefined;
      else if (entry.step > +remove) entry.step--;
    } else {
      const i = +move, next = i + +direction;
      [entry.draft[next],entry.draft[i]] = [entry.draft[i],entry.draft[next]];
      if (entry.step === i) entry.step = next;
      else if (entry.step === next) entry.step = i;
      focus = `[data-step="${next}"]`;
    }
    updateDraftState(entry); renderAndFocus(focus);
  }
});

document.addEventListener('change', ({target}) => {
  const {field, preset} = target.dataset;
  if (target.id === 'page-select') { location.hash = target.value; return; }
  if (field === 'preview') { preview = target.value; render(); }
  if (preset !== undefined && target.value === 'custom') target.closest('section').querySelector('details').open = true;
  if (preset !== undefined && target.value !== 'custom') {
    const entry = cache.get(cacheKey());
    const [x1,y1,x2,y2] = defaults[target.value];
    Object.assign(entry.draft[preset],{x1,y1,x2,y2}); updateDraftState(entry); render();
  }
});

document.addEventListener('input', ({target}) => {
  const {edit, macro} = target.dataset;
  if (edit === undefined && macro === undefined) return;
  const entry = cache.get(cacheKey());
  if (!entry) return;
  if (macro !== undefined) {
    const [index, name] = macro.split('.');
    const step = entry.draft[index];
    step[name] = target.type === 'number' ? target.valueAsNumber : +target.value;
    document.querySelector(`[data-step-label="${index}"]`).textContent = stepLabel(step);
    document.querySelector(`[data-step-time="${index}"]`).textContent = Number.isFinite(step.ms) ? `${step.ms} 毫秒` : '待填写';
  } else if (edit.includes('.')) {
    const [index, name] = edit.split('.');
    const channel = entry.draft[index];
    channel[name] = target.type === 'checkbox' ? target.checked : target.valueAsNumber;
    if (/^[xy][12]$/.test(name) && target.checkValidity()) {
      const holder = document.querySelector(`[data-curve="${index}"]`);
      if ([channel.x1,channel.y1,channel.x2,channel.y2].every(Number.isFinite)) holder.innerHTML = graph(channel);
      document.querySelector(`[data-preset="${index}"]`).value = 'custom';
    }
  } else {
    entry.draft[edit] = ['shutdown','color'].includes(edit) ? target.value : +target.value;
    if (target.type === 'range') target.nextElementSibling.value = `${target.value}%`;
  }
  updateDraftState(entry);
});

main.addEventListener('submit', event => event.preventDefault());
document.querySelector('#dismiss-notice').addEventListener('click',() => message());
window.addEventListener('hashchange',() => navigate({moveFocus:true}));
window.addEventListener('pagehide',() => { stopTester(); clearSession(); });
window.addEventListener('pageshow',event => { if (event.persisted) navigate(); });
navigate();
if (navigator.bluetooth?.getDevices) {
  void navigator.bluetooth.getDevices().then(devices => {
    if (!session && devices.length === 1) {
      [rememberedDevice] = devices;
      const toolbar = document.querySelector('#session');
      toolbar.innerHTML = header();
      if (page === 'overview') document.querySelector('.device-actions').innerHTML = `${connectionActions()}${button('demo','体验演示',{disabled:!!work})}`;
    }
  }).catch(() => {});
}
