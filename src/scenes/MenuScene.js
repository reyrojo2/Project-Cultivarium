// src/scenes/MenuScene.js
import Phaser from 'phaser';
import '../styles/menu.css';
import { DEFAULT_LANGUAGE, getLanguage, setLanguage, translate as t } from '../utils/i18n.js';

const MENU_HTML_CONTENT = `
  <!-- Botón flotante de idioma -->
  <button id="lang-fab" class="lang-floating-btn" aria-haspopup="true" aria-expanded="false" title="Idioma">🌐</button>
  <div id="lang-menu" class="lang-menu" role="menu" aria-hidden="true">
    <button id="lang-es" class="lang-item" role="menuitem">ES</button>
    <button id="lang-en" class="lang-item" role="menuitem">EN</button>
  </div>

  <!-- start -->
  <div id="start-screen" class="screen active low-poly-bg center-col">
    <div class="glass-card">
      <h1 class="title-xl" data-i18n="menu.title">CULTIVARIUM</h1>
      <div class="btn-stack">
        <button id="btn-start" class="btn-primary" data-i18n="menu.startButton">INICIAR JUEGO</button>
        <button id="btn-video" class="btn-secondary" data-i18n="menu.videoButton" disabled>VIDEOTUTORIAL (Próx.)</button>
      </div>
    </div>
  </div>

  <!-- perfil -->
  <div id="profile-screen" class="screen low-poly-bg center-col">
    <div class="glass-panel">
      <h2 class="subtitle" data-i18n="menu.profileTitle">Crea tu Perfil de Agente</h2>
      <div class="btn-stack">
        <input id="player-name" class="input-underline" type="text" placeholder="Tu Nombre" data-i18n-placeholder="menu.playerNamePlaceholder">
        <select id="player-country" class="select-underline">
          <option data-i18n-option="menu.countries.peru">Perú</option>
          <option data-i18n-option="menu.countries.india">India</option>
          <option data-i18n-option="menu.countries.brazil">Brasil</option>
          <option data-i18n-option="menu.countries.ethiopia">Etiopía</option>
          <option data-i18n-option="menu.countries.usa">EE.UU.</option>
        </select>
      </div>
      <button id="btn-profile-next" class="btn-primary mt-12" data-i18n="menu.profileContinue">Continuar</button>
    </div>
  </div>

  <!-- modo -->
  <div id="mode-select-screen" class="screen low-poly-bg center-col">
    <div class="glass-panel" style="width:min(92vw,960px);">
      <h2 class="subtitle" data-i18n="menu.modeSelectTitle">Selecciona tu Misión</h2>
      <div class="cards-row">
        <div id="card-adventure" class="card-option card-option--adv">
          <h3 data-i18n="menu.modeAdventureTitle">Modo Aventura</h3>
          <p data-i18n="menu.modeAdventureDescription">Campaña global por biomas y niveles.</p>
        </div>
        <div id="card-legacy" class="card-option card-option--leg">
          <h3 data-i18n="menu.modeLegacyTitle">Modo Legado</h3>
          <p data-i18n="menu.modeLegacyDescription">Sandbox infinito en una región.</p>
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

    // 1) Root DOM
    const el = document.createElement('div');
    el.id = 'cv-menu-root';
    el.className = 'cv-root'; // para que aplique tu menu.css
    el.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
    el.innerHTML = MENU_HTML_CONTENT;

    // 2) DOMElement
    this.root = this.add.dom(0, 0, el).setOrigin(0, 0);
    const dc = this.game.domContainer;
    if (dc) {
      dc.style.position='absolute';
      dc.style.inset='0';
      dc.style.zIndex='1000';
      dc.style.pointerEvents='auto'; // clave: permitir clicks
    }
    this.root.setDepth(1000);
    this.root.setScrollFactor(0);
    this.root.node.style.pointerEvents = 'auto';

    // 3) Overlay alineado al área visible
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
      n.style.left   = offX + 'px';
      n.style.top    = offY + 'px';
      n.style.width  = viewW + 'px';
      n.style.height = viewH + 'px';
    };
    this._onResize();
    this.scale.on('resize', this._onResize, this);

    // 4) Helpers
    const $  = (sel) => this.root.node.querySelector(sel);
    const $$ = (sel) => this.root.node.querySelectorAll(sel);
    const show = (id) => { $$('.screen').forEach(el=>el.classList.remove('active')); $(`#${id}`)?.classList.add('active'); };

    // ===== i18n: aplicar traducciones =====
    const applyLanguage = (lang) => {
      const targetLang = setLanguage(lang);
      this.currentLanguage = targetLang;

      // data-i18n → texto
      $$('[data-i18n]').forEach((node) => {
        const key = node.getAttribute('data-i18n');
        if (!key) return;
        const value = t(key, {}, targetLang);
        if (typeof value === 'string' && value !== key){node.textContent = value}
      });

      // data-i18n-placeholder → placeholder
      $$('[data-i18n-placeholder]').forEach((node) => {
        const key = node.getAttribute('data-i18n-placeholder');
        if (!key) return;
        const value = t(key, {}, targetLang);
        if (typeof value === 'string') node.setAttribute('placeholder', value);
      });

      // data-i18n-option → <option>
      $$('[data-i18n-option]').forEach((node) => {
        const key = node.getAttribute('data-i18n-option');
        if (!key) return;
        const value = t(key, {}, targetLang);
        if (typeof value === 'string') { node.textContent = value; node.value = value; }
      });

      // Etiqueta del FAB
      const btnFab = $('#lang-fab');
      if (btnFab) btnFab.textContent = `🌐 ${targetLang.toUpperCase()}`;
    };

    // Idioma inicial
    applyLanguage(getLanguage() || DEFAULT_LANGUAGE);

    // ===== Botón 🌐 y menú de idioma =====
    const btnFab   = $('#lang-fab');
    const menuLang = $('#lang-menu');
    const btnES    = $('#lang-es');
    const btnEN    = $('#lang-en');

    const closeLangMenu = () => {
      menuLang.classList.remove('open');
      btnFab?.setAttribute('aria-expanded', 'false');
      menuLang?.setAttribute('aria-hidden', 'true');
    };
    const toggleLangMenu = () => {
      const isOpen = menuLang.classList.toggle('open');
      btnFab?.setAttribute('aria-expanded', String(isOpen));
      menuLang?.setAttribute('aria-hidden', String(!isOpen));
    };

    btnFab?.addEventListener('click', (e) => { e.stopPropagation(); toggleLangMenu(); });
    btnES?.addEventListener('click', (e) => { e.stopPropagation(); applyLanguage('es'); closeLangMenu(); });
    btnEN?.addEventListener('click', (e) => { e.stopPropagation(); applyLanguage('en'); closeLangMenu(); });

    // Cerrar al clic fuera
    this.root.node.addEventListener('click', (e) => {
      const within = e.target === btnFab || menuLang.contains(e.target);
      if (!within) closeLangMenu();
    });

    // Cerrar con ESC
    this.input.keyboard?.on('keydown-ESC', closeLangMenu);

    // ===== Navegación =====
    $('#btn-start')?.addEventListener('click', () => show('profile-screen'));
    $('#btn-profile-next')?.addEventListener('click', () => {
      const name = $('#player-name')?.value?.trim();
      const country = $('#player-country')?.value;
      const defaultName = t('menu.defaultPlayerName') || 'Jugador';
      const defaultCountry = t('menu.countries.peru') || 'Perú';
      this.profile = { name: name || defaultName, country: country || defaultCountry };
      show('mode-select-screen');
    });
    $('#card-adventure')?.addEventListener('click', () => show('adventure-map-screen'));
    $('#card-legacy')?.addEventListener('click', () => {
      this.startGame({ mode:'legacy', regionKey:'pe_lima', levelId:null, profile:this.profile });
    });
    $('#level-peru')?.addEventListener('click', () => {
      this.startGame({ mode:'adventure', levelId:'L1', regionKey:'pe_lima', profile:this.profile });
    });

    show('start-screen');
  }

  startGame(payload){
    const language = this.currentLanguage || getLanguage() || DEFAULT_LANGUAGE;
    window.__CV_START__ = { ...payload, language };

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
