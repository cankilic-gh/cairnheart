import * as THREE from 'three';

export interface FlashUniforms {
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
}

export const createFlash = (color: THREE.ColorRepresentation = 0xffffff): FlashUniforms => ({
  uFlash: { value: 0 },
  uFlashColor: { value: new THREE.Color(color) },
});

/** Injects a full-surface tint (hit flash, burster fuse blink) at the end of the standard shader. */
export const applyFlash = (material: THREE.Material, uniforms: FlashUniforms): void => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlash = uniforms.uFlash;
    shader.uniforms.uFlashColor = uniforms.uFlashColor;
    shader.fragmentShader =
      'uniform float uFlash;\nuniform vec3 uFlashColor;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uFlashColor, uFlash);',
      );
  };
  material.customProgramCacheKey = () => 'flash-tint';
};
