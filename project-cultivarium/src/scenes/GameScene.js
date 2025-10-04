/**
 * GameScene
 * - Render de Parcelas (ORTHO o ISO).
 * - Selección de parcela y acciones del jugador (R: regar, C: cosechar).
 * - Integra sistemas (clima, cultivos, plagas, alertas).
 */
import Phaser from 'phaser';
import { GAME } from '../main.js';
import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { TIPOS, EVENTOS_TIPO, NIVELES } from '../data/enums.js';
import { tickClimate } from '../systems/climateSystem.js';
import { tickCrops } from '../systems/cropSystem.js';
import { tickPlagues } from '../systems/plagueSystem.js';
import { tickAlerts } from '../systems/alertSystem.js';
import { findFirstPlayer, spend } from '../core/state.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
    this.sprites = new Map();       // idParcela -> sprite
    this.selectedParcelaId = null;  // id actual seleccionado
    this.cursors = null;
    this.keyR = null;
    this.keyC = null;
    this.camSpeed = 400;
  }

  create() {
    // === Mundo demo: jugador, tienda, macro, grid de parcelas ===
    const player = Factory.createPlayer({ name: 'AgroPro', cartera: 200 });
    Factory.createTienda(); // stock básico RIEGO/COSECHA
    const macro = Factory.createMacroRegion({ nombre: 'GLOBAL' });

    // === Parámetros del mapa ===
    // Tamaño de la granja (parcelas centrales)
    const FARM_COLS = 20;
    const FARM_ROWS = 12;
    // Ancho del "anillo" de pasto que rodea la granja
    const BORDER = 3;

    // Tiles isométricos
    const tileW = GAME.ISO_TILE_W * GAME.TILE_SCALE; // 64 (o 128 si tus sprites son 128x64)
    const tileH = (GAME.ISO_TILE_W / 2) * GAME.TILE_SCALE; // 32 (o 64 si tus sprites son 128x64)
    const halfW = tileW / 2;
    const halfH = tileH / 2;

    // Offsets para centrar el mapa en pantalla
    const offX = this.scale.width / 2;
    const offY = 100;

    // Helpers
    const pick = arr => arr[(Math.random() * arr.length) | 0];
    const parcelKeys = ['parcel_0', 'parcel_1', 'parcel_2']; // tus 3 texturas de parcela
    const grassKeys  = ['grass_0', 'grass_1', 'grass_2'];    // tus 3 texturas de pasto

    // Limites totales incluyendo borde
    const TOTAL_COLS = FARM_COLS + BORDER * 2;
    const TOTAL_ROWS = FARM_ROWS + BORDER * 2;

    // Coordenadas lógicas van de 0..TOTAL-1, la granja ocupa el rectángulo central
    const FARM_MIN_X = BORDER;
    const FARM_MIN_Y = BORDER;
    const FARM_MAX_X = BORDER + FARM_COLS - 1;
    const FARM_MAX_Y = BORDER + FARM_ROWS - 1;

    // Crea todo el mosaico isométrico
    for (let gy = 0; gy < TOTAL_ROWS; gy++) {
      for (let gx = 0; gx < TOTAL_COLS; gx++) {
        const isFarm =
          gx >= FARM_MIN_X && gx <= FARM_MAX_X &&
          gy >= FARM_MIN_Y && gy <= FARM_MAX_Y;

        // proyección isométrica
        const sx = offX + (gx - gy) * halfW;
        const sy = offY + (gx + gy) * halfH;

        // Textura según sea pasto (borde) o parcela (centro)
        const textureKey = isFarm ? pick(parcelKeys) : pick(grassKeys);

        const s = this.add.image(sx, sy, textureKey).setOrigin(0.5, 0.5).setScale(GAME.TILE_SCALE);;
        s.setDepth(sy); // depth-sort simple por Y

        if (isFarm) {
          // Solo las parcelas centrales son "interactivas" (seleccionables)
          // Crea la entidad lógica (recursos/cultivo) si no la creaste antes
          const recAgua = Factory.createRecurso({ tipo: 'AGUA', nivel: 0.8 });
          const cultivo = Factory.createCultivo({ tipo: (gx + gy) % 3 === 0 ? 'MAIZ' : 'TRIGO' });

          const parcela = Factory.createParcela({
            x: gx, y: gy, w: tileW, h: tileH,
            macroRegionId: null,
            recursos: [recAgua.id],
            cultivoId: cultivo.id,
            saludSuelo: 0.8
          });

          // Guarda el id en el sprite para inspección
          s.setData('parcelaId', parcela.id);
          s.setInteractive({ useHandCursor: true });
          s.on('pointerdown', () => this.selectParcela(parcela.id));
        }
      }
    }

    // Ajusta límites de cámara (cálculo de bounding box del rombo total)
    const topLeftX     = offX + (0 - (TOTAL_ROWS - 1)) * halfW;
    const topLeftY     = offY + (0 + 0) * halfH;
    const bottomRightX = offX + ((TOTAL_COLS - 1) - 0) * halfW;
    const bottomRightY = offY + ((TOTAL_COLS - 1) + (TOTAL_ROWS - 1)) * halfH;

    // Márgenes extra para scroll cómodo
    const pad = 200;
    this.cameras.main.setBounds(
      Math.min(topLeftX, bottomRightX) - pad,
      Math.min(topLeftY, bottomRightY) - pad,
      Math.abs(bottomRightX - topLeftX) + pad * 2,
      Math.abs(bottomRightY - topLeftY) + pad * 2
    );


    // Evento de clima de ejemplo (sequía en mitad izquierda)
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: GAME.ISO_MODE
        ? { x: -9999, y: -9999, w: 9999, h: 9999 } // (en modo ISO usamos demo global)
        : { x: 80, y: 80, w: 4*(size+gap), h: rows*(size+gap) }
    });

    // Cámara + entrada
    this.cameras.main.setBounds(-1000, -1000, 3000, 3000);
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    // HUD
    this.add.text(16, 8,
      GAME.ISO_MODE
      ? 'ISO: Riega (R) / Cosecha (C) — Click parcela para seleccionar'
      : 'ORTHO: Riega (R) / Cosecha (C) — Click parcela para seleccionar',
      { fontFamily:'ui-sans-serif, system-ui, sans-serif', fontSize:'14px', color:'#e2e8f0' }
    ).setScrollFactor(0);
  }

  // Selección de parcela + avisa a la UI
  selectParcela(id) {
    this.selectedParcelaId = id;
    const p = repoGet('parcelas', id);
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
    this.game.events.emit('inspect:parcela', {
      id: p?.id, saludSuelo: p?.saludSuelo?.toFixed(2),
      cultivo: c ? { tipo: c.tipo, etapa: c.etapa, progreso: c.progreso.toFixed(2) } : null,
      agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null
    });
  }

  // Acción: RIEGO (cuesta 10; sube agua +0.25)
  waterSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    const player = findFirstPlayer();
    if (!spend(player, 10)) {
      this.game.events.emit('toast', { type: 'warn', msg: 'Fondos insuficientes para riego (10).' });
      return;
    }

    const agua = p.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
    if (agua) {
      agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);
      this.game.events.emit('toast', { type: 'ok', msg: `Riego aplicado a ${p.id}.` });
      // limpiar alertas de agua baja (simple)
      const alerts = repoAll('alertas');
      alerts.forEach(a => { if (a.parcelaId === p.id) a.visible = false; });
      // refrescar panel
      this.selectParcela(p.id);
    }
  }

  // Acción: COSECHA (gana 30 si etapa==COSECHA y progreso>=1)
  harvestSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p || !p.cultivoId) return;
    const c = repoGet('cultivos', p.cultivoId);
    const player = findFirstPlayer();
    if (c.etapa === 'COSECHA' && c.progreso >= 1) {
      player.cartera += 30;
      // resembrar rápidamente:
      c.etapa = 'SIEMBRA';
      c.progreso = 0;
      this.game.events.emit('toast', { type: 'ok', msg: `Cosechado ${c.tipo} en ${p.id}. +30` });
      this.selectParcela(p.id);
    } else {
      this.game.events.emit('toast', { type: 'warn', msg: 'Aún no está listo para cosecha.' });
    }
  }

  update(_, delta) {
    // Cámara (flechas)
    const cam = this.cameras.main;
    if (this.cursors.left?.isDown)  cam.scrollX -= this.camSpeed * (delta/1000);
    if (this.cursors.right?.isDown) cam.scrollX += this.camSpeed * (delta/1000);
    if (this.cursors.up?.isDown)    cam.scrollY -= this.camSpeed * (delta/1000);
    if (this.cursors.down?.isDown)  cam.scrollY += this.camSpeed * (delta/1000);

    // Atajos
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.waterSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.harvestSelected();

    // Simulador
    State.clock += 1;
    tickClimate();
    tickCrops();
    tickPlagues();
    tickAlerts();
  }
}
