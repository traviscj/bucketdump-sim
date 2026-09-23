import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { App, Panel } from "../app";
import type { Polygon } from "../geom/polygon";
import type { Bucket } from "../physics/bucket";
import { DEPTH } from "../physics/constants";
import { MATERIALS, MATERIAL_IDS, dominant } from "../physics/materials";
import { wallOutline } from "../physics/shapes";
import { contentBox } from "../world/scenario";

interface BucketRig {
  bucket: Bucket;
  group: THREE.Group;
  shellMat: THREE.MeshStandardMaterial;
  sideMat: THREE.MeshStandardMaterial;
  fluid: THREE.Mesh;
  beacon: THREE.Mesh;
}

const Z_SPREAD = DEPTH * 0.8;

/**
 * 3D view of the same 2D simulation: the world is extruded along z by the
 * sim's nominal depth. Orbit with drag/pinch, tap a bucket to shove it.
 */
export class View3D implements Panel {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  private readonly controls: OrbitControls;
  private readonly statics = new THREE.Group();
  private rigs: BucketRig[] = [];
  private particles!: THREE.InstancedMesh;
  private people: { mesh: THREE.Group; index: number }[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly raycaster = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private builtFor: unknown = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly app: App,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.scene.background = new THREE.Color("#8fd3ff");
    this.scene.fog = new THREE.Fog("#8fd3ff", 25, 60);

    const hemi = new THREE.HemisphereLight("#ffffff", "#667788", 1.6);
    const sun = new THREE.DirectionalLight("#fff6e0", 2.2);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
    this.scene.add(hemi, sun, this.statics);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: "#8fa3b3", roughness: 0.35 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", (e) => this.maybeTap(e));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearScene();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = Math.max(50, this.host.clientWidth);
    const h = Math.max(50, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ————— scene construction —————

  private clearScene(): void {
    this.statics.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.statics.clear();
    this.rigs = [];
    this.people = [];
  }

  private build(): void {
    this.clearScene();
    const w = this.app.world;
    const sc = w.scenario;
    const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });

    for (const b of w.buckets) this.rigs.push(this.buildBucket(b));

    const gantry = std("#f5b700", { metalness: 0.3 });
    for (const b of w.buckets) {
      const { pivot } = b.spec;
      for (const z of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, pivot.y, 10), gantry);
        post.position.set(pivot.x, pivot.y / 2, z * (DEPTH / 2 + 0.12));
        post.castShadow = true;
        this.statics.add(post);
      }
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, DEPTH + 0.3, 10), std("#333"));
      axle.rotation.x = Math.PI / 2;
      axle.position.set(pivot.x, pivot.y, 0);
      this.statics.add(axle);
    }

    for (const p of sc.pipes) {
      const len = 12 - p.y;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, len, 12), std(p.color || "#9aa4b2", { metalness: 0.6 }));
      pipe.position.set(p.x, p.y + len / 2, 0);
      this.statics.add(pipe);
    }
    for (const p of sc.pegs) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, DEPTH, 12), std("#264653"));
      peg.rotation.x = Math.PI / 2;
      peg.position.set(p.x, p.y, 0);
      peg.castShadow = true;
      this.statics.add(peg);
    }
    for (const r of sc.ramps) {
      const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, DEPTH), std("#e76f51"));
      ramp.position.set((r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2, 0);
      ramp.rotation.z = Math.atan2(r.b.y - r.a.y, r.b.x - r.a.x);
      ramp.castShadow = true;
      this.statics.add(ramp);
    }
    w.people.forEach((person, index) => {
      const g = new THREE.Group();
      const h = person.spec.height;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(person.width / 2, h * 0.45, 4, 10), std(person.spec.color));
      body.position.y = h * 0.45;
      const head = new THREE.Mesh(new THREE.SphereGeometry(h * 0.1, 16, 12), std("#e0ac69"));
      head.position.y = h * 0.9;
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      this.statics.add(g);
      this.people.push({ mesh: g, index });
    });

    const cap = w.particles.cap;
    this.particles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.2 }), cap);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.count = 0;
    this.statics.add(this.particles);

    // Frame the content.
    const box = contentBox(sc);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.maxY + box.minY) / 2;
    const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    this.controls.target.set(cx, cy * 0.8, 0);
    this.camera.position.set(cx + span * 0.25, cy + span * 0.4, span * 1.45);
    this.controls.update();
    this.builtFor = w;
  }

  private buildBucket(b: Bucket): BucketRig {
    const group = new THREE.Group();
    const toShape = (poly: Polygon) => {
      const s = new THREE.Shape();
      poly.forEach((p, i) => (i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y)));
      return s;
    };
    // Group origin = local origin; the whole group is posed each frame.
    const ring = wallOutline(b.model.cavity, b.spec.wall);
    const shellMat = new THREE.MeshStandardMaterial({ color: b.spec.color, roughness: 0.4, side: THREE.DoubleSide });
    const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(toShape(ring), { depth: DEPTH, bevelEnabled: false }), shellMat);
    shell.position.z = -DEPTH / 2;
    shell.castShadow = true;
    // Side plates: the outer silhouette (cavity + walls), front and back.
    const n = b.model.cavity.length;
    const outer = ring.slice(n); // outer offset points (reversed)
    const plate = toShape([...outer.reverse()]);
    const sideMat = new THREE.MeshStandardMaterial({ color: b.spec.color, roughness: 0.3, side: THREE.DoubleSide });
    for (const z of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.ShapeGeometry(plate), sideMat);
      side.position.z = (z * DEPTH) / 2 + z * 0.001;
      group.add(side);
    }
    const fluid = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: "#3aa0ff", roughness: 0.1, transparent: true, opacity: 0.85 }));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: "#552222", emissive: "#000000" }));
    // Beacon on a mast rising from the front post, clear of the swinging bucket.
    const top = b.spec.pivot.y + b.spec.shape.height + 0.3;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, top - b.spec.pivot.y, 6), new THREE.MeshStandardMaterial({ color: "#555" }));
    mast.position.set(b.spec.pivot.x, (top + b.spec.pivot.y) / 2, DEPTH / 2 + 0.12);
    beacon.position.set(b.spec.pivot.x, top, DEPTH / 2 + 0.12);
    group.add(shell);
    this.statics.add(group, fluid, mast, beacon);
    return { bucket: b, group, shellMat, sideMat, fluid, beacon };
  }

  // ————— per-frame sync —————

  update(app: App, now: number): void {
    if (this.builtFor !== app.world) this.build();
    const glass = app.toggles.transparent;
    for (const r of this.rigs) this.syncBucket(r, glass, now, app.toggles.rainbow);
    this.syncParticles(app);
    for (const { mesh, index } of this.people) {
      const p = app.world.people[index];
      if (!p) continue;
      mesh.position.set(p.spec.x, 0, 0);
      const startled = app.world.time - p.lastHit < 0.6;
      mesh.position.y = startled ? Math.abs(Math.sin(app.world.time * 18)) * 0.05 : 0;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private syncBucket(r: BucketRig, glass: boolean, now: number, rainbow: boolean): void {
    const b = r.bucket;
    const pose = b.pose;
    r.group.position.set(pose.x, pose.y, 0);
    r.group.rotation.z = pose.th;
    r.sideMat.transparent = glass;
    r.sideMat.opacity = glass ? 0.25 : 1;
    r.sideMat.depthWrite = !glass;
    r.shellMat.transparent = glass;
    r.shellMat.opacity = glass ? 0.6 : 1;

    // Fluid: extrude the (rotated-local) fluid polygon, translated to world.
    const f = b.last.fluid;
    r.fluid.geometry.dispose();
    if (f.poly.length >= 3) {
      const s = new THREE.Shape();
      f.poly.forEach((p, i) => (i ? s.lineTo(p.x + pose.x, p.y + pose.y) : s.moveTo(p.x + pose.x, p.y + pose.y)));
      r.fluid.geometry = new THREE.ExtrudeGeometry(s, { depth: DEPTH - 0.02, bevelEnabled: false });
      r.fluid.position.z = -(DEPTH - 0.02) / 2;
      const mat = r.fluid.material as THREE.MeshStandardMaterial;
      mat.color.set(rainbow ? `hsl(${(now * 60) % 360},90%,60%)` : MATERIALS[dominant(b.mix)].color);
      r.fluid.visible = true;
    } else {
      r.fluid.geometry = new THREE.BufferGeometry();
      r.fluid.visible = false;
    }

    const w = b.warning;
    const on = w > 0 && Math.sin(now * (6 + 14 * w)) > 0;
    const bm = r.beacon.material as THREE.MeshStandardMaterial;
    bm.emissive.set(on ? "#ff2a1a" : "#000000");
    bm.color.set(on ? "#ff3b30" : w > 0 ? "#8a2a22" : "#552222");
  }

  private syncParticles(app: App): void {
    const P = app.world.particles;
    const mesh = this.particles;
    for (let i = 0; i < P.count; i++) {
      const mat = MATERIALS[MATERIAL_IDS[P.mat[i]]];
      // Deterministic depth jitter per particle so streams have some body.
      const z = (((P.tint[i] * 97) % 255) / 255 - 0.5) * Z_SPREAD;
      this.dummy.position.set(P.x[i], P.y[i], z);
      this.dummy.scale.setScalar(mat.radius);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      const pal = mat.palette;
      this.color.set(pal ? pal[P.tint[i] % pal.length] : mat.color);
      mesh.setColorAt(i, this.color);
    }
    mesh.count = P.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** A tap (not a drag) on a bucket shoves it. */
  private maybeTap(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const r of this.rigs) {
      if (this.raycaster.intersectObject(r.group, true).length) {
        this.app.sound.unlock();
        r.bucket.shove();
        this.app.sound.click();
        return;
      }
    }
  }
}
