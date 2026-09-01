import * as THREE from "three";
import { TickFrame } from "@/lib/types";

interface ParticleSystem {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  lifetimes: Float32Array;
  maxLifetimes: Float32Array;
  count: number;
}

export class ParticleEffectsManager {
  public group: THREE.Group;
  private exhaustSystem!: ParticleSystem;
  private oilSystem!: ParticleSystem;
  private coolantSystem!: ParticleSystem;

  private emitterPositions: THREE.Vector3[] = [];
  private oilNodes: THREE.Vector3[] = [];
  private coolantNodes: THREE.Vector3[] = [];

  constructor(
    exhaustEmitters: THREE.Vector3[],
    oilNodes: THREE.Vector3[],
    coolantNodes: THREE.Vector3[]
  ) {
    this.group = new THREE.Group();
    this.emitterPositions = exhaustEmitters;
    this.oilNodes = oilNodes;
    this.coolantNodes = coolantNodes;

    this.initExhaustParticles();
    this.initOilParticles();
    this.initCoolantParticles();
  }

  private initExhaustParticles() {
    const count = 120;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifetimes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const emitter = this.emitterPositions[i % this.emitterPositions.length] || new THREE.Vector3(0, -0.8, -1.2);
      positions[i * 3] = emitter.x;
      positions[i * 3 + 1] = emitter.y;
      positions[i * 3 + 2] = emitter.z;

      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = -0.04 - Math.random() * 0.03;
      velocities[i * 3 + 2] = -0.05 - Math.random() * 0.04;

      colors[i * 3] = 1.0;     // R
      colors[i * 3 + 1] = 0.5; // G
      colors[i * 3 + 2] = 0.1; // B

      lifetimes[i] = Math.random() * 1.5;
      maxLifetimes[i] = 1.5 + Math.random() * 1.0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.group.add(points);

    this.exhaustSystem = {
      points,
      geometry,
      material,
      positions,
      velocities,
      colors,
      lifetimes,
      maxLifetimes,
      count,
    };
  }

  private initOilParticles() {
    const count = 60;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifetimes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const nodeIndex = i % (this.oilNodes.length || 1);
      const startNode = this.oilNodes[nodeIndex] || new THREE.Vector3(0, -0.7, 0);

      positions[i * 3] = startNode.x + (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 1] = startNode.y + (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 2] = startNode.z + (Math.random() - 0.5) * 0.2;

      velocities[i * 3] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 1] = 0.015 + Math.random() * 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;

      colors[i * 3] = 0.3;     // R
      colors[i * 3 + 1] = 0.85; // G (amber/green for oil)
      colors[i * 3 + 2] = 0.4; // B

      lifetimes[i] = Math.random() * 2.0;
      maxLifetimes[i] = 2.0 + Math.random() * 1.0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.group.add(points);

    this.oilSystem = {
      points,
      geometry,
      material,
      positions,
      velocities,
      colors,
      lifetimes,
      maxLifetimes,
      count,
    };
  }

  private initCoolantParticles() {
    const count = 60;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifetimes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const nodeIndex = i % (this.coolantNodes.length || 1);
      const startNode = this.coolantNodes[nodeIndex] || new THREE.Vector3(-0.9, 0.8, 0.2);

      positions[i * 3] = startNode.x + (Math.random() - 0.5) * 0.15;
      positions[i * 3 + 1] = startNode.y + (Math.random() - 0.5) * 0.15;
      positions[i * 3 + 2] = startNode.z + (Math.random() - 0.5) * 0.15;

      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = -0.015;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;

      // Cyan / Blue coolant
      colors[i * 3] = 0.2;
      colors[i * 3 + 1] = 0.7;
      colors[i * 3 + 2] = 0.95;

      lifetimes[i] = Math.random() * 2.0;
      maxLifetimes[i] = 2.0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.group.add(points);

    this.coolantSystem = {
      points,
      geometry,
      material,
      positions,
      velocities,
      colors,
      lifetimes,
      maxLifetimes,
      count,
    };
  }

  public update(delta: number, frame: TickFrame | null) {
    const rpm = frame?.sensors?.rpm ?? 2500;
    const rpmScale = Math.max(0.2, Math.min(2.5, rpm / 3000));

    const oilPress = frame?.sensors?.oil_press_bar ?? 3.5;
    const oilSpeedScale = Math.max(0.1, oilPress / 3.5);

    const coolantTemp = frame?.sensors?.coolant_temp_c ?? 85;
    const isCoolantHot = coolantTemp > 105;

    // 1. Update Exhaust
    const egts = [
      frame?.sensors?.egt_1 ?? 800,
      frame?.sensors?.egt_2 ?? 800,
      frame?.sensors?.egt_3 ?? 800,
      frame?.sensors?.egt_4 ?? 800,
    ];

    const exhaustPos = this.exhaustSystem.positions;
    const exhaustColors = this.exhaustSystem.colors;
    const exhaustLifetimes = this.exhaustSystem.lifetimes;
    const exhaustMaxLife = this.exhaustSystem.maxLifetimes;

    for (let i = 0; i < this.exhaustSystem.count; i++) {
      exhaustLifetimes[i] += delta * rpmScale;

      if (exhaustLifetimes[i] >= exhaustMaxLife[i]) {
        exhaustLifetimes[i] = 0;
        const emitterIdx = i % this.emitterPositions.length;
        const emitter = this.emitterPositions[emitterIdx] || new THREE.Vector3(0, -0.8, -1.2);
        exhaustPos[i * 3] = emitter.x + (Math.random() - 0.5) * 0.1;
        exhaustPos[i * 3 + 1] = emitter.y + (Math.random() - 0.5) * 0.1;
        exhaustPos[i * 3 + 2] = emitter.z;

        // Color mapped to cylinder EGT
        const cylEgt = egts[emitterIdx] ?? 800;
        if (cylEgt < 600) {
          // Cold misfire (Ignition Fault Cyl 3 drop) -> Blueish smoke
          exhaustColors[i * 3] = 0.3;
          exhaustColors[i * 3 + 1] = 0.5;
          exhaustColors[i * 3 + 2] = 0.9;
        } else if (cylEgt > 900) {
          // Severe overheat / Injector Fault lean burn -> Bright White-Red
          exhaustColors[i * 3] = 1.0;
          exhaustColors[i * 3 + 1] = 0.2;
          exhaustColors[i * 3 + 2] = 0.05;
        } else {
          // Nominal exhaust glow -> Amber / Orange
          exhaustColors[i * 3] = 1.0;
          exhaustColors[i * 3 + 1] = 0.55;
          exhaustColors[i * 3 + 2] = 0.1;
        }
      } else {
        exhaustPos[i * 3] += this.exhaustSystem.velocities[i * 3] * rpmScale;
        exhaustPos[i * 3 + 1] += this.exhaustSystem.velocities[i * 3 + 1] * rpmScale;
        exhaustPos[i * 3 + 2] += this.exhaustSystem.velocities[i * 3 + 2] * rpmScale;
      }
    }
    this.exhaustSystem.geometry.attributes.position.needsUpdate = true;
    this.exhaustSystem.geometry.attributes.color.needsUpdate = true;

    // 2. Update Oil System
    const oilPos = this.oilSystem.positions;
    const oilLifetimes = this.oilSystem.lifetimes;
    const oilMaxLife = this.oilSystem.maxLifetimes;

    for (let i = 0; i < this.oilSystem.count; i++) {
      oilLifetimes[i] += delta * oilSpeedScale;
      if (oilLifetimes[i] >= oilMaxLife[i]) {
        oilLifetimes[i] = 0;
        const nodeIdx = i % (this.oilNodes.length || 1);
        const node = this.oilNodes[nodeIdx] || new THREE.Vector3(0, -0.7, 0);
        oilPos[i * 3] = node.x + (Math.random() - 0.5) * 0.1;
        oilPos[i * 3 + 1] = node.y + (Math.random() - 0.5) * 0.1;
        oilPos[i * 3 + 2] = node.z + (Math.random() - 0.5) * 0.1;
      } else {
        oilPos[i * 3] += this.oilSystem.velocities[i * 3] * oilSpeedScale;
        oilPos[i * 3 + 1] += this.oilSystem.velocities[i * 3 + 1] * oilSpeedScale;
        oilPos[i * 3 + 2] += this.oilSystem.velocities[i * 3 + 2] * oilSpeedScale;
      }
    }
    this.oilSystem.geometry.attributes.position.needsUpdate = true;

    // 3. Update Coolant System
    const coolantPos = this.coolantSystem.positions;
    const coolantColors = this.coolantSystem.colors;
    const coolantLifetimes = this.coolantSystem.lifetimes;
    const coolantMaxLife = this.coolantSystem.maxLifetimes;

    for (let i = 0; i < this.coolantSystem.count; i++) {
      coolantLifetimes[i] += delta;
      if (coolantLifetimes[i] >= coolantMaxLife[i]) {
        coolantLifetimes[i] = 0;
        const nodeIdx = i % (this.coolantNodes.length || 1);
        const node = this.coolantNodes[nodeIdx] || new THREE.Vector3(-0.9, 0.8, 0.2);
        coolantPos[i * 3] = node.x + (Math.random() - 0.5) * 0.1;
        coolantPos[i * 3 + 1] = node.y + (Math.random() - 0.5) * 0.1;
        coolantPos[i * 3 + 2] = node.z + (Math.random() - 0.5) * 0.1;

        if (isCoolantHot) {
          coolantColors[i * 3] = 0.95;
          coolantColors[i * 3 + 1] = 0.3;
          coolantColors[i * 3 + 2] = 0.2;
        } else {
          coolantColors[i * 3] = 0.2;
          coolantColors[i * 3 + 1] = 0.7;
          coolantColors[i * 3 + 2] = 0.95;
        }
      } else {
        coolantPos[i * 3] += this.coolantSystem.velocities[i * 3];
        coolantPos[i * 3 + 1] += this.coolantSystem.velocities[i * 3 + 1];
        coolantPos[i * 3 + 2] += this.coolantSystem.velocities[i * 3 + 2];
      }
    }
    this.coolantSystem.geometry.attributes.position.needsUpdate = true;
    this.coolantSystem.geometry.attributes.color.needsUpdate = true;
  }
}
