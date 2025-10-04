/**
 * Estado global simple — en un proyecto grande podrías migrar a Zustand/Pinia/Redux.
 * Mantiene registros en memoria de las entidades del diagrama.
 * Cada "repo" es un Map por id.
 */
export const State = {
  clock: 0, // ticks del "simulador"
  repos: {
    parcelas: new Map(),
    cultivos: new Map(),
    recursos: new Map(),
    maquinas: new Map(),
    plagas: new Map(),
    eventosClima: new Map(),
    alertas: new Map(),
    jugadores: new Map(),
    tiendas: new Map(),
    macroRegiones: new Map()
  }
};

/** Utilidad para crear ids simples */
let _auto = 1;
export const newId = (prefix='id') => `${prefix}_${_auto++}`;

/** Registro/obtención genéricos */
export const repoSet = (repo, entity) => State.repos[repo].set(entity.id, entity);
export const repoGet = (repo, id) => State.repos[repo].get(id);
export const repoAll = (repo) => Array.from(State.repos[repo].values());
