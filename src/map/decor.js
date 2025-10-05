// src/map/decor.js
export const DECOR = {
  barn:   { key:'BarnLarge', srcW:512, srcH:256, footprint:{w:2,h:2}, boost:2.00, depthOffset:220, shadow:{dx:60, dy:10, w:220, h:70, alpha:0.25} },
  silo:   { key:'Silo',      srcW:380, srcH:760, footprint:{w:2,h:2}, boost:1.45, fitToFootprint:false, depthOffset:260, shadow:{dx:70, dy:14, w:260, h:90, alpha:0.28} },
  tree:   { key:'Tree',      srcW:128, srcH:128, footprint:{w:1,h:1}, boost:2.00, fitToFootprint:false, depthOffset:180, shadow:{dx:36, dy:10, w:90,  h:32, alpha:0.25} },
  tractor:{ key:'Tractor',   srcW:100, srcH:100, footprint:{w:1,h:1}, boost:2.20, fitToFootprint:false, depthOffset:190, shadow:{dx:28, dy: 8, w:80,  h:26, alpha:0.22} },
  rock1:  { key:'Rock1',     srcW: 48, srcH: 24, footprint:{w:1,h:1}, boost:1.60, fitToFootprint:false, depthOffset:  8, shadow:{dx:10, dy: 4, w:46,  h:16, alpha:0.22} },
  rock2:  { key:'Rock2',     srcW: 48, srcH: 24, footprint:{w:1,h:1}, boost:1.60, fitToFootprint:false, depthOffset:  8, shadow:{dx:12, dy: 4, w:50,  h:18, alpha:0.22} },
  bush1:  { key:'Bush1',     srcW: 61, srcH: 55, footprint:{w:1,h:1}, boost:1.90, fitToFootprint:false, depthOffset: 12, shadow:{dx:14, dy: 6, w:70,  h:24, alpha:0.22} },
};

// Requiere: scene.offX/offY y una función isoProject(gx,gy,offX,offY)
// src/map/decor.js
export function addDecor(scene, isoProject, gx, gy, name, opts = {}) {
  const def = { ...DECOR[name] };
  if (!def) { console.warn('Decor no definido:', name); return null; }
  Object.assign(def, opts);

  const fw = def.footprint.w, fh = def.footprint.h;
  const anchorGX = gx + fw - 1;
  const anchorGY = gy + fh - 1;

  const { sx, sy } = isoProject(anchorGX, anchorGY, scene.offX, scene.offY);

  // --- Auto-scale: ajusta ancho visual al nº de tiles (footprint.w) ---
  const projW = opts.projW ?? 256; // ancho 1 tile (tu PROJ_W)
  const targetWidthPx = (def.fitToFootprint ?? true) ? fw * projW : def.srcW;
  let scale = (targetWidthPx / def.srcW) * (def.boost ?? 1);

  // Sombra
  const sh = def.shadow || { dx:0, dy:0, w:100, h:40, alpha:0.25 };
  const shadow = scene.add.ellipse(
    sx + (sh.dx||0), sy + (sh.dy||0),
    (sh.w||100) * scale, (sh.h||40) * scale,
    0x000000, sh.alpha ?? 0.25
  )
  .setOrigin(0.5)
  .setDepth(sy - 2);

  // Sprite
  const spr = scene.add.image(sx, sy, def.key)
    .setOrigin(0.5, 1)
    .setScale(scale)
    .setDepth(sy + (def.depthOffset ?? 0));

  spr.setData('decor', { name, gx, gy, fw, fh });
  return { sprite: spr, shadow };
}

