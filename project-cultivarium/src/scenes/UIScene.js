/**
 * UIScene
 * - Muestra FPS, reloj del simulador y panel de inspección de parcela.
 * - También renderiza alertas activas (lista simple).
 */
import { State, repoAll } from '../core/state.js';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');
    this.fpsText = null;
    this.clockText = null;
    this.panel = null;
    this.alertsText = null;
  }

  create() {
    this.fpsText = this.add.text(12, 8, 'FPS: --', { fontSize: '12px', color: '#e2e8f0' }).setScrollFactor(0);
    this.clockText = this.add.text(12, 24, 'Clock: 0', { fontSize: '12px', color: '#94a3b8' }).setScrollFactor(0);

    // Panel de inspección
    const bg = this.add.rectangle(0, 0, 260, 120, 0x000000, 0.35).setOrigin(0).setScrollFactor(0);
    bg.setPosition(this.scale.width - 270, 10);
    this.panel = this.add.text(bg.x + 10, bg.y + 10, 'Selecciona una parcela…', {
      fontSize: '12px', color: '#e2e8f0', wordWrap: { width: 240 }
    }).setScrollFactor(0);

    // Lista de alertas
    const abg = this.add.rectangle(0, 0, 260, 140, 0x0b1220, 0.55).setOrigin(0).setScrollFactor(0);
    abg.setPosition(this.scale.width - 270, 140);
    this.alertsText = this.add.text(abg.x + 10, abg.y + 10, 'Alertas:', { fontSize: '12px', color: '#fbbf24' }).setScrollFactor(0);

    // Listener para inspección
    this.game.events.on('inspect:parcela', (data) => {
      const lines = [
        `Parcela: ${data.id}`,
        `Suelo: ${data.saludSuelo}`,
        data.cultivo ? `Cultivo: ${data.cultivo.tipo} (${data.cultivo.etapa} ${data.cultivo.progreso})` : 'Cultivo: -',
        data.agua ? `Agua: ${data.agua.nivel}` : 'Agua: -'
      ];
      this.panel.setText(lines.join('\n'));
    });
  }

  update() {
    const fps = Math.floor(this.game.loop.actualFps || 0);
    this.fpsText.setText('FPS: ' + fps);
    this.clockText.setText('Clock: ' + State.clock);

    // Renderizar alertas activas (últimas 5)
    const alerts = repoAll('alertas').slice(-5);
    const text = ['Alertas:'].concat(alerts.map(a => `• ${a.mensaje}`)).join('\n');
    this.alertsText.setText(text);
  }
}
