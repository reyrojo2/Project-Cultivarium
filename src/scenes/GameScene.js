// GameScene.js (unificado con i18n)
import Phaser from 'phaser';
import { GAME } from '../main.js';
import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { EVENTOS_TIPO, NIVELES } from '../data/enums.js';
import { tickClimate } from '../systems/climateSystem.js';
import { getSimDayNumber } from '../core/time.js';
import { tickCrops, CROP_CONFIG, isCultivoListo, resolveSpritePhase, SPRITE_PHASES } from '../systems/cropSystem.js';
import { tickPlagues } from '../systems/plagueSystem.js';
import { tickAlerts } from '../systems/alertSystem.js';
import { findFirstPlayer, spend } from '../core/state.js';
import { startLevel, tickSim, getSimDayProgress01 } from '../core/time.js';
import { T, MAP_PRESETS, makePlayableMatrix, makeWorldMatrix, buildBlockIndex } from '../map/mapBuilder.js';
import { DECOR, addDecor } from '../map/decor.js';
import { getLanguage, setLanguage, translate as t } from '../utils/i18n.js';
import { WATER_ACTION_COST } from '../config/economy.js';

// === Proyección ISO 2:1 ===
const PROJ_W = 256;
const PROJ_H = 128;

let _lastDay = -1;

// 0..1 → curvas suaves
const smoothstep = (t)=> t*t*(3-2*t);

function isoProject(gx, gy, offX, offY) {
  return {
    sx: Math.round(offX + (gx - gy) * (PROJ_W / 2)),
    sy: Math.round(offY + (gx + gy) * (PROJ_H / 2))
  };
}

// === Detección de tapa de rombo (para selector preciso) ===
const TOP_FACE_CACHE = new Map();
function measureDiamondFromTop(scene, texKey, alphaThr = 180) {
  if (TOP_FACE_CACHE.has(texKey)) return TOP_FACE_CACHE.get(texKey);

  const img = scene.textures.get(texKey).getSourceImage();
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, w, h).data;
  const alphaAt = (x, y) => data[(y*w + x)*4 + 3];

  const minX = new Array(h).fill(+Infinity);
  const maxX = new Array(h).fill(-Infinity);

  for (let y=0; y<h; y++) {
    let found = false;
    for (let x=0; x<w; x++) {
      if (alphaAt(x, y) > alphaThr) {
        found = true;
        if (x < minX[y]) minX[y] = x;
        if (x > maxX[y]) maxX[y] = x;
      }
    }
    if (!found) { minX[y] = +Infinity; maxX[y] = -Infinity; }
  }

  let yTop = 0; while (yTop < h && minX[yTop] === +Infinity) yTop++;
  let yBot = h-1; while (yBot >= 0 && minX[yBot] === +Infinity) yBot--;
  if (yTop >= yBot) {
    const halfW = w/2, halfH = h/2;
    const polyLocal = new Phaser.Geom.Polygon([
      new Phaser.Geom.Point(0, -halfH),
      new Phaser.Geom.Point(halfW, 0),
      new Phaser.Geom.Point(0,  halfH),
      new Phaser.Geom.Point(-halfW, 0),
    ]);
    const res = { halfW, halfH, center: { x:w/2, y:h/2 }, polyLocal };
    TOP_FACE_CACHE.set(texKey, res);
    return res;
  }

  let yCent = yTop, bestW = -1;
  for (let y=yTop; y<=yBot; y++) {
    if (minX[y] !== +Infinity) {
      const width = (maxX[y] - minX[y] + 1);
      if (width > bestW) { bestW = width; yCent = y; }
    }
  }

  const cxMax = (minX[yCent] + maxX[yCent]) / 2;
  const cy = (yTop + yBot) / 2;
  const halfW = (maxX[yCent] - minX[yCent] + 1) / 2;
  const halfH = (yBot - yTop) / 2;

  const topPt    = { x: cxMax, y: yTop };
  const rightPt  = { x: cxMax + halfW, y: cy };
  const bottomPt = { x: cxMax, y: yBot };
  const leftPt   = { x: cxMax - halfW, y: cy };

  const toLocal = (p) => new Phaser.Geom.Point(p.x - w/2, p.y - h/2);
  const polyLocal = new Phaser.Geom.Polygon([toLocal(topPt), toLocal(rightPt), toLocal(bottomPt), toLocal(leftPt)]);

  const res = { halfW, halfH, center: { x: cxMax, y: cy }, polyLocal };
  TOP_FACE_CACHE.set(texKey, res);
  return res;
}

function addIsoTile(scene, key, gx, gy, offX, offY) {
  const sx = Math.round(offX + (gx - gy) * 128);
  const sy = Math.round(offY + (gx + gy) * 64);
  const img = scene.add.image(sx, sy, key).setOrigin(0.5, 0.5);
  img.setDepth(sy + gy * 0.001);

  const { polyLocal } = measureDiamondFromTop(scene, key, 180);
  const INSET_X = 8, INSET_Y = 4;
  const polyLocalInset = new Phaser.Geom.Polygon(
    polyLocal.points.map(p => new Phaser.Geom.Point(
      Math.sign(p.x) * Math.max(0, Math.abs(p.x) - INSET_X),
      Math.sign(p.y) * Math.max(0, Math.abs(p.y) - INSET_Y)
    ))
  );
  const polyHit = new Phaser.Geom.Polygon(
    polyLocalInset.points.map(p => new Phaser.Geom.Point(
      p.x + img.displayOriginX,
      p.y + img.displayOriginY
    ))
  );
  img.setInteractive(polyHit, Phaser.Geom.Polygon.Contains);
  img.setData('topPoly', polyLocalInset);
  img.setData('texKey', key);
  return img;
}

// ---- Colores / tints ----
const SOIL_DRY = { r:153, g:102, b:51 };
const SOIL_WET = { r: 92, g: 58, b:30 };
const PLOWED_MUL = { r:0.85, g:0.75, b:0.55 };
const WET_MUL    = { r:0.70, g:0.65, b:0.60 };
const toRGB = (r,g,b)=> (r<<16)|(g<<8)|b;
const mulToTint = (m)=> toRGB((m.r*255)|0,(m.g*255)|0,(m.b*255)|0);
const mulFactors = (a,b)=> ({ r:a.r*b.r, g:a.g*b.g, b:a.b*b.b });
const jitterColor = (r,g,b, jr=6,jg=6,jb=4) => {
  const R = Phaser.Math.Clamp(r + Phaser.Math.Between(-jr, jr), 0, 255);
  const G = Phaser.Math.Clamp(g + Phaser.Math.Between(-jg, jg), 0, 255);
  const B = Phaser.Math.Clamp(b + Phaser.Math.Between(-jb, jb), 0, 255);
  return (R<<16)|(G<<8)|B;
};

// ============================================================================
//                               MAP BUILDER (MATRIZ)
// ============================================================================
const SELECTED_MAP = 'base_4x3_9x9';

function applyBlockVisual(scene, parcelaId) {
  const blockId = scene.blockIdByParcelaId.get(parcelaId);
  if (!blockId) return;
  const p = repoGet('parcelas', parcelaId);
  const sprites = scene.spritesByBlockId.get(blockId) || [];
  const isWet = p.wetUntil && State.clock < p.wetUntil;

  for (const spr of sprites) {
    if (p.arada) {
      spr.setTexture('Lava3');
      spr.clearTint(); spr.resetPipeline();
      let mul = { ...PLOWED_MUL };
      if (isWet) mul = mulFactors(mul, WET_MUL);
      spr.setTint(mulToTint(mul));
    } else {
      spr.setTexture('Lava1');
      spr.clearTint(); spr.resetPipeline();
      spr.setTintFill(
        isWet
          ? jitterColor(SOIL_WET.r, SOIL_WET.g, SOIL_WET.b, 4,4,3)
          : jitterColor(SOIL_DRY.r, SOIL_DRY.g, SOIL_DRY.b, 6,6,4)
      );
    }
  }
}

// ===== helpers de colocación sobre el grid (para decor) =====
function makeOcc(TOTAL_W, TOTAL_H) {
  return Array.from({ length: TOTAL_H }, () => Array(TOTAL_W).fill(false));
}
function canPlaceRect(occ, world, gx, gy, w, h, allowedTiles) {
  const H = occ.length, W = occ[0].length;
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const X = gx + x, Y = gy + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) return false;
      if (occ[Y][X]) return false;
      if (!allowedTiles.includes(world[Y][X])) return false;
    }
  }
  return true;
}
function occupyRect(occ, gx, gy, w, h) {
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const X = gx + x, Y = gy + y;
    if (occ[Y] && typeof occ[Y][X] !== 'undefined') occ[Y][X] = true;
  }
}
function place(scene, isoProject, occ, world, gx, gy, name, opts = {}) {
  const def = DECOR[name];
  if (!def) return null;
  if (!canPlaceRect(occ, world, gx, gy, def.footprint.w, def.footprint.h, [T.GRASS, T.SOIL])) return null;
  occupyRect(occ, gx, gy, def.footprint.w, def.footprint.h);
  return addDecor(scene, isoProject, gx, gy, name, opts);
}

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
    this.selectedParcelaId = null;
    this.cursors = null;
    // atajos originales
    this.keyW = null; // REGAR
    this.keyD = null; // COSECHAR
    this.keyS = null; // SELL_HARVEST
    this.keyX = null; // TECH
    this.keyA = null; // ARAR
    this.camSpeed = 400;
    this.selector = null;
    this.offX = 0; this.offY = 0;

    // mapas
    this.spritesByBlockId = new Map();
    this.parcelaByBlockId = new Map();
    this.blockIdByParcelaId = new Map();
    this.blockPositions = new Map();

    this._cooldowns = { water: 0, plow: 0, harvest: 0, plant: 0 };
    this.decorEntries = []; // {sprite, shadow}
    this.timeOfDay = 0.5;   // 0..1 (se sincroniza con la simulación al iniciar)
    this.parcelaIdByCultivoId = new Map();
    this.cultivoSprites = new Map();
    this.alertMarkers = new Map();
    this.seedMenu = null; // Referencia al menú emergente de semillas activo.
    this.seedMenuHandlers = {}; // Guarda listeners asociados al menú para poder limpiarlos.
  }

  create() {
    // === i18n: fija idioma desde bootstrap o localStorage ===
    setLanguage(window.__CV_START__?.language || getLanguage());

    const cam = this.cameras.main;
    cam.setBackgroundColor(0x859e70);

    startLevel(0);
    this.timeOfDay = getSimDayProgress01();

    const initialDay = getSimDayNumber();
    _lastDay = initialDay - 1;
    const initialIdx = Math.max(0, initialDay - 1);
    tickClimate({ regionCode: State.region?.codigo, dayIndex: initialIdx })
      .catch(err => console.error('climate:init', err));
    if (this.input?.setTopOnly) this.input.setTopOnly(true);
    // Creamos al jugador con un colchón inicial de dinero suficiente para regar y
    // sembrar sin trabarse durante los primeros días de simulación.
    Factory.createPlayer({ name: 'AgroPro', cartera: 1000 });
    Factory.createTienda();

    // ==== Texturas ====
    const grassKeys  = ['Acid2'];
    const soilKey    = 'Lava1';
    const pathKeys   = ['Ground2','Ground3','Ground4'];
    const pick = arr => arr[(Math.random() * arr.length) | 0];

    if (!this.textures.exists('shadowSoft')) {
      const g = this.make.graphics({ x:0, y:0, add:false });
      g.fillStyle(0x000000, 0.22); g.fillEllipse(128, 64, 220, 90);
      for (let i = 1; i <= 6; i++) {
        const a = 0.22 * (1 - i / 7);
        g.fillStyle(0x000000, a);
        g.fillEllipse(128, 64, 220 + i*20, 90 + i*10);
      }
      g.generateTexture('shadowSoft', 256, 128);
      g.destroy();
    }

    // ==== Selección de mapa (preset) ====
    const cfg = MAP_PRESETS[SELECTED_MAP];
    const { plotsX, plotsY, parcelaSize, pathW, grassBorder } = cfg;

    const play = makePlayableMatrix(plotsX, plotsY, parcelaSize, pathW);
    const { blocks, blockIdAt, PLAY_W, PLAY_H } = buildBlockIndex(plotsX, plotsY, parcelaSize, pathW);

    const { world, dims } = makeWorldMatrix(play, grassBorder);
    const {
      TOTAL_W, TOTAL_H,
      FARM_MIN_X, FARM_MIN_Y, FARM_MAX_X, FARM_MAX_Y
    } = dims;

    // Centro del mapa
    this.offX = this.scale.width / 2;
    this.offY = 140;

    // colecciones
    this.spritesByBlockId = new Map();
    this.parcelaByBlockId = new Map();
    this.blockIdByParcelaId = new Map();
    this.blockPositions = new Map();
    this.spriteByParcela = new Map();
    this.parcelaIdByCultivoId = new Map();
    this.cultivoSprites = new Map();
    this.alertMarkers = new Map();
    this.seedMenu = null;
    this.seedMenuHandlers = {};
    this.selectedParcelaId = null;

    // helper
    this.blockIdAtWorld = (gy, gx) => {
      const y = gy - grassBorder;
      const x = gx - grassBorder;
      if (y < 0 || x < 0 || y >= PLAY_H || x >= PLAY_W) return -1;
      return blockIdAt[y][x];
    };

    // === Render desde la matriz world ===
    for (let gy = 0; gy < TOTAL_H; gy++) {
      for (let gx = 0; gx < TOTAL_W; gx++) {
        const type = world[gy][gx];
        const texKey =
          (type === T.GRASS) ? grassKeys[0] :
          (type === T.PATH)  ? pick(pathKeys) :
                              soilKey;

        const tile = addIsoTile(this, texKey, gx, gy, this.offX, this.offY);

        if (type === T.PATH) {
          tile.setTint(0x9aa3a1);
          continue;
        }
        if (type === T.GRASS) continue;

        // SOIL base
        tile.setTintFill(jitterColor(SOIL_DRY.r, SOIL_DRY.g, SOIL_DRY.b, 6, 6, 4));

        const blockId = this.blockIdAtWorld(gy, gx);
        if (blockId > 0) {
          if (!this.spritesByBlockId.has(blockId)) this.spritesByBlockId.set(blockId, []);
          this.spritesByBlockId.get(blockId).push(tile);
          tile.on('pointerdown', () => this.selectBlock(blockId));
        }
      }
    }

    // === parcelas lógicas por bloque ===
    for (const b of blocks) {
      const worldX0 = grassBorder + b.x0;
      const worldY0 = grassBorder + b.y0;

      // Cada parcela arranca con un recurso de agua en nivel medio para evitar
      // que el cultivo se seque inmediatamente tras iniciar la partida.
      const recAgua = Factory.createRecurso({ tipo:'AGUA', nivel:0.6 });
      const parcela = Factory.createParcela({
        x: worldX0, y: worldY0, w: parcelaSize, h: parcelaSize,
        recursos: [recAgua.id], cultivoId: null, saludSuelo: 0.8, arada: false
      });

      this.parcelaByBlockId.set(b.id, parcela);
      this.blockIdByParcelaId.set(parcela.id, b.id);

      const list = this.spritesByBlockId.get(b.id) || [];
      const rep  = list.length ? list[(list.length/2)|0] : null;
      if (rep) this.spriteByParcela.set(parcela.id, rep);

      const center = isoProject(
        worldX0 + b.w / 2,
        worldY0 + b.h / 2,
        this.offX,
        this.offY
      );
      this.blockPositions.set(b.id, { x: center.sx, y: center.sy - 32 });
    }

    for (const parcela of repoAll('parcelas')) {
      if (!parcela.cultivoId) continue;
      this.parcelaIdByCultivoId.set(parcela.cultivoId, parcela.id);
      const cultivo = repoGet('cultivos', parcela.cultivoId);
      if (cultivo) {
        cultivo.__spritePhase = resolveSpritePhase(cultivo);
        this.showCultivoSprite(parcela.id, cultivo.tipo, cultivo.etapa, cultivo.progreso ?? 0);
      }
    }

    this.decorEntries = [];

    // ======= DECOR =======
    const occ = makeOcc(TOTAL_W, TOTAL_H);
    const addEntry = (e) => { if (e?.sprite && e?.shadow) this.decorEntries.push({sprite:e.sprite, shadow:e.shadow}); };

    // Granero
    {
      const gx = Math.max(0, Math.floor(grassBorder / 2));
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2));
      const e  = place(this, isoProject, occ, world, gx, gy, 'barn', { projW: PROJ_W });
      addEntry(e);
    }
    // Silo
    {
      const gx = Math.min(TOTAL_W - 2, TOTAL_W - Math.ceil(grassBorder / 2) - 2);
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2) - 2);
      const e  = place(this, isoProject, occ, world, gx, gy, 'silo', { projW: PROJ_W });
      addEntry(e);
    }
    // Tractor
    {
      const block = (blocks && blocks[0]) ? blocks[0] : null;
      const gx = block ? (grassBorder + block.x0 + block.w - 1) : (FARM_MIN_X + 1);
      const gy = block ? (grassBorder + block.y0 + 1)           : (FARM_MIN_Y + 1);
      const e  = place(this, isoProject, occ, world, gx, gy, 'tractor', { projW: PROJ_W });
      addEntry(e);
    }

    // BOSQUE/ÁRBOLES densos en bordes + parches
    const TREE_KEYS = ['tree', 'tree2'];
    const BUSH_KEYS = ['bush1', 'bush2'];
    const rand = Phaser.Utils.Array.GetRandom;

    const plantBorder = (step=2, jitter=0.8) => {
      const j = v => v + Phaser.Math.FloatBetween(-jitter, jitter);
      for (let x = 1; x < TOTAL_W - 1; x += step) {
        const gx1 = Math.round(j(x));
        const gyT = Math.max(0, FARM_MIN_Y - 2);
        const gyB = Math.min(TOTAL_H - 1, FARM_MAX_Y + 2);
        if (world[gyT][gx1] === T.GRASS) addEntry(place(this, isoProject, occ, world, gx1, gyT, rand(TREE_KEYS), { projW: PROJ_W }));
        if (world[gyB][gx1] === T.GRASS) addEntry(place(this, isoProject, occ, world, gx1, gyB, rand(TREE_KEYS), { projW: PROJ_W }));
      }
      for (let y = 1; y < TOTAL_H - 1; y += step) {
        const gy1 = Math.round(j(y));
        const gxL = Math.max(0, FARM_MIN_X - 2);
        const gxR = Math.min(TOTAL_W - 1, FARM_MAX_X + 2);
        if (world[gy1][gxL] === T.GRASS) addEntry(place(this, isoProject, occ, world, gxL, gy1, rand(TREE_KEYS), { projW: PROJ_W }));
        if (world[gy1][gxR] === T.GRASS) addEntry(place(this, isoProject, occ, world, gxR, gy1, rand(TREE_KEYS), { projW: PROJ_W }));
      }
    };

    const plantPatch = ({ cx, cy, radius=6, density=0.85, bushRatio=0.25 }) => {
      const area = Math.PI * radius * radius;
      const count = Math.floor(area * density * 0.45);
      for (let i = 0; i < count; i++) {
        const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const r   = Phaser.Math.FloatBetween(0, radius);
        const gx  = Phaser.Math.Clamp(Math.round(cx + Math.cos(ang)*r + Phaser.Math.FloatBetween(-0.3,0.3)), 0, TOTAL_W-1);
        const gy  = Phaser.Math.Clamp(Math.round(cy + Math.sin(ang)*r + Phaser.Math.FloatBetween(-0.3,0.3)), 0, TOTAL_H-1);
        if (world[gy][gx] !== T.GRASS) continue;
        const key = (Math.random() < bushRatio) ? rand(BUSH_KEYS) : rand(TREE_KEYS);
        addEntry(place(this, isoProject, occ, world, gx, gy, key, { projW: PROJ_W }));
      }
    };

    plantBorder(2, 0.8);
    plantPatch({ cx: Math.floor(TOTAL_W*0.22), cy: Math.floor(TOTAL_H*0.25), radius: 5, density: 0.9 });
    plantPatch({ cx: Math.floor(TOTAL_W*0.80), cy: Math.floor(TOTAL_H*0.70), radius: 6, density: 0.85 });

    // Rocas
    {
      const tries = 25;
      for (let i = 0; i < tries; i++) {
        const gx = Phaser.Math.Between(1, TOTAL_W - 2);
        const gy = Phaser.Math.Between(1, TOTAL_H - 2);
        if (world[gy][gx] !== T.GRASS) continue;
        const name = (Math.random() < 0.5) ? 'rock1' : 'rock2';
        const e = place(this, isoProject, occ, world, gx, gy, name);
        if (e) { addEntry(e); occupyRect(occ, gx - 1, gy - 1, 3, 3); }
      }
    }

    // Arbustos (clusters)
    {
      const cluster = (cx, cy, radius = 2, count = 6) => {
        for (let i = 0; i < count; i++) {
          const dx = Phaser.Math.Between(-radius, radius);
          const dy = Phaser.Math.Between(-radius, radius);
          const gx = Phaser.Math.Clamp(cx + dx, 0, TOTAL_W - 1);
          const gy = Phaser.Math.Clamp(cy + dy, 0, TOTAL_H - 1);
          if (world[gy][gx] !== T.GRASS) continue;
          const e = place(this, isoProject, occ, world, gx, gy, Phaser.Utils.Array.GetRandom(['bush1','bush2']));
          addEntry(e);
        }
      };
      cluster(Math.floor(grassBorder / 2), Math.floor(grassBorder / 2));
      cluster(TOTAL_W - Math.floor(grassBorder / 2) - 1, Math.floor(grassBorder / 2));
      cluster(Math.floor(grassBorder / 2), TOTAL_H - Math.floor(grassBorder / 2) - 1);
      cluster(TOTAL_W - Math.floor(grassBorder / 2) - 1, TOTAL_H - Math.floor(grassBorder / 2) - 1);
    }

    // Fondo verde amplio bajo todo
    const tlIso = isoProject(0, TOTAL_H - 1, this.offX, this.offY);
    const brIso = isoProject(TOTAL_W - 1, 0, this.offX, this.offY);
    const centerX = (tlIso.sx + brIso.sx) / 2;
    const centerY = (tlIso.sy + brIso.sy) / 2;
    const mapWpx  = Math.abs(brIso.sx - tlIso.sx);
    const mapHpx  = Math.abs(brIso.sy - tlIso.sy);
    if (this.ground) this.ground.destroy();
    this.ground = this.add.rectangle(centerX, centerY, mapWpx*4, mapHpx*4, 0x859e70)
      .setDepth(-1_000_000);

    // Overlay ambiental
    if (!this.ambient) {
      this.ambient = this.add.rectangle(0, 0, 10, 10, 0x000000, 0)
        .setOrigin(0)
        .setDepth(1e9);
    }

    // Límites/zoom de cámara
    const tl = isoProject(0, TOTAL_H - 1, this.offX, this.offY);
    const br = isoProject(TOTAL_W - 1, 0, this.offX, this.offY);
    const minX = Math.min(tl.sx, br.sx), maxX = Math.max(tl.sx, br.sx);
    const minY = Math.min(tl.sy, br.sy), maxY = Math.max(tl.sy, br.sy);

    const vw = this.scale.width, vh = this.scale.height, padFit = 50;
    const mapW = maxX - minX, mapH = maxY - minY;
    const zoomX = (vw - padFit * 2) / mapW;
    const zoomY = (vh - padFit * 2) / mapH;
    const zoom  = Math.min(zoomX, zoomY);
    const padWorldX = (vw / zoom) * 0.5;
    const padWorldY = (vh / zoom) * 0.5;
    const padWorld  = Math.max(padWorldX, padWorldY);

    this.cameras.main.setBounds(minX - padWorld, minY - padWorld, mapW + padWorld * 2, mapH + padWorld * 2);
    const initialZoom = Math.min(zoom * 1.35, 1.6); // más cerca que antes
    this.cameras.main.setZoom(initialZoom);
    this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2);

    // Evento climático demo
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: { x: -9999, y: -9999, w: 9999, h: 9999 }
    });

    // ===== Inputs =====
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A); // ARAR
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W); // REGAR
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C); // COSECHAR (tu mapping original)
    this.keyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S); // SELL HARVEST
    this.keyX = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q); // TECH TREE

    // HUD breve (texto traducible)
    this.add.text(16, 8,
      t('game.hudShortcuts'),
      { fontFamily:'ui-sans-serif, system-ui, sans-serif', fontSize:'14px', color:'#e2e8f0' }
    ).setScrollFactor(0);

    // Pan/Zoom
    this.input.mouse.disableContextMenu();
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      const cam = this.cameras.main;
      const next = cam.zoom * (dy > 0 ? 0.9 : 1.1);
      cam.setZoom(Phaser.Math.Clamp(next, 0.2, 2.2));
    });
    let dragging = false, last = { x: 0, y: 0 };
    this.input.on('pointerdown', p => { if (p.rightButtonDown()) { dragging = true; last = { x: p.x, y: p.y }; } });
    this.input.on('pointerup',   () => dragging = false);
    this.input.on('pointermove', p => {
      if (!dragging) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - last.x) / cam.zoom;
      cam.scrollY -= (p.y - last.y) / cam.zoom;
      last = { x: p.x, y: p.y };
    });

    // Bridge UI → GameScene
    this._onUIAction = ({ actionType }) => {
      switch (actionType) {
        case 'ARAR': return this.plowSelected();
        case 'REGAR': return this.waterSelected();
        case 'SEMBRAR': return this.plantSelected();
        case 'COSECHAR': return this.harvestSelected();
        case 'UPGRADE_TECH': return this.openTechTree();
        case 'SCAN_REGION': return this.scanRegion();
        case 'SELL_HARVEST': return this.sellHarvest();
      }
    };
    this.game.events.on('action:perform', this._onUIAction);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('action:perform', this._onUIAction);
      this.alertMarkers.forEach(marker => marker.destroy());
      this.alertMarkers.clear();
      this.closeSeedMenu(); // Garantiza que el overlay de semillas no quede colgado al cerrar la escena.
    });

    if (!this.scene.isActive('UI')) this.scene.launch('UI');
  }

  // Selección por BLOQUE
  selectBlock(blockId) {
    const parcela = this.parcelaByBlockId.get(blockId);
    if (!parcela) return;

    this.selectedParcelaId = parcela.id;
    const player = findFirstPlayer();
    if (player) player.parcelaSeleccionadaId = parcela.id;

    const p = repoGet('parcelas', parcela.id);
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo === 'AGUA');

    this.game.events.emit('inspect:parcela', {
      id: p?.id,
      saludSuelo: p?.saludSuelo?.toFixed(2),
      cultivo: c ? { tipo: c.tipo, etapa: c.etapa, progreso: c.progreso.toFixed(2) } : null,
      agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null
    });

    this.drawBlockSelector(blockId);
  }

  drawBlockSelector(blockId){
    const parcela = this.parcelaByBlockId.get(blockId);
    if (!parcela) return;

    const g = this.selector || (this.selector = this.add.graphics());
    g.clear().lineStyle(2, 0x60a5fa, 1);

    const x0 = parcela.x, y0 = parcela.y;
    const w  = parcela.w, h  = parcela.h;

    const a = isoProject(x0,     y0,     this.offX, this.offY);
    const b = isoProject(x0+w,   y0,     this.offX, this.offY);
    const c = isoProject(x0+w,   y0+h,   this.offX, this.offY);
    const d = isoProject(x0,     y0+h,   this.offX, this.offY);

    const sy = Math.max(a.sy, b.sy, c.sy, d.sy);
    g.setDepth(sy + 9999);

    const pts = [{x:a.sx,y:a.sy},{x:b.sx,y:b.sy},{x:c.sx,y:c.sy},{x:d.sx,y:d.sy}];
    g.strokePoints(pts, true);
    g.fillStyle(0x60a5fa, 0.06).fillPoints(pts, true);
  }

  // Calcula un conjunto de métricas para renderizar los íconos de cultivo
  // basadas en el ancho actual de la ventana. Esto asegura que los emojis
  // sean legibles tanto en pantallas pequeñas como en monitores grandes.
  getCultivoSpriteMetrics() {
    const viewportWidth = this.scale?.width || 1280;
    const scale = Phaser.Math.Clamp(viewportWidth / 1280, 0.75, 2.6);

    const fontSize = Math.round(78 * scale);
    return {
      fontSize,
      stroke: Math.max(4, Math.round(fontSize * 0.12)),
      shadow: Math.max(6, Math.round(fontSize * 0.18)),
      yOffset: Math.round(fontSize * 0.08)
    };
  }

  // Destruye de manera segura cualquier estructura que se haya guardado como
  // representación visual del cultivo (texto suelto, lista de textos, etc.).
  destroyCultivoSpriteEntry(entry) {
    if (!entry) return;

    if (Array.isArray(entry)) {
      entry.forEach(item => this.destroyCultivoSpriteEntry(item));
      return;
    }

    if (entry.texts) {
      entry.texts.forEach(item => this.destroyCultivoSpriteEntry(item));
    }

    if (entry.container && typeof entry.container.destroy === 'function') {
      entry.container.destroy(true);
    }

    if (typeof entry.destroy === 'function') {
      entry.destroy();
    }
  }

  showCultivoSprite(parcelaId, tipoCultivo, etapa, progreso = 0) {
    const blockId = this.blockIdByParcelaId.get(parcelaId);
    if (!blockId) return;

    const existing = this.cultivoSprites.get(parcelaId);
    if (existing) {
      this.destroyCultivoSpriteEntry(existing);
      this.cultivoSprites.delete(parcelaId);
    }

    // Determina la fase visual tomando en cuenta progreso y etapa para desplegar
    // íconos especiales (ej: semilla de maíz recién sembrada vs. brote).
    const spritePhase = resolveSpritePhase({ tipo: tipoCultivo, etapa, progreso });

    let emoji = '🌱';
    switch (spritePhase) {
      case SPRITE_PHASES.MAIZ_SEMILLA: emoji = '🟠'; break;
      case SPRITE_PHASES.MAIZ_BROTE: emoji = '🌱'; break;
      case 'BROTE': emoji = '🌿'; break;
      case 'CRECIMIENTO': emoji = '🌾'; break;
      case 'MADURO': emoji = '🌻'; break;
      case 'COSECHA': emoji = '🧺'; break;
      case 'MUERTO': emoji = '🥀'; break;
      default: emoji = '🌱';
    }

    const metrics = this.getCultivoSpriteMetrics();
    // Reducimos ligeramente la semilla de maíz para que destaque como punto de
    // siembra sin cubrir todo el tile.
    const isSeedPhase = spritePhase === SPRITE_PHASES.MAIZ_SEMILLA;
    const tiles = this.spritesByBlockId.get(blockId) || [];
    const overlays = [];

    if (tiles.length) {
      // Replica el emoji en cada sprite base que compone el bloque, de modo
      // que las parcelas multi-tile mantengan consistencia visual.
      tiles.forEach((tile) => {
        if (!tile?.active) return;
        const text = this.add.text(tile.x, tile.y - metrics.yOffset, emoji, {
          fontSize: `${Math.round(metrics.fontSize * (isSeedPhase ? 0.72 : 1))}px`,
          fontFamily: 'Noto Color Emoji, "Segoe UI Emoji", system-ui, sans-serif',
          align: 'center'
        }).setOrigin(0.5);

        text.setStroke('#0f172a', metrics.stroke);
        text.setShadow(0, metrics.shadow, 'rgba(15,23,42,0.65)', metrics.shadow * 1.5, true, true);
        text.setDepth((tile.depth ?? 0) + 25);
        overlays.push(text);
      });
    } else {
      // Fallback para casos extremos donde el bloque no tenga sprites
      // registrados (p. ej. datos corruptos o escenas antiguas).
      const pos = this.blockPositions.get(blockId);
      if (!pos) return;

      const text = this.add.text(pos.x, pos.y - metrics.yOffset, emoji, {
        fontSize: `${Math.round(metrics.fontSize * (isSeedPhase ? 0.72 : 1))}px`,
        fontFamily: 'Noto Color Emoji, "Segoe UI Emoji", system-ui, sans-serif',
        align: 'center'
      }).setOrigin(0.5);

      text.setStroke('#0f172a', metrics.stroke);
      text.setShadow(0, metrics.shadow, 'rgba(15,23,42,0.65)', metrics.shadow * 1.5, true, true);
      const rep = this.spriteByParcela.get(parcelaId);
      const baseDepth = rep ? rep.depth + 25 : pos.y + 50;
      text.setDepth(baseDepth);
      overlays.push(text);
    }

    this.cultivoSprites.set(parcelaId, { texts: overlays });
  }

  clearCultivoSprite(parcelaId) {
    const existing = this.cultivoSprites.get(parcelaId);
    if (!existing) return;
    this.destroyCultivoSpriteEntry(existing);
    this.cultivoSprites.delete(parcelaId);
  }

  createAlertMarker(alert, pos) {
    if (!pos) return null;

    // Calcula medidas dependientes del ancho actual para que el tooltip escale
    // correctamente en desktop, tablet o móvil.
    const computeResponsiveMetrics = () => {
      const viewportWidth = this.scale.width;
      const scaleFactor = Phaser.Math.Clamp(viewportWidth / 1024, 0.95, 2.25);

      return {
        bubbleOffset: Math.round(190 * scaleFactor),
        fontSize: Math.round(56 * scaleFactor),
        padX: Math.round(54 * scaleFactor),
        padY: Math.round(44 * scaleFactor),
        pointerHeight: Math.round(58 * scaleFactor),
        maxWidth: Phaser.Math.Clamp(Math.round(viewportWidth * 0.62), 440, 900),
        pointerMaxHalf: Math.round(78 * scaleFactor),
        floatAmplitude: Math.round(28 * scaleFactor)
      };
    };

    const metrics = computeResponsiveMetrics();

    // Contenedor flotante que se ancla sobre la parcela y se reubica según escala.
    const container = this.add.container(pos.x, pos.y - metrics.bubbleOffset);
    container.setDepth(pos.y + 1600);

    const bubble = this.add.graphics();
    const text = this.add.text(0, 0, '', {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: `${metrics.fontSize}px`,
      fontStyle: 'bold',
      color: '#f8fafc',
      align: 'center'
    }).setOrigin(0.5, 1);

    const redraw = (message, targetPos) => {
      const nextMetrics = computeResponsiveMetrics();

      if (targetPos) {
        container.setPosition(targetPos.x, targetPos.y - nextMetrics.bubbleOffset);
        container.setDepth(targetPos.y + 1600);
      }

      text.setFontSize(nextMetrics.fontSize);
      text.setLineSpacing(Math.round(nextMetrics.fontSize * 0.25));
      text.setText(message || '');
      const shadowOffset = Math.max(4, Math.round(nextMetrics.fontSize * 0.18));
      text.setShadow(0, shadowOffset, 'rgba(15,23,42,0.65)', shadowOffset * 2, true, true);

      const wrapWidth = nextMetrics.maxWidth - nextMetrics.padX * 2;
      text.setWordWrapWidth(wrapWidth, true);
      const contentWidth = Math.min(wrapWidth, text.width);
      const width = Math.max(280, contentWidth + nextMetrics.padX * 2);
      const height = text.height + nextMetrics.padY * 2;
      const pointerTop = -nextMetrics.pointerHeight;
      const bubbleTop = pointerTop - height;
      const pointerHalf = Math.min(nextMetrics.pointerMaxHalf, width / 3);

      bubble.clear();
      bubble.fillStyle(0x0f172a, 0.96);
      bubble.fillRoundedRect(-width / 2, bubbleTop, width, height, 28);
      bubble.fillTriangle(-pointerHalf, pointerTop, pointerHalf, pointerTop, 0, 0);
      bubble.lineStyle(6, 0xfacc15, 0.98);
      bubble.strokeRoundedRect(-width / 2, bubbleTop, width, height, 28);
      bubble.strokeTriangle(-pointerHalf, pointerTop, pointerHalf, pointerTop, 0, 0);
      text.y = pointerTop - nextMetrics.padY + Math.round(nextMetrics.fontSize * 0.24);
    };

    container.add([bubble, text]);
    redraw(alert.mensaje, pos);

    // Movimiento sutil para llamar la atención sobre la parcela alertada.
    const bob = this.tweens.add({
      targets: container,
      y: container.y - metrics.floatAmplitude,
      duration: 1600,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    return {
      container,
      text,
      bubble,
      update: (message, nextPos) => redraw(message, nextPos),
      destroy: () => {
        if (bob) bob.stop();
        container.destroy();
      }
    };
  }

  syncAlertMarkers() {
    if (!this.alertMarkers) this.alertMarkers = new Map();
    const activeAlerts = repoAll('alertas');
    const keep = new Set();

    for (const alert of activeAlerts) {
      const isVisible = alert && alert.visible !== false;
      if (!isVisible) continue;
      const blockId = alert.parcelaId ? this.blockIdByParcelaId.get(alert.parcelaId) : null;
      const pos = blockId ? this.blockPositions.get(blockId) : null;
      const marker = this.alertMarkers.get(alert.id);
      if (!pos) {
        if (marker) {
          marker.destroy();
          this.alertMarkers.delete(alert.id);
        }
        continue;
      }

      keep.add(alert.id);

      if (!marker) {
        const created = this.createAlertMarker(alert, pos);
        if (created) {
          this.alertMarkers.set(alert.id, { ...created, message: alert.mensaje });
        }
        continue;
      }

      if (marker.message !== alert.mensaje) {
        marker.message = alert.mensaje;
        marker.update(alert.mensaje, pos);
      } else {
        marker.update(alert.mensaje, pos);
      }
    }

    for (const [id, marker] of this.alertMarkers.entries()) {
      if (!keep.has(id)) {
        marker.destroy();
        this.alertMarkers.delete(id);
      }
    }
  }

  updateCultivoSprite(cultivo) {
    if (!cultivo) return;
    let parcelaId = this.parcelaIdByCultivoId.get(cultivo.id);

    if (!parcelaId) {
      const found = repoAll('parcelas').find(p => p.cultivoId === cultivo.id);
      parcelaId = found?.id;
      if (parcelaId) this.parcelaIdByCultivoId.set(cultivo.id, parcelaId);
    }

    if (!parcelaId) return;
    // Persistimos la fase actual para que los sistemas sepan si deben redibujar
    // cuando cambie el progreso o la etapa lógica del cultivo.
    cultivo.__spritePhase = resolveSpritePhase(cultivo);
    this.showCultivoSprite(parcelaId, cultivo.tipo, cultivo.etapa, cultivo.progreso ?? 0);
  }

  // === Acciones aplicadas al BLOQUE seleccionado ===
  plowSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    // Revisamos si hay un cultivo muerto para permitir "limpiar" la parcela.
    const cultivo = p.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const cultivoMuerto = cultivo && (cultivo.etapa === 'MUERTO' || (cultivo.saludActual ?? 0) <= 0);

    if (p.arada && !cultivoMuerto && !p.cultivoId) {
      this.game.events.emit('toast',{type:'info', msg: t('game.toasts.parcelAlreadyPlowed', { parcel: p.id })});
      return;
    }

    // Si hay un cultivo muerto lo eliminamos junto con sus indicadores visuales.
    if (cultivoMuerto) {
      State.repos.cultivos.delete(cultivo.id);
      this.parcelaIdByCultivoId.delete(cultivo.id);
      this.clearCultivoSprite(p.id);
      p.cultivoId = null;
    }

    // También limpiamos los tooltips/alertas asociados a la parcela arada.
    repoAll('alertas').forEach((alerta) => {
      if (alerta.parcelaId === p.id) alerta.visible = false;
    });

    // Reestablecemos banderas base para que la parcela quede lista para sembrar.
    p.arada = true;
    p.plagaActiva = false;
    p.intensidadPlaga = 0;

    const agua = (p.recursos || [])
      .map((rid) => repoGet('recursos', rid))
      .find((r) => r && r.tipo === 'AGUA');
    // Dejamos la humedad del suelo con un mínimo saludable para imitar tierra recién labrada.
    if (agua) agua.nivel = Math.max(agua.nivel ?? 0, 0.6);

    applyBlockVisual(this, p.id);
    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.plowSuccess', { parcel: p.id }) });

    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);
  }

  waterSelected() {
    if ((this._cooldowns?.water || 0) > 0) return;
    this._cooldowns.water = 400;

    const selId = this.selectedParcelaId;
    if (!selId) return;

    const p = repoGet('parcelas', selId);
    if (!p) return;

    const player = findFirstPlayer();
    // Comprobamos contra el costo compartido para mantener la UI en sincronía.
    if (!spend(player, WATER_ACTION_COST)) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.insufficientFunds', { amount: WATER_ACTION_COST }) });
      return;
    }

    const agua = (p.recursos||[])
      .map(rid => repoGet('recursos', rid))
      .find(r => r && r.tipo === 'AGUA');

    if (!agua) {
      this.game.events.emit('toast',{type:'warn',msg: t('game.toasts.noWater', { parcel: p.id })});
      return;
    }

    agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);

    const WET_DURATION = 1200;
    p.wetUntil = (p.wetUntil && State.clock < p.wetUntil)
      ? p.wetUntil + Math.floor(WET_DURATION*0.5)
      : State.clock + WET_DURATION;

    applyBlockVisual(this, p.id);
    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.waterSuccess', { parcel: p.id }) });

    repoAll('alertas').forEach(a => { if (a.parcelaId === p.id) a.visible = false; });
    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);
  }

  harvestSelected(){
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    const cultivo = p.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    if (!cultivo) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.noCrop') });
      return;
    }

    if (!isCultivoListo(cultivo.id)) {
      const config = CROP_CONFIG[cultivo.tipo];
      const nombre = config?.nombre || cultivo.tipo;
      const progresoPct = Math.round((cultivo.progreso || 0) * 100);
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.cropNotReady', { crop: nombre, progress: progresoPct }) });
      return;
    }

    const config = CROP_CONFIG[cultivo.tipo];
    if (!config) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.unknownCrop') });
      return;
    }

    const player = findFirstPlayer();
    const salud = typeof cultivo.saludActual === 'number' ? Math.min(Math.max(cultivo.saludActual, 0), 1) : 1;
    const ganancia = Math.max(0, Math.floor(config.precioVenta * salud));

    if (player) player.cartera = (player.cartera || 0) + ganancia;

    State.repos.cultivos.delete(cultivo.id);
    p.cultivoId = null;
    this.parcelaIdByCultivoId.delete(cultivo.id);
    this.clearCultivoSprite(p.id);

    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.harvestSuccess', { crop: config.nombre, amount: ganancia }) });

    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);
  }

  async plantSelected() {
    if (!this.selectedParcelaId) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.selectParcelFirst') });
      return;
    }

    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    if (!p.arada) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.plowFirst') });
      return;
    }

    if (p.cultivoId) {
      const cultivo = repoGet('cultivos', p.cultivoId);
      const config = cultivo ? CROP_CONFIG[cultivo.tipo] : null;
      const cropName = config?.nombre || cultivo?.tipo || t('game.toasts.genericCropName');
      this.game.events.emit('toast', { type:'info', msg: t('game.toasts.parcelAlreadyPlanted', { parcel: p.id, crop: cropName }) });
      return;
    }

    this.openSeedMenu(p.id);
  }

  closeSeedMenu() {
    // Removemos listeners dedicados (teclas, etc.) para evitar que disparen
    // acciones cuando el menú ya no está visible.
    if (this.seedMenuHandlers?.esc && this.input?.keyboard) {
      this.input.keyboard.off('keydown-ESC', this.seedMenuHandlers.esc, this);
    }

    if (this.seedMenu?.container && typeof this.seedMenu.container.destroy === 'function') {
      this.seedMenu.container.destroy(true);
    }

    this.seedMenu = null;
    this.seedMenuHandlers = {};
  }

  openSeedMenu(parcelaId) {
    this.closeSeedMenu();

    const cam = this.cameras.main;
    const view = cam?.worldView;
    const centerX = view ? view.centerX : cam.midPoint.x;
    const centerY = view ? view.centerY : cam.midPoint.y;

    const container = this.add.container(centerX, centerY).setDepth(1_000_000);
    container.setScrollFactor(1);

    // Crea un fondo semitransparente que bloquea clics en el mapa mientras el
    // jugador elige el cultivo a sembrar.
    const backdropWidth = view ? view.width * 1.4 : cam.width / cam.zoom;
    const backdropHeight = view ? view.height * 1.4 : cam.height / cam.zoom;
    const backdrop = this.add.rectangle(0, 0, backdropWidth, backdropHeight, 0x0f172a, 0.52)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: false });

    // Retrasamos levemente la interacción para que el pointerup que disparó la
    // apertura del menú no lo cierre inmediatamente.
    backdrop.disableInteractive();
    this.time.delayedCall(160, () => {
      if (!backdrop.scene || !backdrop.active) return;
      backdrop.setInteractive({ useHandCursor: false });
    });

    backdrop.on('pointerup', () => this.closeSeedMenu());
    container.add(backdrop);

    const cropKeys = Object.keys(CROP_CONFIG);
    const buttonCount = cropKeys.length;
    // Escalamos todos los elementos del menú para duplicar su presencia visual
    // respetando el ancho disponible del viewport actual. El factor boost se
    // aplica a dimensiones y márgenes clave para mantener proporciones.
    const boost = 2;
    const baseWidth = view ? view.width : cam.width;
    const unclampedWidth = Phaser.Math.Clamp(baseWidth * 0.7, 420, 920);
    const viewportCap = Math.max(720, baseWidth - 120);
    const panelWidth = Phaser.Math.Clamp(unclampedWidth * boost, 640, viewportCap);
    const buttonHeight = 108 * boost;
    const buttonSpacing = 22 * boost;
    const panelHeight = Math.max(340 * boost, buttonCount * (buttonHeight + buttonSpacing) + 220 * boost);

    const panel = this.add.rectangle(0, 0, panelWidth, panelHeight, 0x1e293b, 0.94)
      .setOrigin(0.5);
    panel.setStrokeStyle(8, 0xfacc15, 0.95);
    panel.setInteractive(new Phaser.Geom.Rectangle(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight), Phaser.Geom.Rectangle.Contains);
    container.add(panel);

    const title = this.add.text(0, -panelHeight / 2 + 64 * boost, t('game.seedMenu.title'), {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: `${Math.round(panelWidth * 0.05)}px`,
      fontStyle: '700',
      color: '#f8fafc',
      align: 'center'
    }).setOrigin(0.5, 0);
    container.add(title);

    const subtitle = this.add.text(0, title.y + 56 * boost, t('game.seedMenu.subtitle'), {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: `${Math.round(panelWidth * 0.028)}px`,
      color: '#cbd5f5',
      align: 'center',
      wordWrap: { width: panelWidth - 80 * boost }
    }).setOrigin(0.5, 0);
    container.add(subtitle);

    const metrics = { panelWidth, buttonHeight, buttonSpacing };
    const listTop = subtitle.y + 104 * boost;

    const localizeCropName = (key, fallback) => {
      const translationKey = `game.crops.${key}`;
      const localized = t(translationKey);
      return localized === translationKey ? (fallback || key) : localized;
    };

    cropKeys.forEach((cropKey, idx) => {
      const cfg = CROP_CONFIG[cropKey];
      const y = listTop + idx * (metrics.buttonHeight + metrics.buttonSpacing);
      const optionWidth = panelWidth - 120 * boost;

      const optionBg = this.add.rectangle(0, y, optionWidth, metrics.buttonHeight, 0x334155, 0.92)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      optionBg.on('pointerover', () => optionBg.setFillStyle(0x3b4760, 0.96));
      optionBg.on('pointerout', () => optionBg.setFillStyle(0x334155, 0.92));
      optionBg.on('pointerup', () => {
        const planted = this.sembrarCultivo(parcelaId, cropKey);
        if (planted) {
          this.closeSeedMenu();
        }
      });

      const optionText = this.add.text(0, y, t('game.seedMenu.optionLabel', {
        crop: localizeCropName(cropKey, cfg?.nombre || cropKey),
        cost: cfg?.costoSemilla ?? 0
      }), {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: `${Math.round(panelWidth * 0.036)}px`,
        color: '#f8fafc',
        fontStyle: '600',
        align: 'center'
      }).setOrigin(0.5);

      container.add(optionBg);
      container.add(optionText);
    });

    const cancelY = panelHeight / 2 - 86 * boost;
    const cancelBg = this.add.rectangle(0, cancelY, panelWidth - 240 * boost, 78 * boost, 0x64748b, 0.88)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    cancelBg.on('pointerover', () => cancelBg.setFillStyle(0x94a3b8, 0.92));
    cancelBg.on('pointerout', () => cancelBg.setFillStyle(0x64748b, 0.88));
    cancelBg.on('pointerup', () => this.closeSeedMenu());

    const cancelText = this.add.text(0, cancelY, t('game.seedMenu.cancel'), {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      fontSize: `${Math.round(panelWidth * 0.034)}px`,
      fontStyle: '600',
      color: '#0f172a'
    }).setOrigin(0.5);

    container.add(cancelBg);
    container.add(cancelText);

    const escHandler = () => this.closeSeedMenu();
    if (this.input?.keyboard) {
      this.input.keyboard.on('keydown-ESC', escHandler, this);
      this.seedMenuHandlers.esc = escHandler;
    }

    this.seedMenu = { container, parcelaId };
  }

  sembrarCultivo(parcelaId, tipoCultivo) {
    const p = repoGet('parcelas', parcelaId);
    if (!p) return false;

    const config = CROP_CONFIG[tipoCultivo];
    if (!config) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.cropMissing', { crop: tipoCultivo }) });
      return false;
    }

    const player = findFirstPlayer();
    if (!spend(player, config.costoSemilla)) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.insufficientFunds', { amount: config.costoSemilla }) });
      return false;
    }

    const cultivo = Factory.createCultivo({
      tipo: tipoCultivo,
      etapa: 'SEMILLA',
      progreso: 0,
      consumoAgua: config.consumoAgua,
      resistenciaPlagas: config.resistenciaPlagas,
      saludActual: 1.0
    });

    // Almacenamos la fase inicial para que el sistema de cultivos pueda detectar
    // transiciones visuales (ej. pasar de semilla de maíz a brote).
    cultivo.__spritePhase = resolveSpritePhase(cultivo);

    p.cultivoId = cultivo.id;
    this.parcelaIdByCultivoId.set(cultivo.id, p.id);

    this.showCultivoSprite(p.id, tipoCultivo, cultivo.etapa, cultivo.progreso ?? 0);

    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.plantSuccess', { crop: config.nombre, parcel: p.id }) });

    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);

    return true;
  }

  openTechTree() {
    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.techTree') });
  }

  scanRegion() {
    if (!this.selectedParcelaId) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.selectParcelForScan') });
      return;
    }
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    const agua = (p.recursos||[]).map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
    const smapRZSM = Number(agua?.nivel ?? 0);
    const ndvi     = Number(p.saludSuelo ?? 0.5);
    const heat     = Phaser.Math.Clamp(Math.random()*0.6, 0, 1);

    const msg = t('game.toasts.scanSummary', {
      smap: (smapRZSM*100).toFixed(0),
      ndvi: (ndvi*100).toFixed(0),
      heat: (heat*100).toFixed(0),
    });
    this.game.events.emit('toast', { type:'ok', msg });
  }

  sellHarvest() {
    let total = 0;
    let conteo = 0;

    for (const p of repoAll('parcelas')) {
      if (!p.cultivoId) continue;
      const cultivo = repoGet('cultivos', p.cultivoId);
      if (!cultivo) continue;

      if (!isCultivoListo(cultivo.id)) continue;

      const config = CROP_CONFIG[cultivo.tipo];
      if (!config) continue;

      const salud = typeof cultivo.saludActual === 'number' ? Math.min(Math.max(cultivo.saludActual, 0), 1) : 1;
      const ganancia = Math.max(0, Math.floor(config.precioVenta * salud));

      total += ganancia;
      conteo++;

      State.repos.cultivos.delete(cultivo.id);
      this.parcelaIdByCultivoId.delete(cultivo.id);
      this.clearCultivoSprite(p.id);
      p.cultivoId = null;
    }

    const player = findFirstPlayer();
    if (total > 0) {
      if (player) player.cartera = (player.cartera || 0) + total;
      this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.sellSuccess', { count: conteo, amount: total }) });
    } else {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.noHarvestReady') });
    }
  }

  update(_, delta) {
    // 1) Ajusta overlay al viewport
    if (this.ambient) {
      const cam = this.cameras.main;
      this.ambient.setPosition(cam.worldView.x, cam.worldView.y);
      this.ambient.setSize(cam.worldView.width, cam.worldView.height);
    }

    // 2) Avanza simulación temporal antes de efectos visuales
    State.clock += 1;
    tickSim(delta);

    // 3) Día/tarde/noche + sombras (sincronizado con simulación)
    this.tickDayNight();

    // 4) Cooldowns
    const dec = delta;
    for (const k in this._cooldowns) {
      this._cooldowns[k] = Math.max(0, (this._cooldowns[k] || 0) - dec);
    }

    // 5) Cámara (wasd/flechas)
    const cam = this.cameras.main;
    const dt = delta / 1000;
    const v = this.camSpeed / cam.zoom;
    if (this.cursors?.left.isDown)  cam.scrollX -= v * dt;
    if (this.cursors?.right.isDown) cam.scrollX += v * dt;
    if (this.cursors?.up.isDown)    cam.scrollY -= v * dt;
    if (this.cursors?.down.isDown)  cam.scrollY += v * dt;

    // 6) Atajos (mismos que tu primer archivo)
    if (Phaser.Input.Keyboard.JustDown(this.keyA)) this.plowSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyW)) this.waterSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyD)) this.harvestSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyS)) this.sellHarvest();
    if (Phaser.Input.Keyboard.JustDown(this.keyX)) this.openTechTree();

    // 7) Simulación
    const dayN = getSimDayNumber();
    if (dayN !== _lastDay) {
      _lastDay = dayN;
      const dayIndex = Math.max(0, dayN - 1);
      tickClimate({ regionCode: State.region?.codigo, dayIndex })
        .catch(err => console.error('climate:tick', err));
    }
    tickCrops(); tickPlagues(); tickAlerts();
    this.syncAlertMarkers();

    // 8) Secado periódico
    if ((State.clock % 15) === 0) {
      for (const p of repoAll('parcelas')) {
        if (p.wetUntil && State.clock >= p.wetUntil) {
          p.wetUntil = 0;
          applyBlockVisual(this, p.id);
        }
      }
    }
  }

  tickDayNight() {
    // ===== Sincroniza con el reloj de la simulación (0..1)
    const tSim = getSimDayProgress01();
    if (!Number.isNaN(tSim)) {
      this.timeOfDay = tSim;
    }

    // ===== Fases
    const t = this.timeOfDay;
    let ambient = 0.0;
    let sunAlt  = 0.0;
    let sunAzim = 0.0;

    if (t < 0.15) {
      const u = smoothstep(t / 0.15);
      ambient = 0.85 - 0.55*u;
      sunAlt  = 0.15 + 0.65*u;
      sunAzim = 0.15;
    } else if (t < 0.75) {
      const u = (t - 0.15) / 0.60;
      ambient = 0.30 - 0.10*Math.cos(Math.PI*u);
      sunAlt  = 0.80 + 0.15*Math.cos(Math.PI*u);
      sunAzim = 0.25 + 0.50*u;
    } else if (t < 0.90) {
      const u = smoothstep((t - 0.75) / 0.15);
      ambient = 0.30 + 0.40*u;
      sunAlt  = 0.60 - 0.45*u;
      sunAzim = 0.75;
    } else {
      const u = (t - 0.90) / 0.10;
      ambient = 0.70 + 0.20*u;
      sunAlt  = 0.10;
      sunAzim = 0.75;
    }

    // ===== Dirección del sol (pantalla isométrica)
    const angle = sunAzim * Math.PI;
    const dirX  = Math.cos(angle);
    const dirY  = Math.sin(angle) * 0.6;

    // ===== Geometría/alpha de sombras según altura del sol
    const sunK   = Phaser.Math.Clamp(sunAlt, 0, 1);
    const len    = Phaser.Math.Linear(1.8, 0.6, sunK);
    const alphaK = Phaser.Math.Linear(1.2, 0.6, sunK);
    const squish = Phaser.Math.Linear(1.0, 0.75, sunK);
    const blurK  = Phaser.Math.Linear(1.4, 0.9, sunK);

    // ===== Tinte ambiental
    if (this.ambient) {
      const clamp01 = (v) => Phaser.Math.Clamp(v, 0, 1);
      const a = clamp01(ambient);

      const COL_DAY   = 0xffffff;
      const COL_DAWN  = 0xffc288;
      const COL_DUSK  = 0xff9a3c;
      const COL_NIGHT = 0x0a0f3a;

      const smooth = (x)=> x*x*(3-2*x);
      const lerpColor = (c1, c2, k) => {
        const r1=(c1>>16)&255, g1=(c1>>8)&255, b1=c1&255;
        const r2=(c2>>16)&255, g2=(c2>>8)&255, b2=c2&255;
        const r = Math.round(r1 + (r2 - r1) * k);
        const g = Math.round(g1 + (g2 - g1) * k);
        const b = Math.round(b1 + (b2 - b1) * k);
        return (r<<16)|(g<<8)|b;
      };

      let color = COL_DAY, alpha = 0;

      if (t < 0.15) {
        const k = smooth(t / 0.15);
        color = lerpColor(COL_NIGHT, COL_DAWN, k);
        alpha = Phaser.Math.Linear(0.65, 0.10, k);
      } else if (t < 0.50) {
        const k = smooth((t - 0.15) / 0.35);
        color = lerpColor(COL_DAWN, COL_DAY, k);
        alpha = Phaser.Math.Linear(0.10, 0.00, k);
      } else if (t < 0.75) {
        const k = smooth((t - 0.50) / 0.25);
        color = lerpColor(COL_DAY, COL_DUSK, k);
        alpha = Phaser.Math.Linear(0.00, 0.28, k);
      } else {
        const k = smooth((t - 0.75) / 0.25);
        color = lerpColor(COL_DUSK, COL_NIGHT, k);
        alpha = Phaser.Math.Linear(0.28, 0.65, k);
      }

      this.ambient.setFillStyle(color, Phaser.Math.Clamp(alpha, 0, 1));
    }

    // ===== Sombras de decor (ancladas y desvanecidas de noche)
    if (this.decorEntries && this.decorEntries.length) {
      const lightK = Phaser.Math.Clamp((sunAlt - 0.12) / 0.28, 0, 1);
      const angle = sunAzim * Math.PI;
      const dirX  = Math.cos(angle);
      const dirY  = Math.sin(angle) * 0.6;

      const len    = Phaser.Math.Linear(1.8, 0.6, sunK);
      const alphaK = Phaser.Math.Linear(1.15, 0.55, sunK);
      const squish = Phaser.Math.Linear(1.0, 0.75, sunK);
      const blurK  = Phaser.Math.Linear(1.35, 0.95, sunK);

      for (const e of this.decorEntries) {
        if (!e?.sprite || !e?.shadow) continue;

        const base = e.shadow.getData('shadowBase') || { dx:0, dy:0, w:e.shadow.width, h:e.shadow.height, alpha:0.25 };
        const name = e.sprite.getData('decor')?.name || '';
        const isBuilding = (name === 'barn' || name === 'silo');

        // posición
        const sx = e.sprite.x + (base.dx * len * dirX);
        const sy = isBuilding
          ? (e.sprite.y - 1 + base.dy * 0.2)
          : (e.sprite.y + (base.dy * len * (0.6 + 0.4*dirY)));
        e.shadow.setPosition(sx, sy);

        // tamaño
        const widen   = isBuilding ? 1.30 : 1.00;
        const flatten = isBuilding ? 0.90 : 1.00;
        e.shadow.setDisplaySize(
          base.w * len * blurK * widen,
          base.h * squish * blurK * flatten
        );

        // opacidad (casi 0 en noche)
        const baseA   = base.alpha ?? 0.25;
        const anchorA = isBuilding ? 1.05 : 1.00;
        const nightFade = lightK * lightK;
        e.shadow.setAlpha(baseA * alphaK * anchorA * nightFade);
      }
    }
  }
}