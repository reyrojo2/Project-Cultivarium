/**
 * UIScene
 * - HUD: FPS, reloj, cartera, panel de inspección y alertas.
 * - Botones: Regar (R), Cosechar (C).
 */
import { State, repoAll } from '../core/state.js';
import { findFirstPlayer } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber } from '../core/time.js';
import { LEVELS } from '../core/time.js';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');
    this.fpsText = null;
    this.clockText = null;
    this.moneyText = null;
    this.panel = null;
    this.alertsText = null;
  }

  create() {
    // Card HUD superior (FPS / Fecha / Dinero)
    const hudX = 8, hudY = 6;
    const hudW = 350;  // ajusta si necesitas más ancho
    const hudH = 54;   // alto para 3 líneas
    const hudBg = this.add.graphics().setScrollFactor(0);
    hudBg.fillStyle(0x000000, 0.30);         // translúcido
    hudBg.lineStyle(2, 0xffffff, 0.06);      // borde muy sutil
    hudBg.fillRoundedRect(hudX, hudY, hudW, hudH, 10);
    hudBg.strokeRoundedRect(hudX, hudY, hudW, hudH, 10);

    // Luego crea los textos encima:
    this.fpsText   = this.add.text(hudX + 8, hudY + 4,  'FPS: --', { fontSize: '12px', color: '#e2e8f0' }).setScrollFactor(0);
    this.clockText = this.add.text(hudX + 8, hudY + 20, 'Clock: 0', { fontSize: '12px', color: '#94a3b8' }).setScrollFactor(0);
    this.moneyText = this.add.text(hudX + 8, hudY + 36, '₲ 0',     { fontSize: '12px', color: '#60a5fa' }).setScrollFactor(0);

    // ====== Panel de inspección con fondo redondeado ======
    const panelWidth = 300;
    const panelHeight = 140;
    const panelX = this.scale.width - panelWidth - 10;
    const panelY = 10;

    const panelBg = this.add.graphics().setScrollFactor(0);
    panelBg.fillStyle(0x000000, 0.35);
    panelBg.lineStyle(2, 0xffffff, 0.08);
    panelBg.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);
    panelBg.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 12);

    this.panel = this.add.text(panelX + 10, panelY + 10, 'Selecciona una parcela…', {
      fontSize: '12px',
      color: '#e2e8f0',
      wordWrap: { width: panelWidth - 20 },
    }).setScrollFactor(0);

    // ====== Panel de alertas con fondo redondeado ======
    const alertsWidth = 300;
    const alertsHeight = 160;
    const alertsX = this.scale.width - alertsWidth - 10;
    const alertsY = panelY + panelHeight + 10;

    const alertsBg = this.add.graphics().setScrollFactor(0);
    alertsBg.fillStyle(0x0b1220, 0.55);
    alertsBg.lineStyle(2, 0xffffff, 0.05);
    alertsBg.fillRoundedRect(alertsX, alertsY, alertsWidth, alertsHeight, 12);
    alertsBg.strokeRoundedRect(alertsX, alertsY, alertsWidth, alertsHeight, 12);

    this.alertsText = this.add.text(alertsX + 10, alertsY + 10, 'Alertas:', {
      fontSize: '12px', color: '#fbbf24'
    }).setScrollFactor(0);

    // ====== Botonera (usa coordenadas del panel, no "bg") ======
    const baseX = panelX + 10;
    const baseY = panelY + panelHeight - 30; // cerca del borde inferior
    const gap   = 10;

    const btnA = this.add.text(0, 0, '🚜 Arar (A)', { fontSize: '12px', color: '#c57122', backgroundColor: '#2a1e0b' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    const btnR = this.add.text(0, 0, '💧 Regar (R)', { fontSize: '12px', color: '#22c55e', backgroundColor: '#0b2a1a' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    const btnC = this.add.text(0, 0, '🌾 Cosechar (C)', { fontSize: '12px', color: '#eab308', backgroundColor: '#2a230b' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    // fila horizontal
    btnA.setPosition(baseX, baseY - 25);
    btnR.setPosition(baseX, baseY);
    btnC.setPosition(btnR.x + btnR.getBounds().width + gap, baseY);

    // callbacks
    btnA.on('pointerdown', () => this.game.scene.get('Game').plowSelected());
    btnR.on('pointerdown', () => this.game.scene.get('Game').waterSelected());


    // Listener para inspección (desde GameScene)
    this.game.events.on('inspect:parcela', (data) => {
      const lines = [
        `Parcela: ${data.id}`,
        `Suelo: ${data.saludSuelo}`,
        data.cultivo ? `Cultivo: ${data.cultivo.tipo} (${data.cultivo.etapa} ${data.cultivo.progreso})` : 'Cultivo: -',
        data.agua ? `Agua: ${data.agua.nivel}` : 'Agua: -'
      ];
      this.panel.setText(lines.join('\n'));
    });

    // Toasts
    this.game.events.on('toast', (t) => {
      const y = 70;
      const txt = this.add.text(12, y, t.msg, {
        fontSize:'12px',
        color: t.type==='ok' ? '#10b981' : '#f59e0b',
        backgroundColor: 'rgba(0,0,0,0.5)'
      }).setPadding(6,4,6,4).setScrollFactor(0);
      this.tweens.add({ targets: txt, alpha: 0, duration: 1200, delay: 600, onComplete:()=>txt.destroy() });
    });
  }

  update() {
    const fps = Math.floor(this.game.loop.actualFps || 0);
    this.fpsText.setText('FPS: ' + fps);
      // Fecha/avance del nivel
    const d = getSimDate();
    const dayN = getSimDayNumber();
    const L = LEVELS[TimeState.levelIdx];

    this.clockText.setText(
      `${L.name} — Día ${dayN}/${TimeState.levelDays} — ` +
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    );

    const player = findFirstPlayer();
    this.moneyText.setText(`₲ ${player ? player.cartera.toFixed(0) : 0}`);

    // Renderizar alertas activas (últimas 5 visibles)
    const alerts = repoAll('alertas').filter(a=>a.visible!==false).slice(-5);
    const text = ['Alertas:'].concat(alerts.map(a => `• ${a.mensaje}`)).join('\n');
    this.alertsText.setText(text);
  }
}
