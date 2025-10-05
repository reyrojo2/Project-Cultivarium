/**
 * Sistema de Clima
 * - Avanza el reloj y aplica impactos de eventos activos a las parcelas/cultivos.
 * - Idea: integrar NOAA/NASA en el futuro; por ahora: eventos mock.
 */
import { State, repoAll } from '../core/state.js';

export function tickClimate() {
  const t = State.clock;
  const eventos = repoAll('eventosClima').filter(e => t >= e.inicio && t <= e.fin);

  const parcelas = repoAll('parcelas');
  for (const p of parcelas) {
    for (const ev of eventos) {
      // si el evento "cubre" la parcela
      const hit = p.x >= ev.area.x && p.y >= ev.area.y &&
                  p.x + p.w <= ev.area.x + ev.area.w &&
                  p.y + p.h <= ev.area.y + ev.area.h;
      if (!hit) continue;

      // efecto simplificado en salud del suelo
      if (ev.tipo === 'SEQUIA') p.saludSuelo = Math.max(0, p.saludSuelo - 0.001 * ev.intensidad);
      if (ev.tipo === 'LLUVIA') p.saludSuelo = Math.min(1, p.saludSuelo + 0.0005 * ev.intensidad);
    }
  }
}
