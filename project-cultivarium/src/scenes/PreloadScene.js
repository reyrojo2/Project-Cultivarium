/**
 * Preload: genera texturas básicas en memoria para prototipado rápido.
 * En producción, reemplaza por sprites reales en /public/assets.
 */
import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  preload() {

    const parcelsRaw = [
      'isometric_block (9).png',
      'isometric_block (10).png',
      'isometric_block (11).png'
    ];
    const grassRaw = [
      'isometric_block (12).png',
      'isometric_block (13).png',
      'isometric_block (14).png'
    ];

    parcelsRaw.forEach((file, i) => {
      // encodeURIComponent permite usar nombres con espacios/paréntesis
      this.load.image(`parcel_${i}`, `/assets/${encodeURIComponent(file)}`);
    });
    grassRaw.forEach((file, i) => {
      this.load.image(`grass_${i}`, `/assets/${encodeURIComponent(file)}`);
    });
      const g = this.make.graphics({ x: 0, y: 0, add: false });

    // === ORTHO (cuadrado) ===
    g.fillStyle(0x14532d, 1); // verde oscuro
    g.fillRect(0, 0, 64, 64);
    g.lineStyle(2, 0x16a34a, 1);
    g.strokeRect(1, 1, 62, 62);
    g.generateTexture('parcel', 64, 64);
    g.clear();

    // === ISO (rombo) ===
    const w = 64, h = 32; // proporción clásica isométrica
    const halfW = w / 2, halfH = h / 2;
    g.fillStyle(0x14532d, 1);
    g.beginPath();
    g.moveTo(halfW, 0);
    g.lineTo(w, halfH);
    g.lineTo(halfW, h);
    g.lineTo(0, halfH);
    g.closePath();
    g.fillPath();
    g.lineStyle(2, 0x16a34a, 1);
    g.strokePath();
    g.generateTexture('iso-parcel', w, h);
    g.clear();

    // Player (círculo)
    g.fillStyle(0x22c55e, 1);
    g.fillCircle(12, 12, 12);
    g.generateTexture('player', 24, 24);
    g.clear();

    // Icono alerta (triángulo)
    g.fillStyle(0xfbbf24, 1);
    g.fillTriangle(12,0, 24,24, 0,24);
    g.lineStyle(3, 0x1f2937, 1);
    g.strokeTriangle(12,0, 24,24, 0,24);
    g.generateTexture('alert', 24, 24);
    g.clear();
  }

  create() {
    this.scene.start('Game');
    this.scene.launch('UI');
  }
}
