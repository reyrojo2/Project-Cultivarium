/**
 * Sistema de Cultivos
 * - Gestiona crecimiento por etapas y consumo de agua.
 * - Ajusta progreso según salud del suelo y salud del cultivo.
 * - Emite actualizaciones visuales cuando cambia la etapa.
 */
import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { ALERTAS_TIPO } from '../data/enums.js';
import { translate as t } from '../utils/i18n.js';

const CROP_ALERT_CODE = 'CROP_DEAD';

// Administra la alerta persistente que marca cuando un cultivo muere en una parcela
function ensureCropAlert(parcelaId, message) {
  if (!parcelaId) return;
  const alertsRepo = State?.repos?.alertas;
  if (!alertsRepo) return;

  const existing = Array.from(alertsRepo.values())
    .find(a => a.parcelaId === parcelaId && a.codigo === CROP_ALERT_CODE);

  if (message) {
    if (existing) {
      existing.mensaje = message;
      existing.visible = true;
      existing.tipo = ALERTAS_TIPO.PELIGRO;
    } else {
      Factory.createAlerta({
        tipo: ALERTAS_TIPO.PELIGRO,
        mensaje: message,
        parcelaId,
        codigo: CROP_ALERT_CODE
      });
    }
  } else if (existing) {
    existing.visible = false;
  }
}

// Configuración base de cultivos disponibles.
export const CROP_CONFIG = {
  MAIZ: {
    nombre: 'Maíz',
    diasCrecimiento: 30,
    consumoAgua: 1.0,
    precioVenta: 50,
    costoSemilla: 15,
    resistenciaPlagas: 0.1,
    etapas: ['SEMILLA', 'BROTE', 'CRECIMIENTO', 'MADURO', 'COSECHA']
  },
  TRIGO: {
    nombre: 'Trigo',
    diasCrecimiento: 20,
    consumoAgua: 0.8,
    precioVenta: 35,
    costoSemilla: 10,
    resistenciaPlagas: 0.2,
    etapas: ['SEMILLA', 'BROTE', 'CRECIMIENTO', 'MADURO', 'COSECHA']
  },
  PAPA: {
    nombre: 'Papa',
    diasCrecimiento: 25,
    consumoAgua: 1.2,
    precioVenta: 40,
    costoSemilla: 12,
    resistenciaPlagas: 0.15,
    etapas: ['SEMILLA', 'BROTE', 'CRECIMIENTO', 'MADURO', 'COSECHA']
  },
  TOMATE: {
    nombre: 'Tomate',
    diasCrecimiento: 35,
    consumoAgua: 1.3,
    precioVenta: 60,
    costoSemilla: 18,
    resistenciaPlagas: 0.05,
    etapas: ['SEMILLA', 'BROTE', 'CRECIMIENTO', 'MADURO', 'COSECHA']
  }
};

const BASE_GROWTH_RATE = 0.002;
const HEALTH_RECOVERY_RATE = 0.0003;
const HEALTH_DECAY_RATE = 0.0005;
const WATER_THRESHOLD_GROW = 0.2;
const WATER_THRESHOLD_DECAY = 0.15;

function notifyCropStageChange(cultivo) {
  if (typeof window === 'undefined') return;
  const phaserGame = window.__PHASER_GAME__ || window.game;
  const scene = phaserGame?.scene?.keys?.Game;
  if (scene?.updateCultivoSprite) {
    scene.updateCultivoSprite(cultivo);
  }
}

export function tickCrops() {
  const parcelas = repoAll('parcelas');

  for (const p of parcelas) {
    if (!p.cultivoId) continue;
    const cultivo = repoGet('cultivos', p.cultivoId);
    if (!cultivo) continue;

    if (typeof cultivo.saludActual !== 'number') cultivo.saludActual = 1;
    cultivo.saludActual = Math.min(Math.max(cultivo.saludActual, 0), 1);

    if (cultivo.saludActual <= 0) {
      if (cultivo.etapa !== 'MUERTO') {
        cultivo.etapa = 'MUERTO';
        notifyCropStageChange(cultivo);
      }
      ensureCropAlert(p.id, t('ui.alerts.cropDied', { parcel: p.id }));
      continue;
    }

    const config = CROP_CONFIG[cultivo.tipo];
    if (!config) continue;

    const recAguaId = p.recursos.find(rid => State.repos.recursos.get(rid)?.tipo === 'AGUA');
    if (!recAguaId) {
      cultivo.saludActual = Math.max(0, cultivo.saludActual - HEALTH_DECAY_RATE);
      if (cultivo.saludActual <= 0 && cultivo.etapa !== 'MUERTO') {
        cultivo.etapa = 'MUERTO';
        notifyCropStageChange(cultivo);
      }
      if (cultivo.saludActual <= 0) {
        ensureCropAlert(p.id, t('ui.alerts.cropDied', { parcel: p.id }));
      }
      continue;
    }

    const recursoAgua = State.repos.recursos.get(recAguaId);
    const consumoAgua = config.consumoAgua ?? cultivo.consumoAgua ?? 1;
    recursoAgua.nivel = Math.max(0, recursoAgua.nivel - (BASE_GROWTH_RATE * consumoAgua));

    if (recursoAgua.nivel > WATER_THRESHOLD_GROW) {
      let velocidadCrecimiento = BASE_GROWTH_RATE * (30 / (config.diasCrecimiento || 30));

      if (p.saludSuelo > 0.8) velocidadCrecimiento *= 1.2;
      if (p.saludSuelo < 0.4) velocidadCrecimiento *= 0.7;

      velocidadCrecimiento *= Math.max(cultivo.saludActual, 0);

      cultivo.progreso = Math.min(1, cultivo.progreso + velocidadCrecimiento);

      if (cultivo.saludActual < 1 && recursoAgua.nivel > 0.5) {
        cultivo.saludActual = Math.min(1, cultivo.saludActual + HEALTH_RECOVERY_RATE);
      }

      const etapaAnterior = cultivo.etapa;
      updateCropStage(cultivo, config);
      if (cultivo.etapa !== etapaAnterior) {
        notifyCropStageChange(cultivo);
      }
    } else if (recursoAgua.nivel < WATER_THRESHOLD_DECAY) {
      cultivo.saludActual = Math.max(0, cultivo.saludActual - HEALTH_DECAY_RATE);
      if (cultivo.saludActual <= 0 && cultivo.etapa !== 'MUERTO') {
        cultivo.etapa = 'MUERTO';
        notifyCropStageChange(cultivo);
      }
      if (cultivo.saludActual <= 0) {
        ensureCropAlert(p.id, t('ui.alerts.cropDied', { parcel: p.id }));
      }
    }

    if (cultivo.saludActual > 0 && cultivo.etapa !== 'MUERTO') {
      ensureCropAlert(p.id, null);
    }
  }
}

function updateCropStage(cultivo, config) {
  if (!config?.etapas?.length) return;
  const etapas = config.etapas;
  const progreso = cultivo.progreso ?? 0;
  const index = Math.min(Math.floor(progreso * etapas.length), etapas.length - 1);
  const etapa = etapas[index];
  if (cultivo.etapa !== etapa) {
    cultivo.etapa = etapa;
  }
}

export function isCultivoListo(cultivoId) {
  const cultivo = repoGet('cultivos', cultivoId);
  if (!cultivo) return false;
  return cultivo.etapa === 'COSECHA' && (cultivo.progreso ?? 0) >= 0.8;
}

export function getCultivoInfo(cultivoId) {
  const cultivo = repoGet('cultivos', cultivoId);
  if (!cultivo) return null;

  const config = CROP_CONFIG[cultivo.tipo];
  if (!config) return null;

  return {
    tipo: cultivo.tipo,
    nombre: config.nombre,
    etapa: cultivo.etapa,
    progreso: cultivo.progreso,
    salud: cultivo.saludActual,
    listo: isCultivoListo(cultivoId),
    precioVenta: config.precioVenta
  };
}
