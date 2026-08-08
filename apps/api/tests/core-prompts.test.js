const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_MASTER_PROMPT,
  TEMPLATE_PRINT_PROMPT
} = require('../src/core/prompts');

test('template print prompt uses the current four-image red-ROI contract', () => {
  const prompt = TEMPLATE_PRINT_PROMPT({ RelativeTemplatePath: 'set\\main-1.jpg' });

  assert.match(prompt, /FOUR_IMAGE_RED_ROI_TEMPLATE_EDIT/);
  assert.match(prompt, /set\\main-1\.jpg/);
  assert.match(prompt, /\u7b2c\u4e00\u5f20\u56fe/);
  assert.match(prompt, /\u7b2c\u4e8c\u5f20\u56fe/);
  assert.match(prompt, /\u7b2c\u4e09\u5f20\u56fe/);
  assert.match(prompt, /\u7b2c\u56db\u5f20\u56fe/);
  assert.doesNotMatch(prompt, /\u900f\u660e\u8499\u7248/);
  assert.match(prompt, /\u7981\u6b62\u628a\u7b2c\u4e09\u5f20\u56fe\u4f5c\u4e3a\u5e73\u9762\u77e9\u5f62\u76f4\u63a5\u8986\u76d6/);
  assert.match(prompt, /\u4e0d\u5f97\u7f29\u653e\u3001\u88c1\u526a\u3001\u8865\u5e27\u3001\u6269\u56fe/);
  assert.match(prompt, /MASTER_COORDINATE_REGISTRATION/);
  assert.match(prompt, /bottom or edge close-up must use the corresponding bottom or edge portion/i);
  assert.match(prompt, /\u4efb\u4e00\u573a\u666f\u90fd\u7981\u6b62\u51fa\u73b0\u77e9\u5f62\u8d34\u56fe\u8fb9\u7f18/);
});

test('template print prompt contains no removed AI-analysis semantics', () => {
  const prompt = TEMPLATE_PRINT_PROMPT({ relativeTemplatePath: 'main.jpg' });

  assert.doesNotMatch(prompt, /templateAnalysis|\u6a21\u677f\u5206\u6790 JSON|print_mapping|replace_area|forbidden_area|AI \u8d28\u68c0/);
  assert.match(prompt, /\u6bcd\u7248\u53ea\u51b3\u5b9a\u5370\u82b1\u843d\u4f4d\u89c2\u611f|\u53ea\u53c2\u8003\u5370\u82b1\u5728\u540c\u6b3e\u67dc\u4f53\u4e0a\u7684\u65b9\u5411/);
  assert.match(prompt, /\u4e25\u7981\u590d\u5236\u5b83\u7684\u67dc\u4f53\u51e0\u4f55/);
});

test('template print prompt handles opened drawers, occluders, lighting and independent grid instances', () => {
  const prompt = TEMPLATE_PRINT_PROMPT({ relativeTemplatePath: '详情/多宫格.jpg' });
  assert.match(prompt, /每个红框、每个格子中的柜体都是同款产品的独立实例/);
  assert.match(prompt, /窗光、灯光或高光/);
  assert.match(prompt, /竖向白带、半扇空白、局部未印/);
  assert.match(prompt, /手和手臂是受保护前景/);
  assert.match(prompt, /衣物堆、收纳物、桌面商品、纸箱、镜子、托盘/);
  assert.match(prompt, /背景 < 柜体印花 < 前景遮挡物 < 原文字标签/);
  assert.match(prompt, /白边、彩边、破洞、锯齿、涂抹、重影/);
});

test('master prompt extracts the cabinet onto pure white and prevents flat overlays', () => {
  assert.match(TEMPLATE_MASTER_PROMPT, /TWO_IMAGE_WHITE_BACKGROUND_MASTER/);
  assert.match(TEMPLATE_MASTER_PROMPT, /\u7b2c\u4e00\u5f20\u56fe\u662f\u67dc\u4f53\u53c2\u8003\u56fe/);
  assert.match(TEMPLATE_MASTER_PROMPT, /\u7981\u6b62\u628a\u5370\u82b1\u4f5c\u4e3a\u77e9\u5f62\u56fe\u7247\u76f4\u63a5\u8986\u76d6/);
  assert.match(TEMPLATE_MASTER_PROMPT, /RGB\(255,255,255\)/);
  assert.match(TEMPLATE_MASTER_PROMPT, /\u5220\u9664\u7b2c\u4e00\u5f20\u56fe\u4e2d\u7684\u6c99\u53d1\u3001\u7a97\u5e18\u3001\u5899\u9762\u3001\u5730\u677f/);
  assert.match(TEMPLATE_MASTER_PROMPT, /\u7981\u6b62\u4fdd\u7559\u6216\u4eff\u9020\u7b2c\u4e00\u5f20\u56fe\u7684\u5ba2\u5385\u3001\u5367\u5ba4/);
  assert.doesNotMatch(TEMPLATE_MASTER_PROMPT, /\u767d\u5e95\u6216\u539f\u6d45\u8272\u5e95/);
});
