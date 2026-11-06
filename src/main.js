import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './style.css';

import { REVISION } from 'three/webgpu';
import { BUDGETS, CONTACT, PROJECT_TYPES } from './config.js';
import { Stage } from './gl/stage.js';
import { createSystemMap } from './gl/systemmap.js';
import { WAREHOUSE_METRICS, createWarehouse } from './gl/warehouse.js';
import { METRICS, createDataviz, summarize } from './gl/dataviz.js';
import { ACCENTS, BASE_PRICE, FINISHES, SHELL_COLORS, createConfigurator } from './gl/configurator.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const hexToCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/* Helpers */

/** Native radio inputs with custom faces: keyboard and screen-reader behaviour for free. */
function radioGroup(container, name, items, { swatch = false, onChange }) {
  items.forEach((item, i) => {
    const label = document.createElement('label');
    label.className = swatch ? 'swatch' : 'seg';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(i);
    input.checked = i === 0;
    input.addEventListener('change', () => onChange(item));
    const face = document.createElement('span');
    if (swatch) {
      face.style.setProperty('--swatch', hexToCss(item.hex));
      input.setAttribute('aria-label', item.name);
      label.title = item.name;
    } else {
      face.textContent = item.name;
    }
    label.append(input, face);
    container.append(label);
  });
}

/** Tooltip for the 3D views: title, kind, optional status and a small table of values. */
function tooltip(element, view) {
  return (info) => {
    if (!info) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tip-title';
    title.textContent = info.title;
    const kind = document.createElement('div');
    kind.className = 'tip-kind';
    kind.textContent = info.kind ?? '';
    if (info.status) {
      const status = document.createElement('span');
      status.className = 'tip-status';
      status.textContent = info.status;
      kind.append(status);
    }
    element.append(title, kind);
    if (info.rows) {
      const table = document.createElement('table');
      for (const [key, value] of info.rows) {
        const row = table.insertRow();
        row.insertCell().textContent = key;
        row.insertCell().textContent = value;
      }
      element.append(table);
    }
    const width = view.clientWidth;
    const flip = info.x > width - 220;
    const x = Math.min(Math.max(info.x + (flip ? -16 : 16), 8), width - 8);
    const y = Math.min(Math.max(info.y + 12, 8), view.clientHeight - 8);
    element.style.transform = `translate(${x}px, ${y}px)${flip ? ' translateX(-100%)' : ''}`;
  };
}

/* Page chrome */

$('#year').textContent = String(new Date().getFullYear());
$('#three-rev').textContent = `r${REVISION}`;

/* Hero: service map */

async function startHero() {
  const loading = $('#hero-loading');
  try {
    const stage = await new Stage($('#hero-canvas')).init();
    const map = createSystemMap(stage, {
      labelLayer: $('#hero-labels'),
      onHover: tooltip($('#hero-tip'), $('.figure-view-hero')),
    });
    stage.setScene(map);
    stage.canvas.style.touchAction = 'pan-y';
    loading.hidden = true;
    $('#hero-badge').textContent = `three.js r${REVISION} · ${stage.backend}`;
  } catch (error) {
    console.warn('Hero view unavailable:', error);
    loading.textContent = 'The 3D view needs WebGPU or WebGL 2, which this browser does not provide.';
  }
}

/* Examples */

const demo = { stage: null, scenes: {}, current: 'warehouse' };

const HINTS = {
  warehouse: 'Hover a rack · drag to rotate',
  dataviz: 'Hover a bar · drag to rotate',
  configurator: 'Drag to rotate',
};

const showDemoTip = tooltip($('#demo-tip'), $('#demo-stage'));

const factories = {
  warehouse: (stage) => createWarehouse(stage, { onHover: showDemoTip }),
  dataviz: (stage) => createDataviz(stage, { onHover: (info) => showDemoTip(info && { title: info.label, kind: info.value }) }),
  configurator: (stage) => createConfigurator(stage),
};

// Control state lives here; each applier pushes it into its scene once that scene exists.
const state = {
  warehouseMetric: WAREHOUSE_METRICS[0],
  metric: METRICS[0],
  shell: SHELL_COLORS[0],
  finish: FINISHES[0],
  accent: ACCENTS[0],
};

function applyWarehouse() {
  const scene = demo.scenes.warehouse;
  scene?.setMetric(state.warehouseMetric);
  if (scene) {
    $('#wh-pallets').textContent = scene.summary.pallets;
    $('#wh-util').textContent = scene.summary.utilisation;
    $('#wh-full').textContent = scene.summary.fullBays;
  }
}

function applyDataviz() {
  demo.scenes.dataviz?.setMetric(state.metric);
  const summary = summarize(state.metric);
  $('#viz-peak').textContent = summary.peak;
  $('#viz-avg').textContent = summary.average;
  $('#viz-when').textContent = summary.when;
}

function applyConfigurator() {
  const scene = demo.scenes.configurator;
  scene?.setShell(state.shell.hex);
  scene?.setFinish(state.finish);
  scene?.setAccent(state.accent.hex);
  $('#cfg-price').textContent = `$${BASE_PRICE + state.shell.price + state.finish.price + state.accent.price}`;
  $('#cfg-summary').textContent = `${state.shell.name}, ${state.finish.name.toLowerCase()}, ${state.accent.name.toLowerCase()} ring`;
}

const appliers = { warehouse: applyWarehouse, dataviz: applyDataviz, configurator: applyConfigurator };

function showDemo(name) {
  demo.current = name;
  for (const tab of $$('.tab')) {
    const selected = tab.dataset.demo === name;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of $$('.panel')) panel.hidden = panel.dataset.panel !== name;
  $('#demo-stage').setAttribute('aria-labelledby', `tab-${name}`);
  $('#demo-hint').textContent = HINTS[name];
  showDemoTip(null);

  if (!demo.stage) return; // picked up once the stage is ready
  demo.scenes[name] ??= factories[name](demo.stage);
  demo.stage.canvas.style.touchAction = 'pan-y'; // OrbitControls sets 'none'; keep page scrolling on touch
  appliers[name]();
  demo.stage.setScene(demo.scenes[name]);
}

async function startDemos() {
  const loading = $('#demo-loading');
  try {
    demo.stage = await new Stage($('#demo-canvas')).init();
    showDemo(demo.current);
    loading.hidden = true;
    $('#demo-badge').textContent = demo.stage.backend;
  } catch (error) {
    console.warn('Example view unavailable:', error);
    loading.textContent = 'The 3D examples need WebGPU or WebGL 2, which this browser does not provide.';
  }
}

const tabs = $$('.tab');
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => showDemo(tab.dataset.demo));
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next.focus();
    showDemo(next.dataset.demo);
  });
});

radioGroup($('#wh-metric'), 'wh-metric', WAREHOUSE_METRICS, {
  onChange: (item) => {
    state.warehouseMetric = item;
    applyWarehouse();
  },
});
radioGroup($('#viz-metric'), 'viz-metric', METRICS, {
  onChange: (item) => {
    state.metric = item;
    applyDataviz();
  },
});
radioGroup($('#cfg-color'), 'cfg-color', SHELL_COLORS, {
  swatch: true,
  onChange: (item) => {
    state.shell = item;
    applyConfigurator();
  },
});
radioGroup($('#cfg-finish'), 'cfg-finish', FINISHES, {
  onChange: (item) => {
    state.finish = item;
    applyConfigurator();
  },
});
radioGroup($('#cfg-accent'), 'cfg-accent', ACCENTS, {
  swatch: true,
  onChange: (item) => {
    state.accent = item;
    applyConfigurator();
  },
});
applyDataviz();
applyConfigurator();

// The vehicle status line updates on its own clock.
setInterval(() => {
  const scene = demo.scenes.warehouse;
  if (scene) $('#wh-agv').textContent = scene.vehicleStatus();
}, 1000);

startHero();
const demoObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      demoObserver.disconnect();
      startDemos();
    }
  },
  { rootMargin: '600px 0px' },
);
demoObserver.observe($('#examples'));

/* Contacts and enquiry form */

const links = {
  telegram: `https://t.me/${CONTACT.telegram}`,
  email: `mailto:${CONTACT.email}`,
  x: `https://x.com/${CONTACT.x}`,
  github: `https://github.com/${CONTACT.github}`,
};
$('#c-telegram').href = links.telegram;
$('#c-telegram').textContent = `@${CONTACT.telegram}`;
$('#c-email').href = links.email;
$('#c-email').textContent = CONTACT.email;
$('#c-github').href = links.github;
$('#c-github').textContent = `github.com/${CONTACT.github}`;
$('#c-x').href = links.x;
$('#c-x').textContent = `@${CONTACT.x}`;

const typeSelect = $('#f-type');
for (const type of PROJECT_TYPES) typeSelect.append(new Option(type, type));
const budgetSelect = $('#f-budget');
for (const budget of BUDGETS) budgetSelect.append(new Option(budget, budget));

$('#demo-order').addEventListener('click', (event) => {
  typeSelect.value = event.currentTarget.dataset.type;
});

const form = $('#order-form');
const formError = $('#form-error');
const formStatus = $('#form-status');

function readForm() {
  const data = new FormData(form);
  const text = (key) => String(data.get(key) ?? '').trim();
  return {
    name: text('name'),
    company: text('company'),
    contact: text('contact'),
    type: text('type'),
    budget: text('budget'),
    deadline: text('deadline'),
    details: text('details'),
  };
}

function validate(order) {
  if (!order.name) return { field: '#f-name', message: 'Please add your name.' };
  if (order.details.length < 10) return { field: '#f-details', message: 'Please describe the project in a sentence or two.' };
  return null;
}

function buildBrief(order, { includeContact = true } = {}) {
  const lines = ['Project enquiry', '', `Name: ${order.name}`];
  if (order.company) lines.push(`Company: ${order.company}`);
  if (includeContact && order.contact) lines.push(`Reply to: ${order.contact}`);
  lines.push(`Type: ${order.type}`, `Budget: ${order.budget}`);
  if (order.deadline) lines.push(`Deadline: ${order.deadline}`);
  lines.push('', order.details);
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const senders = {
  async telegram(order) {
    const brief = buildBrief(order);
    const copied = await copyText(brief);
    window.open(`${links.telegram}?text=${encodeURIComponent(brief)}`, '_blank', 'noopener');
    return copied
      ? `Opening Telegram. The brief is also copied to your clipboard in case the chat with @${CONTACT.telegram} opens empty.`
      : `Opening Telegram. If the chat with @${CONTACT.telegram} opens empty, paste your brief from the form.`;
  },
  async email(order) {
    const brief = buildBrief(order);
    const copied = await copyText(brief);
    const subject = `Project enquiry: ${order.type}`;
    window.location.href = `${links.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(brief)}`;
    return copied
      ? `Opening your mail application. If nothing opens, write to ${CONTACT.email}; the brief is copied to your clipboard.`
      : `Opening your mail application. If nothing opens, write to ${CONTACT.email}.`;
  },
  async github(order) {
    // Issues are public, so contact details stay out.
    const query = new URLSearchParams({
      template: 'order.yml',
      title: `Enquiry: ${order.type}`,
      'project-type': order.type,
      budget: order.budget,
      deadline: order.deadline,
      details: order.details.slice(0, 3500),
    });
    window.open(`https://github.com/${CONTACT.repo}/issues/new?${query}`, '_blank', 'noopener');
    return 'Opening a GitHub issue with your brief filled in. It is public, so leave out anything confidential.';
  },
};

for (const button of $$('[data-send]')) {
  button.addEventListener('click', async () => {
    const order = readForm();
    const problem = validate(order);
    formStatus.textContent = '';
    if (problem) {
      formError.textContent = problem.message;
      formError.hidden = false;
      $(problem.field).focus();
      return;
    }
    formError.hidden = true;
    formStatus.textContent = await senders[button.dataset.send](order);
  });
}
form.addEventListener('submit', (event) => event.preventDefault());
