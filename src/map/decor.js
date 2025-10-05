// src/map/decor.js
export const DECOR = {
  barn:   { key:'BarnLarge', srcW:512, srcH:256, footprint:{w:2,h:2}, boost:2.00, depthOffset:220, shadow:{ dx:14, dy:2, w:380, h:120, alpha:0.40 }},
  silo:   { key:'Silo',      srcW:380, srcH:760, footprint:{w:2,h:2}, boost:1.45, fitToFootprint:false, depthOffset:260, shadow:{dx:70, dy:14, w:260, h:90, alpha:0.36} },
  tree:   { key:'Tree',      srcW:128, srcH:128, footprint:{w:1,h:1}, boost:2.00, fitToFootprint:false, depthOffset:180, shadow:{dx:36, dy:10, w:90,  h:32, alpha:0.30} },
  tractor:{ key:'Tractor',   srcW:100, srcH:100, footprint:{w:1,h:1}, boost:2.20, fitToFootprint:false, depthOffset:190, shadow:{dx:28, dy: 8, w:80,  h:26, alpha:0.30} },
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

  const projW = opts.projW ?? 256;
  const targetWidthPx = (def.fitToFootprint ?? true) ? fw * projW : def.srcW;
  const scale = (targetWidthPx / def.srcW) * (def.boost ?? 1);

  const spr = scene.add.image(sx, sy, def.key)
    .setOrigin(0.5, 1)
    .setScale(scale)
    .setDepth(sy + (def.depthOffset ?? 0));

  const sh = def.shadow || { dx:0, dy:0, w:100, h:40, alpha:0.25 };
  const shadow = scene.add.image(
      sx + (sh.dx||0), sy + (sh.dy||0),
      'shadowSoft'
    )
    .setOrigin(0.5)
    .setDepth(spr.depth - 1)
    .setBlendMode(Phaser.BlendModes.MULTIPLY)
    .setAlpha(sh.alpha ?? 0.25);

  // tamaño inicial coherente (opcional; igual luego lo reescala tickDayNight)
  shadow.setDisplaySize(sh.w, sh.h);

  // base para tickDayNight (usa w/h del decor, no fijos)
  shadow.setData('shadowBase', { dx: sh.dx||0, dy: sh.dy||0, w: sh.w||100, h: sh.h||40, alpha: sh.alpha ?? 0.25 });

  spr.setData('decor', { name, gx, gy, fw, fh });
  return { sprite: spr, shadow };
}
