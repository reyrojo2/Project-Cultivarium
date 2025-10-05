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

  // Polígono de la tapa medido desde arriba (en coords locales centradas)
  const { polyLocal } = measureDiamondFromTop(scene, key, 180);

  // Inset para no tocar el borde (ajusta a gusto)
  const INSET_X = 8, INSET_Y = 4;
  const polyLocalInset = new Phaser.Geom.Polygon(
    polyLocal.points.map(p => new Phaser.Geom.Point(
      Math.sign(p.x) * Math.max(0, Math.abs(p.x) - INSET_X),
      Math.sign(p.y) * Math.max(0, Math.abs(p.y) - INSET_Y)
    ))
  );

  // 👉 Hit-area debe estar en coords de textura: 0..width/0..height
  //    Sumamos displayOriginX/Y (mitad del ancho/alto por origin 0.5)
  const polyHit = new Phaser.Geom.Polygon(
    polyLocalInset.points.map(p => new Phaser.Geom.Point(
      p.x + img.displayOriginX,
      p.y + img.displayOriginY
    ))
  );

  img.setInteractive(polyHit, Phaser.Geom.Polygon.Contains);

  // Guardamos el polígono centrado para el selector visual
  img.setData('topPoly', polyLocalInset);
  img.setData('texKey', key);
  return img;
}

// ---- constantes de color ----
const SOIL_DRY    = { r:153, g:102, b: 51 }; // fill para seca
const SOIL_WET    = { r: 92, g: 58,  b: 30 }; // fill para mojada (seca→oscura)

// multiplicadores (0..1) para tint multiplicativo (mantiene textura)
const PLOWED_MUL = { r: 0.85, g: 0.75, b: 0.55 };  // arada
const WET_MUL    = { r: 0.70, g: 0.65, b: 0.60 };  // regada (oscurece)

// utilidades
const toRGB = (r,g,b)=> (r<<16)|(g<<8)|b;
const mulToTint = (m)=> toRGB((m.r*255)|0,(m.g*255)|0,(m.b*255)|0);
const mulFactors = (a,b)=> ({ r:a.r*b.r, g:a.g*b.g, b:a.b*b.b });

const jitterColor = (r,g,b, jr=6,jg=6,jb=4) => {
  const R = Phaser.Math.Clamp(r + Phaser.Math.Between(-jr, jr), 0, 255);
  const G = Phaser.Math.Clamp(g + Phaser.Math.Between(-jg, jg), 0, 255);
  const B = Phaser.Math.Clamp(b + Phaser.Math.Between(-jb, jb), 0, 255);
  return (R<<16)|(G<<8)|B;
};

function applySoilVisual(scene, parcelaId) {
  const p   = repoGet('parcelas', parcelaId);
  const spr = scene.spriteByParcela.get(parcelaId);
  if (!p || !spr) return;

  const isWet = p.wetUntil && State.clock < p.wetUntil;

  if (p.arada) {
    // textura con surcos
    spr.setTexture('Lava3');
    spr.clearTint();   // limpia fills previos
    spr.resetPipeline();

    // multiplicativo base de arado
    let mul = { ...PLOWED_MUL };
    // si además está mojada, compón multiplicadores (más oscuro)
    if (isWet) mul = mulFactors(mul, WET_MUL);

    spr.setTint(mulToTint(mul)); // <-- multiplica (mantiene surcos)
  } else {
    // tierra sin arar: usamos FILL (recolorea por completo)
    spr.setTexture('Lava1');
    spr.clearTint();
    spr.resetPipeline();
    spr.setTintFill(
      isWet
        ? jitterColor(SOIL_WET.r, SOIL_WET.g, SOIL_WET.b, 4,4,3) // mojada = más oscuro
        : jitterColor(SOIL_DRY.r, SOIL_DRY.g, SOIL_DRY.b, 6,6,4) // seca
    );
  }
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
    startLevel(0);
    State.clima = { temperatura: 28, humedad: 60, evento: 'NINGUNO' };//Agrupa clima inicial
    console.log('[Game] create', window.__CV_START__); 
    // Activa que solo el objeto “más arriba” reciba el click
    if (this.input?.setTopOnly) this.input.setTopOnly(true);
    Factory.createPlayer({ name: 'AgroPro', cartera: 200 });
    Factory.createTienda();

    // === Mapa (más grande) ===
    const FARM_COLS = 24;   // antes 18
    const FARM_ROWS = 14;   // antes 10

    // --- Borde dinámico para cubrir el canvas ---
    const halfW = PROJ_W / 2;   // 128
    const halfH = PROJ_H / 2;   // 64

    const vw = this.scale.width;
    const vh = this.scale.height;

    const padFit = 80; // margen visual
    const needSpanX = vw + padFit * 2;
    const needSpanY = vh + padFit * 2;

    // Un grid CxR proyecta (C+R)*halfW en X y (C+R)*halfH en Y
    const sumCR = FARM_COLS + FARM_ROWS;
    const needSum = Math.max(
      Math.ceil(needSpanX / halfW),
      Math.ceil(needSpanY / halfH)
    );

    // coronas de pasto necesarias a cada lado
    const BORDER_NEEDED = Math.max(0, Math.ceil((needSum - sumCR) / 2));
    const RINGS_VISIBLE = 6;           // antes 2 → más “terreno”
    const BORDER = BORDER_NEEDED + RINGS_VISIBLE;

    // centro del mapa
    const offX = this.scale.width / 2;
    const offY = 140;
    this.offX = offX; this.offY = offY;

    const pick = arr => arr[(Math.random() * arr.length) | 0];
    const grassKeys  = ['Acid1','Acid2'];
    const soilKey    = 'Lava1';   // tierra arable (sin arar)
    const plowedKey  = 'Lava3';   // arada (cuando presionas A)
    const pathKeys   = ['Ground2','Ground3','Ground4'];

    // Parámetros de caminos
    const BLOCK_W = 6;  // ancho de bloque arable entre caminos
    const BLOCK_H = 6;  // alto  de bloque arable entre caminos
    const PATH_W  = 1;  // grosor del camino

    const TOTAL_COLS = FARM_COLS + BORDER * 2;
    const TOTAL_ROWS = FARM_ROWS + BORDER * 2;
    const FARM_MIN_X = BORDER, FARM_MIN_Y = BORDER;
    const FARM_MAX_X = BORDER + FARM_COLS - 1;
    const FARM_MAX_Y = BORDER + FARM_ROWS - 1;

    // === buffers de tipo de tile y sprites de suelo (para la pasada de decoración)
    const tileType = [];         // "path" | "soil" | "grass"
    const soilSprites = [];      // sprite por [gy][gx] si es suelo

    function setType(gx, gy, type) {
      if (!tileType[gy]) tileType[gy] = [];
      tileType[gy][gx] = type;
    }
    function isPathAt(gx, gy) {
      return tileType[gy]?.[gx] === 'path';
    }
    function saveSoilSprite(gx, gy, spr) {
      if (!soilSprites[gy]) soilSprites[gy] = [];
      soilSprites[gy][gx] = spr;
    }


    for (let gy=0; gy<TOTAL_ROWS; gy++) {
      for (let gx=0; gx<TOTAL_COLS; gx++) {
        const isFarm = gx>=FARM_MIN_X && gx<=FARM_MAX_X && gy>=FARM_MIN_Y && gy<=FARM_MAX_Y;

        let key;
        let tile = null;

        if (!isFarm) {
          key = pick(grassKeys);
          tile = addIsoTile(this, key, gx, gy, offX, offY);
          setType(gx, gy, 'grass');     // ← marca
          continue;
        }

        // ===== Dentro del área jugable: decidir CAMINO vs SUELO =====
        const cc = gx - BORDER;   // coords relativas al área jugable
        const rr = gy - BORDER;

        const modX = BLOCK_W + PATH_W;
        const modY = BLOCK_H + PATH_W;
        const rx = cc % modX;
        const ry = rr % modY;

        const inVPath = rx >= BLOCK_W;  // ← antes usabas >, por eso no salían
        const inHPath = ry >= BLOCK_H;
        const isPath  = inVPath || inHPath;

        if (isPath) {
          const pathKey = pick(pathKeys);
          tile = addIsoTile(this, pathKey, gx, gy, offX, offY);
          tile.setTint(0x9aa3a1); // ↓ contraste (gris cálido)
          setType(gx, gy, 'path');               // ← marca
          continue;
        }
        // SUELO ARABLE (sin cultivo por defecto)
        key = soilKey;
        tile = addIsoTile(this, key, gx, gy, offX, offY);
        tile.setTintFill(jitterColor(SOIL_DRY.r, SOIL_DRY.g, SOIL_DRY.b, 6, 6, 4));

        setType(gx, gy, 'soil');          // ← marca
        saveSoilSprite(gx, gy, tile);  

        // Recurso agua (inicia seco para forzar riego)
        const recAgua = Factory.createRecurso({ tipo: 'AGUA', nivel: 0.0 });

        // ⚠️ Sin cultivo inicial
        const parcela = Factory.createParcela({
          x: gx, y: gy, w: PROJ_W, h: PROJ_H,
          recursos: [recAgua.id],
          cultivoId: null,       // <<< SIN CULTIVO
          saludSuelo: 0.8,
          arada: false           // flag tuyo
        });

        this.spriteByParcela.set(parcela.id, tile);
        tile.on('pointerdown', () => this.selectParcela(parcela.id));
      }
    }

    // ====== DECORACIÓN: sombra fina en bordes suelo↔camino ======
    const edge = this.add.graphics()
      .setDepth(9999)
      .setAlpha(0.10)
      .fillStyle(0x000000);

    for (let gy = FARM_MIN_Y; gy <= FARM_MAX_Y; gy++) {
      for (let gx = FARM_MIN_X; gx <= FARM_MAX_X; gx++) {
        if (tileType[gy]?.[gx] !== 'soil') continue;

        const touchRight = isPathAt(gx + 1, gy);
        const touchDown  = isPathAt(gx, gy + 1);
        if (!touchRight && !touchDown) continue;

        const { sx, sy } = isoProject(gx, gy, offX, offY);
        const hw = PROJ_W / 2, hh = PROJ_H / 2;

        // sombra hacia la derecha (camino a la derecha)
        if (touchRight) {
          edge.fillTriangle(
            sx, sy,           // vértice superior
            sx + hw, sy,      // derecha
            sx, sy + hh       // inferior
          );
        }
        // sombra hacia abajo (camino abajo)
        if (touchDown) {
          edge.fillTriangle(
            sx, sy,           // vértice superior
            sx, sy + hh,      // inferior
            sx - hw, sy       // izquierda
          );
        }
      }
    }


    // ===== Límites de cámara tal cual los tenías =====
    const tl = isoProject(0, TOTAL_ROWS - 1, this.offX, this.offY);
    const br = isoProject(TOTAL_COLS - 1, 0, this.offX, this.offY);

    const minX = Math.min(tl.sx, br.sx);
    const maxX = Math.max(tl.sx, br.sx);
    const minY = Math.min(tl.sy, br.sy);
    const maxY = Math.max(tl.sy, br.sy);

    const mapW = maxX - minX;
    const mapH = maxY - minY;
    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;

    const zoomX = (vw - padFit*2) / mapW;
    const zoomY = (vh - padFit*2) / mapH;
    const zoom  = Math.min(zoomX, zoomY);

    const padWorldX = (vw / zoom) * 0.5;
    const padWorldY = (vh / zoom) * 0.5;
    const padWorld  = Math.max(padWorldX, padWorldY);

    this.cameras.main.setBounds(
      minX - padWorld,
      minY - padWorld,
      mapW + padWorld*2,
      mapH + padWorld*2
    );

    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(cx, cy);


    // Evento clima demo
    Factory.createEventoClimatico({
      tipo: EVENTOS_TIPO.SEQUIA,
      intensidad: NIVELES.INTENSIDAD.MEDIA,
      inicio: 50, fin: 200,
      area: { x: -9999, y: -9999, w: 9999, h: 9999 }
    });

    // Inputs
    this.cursors = this.input.keyboard.createCursorKeys();

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

    // --- Puente UI -> GameScene: acciones por evento ---
// dentro de create()
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


// Limpieza del listener al cerrar la escena
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  this.game.events.off('action:perform');
});


    if (!this.scene.isActive('UI')) {
      this.scene.launch('UI');
  }
  }

  selectParcela(id){
    this.selectedParcelaId = id;
    const p = repoGet('parcelas', id);
    const c = p?.cultivoId ? repoGet('cultivos', p.cultivoId) : null;
    const agua = p?.recursos.map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');

    this.game.events.emit('inspect:parcela', {
      id: p?.id, saludSuelo: p?.saludSuelo?.toFixed(2),
      cultivo: c ? { tipo: c.tipo, etapa: c.etapa, progreso: c.progreso.toFixed(2) } : null,
      agua: agua ? { nivel: Number(agua.nivel).toFixed(2) } : null,
      plagaActiva: p.plagaActiva,      // 
      riesgoPlaga: p.riesgoPlaga,      // 
      intensidadPlaga: p.intensidadPlaga  // 
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
    g.lineStyle(2, 0x60a5fa, 1).strokePoints(pts, true);
    g.fillStyle(0x60a5fa, 0.06).fillPoints(pts, true); // sutil
  }

  plowSelected() {
    if (!this.selectedParcelaId) return;
    const p = repoGet('parcelas', this.selectedParcelaId);
    const spr = this.spriteByParcela.get(p?.id);
    if (!p || !spr) return;

    if (p.arada) { this.game.events.emit('toast',{type:'info', msg:`${p.id} ya está arada.`}); return; }

    // (si recalculas polígono por la nueva textura, hazlo aquí)
    p.arada = true;
    applySoilVisual(this, p.id);          // 👈 textura Lava3 + multiplicador
    this.game.events.emit('toast', { type:'ok', msg:`Araste ${p.id}.` });
    this.drawSelector(p.x, p.y, spr);
  }


  waterSelected() {
    if (this._cooldowns.water > 0) return;
    this._cooldowns.water = 400; // ms    const selId = this.selectedParcelaId;
    
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

    // lógica de agua
    agua.nivel = Math.min(1, (agua.nivel ?? 0) + 0.25);

    // marca mojado un rato (ajusta duración)
    const WET_DURATION = 1200;
    p.wetUntil = (p.wetUntil && State.clock < p.wetUntil)
      ? p.wetUntil + Math.floor(WET_DURATION*0.5)
      : State.clock + WET_DURATION;

    applySoilVisual(this, p.id);  // 👈 actualiza (seca→fill oscuro, arada→tint compuesto)
    this.game.events.emit('toast', { type:'ok', msg:`Riego aplicado a ${p.id}.` });

    // limpia alertas y refresca panel
    repoAll('alertas').forEach(a => { if (a.parcelaId === p.id) a.visible = false; });
    this.selectParcela(p.id);
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

// Crear/sembrar cultivo en la parcela seleccionada
async plantSelected() {
  if (!this.selectedParcelaId) {
    this.game.events.emit('toast', { type:'warn', msg:'Selecciona una parcela primero.' });
    return;
  }
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  // Si ya hay cultivo, evita duplicar
  if (p.cultivoId) {
    const c = repoGet('cultivos', p.cultivoId);
    this.game.events.emit('toast', { type:'info', msg:`${p.id} ya tiene ${c?.tipo || 'cultivo'}.` });
    return;
  }

  // Coste simple de siembra
  const player = findFirstPlayer();
  if (!spend(player, 15)) {
    this.game.events.emit('toast', { type:'warn', msg:'Fondos insuficientes (15).' });
    return;
  }

  // Crea un cultivo sencillo (MVP)
  const cultivo = Factory.createCultivo({
    tipo: 'MAIZ',   // cambia por menú/semilla luego
    etapa: 'SIEMBRA',
    progreso: 0,
    consumoAgua: 1.0
  });
  p.cultivoId = cultivo.id;

  this.game.events.emit('toast', { type:'ok', msg:`Sembraste ${cultivo.tipo} en ${p.id}.` });
  this.selectParcela(p.id);
}

// “Tech tree” placeholder (abre modal/scene más adelante)
openTechTree() {
  // Aquí puedes lanzar otra escena o un overlay de upgrades
  this.game.events.emit('toast', { type:'ok', msg:'Tech Tree (WIP): Riego por goteo, sensores, energía solar…' });
}

// Escaneo rápido (MVP) – convierte estado a “lecturas NASA” y alerta
scanRegion() {
  if (!this.selectedParcelaId) {
    this.game.events.emit('toast', { type:'warn', msg:'Selecciona una parcela para escanear.' });
    return;
  }
  const p = repoGet('parcelas', this.selectedParcelaId);
  if (!p) return;

  // Lecturas simplificadas
  const agua = (p.recursos||[]).map(rid => repoGet('recursos', rid)).find(r => r?.tipo==='AGUA');
  const smapRZSM = Number(agua?.nivel ?? 0);           // SMAP (raíz) normalizado 0..1
  const ndvi     = Number(p.saludSuelo ?? 0.5);        // proxy NDVI (MVP)
  const heat     = Phaser.Math.Clamp(Math.random()*0.6, 0, 1); // proxy estrés térmico

  const msg =
    `🛰️ Scan NASA\n` +
    `• SMAP (RZSM): ${(smapRZSM*100).toFixed(0)}%\n` +
    `• NDVI (salud): ${(ndvi*100).toFixed(0)}%\n` +
    `• Heat stress: ${(heat*100).toFixed(0)}%`;

  this.game.events.emit('toast', { type:'ok', msg });
}

// Vende todas las parcelas en estado de COSECHA (MVP)
sellHarvest() {
  let total = 0;
  for (const p of repoAll('parcelas')) {
    if (!p.cultivoId) continue;
    const c = repoGet('cultivos', p.cultivoId);
    if (c?.etapa === 'COSECHA' && c.progreso >= 1) {
      total += 30;           // precio plano (MVP)
      c.etapa = 'SIEMBRA';   // resetea para resembrar
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
    const cam = this.cameras.main;
    const dt = delta / 1000;
    const v = this.camSpeed / cam.zoom; // velocidad “constante” con zoom

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

    // en update(), por ejemplo cada 15 ticks
    if ((State.clock % 15) === 0) {
      for (const p of repoAll('parcelas')) {
        if (p.wetUntil && State.clock >= p.wetUntil) {
          p.wetUntil = 0;
          applySoilVisual(this, p.id); // vuelve a seca (fill) o arada (tint base)
        }
      }
    }

  }

}
