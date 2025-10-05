// src/scenes/MenuScene.js
import Phaser from 'phaser';
import '../styles/menu.css';
// import { Events, EVT } from '../core/events.js'; // opcional si vas a emitir payloads

const MENU_HTML_CONTENT = `
  <!-- start -->
  <div id="start-screen" class="screen active low-poly-bg center-col">
    <div class="glass-card">
      <h1 class="title-xl">CULTIVARIUM</h1>
      <div class="btn-stack">
        <button id="btn-start" class="btn-primary">INICIAR JUEGO</button>
        <button class="btn-secondary" disabled>VIDEOTUTORIAL (Próx.)</button>
      </div>
    </div>
  </div>

  <!-- perfil -->
  <div id="profile-screen" class="screen low-poly-bg center-col">
    <div class="glass-panel">
      <h2 class="subtitle">Crea tu Perfil de Agente</h2>
      <div class="btn-stack">
        <input id="player-name" class="input-underline" type="text" placeholder="Tu Nombre">
        <select id="player-country" class="select-underline">
          <option>Perú</option><option>India</option><option>Brasil</option>
          <option>Etiopía</option><option>EE.UU.</option>
        </select>
      </div>
      <button id="btn-profile-next" class="btn-primary mt-12">Continuar</button>
    </div>
  </div>

  <!-- modo -->
  <div id="mode-select-screen" class="screen low-poly-bg center-col">
    <div class="glass-panel" style="width:min(92vw,960px);">
      <h2 class="subtitle">Selecciona tu Misión</h2>
      <div class="cards-row">
        <div id="card-adventure" class="card-option card-option--adv">
          <h3>Modo Aventura</h3>
          <p>Campaña global por biomas y niveles.</p>
        </div>
        <div id="card-legacy" class="card-option card-option--leg">
          <h3>Modo Legado</h3>
          <p>Sandbox infinito en una región.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- mapa aventura -->
  <div id="adventure-map-screen" class="screen world-map-container">
    <div id="level-peru"   class="level-node"        style="top:70%; left:25%;">🇵🇪</div>
    <div id="level-india"  class="level-node locked" style="top:45%; left:60%;">🇮🇳</div>
    <div id="level-ethi"   class="level-node locked" style="top:55%; left:50%;">🇪🇹</div>
    <div id="level-brazil" class="level-node locked" style="top:65%; left:35%;">🇧🇷</div>
    <div id="level-usa"    class="level-node locked" style="top:35%; left:20%;">🇺🇸</div>
  </div>
`;

export default class MenuScene extends Phaser.Scene {
  constructor(){ super('Menu'); }

  create() {
    console.log('[MenuScene] up');

    // 1) Creamos un root <div> y metemos el contenido (SIN <style>)
    const el = document.createElement('div');
    el.id = 'cv-menu-root';
    el.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
    // Estilos globales mínimos que antes estaban en <style>
    // (puedes mover esto a index.css si quieres)
    el.style.fontFamily = 'Inter, ui-sans-serif, system-ui, sans-serif';
    el.innerHTML = MENU_HTML_CONTENT;

    // 2) DOMElement
    this.root = this.add.dom(0, 0, el).setOrigin(0, 0);
    const dc = this.game.domContainer;
    if (dc) { dc.style.position='absolute'; dc.style.inset='0'; dc.style.zIndex='1000'; dc.style.pointerEvents='auto'; }
    this.root.setDepth(1000);
    this.root.setScrollFactor(0);
    this.root.node.style.pointerEvents = 'auto';

    // 3) Overlay alineado al área visible (Scale.FIT)
    this._onResize = () => {
      if (!this.root || !this.root.node) return;
      const s = this.scale;
      if (!s.displaySize || !s.parentSize) return;

      const viewW = s.displaySize.width;
      const viewH = s.displaySize.height;
      const parentW = s.parentSize.width;
      const parentH = s.parentSize.height;
      const offX = ((parentW - viewW) / 2) | 0;
      const offY = ((parentH - viewH) / 2) | 0;

      const n = this.root.node;
      n.style.left = offX + 'px';
      n.style.top  = offY + 'px';
      n.style.width  = viewW + 'px';
      n.style.height = viewH + 'px';
    };
    this._onResize();
    this.scale.on('resize', this._onResize, this);

    // 4) Helpers y navegación
    const q  = (id)  => this.root.node.querySelector('#' + id);
    const qa = (sel) => this.root.node.querySelectorAll(sel);
    const show = (id) => { qa('.screen').forEach(el=>el.classList.remove('active')); q(id)?.classList.add('active'); };

    q('btn-start')?.addEventListener('click', () => show('profile-screen'));
    q('btn-profile-next')?.addEventListener('click', () => {
      const name = q('player-name')?.value?.trim();
      const country = q('player-country')?.value;
      this.profile = { name: name || 'Jugador', country: country || 'Perú' };
      show('mode-select-screen');
    });
    q('card-adventure')?.addEventListener('click', () => show('adventure-map-screen'));
    q('card-legacy')?.addEventListener('click', () => {
      this.startGame({ mode:'legacy', regionKey:'pe_lima', levelId:null, profile:this.profile });
    });
    q('level-peru')?.addEventListener('click', () => {
      this.startGame({ mode:'adventure', levelId:'L1', regionKey:'pe_lima', profile:this.profile });
    });

    show('start-screen');
  }

  startGame(payload){
    window.__CV_START__ = payload;

    this.scale.off('resize', this._onResize, this);
    this.root?.destroy();

    const dc = this.game.domContainer;
    if (dc) {
      dc.style.pointerEvents = 'none';
      dc.style.zIndex = '0';
    }

    this.scene.stop();
    this.scene.start('Boot');
  }
}
