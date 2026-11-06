import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = 24;
const STEP = 0.5;
const MAX_HEIGHT = 3.2;

// Small deterministic PRNG so the sample data is the same on every visit.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSampleData() {
  const random = mulberry32(20261106);
  const requests = [];
  const latency = [];
  const errors = [];
  for (let day = 0; day < DAYS.length; day++) {
    const weekend = day >= 5 ? 0.55 : 1;
    for (let hour = 0; hour < HOURS; hour++) {
      const morning = Math.exp(-((hour - 11) ** 2) / 14);
      const evening = Math.exp(-((hour - 19) ** 2) / 9);
      const load = (0.08 + morning * 0.75 + evening * 0.95) * weekend * (0.85 + random() * 0.3);
      const req = Math.round(load * 4200);
      requests.push(req);
      latency.push(Math.round(38 + load * 95 + random() * 18 + (random() > 0.965 ? 140 : 0)));
      errors.push(Math.round(req * (0.002 + random() * 0.004) + (random() > 0.95 ? 30 + random() * 40 : 0)));
    }
  }
  return { requests, latency, errors };
}

const DATA = buildSampleData();

export const METRICS = [
  { key: 'requests', name: 'Requests', format: (v) => `${v.toLocaleString('en-US')} req` },
  { key: 'latency', name: 'Latency', format: (v) => `${v} ms` },
  { key: 'errors', name: 'Errors', format: (v) => `${v} errors` },
];

const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;

export function summarize(metric) {
  const values = DATA[metric.key];
  let peakIndex = 0;
  let total = 0;
  values.forEach((value, i) => {
    total += value;
    if (value > values[peakIndex]) peakIndex = i;
  });
  return {
    peak: metric.format(values[peakIndex]),
    average: metric.format(Math.round(total / values.length)),
    when: `${DAYS[Math.floor(peakIndex / HOURS)]} ${hourLabel(peakIndex % HOURS)}`,
  };
}

function textSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.font = '500 28px "IBM Plex Sans", system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#4a5361';
  context.fillText(text, 96, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.2, 0.4, 1);
  return sprite;
}

/**
 * 3D data dashboard demo: 7 days × 24 hours of sample API traffic as bars.
 * One InstancedMesh draws all 168 bars; hovering reads the value back with a raycast.
 */
export function createDataviz(stage, { onHover } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(7.4, 7.2, 10.4);

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d9e2, 1.1));

  const count = DAYS.length * HOURS;
  const width = HOURS * STEP;
  const depth = DAYS.length * STEP;

  const geometry = new THREE.BoxGeometry(STEP * 0.78, 1, STEP * 0.78);
  geometry.translate(0, 0.5, 0); // scale grows the bar upwards from the floor
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const bars = new THREE.InstancedMesh(geometry, material, count);
  bars.castShadow = true;
  bars.receiveShadow = true;
  bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bars);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 1.2, depth + 1.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.005;
  floor.receiveShadow = true;
  scene.add(floor);

  DAYS.forEach((day, i) => {
    const label = textSprite(day);
    label.position.set(-width / 2 - 0.85, 0.12, (i + 0.5) * STEP - depth / 2);
    scene.add(label);
  });
  for (let hour = 0; hour < HOURS; hour += 6) {
    const label = textSprite(hourLabel(hour));
    label.position.set((hour + 0.5) * STEP - width / 2, 0.12, depth / 2 + 0.75);
    scene.add(label);
  }

  const controls = new OrbitControls(camera, stage.canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.18;
  controls.maxPolarAngle = Math.PI * 0.42;
  controls.minAzimuthAngle = -Math.PI * 0.35;
  controls.maxAzimuthAngle = Math.PI * 0.35;
  controls.target.set(0, 0.7, 0);

  // ── Bar state ──
  const current = new Float32Array(count); // 0..1, eased towards target
  const target = new Float32Array(count);
  let metric = METRICS[0];
  let hovered = -1;

  const low = new THREE.Color(0xd4dff3);
  const mid = new THREE.Color(0x5b83d6);
  const high = new THREE.Color(0x14307a);
  const tint = new THREE.Color();
  const highlight = new THREE.Color(0xe8731a);
  const dummy = new THREE.Object3D();

  function setMetric(next) {
    metric = next;
    const values = DATA[metric.key];
    const max = Math.max(...values);
    for (let i = 0; i < count; i++) target[i] = values[i] / max;
  }

  function writeBars() {
    for (let i = 0; i < count; i++) {
      const value = current[i];
      dummy.position.set(((i % HOURS) + 0.5) * STEP - width / 2, 0, (Math.floor(i / HOURS) + 0.5) * STEP - depth / 2);
      dummy.scale.set(1, Math.max(value * MAX_HEIGHT, 0.02), 1);
      dummy.updateMatrix();
      bars.setMatrixAt(i, dummy.matrix);

      if (value < 0.5) tint.lerpColors(low, mid, value * 2);
      else tint.lerpColors(mid, high, (value - 0.5) * 2);
      if (i === hovered) tint.lerp(highlight, 0.85);
      bars.setColorAt(i, tint);
    }
    bars.instanceMatrix.needsUpdate = true;
    bars.instanceColor.needsUpdate = true;
    bars.computeBoundingSphere();
  }

  // ── Hover ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerInside = false;
  let pointerX = 0;
  let pointerY = 0;
  let active = false;

  stage.canvas.addEventListener('pointermove', (event) => {
    const rect = stage.canvas.getBoundingClientRect();
    pointerX = event.clientX - rect.left;
    pointerY = event.clientY - rect.top;
    ndc.set((pointerX / rect.width) * 2 - 1, -(pointerY / rect.height) * 2 + 1);
    pointerInside = true;
  });
  stage.canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
  });

  function pick() {
    let next = -1;
    if (pointerInside) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(bars, false);
      if (hits.length > 0) next = hits[0].instanceId;
    }
    if (next !== hovered) {
      hovered = next;
      dirty = true;
    }
    if (hovered >= 0) {
      onHover?.({
        x: pointerX,
        y: pointerY,
        label: `${DAYS[Math.floor(hovered / HOURS)]} ${hourLabel(hovered % HOURS)}`,
        value: metric.format(DATA[metric.key][hovered]),
      });
    } else {
      onHover?.(null);
    }
  }

  let dirty = true;
  setMetric(metric);
  writeBars();

  return {
    scene,
    camera,
    controls,
    setMetric(next) {
      setMetric(next);
    },
    onEnter() {
      active = true;
      current.fill(0); // replay the grow-in each time the demo is opened
      dirty = true;
    },
    onLeave() {
      active = false;
      pointerInside = false;
      onHover?.(null);
    },
    onResize(viewWidth, viewHeight) {
      const narrow = viewWidth / viewHeight < 1.1;
      camera.fov = narrow ? 58 : 36;
    },
    update(dt) {
      if (!active) return;
      const ease = 1 - Math.exp(-dt * 6);
      let moving = false;
      for (let i = 0; i < count; i++) {
        const delta = target[i] - current[i];
        if (Math.abs(delta) > 0.0005) {
          current[i] += delta * ease;
          moving = true;
        } else {
          current[i] = target[i];
        }
      }
      pick();
      if (moving || dirty) {
        writeBars();
        dirty = false;
      }
      controls.update();
    },
  };
}
