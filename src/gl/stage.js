import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const params = new URLSearchParams(window.location.search);

/** `?gl=webgl` forces the WebGL 2 backend, which is useful for testing the fallback. */
export const FORCE_WEBGL = params.get('gl') === 'webgl';
export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One canvas, one WebGPURenderer and one active scene at a time.
 * Rendering stops while the canvas is off screen or the tab is hidden.
 *
 * A scene is a plain object: { scene, camera, update?(dt, elapsed), onResize?(w, h), controls? }.
 */
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = null;
    this.visible = false;
    this.running = false;
    this.elapsed = 0;
    this.last = 0;
    this.width = 1;
    this.height = 1;
    this._environment = null;
    this._frame = this._frame.bind(this);
  }

  async init() {
    let renderer = await this._createRenderer(FORCE_WEBGL);
    if (renderer.backend.isWebGPUBackend && !(await this._webgpuWorks(renderer))) {
      // WebGPU is advertised but cannot draw here (seen with some Linux drivers).
      // A canvas is tied to its first context type, so swap in a fresh one for WebGL 2.
      renderer.dispose();
      const fresh = this.canvas.cloneNode(false);
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      renderer = await this._createRenderer(true);
    }
    this.renderer = renderer;
    this.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.canvas.parentElement);

    this._intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        this._sync();
      },
      { threshold: 0.01 },
    );
    this._intersectionObserver.observe(this.canvas);
    document.addEventListener('visibilitychange', () => this._sync());

    this.resize();
    return this;
  }

  async _createRenderer(forceWebGL) {
    const renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL });
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const box = this.canvas.parentElement;
    renderer.setSize(Math.max(box.clientWidth, 2), Math.max(box.clientHeight, 2), false);
    return renderer;
  }

  /** Draws one test frame inside GPU error scopes and reports whether it went through cleanly. */
  async _webgpuWorks(renderer) {
    const device = renderer.backend.device;
    const kinds = ['validation', 'out-of-memory', 'internal'];
    const probe = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    try {
      const scene = new THREE.Scene();
      scene.add(probe);
      for (const kind of kinds) device.pushErrorScope(kind);
      renderer.render(scene, new THREE.PerspectiveCamera());
      const errors = await Promise.all(kinds.map(() => device.popErrorScope()));
      const lost = await Promise.race([device.lost.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 60))]);
      return !lost && errors.every((error) => error === null);
    } catch {
      return false;
    } finally {
      probe.geometry.dispose();
      probe.material.dispose();
    }
  }

  /** Soft studio lighting shared by every scene that asks for it. */
  get environment() {
    if (!this._environment) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this._environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    return this._environment;
  }

  setScene(next) {
    if (this.active === next) return;
    if (this.active?.controls) this.active.controls.enabled = false;
    this.active?.onLeave?.();
    this.active = next;
    if (next.controls) next.controls.enabled = true;
    next.onEnter?.();
    this.resize();
    this._sync();
  }

  resize() {
    const box = this.canvas.parentElement;
    const width = box.clientWidth;
    const height = box.clientHeight;
    if (!width || !height || !this.renderer) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    if (this.active) {
      this.active.camera.aspect = width / height;
      this.active.onResize?.(width, height);
      this.active.camera.updateProjectionMatrix();
    }
  }

  _sync() {
    const shouldRun = this.visible && !document.hidden && this.active !== null;
    if (shouldRun && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.renderer.setAnimationLoop(this._frame);
    } else if (!shouldRun && this.running) {
      this.running = false;
      this.renderer.setAnimationLoop(null);
    }
  }

  _frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.elapsed += dt;
    this.active.update?.(dt, this.elapsed);
    this.renderer.render(this.active.scene, this.active.camera);
  }
}
