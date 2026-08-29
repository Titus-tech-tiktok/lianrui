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

const CHILDRENWEAR_SIMPLE_FLAT_LAY_PROMPT = '图1保持版型背景不变，衣服款式图案严格精密还原替换成图2衣服，轻微自然布料褶皱，局部点缀浅淡衣纹，整体版型平整，低对比度柔和褶皱，符合重力轻微垂坠纹路，真实不夸张，版型工整美观，真实纯棉面料材质棉毛纹理质感，8K，电商超清摄影。';

function buildChildrenwearMasterPrompt() {
  return CHILDRENWEAR_SIMPLE_FLAT_LAY_PROMPT;
}

function buildChildrenwearModelPrompt(input = {}) {
  const extra = cleanText(input.extraInstruction);
  const variationSeed = cleanText(input.variationSeed) || 'auto';
  const backgroundMode = ['white', 'scene_reference'].includes(input.backgroundMode) ? input.backgroundMode : 'model_reference';
  const backgroundContract = backgroundMode === 'white'
    ? [
        'BACKGROUND MODE: PURE WHITE.',
        'Ignore the environment/background identity in image 2. Output a uniform RGB(255,255,255) ecommerce background, with only a subtle physically correct contact shadow. Do not add props, floor seams, gradients or scenery.'
      ]
    : backgroundMode === 'scene_reference'
      ? [
          'BACKGROUND MODE: INDEPENDENT SCENE REFERENCE.',
          '- image 3 is the only environment/background, props, camera-mood, lighting and ground-shadow reference. It never controls the person, pose, garment identity or garment folds.',
          structuredAnalysisBlock('SCENE_REFERENCE_SPEC — environment only:', input.sceneSpec),
          'Keep the person identity, body action, crop and garment deformation from image 2, but place that result naturally into image 3’s environment. Preserve physically valid occlusion and contact shadows. Never copy a person or garment from image 3.'
        ]
      : [
          'BACKGROUND MODE: FOLLOW MODEL REFERENCE.',
          'Image 2 controls the complete background, environment, props, camera mood, lighting and shadow as well as the person/action reference.'
        ];
  return [
    'CHILDRENSWEAR_STRUCTURED_MODEL_DRESSING_EXECUTION',
    'TASK: dress a model based on image 2 in the exact generated SKU flat-lay from image 1, while applying one controlled small natural variation to the model. This is not a new outfit design and not an unrelated pose redesign.',
    '',
    'INPUT ROLES — never swap them:',
    '- image 1 is the selected generated flat-lay and is the primary source of truth for the exact SKU. Its manual review state is not an input requirement.',
    `- image 2 is the final model, action, pose and garment-deformation reference.${backgroundMode === 'model_reference' ? ' It also controls the scene.' : ' Its background is not authoritative in this mode.'} Its original garment identity must be replaced.`,
    '- WHY image 1 was selected: it is the generated proof of the exact product being sold, including construction, artwork, craft and material behaviour.',
    `- WHY image 2 was selected: it demonstrates the desired selling-action family—body orientation, pose scale, body interaction, garment deformation, natural fold flow and crop.${backgroundMode === 'model_reference' ? ' It also supplies the scene and commercial mood.' : ''}`,
    `- CONTROLLED VARIATION ID: ${variationSeed}. Use it to choose a fresh but restrained expression-and-pose variation for this generation.`,
    '',
    structuredAnalysisBlock('PRODUCT_MANIFEST — immutable SKU identity inherited from the flat-lay task:', input.productManifest),
    '',
    structuredAnalysisBlock('MODEL_REFERENCE_SPEC — person, pose, deformation and occlusion blueprint; scene fields apply only in follow-model-reference mode:', input.referenceSpec),
    '',
    ...backgroundContract,
    '',
    'NON-NEGOTIABLE TWO-SOURCE LOCK — never blend the reference outfit with the sold SKU:',
    `REFERENCE PRESENTATION LOCK (image 2): keep the same model identity/type, anatomy, overall action category, body orientation, crop, garment occupancy, on-body outer envelope, detail-display intent, occlusion logic, fold-flow logic, tension/compression zones and relaxed asymmetry. Do not copy the exact expression or exact joint coordinates; apply only the controlled variation below.${backgroundMode === 'model_reference' ? ' Also keep its camera, complete background, lighting and shadow.' : ''}`,
    'PRODUCT IDENTITY LOCK (image 1 plus PRODUCT_MANIFEST): keep the exact sold garment style and cut, construction, component count, fabric, material, base colour, colour blocking, pattern, print, embroidery, applique, labels, pockets, seams, bindings, trims and closures.',
    'The on-body outline and fold map are controlled by the reference pose; the garment pattern-cut and merchandise identity are controlled by the selected generated product. Render the reference deformation using the real product material behaviour. Do not borrow the reference outfit’s colour, fabric, artwork, construction or style, and do not borrow the flat-lay background from image 1.',
    '',
    'EXECUTION CONTRACT:',
    `Treat image 2 as an action blueprint, not a loose style suggestion. Preserve model identity/type, hair styling, body proportions, overall body orientation, action category and crop.${backgroundMode === 'model_reference' ? ' Preserve its scene, camera and lighting too.' : ' Obtain the background/environment under the selected structured background mode above.'}`,
    'CONTROLLED RANDOM MICRO-VARIATION: choose a natural facial expression, gaze direction and small head-angle variation; also make a restrained change to shoulder line, hand gesture, weight distribution, stance or one limb bend. The change must remain within the same action category and camera framing. No dramatic turn, jump, squat, wide limb movement, large step, new prop interaction or different viewpoint. Keep anatomy realistic and ecommerce-friendly.',
    'COMPOSITION LOCK: keep the model visually centred in the final canvas and keep the garment-selling area clear, complete and unobstructed. Do not push the person to an edge, crop away important garment parts or let scenery dominate the frame.',
    backgroundMode === 'white'
      ? 'BACKGROUND VARIATION: none. Keep the required pure-white background uniform and unchanged.'
      : 'BACKGROUND MICRO-VARIATION: keep the same recognisable background family and visual style. Lock the reference scene type, main spatial structure, wall/floor treatment, dominant colours, camera viewpoint, framing, exposure, light direction, light softness, colour temperature, shadow character, depth of field, blur and bokeh. Variation is allowed only among small non-critical scene props: for example, a stool or small decoration may appear or disappear, its count may change slightly, or it may move a short distance while remaining plausible in the same room. Keep all changes restrained so two outputs still look photographed in the same background and under the same lighting setup. Never redesign the room, change the weather/time of day, alter focus or blur, introduce a dominant object, cover the product or move the centred person off-axis.',
    'Regenerate only the person/garment pixels required by that small variation and its physically necessary contact shadows. Protect the selected background source and unrelated scene elements.',
    'Transfer the reference garment-action logic to the real SKU, then adapt it physically to the chosen small pose variation: reproduce the reference fold flow and wrinkle zones—where the garment hangs, bends, gathers, compresses, overlaps or is pulled. Preserve the reference fold-flow character while recalculating exact wrinkle positions from the varied joints, gravity and contact points; derive fold scale, softness, thickness, drape and surface texture from the real SKU in image 1.',
    'The result must look naturally worn, with gravity-driven drape, body-contact folds, joint compression and believable tension. Never paste a rigid flat-lay silhouette onto the body, over-smooth the fabric, or create decorative wrinkles unrelated to the pose.',
    'Natural occlusion by the body, hair, hands or another garment is allowed. Hidden details may remain hidden; never relocate, duplicate or invent a detail merely to show it.',
    'Image 1 and PRODUCT_MANIFEST control every garment-specific fact. Never copy colour, material, print, label, pocket, seam, trim or construction from the original garment in image 2.',
    'If the reference garment type or piece count differs, dress the model in the real SKU using the closest physically valid local placement while preserving every compatible part of the model pose, on-body presentation outline, fold map, scene and shadow. Never convert the real SKU into the reference garment type.',
    `Before output, silently audit the locked sources: the pose stays within image 2's action family but has a visible small natural expression/pose variation; folds remain physically consistent with that variation and the reference fold-flow logic; style/fabric/colour/material/artwork/construction match image 1; ${backgroundMode === 'scene_reference' ? 'background/props/lighting match image 3' : backgroundMode === 'white' ? 'background is uniform pure white' : 'background/shadows match image 2'}. Correct any cross-contamination.`,
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
    'TASK: replace the products in the final composition reference with all supplied generated SKU flat-lays. This is slot-by-slot product replacement, not product redesign or style blending.',
    '',
    'INPUT ROLES — calculated for this request and never fixed in settings:',
    `Images 1 to ${count} are selected generated flat-lays. They are the only sources of truth for each SKU; their manual review states are not input requirements.`,
    `Image ${count + 1} is the target composition action blueprint. Preserve each slot's garment pose, sleeve and leg direction, natural bending, spreading or folding, fold flow, wrinkle zones, spacing, rotation, scale, front/back layer order, permitted overlap, crop, background, lighting and shadow style. It is never a product-identity source.`,
    `WHY images 1 to ${count} were selected: each one proves what exact SKU is being sold and locks its component count, construction, colour, artwork, craft, material signature and product-specific selling points.`,
    `WHY image ${count + 1} was selected: it demonstrates how those products should be sold visually—the action of every garment, relaxed placement, natural folds, spacing, hierarchy and finished ecommerce presentation.`,
    '',
    'PRODUCT MANIFESTS — one independent identity contract per supplied SKU:',
    ...manifest,
    '',
    structuredAnalysisBlock('COMBINATION_REFERENCE_SPEC — slot geometry and presentation only:', input.referenceSpec),
    '',
    'NON-NEGOTIABLE SOURCE LOCK:',
    `REFERENCE PRESENTATION LOCK (image ${count + 1}): reproduce the same canvas, crop, complete background colour/gradient/texture, lighting, shadow map, slot centers, scale, rotation, spacing, z-order, overlap, displayed outer envelopes, component placement, sleeve/leg/body directions, bends, folds, wrinkle zones and detail-display actions.`,
    `PRODUCT IDENTITY LOCK (images 1 to ${count}): each supplied SKU keeps its exact style and pattern-cut, construction, component count, fabric, material, base colour, colour blocking, graphics, print, embroidery, applique, labels, pockets, seams, bindings, trims and closures.`,
    'Reference slot outlines are placement/deformation targets, not permission to copy placeholder garment construction. Apply each slot’s fold geometry to the real SKU using that SKU’s own fabric thickness, drape, softness, texture and wrinkle character. Never average attributes or transfer an attribute from the wrong source.',
    '',
    'PRODUCT AND SLOT RULES:',
    'Create one premium e-commerce multi-SKU composition containing every supplied SKU exactly once.',
    'Silently inventory every supplied master independently: component count, silhouette, visible side, construction, colour, material, artwork, motif count and placement, labels, pockets, seams, closures, cuffs, hems, trims and natural wrinkles.',
    'Never blend design details between SKUs. Never copy garment design, graphics or colours from the composition reference.',
    'Map SKU 1 to composition slot 1, SKU 2 to slot 2, and so on. Each slot receives one whole SKU, including every component belonging to a multi-component SKU.',
    'Treat every reference slot as a concrete pose/deformation target, not merely a bounding box. Reproduce the reference action of tops, sleeves, bodies, waists, crotches, legs and cuffs as closely as the real SKU structure permits, including asymmetric bends and relaxed non-rigid placement.',
    'Match the location and direction of natural folds shown in the reference, but render their scale, depth, softness, thickness, drape and micro-texture from the corresponding generated SKU flat-lay. Never make the garments look like stiff cut-outs, perfectly ironed vector shapes or duplicated templates.',
    'The reference may show fewer, more or different product types. Use its slot geometry and visual hierarchy only; never use that mismatch to omit, merge, split or redesign a supplied SKU.',
    'Natural partial overlap, folding or edge occlusion is allowed only when required by the reference layout and physically valid for the supplied product. Every SKU must remain identifiable and no required component may disappear.',
    'Keep each SKU material and fold behaviour independent. Do not transfer colour, texture, print, trim, label or construction from one SKU to another.',
    'Before output, silently audit every slot: layout/background/fold/shadow/action matches the composition reference; product style/fabric/colour/material/artwork/construction matches its own selected generated flat-lay. Correct any cross-contamination.',
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

function median(values = []) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function rgbToHex(rgb = {}) {
  return `#${[rgb.r, rgb.g, rgb.b].map(value => clampByte(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function rgbToLab(rgb = {}) {
  const linear = [rgb.r, rgb.g, rgb.b].map(value => {
    const channel = clampByte(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124564 + linear[1] * 0.3575761 + linear[2] * 0.1804375) / 0.95047;
  const y = (linear[0] * 0.2126729 + linear[1] * 0.7151522 + linear[2] * 0.0721750);
  const z = (linear[0] * 0.0193339 + linear[1] * 0.1191920 + linear[2] * 0.9503041) / 1.08883;
  const f = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

function colorDeltaE(first, second) {
  const a = rgbToLab(first);
  const b = rgbToLab(second);
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function regionMedian(samples = []) {
  if (!samples.length) return null;
  return {
    r: clampByte(median(samples.map(item => item.r))),
    g: clampByte(median(samples.map(item => item.g))),
    b: clampByte(median(samples.map(item => item.b)))
  };
}

async function extractFlatReferenceBackgroundProfile(file) {
  // Read from the original uploaded asset. Downsampling is only an in-memory
  // sampling optimization; no thumbnail, preview or browser screenshot is used.
  const { data, info } = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width < 16 || height < 16 || channels < 3) throw new Error('参考图尺寸过小，无法提取原始背景');
  const band = Math.max(4, Math.round(Math.min(width, height) * 0.12));
  const stride = Math.max(1, Math.ceil(width * height / 260_000));
  const perimeter = [];
  const bins = new Map();
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (!(x < band || x >= width - band || y < band || y >= height - band)) continue;
      const offset = (y * width + x) * channels;
      const sample = { x, y, r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      perimeter.push(sample);
      const key = `${sample.r >> 4}:${sample.g >> 4}:${sample.b >> 4}`;
      bins.set(key, (bins.get(key) || 0) + 1);
    }
  }
  if (!perimeter.length) throw new Error('参考图没有可用的安全背景采样区域');
  const dominantKey = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const dominant = dominantKey.split(':').map(value => Number(value) * 16 + 8);
  let backgroundSamples = perimeter.filter(item => Math.max(
    Math.abs(item.r - dominant[0]),
    Math.abs(item.g - dominant[1]),
    Math.abs(item.b - dominant[2])
  ) <= 28);
  if (backgroundSamples.length < Math.max(40, perimeter.length * 0.08)) backgroundSamples = perimeter;
  const targetRgb = regionMedian(backgroundSamples);
  const deltas = backgroundSamples.map(item => colorDeltaE(item, targetRgb)).sort((a, b) => a - b);
  const percentile = ratio => deltas[Math.min(deltas.length - 1, Math.max(0, Math.floor((deltas.length - 1) * ratio)))] || 0;
  const subsets = {
    left: backgroundSamples.filter(item => item.x < width * 0.35),
    right: backgroundSamples.filter(item => item.x > width * 0.65),
    top: backgroundSamples.filter(item => item.y < height * 0.35),
    bottom: backgroundSamples.filter(item => item.y > height * 0.65),
    corners: backgroundSamples.filter(item => (item.x < band || item.x >= width - band) && (item.y < band || item.y >= height - band))
  };
  const sideDelta = colorDeltaE(regionMedian(subsets.left) || targetRgb, regionMedian(subsets.right) || targetRgb);
  const verticalDelta = colorDeltaE(regionMedian(subsets.top) || targetRgb, regionMedian(subsets.bottom) || targetRgb);
  const cornerDelta = colorDeltaE(regionMedian(subsets.corners) || targetRgb, targetRgb);
  const gradientStrength = Math.max(sideDelta, verticalDelta);
  return {
    type: percentile(0.95) <= 4.5 ? 'solid' : 'near_uniform',
    target_hex: rgbToHex(targetRgb),
    target_rgb: targetRgb,
    uniformity: {
      score: Number(Math.max(0, 1 - percentile(0.95) / 20).toFixed(4)),
      median_delta_e: Number(percentile(0.5).toFixed(3)),
      p95_delta_e: Number(percentile(0.95).toFixed(3)),
      sampled_pixels: backgroundSamples.length,
      source: 'original_reference_safe_perimeter_robust_median'
    },
    gradient: {
      present: gradientStrength > 3,
      direction: sideDelta >= verticalDelta ? 'horizontal' : 'vertical',
      strength_delta_e: Number(gradientStrength.toFixed(3))
    },
    vignette: {
      present: cornerDelta > 3,
      strength_delta_e: Number(cornerDelta.toFixed(3))
    },
    color_tolerance_delta_e: 3
  };
}

function mergeFlatReferenceBackgroundProfile(analysis = {}, measured = {}) {
  const aiProfile = analysis.background_profile && typeof analysis.background_profile === 'object'
    ? analysis.background_profile
    : {};
  return {
    ...analysis,
    background_profile: {
      ...aiProfile,
      ...measured,
      shadow: aiProfile.shadow && typeof aiProfile.shadow === 'object' ? aiProfile.shadow : {},
      color_tolerance_delta_e: 3
    }
  };
}

function buildChildrenwearFlatLayTransformPlan(productAnalysis = {}, referenceAnalysis = {}) {
  const productTruth = productAnalysis.product_truth && typeof productAnalysis.product_truth === 'object'
    ? productAnalysis.product_truth
    : productAnalysis;
  const targetGeometry = referenceAnalysis.target_geometry && typeof referenceAnalysis.target_geometry === 'object'
    ? referenceAnalysis.target_geometry
    : {};
  return {
    preserve_from_source: [
      'category and real component structure', 'base colour and colour blocking',
      'print content, scale, density, position and distribution', 'fabric texture and thickness',
      'collar, sleeve cuffs, ankle cuffs, closure, seams, bindings, trims and unique craft',
      ...(Array.isArray(productTruth.must_preserve) ? productTruth.must_preserve : [])
    ],
    match_from_reference: [
      'flat-lay pose and displayed outer envelope', 'canvas ratio, garment occupancy and centre position',
      'shoulder line, sleeve angles and lengths', 'crotch width/depth, leg angles and lengths',
      'flatness, symmetry, natural fold zones', 'background colour/profile, lighting and contact shadow'
    ],
    allowed_shape_adjustments: [
      'Only placement, spreading, bending, flattening and physically plausible fold changes needed to fit the real SKU into target_geometry.',
      'If reference geometry conflicts with the real construction, adapt only the incompatible local pose while preserving the source construction.'
    ],
    forbidden_changes: [
      'Do not copy reference colour, print, text, labels, decoration, material or garment construction.',
      'Do not invent hidden product parts, seams, closures, pockets, trims or artwork.',
      ...(Array.isArray(productTruth.must_not_invent) ? productTruth.must_not_invent : [])
    ],
    geometry_constraints: {
      target: targetGeometry,
      garment_canvas_coverage_tolerance: 0.03,
      center_position_tolerance: 0.02,
      background_color_tolerance_delta_e: 3,
      product_truth_wins_on_structural_conflict: true
    }
  };
}

function normalizedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function flatLayApiSizeForReference(file) {
  const metadata = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 }).metadata();
  let width = Number(metadata.width) || 0;
  let height = Number(metadata.height) || 0;
  if ([5, 6, 7, 8].includes(Number(metadata.orientation))) [width, height] = [height, width];
  if (width < 1 || height < 1) throw new Error('参考图尺寸无效，无法决定平铺图输出比例');
  const aspectRatio = width / height;
  const choices = [
    { size: '1024x1536', aspectRatio: 2 / 3, orientation: 'portrait' },
    { size: '1024x1024', aspectRatio: 1, orientation: 'square' },
    { size: '1536x1024', aspectRatio: 3 / 2, orientation: 'landscape' }
  ];
  const selected = choices.reduce((best, choice) => (
    Math.abs(choice.aspectRatio - aspectRatio) < Math.abs(best.aspectRatio - aspectRatio) ? choice : best
  ), choices[0]);
  return {
    width,
    height,
    aspectRatio: Number(aspectRatio.toFixed(6)),
    orientation: selected.orientation,
    size: selected.size
  };
}

function fillSilhouetteInterior(seedMask, width, height) {
  const rowMin = new Int32Array(height).fill(width);
  const rowMax = new Int32Array(height).fill(-1);
  const columnMin = new Int32Array(width).fill(height);
  const columnMax = new Int32Array(width).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!seedMask[y * width + x]) continue;
      rowMin[y] = Math.min(rowMin[y], x);
      rowMax[y] = Math.max(rowMax[y], x);
      columnMin[x] = Math.min(columnMin[x], y);
      columnMax[x] = Math.max(columnMax[x], y);
    }
  }
  const filled = new Uint8Array(seedMask);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizontalInterior = rowMax[y] - rowMin[y] >= 2 && x >= rowMin[y] && x <= rowMax[y];
      const verticalInterior = columnMax[x] - columnMin[x] >= 2 && y >= columnMin[x] && y <= columnMax[x];
      if (horizontalInterior && verticalInterior) filled[y * width + x] = 1;
    }
  }
  return filled;
}

async function flatLaySilhouette(file, backgroundRgb, dimension = 256) {
  const ownProfile = await extractFlatReferenceBackgroundProfile(file);
  const background = backgroundRgb || ownProfile.target_rgb;
  const { data, info } = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .rotate()
    .toColourspace('srgb')
    .resize({ width: dimension, height: dimension, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const threshold = Math.max(8, Number(ownProfile.uniformity?.p95_delta_e || 0) + 4);
  const seedMask = new Uint8Array(info.width * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      const offset = index * info.channels;
      const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      if (colorDeltaE(pixel, background) > threshold) seedMask[index] = 1;
    }
  }
  // A garment can be almost the same colour as its background. Colour-only
  // counting then sees prints and shadows but misses the fabric interior.
  // Cross-fill the bounded interior so coverage represents the silhouette,
  // while the horizontal/vertical intersection preserves leg and sleeve gaps.
  const mask = fillSilhouetteInterior(seedMask, info.width, info.height);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let foregroundPixels = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      if (!mask[index]) continue;
      foregroundPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const boundary = new Uint8Array(mask.length);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      if (!mask[index]) continue;
      if (x === 0 || y === 0 || x + 1 === info.width || y + 1 === info.height
        || !mask[index - 1] || !mask[index + 1] || !mask[index - info.width] || !mask[index + info.width]) boundary[index] = 1;
    }
  }
  const detected = maxX >= minX && maxY >= minY;
  const bbox = detected ? {
    x: Number((minX / info.width).toFixed(4)),
    y: Number((minY / info.height).toFixed(4)),
    width: Number(((maxX - minX + 1) / info.width).toFixed(4)),
    height: Number(((maxY - minY + 1) / info.height).toFixed(4))
  } : null;
  return {
    width: info.width,
    height: info.height,
    mask,
    boundary,
    bbox,
    center: bbox ? { x: Number((bbox.x + bbox.width / 2).toFixed(4)), y: Number((bbox.y + bbox.height / 2).toFixed(4)) } : null,
    // In the structured contract garment_canvas_coverage means the occupied
    // product rectangle, not the ratio of opaque fabric pixels. BBox coverage
    // remains stable for openings between legs and similarly coloured fabric.
    coverage: bbox ? Number((bbox.width * bbox.height).toFixed(4)) : 0,
    foregroundCoverage: Number((foregroundPixels / mask.length).toFixed(4))
  };
}

function maskIntersectionOverUnion(first, second) {
  if (!first || !second || first.length !== second.length) return null;
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] || second[index]) union += 1;
    if (first[index] && second[index]) intersection += 1;
  }
  return union ? Number((intersection / union).toFixed(4)) : null;
}

function flattenedGeometryKeypoints(keypoints = {}) {
  const points = [];
  const add = (label, value) => {
    if (!value || typeof value !== 'object') return;
    const x = normalizedNumber(value.x);
    const y = normalizedNumber(value.y);
    if (x != null && y != null && x >= 0 && x <= 1 && y >= 0 && y <= 1) points.push({ label, x, y });
  };
  for (const key of ['neckline', 'crotch']) add(key, keypoints[key]);
  for (const key of ['shoulders', 'armpits', 'sleeve_cuffs', 'legs', 'ankle_cuffs']) {
    for (const [index, point] of (Array.isArray(keypoints[key]) ? keypoints[key] : []).entries()) add(`${key}.${index}`, point);
  }
  return points;
}

function nearestBoundaryPoint(silhouette, point) {
  let best = null;
  for (let index = 0; index < silhouette.boundary.length; index += 1) {
    if (!silhouette.boundary[index]) continue;
    const x = (index % silhouette.width) / silhouette.width;
    const y = Math.floor(index / silhouette.width) / silhouette.height;
    const distance = Math.hypot(x - point.x, y - point.y);
    if (!best || distance < best.distance) best = { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), distance };
  }
  return best ? { ...best, distance: Number(best.distance.toFixed(4)) } : null;
}

function lineAngle(first, second) {
  if (!first || !second) return null;
  return Math.atan2(second.y - first.y, second.x - first.x) * 180 / Math.PI;
}

function angleDifference(first, second) {
  if (first == null || second == null) return null;
  let difference = Math.abs(first - second) % 360;
  if (difference > 180) difference = 360 - difference;
  return Number(difference.toFixed(2));
}

function limbAngleChecks(matches, keypoints, limbName, startName, endName) {
  const ends = Array.isArray(keypoints[endName]) ? keypoints[endName] : [];
  const sharedStart = !Array.isArray(keypoints[startName]) && keypoints[startName] && typeof keypoints[startName] === 'object' ? keypoints[startName] : null;
  const starts = Array.isArray(keypoints[startName]) ? keypoints[startName] : sharedStart ? ends.map(() => sharedStart) : [];
  const results = [];
  for (let index = 0; index < Math.min(starts.length, ends.length); index += 1) {
    const targetStart = starts[index];
    const targetEnd = ends[index];
    const outputStart = matches.get(sharedStart ? startName : `${startName}.${index}`)?.matched;
    const outputEnd = matches.get(`${endName}.${index}`)?.matched;
    const targetAngle = lineAngle(targetStart, targetEnd);
    const outputAngle = lineAngle(outputStart, outputEnd);
    if (targetAngle == null || outputAngle == null) continue;
    results.push({ side: index + 1, target_degrees: Number(targetAngle.toFixed(2)), measured_degrees: Number(outputAngle.toFixed(2)), error_degrees: angleDifference(targetAngle, outputAngle) });
  }
  return { name: limbName, count: results.length, items: results, maximum_error_degrees: results.length ? Math.max(...results.map(item => item.error_degrees)) : null };
}

async function inspectFlatLayOutput(file, referenceAnalysis = {}, referenceFile = '') {
  const targetProfile = referenceAnalysis.background_profile || {};
  const targetRgb = targetProfile.target_rgb && typeof targetProfile.target_rgb === 'object'
    ? targetProfile.target_rgb
    : null;
  const outputProfile = await extractFlatReferenceBackgroundProfile(file);
  const backgroundDeltaE = targetRgb ? colorDeltaE(outputProfile.target_rgb, targetRgb) : null;
  const targetGeometry = referenceAnalysis.target_geometry || {};
  const outputSilhouette = await flatLaySilhouette(file, targetRgb || outputProfile.target_rgb);
  const referenceSilhouette = referenceFile ? await flatLaySilhouette(referenceFile, targetRgb || outputProfile.target_rgb) : null;
  const bbox = outputSilhouette.bbox;
  const center = outputSilhouette.center;
  const coverage = outputSilhouette.coverage;
  const structuredTargetCoverage = normalizedNumber(targetGeometry.garment_canvas_coverage);
  const structuredTargetCenter = targetGeometry.center_position && typeof targetGeometry.center_position === 'object'
    ? targetGeometry.center_position
    : null;
  const targetCoverage = structuredTargetCoverage ?? referenceSilhouette?.coverage ?? null;
  const targetCenter = structuredTargetCenter || referenceSilhouette?.center || {};
  const centerError = center && normalizedNumber(targetCenter.x) != null && normalizedNumber(targetCenter.y) != null
    ? {
        x: Number(Math.abs(center.x - Number(targetCenter.x)).toFixed(4)),
        y: Number(Math.abs(center.y - Number(targetCenter.y)).toFixed(4))
      }
    : null;
  const keypoints = targetGeometry.keypoints && typeof targetGeometry.keypoints === 'object' ? targetGeometry.keypoints : {};
  const landmarkItems = flattenedGeometryKeypoints(keypoints).map(point => ({
    label: point.label,
    target: { x: point.x, y: point.y },
    matched: nearestBoundaryPoint(outputSilhouette, point)
  }));
  const landmarkMap = new Map(landmarkItems.map(item => [item.label, item]));
  const landmarkDistances = landmarkItems.map(item => item.matched?.distance).filter(value => value != null);
  const crotch = landmarkMap.get('crotch');
  const sleeveAngles = limbAngleChecks(landmarkMap, keypoints, 'sleeves', 'shoulders', 'sleeve_cuffs');
  const legAngles = limbAngleChecks(landmarkMap, keypoints, 'legs', 'crotch', 'ankle_cuffs');
  return {
    method: 'deterministic_background_and_silhouette_comparison',
    advisory_only: true,
    background: {
      measured_hex: outputProfile.target_hex,
      target_hex: String(targetProfile.target_hex || ''),
      delta_e: backgroundDeltaE == null ? null : Number(backgroundDeltaE.toFixed(3)),
      within_tolerance: backgroundDeltaE == null ? null : backgroundDeltaE <= 3
    },
    geometry: {
      target_source: structuredTargetCoverage != null && structuredTargetCenter
        ? 'structured_reference_analysis'
        : 'original_reference_image',
      target_bbox: targetGeometry.garment_bbox || referenceSilhouette?.bbox || null,
      target_center: normalizedNumber(targetCenter.x) != null && normalizedNumber(targetCenter.y) != null
        ? { x: Number(targetCenter.x), y: Number(targetCenter.y) }
        : null,
      target_coverage: targetCoverage,
      detected_bbox: bbox,
      detected_center: center,
      detected_coverage: coverage,
      detected_foreground_coverage: outputSilhouette.foregroundCoverage,
      coverage_error: targetCoverage == null ? null : Number(Math.abs(coverage - targetCoverage).toFixed(4)),
      center_error: centerError,
      coverage_within_tolerance: targetCoverage == null ? null : Math.abs(coverage - targetCoverage) <= 0.03,
      center_within_tolerance: centerError == null ? null : centerError.x <= 0.02 && centerError.y <= 0.02,
      contour_similarity_iou: referenceSilhouette ? maskIntersectionOverUnion(outputSilhouette.mask, referenceSilhouette.mask) : null,
      keypoint_alignment: {
        checked: landmarkDistances.length,
        mean_error: landmarkDistances.length ? Number((landmarkDistances.reduce((sum, value) => sum + value, 0) / landmarkDistances.length).toFixed(4)) : null,
        maximum_error: landmarkDistances.length ? Number(Math.max(...landmarkDistances).toFixed(4)) : null,
        within_tolerance: landmarkDistances.length ? landmarkDistances.every(value => value <= 0.03) : null,
        items: landmarkItems
      },
      sleeve_angle_checks: sleeveAngles,
      leg_angle_checks: legAngles,
      crotch_check: crotch ? { target: crotch.target, matched: crotch.matched, error: crotch.matched?.distance ?? null, within_tolerance: crotch.matched ? crotch.matched.distance <= 0.03 : false } : null
    }
  };
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
  if (unique.length < 2) throw new Error('组合图至少需要选择 2 个已生成平铺图');
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
  buildChildrenwearFlatLayTransformPlan,
  colorDeltaE,
  extractFlatReferenceBackgroundProfile,
  flatLayApiSizeForReference,
  inspectFlatLayOutput,
  mergeFlatReferenceBackgroundProfile,
  normalizeBackground
};
