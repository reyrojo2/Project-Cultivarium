import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';

export const GAME = {
  WIDTH: 1024,
  HEIGHT: 576
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
  scene: [BootScene, PreloadScene, GameScene, UIScene]
};

// Exponer para depurar por consola.
window.__PHASER_GAME__ = new Phaser.Game(config);
