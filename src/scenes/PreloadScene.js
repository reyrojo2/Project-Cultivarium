import Phaser from 'phaser';

export default class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  preload() {
    console.log('[Preload] preload');
    // coloca los PNG en /public/assets/
    this.load.image('Acid1', '/assets/Acid1.png');
    this.load.image('Acid2', '/assets/Acid2.png');
    this.load.image('Lava1', '/assets/Lava1.png');
    this.load.image('Lava3', '/assets/Lava3.png');
    this.load.image('Ground2', '/assets/Ground2.png');
    this.load.image('Ground3', '/assets/Ground3.png');
    this.load.image('Ground4', '/assets/Ground4.png');

    // opcional: player + alerta si los usas
    this.load.image('player', '/assets/player.png'); // o quita estas dos
    this.load.image('alert', '/assets/alert.png');
  }

  create() {
    console.log('[Preload] create');
    this.scene.start('Game');
    this.scene.launch('UI');
  }
}
