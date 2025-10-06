/**
 * economy.js
 * -----------------------------
 * Definimos en un único módulo los costos base de las acciones del jugador.
 * Esto mantiene sincronizados a GameScene y UIScene cuando verifiquen fondos.
 */
import { CROP_CONFIG } from '../systems/cropSystem.js';

/** Costo fijo de aplicar riego manual sobre una parcela. */
export const WATER_ACTION_COST = 10;

/**
 * Calcula el costo mínimo de las semillas disponibles.
 * Se utiliza para decidir si el botón de "Sembrar" puede habilitarse.
 */
export function getMinimumSeedCost() {
  const costs = Object.values(CROP_CONFIG)
    .map(cfg => Number(cfg?.costoSemilla) || 0)
    .filter(cost => cost > 0);
  return costs.length ? Math.min(...costs) : 0;
}

/**
 * Tabla de requisitos en dinero para cada acción mostrada en la UI.
 * Si en el futuro cambian los precios, sólo hay que actualizar este mapa.
 */
export const ACTION_FUNDS_REQUIREMENTS = {
  plow: 0,
  water: WATER_ACTION_COST,
  plant: getMinimumSeedCost(),
  harvest: 0,
  upgrade: 0,
  scan: 0,
  sell: 0,
};
