/**
 * Preload: genera texturas básicas en memoria para prototipado rápido.
 * En producción, reemplaza por sprites reales en /public/assets.
 */
import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // Textura de PARCELA
    g.fillStyle(0x14532d, 1); // verde oscuro
    g.fillRect(0, 0, 64, 64);
    g.lineStyle(2, 0x16a34a, 1);
    g.strokeRect(1, 1, 62, 62);
    g.generateTexture('parcel', 64, 64);
    g.clear();

    // Player
    g.fillStyle(0x22c55e, 1); g.fillCircle(12, 12, 12);
    g.generateTexture('player', 24, 24); g.clear();

    // Icono alerta
    g.fillStyle(0xfbbf24, 1); g.fillTriangle(12,0, 24,24, 0,24);
    g.lineStyle(3, 0x1f2937, 1); g.strokeTriangle(12,0, 24,24, 0,24);
    g.generateTexture('alert', 24, 24); g.clear();
  }

  create() {
    this.scene.start('Game');
    this.scene.launch('UI');
  }
}
