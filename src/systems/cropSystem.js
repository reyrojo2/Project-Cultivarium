/**
 * Sistema de Cultivos
 * - Consume agua en base a consumoAgua y avanza progreso si hay recursos.
 * - Aplica penalizadores por clima/plagas (a integrar con Climate/Plague).
 */
import { State, repoAll, repoGet } from '../core/state.js';

export function tickCrops() {
  const parcelas = repoAll('parcelas');
  for (const p of parcelas) {
    if (!p.cultivoId) continue;
    const c = repoGet('cultivos', p.cultivoId);
    if (!c) continue;

    // consumo de agua: busca un recurso AGUA en la parcela
    const recAguaId = p.recursos.find(rid => State.repos.recursos.get(rid)?.tipo === 'AGUA');
    if (recAguaId) {
      const rec = State.repos.recursos.get(recAguaId);
      rec.nivel = Math.max(0, rec.nivel - 0.002 * c.consumoAgua); // consumo simplificado
      if (rec.nivel > 0.2) {
        c.progreso = Math.min(1, c.progreso + 0.002); // crece si hay agua
      }
    }

    // cambio de etapa
    if (c.progreso >= 1 && c.etapa !== 'COSECHA') {
      c.etapa = 'COSECHA';
    }
  }
}
