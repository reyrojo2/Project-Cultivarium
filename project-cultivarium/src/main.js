import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';

export const GAME = {
  WIDTH: 1024,
  HEIGHT: 576,
  ISO_MODE: true,
  ISO_TILE_W: 128,   // ancho real de tu sprite
  ISO_TILE_H: 64, 
  TILE_SCALE: 0.300    // alto real de tu sprite
};

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0f172a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME.WIDTH,
    height: GAME.HEIGHT
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  render: { pixelArt: true, antialias: false, roundPixels: true },
  scene: [BootScene, PreloadScene, GameScene, UIScene]
};

// Exponer para depurar por consola.
window.__PHASER_GAME__ = new Phaser.Game(config);
