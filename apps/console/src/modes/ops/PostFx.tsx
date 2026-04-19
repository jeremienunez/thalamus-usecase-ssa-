import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";

export function PostFx() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        intensity={0.55}
        luminanceThreshold={0.45}
        luminanceSmoothing={0.18}
        kernelSize={KernelSize.LARGE}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.18} darkness={0.85} />
      <Noise opacity={0.025} blendFunction={BlendFunction.OVERLAY} />
    </EffectComposer>
  );
}
