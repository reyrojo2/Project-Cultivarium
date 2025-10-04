import { Events, EVT } from '../core/events';
export default class MenuScene extends Phaser.Scene {
  constructor(){ super('Menu'); }
  create(){
    // … UI simple …
    Events.emit(EVT.MENU_START_GAME, { levelId:'L1', regionKey:'pe_piura' });
  }
}
