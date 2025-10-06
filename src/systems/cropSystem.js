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
import { TimeState, MINUTES_PER_SIM_DAY } from '../core/time.js';

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

// Tasas expresadas “por día de simulación”. Las multiplicamos por deltaDays en runtime.
const BASE_GROWTH_RATE = 1;
const HEALTH_RECOVERY_PER_DAY = 0.10;
const HEALTH_DECAY_PER_DAY = 0.15;
const CROP_WATER_USE_PER_DAY = 0.12;
const WATER_THRESHOLD_GROW = 0.2;
const WATER_THRESHOLD_DECAY = 0.15;

// Guardamos el último timestamp sim en minutos para calcular delta entre ticks.
let lastSimMinutes = 0;

/**
 * Evaporación aproximada por día basada sólo en temperatura.
 * A 30 °C devuelve ≈0.5, lo que obliga a regar dos veces por día.
 */
function calculateEvaporationPerDay(tempC = 25) {
  const temp = Number.isFinite(tempC) ? tempC : 25;

  if (temp <= 10) {
    // Climas frescos: el agua se pierde muy despacio.
    return 0.08 + (Math.max(temp, 0) / 10) * 0.02;
  }
  if (temp <= 20) {
    const u = (temp - 10) / 10;
    return 0.10 + u * 0.10;
  }
  if (temp <= 30) {
    const u = (temp - 20) / 10;
    return 0.20 + u * 0.18;
  }
  if (temp <= 35) {
    const u = (temp - 30) / 5;
    return 0.38 + u * 0.12;
  }
  const u = Math.min((temp - 35) / 10, 1);
  return 0.50 + u * 0.10;
}

function computeDeltaSimDays() {
  const currentMinutes = Number(TimeState?.simMinutes) || 0;
  let deltaMinutes = currentMinutes - lastSimMinutes;

  if (!Number.isFinite(deltaMinutes) || deltaMinutes < 0) {
    deltaMinutes = 0;
  }

  let deltaDays = deltaMinutes / (MINUTES_PER_SIM_DAY || 1440);

  if (deltaDays <= 0) {
    // Fallback cuando el primer frame aún no avanza el reloj.
    const minPerSec = Number(TimeState?.minPerRealSec) || 0;
    deltaDays = (minPerSec / 60) / (MINUTES_PER_SIM_DAY || 1440);
  }

  lastSimMinutes = currentMinutes;
  return Math.max(deltaDays, 0);
}

function notifyCropStageChange(cultivo) {
  if (typeof window === 'undefined') return;
  const phaserGame = window.__PHASER_GAME__ || window.game;
  const scene = phaserGame?.scene?.keys?.Game;
  if (scene?.updateCultivoSprite) {
    scene.updateCultivoSprite(cultivo);
  }
}

export function tickCrops() {
  const deltaDays = computeDeltaSimDays();
  if (deltaDays <= 0) return;

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
      cultivo.saludActual = Math.max(0, cultivo.saludActual - (HEALTH_DECAY_PER_DAY * deltaDays));
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
    const evapPerDay = calculateEvaporationPerDay(p.temperatura ?? State?.climate?.temperature);
    const cropUsePerDay = CROP_WATER_USE_PER_DAY * consumoAgua;
    const totalLoss = (evapPerDay + cropUsePerDay) * deltaDays;
    recursoAgua.nivel = Math.max(0, recursoAgua.nivel - totalLoss);

    if (recursoAgua.nivel > WATER_THRESHOLD_GROW) {
      let velocidadCrecimiento = (BASE_GROWTH_RATE / (config.diasCrecimiento || 30)) * deltaDays;

      if (p.saludSuelo > 0.8) velocidadCrecimiento *= 1.2;
      if (p.saludSuelo < 0.4) velocidadCrecimiento *= 0.7;

      velocidadCrecimiento *= Math.max(cultivo.saludActual, 0);

      cultivo.progreso = Math.min(1, cultivo.progreso + velocidadCrecimiento);

      if (cultivo.saludActual < 1 && recursoAgua.nivel > 0.5) {
        cultivo.saludActual = Math.min(1, cultivo.saludActual + (HEALTH_RECOVERY_PER_DAY * deltaDays));
      }

      const etapaAnterior = cultivo.etapa;
      updateCropStage(cultivo, config);
      if (cultivo.etapa !== etapaAnterior) {
        notifyCropStageChange(cultivo);
      }
    } else if (recursoAgua.nivel < WATER_THRESHOLD_DECAY) {
      cultivo.saludActual = Math.max(0, cultivo.saludActual - (HEALTH_DECAY_PER_DAY * deltaDays));
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
