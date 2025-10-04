/**
 * UIScene
 * - HUD: FPS, reloj, cartera, panel de inspección y alertas.
 * - Botones: Regar (R), Cosechar (C).
 */
import { State, repoAll } from '../core/state.js';
import { findFirstPlayer } from '../core/state.js';

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
    this.fpsText = this.add.text(12, 8, 'FPS: --', { fontSize: '12px', color: '#e2e8f0' }).setScrollFactor(0);
    this.clockText = this.add.text(12, 24, 'Clock: 0', { fontSize: '12px', color: '#94a3b8' }).setScrollFactor(0);
    this.moneyText = this.add.text(12, 40, '₲ 0', { fontSize: '12px', color: '#60a5fa' }).setScrollFactor(0);

    // Panel de inspección
    const bg = this.add.rectangle(0, 0, 300, 140, 0x000000, 0.35).setOrigin(0).setScrollFactor(0);
    bg.setPosition(this.scale.width - 310, 10);
    this.panel = this.add.text(bg.x + 10, bg.y + 10, 'Selecciona una parcela…', {
      fontSize: '12px', color: '#e2e8f0', wordWrap: { width: 280 }
    }).setScrollFactor(0);

    // Lista de alertas
    const abg = this.add.rectangle(0, 0, 300, 160, 0x0b1220, 0.55).setOrigin(0).setScrollFactor(0);
    abg.setPosition(this.scale.width - 310, 160);
    this.alertsText = this.add.text(abg.x + 10, abg.y + 10, 'Alertas:', { fontSize: '12px', color: '#fbbf24' }).setScrollFactor(0);

    // Botonera (en línea, sin solaparse)
    const baseX = bg.x + 10;
    const baseY = bg.y + 110;
    const gap   = 10; // separación horizontal

    const btnA = this.add.text(0, 0, '🚜 Arar (A)', { fontSize: '12px', color: '#c57122', backgroundColor: '#2a1e0b' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    const btnR = this.add.text(0, 0, '💧 Regar (R)', { fontSize: '12px', color: '#22c55e', backgroundColor: '#0b2a1a' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    const btnC = this.add.text(0, 0, '🌾 Cosechar (C)', { fontSize: '12px', color: '#eab308', backgroundColor: '#2a230b' })
      .setPadding(6,4,6,4).setInteractive({ useHandCursor: true }).setScrollFactor(0);

    // Posicionar en fila usando los anchos reales
    btnA.setPosition(baseX, baseY - 25); // 🔼 sube el botón Arar
    btnR.setPosition(baseX, baseY);
    btnC.setPosition(btnR.x + btnR.getBounds().width + gap, baseY);

    // Callbacks
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
    this.clockText.setText('Clock: ' + State.clock);

    const player = findFirstPlayer();
    this.moneyText.setText(`₲ ${player ? player.cartera.toFixed(0) : 0}`);

    // Renderizar alertas activas (últimas 5 visibles)
    const alerts = repoAll('alertas').filter(a=>a.visible!==false).slice(-5);
    const text = ['Alertas:'].concat(alerts.map(a => `• ${a.mensaje}`)).join('\n');
    this.alertsText.setText(text);
  }
}
