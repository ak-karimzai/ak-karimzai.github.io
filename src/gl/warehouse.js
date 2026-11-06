import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { REDUCED_MOTION } from './stage.js';

const ROWS = 4; // rack rows, named A–D
const BAYS = 8;
const LEVELS = 3;
const BAY_WIDTH = 1.4;
const RACK_DEPTH = 1.1;
const LEVEL_HEIGHT = 1.1;
const ROW_Z = [-5.25, -1.75, 1.75, 5.25];
const SKU_GROUPS = ['Beverages', 'Packaging', 'Electronics', 'Household', 'Paper goods', 'Tools'];

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

// Sample inventory: which slots hold a pallet, and how often each bay is picked from.
function buildInventory() {
  const random = mulberry32(7);
  const bays = [];
  for (let row = 0; row < ROWS; row++) {
    for (let bay = 0; bay < BAYS; bay++) {
      const busy = 0.45 + 0.5 * Math.exp(-((bay - 2.5) ** 2) / 6); // bays near the dock are busier
      const slots = [];
      for (let level = 0; level < LEVELS; level++) slots.push(random() < busy - 0.08);
      bays.push({
        row,
        bay,
        name: `${'ABCD'[row]}-${String(bay + 1).padStart(2, '0')}`,
        slots,
        picks: Math.round(busy * 40 + random() * 25),
        sku: SKU_GROUPS[Math.floor(random() * SKU_GROUPS.length)],
        lastPick: Math.round(2 + random() * 180),
      });
    }
  }
  return bays;
}

export const WAREHOUSE_METRICS = [
  { key: 'occupancy', name: 'Occupancy' },
  { key: 'picks', name: 'Pick frequency' },
];

export function createWarehouse(stage, { onHover } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  camera.position.set(12, 13, 17);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd4d9e2, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-8, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Floor with aisle markings.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(27, 17), new THREE.MeshStandardMaterial({ color: 0xe6e9ee, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const markingMaterial = new THREE.MeshBasicMaterial({ color: 0xcfd5de });
  for (const z of [-3.5, 0, 3.5]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(24, 0.05), markingMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(-0.5, 0.004, z);
    scene.add(line);
  }
  const dock = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 15), new THREE.MeshBasicMaterial({ color: 0xdfe3ea }));
  dock.rotation.x = -Math.PI / 2;
  dock.position.set(-11.4, 0.003, 0);
  scene.add(dock);

  const inventory = buildInventory();
  const startX = -((BAYS * BAY_WIDTH) / 2) + 0.4;
  const bayX = (bay) => startX + (bay + 0.5) * BAY_WIDTH;

  // ── Rack frames (uprights and beams) as instanced boxes ──
  const steel = new THREE.MeshStandardMaterial({ color: 0x5f6b7d, roughness: 0.6, metalness: 0.3 });
  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.55 });
  const uprightCount = ROWS * (BAYS + 1) * 2;
  const uprights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, LEVELS * LEVEL_HEIGHT + 0.3, 0.08), steel, uprightCount);
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(BAY_WIDTH - 0.08, 0.07, 0.08), beamMaterial, ROWS * BAYS * LEVELS * 2);
  const dummy = new THREE.Object3D();
  let u = 0;
  let b = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let bay = 0; bay <= BAYS; bay++) {
      for (const side of [-1, 1]) {
        dummy.position.set(startX + bay * BAY_WIDTH, (LEVELS * LEVEL_HEIGHT + 0.3) / 2, ROW_Z[row] + (side * RACK_DEPTH) / 2);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        uprights.setMatrixAt(u++, dummy.matrix);
      }
    }
    for (let bay = 0; bay < BAYS; bay++) {
      for (let level = 0; level < LEVELS; level++) {
        for (const side of [-1, 1]) {
          dummy.position.set(bayX(bay), level * LEVEL_HEIGHT + 0.12, ROW_Z[row] + (side * RACK_DEPTH) / 2);
          dummy.updateMatrix();
          beams.setMatrixAt(b++, dummy.matrix);
        }
      }
    }
  }
  uprights.castShadow = true;
  beams.castShadow = true;
  scene.add(uprights, beams);

  // ── Pallets and cartons: one instance per filled slot ──
  const filled = [];
  inventory.forEach((bayInfo, bayIndex) => {
    bayInfo.slots.forEach((has, level) => {
      if (has) filled.push({ bayIndex, level });
    });
  });
  const pallets = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 0.12, 0.95),
    new THREE.MeshStandardMaterial({ color: 0xc8a46f, roughness: 0.85 }),
    filled.length,
  );
  const cartons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.0, 0.72, 0.86),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    filled.length,
  );
  filled.forEach(({ bayIndex, level }, i) => {
    const { row, bay } = inventory[bayIndex];
    dummy.position.set(bayX(bay), level * LEVEL_HEIGHT + 0.16 + 0.06, ROW_Z[row]);
    dummy.updateMatrix();
    pallets.setMatrixAt(i, dummy.matrix);
    dummy.position.y = level * LEVEL_HEIGHT + 0.16 + 0.12 + 0.36;
    dummy.updateMatrix();
    cartons.setMatrixAt(i, dummy.matrix);
  });
  pallets.castShadow = true;
  cartons.castShadow = true;
  cartons.receiveShadow = true;
  scene.add(pallets, cartons);

  // Invisible hit boxes, one per bay, for hover picking.
  const hitGeometry = new THREE.BoxGeometry(BAY_WIDTH, LEVELS * LEVEL_HEIGHT + 0.3, RACK_DEPTH);
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hitBoxes = inventory.map((bayInfo) => {
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    hit.position.set(bayX(bayInfo.bay), (LEVELS * LEVEL_HEIGHT + 0.3) / 2, ROW_Z[bayInfo.row]);
    hit.userData.bay = bayInfo;
    scene.add(hit);
    return hit;
  });
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(hitGeometry),
    new THREE.LineBasicMaterial({ color: 0x1f4fd1 }),
  );
  outline.visible = false;
  scene.add(outline);

  // ── Automated vehicle on a loop around the aisles ──
  const vehicle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 0.8), new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.5 }));
  body.position.y = 0.3;
  body.castShadow = true;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x8a93a3, roughness: 0.5 }));
  mast.position.set(0.6, 0.85, 0);
  mast.castShadow = true;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1f4fd1, emissive: 0x1f4fd1, emissiveIntensity: 1.2 }));
  beacon.position.set(-0.45, 0.58, 0);
  vehicle.add(body, mast, beacon);
  scene.add(vehicle);

  const route = [
    new THREE.Vector3(-9.5, 0, 3.5), new THREE.Vector3(6.5, 0, 3.5), new THREE.Vector3(6.5, 0, 0),
    new THREE.Vector3(-9.5, 0, 0), new THREE.Vector3(-9.5, 0, -3.5), new THREE.Vector3(6.5, 0, -3.5),
    new THREE.Vector3(6.5, 0, -7.2), new THREE.Vector3(-9.5, 0, -7.2),
  ];
  const routePath = new THREE.CatmullRomCurve3(route, true, 'centripetal', 0.2);
  const routeLength = routePath.getLength();
  let routeT = 0;
  const vehicleSpeed = REDUCED_MOTION ? 0.4 : 1.6;
  const ahead = new THREE.Vector3();
  const stops = ['heading to dock', 'picking at B-03', 'returning', 'picking at D-06'];

  // ── Controls ──
  const controls = new OrbitControls(camera, stage.canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.15;
  controls.maxPolarAngle = Math.PI * 0.42;
  controls.minAzimuthAngle = -Math.PI * 0.05;
  controls.maxAzimuthAngle = Math.PI * 0.6;
  controls.target.set(-1, 0.8, 0);

  // ── Colouring by metric ──
  const low = new THREE.Color(0xdfe7f6);
  const mid = new THREE.Color(0x6f94e0);
  const high = new THREE.Color(0x1d3f9e);
  const heatLow = new THREE.Color(0xfbe8c8);
  const heatHigh = new THREE.Color(0xc2410c);
  const tint = new THREE.Color();
  const maxPicks = Math.max(...inventory.map((bay) => bay.picks));
  let metric = WAREHOUSE_METRICS[0];

  function colourBays() {
    filled.forEach(({ bayIndex }, i) => {
      const bay = inventory[bayIndex];
      if (metric.key === 'occupancy') {
        const fill = bay.slots.filter(Boolean).length / LEVELS;
        if (fill < 0.67) tint.lerpColors(low, mid, fill / 0.67);
        else tint.lerpColors(mid, high, (fill - 0.67) / 0.33);
      } else {
        tint.lerpColors(heatLow, heatHigh, bay.picks / maxPicks);
      }
      cartons.setColorAt(i, tint);
    });
    cartons.instanceColor.needsUpdate = true;
  }
  colourBays();

  const totalPallets = filled.length;
  const fullBays = inventory.filter((bay) => bay.slots.every(Boolean)).length;

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

  function pick() {
    let next = null;
    if (pointerInside) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(hitBoxes, false);
      if (hits.length > 0) next = hits[0].object;
    }
    if (next !== hovered) {
      hovered = next;
      outline.visible = next !== null;
      if (next) outline.position.copy(next.position);
    }
    if (hovered) {
      const bay = hovered.userData.bay;
      const count = bay.slots.filter(Boolean).length;
      onHover?.({
        x: pointerX,
        y: pointerY,
        title: `Rack ${bay.name}`,
        kind: bay.sku,
        rows: [
          ['Slots used', `${count} of ${LEVELS}`],
          ['Picks this week', String(bay.picks)],
          ['Last pick', `${bay.lastPick} min ago`],
        ],
      });
    } else {
      onHover?.(null);
    }
  }

  let active = false;

  return {
    scene,
    camera,
    controls,
    summary: {
      pallets: String(totalPallets),
      utilisation: `${Math.round((totalPallets / (ROWS * BAYS * LEVELS)) * 100)} %`,
      fullBays: `${fullBays} of ${ROWS * BAYS}`,
    },
    setMetric(next) {
      metric = next;
      colourBays();
    },
    vehicleStatus() {
      return stops[Math.floor((routeT * stops.length) % stops.length)];
    },
    onResize(width, height) {
      camera.fov = width / height < 1.1 ? 52 : width / height < 1.4 ? 40 : 30;
    },
    onEnter() {
      active = true;
    },
    onLeave() {
      active = false;
      pointerInside = false;
      onHover?.(null);
    },
    update(dt) {
      if (!active) return;
      routeT = (routeT + (dt * vehicleSpeed) / routeLength) % 1;
      routePath.getPointAt(routeT, vehicle.position);
      routePath.getPointAt((routeT + 0.004) % 1, ahead);
      vehicle.lookAt(ahead.x, 0, ahead.z);
      vehicle.rotateY(-Math.PI / 2);
      controls.update();
      pick();
    },
  };
}
