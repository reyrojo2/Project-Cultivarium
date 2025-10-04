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

// === Detecta la "tapa" (rombo) leyendo el alfa del PNG y la cachea por textura ===
const TOP_FACE_CACHE = new Map();

function measureTopDiamondFromAlpha(scene, texKey, alphaThr = 100) {
  if (TOP_FACE_CACHE.has(texKey)) return TOP_FACE_CACHE.get(texKey);

  const src = scene.textures.get(texKey).getSourceImage();
  const w = src.width, h = src.height;

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(src, 0, 0);
  const data = cx.getImageData(0, 0, w, h).data;
  const alphaAt = (x, y) => data[(y*w + x)*4 + 3];

  const midX = (w/2) | 0, midY = (h/2) | 0;

  let topInset = 0;  for (let y=0; y<h; y++)   { if (alphaAt(midX,y) > alphaThr) { topInset = y; break; } }
  let botInset = 0;  for (let y=h-1; y>=0; y--){ if (alphaAt(midX,y) > alphaThr) { botInset = (h-1-y); break; } }
  let leftInset = 0; for (let x=0; x<w; x++)   { if (alphaAt(x,midY) > alphaThr) { leftInset = x; break; } }
  let rightInset= 0; for (let x=w-1; x>=0; x--){ if (alphaAt(x,midY) > alphaThr) { rightInset= (w-1-x); break; } }

  const halfW = (w/2) - Math.max(leftInset, rightInset);
  const halfH = (h/2) - Math.max(topInset,  botInset);

  const polyLocal = new Phaser.Geom.Polygon([
    new Phaser.Geom.Point(0,      -halfH),
    new Phaser.Geom.Point(halfW,    0),
    new Phaser.Geom.Point(0,       halfH),
    new Phaser.Geom.Point(-halfW,   0),
  ]);

  const res = { halfW, halfH, polyLocal };
  TOP_FACE_CACHE.set(texKey, res);
  return res;
}


function addIsoTile(scene, key, gx, gy, offX, offY) {
  const sx = Math.round(offX + (gx - gy) * 128); // PROJ_W/2 con 256x128
  const sy = Math.round(offY + (gx + gy) * 64);

  const img = scene.add.image(sx, sy, key).setOrigin(0.5, 0.5);
  img.setDepth(sy + gy * 0.001);

  // Polígono exacto de la tapa (según alpha)
  const { polyLocal } = measureTopDiamondFromAlpha(scene, key, 100);

  // Opcional: encoge 2–4 px para que el click no toque la orilla
  const INSET = 4;
  const insetPoly = new Phaser.Geom.Polygon(polyLocal.points.map(p => {
    // Escalado uniforme hacia adentro (aprox.)
    const kx = (Math.abs(p.x) - INSET) / Math.max(Math.abs(p.x), 1);
    const ky = (Math.abs(p.y) - INSET/2) / Math.max(Math.abs(p.y), 1);
    return new Phaser.Geom.Point(p.x * kx, p.y * ky);
  }));

  img.setInteractive(insetPoly, Phaser.Geom.Polygon.Contains);

  // Guarda el polígono para el selector (lo usaremos tal cual)
  img.setData('topPoly', insetPoly);
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

  const sprite = this.spriteByParcela.get(id);     // 👈 recupera el sprite
  this.drawSelector(p.x, p.y, sprite);             // 👈 pásalo para usar su polígono
}


drawSelector(gx, gy, spriteForTile) {
  const { sx, sy } = isoProject(gx, gy, this.offX, this.offY);

  // si pasas el sprite: usa su polígono guardado. Si no, cae a rombo lógico.
  const poly = spriteForTile?.getData('topPoly');
  const g = this.selector || (this.selector = this.add.graphics());

  g.clear()
   .lineStyle(2, 0x60a5fa, 1)
   .setDepth(sy + 9999);

  if (poly) {
    // Dibuja el polígono trasladado al centro (sx,sy)
    const pts = poly.points.map(p => ({ x: sx + p.x, y: sy + p.y }));
    g.strokePoints(pts, true);
  } else {
    // fallback: rombo estándar 256x128
    const halfW = 128, halfH = 64;
    g.strokePoints(
      [{x:sx, y:sy-halfH}, {x:sx+halfW, y:sy}, {x:sx, y:sy+halfH}, {x:sx-halfW, y:sy}],
      true
    );
  }
}

  plowSelected() {
  if (!this.selectedParcelaId) return;
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  const sprite = this.spriteByParcela.get(p.id);
  this.drawSelector(p.x, p.y, sprite);
  if (!sprite) return;

  // Si ya está arada, no hacemos nada (o podrías alternar)
  if (p.arada) {
    this.game.events.emit('toast', { type: 'info', msg: `${p.id} ya está arada.` });
    return;
  }

  sprite.setTexture('Lava3');   // 👈 cambia la textura visible
  p.arada = true;               // 👈 estado lógico
  this.game.events.emit('toast', { type: 'ok', msg: `Araste ${p.id}.` });
  this.drawSelector(p.x, p.y);  // re-dibuja selector encima
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
