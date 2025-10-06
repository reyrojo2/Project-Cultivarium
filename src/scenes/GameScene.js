import Phaser from 'phaser';
import { GAME } from '../main.js';
import { State, repoAll, repoGet } from '../core/state.js';
import { Factory } from '../core/factory.js';
import { EVENTOS_TIPO, NIVELES } from '../data/enums.js';
import { tickClimate } from '../systems/climateSystem.js';
import { tickCrops } from '../systems/cropSystem.js';
import { tickPlagues } from '../systems/plagueSystem.js';
import { tickAlerts } from '../systems/alertSystem.js';
import { findFirstPlayer, spend } from '../core/state.js';
import { startLevel, tickSim, TimeState } from '../core/time.js';
import { T, MAP_PRESETS, makePlayableMatrix, makeWorldMatrix, buildBlockIndex, buildFromPreset } from '../map/mapBuilder.js';
import { DECOR, addDecor } from '../map/decor.js';
import { CROP_CONFIG, isCultivoListo } from '../systems/cropSystem.js';

// === Proyección ISO 2:1 ===
const PROJ_W = 256;
const PROJ_H = 128;

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

// Cambia este nombre para otro preset
const SELECTED_MAP = 'base_4x3_9x9';

function applyBlockVisual(scene, parcelaId) {
  // parcelaId -> blockId -> sprites[]
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
// coloca y marca ocupación (usa addDecor de decor.js)
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
    this.keyR = null;
    this.keyC = null;
    this.camSpeed = 400;
    this.selector = null;
    this.offX = 0; this.offY = 0;
    // mapas
    this.spritesByBlockId = new Map();  // blockId -> sprite[]
    this.parcelaByBlockId = new Map();  // blockId -> parcelaObj
    this.blockIdByParcelaId = new Map();// parcelaId -> blockId
    this.keyA = null;
    this._cooldowns = { water: 0, plow: 0, harvest: 0, plant: 0 };
    this.decorEntries = [];      // ← entradas {sprite, shadow, def} de addDecor()
    this.timeOfDay = 0.5;          // 0..1
    this.dayLengthMs = 60000;   // 120 s por “día” (ajústalo)
  }

  create() {
    const cam = this.cameras.main;
    this.ambient = this.add.rectangle(0, 0, 10, 10, 0x000000, 0)
      .setOrigin(0)
      .setDepth(1e9);

    startLevel(0);
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
      // centro
      g.fillStyle(0x000000, 0.22); g.fillEllipse(128, 64, 220, 90);
      // anillos suaves
      for (let i = 1; i <= 6; i++) {
        const a = 0.22 * (1 - i / 7);     // alpha decreciente hacia afuera
        g.fillStyle(0x000000, a);
        g.fillEllipse(128, 64, 220 + i*20, 90 + i*10);
      }
      g.generateTexture('shadowSoft', 256, 128);
      g.destroy();
    }

    // ==== Selección de mapa (preset) ====
    // Asegúrate de definir SELECTED_MAP en tu archivo o reemplaza por una clave fija, ej: 'base_4x3_9x9'
    const cfg = MAP_PRESETS[SELECTED_MAP]; // ej: MAP_PRESETS.base_4x3_9x9
    const { plotsX, plotsY, parcelaSize, pathW, grassBorder } = cfg;

    // Matriz jugable (41x31 para 4x3 de 9x9 con caminos 1)
    const play = makePlayableMatrix(plotsX, plotsY, parcelaSize, pathW);
    const { blocks, blockIdAt, PLAY_W, PLAY_H } = buildBlockIndex(plotsX, plotsY, parcelaSize, pathW);

    // Inserta el área jugable en borde de pasto y obtén dimensiones
    const { world, dims } = makeWorldMatrix(play, grassBorder);
    const {
      TOTAL_W, TOTAL_H,
      FARM_MIN_X, FARM_MIN_Y, FARM_MAX_X, FARM_MAX_Y
    } = dims;

    // Centro del mapa
    this.offX = this.scale.width / 2;
    this.offY = 140;

    // === Colecciones por bloque/parcela ===
    this.spritesByBlockId = new Map();
    this.parcelaByBlockId = new Map();
    this.blockIdByParcelaId = new Map();
    this.spriteByParcela = new Map();    // parcelaId -> sprite representante (p/visual)
    this.selectedParcelaId = null;

    // helper: world coords -> blockId (dentro del área jugable)
    this.blockIdAtWorld = (gy, gx) => {
      const y = gy - grassBorder;
      const x = gx - grassBorder;
      if (y < 0 || x < 0 || y >= PLAY_H || x >= PLAY_W) return -1;
      return blockIdAt[y][x];
    };

    // === Render desde la matriz `world` ===
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
        if (type === T.GRASS) {
          continue;
        }

        // SOIL base (seca)
        tile.setTintFill(jitterColor(SOIL_DRY.r, SOIL_DRY.g, SOIL_DRY.b, 6, 6, 4));

        const blockId = this.blockIdAtWorld(gy, gx);
        if (blockId > 0) {
          if (!this.spritesByBlockId.has(blockId)) this.spritesByBlockId.set(blockId, []);
          this.spritesByBlockId.get(blockId).push(tile);
          tile.on('pointerdown', () => this.selectBlock(blockId));
        }
      }
    }

    // === 1 “parcela lógica” por bloque ===
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

      // sprite “representante” (cualquiera del bloque; cojo el central si existe)
      const list = this.spritesByBlockId.get(b.id) || [];
      const rep  = list.length ? list[(list.length/2)|0] : null;
      if (rep) this.spriteByParcela.set(parcela.id, rep);
    }
    
    this.decorEntries = [];  // limpia o crea

    // ======= DECOR: granero, silo, árboles, rocas, arbustos, tractor =======
    const occ = makeOcc(TOTAL_W, TOTAL_H);
    this.decorEntries = [];
    const addEntry = (e) => { if (e?.sprite && e?.shadow) this.decorEntries.push({sprite:e.sprite, shadow:e.shadow}); };

    // GRANERO
    {
      const gx = Math.max(0, Math.floor(grassBorder / 2));
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2));
      const e  = place(this, isoProject, occ, world, gx, gy, 'barn', { projW: PROJ_W });
      addEntry(e);
    }

    // SILO
    {
      const gx = Math.min(TOTAL_W - 2, TOTAL_W - Math.ceil(grassBorder / 2) - 2);
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2) - 2);
      const e  = place(this, isoProject, occ, world, gx, gy, 'silo', { projW: PROJ_W });
      addEntry(e);
    }

    // TRACTOR
    {
      const block = (blocks && blocks[0]) ? blocks[0] : null;
      const gx = block ? (grassBorder + block.x0 + block.w - 1) : (FARM_MIN_X + 1);
      const gy = block ? (grassBorder + block.y0 + 1)           : (FARM_MIN_Y + 1);
      const e  = place(this, isoProject, occ, world, gx, gy, 'tractor', { projW: PROJ_W });
      addEntry(e);
    }

    // ÁRBOLES
    {
      const tryPlaceTreeRow = (gyRow) => {
        for (let gx = 1; gx < TOTAL_W - 1; gx += 4) {
          if (world[gyRow][gx] === T.GRASS) {
            const e = place(this, isoProject, occ, world, gx, gyRow, 'tree', { projW: PROJ_W });
            addEntry(e);
          }
        }
      };
      tryPlaceTreeRow(FARM_MIN_Y - 2 >= 0 ? FARM_MIN_Y - 2 : 0);
      tryPlaceTreeRow(Math.min(TOTAL_H - 1, FARM_MAX_Y + 2));
    }

    // ROCAS
    {
      const tries = 25;
      for (let i = 0; i < tries; i++) {
        const gx = Phaser.Math.Between(1, TOTAL_W - 2);
        const gy = Phaser.Math.Between(1, TOTAL_H - 2);
        if (world[gy][gx] !== T.GRASS) continue;
        const name = (Math.random() < 0.5) ? 'rock1' : 'rock2';
        const e = place(this, isoProject, occ, world, gx, gy, name);
        if (e) {
          addEntry(e);
          occupyRect(occ, gx - 1, gy - 1, 3, 3);
        }
      }
    }

    // ARBUSTOS (clusters)
    {
      const cluster = (cx, cy, radius = 2, count = 4) => {
        for (let i = 0; i < count; i++) {
          const dx = Phaser.Math.Between(-radius, radius);
          const dy = Phaser.Math.Between(-radius, radius);
          const gx = Phaser.Math.Clamp(cx + dx, 0, TOTAL_W - 1);
          const gy = Phaser.Math.Clamp(cy + dy, 0, TOTAL_H - 1);
          if (world[gy][gx] !== T.GRASS) continue;
          const e = place(this, isoProject, occ, world, gx, gy, 'bush1');
          addEntry(e);
        }
      };
      cluster(Math.floor(grassBorder / 2), Math.floor(grassBorder / 2));
      cluster(TOTAL_W - Math.floor(grassBorder / 2) - 1, Math.floor(grassBorder / 2));
      cluster(Math.floor(grassBorder / 2), TOTAL_H - Math.floor(grassBorder / 2) - 1);
      cluster(TOTAL_W - Math.floor(grassBorder / 2) - 1, TOTAL_H - Math.floor(grassBorder / 2) - 1);
    }




    // ===== Límites de cámara =====
    const tl = isoProject(0, TOTAL_H - 1, this.offX, this.offY);
    const br = isoProject(TOTAL_W - 1, 0, this.offX, this.offY);
    const minX = Math.min(tl.sx, br.sx), maxX = Math.max(tl.sx, br.sx);
    const minY = Math.min(tl.sy, br.sy), maxY = Math.max(tl.sy, br.sy);

    const vw = this.scale.width, vh = this.scale.height, padFit = 80;
    const mapW = maxX - minX, mapH = maxY - minY;
    const zoomX = (vw - padFit * 2) / mapW;
    const zoomY = (vh - padFit * 2) / mapH;
    const zoom  = Math.min(zoomX, zoomY);
    const padWorldX = (vw / zoom) * 0.5;
    const padWorldY = (vh / zoom) * 0.5;
    const padWorld  = Math.max(padWorldX, padWorldY);

    this.cameras.main.setBounds(minX - padWorld, minY - padWorld, mapW + padWorld * 2, mapH + padWorld * 2);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2);

    // ===== Clima demo =====
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: { x: -9999, y: -9999, w: 9999, h: 9999 }
    });

    // ===== Inputs =====
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    // HUD breve
    this.add.text(16, 8,
      'ISO 256×128 — Arar (A) / Riega (R) / Cosecha (C) — Click bloque para seleccionar',
      { fontFamily:'ui-sans-serif, system-ui, sans-serif', fontSize:'14px', color:'#e2e8f0' }
    ).setScrollFactor(0);

    // Pan/Zoom
    this.input.mouse.disableContextMenu();
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 2.5));
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

    // Bridge UI → GameScene (acciones por evento)
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

    // datos para el panel
    const p = repoGet('parcelas', parcela.id);
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo === 'AGUA');

    this.game.events.emit('inspect:parcela', {
      id: p?.id,
      saludSuelo: p?.saludSuelo?.toFixed(2),
      cultivo: c ? { tipo: c.tipo, etapa: c.etapa, progreso: c.progreso.toFixed(2) } : null,
      agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null
    });

    // Dibuja de inmediato el contorno del BLOQUE 9×9 completo
    this.drawBlockSelector(blockId);
  }


  drawBlockSelector(blockId){
    const parcela = this.parcelaByBlockId.get(blockId);
    if (!parcela) return;

    const g = this.selector || (this.selector = this.add.graphics());
    g.clear().lineStyle(2, 0x60a5fa, 1);

    const x0 = parcela.x, y0 = parcela.y;           // en coords mundo (grid)
    const w  = parcela.w, h  = parcela.h;

    // esquinas del bloque (grid → pantalla)
    const a = isoProject(x0,     y0,     this.offX, this.offY); // top
    const b = isoProject(x0+w,   y0,     this.offX, this.offY); // right
    const c = isoProject(x0+w,   y0+h,   this.offX, this.offY); // bottom
    const d = isoProject(x0,     y0+h,   this.offX, this.offY); // left

    const sy = Math.max(a.sy, b.sy, c.sy, d.sy);
    g.setDepth(sy + 9999);

    const pts = [{x:a.sx,y:a.sy},{x:b.sx,y:b.sy},{x:c.sx,y:c.sy},{x:d.sx,y:d.sy}];
    g.strokePoints(pts, true);
    g.fillStyle(0x60a5fa, 0.06).fillPoints(pts, true);
  }


// === Mostrar el cultivo con emoji según su etapa ===
showCultivoSprite(parcelaId, tipoCultivo, etapa) {
  const blockId = this.blockIdByParcelaId.get(parcelaId);
  if (!blockId) return;

  // Si ya hay un emoji previo, eliminarlo
  if (!this.cultivoSprites) this.cultivoSprites = new Map();
  const existente = this.cultivoSprites.get(parcelaId);
  if (existente) existente.destroy();

  // Elegir emoji según etapa
  let emoji = '🌱'; // semilla
  if (etapa === 'BROTE') emoji = '🌿';
  else if (etapa === 'CRECIMIENTO') emoji = '🌾';
  else if (etapa === 'MADURO') emoji = '🌻';
  else if (etapa === 'COSECHA') emoji = '🧺';
  else if (etapa === 'MUERTO') emoji = '🥀';

  // Obtener posición del bloque
  const pos = this.blockPositions.get(blockId);
  if (!pos) return;

  // Crear el texto (emoji)
  const emojiText = this.add.text(pos.x, pos.y, emoji, {
    fontSize: '28px',
    fontFamily: 'Arial',
  }).setOrigin(0.5);

  // Guardar referencia
  this.cultivoSprites.set(parcelaId, emojiText);
}



  // === Acciones aplicadas al BLOQUE seleccionado ===


plowSelected() {
  if (!this.selectedParcelaId) return;
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  if (p.arada) { 
    this.game.events.emit('toast', {type:'info', msg:`${p.id} ya está arada.`}); 
    return; 
  }
  
  p.arada = true;
  applyBlockVisual(this, p.id);
  this.game.events.emit('toast', { type:'ok', msg:`Araste ${p.id}.` });
  
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
    this.game.events.emit('toast', { type:'warn', msg:'Fondos insuficientes (10).' });
    return;
  }

  const agua = (p.recursos||[])
    .map(rid => repoGet('recursos', rid))
    .find(r => r && r.tipo === 'AGUA');

  if (!agua) { 
    this.game.events.emit('toast', {type:'warn', msg:`La parcela ${p.id} no tiene AGUA.`}); 
    return; 
  }

  agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);

  const WET_DURATION = 1200;
  p.wetUntil = (p.wetUntil && State.clock < p.wetUntil)
    ? p.wetUntil + Math.floor(WET_DURATION*0.5)
    : State.clock + WET_DURATION;

  applyBlockVisual(this, p.id);
  this.game.events.emit('toast', { type:'ok', msg:`Riego aplicado a ${p.id}.` });

  repoAll('alertas').forEach(a => { if (a.parcelaId === p.id) a.visible = false; });
  const blockId = this.blockIdByParcelaId.get(p.id);
  if (blockId) this.drawBlockSelector(blockId);
}

harvestSelected() {
  if (!this.selectedParcelaId) return;
  const p = repoGet('parcelas', this.selectedParcelaId);
  const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
  const player = findFirstPlayer();
  
  if (!c) {
    this.game.events.emit('toast', { type:'warn', msg:'No hay cultivo en esta parcela.' });
    return;
  }

  // Verificar si está listo para cosechar
  if (!isCultivoListo(c.id)) {
    const progresoPct = (c.progreso * 100).toFixed(0);
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:`${c.tipo} no está listo. Progreso: ${progresoPct}%` 
    });
    return;
  }

  // Obtener configuración del cultivo
  const config = CROP_CONFIG[c.tipo];
  if (!config) {
    this.game.events.emit('toast', { type:'warn', msg:'Cultivo desconocido.' });
    return;
  }

  // Calcular ganancia según salud del cultivo
  let ganancia = config.precioVenta;
  
  // Bonus/penalización por salud (0-100%)
  if (c.saludActual !== undefined) {
    ganancia = Math.floor(ganancia * c.saludActual);
  }

  player.cartera += ganancia;

  // Eliminar cultivo y liberar parcela
  State.repos.cultivos.delete(c.id);
  p.cultivoId = null;

  this.game.events.emit('toast', { 
    type:'ok', 
    msg:`Cosechado ${config.nombre}: +${ganancia}` 
  });

  const blockId = this.blockIdByParcelaId.get(p.id);
  if (blockId) this.drawBlockSelector(blockId);
}

async plantSelected() {
  if (!this.selectedParcelaId) {
    this.game.events.emit('toast', { type:'warn', msg:'Selecciona una parcela primero.' });
    return;
  }
  
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  // Verificar que esté arada
  if (!p.arada) {
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:'Debes arar la tierra primero (A).' 
    });
    return;
  }

  // Verificar que no tenga cultivo
  if (p.cultivoId) {
    const c = repoGet('cultivos', p.cultivoId);
    this.game.events.emit('toast', { 
      type:'info', 
      msg:`${p.id} ya tiene ${c?.tipo || 'cultivo'}.` 
    });
    return;
  }

  // Abrir menú de selección de semillas
  this.openSeedMenu(p.id);
}

// Nueva función: Menú de selección de semillas
openSeedMenu(parcelaId) {
  // Por ahora, lista los cultivos disponibles en un toast
  const opciones = Object.keys(CROP_CONFIG).map((key, index) => {
    const cfg = CROP_CONFIG[key];
    return `${index + 1}. ${cfg.nombre} ($${cfg.costoSemilla})`;
  }).join('\n');

  // TODO: Crear UI modal para seleccionar
  // Por ahora, siembra MAIZ automáticamente
  this.sembrarCultivo(parcelaId, 'MAIZ');
  
  // Mostrar opciones disponibles
  this.game.events.emit('toast', { 
    type:'info', 
    msg:`Cultivos disponibles:\n${opciones}` 
  });
}

// Nueva función: Sembrar un cultivo específico
sembrarCultivo(parcelaId, tipoCultivo) {
  const p = repoGet('parcelas', parcelaId);
  if (!p) return;

  const config = CROP_CONFIG[tipoCultivo];
  if (!config) {
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:`Cultivo ${tipoCultivo} no existe.` 
    });
    return;
  }

  const player = findFirstPlayer();
  if (!spend(player, config.costoSemilla)) {
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:`Fondos insuficientes ($${config.costoSemilla}).` 
    });
    return;
  }

  // Crear cultivo con configuración completa
  const cultivo = Factory.createCultivo({
    tipo: tipoCultivo,
    etapa: 'SEMILLA',
    progreso: 0,
    consumoAgua: config.consumoAgua,
    resistenciaPlagas: config.resistenciaPlagas,
    saludActual: 1.0
  });
  
  p.cultivoId = cultivo.id;

// 👇 Mostrar emoji de cultivo recién sembrado
this.showCultivoSprite(p.id, tipoCultivo, cultivo.etapa);

this.game.events.emit('toast', { 
  type:'ok', 
  msg:`Sembraste ${config.nombre} en ${p.id}.` 
});
  

  this.game.events.emit('toast', { 
    type:'ok', 
    msg:`Sembraste ${config.nombre} en ${p.id}.` 
  });

  const blockId = this.blockIdByParcelaId.get(p.id);
  if (blockId) this.drawBlockSelector(blockId);
}

openTechTree() {
  // TODO: Abrir modal de mejoras
  this.game.events.emit('toast', { 
    type:'ok', 
    msg:'Tech Tree (WIP): Riego por goteo, sensores, energía solar…' 
  });
}

scanRegion() {
  if (!this.selectedParcelaId) {
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:'Selecciona una parcela para escanear.' 
    });
    return;
  }
  
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  const agua = (p.recursos||[])
    .map(rid => repoGet('recursos', rid))
    .find(r => r?.tipo==='AGUA');
  
  const smapRZSM = Number(agua?.nivel ?? 0);
  const ndvi     = Number(p.saludSuelo ?? 0.5);
  const heat     = Phaser.Math.Clamp(Math.random()*0.6, 0, 1);

  const msg =
    `🛰️ Scan NASA\n` +
    `• SMAP (RZSM): ${(smapRZSM*100).toFixed(0)}%\n` +
    `• NDVI (salud): ${(ndvi*100).toFixed(0)}%\n` +
    `• Heat stress: ${(heat*100).toFixed(0)}%`;
  
  this.game.events.emit('toast', { type:'ok', msg });
}

sellHarvest() {
  let total = 0;
  let conteo = 0;
  
  for (const p of repoAll('parcelas')) {
    if (!p.cultivoId) continue;
    
    const c = repoGet('cultivos', p.cultivoId);
    if (!c) continue;

    // Verificar si está listo
    if (isCultivoListo(c.id)) {
      const config = CROP_CONFIG[c.tipo];
      if (!config) continue;

      // Calcular ganancia con salud
      let ganancia = config.precioVenta;
      if (c.saludActual !== undefined) {
        ganancia = Math.floor(ganancia * c.saludActual);
      }

      total += ganancia;
      conteo++;

      // Eliminar cultivo
      State.repos.cultivos.delete(c.id);
      p.cultivoId = null;
    }
  }

  const player = findFirstPlayer();
  if (total > 0) {
    player.cartera = (player.cartera || 0) + total;
    this.game.events.emit('toast', { 
      type:'ok', 
      msg:`Venta realizada: ${conteo} cosechas = +${total}` 
    });
  } else {
    this.game.events.emit('toast', { 
      type:'warn', 
      msg:'No hay cosechas listas.' 
    });
  }
}
  

  update(_, delta) {
    // 1) Ajusta overlay al viewport de la cámara (independiente de zoom/scroll)
    if (this.ambient) {
      const cam = this.cameras.main;
      // worldView ya viene compensado por zoom y scroll
      this.ambient.setPosition(cam.worldView.x, cam.worldView.y);
      this.ambient.setSize(cam.worldView.width, cam.worldView.height);
    }

    // 2) Día/tarde/noche + sombras
    this.tickDayNight(delta);

    // 3) Cooldowns
    const dec = delta;
    for (const k in this._cooldowns) {
      this._cooldowns[k] = Math.max(0, (this._cooldowns[k] || 0) - dec);
    }

    // 4) Cámara (wasd/flechas)
    const cam = this.cameras.main;
    const dt = delta / 1000;
    const v = this.camSpeed / cam.zoom;
    if (this.cursors?.left.isDown)  cam.scrollX -= v * dt;
    if (this.cursors?.right.isDown) cam.scrollX += v * dt;
    if (this.cursors?.up.isDown)    cam.scrollY -= v * dt;
    if (this.cursors?.down.isDown)  cam.scrollY += v * dt;

    // 5) Atajos
    if (Phaser.Input.Keyboard.JustDown(this.keyA)) this.plowSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.waterSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.harvestSelected();

    // 6) Simulación
    State.clock += 1;
    tickSim(delta);
    tickClimate(); tickCrops(); tickPlagues(); tickAlerts();

    // 7) Secado periódico
    if ((State.clock % 15) === 0) {
      for (const p of repoAll('parcelas')) {
        if (p.wetUntil && State.clock >= p.wetUntil) {
          p.wetUntil = 0;
          applyBlockVisual(this, p.id);
        }
      }
    }
  }

  tickDayNight(delta) {
    // ===== Avanza el tiempo 0..1
    this.timeOfDay = (this.timeOfDay + delta / this.dayLengthMs) % 1;

    // ===== Fases (tu lógica)
    const t = this.timeOfDay;
    let ambient = 0.0;  // 0 = claro, 1 = oscuro
    let sunAlt  = 0.0;  // 0 = bajo (sombras largas), 1 = alto (cortas)
    let sunAzim = 0.0;  // 0=este→, 0.5=oeste←

    if (t < 0.15) {                // amanecer
      const u = smoothstep(t / 0.15);
      ambient = 0.85 - 0.55*u;
      sunAlt  = 0.15 + 0.65*u;
      sunAzim = 0.15;
    } else if (t < 0.75) {         // día
      const u = (t - 0.15) / 0.60;
      ambient = 0.30 - 0.10*Math.cos(Math.PI*u);
      sunAlt  = 0.80 + 0.15*Math.cos(Math.PI*u);
      sunAzim = 0.25 + 0.50*u;
    } else if (t < 0.90) {         // atardecer
      const u = smoothstep((t - 0.75) / 0.15);
      ambient = 0.30 + 0.40*u;
      sunAlt  = 0.60 - 0.45*u;
      sunAzim = 0.75;
    } else {                       // noche
      const u = (t - 0.90) / 0.10;
      ambient = 0.70 + 0.20*u;
      sunAlt  = 0.10;
      sunAzim = 0.75;
    }

    // ===== Dirección del sol (pantalla isométrica)
    const angle = sunAzim * Math.PI;
    const dirX  = Math.cos(angle);
    const dirY  = Math.sin(angle) * 0.6; // iso

    // ===== Geometría/alpha de sombras según altura del sol
    const sunK   = Phaser.Math.Clamp(sunAlt, 0, 1);
    const len    = Phaser.Math.Linear(1.8, 0.6, sunK);  // más largas con sol bajo
    const alphaK = Phaser.Math.Linear(1.2, 0.6, sunK); // más opacas con sol bajo
    const squish = Phaser.Math.Linear(1.0, 0.75, sunK); // más aplastadas con sol alto
    const blurK  = Phaser.Math.Linear(1.4, 0.9, sunK); // más anchas (difusas) con sol bajo

    // ===== Tinte ambiental (interpolación suave)
    if (this.ambient) {
      const clamp01 = (v) => Phaser.Math.Clamp(v, 0, 1);
      const a = clamp01(ambient);

      const COL_DAY   = 0xffffff;
      const COL_DAWN  = 0xffc288; // naranja suave
      const COL_DUSK  = 0xff9a3c; // naranja intenso
      const COL_NIGHT = 0x0a0f3a; // azul noche

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

      if (t < 0.15) {                   // noche → amanecer
        const k = smooth(t / 0.15);
        color = lerpColor(COL_NIGHT, COL_DAWN, k);
        alpha = Phaser.Math.Linear(0.65, 0.10, k);
      } else if (t < 0.50) {            // amanecer → día
        const k = smooth((t - 0.15) / 0.35);
        color = lerpColor(COL_DAWN, COL_DAY, k);
        alpha = Phaser.Math.Linear(0.10, 0.00, k);
      } else if (t < 0.75) {            // día → atardecer
        const k = smooth((t - 0.50) / 0.25);
        color = lerpColor(COL_DAY, COL_DUSK, k);
        alpha = Phaser.Math.Linear(0.00, 0.28, k);
      } else {                          // atardecer → noche
        const k = smooth((t - 0.75) / 0.25);
        color = lerpColor(COL_DUSK, COL_NIGHT, k);
        alpha = Phaser.Math.Linear(0.28, 0.65, k);
      }

      this.ambient.setFillStyle(color, Phaser.Math.Clamp(alpha, 0, 1));
    }

    // ===== Actualiza TODAS las sombras de decor
    if (this.decorEntries && this.decorEntries.length) {

      // luz “directa” (casi 0 de noche; sube al amanecer)
      // pone 0 cuando el sol está muy bajo
      const sunK   = Phaser.Math.Clamp(sunAlt, 0, 1);
      const lightK = Phaser.Math.Clamp((sunAlt - 0.12) / 0.28, 0, 1); // 0 si sol < ~0.12, 1 desde ~0.40
      const len    = Phaser.Math.Linear(1.8, 0.6, sunK);
      const alphaK = Phaser.Math.Linear(1.15, 0.55, sunK);
      const squish = Phaser.Math.Linear(1.0, 0.75, sunK);
      const blurK  = Phaser.Math.Linear(1.35, 0.95, sunK);

      const angle = sunAzim * Math.PI;
      const dirX  = Math.cos(angle);
      const dirY  = Math.sin(angle) * 0.6; // iso

      for (const e of this.decorEntries) {
        if (!e?.sprite || !e?.shadow) continue;

        const base = e.shadow.getData('shadowBase') || { dx:0, dy:0, w:e.shadow.width, h:e.shadow.height, alpha:0.25 };
        const name = e.sprite.getData('decor')?.name || '';
        const isBuilding = (name === 'barn' || name === 'silo');

        // --- POSICIÓN ---
        // X siempre acompaña la dirección del sol
        const sx = e.sprite.x + (base.dx * len * dirX);

        // Y: para edificios, pegamos la sombra al borde inferior del sprite
        // (origin 0.5,1 => sprite.y ya es la base); reducimos el “rebote”.
        const sy = isBuilding
          ? (e.sprite.y - 1 + base.dy * 0.2)                 // pegue al piso
          : (e.sprite.y + (base.dy * len * (0.6 + 0.4*dirY)));

        e.shadow.setPosition(sx, sy);

        // --- TAMAÑO (difuso al amanecer/atardecer)
        const widen   = isBuilding ? 1.30 : 1.00;
        const flatten = isBuilding ? 0.90 : 1.00;

        e.shadow.setDisplaySize(
          base.w * len * blurK * widen,
          base.h * squish * blurK * flatten
        );

        // --- OPACIDAD ---
        // De noche (lightK≈0) casi desaparece; de día vuelve.
        // Edificios un pelín más marcada para “anclar” visualmente.
        const baseA   = base.alpha ?? 0.25;
        const anchorA = isBuilding ? 1.05 : 1.00;
        const nightFade = lightK * lightK; // caída más rápida al anochecer

        e.shadow.setAlpha(baseA * alphaK * anchorA * nightFade);
      }
    }

  }


}
