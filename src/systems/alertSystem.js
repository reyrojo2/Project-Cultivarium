/**
 * Sistema de Alertas
 * - Genera alertas si detecta condiciones peligrosas: poca agua, sequía fuerte, etc.
 * - Las alertas viven en el repo y la UIScene las muestra de forma amigable.
 */
import { State, repoAll } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { ALERTAS_TIPO } from '../data/enums.js';
import { translate as t } from '../utils/i18n.js';

export function tickAlerts() {
  const parcelas = repoAll('parcelas');
  const alertsRepo = State.repos.alertas;
  for (const p of parcelas) {
    const agua = p.recursos
      .map(id => State.repos.recursos.get(id))
      .find(r => r?.tipo === 'AGUA');
    const existingLowWaterAlert = Array.from(alertsRepo.values())
      .find(a => a.parcelaId === p.id && a.codigo === 'LOW_WATER');

    if (agua && agua.nivel < 0.15) {
      const message = t('ui.alerts.lowWater', { parcel: p.id });
      if (existingLowWaterAlert) {
        existingLowWaterAlert.visible = true;
        existingLowWaterAlert.mensaje = message;
      } else {
        Factory.createAlerta({
          tipo: ALERTAS_TIPO.RIESGO,
          mensaje: message,
          parcelaId: p.id,
          codigo: 'LOW_WATER'
        });
      }
    } else if (existingLowWaterAlert) {
      existingLowWaterAlert.visible = false;
    }
  }
}
