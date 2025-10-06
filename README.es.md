# Cultivarium

Cultivarium es un prototipo de simulador agrícola desarrollado para el NASA Space Apps Challenge 2025. El proyecto busca acercar a estudiantes y entusiastas a la complejidad de la agricultura climáticamente inteligente mediante un tablero interactivo donde se visualizan métricas clave y se toman decisiones estratégicas sobre parcelas de cultivo.

## Objetivos del simulador
- Representar la progresión de campañas agrícolas por niveles que agrupan biomas y regiones del mundo basados en datos satelitales de NASA y misiones asociadas.
- Traducir indicadores de teledetección en barras intuitivas para salud vegetal (NDVI), estrés térmico, humedad del suelo (SMAP), precipitación (GPM) y recursos del jugador.
- Permitir la gestión de ciclos de cultivo con acciones como arar, regar, sembrar, cosechar, vender y escanear, reflejando impactos en energía, finanzas y riesgo de plagas.
- Educar sobre la toma de decisiones agrícola mostrando fechas simuladas, días de campaña, alertas y diagnósticos de parcelas en tiempo real.

## Experiencia simulada
- **Parcelas dinámicas:** cada parcela registra salud de suelo, progreso del cultivo, nivel de agua y estado de plagas, incluyendo riesgo (%) e intensidad.
- **Indicadores ambientales:** barras de calor, humedad, lluvia y energía ayudan a priorizar decisiones durante eventos extremos.
- **Gestión económica:** la cartera del jugador y los costos de energía influyen en qué acciones están disponibles en cada turno.
- **Cronograma agrícola:** el HUD indica el día de la campaña, la fecha simulada y el nivel activo (ej. “Costa del Pacífico”, “Graneros de India”).
- **Alertas e inspección:** el panel izquierdo muestra diagnósticos detallados de la parcela seleccionada y alertas del sistema para actuar con rapidez.

## Tecnologías utilizadas
- [Phaser 3](https://phaser.io/): motor 2D para la lógica de escenas (`BootScene`, `PreloadScene`, `MenuScene`, `GameScene`, `UIScene`).
- [Vite](https://vitejs.dev/): entorno de bundling y servidor de desarrollo ultrarrápido.
- JavaScript moderno (ES Modules) organizado en `src/core`, `src/scenes`, `src/systems` y `src/utils`.

## Estructura del proyecto
```
├── public/                # Activos estáticos
├── src/
│   ├── core/              # Estado global, fábrica de entidades y control del tiempo simulado
│   ├── data/              # Niveles, regiones y textos traducidos (ES/EN)
│   ├── map/               # Construcción del mapa isométrico y parcelas
│   ├── scenes/            # Escenas de Phaser para flujo de juego y UI
│   ├── systems/           # Sistemas de simulación (clima, cultivo, economía)
│   └── utils/             # Utilidades comunes (i18n, helpers)
├── README.en.md           # Documentación en inglés
├── README.es.md           # Documentación en español (este archivo)
├── package.json           # Dependencias (Phaser 3 + Vite)
└── vite.config.js         # Configuración de build
```

## Puesta en marcha local
1. Instala dependencias con `npm install`.
2. Inicia el entorno de desarrollo con `npm run dev` y abre el navegador en `http://localhost:5173`.
3. Para generar una build optimizada ejecuta `npm run build` y sirve la carpeta `dist/`.

## Despliegue público
La versión actual del prototipo está disponible en: **https://cultivariumproject.earth/**

## Equipo y créditos
Cultivarium combina el trabajo de diseño, ciencia de datos y desarrollo para acercar la agricultura sostenible a nuevos públicos. El proyecto integra métricas inspiradas en los programas NASA Harvest, SMAP, GPM y observaciones NDVI para construir escenarios de aprendizaje accesibles.
