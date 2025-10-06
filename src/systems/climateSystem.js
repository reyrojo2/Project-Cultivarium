import { State, repoAll } from '../core/state.js';

// ---- Helpers de normalización (ajusta umbrales a tu dataset)
const clamp01 = v => Math.max(0, Math.min(1, v));
// Ajusta este divisor a tus datos (p.ej., si 0..10 mm ≈ 0..1)
const normPrec01 = mm => clamp01((Number(mm) || 0) / 10);
// Humedad relativa 0..100 → 0..1
const normHum01  = rh => clamp01((Number(rh) || 0) / 100);
// Estrés térmico simple (ajusta umbrales a tu juego)
const heatStress01 = (tempC, rh) => {
  const t = clamp01(((Number(tempC) || 0) - 22) / (35 - 22)); // 22°C=0; 35°C=1
  const h = normHum01(rh);
  return clamp01(t * (0.6 + 0.4 * h)); // la humedad agrava un poco
};

// === CARGA DE CLIMA DESDE CSV (por región) ===
async function loadClimateData(regionCode) {
  try {
    const response = await fetch(`assets/data/${regionCode}.csv`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();

    const rows = text.trim().split('\n').map(r => r.split(','));
    const headers = rows.shift().map(h => h.trim());

    // Indices esperados (ajusta si tus headers difieren)
    const idxDate = headers.indexOf('date');
    const idxTemp = headers.indexOf('T2M');
    const idxHum  = headers.indexOf('RH2M');
    const idxPre  = headers.indexOf('PRECTOTCORR');

    if (idxDate < 0 || idxTemp < 0 || idxHum < 0 || idxPre < 0) {
      console.warn('⚠️ Cabeceras inesperadas en CSV:', headers);
    }

    const data = rows.map(r => {
      const dateRaw = (r[idxDate] || '').trim();
      // Soporta "YYYYMMDD" y "YYYY-MM-DD"
      let date = dateRaw;
      if (/^\d{8}$/.test(dateRaw)) {
        date = `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`;
      }
      const temperature   = Number(r[idxTemp]) || 0;
      const humidity      = Number(r[idxHum])  || 0;
      const precipitation = Number(r[idxPre])  || 0;

      return { date, temperature, humidity, precipitation };
    });

    console.log(`✅ Datos cargados para ${regionCode}: ${data.length} días`);
    return data;
  } catch (err) {
    console.error(`❌ Error cargando datos climáticos [${regionCode}]:`, err);
    return [];
  }
}

// === CACHE por región para no recargar CSV ===
const CACHE = new Map();
// Forma: CACHE.set(region, { data: [...], idx: 0 });

/**
 * Avanza 1 “día” de clima y aplica efectos.
 * Llama esto cuando cambie el día del simulador.
 * @param {{regionCode?: string, dayIndex?: number}} opts
 *  - regionCode: fuerza región (si no, toma de State)
 *  - dayIndex: si lo pasas, posiciona ese día (no incrementa idx automáticamente)
 */
export async function tickClimate(opts = {}) {
  const region = opts.regionCode
              || State?.region?.codigo
              || State?.climate?.region
              || State?.clima?.region
              || 'PER_PIU';

  // Cargar / Obtener de cache
  if (!CACHE.has(region)) {
    const data = await loadClimateData(region);
    CACHE.set(region, { data, idx: 0 });
  }
  const bucket = CACHE.get(region);
  const data = bucket.data;

  if (!data || data.length === 0) {
    // Sin datos: deja estado neutro para no romper el HUD
    const snapshot = {
      region, date: '—',
      temperatureC: 0, humidityPct: 0, precipitationMm: 0,
      humidity01: 0, precipitation01: 0, heatStress01: 0,
    };
    // Publica en ambos formatos para compatibilidad
    State.climate = { temperature: 0, humidity: 0, precipitation: 0, region };
    State.clima   = {
      region, fecha: snapshot.date, tempC: 0, humedad01: 0,
      lluviaGPM: 0, estresTermico01: 0,
      temperatura: 0, humedad: 0, precipitacion: 0, evento: 'NORMAL'
    };
    emitClimateTick(snapshot);
    return snapshot;
  }

  // Selección del “día” a usar
  let idx = bucket.idx;
  if (Number.isInteger(opts.dayIndex)) {
    idx = clampIndex(opts.dayIndex, data.length);
  }

  bucket.idx = idx;

  const day = data[idx];
  if (!day) {
    console.warn('⚠️ No hay fila de clima para idx:', idx);
    return null;
  }

  // ---- APLICAR A PARCELAS (ajusta a tu lógica)
  const parcelas = repoAll('parcelas');
  for (const p of parcelas) {
    // Salud de suelo influida por precipitación
    if (day.precipitation < 0.5) {
      p.saludSuelo = Math.max(0, (p.saludSuelo ?? 1) - 0.002); // sequía leve
    } else if (day.precipitation > 3) {
      p.saludSuelo = Math.min(1, (p.saludSuelo ?? 1) + 0.001); // lluvia leve
    }
    // Humedad/temperatura de la parcela (si usas otras propiedades, ajústalas)
    p.humedad      = clamp01(day.humidity / 100);
    p.temperatura  = day.temperature;
  }

  // ---- Construir snapshot coherente y publicarlo
  const snapshot = {
    region,
    date: day.date,
    temperatureC: day.temperature,
    humidityPct: day.humidity,
    precipitationMm: day.precipitation,
    // Normalizados para barras
    humidity01: normHum01(day.humidity),
    precipitation01: normPrec01(day.precipitation),
    heatStress01: heatStress01(day.temperature, day.humidity),
  };

  // Formato “en inglés” estándar para otras capas
  State.climate = {
    region,
    temperature: snapshot.temperatureC,
    humidity: snapshot.humidityPct,
    precipitation: snapshot.precipitationMm,
  };

  // Determinar etiqueta de evento simple para compatibilidad
  let evento = 'NORMAL';
  if (snapshot.precipitationMm <= 0.2 && snapshot.humidityPct < 40) evento = 'SEQUIA';
  else if (snapshot.precipitationMm >= 5 || snapshot.humidityPct > 85) evento = 'LLUVIA';

  // Formato “en español” que ya usas en tu UIScene + compatibilidad
  State.clima = {
    region,
    fecha: snapshot.date,
    tempC: snapshot.temperatureC,
    humedad01: snapshot.humidity01,
    lluviaGPM: snapshot.precipitation01, // tu UIScene usa esto como 0..1
    estresTermico01: snapshot.heatStress01,
    temperatura: snapshot.temperatureC,
    humedad: snapshot.humidityPct,
    precipitacion: snapshot.precipitationMm,
    evento,
  };

  // Emitir evento para refresco inmediato de UI/sistemas
  emitClimateTick(snapshot);

  // Avanzar día solo si NO se forzó dayIndex
  if (!Number.isInteger(opts.dayIndex)) {
    bucket.idx = (bucket.idx + 1) % data.length;
  }

  // Logging limpio y útil
  console.log(
    `🌦 ${snapshot.region} — ${snapshot.date} | ` +
    `T:${snapshot.temperatureC.toFixed(1)}°C ` +
    `H:${snapshot.humidityPct.toFixed(0)}% ` +
    `P:${snapshot.precipitationMm.toFixed(2)}mm`
  );

  return snapshot;
}

// ---------- Utils ----------
function clampIndex(i, len) {
  if (len <= 0) return 0;
  if (i < 0) return 0;
  if (i >= len) return len - 1;
  return i;
}

function emitClimateTick(snapshot) {
  try {
    const ev = (globalThis?.game?.events) || (globalThis?.GAME?.events) || (window?.GAME?.events) || null;
    if (ev) {
      // Compat: dos nombres de evento
      ev.emit('climate:tick', snapshot);
      ev.emit('clima:tick',   State.clima);
    }
  } catch (e) {
    // Silencioso
  }
}