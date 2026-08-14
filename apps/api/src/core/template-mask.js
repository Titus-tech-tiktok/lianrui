'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const {
  parseTemplateAnalysisSummary,
  resolveGenerationAction,
  templateCachePaths
} = require('./template-regions');

function pixelAverage(data, index) {
  return (Number(data[index]) + Number(data[index + 1]) + Number(data[index + 2])) / 3;
}

function pixelSaturation(data, index) {
  const r = Number(data[index]);
  const g = Number(data[index + 1]);
  const b = Number(data[index + 2]);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function convexHull(points) {
  const unique = [...new Map(points.map(point => [`${point[0]},${point[1]}`, point])).values()]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (unique.length <= 3) return unique;
  const cross = (origin, left, right) => (left[0] - origin[0]) * (right[1] - origin[1])
    - (left[1] - origin[1]) * (right[0] - origin[0]);
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function countDarkBorderPixels(data, width, height, box) {
  const x0 = Math.max(0, box.x0 - 2);
  const y0 = Math.max(0, box.y0 - 2);
  const x1 = Math.min(width - 1, box.x1 + 2);
  const y1 = Math.min(height - 1, box.y1 + 2);
  let dark = 0;
  let total = 0;
  for (let x = x0; x <= x1; x += 1) {
    for (const y of [y0, y1]) {
      const offset = (y * width + x) * 3;
      total += 1;
      if (pixelAverage(data, offset) < 115) dark += 1;
    }
  }
  for (let y = y0 + 1; y < y1; y += 1) {
    for (const x of [x0, x1]) {
      const offset = (y * width + x) * 3;
      total += 1;
      if (pixelAverage(data, offset) < 115) dark += 1;
    }
  }
  return total ? dark / total : 0;
}

async function detectTemplateLightCabinetPanels(file, options = {}) {
  const regions = Array.isArray(options.regions) ? options.regions : [];
  const searchRegions = regions.map(region => {
    const marginX = Math.max(0.02, region.width * 0.12);
    const marginY = Math.max(0.02, region.height * 0.05);
    const x = Math.max(0, region.x - marginX);
    const y = Math.max(0, region.y - marginY);
    return {
      x,
      y,
      width: Math.min(1, region.x + region.width + marginX) - x,
      height: Math.min(1, region.y + region.height + marginY) - y
    };
  });
  const { data, info } = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const totalPixels = width * height;
  const candidate = new Uint8Array(totalPixels);
  for (let y = 0; y < height; y += 1) {
    const yNorm = y / height;
    if (yNorm < 0.01 || yNorm > 0.99) continue;
    for (let x = 0; x < width; x += 1) {
      const xNorm = x / width;
      if (searchRegions.length && !searchRegions.some(region => (
        xNorm >= region.x && xNorm <= region.x + region.width
        && yNorm >= region.y && yNorm <= region.y + region.height
      ))) continue;
      const index = y * width + x;
      const offset = index * 3;
      const average = pixelAverage(data, offset);
      const saturation = pixelSaturation(data, offset);
      // Cabinet fronts can be pure white, heavily lit, or partially shadowed.
      // The former upper brightness cap excluded highlights and entire opened
      // drawer fronts, so detection now relies on shape and border evidence.
      if (average >= 132 && saturation <= 78) candidate[index] = 1;
    }
  }

  // Remove one-pixel bridges caused by antialiasing and glare. Without this,
  // a white drawer front can merge with a bright wall or curtain and produce
  // one oversized bounding box instead of separate physical panels.
  let refinedCandidate = new Uint8Array(candidate.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!candidate[index]) continue;
      let neighbors = 0;
      for (let py = y - 1; py <= y + 1; py += 1) {
        for (let px = x - 1; px <= x + 1; px += 1) neighbors += candidate[py * width + px];
      }
      if (neighbors >= 7) refinedCandidate[index] = 1;
    }
  }

  // Keep light runs that are physically enclosed by dark cabinet edges on
  // both sides. This removes bright walls, windows and the triangular gaps
  // between opened drawers while retaining the actual front boards.
  const enclosedCandidate = new Uint8Array(candidate.length);
  const minimumRun = Math.max(8, Math.round(width * 0.025));
  const boundaryRadius = Math.max(5, Math.round(width * 0.012));
  const hasDarkBoundary = (startX, endX, y) => {
    for (let py = Math.max(0, y - 2); py <= Math.min(height - 1, y + 2); py += 1) {
      for (let px = Math.max(0, startX); px <= Math.min(width - 1, endX); px += 1) {
        if (pixelAverage(data, (py * width + px) * 3) <= 122) return true;
      }
    }
    return false;
  };
  let enclosedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      while (x < width && !refinedCandidate[y * width + x]) x += 1;
      const startX = x;
      while (x < width && refinedCandidate[y * width + x]) x += 1;
      const endX = x - 1;
      if (endX - startX + 1 < minimumRun) continue;
      const leftDark = hasDarkBoundary(startX - boundaryRadius, startX - 1, y);
      const rightDark = hasDarkBoundary(endX + 1, endX + boundaryRadius, y);
      if (leftDark && rightDark) {
        for (let px = startX; px <= endX; px += 1) {
          enclosedCandidate[y * width + px] = 1;
          enclosedPixels += 1;
        }
      }
    }
  }
  if (!options.useBroadCandidate && enclosedPixels >= totalPixels * 0.0008) refinedCandidate = enclosedCandidate;

  const visited = new Uint8Array(totalPixels);
  const components = [];
  const stack = [];
  for (let start = 0; start < totalPixels; start += 1) {
    if (!refinedCandidate[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    let brightness = 0;
    const pixels = [];
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      const offset = index * 3;
      area += 1;
      pixels.push(index);
      brightness += pixelAverage(data, offset);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= totalPixels || visited[next] || !refinedCandidate[next]) continue;
        if ((index % width === 0 && next === index - 1) || (index % width === width - 1 && next === index + 1)) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    const boxWidth = x1 - x0 + 1;
    const boxHeight = y1 - y0 + 1;
    const boxArea = boxWidth * boxHeight;
    const areaRatio = area / totalPixels;
    const fillRatio = area / Math.max(1, boxArea);
    const widthRatio = boxWidth / width;
    const heightRatio = boxHeight / height;
    const aspect = boxWidth / Math.max(1, boxHeight);
    const darkBorderRatio = countDarkBorderPixels(data, width, height, { x0, y0, x1, y1 });
    if (
      areaRatio >= 0.001
      && areaRatio <= 0.55
      && fillRatio >= 0.34
      && widthRatio >= 0.025
      && heightRatio >= 0.025
      && widthRatio <= 0.92
      && heightRatio <= 0.88
      && aspect >= 0.2
      && aspect <= 8
      && brightness / Math.max(1, area) <= 253.5
      && darkBorderRatio >= 0.008
    ) {
      components.push({ x0, y0, x1, y1, pixels });
    }
  }

  const normalizedEdge = (value, total) => {
    if (value <= Math.max(3, total * 0.02)) return 0;
    if (value >= total - Math.max(3, total * 0.02)) return 1;
    return value / total;
  };
  let surfaces = components.map((box, index) => {
    const rows = new Map();
    for (const pixelIndex of box.pixels) {
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const row = rows.get(y) || { minimum: x, maximum: x };
      row.minimum = Math.min(row.minimum, x);
      row.maximum = Math.max(row.maximum, x);
      rows.set(y, row);
    }
    const hull = convexHull([...rows.entries()].flatMap(([y, row]) => [[row.minimum, y], [row.maximum + 1, y + 1]]));
    const polygon = hull.length >= 3
      ? hull.map(([x, y]) => [normalizedEdge(x, width), normalizedEdge(y, height)])
      : [
        [normalizedEdge(box.x0, width), normalizedEdge(box.y0, height)],
        [normalizedEdge(box.x1 + 1, width), normalizedEdge(box.y0, height)],
        [normalizedEdge(box.x1 + 1, width), normalizedEdge(box.y1 + 1, height)],
        [normalizedEdge(box.x0, width), normalizedEdge(box.y1 + 1, height)]
      ];
    return {
      id: `${regions.length ? 'manual-panel' : 'local-panel'}-${index + 1}`,
      label: `本地检测柜门/抽屉面板 ${index + 1}`,
      polygon,
      surfaceState: '外侧可见',
      _rasterWidth: width,
      _rasterHeight: height,
      _rasterPixels: Uint32Array.from(box.pixels),
      _useRasterMask: Boolean(options.useBroadCandidate)
    };
  });
  if (regions.length && !options.useBroadCandidate) {
    surfaces = surfaces.filter(surface => {
      const xs = surface.polygon.map(point => point[0]);
      const ys = surface.polygon.map(point => point[1]);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const region = regions.find(candidateRegion => centerX >= candidateRegion.x
        && centerX <= candidateRegion.x + candidateRegion.width
        && centerY >= candidateRegion.y
        && centerY <= candidateRegion.y + candidateRegion.height);
      if (!region) return false;
      const nearTop = centerY <= region.y + region.height * 0.16;
      const area = printableSurfaceArea(surface.polygon);
      const tooSmallForTopPanel = area < region.width * region.height * 0.04;
      const tooSmallForPhysicalPanel = area < region.width * region.height * 0.012;
      return !tooSmallForPhysicalPanel && !(nearTop && tooSmallForTopPanel);
    });
  }
  return surfaces;
}

function printableSurfaceArea(polygon = []) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    sum += Number(current?.[0] || 0) * Number(next?.[1] || 0) - Number(next?.[0] || 0) * Number(current?.[1] || 0);
  }
  return Math.abs(sum) / 2;
}

function hasSemanticPrintableSurfaces(value) {
  const summary = typeof value === 'string' ? parseTemplateAnalysisSummary(value) : value || {};
  const surfaces = Array.isArray(summary.printableSurfaces) ? summary.printableSurfaces : [];
  return surfaces.some(surface => {
    if (String(surface?.id || '').startsWith('local-panel-')) return false;
    const polygon = Array.isArray(surface?.polygon) ? surface.polygon : [];
    const area = printableSurfaceArea(polygon);
    return polygon.length >= 3 && area >= 0.003 && area <= 0.72;
  });
}

function insetPrintablePolygon(polygon, width, height, insetPixels = 3) {
  const points = polygon.map(([x, y]) => [
    Math.min(1, Math.max(0, Number(x))),
    Math.min(1, Math.max(0, Number(y)))
  ]);
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return points.map(([x, y]) => {
    const dx = (centerX - x) * width;
    const dy = (centerY - y) * height;
    const distance = Math.hypot(dx, dy);
    const ratio = distance > 0 ? Math.min(1, insetPixels / distance) : 0;
    const insetX = x + (centerX - x) * ratio;
    const insetY = y + (centerY - y) * ratio;
    return [x <= 0.005 || x >= 0.995 ? x : insetX, y <= 0.005 || y >= 0.995 ? y : insetY];
  });
}

async function createManualRefinedMask(job, regions, surfaces, maskPath, generatedBytes = null) {
  const { data, info } = await sharp(job.templatePath, { failOn: 'none', limitInputPixels: 120_000_000 })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const generatedData = generatedBytes?.length
    ? await sharp(generatedBytes, { failOn: 'none' })
      .resize({ width, height, fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer()
    : null;
  const surfacePolygons = surfaces.map(surface => insetPrintablePolygon(surface.polygon, width, height, 3));
  const surfaceBoxes = surfacePolygons.map(polygon => {
    return {
      x0: Math.max(0, Math.floor(Math.min(...polygon.map(point => point[0])) * width)),
      y0: Math.max(0, Math.floor(Math.min(...polygon.map(point => point[1])) * height)),
      x1: Math.min(width - 1, Math.ceil(Math.max(...polygon.map(point => point[0])) * width)),
      y1: Math.min(height - 1, Math.ceil(Math.max(...polygon.map(point => point[1])) * height))
    };
  });
  const everyRegionDetected = regions.every(region => {
    const detectedArea = surfacePolygons.reduce((sum, polygon, index) => {
      const box = surfaceBoxes[index];
      const centerX = (box.x0 + box.x1) / 2 / width;
      const centerY = (box.y0 + box.y1) / 2 / height;
      return centerX >= region.x && centerX <= region.x + region.width
        && centerY >= region.y && centerY <= region.y + region.height
        ? sum + printableSurfaceArea(polygon)
        : sum;
    }, 0);
    return detectedArea >= region.width * region.height * 0.08;
  });
  if (!everyRegionDetected) return '';

  let editableBase = Buffer.alloc(width * height);
  const continuousPolygons = surfacePolygons.filter((_polygon, index) => !surfaces[index]?._useRasterMask);
  if (continuousPolygons.length) {
    const polygonMarkup = continuousPolygons.map(polygon => `<polygon points="${polygon
      .map(([x, y]) => `${Math.round(x * width)},${Math.round(y * height)}`)
      .join(' ')}"/>`).join('');
    editableBase = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#000"/><g fill="#fff">${polygonMarkup}</g></svg>`))
      .removeAlpha()
      .greyscale()
      .extractChannel(0)
      .raw()
      .toBuffer();
  }
  const rasterSurfaces = surfaces.filter(surface => surface._useRasterMask);
  const rasterWidth = Number(rasterSurfaces[0]?._rasterWidth) || 0;
  const rasterHeight = Number(rasterSurfaces[0]?._rasterHeight) || 0;
  const hasRasterComponents = rasterWidth > 0 && rasterHeight > 0
    && rasterSurfaces.every(surface => surface._rasterWidth === rasterWidth
      && surface._rasterHeight === rasterHeight
      && surface._rasterPixels?.length);
  if (hasRasterComponents) {
    const lowResolutionMask = Buffer.alloc(rasterWidth * rasterHeight);
    for (const surface of rasterSurfaces) {
      for (const pixelIndex of surface._rasterPixels) lowResolutionMask[pixelIndex] = 255;
    }
    const rasterBase = await sharp(lowResolutionMask, { raw: { width: rasterWidth, height: rasterHeight, channels: 1 } })
      .dilate(3)
      .erode(3)
      .resize({ width, height, fit: 'fill', kernel: 'nearest' })
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let index = 0; index < editableBase.length; index += 1) editableBase[index] = Math.max(editableBase[index], rasterBase[index]);
  }
  let registeredPanelBase = Buffer.alloc(width * height);
  const registeredPolygons = surfacePolygons.filter((_polygon, index) => String(surfaces[index]?.id || '').startsWith('post-detected-'));
  if (registeredPolygons.length) {
    const registeredMarkup = registeredPolygons.map(polygon => `<polygon points="${polygon
      .map(([x, y]) => `${Math.round(x * width)},${Math.round(y * height)}`)
      .join(' ')}"/>`).join('');
    registeredPanelBase = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#000"/><g fill="#fff">${registeredMarkup}</g></svg>`))
      .removeAlpha()
      .greyscale()
      .extractChannel(0)
      .raw()
      .toBuffer();
  }

  // Protect structural dark pixels and colored overlays. Unlike the old
  // brightness gate, this starts with a continuous panel and only subtracts
  // explicit obstructions, so highlights and shadows cannot create white holes.
  const protectedPixels = new Uint8Array(width * height);
  const coloredCandidates = new Uint8Array(width * height);
  for (let pixelIndex = 0; pixelIndex < editableBase.length; pixelIndex += 1) {
    if (editableBase[pixelIndex] < 128) continue;
    const sourceIndex = pixelIndex * info.channels;
    const average = pixelAverage(data, sourceIndex);
    const saturation = pixelSaturation(data, sourceIndex);
    if (average <= 94) protectedPixels[pixelIndex] = 1;
    if (average >= 38 && average <= 246 && saturation >= 70) coloredCandidates[pixelIndex] = 1;
  }

  const visited = new Uint8Array(width * height);
  const stack = [];
  const minimumOverlayArea = Math.max(16, Math.round(width * height * 0.000008));
  for (let start = 0; start < coloredCandidates.length; start += 1) {
    if (!coloredCandidates[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    const componentPixels = [];
    while (stack.length) {
      const pixelIndex = stack.pop();
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      area += 1;
      componentPixels.push(pixelIndex);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const next of [pixelIndex - 1, pixelIndex + 1, pixelIndex - width, pixelIndex + width]) {
        if (next < 0 || next >= coloredCandidates.length || visited[next] || !coloredCandidates[next]) continue;
        if ((pixelIndex % width === 0 && next === pixelIndex - 1) || (pixelIndex % width === width - 1 && next === pixelIndex + 1)) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    const boxWidth = x1 - x0 + 1;
    const boxHeight = y1 - y0 + 1;
    const boxArea = boxWidth * boxHeight;
    const fillRatio = area / Math.max(1, boxArea);
    const isOverlay = area >= minimumOverlayArea
      && boxArea <= width * height * 0.09
      && fillRatio >= 0.08
      && boxWidth >= 4
      && boxHeight >= 3;
    if (!isOverlay) continue;
    const padding = Math.max(2, Math.round(Math.min(width, height) * 0.003));
    const isSolidLabel = fillRatio >= 0.55 && boxArea <= width * height * 0.035;
    if (isSolidLabel) {
      for (let y = Math.max(0, y0 - padding); y <= Math.min(height - 1, y1 + padding); y += 1) {
        for (let x = Math.max(0, x0 - padding); x <= Math.min(width - 1, x1 + padding); x += 1) {
          if (editableBase[y * width + x] >= 128) protectedPixels[y * width + x] = 1;
        }
      }
    } else {
      for (const pixelIndex of componentPixels) protectedPixels[pixelIndex] = 1;
    }
  }

  // Protect pale background and clothing that continue across a coarse ROI
  // boundary. A cabinet front is normally enclosed by its dark frame, while
  // walls, curtains, clothing and foreground merchandise continue from
  // outside the operator rectangle. Flooding only from a color-matched pixel
  // outside the ROI preserves those occluders without cutting holes in the
  // interior drawer fronts.
  const neutralCandidates = new Uint8Array(width * height);
  for (let pixelIndex = 0; pixelIndex < editableBase.length; pixelIndex += 1) {
    if (editableBase[pixelIndex] < 128) continue;
    if (registeredPanelBase[pixelIndex] >= 128) continue;
    const sourceIndex = pixelIndex * info.channels;
    if (pixelAverage(data, sourceIndex) >= 104 && pixelSaturation(data, sourceIndex) <= 72) {
      neutralCandidates[pixelIndex] = 1;
    }
  }
  const colorDistance = (leftIndex, rightIndex) => {
    let sum = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      sum += Math.abs(Number(data[leftIndex * info.channels + channel]) - Number(data[rightIndex * info.channels + channel]));
    }
    return sum / 3;
  };
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x * width));
    const y0 = Math.max(0, Math.floor(region.y * height));
    const x1 = Math.min(width - 1, Math.ceil((region.x + region.width) * width) - 1);
    const y1 = Math.min(height - 1, Math.ceil((region.y + region.height) * height) - 1);
    const inset = Math.max(1, Math.round(Math.min(width, height) * 0.003));
    const seeds = [];
    const addSeed = (insideX, insideY, outsideX, outsideY) => {
      if (insideX < 0 || insideX >= width || insideY < 0 || insideY >= height) return;
      if (outsideX < 0 || outsideX >= width || outsideY < 0 || outsideY >= height) return;
      const inside = insideY * width + insideX;
      const outside = outsideY * width + outsideX;
      if (!neutralCandidates[inside]) return;
      const outsideSourceIndex = outside * info.channels;
      if (pixelAverage(data, outsideSourceIndex) < 100 || pixelSaturation(data, outsideSourceIndex) > 82) return;
      if (colorDistance(inside, outside) <= 34) seeds.push(inside);
    };
    for (let x = x0; x <= x1; x += 1) {
      addSeed(x, Math.min(y1, y0 + inset), x, y0 - 2);
      addSeed(x, Math.max(y0, y1 - inset), x, y1 + 2);
    }
    for (let y = y0; y <= y1; y += 1) {
      addSeed(Math.min(x1, x0 + inset), y, x0 - 2, y);
      addSeed(Math.max(x0, x1 - inset), y, x1 + 2, y);
    }
    if (!seeds.length) continue;
    const boundaryVisited = new Uint8Array(width * height);
    const boundaryPixels = [];
    for (const seed of seeds) {
      if (boundaryVisited[seed]) continue;
      boundaryVisited[seed] = 1;
      stack.push(seed);
    }
    while (stack.length) {
      const pixelIndex = stack.pop();
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x < x0 || x > x1 || y < y0 || y > y1 || !neutralCandidates[pixelIndex]) continue;
      boundaryPixels.push(pixelIndex);
      for (const next of [pixelIndex - 1, pixelIndex + 1, pixelIndex - width, pixelIndex + width]) {
        if (next < 0 || next >= neutralCandidates.length || boundaryVisited[next] || !neutralCandidates[next]) continue;
        const nextX = next % width;
        const nextY = Math.floor(next / width);
        if (nextX < x0 || nextX > x1 || nextY < y0 || nextY > y1) continue;
        if ((x === 0 && next === pixelIndex - 1) || (x === width - 1 && next === pixelIndex + 1)) continue;
        boundaryVisited[next] = 1;
        stack.push(next);
      }
    }
    const regionPixels = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
    if (boundaryPixels.length / regionPixels <= 0.72) {
      for (const pixelIndex of boundaryPixels) protectedPixels[pixelIndex] = 1;
    }
  }

  const protectionRadius = Math.max(1, Math.round(Math.min(width, height) * 0.002));
  const expandedProtection = new Uint8Array(protectedPixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!protectedPixels[y * width + x]) continue;
      for (let py = Math.max(0, y - protectionRadius); py <= Math.min(height - 1, y + protectionRadius); py += 1) {
        for (let px = Math.max(0, x - protectionRadius); px <= Math.min(width - 1, x + protectionRadius); px += 1) {
          expandedProtection[py * width + px] = 1;
        }
      }
    }
  }

  const alpha = Buffer.alloc(width * height, 255);
  let editablePixels = 0;
  if (generatedData) {
    const printCandidates = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const xNorm = x / width;
        const yNorm = y / height;
        const inSearchArea = regions.some(region => {
          const padX = Math.max(0.06, region.width * 0.18);
          const padY = Math.max(0.04, region.height * 0.1);
          return xNorm >= Math.max(0, region.x - padX) && xNorm <= Math.min(1, region.x + region.width + padX)
            && yNorm >= Math.max(0, region.y - padY) && yNorm <= Math.min(1, region.y + region.height + padY);
        });
        if (!inSearchArea) continue;
        const pixelIndex = y * width + x;
        const sourceIndex = pixelIndex * info.channels;
        const generatedIndex = pixelIndex * 3;
        const sourceAverage = pixelAverage(data, sourceIndex);
        const sourceSaturation = pixelSaturation(data, sourceIndex);
        const generatedSaturation = pixelSaturation(generatedData, generatedIndex);
        let difference = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          difference += Math.abs(Number(data[sourceIndex + channel]) - Number(generatedData[generatedIndex + channel]));
        }
        if (sourceAverage >= 88 && sourceSaturation <= 82 && generatedSaturation >= 38 && difference / 3 >= 20) {
          printCandidates[pixelIndex] = 255;
        }
      }
    }
    const closeRadius = Math.max(3, Math.round(Math.min(width, height) * 0.012));
    const closedPrint = await sharp(printCandidates, { raw: { width, height, channels: 1 } })
      .dilate(closeRadius)
      .erode(closeRadius)
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let pixelIndex = 0; pixelIndex < closedPrint.length; pixelIndex += 1) {
      if (closedPrint[pixelIndex] < 128 || expandedProtection[pixelIndex]) continue;
      const sourceIndex = pixelIndex * info.channels;
      if (pixelAverage(data, sourceIndex) < 82 || pixelSaturation(data, sourceIndex) > 96) continue;
      alpha[pixelIndex] = 0;
      editablePixels += 1;
    }
  } else {
    for (let pixelIndex = 0; pixelIndex < editableBase.length; pixelIndex += 1) {
      if (editableBase[pixelIndex] >= 128 && !expandedProtection[pixelIndex]) {
        alpha[pixelIndex] = 0;
        editablePixels += 1;
      }
    }
  }
  if (editablePixels / Math.max(1, width * height) < 0.001) return '';
  const white = Buffer.alloc(width * height * 3, 255);
  await sharp(white, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(maskPath);
  return maskPath;
}

async function templateEditMaskMetrics(job, analysis, maskPathValue = '') {
  const summary = parseTemplateAnalysisSummary(analysis);
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  const maskPath = maskPathValue || await createTemplateEditMask(job, analysis);
  if (!maskPath || !fs.existsSync(maskPath)) return { passed: false, maskPath: '', editablePercent: 0, regions: [] };
  const mask = await sharp(maskPath, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = mask.info.width;
  const height = mask.info.height;
  let totalEditable = 0;
  const metrics = regions.map((region, index) => {
    const x0 = Math.max(0, Math.floor(region.x * width));
    const y0 = Math.max(0, Math.floor(region.y * height));
    const x1 = Math.min(width, Math.ceil((region.x + region.width) * width));
    const y1 = Math.min(height, Math.ceil((region.y + region.height) * height));
    let pixels = 0;
    let editablePixels = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        pixels += 1;
        const alpha = mask.data[(y * width + x) * mask.info.channels + 3];
        if (alpha < 128) editablePixels += 1;
      }
    }
    totalEditable += editablePixels;
    return {
      index: index + 1,
      editablePixels,
      editablePercent: pixels ? editablePixels / pixels * 100 : 0
    };
  });
  return {
    passed: metrics.length > 0 && metrics.every(item => item.editablePixels > 0),
    maskPath,
    editablePercent: width * height ? totalEditable / (width * height) * 100 : 0,
    regions: metrics
  };
}

async function createTemplateMaskPreview(job, analysis, maskPathValue = '') {
  const metrics = await templateEditMaskMetrics(job, analysis, maskPathValue);
  if (!metrics.passed) return { ...metrics, previewPath: '' };
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify({ version: 1, maskPath: metrics.maskPath, metrics: metrics.regions })).digest('hex').slice(0, 12);
  const previewPath = path.join(cache.cacheFolder, `${path.basename(cache.analysisFile, '.json')}-${fingerprint}.mask-preview.png`);
  if (!fs.existsSync(previewPath)) {
    const metadata = await sharp(job.templatePath, { failOn: 'none' }).rotate().metadata();
    const width = Math.max(1, Number(metadata.width) || 1);
    const height = Math.max(1, Number(metadata.height) || 1);
    const editableAlpha = await sharp(metrics.maskPath, { failOn: 'none' })
      .resize({ width, height, fit: 'fill' })
      .ensureAlpha()
      .extractChannel(3)
      .negate()
      .linear(0.48)
      .raw()
      .toBuffer();
    const green = Buffer.alloc(width * height * 3);
    for (let index = 0; index < green.length; index += 3) {
      green[index] = 24;
      green[index + 1] = 196;
      green[index + 2] = 118;
    }
    const overlay = await sharp(green, { raw: { width, height, channels: 3 } })
      .joinChannel(editableAlpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    const annotationPath = await createTemplateRegionAnnotation(job, analysis);
    await sharp(annotationPath || job.templatePath, { failOn: 'none' })
      .rotate()
      .resize({ width, height, fit: 'fill' })
      .composite([{ input: overlay, blend: 'over' }])
      .png()
      .toFile(previewPath);
  }
  return { ...metrics, previewPath };
}

async function createTemplateEditMask(job, analysis) {
  const summary = parseTemplateAnalysisSummary(analysis);
  if (resolveGenerationAction(analysis) !== 'replace_print') return '';
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  let surfaces = regions.length
    ? regions.map((region, index) => ({
      id: `manual-roi-${index + 1}`,
      polygon: [
        [region.x, region.y],
        [region.x + region.width, region.y],
        [region.x + region.width, region.y + region.height],
        [region.x, region.y + region.height]
      ]
    }))
    : (Array.isArray(summary.printableSurfaces) ? summary.printableSurfaces : [])
      .filter(surface => !String(surface?.id || '').startsWith('local-panel-'));
  if (!surfaces.length && !regions.length) {
    surfaces = (await detectTemplateLightCabinetPanels(job.templatePath).catch(() => []))
      .filter(surface => {
        const polygon = Array.isArray(surface?.polygon) ? surface.polygon : [];
        return polygon.length >= 3 && polygon.every(([x, y]) => x > 0.01 && x < 0.99 && y > 0.01 && y < 0.99);
      });
  }
  const maximumArea = regions.length ? 1.000001 : 0.72;
  const polygons = surfaces
    .map(surface => Array.isArray(surface?.polygon) ? surface.polygon : [])
    .filter(polygon => polygon.length >= 3 && printableSurfaceArea(polygon) >= 0.003 && printableSurfaceArea(polygon) <= maximumArea);
  if (!polygons.length) return '';

  const metadata = await sharp(job.templatePath, { failOn: 'none' }).rotate().metadata();
  const width = Math.max(1, Number(metadata.width) || 1);
  const height = Math.max(1, Number(metadata.height) || 1);
  const points = polygons.map(polygon => insetPrintablePolygon(polygon, width, height)
    .map(([x, y]) => `${Math.round(Math.min(1, Math.max(0, Number(x))) * width)},${Math.round(Math.min(1, Math.max(0, Number(y))) * height)}`)
    .join(' '));
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify({ version: 14, width, height, points, regions })).digest('hex').slice(0, 12);
  const maskPath = path.join(cache.cacheFolder, `${path.basename(cache.analysisFile, '.json')}-${fingerprint}.mask.png`);
  if (fs.existsSync(maskPath)) return maskPath;
  await fsp.mkdir(path.dirname(maskPath), { recursive: true });
  // Manual rectangles are coarse semantic guidance for Image2. Do not run
  // local panel detection here: opened drawers, occlusions and close-ups are
  // intentionally left for the four-image model request to understand.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><mask id="editable-cutout"><rect width="100%" height="100%" fill="#ffffff"/><g fill="#000000">${points.map(value => `<polygon points="${value}"/>`).join('')}</g></mask></defs><rect width="100%" height="100%" fill="#ffffff" mask="url(#editable-cutout)"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(maskPath);
  return maskPath;
}

async function createTemplatePostCompositeMask(job, analysis, coarseMaskPath = '', generatedBytes = null) {
  const summary = parseTemplateAnalysisSummary(analysis);
  if (resolveGenerationAction(analysis) !== 'replace_print') return coarseMaskPath || '';
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  if (!regions.length) return coarseMaskPath || '';

  const coarsePath = coarseMaskPath || await createTemplateEditMask(job, analysis);
  if (!coarsePath || !fs.existsSync(coarsePath)) return '';

  // This deterministic layer is never sent to Image2 and never decides
  // whether a request may run. It starts from the complete manual ROI, then
  // restores source structures, labels, occluders and boundary-connected
  // background pixels after generation.
  const selected = regions.map((region, index) => ({
    id: `post-roi-${index + 1}`,
    polygon: [
      [region.x, region.y],
      [region.x + region.width, region.y],
      [region.x + region.width, region.y + region.height],
      [region.x, region.y + region.height]
    ]
  }));

  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify({
    version: 7,
    templatePath: path.resolve(job.templatePath),
    regions,
    generated: generatedBytes?.length ? crypto.createHash('sha1').update(generatedBytes).digest('hex').slice(0, 12) : '',
    surfaces: selected.map(surface => ({ id: surface.id, polygon: surface.polygon }))
  })).digest('hex').slice(0, 12);
  const refinedPath = path.join(cache.cacheFolder, `${path.basename(cache.analysisFile, '.json')}-${fingerprint}.post-mask.png`);
  if (fs.existsSync(refinedPath)) return refinedPath;
  await fsp.mkdir(path.dirname(refinedPath), { recursive: true });
  const result = await createManualRefinedMask(job, regions, selected, refinedPath, generatedBytes).catch(error => {
    if (process.env.DEBUG_TEMPLATE_MASK === '1') throw error;
    return '';
  });
  return result && fs.existsSync(result) ? result : coarsePath;
}

async function createTemplateRegionAnnotation(job, analysis, canvas = null) {
  const summary = parseTemplateAnalysisSummary(analysis);
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  const protectedRegions = Array.isArray(summary.protectedRegions) ? summary.protectedRegions : [];
  if (!regions.length) return '';
  const sourcePath = canvas?.templatePath || job.templatePath;
  const metadata = await sharp(sourcePath, { failOn: 'none' }).metadata();
  const width = Math.max(1, Number(metadata.width) || 1);
  const height = Math.max(1, Number(metadata.height) || 1);
  const contentWidth = Math.max(1, Number(canvas?.contentWidth) || width);
  const contentHeight = Math.max(1, Number(canvas?.contentHeight) || height);
  const left = Math.max(0, Number(canvas?.left) || 0);
  const top = Math.max(0, Number(canvas?.top) || 0);
  const rectangles = regions.map(region => {
    const x = left + region.x * contentWidth;
    const y = top + region.y * contentHeight;
    const regionWidth = region.width * contentWidth;
    const regionHeight = region.height * contentHeight;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${regionWidth.toFixed(2)}" height="${regionHeight.toFixed(2)}" rx="2" fill="none" stroke="#ff4d4f" stroke-width="${Math.max(3, Math.round(Math.min(width, height) / 240))}"/>`;
  }).join('');
  const protectedRectangles = protectedRegions.map(region => {
    const x = left + region.x * contentWidth;
    const y = top + region.y * contentHeight;
    const regionWidth = region.width * contentWidth;
    const regionHeight = region.height * contentHeight;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${regionWidth.toFixed(2)}" height="${regionHeight.toFixed(2)}" rx="2" fill="none" stroke="#00b8c8" stroke-width="${Math.max(3, Math.round(Math.min(width, height) / 240))}"/>`;
  }).join('');
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify({
    version: 2,
    sourcePath: path.resolve(sourcePath),
    width,
    height,
    contentWidth,
    contentHeight,
    left,
    top,
    regions,
    protectedRegions
  })).digest('hex').slice(0, 12);
  const annotationPath = path.join(cache.cacheFolder, `${path.basename(cache.analysisFile, '.json')}-${fingerprint}.regions.png`);
  if (fs.existsSync(annotationPath)) return annotationPath;
  await fsp.mkdir(path.dirname(annotationPath), { recursive: true });
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rectangles}${protectedRectangles}</svg>`);
  await sharp(sourcePath, { failOn: 'none' })
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toFile(annotationPath);
  return annotationPath;
}

async function compositeTemplateEditResult(job, generatedBytes, maskPath) {
  if (!maskPath || !fs.existsSync(maskPath)) return generatedBytes;
  const metadata = await sharp(job.templatePath, { failOn: 'none' }).metadata();
  const width = Math.max(1, Number(metadata.width) || 1);
  const height = Math.max(1, Number(metadata.height) || 1);
  const candidate = await sharp(generatedBytes, { failOn: 'none' })
    .resize({ width, height, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const editableAlpha = await sharp(maskPath, { failOn: 'none' })
    .resize({ width, height, fit: 'fill' })
    .ensureAlpha()
    .extractChannel(3)
    .negate()
    .raw()
    .toBuffer();
  const editableOverlay = await sharp(candidate, { raw: { width, height, channels: 3 } })
    .joinChannel(editableAlpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return sharp(job.templatePath, { failOn: 'none' })
    .rotate()
    .resize({ width, height, fit: 'fill' })
    .composite([{ input: editableOverlay, blend: 'over' }])
    .png()
    .toBuffer();
}

async function validateTemplatePrintCoverage(job, generatedBytes, maskPath, analysis) {
  if (!maskPath || !fs.existsSync(maskPath) || !generatedBytes?.length) {
    return { passed: false, reason: '缺少有效蒙版或生成结果。', regions: [] };
  }
  const summary = parseTemplateAnalysisSummary(analysis);
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  const metadata = await sharp(job.templatePath, { failOn: 'none' }).rotate().metadata();
  const width = Math.max(1, Number(metadata.width) || 1);
  const height = Math.max(1, Number(metadata.height) || 1);
  const source = await sharp(job.templatePath, { failOn: 'none' }).rotate().resize({ width, height, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const output = await sharp(generatedBytes, { failOn: 'none' }).resize({ width, height, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const mask = await sharp(maskPath, { failOn: 'none' }).resize({ width, height, fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metrics = regions.map((region, index) => {
    const x0 = Math.max(0, Math.floor(region.x * width));
    const y0 = Math.max(0, Math.floor(region.y * height));
    const x1 = Math.min(width, Math.ceil((region.x + region.width) * width));
    const y1 = Math.min(height, Math.ceil((region.y + region.height) * height));
    let editablePixels = 0;
    let changedPixels = 0;
    let changedDifferenceSum = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const pixelIndex = y * width + x;
        if (mask.data[pixelIndex * mask.info.channels + 3] >= 128) continue;
        editablePixels += 1;
        let difference = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          difference += Math.abs(source[pixelIndex * 3 + channel] - output[pixelIndex * 3 + channel]);
        }
        difference /= 3;
        if (difference >= 12) {
          changedPixels += 1;
          changedDifferenceSum += difference;
        }
      }
    }
    const changedPercent = editablePixels ? changedPixels / editablePixels * 100 : 0;
    const averageDifference = changedPixels ? changedDifferenceSum / changedPixels : 0;
    return {
      index: index + 1,
      editablePixels,
      changedPercent,
      averageDifference,
      passed: editablePixels > 0 && changedPercent >= 1.5 && averageDifference >= 18
    };
  });
  const failed = metrics.filter(item => !item.passed);
  return {
    passed: metrics.length > 0 && failed.length === 0,
    reason: failed.length
      ? `生成覆盖校验未通过：第 ${failed.map(item => item.index).join('、')} 个框没有形成足够印花变化。`
      : '',
    regions: metrics
  };
}

module.exports = {
  compositeTemplateEditResult,
  createTemplateMaskPreview,
  createTemplateEditMask,
  createTemplatePostCompositeMask,
  createTemplateRegionAnnotation,
  detectTemplateLightCabinetPanels,
  hasSemanticPrintableSurfaces,
  printableSurfaceArea,
  templateEditMaskMetrics,
  validateTemplatePrintCoverage
};
