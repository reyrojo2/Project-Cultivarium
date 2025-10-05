// src/map/mapBuilder.js
export const T = { GRASS:'G', PATH:'X', SOIL:'S' };

// Presets (puedes agregar los tuyos)
export const MAP_PRESETS = {
  base_4x3_9x9: { plotsX:4, plotsY:3, parcelaSize:9, pathW:1, grassBorder:6 },
  denso_6x4_6x6: { plotsX:6, plotsY:4, parcelaSize:6, pathW:1, grassBorder:6 },
  amplio_3x2_12x12_path2: { plotsX:3, plotsY:2, parcelaSize:12, pathW:2, grassBorder:6 },
};

// Matriz jugable: caminos perimetrales y separadores
export function makePlayableMatrix(plotsX, plotsY, parcelaSize, pathW) {
  const width  = plotsX * parcelaSize + (plotsX + 1) * pathW;
  const height = plotsY * parcelaSize + (plotsY + 1) * pathW;
  const strideX = parcelaSize + pathW;
  const strideY = parcelaSize + pathW;

  const m = Array.from({ length: height }, () => Array(width).fill(T.SOIL));
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const rx = x % strideX;
      const ry = y % strideY;
      if (rx < pathW || ry < pathW) m[y][x] = T.PATH; // perímetro + separadores
    }
  }
  return m;
}

// Inserta play en un mar de pasto (borde)
export function makeWorldMatrix(play, grassBorder) {
  const PLAY_H = play.length, PLAY_W = play[0].length;
  const TOTAL_W = PLAY_W + grassBorder*2;
  const TOTAL_H = PLAY_H + grassBorder*2;
  const world = Array.from({ length: TOTAL_H }, () => Array(TOTAL_W).fill(T.GRASS));
  for (let y=0; y<PLAY_H; y++) for (let x=0; x<PLAY_W; x++)
    world[grassBorder + y][grassBorder + x] = play[y][x];

  return {
    world,
    dims: {
      TOTAL_W, TOTAL_H,
      PLAY_W, PLAY_H,
      FARM_MIN_X: grassBorder,
      FARM_MIN_Y: grassBorder,
      FARM_MAX_X: grassBorder + PLAY_W - 1,
      FARM_MAX_Y: grassBorder + PLAY_H - 1,
      grassBorder
    }
  };
}

// Índice de bloques: 1 parcela lógica por bloque de suelo (p. ej. 9×9)
export function buildBlockIndex(plotsX, plotsY, parcelaSize, pathW) {
  const blocks = []; // [{ id, bx, by, x0, y0, w, h }]
  const strideX = parcelaSize + pathW;
  const strideY = parcelaSize + pathW;
  const PLAY_W = plotsX * parcelaSize + (plotsX + 1)*pathW;
  const PLAY_H = plotsY * parcelaSize + (plotsY + 1)*pathW;

  const blockIdAt = Array.from({ length: PLAY_H }, () => Array(PLAY_W).fill(-1));
  let nextId = 1;
  for (let by=0; by<plotsY; by++) {
    for (let bx=0; bx<plotsX; bx++) {
      const x0 = pathW + bx*strideX; // primera celda de suelo del bloque (en play)
      const y0 = pathW + by*strideY;
      const id = nextId++;
      blocks.push({ id, bx, by, x0, y0, w: parcelaSize, h: parcelaSize });
      for (let y=0; y<parcelaSize; y++) for (let x=0; x<parcelaSize; x++)
        blockIdAt[y0+y][x0+x] = id;
    }
  }
  return { blocks, blockIdAt, PLAY_W, PLAY_H };
}

// “Todo junto” desde un preset
export function buildFromPreset(preset) {
  const { plotsX, plotsY, parcelaSize, pathW, grassBorder } = preset;
  const play = makePlayableMatrix(plotsX, plotsY, parcelaSize, pathW);
  const { world, dims } = makeWorldMatrix(play, grassBorder);
  const { blocks, blockIdAt, PLAY_W, PLAY_H } = buildBlockIndex(plotsX, plotsY, parcelaSize, pathW);
  return { world, dims, blocks, blockIdAt, config: { plotsX, plotsY, parcelaSize, pathW, grassBorder, PLAY_W, PLAY_H } };
}

// Si quieres pasar una matriz “custom” (en vez de preset)
export function buildFromCustomMatrix(play, parcelaSize, pathW, grassBorder, plotsX, plotsY) {
  const { world, dims } = makeWorldMatrix(play, grassBorder);
  // plotsX/plotsY deben corresponder a cuántos bloques de parcela hay en tu diseño custom
  const { blocks, blockIdAt, PLAY_W, PLAY_H } = buildBlockIndex(plotsX, plotsY, parcelaSize, pathW);
  return { world, dims, blocks, blockIdAt, config: { plotsX, plotsY, parcelaSize, pathW, grassBorder, PLAY_W, PLAY_H } };
}
