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

// === Proyección ISO 2:1 ===
const PROJ_W = 256;
const PROJ_H = 128;

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
  }

  create() {
    startLevel(0);
    if (this.input?.setTopOnly) this.input.setTopOnly(true);
    Factory.createPlayer({ name: 'AgroPro', cartera: 200 });
    Factory.createTienda();

    // ==== Texturas ====
    const grassKeys  = ['Acid2'];
    const soilKey    = 'Lava1';
    const pathKeys   = ['Ground2','Ground3','Ground4'];
    const pick = arr => arr[(Math.random() * arr.length) | 0];

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

    // ======= DECOR: granero, silo, árboles, rocas, arbustos, tractor =======
    // matriz de ocupación para evitar solapamientos de footprints
    const occ = makeOcc(TOTAL_W, TOTAL_H);

    // --- GRANERO (512x256, footprint 2x2) en la franja de pasto izquierda ---
    {
      const gx = Math.max(0, Math.floor(grassBorder / 2));
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2));
      place(this, isoProject, occ, world, gx, gy, 'barn',   { projW: PROJ_W });
    }

    // --- SILO (380x760, footprint 2x2) en pasto derecha ---
    {
      const gx = Math.min(TOTAL_W - 2, TOTAL_W - Math.ceil(grassBorder / 2) - 2);
      const gy = Math.max(0, Math.floor((TOTAL_H - 2) / 2) - 2);
      place(this, isoProject, occ, world, gx, gy, 'silo',   { projW: PROJ_W });
    }

    // --- TRACTOR (1x1) cerca de la primera parcela ---
    {
      const block = (blocks && blocks[0]) ? blocks[0] : null;
      const gx = block ? (grassBorder + block.x0 + block.w - 1) : (FARM_MIN_X + 1);
      const gy = block ? (grassBorder + block.y0 + 1)             : (FARM_MIN_Y + 1);
      place(this, isoProject, occ, world, gx, gy, 'tractor',{ projW: PROJ_W });
    }

    // --- Árboles (1x1) al borde superior e inferior del pasto ---
    {
      const tryPlaceTreeRow = (gyRow) => {
        for (let gx = 1; gx < TOTAL_W - 1; gx += 4) {
          if (world[gyRow][gx] === T.GRASS) {
            place(this, isoProject, occ, world, gx, gyRow, 'tree');
          }
        }
      };
      tryPlaceTreeRow(FARM_MIN_Y - 2 >= 0 ? FARM_MIN_Y - 2 : 0);
      tryPlaceTreeRow(Math.min(TOTAL_H - 1, FARM_MAX_Y + 2));
    }

    // --- Rocas sueltas en el pasto ---
    {
      const tries = 25;
      for (let i = 0; i < tries; i++) {
        const gx = Phaser.Math.Between(1, TOTAL_W - 2);
        const gy = Phaser.Math.Between(1, TOTAL_H - 2);
        if (world[gy][gx] !== T.GRASS) continue;
        const name = (Math.random() < 0.5) ? 'rock1' : 'rock2';
        if (place(this, isoProject, occ, world, gx, gy, name)) {
          occupyRect(occ, gx - 1, gy - 1, 3, 3); // dejar aire
        }
      }
    }

    // --- Arbustos en pequeños grupos (pastos esquinas) ---
    {
      const cluster = (cx, cy, radius = 2, count = 4) => {
        for (let i = 0; i < count; i++) {
          const dx = Phaser.Math.Between(-radius, radius);
          const dy = Phaser.Math.Between(-radius, radius);
          const gx = Phaser.Math.Clamp(cx + dx, 0, TOTAL_W - 1);
          const gy = Phaser.Math.Clamp(cy + dy, 0, TOTAL_H - 1);
          if (world[gy][gx] !== T.GRASS) continue;
          place(this, isoProject, occ, world, gx, gy, 'bush1');
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

  // === Acciones aplicadas al BLOQUE seleccionado ===
  plowSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    if (p.arada) { this.game.events.emit('toast',{type:'info', msg:`${p.id} ya está arada.`}); return; }
    p.arada = true;
    applyBlockVisual(this, p.id);
    this.game.events.emit('toast', { type:'ok', msg:`Araste ${p.id}.` });
    // redibuja selector
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

    if (!agua) { this.game.events.emit('toast',{type:'warn',msg:`La parcela ${p.id} no tiene AGUA.`}); return; }

    agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);

    const WET_DURATION = 1200;
    p.wetUntil = (p.wetUntil && State.clock < p.wetUntil)
      ? p.wetUntil + Math.floor(WET_DURATION*0.5)
      : State.clock + WET_DURATION;

    applyBlockVisual(this, p.id);
    this.game.events.emit('toast', { type:'ok', msg:`Riego aplicado a ${p.id}.` });

    // limpia alertas y refresca panel
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
      this.game.events.emit('toast', { type:'ok', msg:`Cosechado ${c.tipo} en ${p.id}. +30` });
      const blockId = this.blockIdByParcelaId.get(p.id);
      if (blockId) this.drawBlockSelector(blockId);
    } else {
      this.game.events.emit('toast', { type:'warn', msg:'Aún no está listo.' });
    }
  }

  async plantSelected() {
    if (!this.selectedParcelaId) {
      this.game.events.emit('toast', { type:'warn', msg:'Selecciona una parcela primero.' });
      return;
    }
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    if (p.cultivoId) {
      const c = repoGet('cultivos', p.cultivoId);
      this.game.events.emit('toast', { type:'info', msg:`${p.id} ya tiene ${c?.tipo || 'cultivo'}.` });
      return;
    }

    const player = findFirstPlayer();
    if (!spend(player, 15)) {
      this.game.events.emit('toast', { type:'warn', msg:'Fondos insuficientes (15).' });
      return;
    }

    const cultivo = Factory.createCultivo({
      tipo: 'MAIZ',
      etapa: 'SIEMBRA',
      progreso: 0,
      consumoAgua: 1.0
    });
    p.cultivoId = cultivo.id;

    this.game.events.emit('toast', { type:'ok', msg:`Sembraste ${cultivo.tipo} en ${p.id}.` });
    const blockId = this.blockIdByParcelaId.get(p.id);
    if (blockId) this.drawBlockSelector(blockId);
  }

  openTechTree() {
    this.game.events.emit('toast', { type:'ok', msg:'Tech Tree (WIP): Riego por goteo, sensores, energía solar…' });
  }

  scanRegion() {
    if (!this.selectedParcelaId) {
      this.game.events.emit('toast', { type:'warn', msg:'Selecciona una parcela para escanear.' });
      return;
    }
    const p = repoGet('parcelas', this.selectedParcelaId);
    if (!p) return;

    const agua = (p.recursos||[]).map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
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
      this.game.events.emit('toast', { type:'ok', msg:`Venta realizada: +${total}` });
    } else {
      this.game.events.emit('toast', { type:'warn', msg:'No hay cosechas listas.' });
    }
  }

  update(_, delta) {
    // cooldowns
    const dec = delta;
    for (const k in this._cooldowns) this._cooldowns[k] = Math.max(0, (this._cooldowns[k] || 0) - dec);

    const cam = this.cameras.main;
    const dt = delta / 1000;
    const v = this.camSpeed / cam.zoom;

    if (this.cursors?.left.isDown)  cam.scrollX -= v * dt;
    if (this.cursors?.right.isDown) cam.scrollX += v * dt;
    if (this.cursors?.up.isDown)    cam.scrollY -= v * dt;
    if (this.cursors?.down.isDown)  cam.scrollY += v * dt;

    if (Phaser.Input.Keyboard.JustDown(this.keyA)) this.plowSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.waterSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.harvestSelected();

    State.clock += 1;
    tickSim(delta);
    tickClimate(); tickCrops(); tickPlagues(); tickAlerts();

    // secado periódico
    if ((State.clock % 15) === 0) {
      for (const p of repoAll('parcelas')) {
        if (p.wetUntil && State.clock >= p.wetUntil) {
          p.wetUntil = 0;
          applyBlockVisual(this, p.id);
        }
      }
    }
  }
}
