import Phaser from 'phaser';
import { State, repoAll, findFirstPlayer, repoGet } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber, LEVELS } from '../core/time.js';
import { getLanguage, translate as t } from '../utils/i18n.js';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');
    // Inicialización de todas las propiedades a null y control del Tween
    this.actionButtons = []; 
    this.bars = null;
    this.colors = null;
    this.fpsText = null;
    this.clockText = null;
    this.moneyText = null;
    this.inspectText = null;
    this.alertsText = null;
    this.dayText = null;
    this.playerNameText = null;
    this.levelText = null;
    this.heatAlertTween = null; // Control del Tween
    this._dom = null;        // refs DOM cacheadas
    this._domLast = null;    // último snapshot para evitar trabajo repetido
    this._domDay = null;     // último día escrito en DOM
    this.currentLang = null;
    this.actionButtonsMeta = [];
    this._lastInspectData = null;
  }

  create() {
    this.currentLang = getLanguage();

    const screenW = this.scale.width;
    const screenH = this.scale.height;

    // ===== Paleta Eco-Futurista (Ajustes para coherencia visual) =====
    const colors = {
      // Tierra (Acciones)
      panelBg: 0x9A6B41,
      panelBorder: 0x5B3A29,
      actionButton: 0x8DA86C,
      actionButtonHover: 0x79a83c,
      actionButtonDisabled: 0x5E7A47,

      // Espacio/Data (Status)
      dataPanelBg: 0x1a202c,
      dataAccent: 0x00FFD1, // Turquesa NASA
      
      // Textos y Feedback
      textPrimary: '#F4F0E1',
      textSecondary: '#E6D6A6',
      feedback: { success: 0x00FFD1, error: 0xf87171 },
      
      // Barras
      bar: {
        hp: 0x00FFD1,    // NDVI (Turquesa NASA)
        heat: 0xf87171,  // Rojo (Estrés por Calor)
        humidity: 0x2dd4bf, // Cian suave (Humedad relativa)
        rain: 0xfbbf24,  // Amarillo (GPM/Lluvia)
        money: 0xf59e0b,
        energy: 0xc084fc
      },
    };
    this.colors = colors;
    this.actionButtons = []; 

    // ===== Panel Izquierdo (Status/Data + Inspección + Alertas) =====
    this.statusPanel = this.createCollapsiblePanel(0, 0, 340, screenH, 'left', colors, colors.dataPanelBg);
    this.populateStatusPanel(this.statusPanel, colors);

    // ===== Panel Derecho (Acciones) =====
    this.actionPanel = this.createCollapsiblePanel(screenW, 0, 300, screenH, 'right', colors, colors.panelBg);
    this.populateActionPanel(this.actionPanel, colors);

    // ===== HUD Principal (Elementos Fijos y Vitales) =====
    this.clockText = this.add.text(screenW / 2, 10, '', { fontSize: '14px', color: colors.textPrimary, fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 10, y: 5 } }).setOrigin(0.5, 0).setDepth(100);
    this.fpsText = this.add.text(screenW - 10, 10, '', { fontSize: '10px', color: colors.dataAccent, backgroundColor: 'rgba(0,0,0,0.3)' }).setOrigin(1, 0).setDepth(100);
    this.moneyText = this.add.text(screenW / 2, 35, '', { fontSize: '24px', color: colors.bar.money, fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 12, y: 5 } }).setOrigin(0.5, 0).setDepth(100);

    // Inicializa la animación de alerta crítica (Estrés por Calor)
    // Se inicializa el tween en el fondo de la barra de calor, el cual ya está creado en populateStatusPanel
    this.heatAlertTween = this.tweens.add({
      targets: this.bars.heat.bg,
      alpha: 0.3,
      duration: 500,
      yoyo: true, 
      repeat: -1, 
      paused: true 
    });

    // ===== Listeners de juego (Toasts y Inspección) =====
    this.game.events.on('inspect:parcela', (data) => {
      this._lastInspectData = data;
      this.updateInspectPanel(data);
    });

    this.game.events.on('toast', (t) => {
      this.showActionFeedback(t.msg, t.type === 'ok' ? colors.feedback.success : colors.feedback.error);
    });

    this.applyTranslations();
  }

  // ---------- Panel colapsable ----------
  createCollapsiblePanel(x, y, width, height, side, colors, bgColor) {
    const container = this.add.container(x, y).setDepth(99);
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
    // Aseguramos que el botón quede por encima de la máscara y el contenido
    toggleButton.setDepth(2);

    const maskShape = this.add.graphics();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRect(0, 0, width, height);
    // Ocultamos el gráfico usado como máscara para que no blanquee los botones
    maskShape.setVisible(false);

    const content = this.add.container(0, 0);

    container.add([panelBg, maskShape, content, toggleButton]);

    container.setSize(width, height);
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

    const geometryMask = maskShape.createGeometryMask();
    content.setMask(geometryMask);

    const panelState = { maxScroll: 0 };

    container.on('wheel', (pointer, deltaX, deltaY, deltaZ, event) => {
      if (panelState.maxScroll <= 0) return;
      const nextY = Phaser.Math.Clamp(content.y - deltaY, -panelState.maxScroll, 0);
      if (nextY !== content.y) {
        content.y = nextY;
      }
      if (event?.preventDefault) event.preventDefault();
    });

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

    return {
      container,
      content,
      width,
      height,
      side,
      setMaxScroll: (value) => {
        panelState.maxScroll = Math.max(0, value);
      }
    };
  }

  // ---------- Status/Data + Inspección + Alertas ----------
  populateStatusPanel(panel, colors) {
    const container = panel.content;
    const W = panel.width;
    let y = 20;

    // Nombre / Ubicación
    this.playerNameText = this.add.text(W / 2, y, '', { fontSize: '24px', color: colors.textPrimary, fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.levelText = this.add.text(W / 2, y += 30, '', { fontSize: '16px', color: colors.textSecondary }).setOrigin(0.5, 0);

    // Día destacado (Aplica colores Data Accent)
    this.dayText = this.add.text(W / 2, y += 30, '', {
      fontSize: '18px',
      color: Phaser.Display.Color.IntegerToColor(colors.dataAccent).rgba,
      fontStyle: '600',
      backgroundColor: Phaser.Display.Color.IntegerToColor(colors.dataPanelBg).rgba,
      padding: { x: 12, y: 6 },
      align: 'center',
    }).setOrigin(0.5, 0);

    y += 48;

    // Barras
    const barSpacing = 66;
    const barConfigs = [
      { key: 'hp', labelKey: 'ui.barLabels.health', color: colors.bar.hp, accent: true },
      { key: 'heat', labelKey: 'ui.barLabels.heat', color: colors.bar.heat },
      { key: 'humidity', labelKey: 'ui.barLabels.humidity', color: colors.bar.humidity },
      { key: 'rain', labelKey: 'ui.barLabels.rain', color: colors.bar.rain },
      { key: 'money', labelKey: 'ui.barLabels.money', color: colors.bar.money, valueFormatter: (v) => `₲ ${(v * 10000).toFixed(0)}` },
      { key: 'energy', labelKey: 'ui.barLabels.energy', color: colors.bar.energy },
    ];

    this.bars = {};
    let barY = y;
    barConfigs.forEach((cfg, idx) => {
      if (idx > 0) barY += barSpacing;
      const bar = this.createHudBar({
        labelKey: cfg.labelKey,
        y: barY,
        color: cfg.color,
        panelWidth: W,
        colors,
        accent: cfg.accent,
        valueFormatter: cfg.valueFormatter,
      });
      this.bars[cfg.key] = bar;
      container.add(bar.elements);
    });
    y = barY;

    // Separadores y Bloques de Información
    const sep1 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 58, W - 32, 2);
    container.add(sep1);
    y += 12;

    this.inspectTitle = this.add.text(24, y, '', { fontSize: '18px', color: colors.dataAccent, fontStyle: 'bold' });
    this.inspectText = this.add.text(24, y + 24, '', { fontSize: '12px', color: colors.textSecondary, wordWrap: { width: W - 48 } });

    container.add([this.playerNameText, this.levelText, this.dayText, this.inspectTitle, this.inspectText]);
    container.bringToTop(this.dayText);

    const sep2 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 110, W - 32, 2);
    container.add(sep2);
    y += 12;

    this.alertsTitle = this.add.text(24, y, '', { fontSize: '18px', color: colors.bar.heat, fontStyle: 'bold' });
    this.alertsText = this.add.text(24, y + 24, '', { fontSize: '12px', color: colors.textPrimary, wordWrap: { width: W - 48 } });
    container.add([this.alertsTitle, this.alertsText]);
    this.alertsTitle.setVisible(false);
    this.alertsText.setVisible(false);

    this.updatePanelScroll(panel);
  }

// ---------- Panel de Acciones ----------
populateActionPanel(panel, colors) {
  const container = panel.content;
  const W = panel.width;
  let y = 20;

  this.actionPanelTitle = this.add.text(W / 2, y, '', {
    fontSize: '24px',
    color: colors.textPrimary,
    fontStyle: 'bold'
  }).setOrigin(0.5, 0);
  container.add(this.actionPanelTitle);
  y += 60;

  // Reinicia el registro de botones (UI Scene -> update() los gestiona)
  this.actionButtons = [];
  this.actionButtonsMeta = [];

  const actionGroups = [
    {
      configs: [
        { key: 'plow', eventType: 'ARAR', feedbackColor: colors.feedback.success, directFnName: 'plowSelected' },
        { key: 'water', eventType: 'REGAR', feedbackColor: colors.feedback.success, directFnName: 'waterSelected' },
        { key: 'plant', eventType: 'SEMBRAR', feedbackColor: colors.feedback.success, directFnName: 'plantSelected' },
        { key: 'harvest', eventType: 'COSECHAR', feedbackColor: 0xfbbf24, directFnName: 'harvestSelected' },
      ],
      afterSpacing: () => {
        const sep = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y + 40, W - 32, 2);
        container.add(sep);
        y += 52; // 40 for rect + 12 extra spacing
      }
    },
    {
      configs: [
        { key: 'upgrade', eventType: 'UPGRADE_TECH', feedbackColor: colors.dataAccent, cooldownMs: 600 },
        { key: 'scan', eventType: 'SCAN_REGION', feedbackColor: colors.dataAccent, cooldownMs: 600 },
        { key: 'sell', eventType: 'SELL_HARVEST', feedbackColor: colors.bar.money, cooldownMs: 600 },
      ]
    }
  ];

  const registerActions = (configs) => {
    configs.forEach((cfg) => {
      const cooldownMs = cfg.cooldownMs ?? 500;
      const btn = this.createActionButton('', y, async () => {
        if (btn.coolingDown) return;
        btn.coolingDown = true;

        const gameScene =
          (this.scene?.get && this.scene.get('Game')) ||
          (this.game?.scene?.getScene && this.game.scene.getScene('Game')) ||
          null;

        if (cfg.directFnName && gameScene && typeof gameScene[cfg.directFnName] === 'function') {
          try { await gameScene[cfg.directFnName](); } catch (e) { /* noop */ }
        } else {
          this.game.events.emit('action:perform', { actionType: cfg.eventType });
        }

        this.tweens.add({ targets: [btn.bg, btn.text], scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });

        const prevColor = btn.bg.fillColor;
        btn.bg.fillColor = 0x445c3a;
        if (btn.bg.input) btn.bg.input.enabled = false;

        setTimeout(() => {
          btn.bg.fillColor = prevColor;
          if (btn.bg.input) btn.bg.input.enabled = true; else btn.enable();
          btn.coolingDown = false;
        }, cooldownMs);
      }, W, colors);

      btn.coolingDown = false;
      btn.actionKey = cfg.key;

      container.add(btn.elements);
      this.actionButtons.push(btn);
      this.actionButtonsMeta.push({ button: btn, config: { ...cfg, cooldownMs } });
      y += 65;
    });
  };

  actionGroups.forEach((group, idx) => {
    registerActions(group.configs);
    if (group.afterSpacing) {
      group.afterSpacing();
    } else if (idx < actionGroups.length - 1) {
      y += 12;
    }
  });
  this.updatePanelScroll(panel);
}

  updatePanelScroll(panel) {
    if (!panel?.content || typeof panel.setMaxScroll !== 'function') return;
    const bounds = panel.content.getBounds();
    if (!bounds) {
      panel.setMaxScroll(0);
      panel.content.y = 0;
      return;
    }

    const containerWorldY = panel.container?.y ?? 0;
    const top = bounds.y - containerWorldY;
    const bottom = (bounds.bottom ?? (bounds.y + bounds.height)) - containerWorldY;
    const contentHeight = Math.max(bottom - Math.min(0, top), 0);
    const maxScroll = Math.max(0, contentHeight - panel.height);

    panel.setMaxScroll(maxScroll);

    if (panel.content.y < -maxScroll) panel.content.y = -maxScroll;
    if (panel.content.y > 0) panel.content.y = 0;
  }
    
  // ---------- Feedback flotante ----------
  showActionFeedback(msg, colorHex) {
    const feedbackText = this.add.text(this.scale.width / 2, this.scale.height - 100, msg, {
      fontSize: '20px',
      color: Phaser.Display.Color.IntegerToColor(colorHex).rgba,
      fontStyle: 'bold',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 16, y: 8 },
      borderRadius: 10
    }).setOrigin(0.5).setDepth(100);

    this.tweens.add({
      targets: feedbackText,
      y: feedbackText.y - 70,
      alpha: 0,
      duration: 1500,
      ease: 'Cubic.easeOut',
      onComplete: () => feedbackText.destroy()
    });
  }

  // ---------- Barra HUD reutilizable (Con export de valor para alertas) ----------
  createHudBar({ labelKey, y, color, panelWidth, colors, accent = false, valueFormatter }) {
    const pad = 24;
    const barW = panelWidth - (pad * 2);

    const labelText = this.add.text(pad, y, '', {
      fontSize: '14px',
      color: accent ? colors.dataAccent : colors.textPrimary,
      fontStyle: 'bold'
    });

    const valueText = this.add.text(panelWidth - pad, y, '0%', {
      fontSize: '14px',
      color: colors.textSecondary,
      fontStyle: 'bold'
    }).setOrigin(1, 0);

    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x000000, 0.30);
    bgBar.fillRoundedRect(pad, y + 22, barW, 24, 12);
    bgBar.lineStyle(2, colors.panelBorder).strokeRoundedRect(pad, y + 22, barW, 24, 12);

    const valueBar = this.add.graphics();

    let updateValue = 0;
    const defaultFormatter = (v) => `${(v * 100).toFixed(0)}%`;
    let formatter = valueFormatter || defaultFormatter;

    return {
      elements: [bgBar, valueBar, labelText, valueText],
      bg: bgBar,
      labelKey,
      setLabel: (text) => labelText.setText(text),
      setValueFormatter: (fn) => {
        formatter = fn || defaultFormatter;
        valueText.setText(formatter(updateValue));
      },
      update: (v) => {
        const clamped = Phaser.Math.Clamp(v, 0, 1);
        updateValue = clamped;
        valueText.setText(formatter(clamped));
        valueBar.clear();
        valueBar.fillStyle(color);
        valueBar.fillRoundedRect(pad + 3, y + 25, (barW - 6) * clamped, 18, 9);
      },
      get updateValue() { return updateValue; }
    };
  }

  // ---------- Botón de acción (Máxima Retroalimentación Táctil) ----------
  createActionButton(text, y, onClick, panelWidth, colors) {
    const pad = 24;
    const width = panelWidth - (pad * 2);
    const height = 55;

    const bg = this.add.graphics();
    // Dibuja en 0,0 y posiciona el gráfico
    bg.fillStyle(colors.actionButton).fillRoundedRect(0, 0, width, height, 14);
    bg.lineStyle(2, colors.panelBorder).strokeRoundedRect(0, 0, width, height, 14);
    bg.setPosition(pad, y);

    const labelText = this.add.text(panelWidth / 2, y + height / 2, text, {
      fontSize: '20px', color: colors.textPrimary, fontStyle: 'bold'
    }).setOrigin(0.5);

    // ⬇️ HitArea fijo (siempre el mismo)
    const hitArea = new Phaser.Geom.Rectangle(0, 0, width, height);
    bg.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
    bg.input.cursor = 'pointer';

    // Helpers para (des)activar SIN perder hitArea
    const enable = () => {
      if (!bg.input) bg.setInteractive(hitArea, Phaser.Geom.Rectangle.Contains);
      else {
        bg.input.hitArea = hitArea;
        bg.input.hitAreaCallback = Phaser.Geom.Rectangle.Contains;
        bg.input.enabled = true;
      }
      bg.fillColor = colors.actionButton;
      bg.setAlpha(1);
    };
    const disable = () => {
      if (bg.input) bg.input.enabled = false; // NO uses disableInteractive()
      bg.fillColor = colors.actionButtonDisabled;
      bg.setAlpha(0.55);
    };

    // Click
    bg.on('pointerdown', () => {
      if (bg.input?.enabled) {
        this.tweens.add({ targets: [bg, labelText], scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });
        onClick();
      } else {
        this.tweens.add({ targets: bg, x: bg.x + 5, duration: 50, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
      }
    });

    bg.on('pointerover', () => { if (bg.input?.enabled) bg.fillColor = colors.actionButtonHover; });
    bg.on('pointerout',  () => { if (bg.input?.enabled) bg.fillColor = colors.actionButton; });

    // Devuelve helpers
    return { elements: [bg, labelText], bg, text: labelText, enable, disable, hitArea };
  }

  formatDateForLang(date, lang = getLanguage()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const locale = lang === 'en' ? 'en-US' : 'es-AR';
    return date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  applyTranslations() {
    const lang = getLanguage();
    this.currentLang = lang;

    const dayN = getSimDayNumber();
    const dayLabel = t('ui.dayLabel');
    const levelInfo = LEVELS?.[TimeState.levelIdx] || {};
    const levelName = levelInfo.name || t('ui.clockFallbackLevel');
    const totalDays = TimeState.levelDays ?? 0;
    const simDate = getSimDate();
    const dateStr = this.formatDateForLang(simDate, lang);
    const fpsValue = Math.max(0, Math.floor(this.game?.loop?.actualFps || 0));
    const player = findFirstPlayer();

    if (this.playerNameText) {
      const profileName = window.__CV_START__?.profile?.name;
      this.playerNameText.setText(profileName || t('ui.defaultPlayerName'));
    }

    if (this.levelText) {
      this.levelText.setText(t('ui.levelDisplay', { level: levelName }));
    }

    if (this.dayText) {
      this.dayText.setText(t('ui.dayDisplay', { label: dayLabel, day: dayN }));
    }

    if (this.clockText) {
      this.clockText.setText(t('ui.clockDisplay', {
        dayLabel,
        day: dayN,
        totalDays,
        date: dateStr
      }));
    }

    if (this.fpsText) {
      this.fpsText.setText(t('ui.fpsLabel', { value: fpsValue }));
    }

    if (this.moneyText) {
      const moneyValue = player ? player.cartera.toFixed(0) : 0;
      this.moneyText.setText(t('ui.moneyLabel', { value: moneyValue }));
    }

    if (this.inspectTitle) {
      this.inspectTitle.setText(t('ui.inspectTitle'));
    }

    if (this.actionPanelTitle) {
      this.actionPanelTitle.setText(t('ui.actionPanelTitle'));
    }

    if (this.alertsTitle) {
      this.alertsTitle.setText(t('ui.alertsTitle'));
    }

    if (this.alertsText) {
      this.alertsText.setText(t('ui.alertsEmpty'));
    }

    Object.values(this.bars || {}).forEach((bar) => {
      if (bar?.labelKey) {
        bar.setLabel(t(bar.labelKey));
      }
    });

    if (this.bars?.money) {
      this.bars.money.setValueFormatter((v) => t('ui.moneyLabel', { value: (v * 10000).toFixed(0) }));
    }

    this.actionButtonsMeta?.forEach(({ button, config }) => {
      if (button?.text) {
        button.text.setText(t(`ui.actions.${config.key}.label`));
      }
    });

    if (this._lastInspectData) {
      this.updateInspectPanel(this._lastInspectData);
    } else if (this.inspectText) {
      this.inspectText.setText(t('ui.inspectPlaceholder'));
    }

    this.updatePanelScroll(this.statusPanel);
    this.updatePanelScroll(this.actionPanel);
  }

  updateInspectPanel(data) {
    if (!this.inspectText) return;
    if (!data) {
      this.inspectText.setText(t('ui.inspectPlaceholder'));
      this.updatePanelScroll(this.statusPanel);
      return;
    }

    const riesgoPlaga = data.riesgoPlaga || 0;
    const intensidadPlaga = data.intensidadPlaga || 0;
    const plagaActiva = data.plagaActiva || false;

    const soilValue = data.saludSuelo != null
      ? `${(data.saludSuelo * 100).toFixed(0)}%`
      : t('ui.inspect.soilUnknown');

    const cropLine = data.cultivo
      ? t('ui.inspect.crop', {
          type: data.cultivo.tipo,
          stage: data.cultivo.etapa,
          progress: (data.cultivo.progreso * 100).toFixed(0)
        })
      : t('ui.inspect.cropNone');

    const waterLine = data.agua
      ? t('ui.inspect.water', { value: `${(data.agua.nivel * 100).toFixed(0)}%` })
      : t('ui.inspect.waterNone');

    const pestStatus = t(plagaActiva ? 'ui.inspect.pestActive' : 'ui.inspect.pestInactive');

    const lines = [
      t('ui.inspect.parcel', { id: data.id }),
      t('ui.inspect.soil', { value: soilValue }),
      cropLine,
      waterLine,
      '',
      t('ui.inspect.pest', { status: pestStatus }),
      t('ui.inspect.risk', { value: (riesgoPlaga * 100).toFixed(1) }),
      t('ui.inspect.intensity', { value: intensidadPlaga > 0 ? `${intensidadPlaga}/3` : '-' })
    ];

    this.inspectText.setText(lines.join('\n'));
    this.updatePanelScroll(this.statusPanel);
  }


  // ---------- Update (Controla la lógica de estado y efectos) ----------
  update() {
    const lang = getLanguage();
    if (lang !== this.currentLang) {
      this.applyTranslations();
    }

    const player = findFirstPlayer();
    const parcela = player ? repoGet('parcelas', player.parcelaSeleccionadaId) : null;
    const dayN = getSimDayNumber();
    const levelInfo = LEVELS?.[TimeState.levelIdx] || {};
    const dayLabel = t('ui.dayLabel');
    const levelName = levelInfo.name || t('ui.clockFallbackLevel');
    const totalDays = TimeState.levelDays ?? 0;
    const simDate = getSimDate();
    const dateStr = this.formatDateForLang(simDate, lang);

    let hasEnergy = true;
    let canAfford = true;
    let heatValue = 0;

    const useMockState = false;

    if (useMockState) {
      const time = this.time.now;
      const mock = {
        hp: 0.75 + Math.sin(time / 1000) * 0.25,
        heat: 0.40 + Math.cos(time / 800) * 0.30,
        humidity: 0.60 + Math.cos(time / 1500) * 0.10,
        rain: 0.50 + Math.sin(time / 900) * 0.25,
        money: 0.85 + Math.sin(time / 2000) * 0.05,
        energy: 0.90 + Math.cos(time / 500) * 0.10
      };
      Object.entries(this.bars || {}).forEach(([key, bar]) => {
        if (bar && typeof mock[key] === 'number') {
          bar.update(Phaser.Math.Clamp(mock[key], 0, 1));
        }
      });
      hasEnergy = mock.energy > 0.1;
      canAfford = mock.money > 0.1;
      heatValue = mock.heat;
    } else if (this.bars) {
      if (parcela) {
        if (this.bars.hp) this.bars.hp.update(parcela.saludNDVI ?? 0);
        if (this.bars.heat && parcela.estresTermico != null) {
          this.bars.heat.update(parcela.estresTermico ?? 0);
          heatValue = parcela.estresTermico ?? 0;
        }
      }

      if ((!parcela || heatValue == null) && State?.clima?.estresTermico01 != null) {
        heatValue = State.clima.estresTermico01;
        if (this.bars.heat) this.bars.heat.update(heatValue);
      }

      const clima = State?.clima || {};
      if (this.bars.humidity) this.bars.humidity.update(clima.humedad01 ?? clima.humedadRelativa01 ?? 0);
      if (this.bars.rain) this.bars.rain.update(clima.lluviaGPM ?? clima.precipitation01 ?? 0);

      if (player) {
        const eMax = player.energiaMax || 1;
        if (this.bars.money) this.bars.money.update((player.cartera ?? 0) / 10000);
        if (this.bars.energy) this.bars.energy.update((player.energiaActual ?? 0) / eMax);
        hasEnergy = (player.energiaActual ?? 0) > (eMax * 0.1);
        canAfford = (player.cartera ?? 0) > 50;
      }
    }

    if (this.dayText) {
      const nextDayText = t('ui.dayDisplay', { label: dayLabel, day: dayN });
      if (this.dayText.text !== nextDayText) {
        this.tweens.add({
          targets: [this.dayText, this.clockText],
          scale: 1.05,
          duration: 150,
          yoyo: true,
          repeat: 0,
          ease: 'Sine.easeInOut'
        });
      }
      this.dayText.setText(nextDayText);
    }

    if (this.clockText) {
      this.clockText.setText(t('ui.clockDisplay', {
        dayLabel,
        day: dayN,
        totalDays,
        date: dateStr
      }));
    }

    if (this.fpsText) {
      this.fpsText.setText(t('ui.fpsLabel', { value: Math.max(0, Math.floor(this.game.loop.actualFps || 0)) }));
    }

    if (this.moneyText) {
      const moneyValue = player ? player.cartera.toFixed(0) : 0;
      this.moneyText.setText(t('ui.moneyLabel', { value: moneyValue }));
    }

    if (this.playerNameText) {
      const profileName = window.__CV_START__?.profile?.name;
      const nextName = profileName || t('ui.defaultPlayerName');
      if (this.playerNameText.text !== nextName) {
        this.playerNameText.setText(nextName);
        this.updatePanelScroll(this.statusPanel);
      }
    }

    if (this.levelText) {
      const nextLevel = t('ui.levelDisplay', { level: levelName });
      if (this.levelText.text !== nextLevel) {
        this.levelText.setText(nextLevel);
        this.updatePanelScroll(this.statusPanel);
      }
    }

    const CRITICAL_HEAT_THRESHOLD = 0.70;
    const highHeatStress = (heatValue >= CRITICAL_HEAT_THRESHOLD);

    if (this.heatAlertTween && this.bars?.heat?.bg) {
      if (highHeatStress) {
        if (this.heatAlertTween.paused) {
          this.heatAlertTween.play();
        }
      } else if (this.heatAlertTween.isPlaying()) {
        this.heatAlertTween.pause();
        this.bars.heat.bg.setAlpha(1).fillColor = 0x000000;
      }
    }

    this.actionButtons.forEach(button => {
      if (!button || !button.bg) return;
      const bg = button.bg;

      const previouslyEnabled = bg.input && bg.input.enabled;
      const isEnabled = hasEnergy && canAfford;

      bg.setAlpha(isEnabled ? 1 : 0.55);

      if (isEnabled) {
        if (!previouslyEnabled) {
          this.tweens.add({
            targets: [bg, button.text],
            scale: 1.02,
            duration: 100,
            yoyo: true,
            repeat: 0,
            ease: 'Quad.easeOut'
          });
          bg.setInteractive({ useHandCursor: true });
          bg.fillColor = this.colors.actionButton;
        }
      } else if (previouslyEnabled) {
        bg.disableInteractive();
        bg.fillColor = this.colors.actionButtonDisabled;
      }
    });

    if (this.alertsText?.visible) {
      const alerts = repoAll('alertas').filter(a => a.visible !== false).slice(-5);
      const alertsText = alerts.length ? alerts.map(a => `• ${a.mensaje}`).join('\n') : t('ui.alertsEmpty');
      this.alertsText.setText(alertsText);
    } else if (this.alertsText) {
      this.alertsText.setText('');
    }
  }
}
