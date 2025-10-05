/**
 * Sistema de Plagas
 * - Placeholder: incrementa riesgo y podría reducir progreso de cultivos.
 * - En el futuro: spawn de plagas por clima/temporada y tratamientos.
 */

import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { ALERTAS_TIPO } from '../data/enums.js';

export function tickPlagues() {
  const clima = State.clima || { temperatura: 25, humedad: 50, evento: 'NINGUNO' };
  const parcelas = repoAll('parcelas');

  for (const p of parcelas) {
    if (!p.cultivoId) continue;
    const c = repoGet('cultivos', p.cultivoId);
    if (!c) continue;

    // Inicializar propiedades de plaga
    if (p.riesgoPlaga === undefined) p.riesgoPlaga = 0;
    if (p.plagaActiva === undefined) p.plagaActiva = false;
    if (p.intensidadPlaga === undefined) p.intensidadPlaga = 0;

    // --- CÁLCULO DE RIESGO ---
    let incrementoRiesgo = 0;

    // Riesgo por temperatura extrema
    if (clima.temperatura > 30) incrementoRiesgo += 0.02;
    if (clima.temperatura < 10) incrementoRiesgo += 0.015;

    // Riesgo por humedad
    if (clima.humedad > 70) incrementoRiesgo += 0.03;
    if (clima.humedad < 30) incrementoRiesgo += 0.01;

    // Riesgo por salud del suelo
    if (p.saludSuelo < 0.5) incrementoRiesgo += 0.02;
    if (p.saludSuelo < 0.3) incrementoRiesgo += 0.03;

    // Riesgo por eventos climáticos extremos
    if (clima.evento === 'SEQUIA') incrementoRiesgo += 0.025;
    if (clima.evento === 'LLUVIA' && clima.humedad > 80) incrementoRiesgo += 0.035;

    // Reducir riesgo gradualmente si hay tratamiento
    if (p.tratamientoActivo) {
      p.riesgoPlaga = Math.max(0, p.riesgoPlaga - 0.05);
    } else {
      p.riesgoPlaga += incrementoRiesgo;
    }

    // Limitar riesgo entre 0 y 1
    p.riesgoPlaga = Math.max(0, Math.min(1, p.riesgoPlaga));

    // --- APARICION DE PLAGA ---
    if (!p.plagaActiva && p.riesgoPlaga > 0.6) {
      p.plagaActiva = true;
      p.intensidadPlaga = 1;
      
      // Crear alerta visual
      Factory.createAlerta({
        tipo: ALERTAS_TIPO.PLAGA || ALERTAS_TIPO.RIESGO,
        mensaje: `¡Plaga detectada en ${p.id}!`,
        parcelaId: p.id
      });
    }

    // --- EFECTO DE LA PLAGA ---
    if (p.plagaActiva) {
      // Aumentar intensidad con el tiempo
      if (p.intensidadPlaga < 3 && Math.random() < 0.05) {
        p.intensidadPlaga++;
        
        if (p.intensidadPlaga >= 3) {
          Factory.createAlerta({
            tipo: ALERTAS_TIPO.CRITICO,
            mensaje: `¡Plaga crítica en ${p.id}!`,
            parcelaId: p.id
          });
        }
      }

      // Daño al cultivo (aumenta con intensidad)
      const danoProgreso = 0.0005 * p.intensidadPlaga;
      const danoSuelo = 0.0003 * p.intensidadPlaga;
      
      c.progreso = Math.max(0, c.progreso - danoProgreso);
      p.saludSuelo = Math.max(0, p.saludSuelo - danoSuelo);

      // Reducir salud si el cultivo la tiene
      if (c.saludActual !== undefined) {
        c.saludActual = Math.max(0, c.saludActual - 0.001 * p.intensidadPlaga);
      }

      // --- RECUPERACIÓN ---
      const condicionesMejoran = clima.humedad < 60 && clima.temperatura < 28;
      const probabilidadRecuperacion = condicionesMejoran ? 0.02 : 0.005;

      if (Math.random() < probabilidadRecuperacion) {
        p.plagaActiva = false;
        p.intensidadPlaga = 0;
        p.riesgoPlaga = Math.max(0, p.riesgoPlaga - 0.3);
        
        Factory.createAlerta({
          tipo: ALERTAS_TIPO.INFO,
          mensaje: `${p.id} se recuperó de la plaga`,
          parcelaId: p.id
        });
      }
    }
  }
}

/**
 * Aplica un tratamiento a una parcela para prevenir/curar plagas
 * @param {string} parcelaId - ID de la parcela
 * @param {number} duracion - Ticks que dura el tratamiento (default: 20)
 */
export function applyTreatment(parcelaId, duracion = 20) {
  const p = repoGet('parcelas', parcelaId);
  if (!p) return;

  // Eliminar plaga activa con 80% de probabilidad
  if (p.plagaActiva && Math.random() < 0.8) {
    p.plagaActiva = false;
    p.intensidadPlaga = 0;
  }

  // Reducir riesgo considerablemente
  p.riesgoPlaga = Math.max(0, p.riesgoPlaga - 0.5);

  // Aplicar protección temporal
  p.tratamientoActivo = {
    ticksRestantes: duracion
  };

  Factory.createAlerta({
    tipo: ALERTAS_TIPO.INFO,
    mensaje: `Tratamiento aplicado en ${parcelaId}`,
    parcelaId
  });
}

/**
 * Reduce la duración de tratamientos activos
 * Llamar en el update principal
 */
export function tickTreatments() {
  const parcelas = repoAll('parcelas');
  for (const p of parcelas) {
    if (p.tratamientoActivo) {
      p.tratamientoActivo.ticksRestantes--;
      if (p.tratamientoActivo.ticksRestantes <= 0) {
        delete p.tratamientoActivo;
      }
    }
  }
}