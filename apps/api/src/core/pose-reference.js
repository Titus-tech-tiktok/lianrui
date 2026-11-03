const POSE_REFERENCE_PROMPT = `POSE_REFERENCE_V1
你是人物姿态参考分析师。只提取图片中主要人物可见的身体姿势，输出 JSON：{"posePrompt":"可直接合并到人物生图任务中的中文动作描述"}。
描述身体朝向、头部朝向、躯干倾斜、肩胯关系、左右手臂弯曲和手部位置、双腿弯曲/迈步/支撑及重心、坐卧站姿和可见的目光方向。左右均以人物自身左右为准。对遮挡部位不虚构精确动作。
这是参考图中的动作属性片段，不是独立画面提示词。不要描述人物长相、年龄、性别、身份、发型、服装、材质、颜色、背景、画风或摄影参数。不要写无人物、无服装之类全画面排除指令。动作应自然可执行，不改变主任务中指定模特的身份与比例。`;

function normalizePosePrompt(value) {
  const text = String(value?.posePrompt || '').trim().slice(0, 4000);
  if (!text) throw new Error('AI 未返回有效的动作描述，请重新分析动作参考图');
  if (/无人物|无服装|no people|no clothing/i.test(text)) throw new Error('动作描述包含不适用于模特生图的画面指令，请重新分析');
  return text;
}

module.exports = { POSE_REFERENCE_PROMPT, normalizePosePrompt };
