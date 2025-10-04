import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() { /* Carga mínima (logos, fuentes) si fuera necesario. */ }

  create() { this.scene.start('Preload'); }
}
