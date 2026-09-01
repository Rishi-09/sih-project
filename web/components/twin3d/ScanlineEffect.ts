import * as THREE from "three";

export class ScanlineEffect {
  public mesh: THREE.Mesh;
  private currentY: number = -1.5;
  private minY: number = -1.5;
  private maxY: number = 2.0;
  private speed: number = 1.2;

  constructor() {
    // A horizontal plane with a subtle holographic cyan gradient line
    const geometry = new THREE.PlaneGeometry(5.0, 5.0);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshBasicMaterial({
      color: 0x54c6d1,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = this.currentY;

    // Add a ring border to the scanner plane
    const ringGeo = new THREE.RingGeometry(2.2, 2.3, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x8be9fd,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.mesh.add(ringMesh);
  }

  public update(delta: number) {
    this.currentY += this.speed * delta;
    if (this.currentY > this.maxY) {
      this.currentY = this.minY;
    }
    this.mesh.position.y = this.currentY;
  }
}
