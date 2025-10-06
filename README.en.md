# Cultivarium

Cultivarium is an agricultural simulation prototype created for the NASA Space Apps Challenge 2025. The project brings the complexity of climate-smart farming to students and enthusiasts through an interactive dashboard where key metrics are visualized and strategic decisions are made for each plot.

## Simulator goals
- Represent agricultural campaigns that progress through levels grouping biomes and world regions inspired by NASA satellite observations.
- Translate remote-sensing indicators into intuitive bars for plant health (NDVI), heat stress, soil moisture (SMAP), precipitation (GPM), and player resources.
- Support crop cycle management with actions such as plowing, watering, planting, harvesting, selling, and scanning, reflecting their impact on energy, finances, and pest risk.
- Educate about agricultural decision-making by showing simulated dates, campaign days, alerts, and real-time diagnostics for the selected plot.

## Simulated experience
- **Dynamic plots:** every parcel tracks soil health, crop progress, water level, and pest status, including percentage risk and intensity.
- **Environmental indicators:** heat, humidity, rainfall, and energy bars help prioritize actions during extreme events.
- **Economic management:** the player's wallet and energy costs determine which actions remain available each turn.
- **Agricultural timeline:** the HUD displays the campaign day, simulated calendar date, and the active level (e.g., “Pacific Coast”, “Breadbasket of India”).
- **Alerts and inspection:** the left panel shows detailed diagnostics for the selected plot plus system alerts that demand quick responses.

## Technology stack
- [Phaser 3](https://phaser.io/): 2D engine driving the scene logic (`BootScene`, `PreloadScene`, `MenuScene`, `GameScene`, `UIScene`).
- [Vite](https://vitejs.dev/): lightning-fast bundler and development server.
- Modern JavaScript (ES Modules) organized across `src/core`, `src/scenes`, `src/systems`, and `src/utils`.

## Project structure
```
├── public/                # Static assets
├── src/
│   ├── core/              # Global state, entity factory, and simulated time control
│   ├── data/              # Levels, regions, and localized text (ES/EN)
│   ├── map/               # Isometric map and parcel construction
│   ├── scenes/            # Phaser scenes governing flow and UI
│   ├── systems/           # Simulation systems (climate, crops, economy)
│   └── utils/             # Shared helpers (i18n, utilities)
├── README.en.md           # English documentation (this file)
├── README.es.md           # Spanish documentation
├── package.json           # Dependencies (Phaser 3 + Vite)
└── vite.config.js         # Build configuration
```

## Getting started locally
1. Install dependencies with `npm install`.
2. Launch the development server via `npm run dev` and open `http://localhost:5173`.
3. Build an optimized bundle with `npm run build` and serve the `dist/` directory.

## Public deployment
The latest prototype build is live at **https://cultivariumproject.earth/**

## Team and credits
Cultivarium blends design, data science, and engineering to make sustainable agriculture approachable. The prototype integrates metrics inspired by NASA Harvest, SMAP, GPM, and NDVI observations to craft accessible learning scenarios.
