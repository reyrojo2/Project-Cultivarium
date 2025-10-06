// core/time.js
export const REAL_LEVEL_MIN = 200;                 // 200 minutos por nivel
export const REAL_LEVEL_SEC = REAL_LEVEL_MIN * 60; // 12000 s
export const MINUTES_PER_SIM_DAY = 24 * 60;

export const LEVELS = [
  { id: 1, name: 'Costa norte del Perú', start: '2023-01-01', days: 31+28+31+30 },       // 120
  { id: 2, name: 'India y Asia del Sur',  start: '2023-06-01', days: 30+31+31+30 },      // 122
  { id: 3, name: 'África Oriental',       start: '2023-10-01', days: 31+30+31+31 },      // 123
  { id: 4, name: 'Brasil',                start: '2024-02-01', days: 29+31+30+31 },      // 121 (bisiesto)
  { id: 5, name: 'Global',                start: '2024-06-01', days: 30+31+31+30 },      // 122
];

// Estado del reloj del juego
export const TimeState = {
  levelIdx: 0,              // índice en LEVELS
  startDate: null,          // Date real del inicio de la simulación del nivel
  simStartDate: null,       // Date del calendario sim (ej. 2023-01-01)
  dayRealSec: 0,            // cuántos segundos reales dura 1 día sim
  minPerRealSec: 0,         // minutos sim que avanzan por segundo real
  elapsedRealSec: 0,        // segundos reales transcurridos en este nivel
  simMinutes: 0,            // minutos de simulación acumulados
  levelRealBudgetSec: REAL_LEVEL_SEC,
  levelDays: 0,
};

// Llamar al empezar un nivel o al cambiar de nivel
export function startLevel(levelIdx=0){
  const L = LEVELS[levelIdx];
  const days = L.days;
  const dayRealSec = REAL_LEVEL_SEC / days;        // ← clave: 12000s / ~120d
  const minPerRealSec = (24*60) / dayRealSec;      // minutos sim / segundo real

  TimeState.levelIdx = levelIdx;
  TimeState.levelDays = days;
  TimeState.dayRealSec = dayRealSec;
  TimeState.minPerRealSec = minPerRealSec;
  TimeState.elapsedRealSec = 0;
  TimeState.simMinutes = 0;
  TimeState.startDate = new Date();                // marca de tiempo real (opcional)
  TimeState.simStartDate = new Date(L.start);      // fecha calendario sim
}

// Avance por frame
export function tickSim(deltaMs){
  const dt = deltaMs / 1000;
  TimeState.elapsedRealSec += dt;
  TimeState.simMinutes     += dt * TimeState.minPerRealSec;
}

// Derivados útiles
export function getSimDate(){ // Date “del calendario” actual
  const ms = TimeState.simMinutes * 60 * 1000;
  return new Date(TimeState.simStartDate.getTime() + ms);
}
export function getSimDayNumber(){ // 1..levelDays
  return Math.min(1 + Math.floor(TimeState.simMinutes / MINUTES_PER_SIM_DAY), TimeState.levelDays);
}

export function getSimDayProgress01(){
  if (!TimeState.levelDays) return 0;
  const minutesToday = ((TimeState.simMinutes % MINUTES_PER_SIM_DAY) + MINUTES_PER_SIM_DAY) % MINUTES_PER_SIM_DAY;
  return minutesToday / MINUTES_PER_SIM_DAY;
}
export function levelProgress01(){
  return Math.min(TimeState.elapsedRealSec / TimeState.levelRealBudgetSec, 1);
}