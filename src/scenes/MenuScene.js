// src/scenes/MenuScene.js
import Phaser from 'phaser';
// import { Events, EVT } from '../core/events.js'; // opcional si vas a emitir payloads

// ⚠️ SIN <style> ADENTRO y con UN ÚNICO root (lo metemos dentro de un <div> que creamos nosotros)
const MENU_HTML_CONTENT = `
  <!-- start -->
  <div id="start-screen" class="screen active low-poly-bg" style="align-items:center; justify-content:center; flex-direction:column;">
    <h1 style="font-size:5rem; font-weight:800; color:white; text-shadow: 2px 2px 8px rgba(0,0,0,.6); margin-bottom:1.5rem;">CULTIVARIUM</h1>
    <div style="display:flex; gap:1rem; flex-direction:column;">
      <button id="btn-start" class="btn-primary">INICIAR JUEGO</button>
      <button class="btn-secondary" disabled>VIDEOTUTORIAL (Próx.)</button>
    </div>
  </div>

  <!-- perfil -->
  <div id="profile-screen" class="screen low-poly-bg" style="align-items:center; justify-content:center;">
    <div class="glass-panel" style="padding:3rem; width:min(90vw,560px); text-align:center;">
      <h2 style="font-size:2rem; font-weight:800; margin-bottom:1rem;">Crea tu Perfil de Agente</h2>
      <div style="display:flex; gap:1rem; flex-direction:column;">
        <input id="player-name" type="text" placeholder="Tu Nombre" style="background:transparent; border-bottom:2px solid #ffffff88; color:white; font-size:1.2rem; padding:.5rem; text-align:center;">
        <select id="player-country" style="background:transparent; border-bottom:2px solid #ffffff88; color:white; font-size:1.2rem; padding:.5rem; text-align:center;">
          <option>Perú</option><option>India</option><option>Brasil</option><option>Etiopía</option><option>EE.UU.</option>
        </select>
      </div>
      <button id="btn-profile-next" class="btn-primary" style="margin-top:1.2rem;">Continuar</button>
    </div>
  </div>

  <!-- modo -->
  <div id="mode-select-screen" class="screen low-poly-bg" style="align-items:center; justify-content:center;">
    <div class="glass-panel" style="padding:3rem; width:min(92vw,960px); text-align:center;">
      <h2 style="font-size:2rem; font-weight:800; margin-bottom:1rem;">Selecciona tu Misión</h2>
      <div style="display:flex; gap:1rem; flex-wrap:wrap; justify-content:center;">
        <div id="card-adventure" style="flex:1 1 320px; border:2px solid #22d3ee; border-radius:1rem; padding:1rem; cursor:pointer;">
          <h3 style="color:#22d3ee; font-weight:800;">Modo Aventura</h3>
          <p>Campaña global por biomas y niveles.</p>
        </div>
        <div id="card-legacy" style="flex:1 1 320px; border:2px solid #facc15; border-radius:1rem; padding:1rem; cursor:pointer;">
          <h3 style="color:#facc15; font-weight:800;">Modo Legado</h3>
          <p>Sandbox infinito en una región.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- mapa aventura -->
  <div id="adventure-map-screen" class="screen world-map-container" style="position:relative;">
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

    // estilos utilitarios usados por el HTML (antes en <style>)
    const styleTag = document.createElement('style');
    styleTag.textContent = `
      .screen{display:none;width:100%;height:100%;position:absolute;inset:0}
      .screen.active{display:flex}
      .low-poly-bg{background:#8DA86C}
      .glass-panel{background:rgba(15,23,42,.6);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:1.5rem;color:#F4F0E1}
      .btn-primary{background:#E6D6A6;color:#5B3A29;padding:.8rem 2rem;border-radius:9999px;font-weight:700;cursor:pointer}
      .btn-secondary{background:transparent;border:2px solid #E6D6A6;color:#E6D6A6;padding:.8rem 2rem;border-radius:9999px;font-weight:700}
      .level-node{position:absolute;width:60px;height:60px;background:#C85E4B;border:3px solid #F4F0E1;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;cursor:pointer;box-shadow:0 5px 15px rgba(0,0,0,.4)}
      .level-node.locked{background:#5E7A47;cursor:not-allowed;opacity:.6}
      .world-map-container{background-image:url('assets/map.jpeg');background-size:cover;background-position:center}
    `;
    this.root.node.prepend(styleTag);

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
