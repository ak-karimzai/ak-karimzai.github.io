import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { color, fract, mix, step, time, uniform, uv } from 'three/tsl';
import { REDUCED_MOTION } from './stage.js';

const NODES = [
  { id: 'web', label: 'Web app', kind: 'client', x: -6.2, z: -1.6 },
  { id: 'mobile', label: 'Mobile app', kind: 'client', x: -6.2, z: 1.6 },
  { id: 'gateway', label: 'API gateway', kind: 'gateway', x: -3.3, z: 0 },
  { id: 'auth', label: 'Auth', kind: 'service', x: 0, z: -3 },
  { id: 'orders', label: 'Orders', kind: 'service', x: 0, z: -1 },
  { id: 'payments', label: 'Payments', kind: 'service', x: 0, z: 1, status: 'degraded' },
  { id: 'notify', label: 'Notifications', kind: 'service', x: 0, z: 3 },
  { id: 'postgres', label: 'PostgreSQL', kind: 'database', x: 3.4, z: -2 },
  { id: 'redis', label: 'Redis', kind: 'database', x: 3.4, z: 0 },
  { id: 'kafka', label: 'Kafka', kind: 'broker', x: 3.4, z: 2.2 },
  { id: 'bank', label: 'Bank API', kind: 'external', x: 6.4, z: 1 },
];

const EDGES = [
  ['web', 'gateway'], ['mobile', 'gateway'],
  ['gateway', 'auth'], ['gateway', 'orders'], ['gateway', 'payments'],
  ['auth', 'redis'], ['orders', 'postgres'], ['orders', 'kafka'],
  ['payments', 'postgres'], ['payments', 'bank'], ['kafka', 'notify'],
];

// Sample metrics shown on hover.
const METRICS = {
  web: { kind: 'Client', rows: [['Sessions', '1,240 active'], ['Version', '4.12.0']] },
  mobile: { kind: 'Client', rows: [['Sessions', '2,980 active'], ['Version', 'iOS 3.8 · Android 3.8']] },
  gateway: { kind: 'Edge', rows: [['Requests', '1,860 /s'], ['p95 latency', '41 ms'], ['5xx', '0.03 %'], ['Instances', '3']] },
  auth: { kind: 'Service', rows: [['Requests', '620 /s'], ['p95 latency', '18 ms'], ['Errors', '0.01 %'], ['Instances', '2']] },
  orders: { kind: 'Service', rows: [['Requests', '410 /s'], ['p95 latency', '95 ms'], ['Errors', '0.08 %'], ['Instances', '4']] },
  payments: { kind: 'Service', status: 'Degraded', rows: [['Requests', '230 /s'], ['p95 latency', '820 ms'], ['Errors', '2.1 %'], ['Instances', '4']] },
  notify: { kind: 'Service', rows: [['Messages', '150 /s'], ['Backlog', '12'], ['Errors', '0.00 %'], ['Instances', '2']] },
  postgres: { kind: 'Database', rows: [['Queries', '3,100 /s'], ['Connections', '142 / 200'], ['Replication lag', '0.4 s']] },
  redis: { kind: 'Cache', rows: [['Operations', '9,400 /s'], ['Hit rate', '97.8 %'], ['Memory', '2.1 / 4 GB']] },
  kafka: { kind: 'Message broker', rows: [['Throughput', '560 msg/s'], ['Consumer lag', '38'], ['Partitions', '24']] },
  bank: { kind: 'External API', rows: [['Calls', '180 /s'], ['p95 latency', '760 ms'], ['Timeouts', '1.9 %']] },
};

const STATUS_COLORS = { ok: 0x1a7f4b, degraded: 0xd08a1e };

/**
 * Service map: the components of a payment platform on a plane, with request
 * flow animated along the connections by a TSL material (the dashes move on the GPU).
 */
export function createSystemMap(stage, { labelLayer, onHover } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  camera.position.set(3.5, 12.5, 13.5);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d9e2, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-6, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Nodes ──
  const materials = {
    client: new THREE.MeshStandardMaterial({ color: 0xe4e8ee, roughness: 0.7 }),
    gateway: new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.6 }),
    service: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
    database: new THREE.MeshStandardMaterial({ color: 0xd6e2f6, roughness: 0.6 }),
    broker: new THREE.MeshStandardMaterial({ color: 0xd6e2f6, roughness: 0.6 }),
    external: new THREE.MeshStandardMaterial({ color: 0xf1e8d4, roughness: 0.7 }),
  };
  const geometries = {
    client: new THREE.BoxGeometry(1.3, 0.3, 1),
    gateway: new THREE.BoxGeometry(1.1, 0.34, 2.6),
    service: new THREE.BoxGeometry(1.7, 0.3, 1),
    database: new THREE.CylinderGeometry(0.58, 0.58, 0.42, 40),
    broker: new THREE.BoxGeometry(1.7, 0.3, 1),
    external: new THREE.BoxGeometry(1.3, 0.3, 1),
  };
  const stripeGeometry = new THREE.BoxGeometry(1.5, 0.03, 0.09);

  const nodeMeshes = [];
  const byId = {};
  for (const node of NODES) {
    const mesh = new THREE.Mesh(geometries[node.kind], materials[node.kind]);
    mesh.position.set(node.x, 0.17, node.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.node = node;
    scene.add(mesh);
    nodeMeshes.push(mesh);
    byId[node.id] = node;

    if (node.kind === 'service') {
      const stripe = new THREE.Mesh(
        stripeGeometry,
        new THREE.MeshStandardMaterial({ color: STATUS_COLORS[node.status ?? 'ok'], roughness: 0.5 }),
      );
      stripe.position.set(node.x, 0.335, node.z + 0.4);
      scene.add(stripe);
    }
    if (labelLayer) {
      const label = document.createElement('span');
      label.className = `map-label map-label-${node.kind}`;
      label.textContent = node.label;
      labelLayer.append(label);
      node.labelElement = label;
    }
  }

  // ── Edges: flat strips with moving dashes. uv.x is scaled to world units so dashes keep one size. ──
  const flowSpeed = REDUCED_MOTION ? 0.15 : 1;
  const edgeMeshes = [];
  for (const [fromId, toId] of EDGES) {
    const from = byId[fromId];
    const to = byId[toId];
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);

    const geometry = new THREE.PlaneGeometry(length, 0.07);
    const uvs = geometry.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * length);
    geometry.rotateX(-Math.PI / 2);

    const active = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial();
    const phase = fract(uv().x.mul(1 / 0.55).sub(time.mul(1.6 * flowSpeed)));
    const dash = step(0.5, phase);
    const base = mix(color(0xc9cfd8), color(0x8a93a3), dash);
    const highlighted = mix(color(0xb9c8ef), color(0x1f4fd1), dash);
    material.colorNode = mix(base, highlighted, active);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((from.x + to.x) / 2, 0.012, (from.z + to.z) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.userData = { from: fromId, to: toId, active };
    scene.add(mesh);
    edgeMeshes.push(mesh);
  }

  // Hover highlight under the node.
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 1.6),
    new THREE.MeshBasicMaterial({ color: 0x1f4fd1, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.006;
  halo.visible = false;
  scene.add(halo);

  // ── Controls ──
  const controls = new OrbitControls(camera, stage.canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.4;
  controls.minAzimuthAngle = -Math.PI * 0.3;
  controls.maxAzimuthAngle = Math.PI * 0.3;
  controls.target.set(0.1, 0, 0.3);

  // ── Hover ──
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerInside = false;
  let pointerX = 0;
  let pointerY = 0;
  let hovered = null;

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

  function setHovered(node) {
    if (node === hovered) return;
    hovered = node;
    halo.visible = node !== null;
    if (node) {
      halo.position.x = node.x;
      halo.position.z = node.z;
      halo.scale.set(node.kind === 'gateway' ? 0.75 : 1, node.kind === 'gateway' ? 1.9 : 1, 1);
    }
    for (const edge of edgeMeshes) {
      const touches = node && (edge.userData.from === node.id || edge.userData.to === node.id);
      edge.userData.active.value = touches ? 1 : 0;
    }
    for (const other of NODES) other.labelElement?.classList.toggle('is-active', other === node);
  }

  function pick() {
    let next = null;
    if (pointerInside) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(nodeMeshes, false);
      if (hits.length > 0) next = hits[0].object.userData.node;
    }
    setHovered(next);
    if (hovered) {
      const metrics = METRICS[hovered.id];
      onHover?.({ x: pointerX, y: pointerY, title: hovered.label, kind: metrics.kind, status: metrics.status, rows: metrics.rows });
    } else {
      onHover?.(null);
    }
  }

  // ── Labels follow their nodes ──
  const projected = new THREE.Vector3();
  function placeLabels() {
    if (!labelLayer) return;
    const width = stage.width;
    const height = stage.height;
    for (const node of NODES) {
      projected.set(node.x, 0.34, node.z).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      node.labelElement.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  return {
    scene,
    camera,
    controls,
    onResize(width, height) {
      camera.fov = width / height < 1.05 ? 48 : width / height < 1.4 ? 36 : 28;
    },
    onLeave() {
      pointerInside = false;
      setHovered(null);
      onHover?.(null);
    },
    update() {
      controls.update();
      pick();
      placeLabels();
    },
  };
}
