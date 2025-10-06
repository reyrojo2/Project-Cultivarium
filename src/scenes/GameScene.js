// GameScene.js (unificado con i18n)
import Phaser from 'phaser';
import { GAME } from '../main.js';
import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { EVENTOS_TIPO, NIVELES } from '../data/enums.js';
import { tickClimate } from '../systems/climateSystem.js';
import { getSimDayNumber } from '../core/time.js';
import { tickCrops } from '../systems/cropSystem.js';
import { tickPlagues } from '../systems/plagueSystem.js';
import { tickAlerts } from '../systems/alertSystem.js';
import { findFirstPlayer, spend } from '../core/state.js';
import { startLevel, tickSim, getSimDayProgress01 } from '../core/time.js';
import { T, MAP_PRESETS, makePlayableMatrix, makeWorldMatrix, buildBlockIndex } from '../map/mapBuilder.js';
import { DECOR, addDecor } from '../map/decor.js';
import { getLanguage, setLanguage, translate as t } from '../utils/i18n.js';

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

    this._cooldowns = { water: 0, plow: 0, harvest: 0, plant: 0 };
    this.decorEntries = []; // {sprite, shadow}
    this.timeOfDay = 0.5;   // 0..1 (se sincroniza con la simulación al iniciar)
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
    Factory.createPlayer({ name: 'AgroPro', cartera: 200 });
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
    this.spriteByParcela = new Map();
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

      const recAgua = Factory.createRecurso({ tipo:'AGUA', nivel:0.0 });
      const parcela = Factory.createParcela({
        x: worldX0, y: worldY0, w: parcelaSize, h: parcelaSize,
        recursos: [recAgua.id], cultivoId: null, saludSuelo: 0.8, arada: false
      });

      this.parcelaByBlockId.set(b.id, parcela);
      this.blockIdByParcelaId.set(parcela.id, b.id);

      const list = this.spritesByBlockId.get(b.id) || [];
      const rep  = list.length ? list[(list.length/2)|0] : null;
      if (rep) this.spriteByParcela.set(parcela.id, rep);
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

  // === Acciones aplicadas al BLOQUE seleccionado ===
  plowSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    if (p.arada) {
      this.game.events.emit('toast',{type:'info', msg: t('game.toasts.parcelAlreadyPlowed', { parcel: p.id })});
      return;
    }
    p.arada = true;
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
    if (!spend(player, 10)) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.insufficientFunds', { amount: 10 }) });
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
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const player = findFirstPlayer();

    if(c?.etapa==='COSECHA' && c.progreso>=1){
      player.cartera += 30;
      c.etapa='SIEMBRA'; c.progreso=0;
      this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.harvestSuccessSimple', { amount: 30, parcel: p.id }) });
      const blockId = this.blockIdByParcelaId.get(p.id);
      if (blockId) this.drawBlockSelector(blockId);
    } else {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.cropNotReady') });
    }
  }

  async plantSelected() {
    if (!this.selectedParcelaId) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.selectParcelFirst') });
      return;
    }
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    if (p.cultivoId) {
      const c = repoGet('cultivos', p.cultivoId);
      this.game.events.emit('toast', { type:'info', msg: t('game.toasts.parcelAlreadyPlanted', { parcel: p.id, crop: c?.tipo || t('game.toasts.genericCropName') }) });
      return;
    }

    const player = findFirstPlayer();
    if (!spend(player, 15)) {
      this.game.events.emit('toast', { type:'warn', msg: t('game.toasts.insufficientFunds', { amount: 15 }) });
      return;
    }

    const cultivo = Factory.createCultivo({
      tipo: 'MAIZ',
      etapa: 'SIEMBRA',
      progreso: 0,
      consumoAgua: 1.0
    });
    p.cultivoId = cultivo.id;

    this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.plantSuccess', { crop: 'MAIZ', parcel: p.id }) });
    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);
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
    for (const p of repoAll('parcelas')) {
      if (!p.cultivoId) continue;
      const c = repoGet('cultivos', p.cultivoId);
      if (c?.etapa === 'COSECHA' && c.progreso >= 1) {
        total += 30;
        c.etapa = 'SIEMBRA';
        c.progreso = 0;
      }
    }
    const player = findFirstPlayer();
    if (total > 0) {
      player.cartera = (player.cartera || 0) + total;
      this.game.events.emit('toast', { type:'ok', msg: t('game.toasts.sellSuccessSimple', { amount: total }) });
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