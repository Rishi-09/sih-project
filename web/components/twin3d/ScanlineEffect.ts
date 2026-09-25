import * as THREE from "three";

/** Radial falloff so the sweep fades out instead of ending on a hard edge. */
function radialGradientTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0.0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0.0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ScanlineEffect {
  public mesh: THREE.Mesh;
  private currentY: number = -1.2;
  private minY: number = -1.2;
  private maxY: number = 1.4;
  private speed: number = 0.9;
  private texture: THREE.Texture;
  private ringMaterial: THREE.MeshBasicMaterial;

  constructor() {
    // A disc, not a 5x5 quad: the old square plane covered the whole grid and
    // lifted the floor to a flat grey rectangle in every frame.
    const geometry = new THREE.CircleGeometry(2.1, 64);
    geometry.rotateX(-Math.PI / 2);

    this.texture = radialGradientTexture();
    const material = new THREE.MeshBasicMaterial({
      color: 0x54c6d1,
      map: this.texture,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 2;
    this.mesh.position.y = this.currentY;

    // Thin leading edge on the sweep
    const ringGeo = new THREE.RingGeometry(2.06, 2.1, 96);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8be9fd,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ringMaterial = ringMat;
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.renderOrder = 2;
    this.mesh.add(ringMesh);
  }

  public update(delta: number) {
    this.currentY += this.speed * delta;
    if (this.currentY > this.maxY) {
      this.currentY = this.minY;
    }
    this.mesh.position.y = this.currentY;

    // Fade the sweep out as it clears the top of the engine.
    const travel = (this.currentY - this.minY) / (this.maxY - this.minY);
    const fade = Math.sin(travel * Math.PI);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.06 + fade * 0.16;
    this.ringMaterial.opacity = 0.04 + fade * 0.2;
  }

  public dispose() {
    this.texture.dispose();
    this.ringMaterial.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
