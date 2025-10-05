/**
 * Sistema de Alertas
 * - Genera alertas si detecta condiciones peligrosas: poca agua, sequía fuerte, etc.
 * - Las alertas viven en el repo y la UIScene las muestra de forma amigable.
 */
import { State, repoAll } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { ALERTAS_TIPO } from '../data/enums.js';

export function tickAlerts() {
  const parcelas = repoAll('parcelas');
  for (const p of parcelas) {
    const agua = p.recursos
      .map(id => State.repos.recursos.get(id))
      .find(r => r?.tipo === 'AGUA');
    if (agua && agua.nivel < 0.15) {
      Factory.createAlerta({
        tipo: ALERTAS_TIPO.RIESGO,
        mensaje: `Agua baja en parcela ${p.id}`,
        parcelaId: p.id
      });
    }
  }
}
