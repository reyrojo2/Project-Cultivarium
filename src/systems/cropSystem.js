/**
 * Sistema de Cultivos
 * - Consume agua en base a consumoAgua y avanza progreso si hay recursos.
 * - Sistema de etapas: SEMILLA → BROTE → CRECIMIENTO → MADURO → COSECHA
 * - Aplica penalizadores por clima/plagas.
 */
import { State, repoAll, repoGet } from '../core/state.js';

// Configuración de cultivos disponibles
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

export function tickCrops() {
  const parcelas = repoAll('parcelas');
  
  for (const p of parcelas) {
    if (!p.cultivoId) continue;
    const c = repoGet('cultivos', p.cultivoId);
    if (!c) continue;

    // Inicializar salud si no existe
    if (c.saludActual === undefined) c.saludActual = 1;
    
    // No procesar cultivos muertos
    if (c.saludActual <= 0) continue;

    // Obtener configuración del cultivo
    const config = CROP_CONFIG[c.tipo];
    if (!config) continue;

    // Consumo de agua
    const recAguaId = p.recursos.find(rid => State.repos.recursos.get(rid)?.tipo === 'AGUA');
    if (!recAguaId) continue;

    const rec = State.repos.recursos.get(recAguaId);
    
    // Consumir agua según el tipo de cultivo
    rec.nivel = Math.max(0, rec.nivel - 0.002 * (config.consumoAgua || 1));
    
    // Crecimiento del cultivo
    if (rec.nivel > 0.2 && c.saludActual > 0.3) {
      // Velocidad base de crecimiento
      let velocidadCrecimiento = 0.002;
      
      // Bonus si el suelo está muy saludable
      if (p.saludSuelo > 0.8) {
        velocidadCrecimiento *= 1.2;
      }
      
      // Penalización si el suelo está dañado
      if (p.saludSuelo < 0.4) {
        velocidadCrecimiento *= 0.7;
      }
      
      // Penalización por baja salud del cultivo
      velocidadCrecimiento *= c.saludActual;
      
      c.progreso = Math.min(1, c.progreso + velocidadCrecimiento);
      
      // Actualizar etapa según progreso
      updateCropStage(c, config);
    } 
    // Sin agua suficiente: pierde salud lentamente
    else if (rec.nivel < 0.15) {
      c.saludActual = Math.max(0, c.saludActual - 0.0005);
      
      // Si muere por falta de agua
      if (c.saludActual <= 0) {
        c.etapa = 'MUERTO';
      }
    }
  }
}

/**
 * Actualiza la etapa del cultivo según su progreso
 */
function updateCropStage(cultivo, config) {
  if (!config || !config.etapas) return;
  // Emitir evento cuando cambie la etapa
if (window.game && window.game.scene && window.game.scene.keys['GameScene']) {
  const gs = window.game.scene.keys['GameScene'];
  gs.updateCultivoSprite(c);
}
  
  const etapas = config.etapas;
  const progresoTotal = cultivo.progreso;
  
  // Calcular en qué etapa está según el progreso
  // 0.0-0.2 = SEMILLA, 0.2-0.4 = BROTE, 0.4-0.6 = CRECIMIENTO, 0.6-0.8 = MADURO, 0.8-1.0 = COSECHA
  const etapaIndex = Math.min(
    Math.floor(progresoTotal * etapas.length),
    etapas.length - 1
  );
  
  const nuevaEtapa = etapas[etapaIndex];
  
  // Solo actualizar si cambió
  if (cultivo.etapa !== nuevaEtapa) {
    cultivo.etapa = nuevaEtapa;
  }
}

/**
 * Verifica si un cultivo está listo para cosechar
 */
export function isCultivoListo(cultivoId) {
  const c = repoGet('cultivos', cultivoId);
  if (!c) return false;
  return c.etapa === 'COSECHA' && c.progreso >= 0.8;
}

/**
 * Obtiene información del cultivo para mostrar en UI
 */
export function getCultivoInfo(cultivoId) {
  const c = repoGet('cultivos', cultivoId);
  if (!c) return null;
  
  const config = CROP_CONFIG[c.tipo];
  if (!config) return null;
  
  return {
    tipo: c.tipo,
    nombre: config.nombre,
    etapa: c.etapa,
    progreso: c.progreso,
    salud: c.saludActual,
    listo: isCultivoListo(cultivoId),
    precioVenta: config.precioVenta
  };
}