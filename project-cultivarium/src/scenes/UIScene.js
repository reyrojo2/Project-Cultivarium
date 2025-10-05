import Phaser from 'phaser';
import { State, repoAll, findFirstPlayer, repoGet } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber, LEVELS } from '../core/time.js';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');

    // HUD texts
    this.fpsText = null;
    this.clockText = null;
    this.moneyText = null;

    // Status panel pieces
    this.statusPanel = null;
    this.playerNameText = null;
    this.locationText = null;
    this.dayText = null;
    this.bars = null;

    // Inspect & Alerts inside Status panel
    this.inspectTitle = null;
    this.inspectText = null;
    this.alertsTitle = null;
    this.alertsText = null;

    // Actions
    this.actionPanel = null;
    this.actionButtons = [];

    // Palette
    this.colors = null;
  }

  create() {
    const screenW = this.scale.width;
    const screenH = this.scale.height;

    // ===== Paleta Eco-Futurista =====
    const colors = {
      panelBg: 0x9A6B41,
      panelBorder: 0x5B3A29,
      actionButton: 0x8DA86C,
      actionButtonHover: 0x79a83c,
      actionButtonDisabled: 0x5E7A47,

      dataPanelBg: 0x1a202c,
      dataAccent: 0x1a202c,

      textPrimary: '#F4F0E1',
      textSecondary: '#E6D6A6',

      bar: {
        hp: 0x00FFD1,
        heat: 0xf87171,
        water: 0x60a5fa,
        humidity: 0xfbbf24,
        money: 0xf59e0b,
        energy: 0xc084fc
      },
      feedback: { success: 0x00FFD1, error: 0xf87171 }
    };
    this.colors = colors;

    // ===== Panel Izquierdo (Status/Data + Inspección + Alertas) =====
    this.statusPanel = this.createCollapsiblePanel(0, 0, 340, screenH, 'left', colors, colors.dataPanelBg);
    this.populateStatusPanel(this.statusPanel, colors);

    // ===== Panel Derecho (Acciones) =====
    this.actionPanel = this.createCollapsiblePanel(screenW, 0, 300, screenH, 'right', colors, colors.panelBg);
    this.populateActionPanel(this.actionPanel, colors);

    // ===== Listeners de juego =====
    // Inspección: rellena bloque "Inspección" en el panel izquierdo
    this.game.events.on('inspect:parcela', (data) => {
      const lines = [
        `Parcela: ${data.id}`,
        `Suelo: ${data.saludSuelo}`,
        data.cultivo ? `Cultivo: ${data.cultivo.tipo} (${data.cultivo.etapa} ${data.cultivo.progreso})` : 'Cultivo: -',
        data.agua ? `Agua: ${data.agua.nivel}` : 'Agua: -'
      ];
      this.inspectText.setText(lines.join('\n'));
    });

    // Toasts (reusado del primer snippet)
    this.game.events.on('toast', (t) => {
      const y = 70;
      const txt = this.add.text(12, y, t.msg, {
        fontSize:'12px',
        color: t.type==='ok' ? '#1a202c' : '#f59e0b',
        backgroundColor: 'rgba(0,0,0,0.5)'
      }).setPadding(6,4,6,4).setScrollFactor(0);
      this.tweens.add({ targets: txt, alpha: 0, duration: 1200, delay: 600, onComplete:()=>txt.destroy() });
    });
  }

  // ---------- Panel colapsable ----------
  createCollapsiblePanel(x, y, width, height, side, colors, bgColor) {
    const container = this.add.container(x, y);

    // Posición inicial (derecha entra desplazada por su ancho)
    if (side === 'right') container.x -= width;

    const rads = (side === 'left' ? { tr: 16, br: 16 } : { tl: 16, bl: 16 });

    const panelBg = this.add.graphics();
    panelBg.fillStyle(bgColor, 0.9).fillRoundedRect(0, 0, width, height, rads);
    panelBg.lineStyle(4, colors.panelBorder).strokeRoundedRect(0, 0, width, height, rads);

    const toggleButton = this.add.text(
      side === 'left' ? width - 25 : 25,
      height / 2,
      side === 'left' ? '◀' : '▶',
      { fontSize: '32px', color: colors.textPrimary, fontStyle: 'bold' }
    ).setOrigin(0.5).setInteractive({ useHandCursor: true });

    container.add([panelBg, toggleButton]);

    let isCollapsed = false;
    toggleButton.on('pointerdown', () => {
      isCollapsed = !isCollapsed;
      this.tweens.add({
        targets: container,
        x: isCollapsed ? (side === 'left' ? -width + 50 : this.scale.width - 50) : (side === 'left' ? 0 : this.scale.width - width),
        duration: 300,
        ease: 'Cubic.easeInOut'
      });
      toggleButton.setText(isCollapsed ? (side === 'left' ? '▶' : '◀') : (side === 'left' ? '◀' : '▶'));
    });

    return { container, width, height, side };
  }

  // ---------- Status/Data + Inspección + Alertas ----------
  populateStatusPanel(panel, colors) {
    const container = panel.container;
    const W = panel.width;
    let y = 20;

    // Nombre / Ubicación
    this.playerNameText = this.add.text(W / 2, y, 'Agente', { fontSize: '24px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.locationText   = this.add.text(W / 2, y += 30, 'Pampa Húmeda, AR', { fontSize: '16px', color: colors.textSecondary }).setOrigin(0.5, 0);

    // Día destacado
    this.dayText = this.add.text(W / 2, y += 30, 'Día: 1', {
      fontSize: '18px',
      color: colors.textPrimary,
      fontStyle: '600',
      backgroundColor: Phaser.Display.Color.IntegerToColor(colors.dataAccent).rgba,
      padding: { x: 12, y: 6 },
      align: 'center'
    }).setOrigin(0.5, 0);

    y += 48;

    // Barras (NDVI / Calor / Agua / Lluvia / Dinero / Energía)
    this.bars = {
      hp:       this.createHudBar('SALUD (NDVI)', y, colors.bar.hp, W, colors),
      heat:     this.createHudBar('CALOR (Estrés)', y += 66, colors.bar.heat, W, colors),
      water:    this.createHudBar('HUMEDAD (SMAP RZSM)', y += 66, colors.bar.water, W, colors),
      humidity: this.createHudBar('LLUVIA (GPM)', y += 66, colors.bar.humidity, W, colors),
      money:    this.createHudBar('DINERO ($)', y += 66, colors.bar.money, W, colors),
      energy:   this.createHudBar('ENERGÍA (⚡)', y += 66, colors.bar.energy, W, colors),
    };
    Object.values(this.bars).forEach(bar => container.add(bar.elements));

    // Separador
    const sep1 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 58, W - 32, 2);
    container.add(sep1);
    y += 12;

    // Bloque Inspección
    this.inspectTitle = this.add.text(24, y, 'Inspección', { fontSize: '18px', color: colors.textPrimary, fontStyle: 'bold' });
    this.inspectText  = this.add.text(24, y + 24, 'Selecciona una parcela…', { fontSize: '12px', color: colors.textSecondary, wordWrap: { width: W - 48 } });

    container.add([this.playerNameText, this.locationText, this.dayText, this.inspectTitle, this.inspectText]);

    // Separador
    const sep2 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 110, W - 32, 2);
    container.add(sep2);
    y += 12;

    // Bloque Alertas
    this.alertsTitle = this.add.text(24, y, 'Alertas', { fontSize: '18px', color: '#fbbf24', fontStyle: 'bold' });
    this.alertsText  = this.add.text(24, y + 24, '—', { fontSize: '12px', color: colors.textPrimary, wordWrap: { width: W - 48 } });
    container.add([this.alertsTitle, this.alertsText]);
  }

  // ---------- Panel de Acciones ----------
  populateActionPanel(panel, colors) {
    const container = panel.container;
    const W = panel.width;
    let y = 20;

    const title = this.add.text(W / 2, y, 'Decisiones', { fontSize: '24px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
    container.add(title);
    y += 60;

    // Helper para crear botón + callback seguro (GameScene o evento)
    const makeBtn = (label, onDirectCall, eventType, feedbackMsg, feedbackColor) => {
      const btn = this.createActionButton(label, y, () => {
        const gameScene = this.game.scene.get('Game');
        if (gameScene && typeof gameScene[onDirectCall] === 'function') {
          gameScene[onDirectCall]();
        } else {
          this.game.events.emit('action:perform', { actionType: eventType });
        }
        this.showActionFeedback(feedbackMsg, feedbackColor);
      }, W, colors);
      container.add(btn.elements);
      this.actionButtons.push(btn);
      y += 65;
      return btn;
    };

    // Botones clave (incluye ARAR de tu primer snippet)
    makeBtn('🚜 Arar',     'plowSelected',   'ARAR',         '🚜 Arado ejecutado', colors.feedback.success);
    makeBtn('💧 Regar',    'waterSelected',  'REGAR',        '💧 Riego ejecutado', colors.feedback.success);
    makeBtn('🌾 Cosechar', 'harvestSelected','COSECHAR',     '🌾 Cosecha intentada', 0xfbbf24);

    // Separador
    const sep = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 40, W - 32, 2);
    container.add(sep);
    y += 12;

    // Avanzados / Tech
    makeBtn('⚙️ Mejorar',    null, 'UPGRADE_TECH', '⚙️ Abriendo Tech-Tree', colors.dataAccent);
    makeBtn('🛰️ Escanear (Data)', null, 'SCAN_REGION', '🛰️ Extrayendo Data NASA...', colors.dataAccent);
    makeBtn('💰 Vender Cosecha',   null, 'SELL_HARVEST','💰 Mercado actualizado', colors.bar.money);
  }

  // ---------- Feedback flotante ----------
  showActionFeedback(msg, colorHex) {
    const feedbackText = this.add.text(this.scale.width / 2, this.scale.height - 100, msg, {
      fontSize: '20px',
      color: Phaser.Display.Color.IntegerToColor(colorHex).rgba,
      fontStyle: 'bold',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 16, y: 8 }
    }).setOrigin(0.5);

    this.tweens.add({
      targets: feedbackText,
      y: feedbackText.y - 70,
      alpha: 0,
      duration: 1500,
      ease: 'Cubic.easeOut',
      onComplete: () => feedbackText.destroy()
    });
  }

  // ---------- Barra HUD reutilizable ----------
  createHudBar(label, y, color, panelWidth, colors) {
    const pad = 24;
    const barW = panelWidth - (pad * 2);

    const labelText = this.add.text(pad, y, label, {
      fontSize: '14px',
      color: (label.includes('NDVI') || label.includes('SMAP')) ? colors.dataAccent : colors.textPrimary,
      fontStyle: 'bold'
    });

    const valueText = this.add.text(panelWidth - pad, y, '0%', { fontSize: '14px', color: colors.textSecondary, fontStyle: 'bold' }).setOrigin(1, 0);

    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x000000, 0.30);
    bgBar.fillRoundedRect(pad, y + 22, barW, 24, 12);
    bgBar.lineStyle(2, colors.panelBorder);
    bgBar.strokeRoundedRect(pad, y + 22, barW, 24, 12);

    const valueBar = this.add.graphics();

    return {
      elements: [labelText, valueText, bgBar, valueBar],
      update: (v) => {
        v = Phaser.Math.Clamp(v, 0, 1);
        const disp = (label.includes('DINERO')) ? `$${(v * 10000).toFixed(0)}` : `${(v * 100).toFixed(0)}%`;
        valueText.setText(disp);
        valueBar.clear();
        valueBar.fillStyle(color);
        valueBar.fillRoundedRect(pad + 3, y + 25, (barW - 6) * v, 18, 9);
      }
    };
  }

  // ---------- Botón de acción ----------
  createActionButton(text, y, onClick, panelWidth, colors) {
    const pad = 24;
    const width = panelWidth - (pad * 2);
    const height = 55;

    const bg = this.add.graphics();
    bg.fillStyle(colors.actionButton).fillRoundedRect(pad, y, width, height, 14);
    bg.lineStyle(2, colors.panelBorder).strokeRoundedRect(pad, y, width, height, 14);

    const t = this.add.text(panelWidth / 2, y + height / 2, text, { fontSize: '20px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5);

    const hitArea = new Phaser.Geom.Rectangle(pad, y, width, height);
    bg.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);

    bg.on('pointerdown', () => {
      if (bg.input.enabled) {
        this.tweens.add({ targets: [bg, t], scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });
        onClick();
      }
    });
    bg.on('pointerover', () => { if (bg.input.enabled) bg.fillColor = colors.actionButtonHover; });
    bg.on('pointerout',  () => { if (bg.input.enabled) bg.fillColor = colors.actionButton; });

    return { elements: [bg, t], bg, text: t };
  }

  // ---------- Update ----------
  update() {
    // FPS
    const fps = Math.floor(this.game.loop.actualFps || 0);
    if (this.fpsText) this.fpsText.setText('FPS: ' + fps);

    // Fecha / nivel
    const d = getSimDate();
    const dayN = getSimDayNumber();
    const L = LEVELS?.[TimeState.levelIdx] || { name: 'Nivel' };
    if (this.clockText) {
      this.clockText.setText(
        `${L.name} — Día ${dayN}/${TimeState.levelDays} — ` +
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      );
    }

    // Dinero
    const player = findFirstPlayer();
    if (this.moneyText) this.moneyText.setText(`₲ ${player ? player.cartera.toFixed(0) : 0}`);

    // Actualizar "Día" destacado
    if (this.dayText) this.dayText.setText(`Día: ${dayN}`);

    // ==== Barras ====
    const useMockState = false; // cámbialo a true si quieres ver animación de demo

    let hasEnergy = true;
    let canAfford = true;

    if (useMockState) {
      const time = this.time.now;
      const mock = {
        hp: 0.75 + Math.sin(time / 1000) * 0.25,
        heat: 0.40 + Math.cos(time / 800)  * 0.30,
        water: 0.50 + Math.sin(time / 1200) * 0.40,
        humidity: 0.60 + Math.cos(time / 1500) * 0.10,
        money: 0.85 + Math.sin(time / 2000) * 0.05,
        energy: 0.90 + Math.cos(time / 500)  * 0.10
      };
      Object.keys(this.bars).forEach(k => this.bars[k].update(Phaser.Math.Clamp(mock[k], 0, 1)));
      hasEnergy = mock.energy > 0.1;
      canAfford = mock.money > 0.1;
    } else {
      // Estado real desde repos / player / parcela
      const p = player;
      const parcela = p ? repoGet('parcelas', p.parcelaSeleccionadaId) : null;

      if (parcela) {
        this.bars.hp.update(parcela.saludNDVI ?? 0);
        this.bars.water.update(parcela.humedadSueloSMAP ?? 0);
        this.bars.heat.update(parcela.estresTermico ?? 0);
      }
      this.bars.humidity.update(State?.clima?.lluviaGPM ?? 0);

      if (p) {
        this.bars.money.update((p.cartera ?? 0) / 10000);
        const eMax = p.energiaMax || 1;
        this.bars.energy.update((p.energiaActual ?? 0) / eMax);
        hasEnergy = (p.energiaActual ?? 0) > (eMax * 0.1);
        canAfford = (p.cartera ?? 0) > 50;
      }
    }

    // ==== Desactivación dinámica de botones ====
    this.actionButtons.forEach(button => {
      if (!button || !button.bg) return;
      const bg = button.bg;

      const isEnabled = hasEnergy && canAfford;
      bg.setAlpha(isEnabled ? 1 : 0.55);

      // si no hay input aún, no intentes leer enabled
      if (!bg.input) {
        if (isEnabled) {
          // vuelve a (re)hacer interactivo si procede
          bg.setInteractive(
            new Phaser.Geom.Rectangle(bg.x, bg.y, bg.displayWidth, bg.displayHeight),
            Phaser.Geom.Rectangle.Contains
          );
        }
        return;
      }

      if (isEnabled) {
        if (!bg.input.enabled) {
          bg.setInteractive({ useHandCursor: true });
          bg.fillColor = this.colors.actionButton;
        }
      } else {
        if (bg.input.enabled) {
          bg.disableInteractive();
          bg.fillColor = this.colors.actionButtonDisabled;
        }
      }
    });


    // ==== Alertas (últimas 5) ====
    const alerts = repoAll('alertas').filter(a => a.visible !== false).slice(-5);
    const atext = alerts.length ? alerts.map(a => `• ${a.mensaje}`).join('\n') : '—';
    this.alertsText.setText(atext);

    // ==== Nombre de jugador si existe variable global ====
    if (player && window.__CV_START__?.profile?.name) {
      this.playerNameText.setText(window.__CV_START__.profile.name);
    }
  }
}
