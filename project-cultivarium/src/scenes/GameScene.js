/**
 * GameScene
 * - Renderiza un grid de Parcelas.
 * - Crea datos de ejemplo vía Factory (jugador, recursos, cultivo, clima).
 * - Avanza los "sistemas" en update: clima, cultivos, plagas, alertas.
 */
import Phaser from 'phaser';
import { State, repoAll, repoGet, repoSet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { TIPOS, EVENTOS_TIPO, NIVELES } from '../data/enums.js';
import { tickClimate } from '../systems/climateSystem.js';
import { tickCrops } from '../systems/cropSystem.js';
import { tickPlagues } from '../systems/plagueSystem.js';
import { tickAlerts } from '../systems/alertSystem.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
    this.sprites = new Map(); // idParcela -> sprite
    this.player = null;
    this.cursors = null;
    this.camSpeed = 400;
  }

  create() {
    // --- Datos de ejemplo (mundo base) ---
    const player = Factory.createPlayer({ name: 'AgroPro' });
    const macro = Factory.createMacroRegion({ nombre: 'GLOBAL' });

    // Crear un grid 8x5 de Parcelas
    const cols = 8, rows = 5, size = 64, gap = 6;
    for (let y=0; y<rows; y++) {
      for (let x=0; x<cols; x++) {
        const px = 80 + x*(size+gap);
        const py = 80 + y*(size+gap);
        const recAgua = Factory.createRecurso({ tipo: TIPOS.RECURSO.AGUA, nivel: NIVELES.RECURSO.ALTO });
        const cultivo = Factory.createCultivo({ tipo: (x+y)%3===0 ? 'MAIZ':'TRIGO' });
        const parcela = Factory.createParcela({
          x: px, y: py, w: size, h: size,
          macroRegionId: macro.id,
          recursos: [recAgua.id],
          cultivoId: cultivo.id,
          saludSuelo: 0.8
        });
        // Visual
        const s = this.add.image(parcela.x, parcela.y, 'parcel').setOrigin(0);
        s.setInteractive({ useHandCursor: true });
        s.on('pointerdown', () => this.inspectParcela(parcela.id));
        this.sprites.set(parcela.id, s);
      }
    }

    // Evento de clima de ejemplo
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: { x: 80, y: 80, w: 4*(size+gap), h: rows*(size+gap) }
    });

    // Cámara y entrada
    this.cameras.main.setBounds(0, 0, 1200, 900);
    this.cursors = this.input.keyboard.createCursorKeys();

    // HUD sencillo: título de escena
    this.add.text(16, 8, 'Mapa de Parcelas (click para inspeccionar)', {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: '14px', color: '#e2e8f0'
    }).setScrollFactor(0);
  }

  inspectParcela(id) {
    // Al hacer click, emite un evento para la UIScene con el detalle
    const p = repoGet('parcelas', id);
    const cultivo = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
    this.game.events.emit('inspect:parcela', {
      id: p?.id, saludSuelo: p?.saludSuelo?.toFixed(2),
      cultivo: cultivo ? { tipo: cultivo.tipo, etapa: cultivo.etapa, progreso: cultivo.progreso.toFixed(2) } : null,
      agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null
    });
  }

  update(_, delta) {
    // Cámara WASD opcional
    const cam = this.cameras.main;
    if (this.cursors.left?.isDown) cam.scrollX -= this.camSpeed * (delta/1000);
    if (this.cursors.right?.isDown) cam.scrollX += this.camSpeed * (delta/1000);
    if (this.cursors.up?.isDown) cam.scrollY -= this.camSpeed * (delta/1000);
    if (this.cursors.down?.isDown) cam.scrollY += this.camSpeed * (delta/1000);

    // Avance del simulador
    State.clock += 1;
    tickClimate();
    tickCrops();
    tickPlagues();
    tickAlerts();
  }
}
