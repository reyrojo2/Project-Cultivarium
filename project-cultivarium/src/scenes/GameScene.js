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

// === Rombos perfectos 2:1 ===
const PROJ_W = 256;
const PROJ_H = 128;

function isoProject(gx, gy, offX, offY) {
  return {
    sx: Math.round(offX + (gx - gy) * (PROJ_W / 2)),
    sy: Math.round(offY + (gx + gy) * (PROJ_H / 2))
  };
}

// === Diamond por "aplanado desde arriba": escanea filas, toma top/bottom y fila de mayor ancho ===
const TOP_FACE_CACHE = new Map();

function measureDiamondFromTop(scene, texKey, alphaThr = 180) {
  if (TOP_FACE_CACHE.has(texKey)) return TOP_FACE_CACHE.get(texKey);

  const img = scene.textures.get(texKey).getSourceImage();
  const w = img.width, h = img.height;

  // volcamos a canvas y leemos alpha
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, w, h).data;
  const alphaAt = (x, y) => data[(y*w + x)*4 + 3];

  // por fila: minX / maxX de pix visibles
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

  // y_top: primera fila con píxel; y_bot: última
  let yTop = 0; while (yTop < h && minX[yTop] === +Infinity) yTop++;
  let yBot = h-1; while (yBot >= 0 && minX[yBot] === +Infinity) yBot--;
  if (yTop >= yBot) {
    // fallback sano
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

  // yCent: fila con mayor ancho (ancho = maxX-minX+1)
  let yCent = yTop, bestW = -1;
  for (let y=yTop; y<=yBot; y++) {
    if (minX[y] !== +Infinity) {
      const width = (maxX[y] - minX[y] + 1);
      if (width > bestW) { bestW = width; yCent = y; }
    }
  }

  // centro geométrico del rombo: cx en mitad del ancho máximo; cy mitad entre top y bottom
  const cxMax = (minX[yCent] + maxX[yCent]) / 2;
  const cy = (yTop + yBot) / 2;

  const halfW = bestW / 2;
  const halfH = (yBot - yTop) / 2;

  // vertices del rombo en coordenadas de textura (px)
  const topPt    = { x: cxMax, y: yTop };
  const rightPt  = { x: cxMax + halfW, y: cy };
  const bottomPt = { x: cxMax, y: yBot };
  const leftPt   = { x: cxMax - halfW, y: cy };

  // pasa a coords locales del sprite (origen 0.5,0.5 → centro)
  const toLocal = (p) => new Phaser.Geom.Point(p.x - w/2, p.y - h/2);
  const polyLocal = new Phaser.Geom.Polygon([
    toLocal(topPt), toLocal(rightPt), toLocal(bottomPt), toLocal(leftPt)
  ]);

  const res = { halfW, halfH, center: { x: cxMax, y: cy }, polyLocal };
  TOP_FACE_CACHE.set(texKey, res);
  return res;
}


function addIsoTile(scene, key, gx, gy, offX, offY) {
  const sx = Math.round(offX + (gx - gy) * 128);
  const sy = Math.round(offY + (gx + gy) * 64);

  const img = scene.add.image(sx, sy, key).setOrigin(0.5, 0.5);
  img.setDepth(sy + gy * 0.001);

  // polígono exacto por "aplanado desde arriba"
  const { polyLocal } = measureDiamondFromTop(scene, key, 180);

  // inset suave para no tocar la orilla (ajusta a gusto)
  const INSET_X = 8, INSET_Y = 4;
  const insetPoly = new Phaser.Geom.Polygon(
    polyLocal.points.map(p => new Phaser.Geom.Point(
      Math.sign(p.x) * Math.max(0, Math.abs(p.x) - INSET_X),
      Math.sign(p.y) * Math.max(0, Math.abs(p.y) - INSET_Y)
    ))
  );

  img.setInteractive(insetPoly, Phaser.Geom.Polygon.Contains);
  img.setData('texKey', key);
  img.setData('topPoly', insetPoly); // guardamos para el selector
  return img;
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
    this.spriteByParcela = new Map();
    this.keyA = null;  
  }

  create() {
        // Activa que solo el objeto “más arriba” reciba el click
    if (this.input?.setTopOnly) this.input.setTopOnly(true);
    Factory.createPlayer({ name: 'AgroPro', cartera: 200 });
    Factory.createTienda();

    // === Mapa (más grande si quieres) ===
    const FARM_COLS = 18;
    const FARM_ROWS = 10;
    const BORDER = 2;

    // centro del mapa
    const offX = this.scale.width / 2;
    const offY = 140;
    this.offX = offX; this.offY = offY;
    

    const pick = arr => arr[(Math.random() * arr.length) | 0];
    const grassKeys  = ['Acid1','Acid2'];
    const parcelKeys = ['Lava1','Lava3']; // Lava3 = arada

    const TOTAL_COLS = FARM_COLS + BORDER*2;
    const TOTAL_ROWS = FARM_ROWS + BORDER*2;
    const FARM_MIN_X = BORDER, FARM_MIN_Y = BORDER;
    const FARM_MAX_X = BORDER+FARM_COLS-1, FARM_MAX_Y = BORDER+FARM_ROWS-1;

    for (let gy=0; gy<TOTAL_ROWS; gy++) {
      for (let gx=0; gx<TOTAL_COLS; gx++) {
        const isFarm = gx>=FARM_MIN_X && gx<=FARM_MAX_X && gy>=FARM_MIN_Y && gy<=FARM_MAX_Y;

        const key = isFarm ? 'Lava1' : pick(grassKeys);   // 👈 SIEMPRE Lava1 al inicio
        const tile = addIsoTile(this, key, gx, gy, offX, offY);

        if (isFarm) {
          const recAgua = Factory.createRecurso({ tipo: 'AGUA', nivel: 0.8 });
          const cultivo = Factory.createCultivo({ tipo: (gx+gy)%3===0 ? 'MAIZ' : 'TRIGO' });
          const parcela = Factory.createParcela({
            x: gx, y: gy, w: PROJ_W, h: PROJ_H,
            recursos: [recAgua.id], cultivoId: cultivo.id, saludSuelo: 0.8,
            arada: false                                      // 👈 flag opcional
          });

          this.spriteByParcela.set(parcela.id, tile);        // 👈 guarda sprite
          tile.on('pointerdown', () => this.selectParcela(parcela.id));
        }
      }
    }

    // Límites de cámara basados en el rombo total
    const tl = isoProject(0, TOTAL_ROWS-1, offX, offY);
    const br = isoProject(TOTAL_COLS-1, 0, offX, offY);
    const pad = 250;
    this.cameras.main.setBounds(
      Math.min(tl.sx, br.sx) - pad,
      Math.min(tl.sy, br.sy) - pad,
      Math.abs(br.sx - tl.sx) + pad*2,
      Math.abs(br.sy - tl.sy) + pad*2
    );
    this.cameras.main.setZoom(0.5);

    // Evento clima demo
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: { x: -9999, y: -9999, w: 9999, h: 9999 }
    });

    // Inputs
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    // HUD
    this.add.text(16, 8,
      'ISO 256×128 — Arar (A) / Riega (R) / Cosecha (C) — Click parcela para seleccionar',
      { fontFamily:'ui-sans-serif, system-ui, sans-serif', fontSize:'14px', color:'#e2e8f0' }
    ).setScrollFactor(0);

    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    // Pan/Zoom
    this.input.mouse.disableContextMenu();
    this.input.on('wheel', (_p,_o,_dx,dy) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy>0 ? 0.9 : 1.1), 0.3, 2.5));
    });
    let dragging=false, last={x:0,y:0};
    this.input.on('pointerdown', p=>{ if(p.rightButtonDown()){ dragging=true; last={x:p.x,y:p.y}; }});
    this.input.on('pointerup', ()=> dragging=false);
    this.input.on('pointermove', p=>{
      if(!dragging) return;
      const cam=this.cameras.main;
      cam.scrollX -= (p.x-last.x)/cam.zoom;
      cam.scrollY -= (p.y-last.y)/cam.zoom;
      last={x:p.x,y:p.y};
    });
  }

selectParcela(id){
  this.selectedParcelaId = id;
  const p = repoGet('parcelas', id);
  const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
  const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');

  this.game.events.emit('inspect:parcela', {
    id: p?.id, saludSuelo: p?.saludSuelo?.toFixed(2),
    cultivo: c ? { tipo: c.tipo, etapa: c.etapa, progreso: c.progreso.toFixed(2) } : null,
    agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null
  });

  const sprite = this.spriteByParcela.get(id);          // 👈
  this.drawSelector(p.x, p.y, sprite);                  // 👈 pasa el sprite
}

drawSelector(_gx, _gy, sprite){
  const SEL_Y_SCALE = 0.5;
  const g = this.selector || (this.selector = this.add.graphics());
  g.clear().lineStyle(2, 0x60a5fa, 1);

  if (sprite) {
    const poly = sprite.getData('topPoly');
    if (poly) {
      const sx = sprite.x, sy = sprite.y;
      const sxScale = sprite.scaleX ?? 1;
      const syScale = sprite.scaleY ?? 1;

      // y local más alto (punta superior del rombo)
      let topLocalY = Infinity;
      for (const p of poly.points) if (p.y < topLocalY) topLocalY = p.y;

      // escalamos hacia la punta: y' = top + (y - top) * scale
      const pts = poly.points.map(p => ({
        x: sx + p.x * sxScale,
        y: sy + (topLocalY + (p.y - topLocalY) * SEL_Y_SCALE) * syScale
      }));

      g.setDepth(sy + 9999).strokePoints(pts, true);
      return;
    }
  }
  // fallback (solo si no hay sprite)
  const { sx, sy } = isoProject(_gx, _gy, this.offX, this.offY);
  const halfW = PROJ_W/2, halfH = PROJ_H/2;
  g.setDepth(sy + 9999).strokePoints(
    [{x:sx, y:sy-halfH}, {x:sx+halfW, y:sy}, {x:sx, y:sy+halfH}, {x:sx-halfW, y:sy}],
    true
  );
}


plowSelected() {
  if (!this.selectedParcelaId) return;
  const p = repoGet('parcelas', this.selectedParcelaId);
  const sprite = this.spriteByParcela.get(p.id);
  if (!sprite) return;

  if (p.arada) { this.game.events.emit('toast',{type:'info', msg:`${p.id} ya está arada.`}); return; }

  sprite.setTexture('Lava3');
  sprite.setData('texKey', 'Lava3');

  const { polyLocal } = measureDiamondFromTop(this, 'Lava3', 180);
  const INSET_X = 8, INSET_Y = 4;
  const insetPoly = new Phaser.Geom.Polygon(
    polyLocal.points.map(p => new Phaser.Geom.Point(
      Math.sign(p.x) * Math.max(0, Math.abs(p.x) - INSET_X),
      Math.sign(p.y) * Math.max(0, Math.abs(p.y) - INSET_Y)
    ))
  );

  sprite.setData('topPoly', insetPoly);
  sprite.setInteractive(insetPoly, Phaser.Geom.Polygon.Contains);

  p.arada = true;
  this.game.events.emit('toast', { type:'ok', msg:`Araste ${p.id}.` });

  this.drawSelector(p.x, p.y, sprite); // siempre con sprite
}


  waterSelected(){
    if(!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    const player = findFirstPlayer();
    if(!spend(player, 10)){
      this.game.events.emit('toast', { type:'warn', msg:'Fondos insuficientes (10).' }); return;
    }
    const agua = p.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
    if(agua){
      agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);
      this.game.events.emit('toast', { type:'ok', msg:`Riego aplicado a ${p.id}.` });
      repoAll('alertas').forEach(a => { if(a.parcelaId===p.id) a.visible=false; });
      this.selectParcela(p.id);
    }
  }

  harvestSelected(){
    if(!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const player = findFirstPlayer();
    if(c?.etapa==='COSECHA' && c.progreso>=1){
      player.cartera += 30;
      c.etapa='SIEMBRA'; c.progreso=0;
      this.game.events.emit('toast', { type:'ok', msg:`Cosechado ${c.tipo} en ${p.id}. +30` });
      this.selectParcela(p.id);
    } else {
      this.game.events.emit('toast', { type:'warn', msg:'Aún no está listo.' });
    }
  }

  update(_, delta) {
    const cam = this.cameras.main;
    // movimiento cámara...
    if (Phaser.Input.Keyboard.JustDown(this.keyA)) this.plowSelected();  // 👈
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) this.waterSelected();
    if (Phaser.Input.Keyboard.JustDown(this.keyC)) this.harvestSelected();

    State.clock += 1;
    tickClimate(); tickCrops(); tickPlagues(); tickAlerts();
  }
}
