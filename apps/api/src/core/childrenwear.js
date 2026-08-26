const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

// The catalogue is open-ended. Sample folder names must never become the
// application's garment taxonomy or decide material behaviour.
const CATEGORY_RULES = Object.freeze({});
const MATERIAL_RULES = Object.freeze({});

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
}

function childrenwearPieceCount(input = {}) {
  const explicit = Number(input.pieceCount ?? input.piece_count ?? input.productManifest?.piece_count);
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= 8) return explicit;
  return null;
}

function structuredAnalysisBlock(label, value) {
  if (!value || typeof value !== 'object') return `${label}\n{}`;
  const json = JSON.stringify(value, null, 2);
  return `${label}\n${json.length > 80000 ? json.slice(0, 80000) : json}`;
}

function childrenwearDetailCount(input = {}) {
  const count = Number(input.detailCount ?? input.detail_count);
  return Number.isInteger(count) ? Math.max(0, Math.min(8, count)) : 3;
}

function pieceCountContract(pieceCount, sourceLabel) {
  if (pieceCount) {
    return `Declared piece count: ${pieceCount}. The output must contain exactly ${pieceCount} separate garment component${pieceCount === 1 ? '' : 's'} belonging to this SKU.`;
  }
  return `Piece count is not declared. Silently count every separate garment component belonging to this SKU in ${sourceLabel}, then preserve that exact count. Never infer piece count from a folder name, category example or reference product.`;
}

function productEvidenceContract({ category, material, craft, sourceLabel }) {
  return [
    `Declared category or folder label: ${category || 'not provided'}. This is a metadata hint only. Determine the actual garment type and construction from ${sourceLabel}; never force the product into a fixed sample category.`,
    `Declared material label: ${material || 'not provided'}. Treat it only as a hint. Reproduce the visible fibre or yarn character, weave or knit structure, pile, thickness, opacity, stretch response, drape, sheen, compression, edge behaviour and wrinkle scale from ${sourceLabel}.`,
    `Declared craft note: ${craft || 'not provided'}. Preserve every craft detail that is actually visible; do not invent a craft merely because it appears in metadata.`
  ];
}

const UNIVERSAL_PRODUCT_IDENTITY_RULES = Object.freeze([
  'Silently classify the supplied product by visible construction. The catalogue is open-ended and may contain any babywear or childrenswear category, coordinated set, reversible item, layered item, accessory, or a new category not listed in this prompt.',
  'Build an internal product fingerprint from the primary product evidence before rendering: component count; visible side; silhouette and proportions; panel topology; openings and fastening path; neckline, shoulders, sleeves, cuffs, waist, rise, crotch, legs, hems and foot openings where applicable; pockets; seams and stitch lines; bindings and trims; buttons, snaps, zippers and drawcords; labels; prints; embroidery; appliques; patches and every other visible construction detail.',
  'For multi-component SKUs, inventory every component separately and preserve their relationship. Never omit a component, merge components into a new garment, or split one garment into several products.',
  'For all-over prints or repeated motifs, preserve motif identity, direction, density, scale, spacing and continuity across panels. For isolated motifs, labels or patches, preserve exact count, colour, scale and relative coordinates. Never replace artwork with a merely similar design.',
  'For asymmetrical, front/back, reversible, partially folded or partially occluded products, preserve the visible side and the evidence-supported asymmetry. Do not mirror, symmetrise, invent a reverse side or expose hidden construction.',
  'If a region is unclear, preserve only what is supported by visible evidence. Do not guess a logo, label text, hidden pocket, closure, seam, garment component or decoration.',
  'Material realism is a product fact. Preserve micro-texture and natural construction-dependent folds; do not beautify the item into an unnaturally smooth, plastic, satin, knitted, woven, fluffy, transparent or rigid material that contradicts the evidence.'
]);

const UNIVERSAL_REFERENCE_RULES = Object.freeze([
  'Use the final reference image only as the target ecommerce presentation blueprint: canvas, crop, product occupancy, placement, rotation, display pose, spreading or folding logic, fold direction, background, camera, lighting and shadow style.',
  'The reference product is not an identity source. Replace its category-specific construction, colour, material, graphics, labels, pockets, seams, trims and decorations with the real SKU.',
  'When the reference pose is physically incompatible with the real product structure or piece count, preserve the reference presentation intention and composition while making only the minimum structural adaptation required by the real SKU. Product truth always wins over copying an impossible pose.',
  'Do not retain the casual photographed pose, table, room, camera distortion or unrelated objects from the real-photo evidence.'
]);

function buildChildrenwearMasterPrompt(input = {}) {
  const extra = cleanText(input.extraInstruction);
  return [
    'CHILDRENSWEAR_STRUCTURED_FLAT_LAY_EXECUTION',
    'TASK: create one finished ecommerce flat-lay image. Use the target presentation from image 2, but replace its original garment identity with the exact SKU documented by image 1 and PRODUCT_MANIFEST.',
    '',
    'INPUT ROLES — never swap them:',
    '- image 1 is the original real product photo and the visual source of truth for product identity.',
    '- image 2 is the finished flat-lay reference and the visual source of truth for presentation only.',
    '',
    structuredAnalysisBlock('PRODUCT_MANIFEST — what the product is:', input.productManifest),
    '',
    structuredAnalysisBlock('FLAT_REFERENCE_SPEC — how the final image must be presented:', input.referenceSpec),
    '',
    'EXECUTION CONTRACT:',
    '1. PRODUCT_MANIFEST and image 1 control component count, garment type, visible side, silhouette, panel topology, colour, material, print, embroidery, applique, label, pocket, seam, binding, trim, closure and every other product-specific fact.',
    '2. FLAT_REFERENCE_SPEC and image 2 control canvas, crop, product occupancy, placement, rotation, display pose, spreading/folding logic, fold direction, background, camera, lighting and shadow.',
    '3. Never copy product identity from image 2. Never preserve the casual pose, table, room, distortion or unrelated objects from image 1.',
    '4. When the reference pose is physically incompatible with the real SKU, preserve its presentation intention with the smallest valid adaptation. Product identity and component count always win.',
    '5. Preserve exact motif/label count, colour, scale and relative coordinates. Preserve material micro-texture and construction-dependent wrinkles. Do not invent hidden structure or unreadable text.',
    '6. Protect all non-product pixels and protected scene elements from image 2 except where replacing its garment physically requires a clean boundary or contact shadow.',
    '',
    'OUTPUT:',
    'Return exactly one finished ecommerce image with the same presentation and aspect ratio as image 2.',
    'No model, hanger, packaging, text overlay, watermark, border, collage or extra product.',
    'Output only the final image and no explanation.',
    extra ? `Operator note: ${extra}` : ''
  ].filter(Boolean).join('\n');
}

function buildChildrenwearModelPrompt(input = {}) {
  const extra = cleanText(input.extraInstruction);
  return [
    'CHILDRENSWEAR_STRUCTURED_MODEL_DRESSING_EXECUTION',
    'TASK: replace only the garment worn in image 2 with the exact approved SKU from image 1. This is controlled virtual dressing, not a new outfit design and not a model recreation.',
    '',
    'INPUT ROLES — never swap them:',
    '- image 1 is the approved flat-lay master and is the primary source of truth for the exact SKU.',
    '- image 2 is the final model, pose and scene reference. Its original garment identity must be replaced.',
    '',
    structuredAnalysisBlock('PRODUCT_MANIFEST — immutable SKU identity inherited from the approved flat-lay task:', input.productManifest),
    '',
    structuredAnalysisBlock('MODEL_REFERENCE_SPEC — person, pose, scene, deformation and occlusion blueprint:', input.referenceSpec),
    '',
    'EXECUTION CONTRACT:',
    'Preserve the model identity, face, hair, expression, body proportions, hands, feet, pose, scene, camera and lighting from image 2.',
    'Replace only the garment region and physically necessary contact shadows. Keep all non-garment pixels and foreground occluders protected.',
    'Adapt the real garment only by physically necessary deformation around the body and pose. Folds must follow gravity, material behaviour, body contact and joint bending.',
    'Natural occlusion by the body, hair, hands or another garment is allowed. Hidden details may remain hidden; never relocate, duplicate or invent a detail merely to show it.',
    'Image 1 and PRODUCT_MANIFEST control every garment-specific fact. Never copy colour, material, print, label, pocket, seam, trim or construction from the original garment in image 2.',
    'If the reference garment type or piece count differs, dress the model in the real SKU using the closest physically valid placement while preserving the model pose and scene. Never convert the real SKU into the reference garment type.',
    'No extra fingers or limbs, no warped anatomy, no floating garment, no duplicated motif, no melted seam and no invented accessory.',
    '',
    'OUTPUT:',
    'Output one finished e-commerce model photo without text, watermark, border or collage.',
    'Output only the final image and no explanation.',
    extra ? `Operator note: ${extra}` : ''
  ].filter(Boolean).join('\n');
}

function buildChildrenwearCombinationPrompt(input = {}) {
  const count = Math.max(2, Math.min(4, Number(input.count) || 2));
  const items = Array.isArray(input.items) ? input.items.slice(0, count) : [];
  const manifest = Array.from({ length: count }, (_, index) => {
    const item = items[index] || {};
    return `SKU ${index + 1} / image ${index + 1}\n${JSON.stringify(item.productManifest || item, null, 2)}`;
  });
  return [
    'CHILDRENSWEAR_STRUCTURED_MULTI_SKU_EXECUTION',
    'TASK: replace the products in the final composition reference with all supplied approved SKUs. This is slot-by-slot product replacement, not product redesign or style blending.',
    '',
    'INPUT ROLES — calculated for this request and never fixed in settings:',
    `Images 1 to ${count} are approved flat-lay masters. They are the only sources of truth for each SKU.`,
    `Image ${count + 1} is the target composition blueprint. Preserve its layout slots, spacing, rotation, scale, front/back layer order, permitted overlap or folding, crop, background, lighting and shadow style. It is never a product-identity source.`,
    '',
    'PRODUCT MANIFESTS — one independent identity contract per supplied SKU:',
    ...manifest,
    '',
    structuredAnalysisBlock('COMBINATION_REFERENCE_SPEC — slot geometry and presentation only:', input.referenceSpec),
    '',
    'PRODUCT AND SLOT RULES:',
    'Create one premium e-commerce multi-SKU composition containing every supplied SKU exactly once.',
    'Silently inventory every supplied master independently: component count, silhouette, visible side, construction, colour, material, artwork, motif count and placement, labels, pockets, seams, closures, cuffs, hems, trims and natural wrinkles.',
    'Never blend design details between SKUs. Never copy garment design, graphics or colours from the composition reference.',
    'Map SKU 1 to composition slot 1, SKU 2 to slot 2, and so on. Each slot receives one whole SKU, including every component belonging to a multi-component SKU.',
    'The reference may show fewer, more or different product types. Use its slot geometry and visual hierarchy only; never use that mismatch to omit, merge, split or redesign a supplied SKU.',
    'Natural partial overlap, folding or edge occlusion is allowed only when required by the reference layout and physically valid for the supplied product. Every SKU must remain identifiable and no required component may disappear.',
    'Keep each SKU material and fold behaviour independent. Do not transfer colour, texture, print, trim, label or construction from one SKU to another.',
    '',
    'OUTPUT:',
    'No model, text, watermark, border, collage frame, packaging or extra product.',
    'Output exactly one final ecommerce composition image and no explanation.'
  ].join('\n');
}

function cropBox(width, height, xRatio, yRatio, widthRatio, heightRatio) {
  const left = Math.max(0, Math.min(width - 2, Math.round(width * xRatio)));
  const top = Math.max(0, Math.min(height - 2, Math.round(height * yRatio)));
  const cropWidth = Math.max(2, Math.min(width - left, Math.round(width * widthRatio)));
  const cropHeight = Math.max(2, Math.min(height - top, Math.round(height * heightRatio)));
  return { left, top, width: cropWidth, height: cropHeight };
}

async function createChildrenwearEvidence(sourcePath, outputFolder) {
  await fs.mkdir(outputFolder, { recursive: true });
  // Normalize phone-camera EXIF orientation before calculating crop geometry.
  // Reading metadata directly from a rotate() pipeline still reports the raw
  // sensor dimensions, which can swap width/height at extraction time.
  const { data: normalizedSource, info: metadata } = await sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  if (width < 16 || height < 16) throw new Error('实拍图尺寸过小，无法提取细节');
  const specs = [
    ['upper-structure.jpg', cropBox(width, height, 0.12, 0.08, 0.76, 0.40)],
    ['material-detail.jpg', cropBox(width, height, 0.25, 0.27, 0.50, 0.46)],
    ['lower-details.jpg', cropBox(width, height, 0.12, 0.52, 0.76, 0.40)]
  ];
  const files = [];
  for (const [name, box] of specs) {
    const target = path.join(outputFolder, name);
    await sharp(normalizedSource, { failOn: 'none' })
      .extract(box)
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toFile(target);
    files.push(target);
  }
  return files;
}

function normalizeBackground(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : '#eef0e5';
}

function colorDistance(data, offset, background) {
  return Math.max(
    Math.abs(data[offset] - background[0]),
    Math.abs(data[offset + 1] - background[1]),
    Math.abs(data[offset + 2] - background[2])
  );
}

async function removeConnectedBackground(file) {
  const prepared = sharp(file, { failOn: 'none' }).rotate().resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await prepared.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const samples = [];
  const span = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const corners = [[0, 0], [width - span, 0], [0, height - span], [width - span, height - span]];
  for (const [startX, startY] of corners) {
    for (let y = startY; y < Math.min(height, startY + span); y += 1) {
      for (let x = startX; x < Math.min(width, startX + span); x += 1) {
        const offset = (y * width + x) * channels;
        samples.push([data[offset], data[offset + 1], data[offset + 2]]);
      }
    }
  }
  const background = [0, 1, 2].map(channel => Math.round(samples.reduce((sum, item) => sum + item[channel], 0) / Math.max(1, samples.length)));
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = index => {
    if (visited[index]) return;
    const offset = index * channels;
    if (colorDistance(data, offset, background) > 34) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index]) data[index * channels + 3] = 0;
  }
  return sharp(data, { raw: info }).png().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
}

function combinationLayout(count, size) {
  const layouts = {
    2: [
      { left: 90, top: 245, width: 720, angle: -4 },
      { left: 790, top: 220, width: 720, angle: 4 }
    ],
    3: [
      { left: 90, top: 180, width: 620, angle: -5 },
      { left: 890, top: 180, width: 620, angle: 5 },
      { left: 490, top: 650, width: 620, angle: 0 }
    ],
    4: [
      { left: 80, top: 100, width: 650, angle: -3 },
      { left: 870, top: 100, width: 650, angle: 3 },
      { left: 80, top: 820, width: 650, angle: 3 },
      { left: 870, top: 820, width: 650, angle: -3 }
    ]
  };
  return (layouts[count] || layouts[2]).map(item => ({
    ...item,
    left: Math.round(item.left * size / 1600),
    top: Math.round(item.top * size / 1600),
    width: Math.round(item.width * size / 1600)
  }));
}

async function createChildrenwearCombination(masterPaths, outputPath, options = {}) {
  const unique = [...new Set((masterPaths || []).map(String))].slice(0, 4);
  if (unique.length < 2) throw new Error('组合图至少需要选择 2 个已审核母版');
  const size = Math.max(1024, Math.min(2400, Number(options.size) || 1600));
  const background = normalizeBackground(options.background);
  const layout = combinationLayout(unique.length, size);
  const composites = [];
  for (let index = 0; index < unique.length; index += 1) {
    const foreground = await removeConnectedBackground(unique[index]);
    const item = layout[index];
    const input = await sharp(foreground)
      .resize({ width: item.width, height: item.width, fit: 'inside', withoutEnlargement: false })
      .rotate(item.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input, left: item.left, top: item.top });
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  return outputPath;
}

module.exports = {
  CATEGORY_RULES,
  MATERIAL_RULES,
  childrenwearDetailCount,
  childrenwearPieceCount,
  buildChildrenwearMasterPrompt,
  buildChildrenwearModelPrompt,
  buildChildrenwearCombinationPrompt,
  createChildrenwearCombination,
  createChildrenwearEvidence,
  normalizeBackground
};
