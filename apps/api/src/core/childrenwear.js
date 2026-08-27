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
    '- WHY image 1 was selected: it identifies the exact product being sold and its visible selling points—component count, silhouette, construction, colour, artwork, craft and material signature.',
    '- WHY image 2 was selected: it demonstrates the desired ecommerce display action—how the garment is placed, spread, bent or folded; where natural wrinkles form; and how composition, occupancy, background, light and shadow should look.',
    '',
    structuredAnalysisBlock('PRODUCT_MANIFEST — what the product is:', input.productManifest),
    '',
    structuredAnalysisBlock('FLAT_REFERENCE_SPEC — how the final image must be presented:', input.referenceSpec),
    '',
    'NON-NEGOTIABLE TWO-SOURCE LOCK — do not blend, average or trade attributes between the two images:',
    'A. REFERENCE PRESENTATION LOCK (image 2): reproduce the reference presentation with maximum visual fidelity. Lock the canvas and aspect ratio; crop; product occupancy; center and scale; rotation; the displayed outer envelope created by its laying pose; sleeve/leg/body direction; bending, spreading, folding and overlap; every major fold and wrinkle zone; contact-shadow footprint, direction, softness and opacity; lighting; and the complete background colour, gradient and texture. Background pixels must come from image 2, never from image 1.',
    'B. PRODUCT IDENTITY LOCK (image 1): reproduce the actual merchandise with maximum visual fidelity. Lock the real garment category and component count; pattern-cut and construction; proportions between panels and components; fabric and material; base colour and colour blocking; print/embroidery/applique/label artwork; pockets, seams, bindings, trims, closures and all visible product details. None of these facts may come from image 2.',
    'C. “Reference silhouette” means only the visible ecommerce display outline caused by placement, gravity and folds. It never means copying the reference garment pattern, panel construction or style. “Real product style” means the actual cut and construction of image 1. Preserve both by posing the real product into the reference display outline without redesigning it.',
    'D. Fold geometry comes from image 2: match fold locations, directions, gathering points, compression zones and relaxed asymmetry. Fold appearance comes from image 1: render those folds with the real fabric thickness, softness, drape, surface texture and wrinkle scale. Never copy the reference fabric.',
    'E. If an exact reference pose is physically impossible for the real component count or construction, change only the impossible local part. Keep every other reference-controlled pixel relationship unchanged. Never solve a conflict by changing product colour, fabric, artwork, material, construction or component count.',
    '',
    'EXECUTION CONTRACT:',
    '1. PRODUCT_MANIFEST and image 1 control component count, garment type, visible side, silhouette, panel topology, colour, material, print, embroidery, applique, label, pocket, seam, binding, trim, closure and every other product-specific fact.',
    '2. FLAT_REFERENCE_SPEC and image 2 control canvas, crop, product occupancy, placement, rotation, display pose, spreading/folding logic, fold direction, background, camera, lighting and shadow.',
    '3. Never copy product identity from image 2. Never preserve the casual pose, table, room, distortion or unrelated objects from image 1.',
    '4. The target is not a new composition inspired by image 2. It is the image-2 presentation with only its placeholder garment identity replaced by the exact image-1 SKU. When a local pose is physically incompatible, preserve all compatible reference geometry and make the smallest local adaptation only.',
    '5. Preserve exact motif/label count, colour, scale and relative coordinates. Preserve material micro-texture and construction-dependent wrinkles. Do not invent hidden structure or unreadable text.',
    '6. Transfer the reference action and fold flow, not the reference garment identity. Reproduce its natural relaxed placement and wrinkle zones as closely as the real SKU permits, while deriving wrinkle scale, depth, softness, drape, thickness and surface texture only from image 1 and PRODUCT_MANIFEST.',
    '7. Protect all non-product pixels and protected scene elements from image 2 except where replacing its garment physically requires a clean boundary or contact shadow. Do not recolour, simplify, regenerate or “improve” the background.',
    '8. Before output, perform a silent two-column audit. Reference column: canvas, background, display outline, pose, fold map, shadow map and detail-placement action match image 2. Product column: garment style, construction, fabric, colour, material, artwork and visible details match image 1. If any attribute came from the wrong column, correct it before output.',
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
    'TASK: dress a model based on image 2 in the exact approved SKU from image 1, while applying one controlled small natural variation to the model. This is not a new outfit design and not an unrelated pose redesign.',
    '',
    'INPUT ROLES — never swap them:',
    '- image 1 is the approved flat-lay master and is the primary source of truth for the exact SKU.',
    `- image 2 is the final model, action, pose and garment-deformation reference.${backgroundMode === 'model_reference' ? ' It also controls the scene.' : ' Its background is not authoritative in this mode.'} Its original garment identity must be replaced.`,
    '- WHY image 1 was selected: it is the approved proof of the exact product being sold, including construction, artwork, craft and material behaviour.',
    `- WHY image 2 was selected: it demonstrates the desired selling-action family—body orientation, pose scale, body interaction, garment deformation, natural fold flow and crop.${backgroundMode === 'model_reference' ? ' It also supplies the scene and commercial mood.' : ''}`,
    `- CONTROLLED VARIATION ID: ${variationSeed}. Use it to choose a fresh but restrained expression-and-pose variation for this generation.`,
    '',
    structuredAnalysisBlock('PRODUCT_MANIFEST — immutable SKU identity inherited from the approved flat-lay task:', input.productManifest),
    '',
    structuredAnalysisBlock('MODEL_REFERENCE_SPEC — person, pose, deformation and occlusion blueprint; scene fields apply only in follow-model-reference mode:', input.referenceSpec),
    '',
    ...backgroundContract,
    '',
    'NON-NEGOTIABLE TWO-SOURCE LOCK — never blend the reference outfit with the sold SKU:',
    `REFERENCE PRESENTATION LOCK (image 2): keep the same model identity/type, anatomy, overall action category, body orientation, crop, garment occupancy, on-body outer envelope, detail-display intent, occlusion logic, fold-flow logic, tension/compression zones and relaxed asymmetry. Do not copy the exact expression or exact joint coordinates; apply only the controlled variation below.${backgroundMode === 'model_reference' ? ' Also keep its camera, complete background, lighting and shadow.' : ''}`,
    'PRODUCT IDENTITY LOCK (image 1 plus PRODUCT_MANIFEST): keep the exact sold garment style and cut, construction, component count, fabric, material, base colour, colour blocking, pattern, print, embroidery, applique, labels, pockets, seams, bindings, trims and closures.',
    'The on-body outline and fold map are controlled by the reference pose; the garment pattern-cut and merchandise identity are controlled by the approved product. Render the reference deformation using the real product material behaviour. Do not borrow the reference outfit’s colour, fabric, artwork, construction or style, and do not borrow the flat-lay background from image 1.',
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
    'TASK: replace the products in the final composition reference with all supplied approved SKUs. This is slot-by-slot product replacement, not product redesign or style blending.',
    '',
    'INPUT ROLES — calculated for this request and never fixed in settings:',
    `Images 1 to ${count} are approved flat-lay masters. They are the only sources of truth for each SKU.`,
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
    'Match the location and direction of natural folds shown in the reference, but render their scale, depth, softness, thickness, drape and micro-texture from the corresponding approved SKU. Never make the garments look like stiff cut-outs, perfectly ironed vector shapes or duplicated templates.',
    'The reference may show fewer, more or different product types. Use its slot geometry and visual hierarchy only; never use that mismatch to omit, merge, split or redesign a supplied SKU.',
    'Natural partial overlap, folding or edge occlusion is allowed only when required by the reference layout and physically valid for the supplied product. Every SKU must remain identifiable and no required component may disappear.',
    'Keep each SKU material and fold behaviour independent. Do not transfer colour, texture, print, trim, label or construction from one SKU to another.',
    'Before output, silently audit every slot: layout/background/fold/shadow/action matches the composition reference; product style/fabric/colour/material/artwork/construction matches its own approved master. Correct any cross-contamination.',
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
