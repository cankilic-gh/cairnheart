import * as THREE from 'three';
import { clamp, damp } from './math';

export const CAMERA_AZIMUTH = Math.PI / 4;

/** Fixed-angle isometric follow camera. */
export class CameraRig {
  readonly azimuth = CAMERA_AZIMUTH;
  elevation = 0.93;
  distance = 30;
  targetDistance = 15;

  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private portraitScale = 1;
  private readonly reducedMotion: boolean;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Portrait screens get a wider lens and a longer boom so the arena stays readable. */
  setAspect(aspect: number): void {
    const narrow = clamp(1 - aspect, 0, 0.6);
    this.camera.fov = 34 + narrow * 30;
    this.portraitScale = 1 + narrow * 0.85;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  zoomBy(deltaY: number): void {
    this.targetDistance = clamp(this.targetDistance * Math.exp(deltaY * 0.0012), 11, 30);
  }

  kick(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(0.5, this.shake + amount);
  }

  snap(target: THREE.Vector3): void {
    this.focus.copy(target);
  }

  update(dt: number, target: THREE.Vector3, velX: number, velZ: number): void {
    this.time += dt;
    this.desired.set(target.x + velX * 0.3, target.y, target.z + velZ * 0.3);
    this.focus.lerp(this.desired, 1 - Math.exp(-dt * 5));
    this.distance = damp(this.distance, this.targetDistance, 3.5, dt);

    const d = this.distance * this.portraitScale;
    const flat = Math.cos(this.elevation) * d;
    const cam = this.camera;
    cam.position.set(
      this.focus.x + Math.sin(this.azimuth) * flat,
      this.focus.y + Math.sin(this.elevation) * d,
      this.focus.z + Math.cos(this.azimuth) * flat,
    );
    if (this.shake > 0.001) {
      const s = this.shake;
      cam.position.x += Math.sin(this.time * 41) * s * 0.07;
      cam.position.y += Math.sin(this.time * 53 + 1.7) * s * 0.11;
      cam.position.z += Math.sin(this.time * 37 + 0.6) * s * 0.07;
    }
    this.shake *= Math.exp(-dt * 8);
    cam.lookAt(this.focus.x, this.focus.y + 1.3, this.focus.z);
  }
}
