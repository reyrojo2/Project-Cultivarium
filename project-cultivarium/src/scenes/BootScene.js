import Phaser from 'phaser';

export default class BootScene extends Phaser.Scene {
  constructor(){ super('Boot'); }
  create(){
    console.log('[Boot] create');
    this.scene.start('Preload');
  }
}
