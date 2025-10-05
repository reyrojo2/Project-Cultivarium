/** Enumeraciones simples del diagrama, ajustadas al prototipo. */
export const TIPOS = {
  RECURSO: { AGUA: 'AGUA', SUELO: 'SUELO', ENERGIA: 'ENERGIA', MAQUINA: 'MAQUINA' }
};

export const NIVELES = {
  RECURSO: { BAJO: 0.25, MEDIO: 0.5, ALTO: 0.75, MAX: 1.0 },
  SEVERIDAD: { BAJA: 1, MEDIA: 2, ALTA: 3 },
  INTENSIDAD: { SUAVE: 1, MEDIA: 2, FUERTE: 3 }
};

export const EVENTOS_TIPO = {
  OLA_CALOR: 'OLA_DE_CALOR',
  HELADA: 'HELADA',
  SEQUIA: 'SEQUIA',
  LLUVIA: 'LLUVIA',
  INUNDACION: 'INUNDACION',
  PLAGA: 'PLAGA'
};

export const ALERTAS_TIPO = {
  INFO: 'INFO',
  RIESGO: 'RIESGO',
  PELIGRO: 'PELIGRO'
};
