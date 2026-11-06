import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { length, smoothstep, uv } from 'three/tsl';
import { REDUCED_MOTION } from './stage.js';

export const SHELL_COLORS = [
  { name: 'Graphite', hex: 0x2b2f38, price: 0 },
  { name: 'Bone', hex: 0xe3dccb, price: 0 },
  { name: 'Forest', hex: 0x2f6b4f, price: 10 },
  { name: 'Cobalt', hex: 0x2f5bd8, price: 10 },
  { name: 'Ember', hex: 0xe2532f, price: 10 },
];

export const FINISHES = [
  { name: 'Matte', price: 0, metalness: 0, roughness: 0.72, clearcoat: 0.02 },
  { name: 'Gloss', price: 15, metalness: 0, roughness: 0.22, clearcoat: 1 },
  { name: 'Metal', price: 30, metalness: 1, roughness: 0.3, clearcoat: 0.02 },
];

export const ACCENTS = [
  { name: 'Steel', hex: 0xc9ced6, price: 0 },
  { name: 'Gold', hex: 0xe0b260, price: 12 },
  { name: 'Copper', hex: 0xd0764a, price: 12 },
];

export const BASE_PRICE = 149;

/**
 * Product configurator demo: a pair of headphones built from primitive
 * geometry, with colour, finish and accent options that blend smoothly.
 */
export function createConfigurator(stage) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f7);
  scene.environment = stage.environment;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(1.6, 0.6, 6.6);

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);

  // ── Materials ──
  const shell = new THREE.MeshPhysicalMaterial({
    color: SHELL_COLORS[0].hex,
    roughness: FINISHES[0].roughness,
    metalness: FINISHES[0].metalness,
    clearcoat: FINISHES[0].clearcoat,
    clearcoatRoughness: 0.08,
  });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.92 });
  const accent = new THREE.MeshStandardMaterial({ color: ACCENTS[0].hex, metalness: 1, roughness: 0.24 });

  // ── Geometry ──
  const product = new THREE.Group();

  const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 24, 96, Math.PI), shell);
  band.scale.z = 2.6;
  product.add(band);

  const padArc = 1.7;
  const bandPad = new THREE.Mesh(new THREE.TorusGeometry(0.945, 0.05, 16, 64, padArc), cushion);
  bandPad.rotation.z = (Math.PI - padArc) / 2;
  bandPad.scale.z = 2.3;
  product.add(bandPad);

  const cupProfile = [
    [0, 0.16], [0.22, 0.16], [0.33, 0.138], [0.405, 0.09], [0.44, 0.02],
    [0.44, -0.06], [0.4, -0.1], [0, -0.1],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cupGeometry = new THREE.LatheGeometry(cupProfile, 72);
  const cushionGeometry = new THREE.TorusGeometry(0.3, 0.115, 20, 64);
  const ringGeometry = new THREE.TorusGeometry(0.25, 0.014, 12, 72);
  const capGeometry = new THREE.CircleGeometry(0.1, 48);
  const rodGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.34, 20);
  const hingeGeometry = new THREE.BoxGeometry(0.11, 0.1, 0.24);

  for (const side of [-1, 1]) {
    const rod = new THREE.Mesh(rodGeometry, accent);
    rod.position.set(side * 1, -0.1, 0);
    product.add(rod);

    const hinge = new THREE.Mesh(hingeGeometry, accent);
    hinge.position.set(side * 1, -0.27, 0);
    product.add(hinge);

    const cup = new THREE.Group();
    cup.position.set(side * 0.98, -0.76, 0);
    cup.scale.set(1, 1.16, 1);

    const body = new THREE.Mesh(cupGeometry, shell);
    body.rotation.z = -side * (Math.PI / 2); // lathe axis (+Y) points away from the head
    cup.add(body);

    const pad = new THREE.Mesh(cushionGeometry, cushion);
    pad.rotation.y = Math.PI / 2;
    pad.position.x = -side * 0.17;
    cup.add(pad);

    const ring = new THREE.Mesh(ringGeometry, accent);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * 0.158;
    cup.add(ring);

    const cap = new THREE.Mesh(capGeometry, accent);
    cap.rotation.y = side * (Math.PI / 2);
    cap.position.x = side * 0.1615;
    cup.add(cap);

    product.add(cup);
  }

  product.position.y = 0.34;
  product.rotation.y = -0.45;
  product.scale.setScalar(1.1);
  scene.add(product);

  // Soft blob shadow under the product, drawn by a tiny TSL node graph.
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, depthWrite: false });
  shadowMaterial.opacityNode = smoothstep(0.5, 0.05, length(uv().sub(0.5))).mul(0.32);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.2), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.3;
  scene.add(shadow);

  // ── Controls ──
  const controls = new OrbitControls(camera, stage.canvas);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.autoRotate = !REDUCED_MOTION;
  controls.autoRotateSpeed = 1.4;
  controls.minPolarAngle = Math.PI * 0.28;
  controls.maxPolarAngle = Math.PI * 0.58;
  controls.target.set(0, -0.12, 0);

  // ── Option state, blended towards its targets every frame ──
  const targetShell = new THREE.Color(SHELL_COLORS[0].hex);
  const targetAccent = new THREE.Color(ACCENTS[0].hex);
  let finish = FINISHES[0];

  return {
    scene,
    camera,
    controls,
    setShell(hex) {
      targetShell.set(hex);
    },
    setAccent(hex) {
      targetAccent.set(hex);
    },
    setFinish(next) {
      finish = next;
    },
    onResize(width, height) {
      // Keep the whole product in frame on narrow stages.
      camera.fov = width / height < 1.1 ? 44 : 32;
    },
    update(dt) {
      const ease = 1 - Math.exp(-dt * 7);
      shell.color.lerp(targetShell, ease);
      accent.color.lerp(targetAccent, ease);
      shell.metalness += (finish.metalness - shell.metalness) * ease;
      shell.roughness += (finish.roughness - shell.roughness) * ease;
      shell.clearcoat += (finish.clearcoat - shell.clearcoat) * ease;
      controls.update();
    },
  };
}
