const MATERIAL_ANALYSIS_PROMPT = `你是服装面料识图分析师。识别图片里最主要面料的材质名称，并写出可直接用于生成图片的纹理提示词。只返回 JSON：{"name":"具体简洁的材质名称","texturePrompt":"可直接用于生成图片的中文纹理描述"}。名称使用面料行业常见叫法，例如细罗纹针织、磨毛针织、平纹梭织、灯芯绒、牛仔、毛圈布等；根据织物可见结构选最合适的名称，禁止把“未知材质”“外观推测”等作为名称或名称后缀。纹理描述具体写明针织/梭织组织、纹路方向和间距、颗粒尺度、纱线和绒毛、表面光泽、厚薄质感、垂坠及褶皱，使生图模型能够还原面料表面。直接描述目标视觉效果，不写鉴定说明、免责声明、推测或不确定信息。不得编造纤维含量、认证或功能；没有成分依据时使用织物结构名称。不要带入样图的颜色、印花、服装款式、人物或背景。此字段只是童装生图主提示词中的面料属性片段，不是独立图片生成任务。只输出织物属性，禁止输出摄影方式、镜头、取景、构图、扫描、画面背景或主体排除指令，不能写“无人物”“无服装”“无印花”等负面画面要求；不要把“不要带入样图内容”改写成删除最终画面中相应内容的指令。例如合格纹理描述为：细密纵向罗纹，窄凸条与浅凹槽均匀交替，纱线细腻，轻微短绒，柔和哑光，厚度适中，柔软自然垂坠，弯折形成细密顺滑褶皱。如只给名称，则根据该名称编写对应的纹理提示词。`;


function parseMaterialAnalysisJson(value) {
  const text = String(value || '').trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('分析接口未返回有效的材质描述，请重试或手动填写。');
}

function textureAttributesOnly(value) {
  // Old saved descriptions and model outputs may contain standalone image directives.
  // Keep textile attributes, including legitimate terms such as 无光泽/无绒毛.
  return String(value || '').split(/[，,。；;\n]+/).map(part => part.trim()).filter(Boolean)
    .filter(part => !/(?:无|不含|没有|不要|不出现|排除)(?:任何)?(?:颜色限定|颜色要求|印花|图案|服装|人物|背景)|no (?:people|person|clothing|garments|background|pattern|print)|摄影|特写|扫描|镜头|构图|取景|微距|高清|超清|高精度/i.test(part))
    .join('，').slice(0, 4000);
}

function normalizeMaterial(value = {}) {
  const name = String(value.name || '').trim().replace(/[(（](?:外观推测|推测|外观识别)[)）]/g, '').trim().slice(0, 120);
  const texturePrompt = textureAttributesOnly(value.texturePrompt || value.description || '');
  // Keep the legacy description key aligned with the one editable texture field.
  const result = { name, description: texturePrompt, texturePrompt };

  if (!result.name) throw new Error('请填写材质名称');
  return result;
}

function materialPrompt(material, target, imageNumber) {
  material = normalizeMaterial(material);
  if (!material.texturePrompt) throw new Error(`材质“${material.name}”尚未填写或分析纹理描述`);
  return `材质绑定【${target}】：${material.name}。${imageNumber ? `图${imageNumber}仅作材质纹理参考。` : ''}${material.texturePrompt}`;
}

function materialAnalysisError(error) {
  const message = String(error?.message || error);
  if (/upload_protection_limit_exceeded|文件上传上限|文件上传额度|upload.*(?:quota|limit).*exceed/i.test(message)) {
    const hours = message.match(/(?:请|after\s*)(\d+)\s*(?:小时|hours?)/i)?.[1];
    return new Error(`当前分析线路的图片上传额度已用尽${hours ? `，上游提示约 ${hours} 小时后重试` : ''}。请等待额度恢复，或在系统设置中配置另一个有可用额度的视觉分析线路。也可新建仅填写名称的材质进行推导；该结果不能作为图片识别结论。`);
  }
  if (/no available channel|model[_ -]not[_ -]found/i.test(message)) {
    return new Error('当前线路不支持所配置的材质分析模型，请在系统设置中读取可用模型列表，选择支持图片理解的分析模型。');
  }
  return error;
}

module.exports = { MATERIAL_ANALYSIS_PROMPT, normalizeMaterial, materialPrompt, materialAnalysisError, parseMaterialAnalysisJson };

function garmentMaterialSlots(bindings, stage, operationType) {
  if (operationType === 'scene_only') return [];
  const slot = (binding, id, name) => ({ slot: id, target: `图${binding.imageNumber}中的${name}` });
  if (stage === 'master') {
    const item = bindings.find(item => item.roleLabel === '实拍产品图');
    return item ? [slot(item, 'garment', '商品')] : [];
  }
  if (stage === 'combination') return bindings.filter(item => item.roleLabel === '所选平铺图').map((item, i) => slot(item, `sku-${i}`, `SKU ${String.fromCharCode(65 + i)}`));
  const slots = [];
  for (const [id, name, label] of [['top', '上衣', '上衣参考'], ['bottom', '裤子', '裤子参考']]) {
    const binding = bindings.find(item => item.roleLabel.startsWith(label));
    if (binding) slots.push(slot(binding, id, name));
  }
  const master = bindings.find(item => item.roleLabel === '已生成平铺图');
  return slots.length ? slots : master ? [slot(master, 'garment', '商品')] : [];
}
module.exports.garmentMaterialSlots = garmentMaterialSlots;

function materialNamePrompt(name) {
  return `你是通用材质表面纹理描述器。当前只有用户确认的材质名称，没有待识别图片。依据名称的通常含义推理其表面纹理；名称可以是织物、塑料、金属、木材、玻璃等。只返回 {"name":${JSON.stringify(name)},"texturePrompt":"该材质本身的纹理属性"}。这是童装生成任务中的一个局部材质属性片段；仅描述表面结构、颗粒、粗糙度、光泽、厚薄、柔韧或硬挺及弯折特性。不得写摄影、构图、颜色、主体、人物、服装或背景排除指令。不得默认所有材质都是织物，不得将旧图片或旧描述的织纹、纱线、针圈、绒毛套用到非织物材质。用户未细分的材质使用常见中性表面特征，不擅自改为更具体的材质类型。`;
}
function materialNameTextureConflict(name, texture) {
  const nonTextile = /塑料|树脂|PVC|TPU|亚克力|玻璃|金属|钢|铝|木材|木头|石材|陶瓷/i.test(name) && !/织|布|纱|纤维|面料|混纺|涂层/.test(name);
  return nonTextile && /针织|梭织|罗纹|纱线|针圈|线圈|织物|纤维毛羽|绒毛/.test(texture);
}
module.exports.materialNamePrompt = materialNamePrompt;
module.exports.materialNameTextureConflict = materialNameTextureConflict;
