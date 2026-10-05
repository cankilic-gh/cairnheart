import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  setSize(w: number, h: number): void;
}

export const createPost = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post => {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.4, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer,
    bloom,
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      // Glow is soft by nature: blur at quarter resolution (the pass halves this again internally).
      bloom.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
    },
  };
};
