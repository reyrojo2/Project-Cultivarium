import Phaser from 'phaser';
import { State, repoAll, findFirstPlayer, repoGet } from '../core/state.js';
import { TimeState, getSimDate, getSimDayNumber, LEVELS } from '../core/time.js';

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
    this.heatAlertTween = null; // Control del Tween
    this._dom = null;        // refs DOM cacheadas
    this._domLast = null;    // último snapshot para evitar trabajo repetido
    this._domDay = null;     // último día escrito en DOM
  }

  create() {
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
        water: 0x60a5fa, // Azul (SMAP)
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
    this.clockText = this.add.text(screenW / 2, 10, 'Nivel — Día 1', { fontSize: '14px', color: colors.textPrimary, fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 10, y: 5 } }).setOrigin(0.5, 0).setDepth(100);
    this.fpsText = this.add.text(screenW - 10, 10, 'FPS: 60', { fontSize: '10px', color: colors.dataAccent, backgroundColor: 'rgba(0,0,0,0.3)' }).setOrigin(1, 0).setDepth(100);
    this.moneyText = this.add.text(screenW / 2, 35, '₲ 0', { fontSize: '24px', color: colors.bar.money, fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 12, y: 5 } }).setOrigin(0.5, 0).setDepth(100);

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
      const riesgoPlaga = data.riesgoPlaga || 0;
      const intensidadPlaga = data.intensidadPlaga || 0;
      const plagaActiva = data.plagaActiva || false;
      const lines = [
        `Parcela: #${data.id}`,
        `Suelo: ${data.saludSuelo ? (data.saludSuelo * 100).toFixed(0) + '%' : '??'}`,
        data.cultivo ? `Cultivo: ${data.cultivo.tipo} (${data.cultivo.etapa} ${(data.cultivo.progreso * 100).toFixed(0)}%)` : 'Cultivo: -',
        data.agua ? `Agua: ${(data.agua.nivel * 100).toFixed(0)}%` : 'Agua: -',
        '', // línea en blanco
        `Plaga: ${plagaActiva ? 'ACTIVA' : 'No'}`,
        `Riesgo: ${(riesgoPlaga * 100).toFixed(1)}%`,
        `Intensidad: ${intensidadPlaga > 0 ? intensidadPlaga + '/3' : '-'}`
      ];
      this.inspectText.setText(lines.join('\n'));
    });

    this.game.events.on('toast', (t) => {
      this.showActionFeedback(t.msg, t.type === 'ok' ? colors.feedback.success : colors.feedback.error);
    });
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
    this.locationText   = this.add.text(W / 2, y += 30, 'Pampa Húmeda, AR', { fontSize: '16px', color: colors.textSecondary }).setOrigin(0.5, 0);

    // Día destacado (Aplica colores Data Accent)
    this.dayText = this.add.text(W / 2, y += 30, 'Día: 1', {
      fontSize: '18px',
      color: Phaser.Display.Color.IntegerToColor(colors.dataAccent).rgba, 
      fontStyle: '600',
      backgroundColor: Phaser.Display.Color.IntegerToColor(colors.dataPanelBg).rgba, 
      padding: { x: 12, y: 6 },
      align: 'center',
    }).setOrigin(0.5, 0);

    y += 48;

    // Barras
    this.bars = {
      hp:        this.createHudBar('SALUD (NDVI)', y, colors.bar.hp, W, colors),
      heat:      this.createHudBar('CALOR (Estrés)', y += 66, colors.bar.heat, W, colors),
      water:     this.createHudBar('HUMEDAD (SMAP RZSM)', y += 66, colors.bar.water, W, colors),
      humidity:  this.createHudBar('HUMEDAD (Relativa)', y += 66, colors.bar.humidity, W, colors),
      rain:      this.createHudBar('LLUVIA (GPM)', y += 66, colors.bar.rain, W, colors),
      money:     this.createHudBar('DINERO ($)', y += 66, colors.bar.money, W, colors),
      energy:    this.createHudBar('ENERGÍA (⚡)', y += 66, colors.bar.energy, W, colors),
    };
    Object.values(this.bars).forEach(bar => container.add(bar.elements));

    // Separadores y Bloques de Información
    const sep1 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 58, W - 32, 2);
    container.add(sep1);
    y += 12;

    this.inspectTitle = this.add.text(24, y, '🔬 Inspección de Parcela', { fontSize: '18px', color: colors.dataAccent, fontStyle: 'bold' });
    this.inspectText  = this.add.text(24, y + 24, 'Selecciona una parcela…', { fontSize: '12px', color: colors.textSecondary, wordWrap: { width: W - 48 } });

    container.add([this.playerNameText, this.locationText, this.dayText, this.inspectTitle, this.inspectText]);
    container.bringToTop(this.dayText);

    const sep2 = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 110, W - 32, 2);
    container.add(sep2);
    y += 12;

    this.alertsTitle = this.add.text(24, y, '⚠️ Alertas del Sistema', { fontSize: '18px', color: colors.bar.heat, fontStyle: 'bold' });
    this.alertsText  = this.add.text(24, y + 24, 'No hay alertas activas.', { fontSize: '12px', color: colors.textPrimary, wordWrap: { width: W - 48 } });
    container.add([this.alertsTitle, this.alertsText]);
  }

// ---------- Panel de Acciones ----------
populateActionPanel(panel, colors) {
  const container = panel.container;
  const W = panel.width;
  let y = 20;

  const title = this.add.text(W / 2, y, 'Decisiones', {
    fontSize: '24px',
    color: colors.textPrimary,
    fontStyle: 'bold'
  }).setOrigin(0.5, 0);
  container.add(title);
  y += 60;

  // Reinicia el registro de botones (UI Scene -> update() los gestiona)
  this.actionButtons = [];

  // Helper: ejecuta acción con feedback + cooldown visual/táctil
  const runAction = (label, eventType, feedbackText, feedbackColor, directFnName = null, cooldownMs = 500) => {
    const btn = this.createActionButton(label, y, async () => {
      if (btn.coolingDown) return;
      btn.coolingDown = true;

      const gameScene =
        (this.scene?.get && this.scene.get('Game')) ||
        (this.game?.scene?.getScene && this.game.scene.getScene('Game')) ||
        null;

      if (directFnName && gameScene && typeof gameScene[directFnName] === 'function') {
        try { await gameScene[directFnName](); } catch(e) {}
      } else {
        this.game.events.emit('action:perform', { actionType: eventType });
      }

      if (feedbackText) this.showActionFeedback(feedbackText, feedbackColor);

      this.tweens.add({ targets: [btn.bg, btn.text], scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });

      // ⬇️ Cooldown sin perder hitArea
      const prevColor = btn.bg.fillColor;
      btn.bg.fillColor = 0x445c3a;
      if (btn.bg.input) btn.bg.input.enabled = false;

      setTimeout(() => {
        btn.bg.fillColor = prevColor;
        if (btn.bg.input) btn.bg.input.enabled = true; else btn.enable();
        btn.coolingDown = false;
      }, cooldownMs);
    }, W, colors);


    container.add(btn.elements);
    this.actionButtons.push(btn);
    y += 65;
    return btn;
  };

  // --- BOTONES CLAVE (DECISIONES AGRÍCOLAS) ---
  runAction('🚜 Arar',          'ARAR',         '🚜 Arado ejecutado',          colors.feedback.success, 'plowSelected');
  runAction('💧 Regar',         'REGAR',        '💧 Riego ejecutado',          colors.feedback.success, 'waterSelected');
  runAction('🌱 Sembrar',       'SEMBRAR',      '🌱 Siembra iniciada',         colors.feedback.success, 'plantSelected');
  runAction('🌾 Cosechar',      'COSECHAR',     '🌾 Cosecha intentada',        0xfbbf24,               'harvestSelected');

  // Separador
  const sep = this.add.graphics().fillStyle(colors.panelBorder, 0.5).fillRect(16, y += 40, W - 32, 2);
  container.add(sep);
  y += 12;

  // --- AVANZADOS / TECNOLOGÍA & DATOS ---
  runAction('⚙️ Mejorar (Tech)',   'UPGRADE_TECH', '⚙️ Abriendo Tech-Tree',      colors.dataAccent, null, 600);
  runAction('🛰️ Escanear (Data)',  'SCAN_REGION',  '🛰️ Extrayendo Data NASA...', colors.dataAccent, null, 600);
  runAction('💰 Vender Cosecha',    'SELL_HARVEST', '💰 Mercado actualizado',     colors.bar.money,  null, 600);
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
    bgBar.lineStyle(2, colors.panelBorder).strokeRoundedRect(pad, y + 22, barW, 24, 12);

    const valueBar = this.add.graphics();
    
    let updateValue = 0; 

    return {
      elements: [labelText, valueText, bgBar, valueBar],
      bg: bgBar, // Exportamos el background para efectos de alerta (Causal-Reactiva)
      update: (v) => {
        v = Phaser.Math.Clamp(v, 0, 1);
        updateValue = v; // Guarda el valor para el control de alerta
        const disp = (label.includes('DINERO')) ? `₲ ${(v * 10000).toFixed(0)}` : `${(v * 100).toFixed(0)}%`;
        valueText.setText(disp);
        valueBar.clear();
        valueBar.fillStyle(color);
        valueBar.fillRoundedRect(pad + 3, y + 25, (barW - 6) * v, 18, 9);
      },
      get updateValue() { return updateValue; } // Exporta el valor
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

    const t = this.add.text(panelWidth / 2, y + height / 2, text, {
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
        this.tweens.add({ targets: [bg, t], scale: 0.96, duration: 80, yoyo: true, ease: 'Quad.easeInOut' });
        onClick();
      } else {
        this.tweens.add({ targets: bg, x: bg.x + 5, duration: 50, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
        this.showActionFeedback('🚫 ¡Acción Bloqueada! Falta energía o dinero.', this.colors.bar.heat);
      }
    });

    bg.on('pointerover', () => { if (bg.input?.enabled) bg.fillColor = colors.actionButtonHover; });
    bg.on('pointerout',  () => { if (bg.input?.enabled) bg.fillColor = colors.actionButton; });

    // Devuelve helpers
    return { elements: [bg, t], bg, text: t, enable, disable, hitArea };
  }


  // ---------- Update (Controla la lógica de estado y efectos) ----------
  update() {
    // Definiciones de Scope y Variables
    const player = findFirstPlayer();
    const p = player;
    const parcela = p ? repoGet('parcelas', p.parcelaSeleccionadaId) : null;
    const colors = this.colors;
    const dayN = getSimDayNumber(); // Corregido: dayN debe estar definido aquí para el scope
    const L = LEVELS?.[TimeState.levelIdx] || { name: 'Nivel' }; // Corregido: L debe estar definido aquí
    
    let hasEnergy = true;
    let canAfford = true;
    let heatValue = 0;

    // --- 1. Lógica de Estado Real / Mock ---
    const useMockState = false; 

    if (useMockState) {
        // Lógica MOCK (se omite para brevedad)
         const time = this.time.now;
         const mock = {
            hp: 0.75 + Math.sin(time / 1000) * 0.25,
            heat: 0.40 + Math.cos(time / 800)  * 0.30,
            water: 0.50 + Math.sin(time / 1200) * 0.40,
            humidity: 0.60 + Math.cos(time / 1500) * 0.10,
            rain: 0.50 + Math.sin(time / 900) * 0.25,
            money: 0.85 + Math.sin(time / 2000) * 0.05,
            energy: 0.90 + Math.cos(time / 500)  * 0.10
         };
         Object.keys(this.bars).forEach(k => this.bars[k].update(Phaser.Math.Clamp(mock[k], 0, 1)));
         hasEnergy = mock.energy > 0.1;
         canAfford = mock.money > 0.1;
         heatValue = mock.heat;
    } else if (this.bars) {
      // Estado real (si this.bars existe)
      if (parcela) {
        this.bars.hp.update(parcela.saludNDVI ?? 0); 
        this.bars.water.update(parcela.humedadSueloSMAP ?? 0);
        this.bars.heat.update(parcela.estresTermico ?? 0);
        heatValue = parcela.estresTermico ?? 0;
      }
      if ((!parcela || heatValue == null) && State?.clima?.estresTermico01 != null) {
        heatValue = State.clima.estresTermico01;
        this.bars.heat.update(heatValue);
      }

      const clima = State?.clima || {};
      if (this.bars.humidity) this.bars.humidity.update(clima.humedad01 ?? clima.humedadRelativa01 ?? 0);
      if (this.bars.rain) this.bars.rain.update(clima.lluviaGPM ?? clima.precipitation01 ?? 0);
      
      if (p) {
        const eMax = p.energiaMax || 1;
        this.bars.money.update((p.cartera ?? 0) / 10000);
        this.bars.energy.update((p.energiaActual ?? 0) / eMax);
        hasEnergy = (p.energiaActual ?? 0) > (eMax * 0.1);
        canAfford = (p.cartera ?? 0) > 50;
      }
    }

    // --- 2. Actualización de HUD Fijo y Efecto de Pulso en Día ---
    if (this.dayText) {
        const currentDayText = `Día: ${dayN}`;
        if (this.dayText.text !== currentDayText) {
             // CINEMÁTICA: Pulso al cambiar el día
             this.tweens.add({
                targets: [this.dayText, this.clockText],
                scale: 1.05,
                duration: 150,
                yoyo: true,
                repeat: 0, 
                ease: 'Sine.easeInOut'
             });
        }
        this.dayText.setText(currentDayText);
    }
    
    // Actualización de HUD fijo
    if (this.clockText) {
        this.clockText.setText(
            `${L.name} — Día ${dayN}/${TimeState.levelDays} — ` +
            `${getSimDate().getFullYear()}-${String(getSimDate().getMonth()+1).padStart(2,'0')}-${String(getSimDate().getDate()).padStart(2,'0')}`
        );
    }
    if (this.fpsText) this.fpsText.setText('FPS: ' + Math.floor(this.game.loop.actualFps || 0));
    if (this.moneyText) this.moneyText.setText(`₲ ${player ? player.cartera.toFixed(0) : 0}`);
    if (player && window.__CV_START__?.profile?.name && this.playerNameText) {
      this.playerNameText.setText(window.__CV_START__.profile.name);
    }


    // --- 3. Efecto: Alerta de Barra Crítica (Estrés por Calor) ---
    const CRITICAL_HEAT_THRESHOLD = 0.70; 
    const highHeatStress = (heatValue >= CRITICAL_HEAT_THRESHOLD);
    
    if (this.heatAlertTween) {
        if (highHeatStress) {
            if (this.heatAlertTween.paused) {
                this.heatAlertTween.play();
            }
        } else {
            if (this.heatAlertTween.isPlaying()) {
                this.heatAlertTween.pause();
                // Restaura el estado visual de la barra
                this.bars.heat.bg.setAlpha(1).fillColor = 0x000000; 
            }
        }
    }

    // --- 4. Desactivación dinámica de botones y Destello al Desbloquear ---
    this.actionButtons.forEach(button => {
      if (!button || !button.bg) return;
      const bg = button.bg;

      const previouslyEnabled = bg.input && bg.input.enabled;
      const isEnabled = hasEnergy && canAfford;

      bg.setAlpha(isEnabled ? 1 : 0.55);

      if (isEnabled) {
        if (!previouslyEnabled) {
          // EFECTO AÑADIDO: Destello al Desbloquear Botón (feedback positivo)
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
      } else {
        if (previouslyEnabled) {
          // Bloqueo
          bg.disableInteractive();
          bg.fillColor = this.colors.actionButtonDisabled;
        }
      }
    });


    // --- 5. Alertas (últimas 5) ---
    const alerts = repoAll('alertas').filter(a => a.visible !== false).slice(-5);
    const atext = alerts.length ? alerts.map(a => `• ${a.mensaje}`).join('\n') : 'No hay alertas activas.';
    this.alertsText.setText(atext);
  }
}