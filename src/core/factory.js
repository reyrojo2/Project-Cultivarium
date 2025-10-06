/**
 * "GlobalFactory" inspirado en el diagrama.
 * Provee funciones para crear entidades con defaults seguros.
 * Cada función deja claro PARA QUÉ sirve (comentado).
 */
import { newId, repoSet } from './state.js';
import { TIPOS, NIVELES, EVENTOS_TIPO, ALERTAS_TIPO } from '../data/enums.js';

export const Factory = {
  /** Crea un jugador para controlar el mundo o partidas locales. */
  createPlayer(overrides={}) {
    const e = {
      id: newId('player'),
      name: overrides.name || 'Player 1',
      cartera: 1000,          // dinero disponible para la Tienda
      reputacion: 0,          // métrica social (misiones/eventos)
      energiaMax: overrides.energiaMax ?? 100,
      energiaActual: overrides.energiaActual ?? (overrides.energiaMax ?? 100),
      ...overrides
    };
    repoSet('jugadores', e);
    return e;
  },

  /** MacroRegión (AFRICA/AMERICA/ASIA/…); útil para filtros y clima base. */
  createMacroRegion(overrides={}) {
    const e = { id: newId('macro'), nombre: overrides.nombre || 'GLOBAL', ...overrides };
    repoSet('macroRegiones', e);
    return e;
  },

  /**
   * Recurso (AGUA, SUELO, ENERGIA, MAQUINA) en el contexto de una Parcela.
   * Guarda nivel actual y capacidad; será consumido por Cultivo/Máquinas.
   */
  createRecurso(overrides={}) {
    const e = {
      id: newId('recurso'),
      tipo: overrides.tipo || TIPOS.RECURSO.AGUA,
      nivel: overrides.nivel ?? NIVELES.RECURSO.MEDIO,
      capacidad: overrides.capacidad ?? 100,
      // hook para degradación/recarga por tick
      regenPorTick: overrides.regenPorTick ?? 0,
      ...overrides
    };
    repoSet('recursos', e);
    return e;
  },

  /**
   * Parcela física (x,y,w,h) con referencia a recursos y cultivo activo.
   * Es la entidad principal que se dibuja en el mapa.
   */
  createParcela(overrides={}) {
    const e = {
      id: newId('parcela'),
      x: overrides.x ?? 0,
      y: overrides.y ?? 0,
      w: overrides.w ?? 64,
      h: overrides.h ?? 64,
      macroRegionId: overrides.macroRegionId || null,
      recursos: overrides.recursos || [], // ids de recursos
      cultivoId: overrides.cultivoId || null,
      saludSuelo: overrides.saludSuelo ?? 1.0, // 0..1
      ...overrides
    };
    repoSet('parcelas', e);
    return e;
  },

  /**
   * Cultivo (BANANO, MAIZ, etc.) con tiempos y producción esperada.
   * Se coloca en una Parcela. Interacciona con Recursos y EventosClima.
   */
  createCultivo(overrides={}) {
    const e = {
      id: newId('cultivo'),
      tipo: overrides.tipo || 'MAIZ',
      etapa: 'SIEMBRA',        // SIEMBRA->CRECIMIENTO->COSECHA
      progreso: 0,             // 0..1
      consumoAgua: 0.5,        // por tick (escala relativa)
      sensibilidadClima: {     // multiplicadores por tipo de clima
        FRIO: 0.8, CALOR: 1.2, SEQUIA: 0.5, LLUVIA: 1.1
      },
      plagas: [],              // ids de plagas presentes
      ...overrides
    };
    repoSet('cultivos', e);
    return e;
  },

  /** Máquina (riego, mantenimiento, cosecha), con costo por uso. */
  createMaquina(overrides={}) {
    const e = {
      id: newId('maq'),
      tipo: overrides.tipo || 'RIEGO',
      precio: overrides.precio ?? 50,
      mantencion: overrides.mantencion ?? 0.1, // desgaste por uso
      ...overrides
    };
    repoSet('maquinas', e);
    return e;
  },

  /** Plaga con severidad e inmunidad a tratamientos. */
  createPlaga(overrides={}) {
    const e = {
      id: newId('plaga'),
      nombre: overrides.nombre || 'Pulgón',
      severidad: overrides.severidad ?? NIVELES.SEVERIDAD.BAJA,
      resistencia: overrides.resistencia || [], // ej: ['QUIMICO']
      ...overrides
    };
    repoSet('plagas', e);
    return e;
  },

  /**
   * EventoClimatico puntual o de duración (LLUVIA, OLA_DE_CALOR, HELADA).
   * Afecta parcelas dentro de una región/área.
   */
  createEventoClimatico(overrides={}) {
    const e = {
      id: newId('meteo'),
      tipo: overrides.tipo || EVENTOS_TIPO.LLUVIA,
      intensidad: overrides.intensidad ?? NIVELES.INTENSIDAD.MEDIA,
      inicio: overrides.inicio ?? 0,
      fin: overrides.fin ?? (overrides.inicio ?? 0) + 100,
      area: overrides.area || { x:0, y:0, w:9999, h:9999 },
      ...overrides
    };
    repoSet('eventosClima', e);
    return e;
  },

  /** Alerta derivada (RIESGO_HELADA, PLAGA, PELIGRO_INUNDACION, etc.). */
  createAlerta(overrides={}) {
    const e = {
      id: newId('alerta'),
      tipo: overrides.tipo || ALERTAS_TIPO.INFO,
      mensaje: overrides.mensaje || 'Alerta creada',
      parcelaId: overrides.parcelaId || null,
      visible: true,
      ...overrides
    };
    repoSet('alertas', e);
    return e;
  },

  /** Tienda simple para comprar máquinas/insumos con el jugador. */
  createTienda(overrides={}) {
    const e = {
      id: newId('shop'),
      stock: overrides.stock || [
        { itemType: 'RIEGO',  precio: 30 },
        { itemType: 'COSECHA', precio: 20 }
      ]
    };
    repoSet('tiendas', e);
    return e;
  }
};
