const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTaobaoPublishSettings
} = require('../src/runtime');

test('taobao publish settings normalize selector and attribute objects', () => {
  const settings = normalizeTaobaoPublishSettings({
    token: 'token',
    categories: [
      {
        id: 'sideboard',
        defaults: {
          selectors: {
            title: 'input[name=title]',
            'attribute.材质': 'input[name=material]'
          },
          attributes: {
            材质: '实木'
          },
          customFields: [
            { label: '品牌', value: '其他', type: 'text', selector: 'input[name=brand]' },
            { label: '风格', value: '中古风', type: 'select' }
          ]
        }
      },
      {
        id: 'corner-cabinet',
        defaults: {
          selectors: 'broken',
          attributes: ['broken']
        }
      }
    ]
  });

  const sideboard = settings.categories.find(item => item.id === 'sideboard');
  const corner = settings.categories.find(item => item.id === 'corner-cabinet');
  assert.equal(sideboard.defaults.selectors.title, 'input[name=title]');
  assert.equal(sideboard.defaults.selectors['attribute.材质'], 'input[name=material]');
  assert.equal(sideboard.defaults.attributes.材质, '实木');
  assert.deepEqual(sideboard.defaults.customFields, [
    { label: '品牌', value: '其他', type: 'text', selector: 'input[name=brand]' },
    { label: '风格', value: '中古风', type: 'select', selector: '' }
  ]);
  assert.equal(sideboard.defaults.categoryKeyword, '餐边柜');
  assert.deepEqual(sideboard.defaults.categoryPath, ['住宅家具', '柜类', '餐边柜']);
  assert.equal(sideboard.defaults.brandName, '其他家');
  assert.equal(sideboard.defaults.modelName, '其他');
  assert.deepEqual(corner.defaults.selectors, {});
  assert.deepEqual(corner.defaults.attributes, {});
  assert.deepEqual(corner.defaults.customFields, []);
});

test('taobao publish settings keep local publisher stores and device bindings', () => {
  const settings = normalizeTaobaoPublishSettings({
    token: 'token',
    localPublisher: {
      autoPublish: true,
      activeStoreId: 'store-a',
      activeDeviceId: 'device-a'
    },
    stores: [
      {
        id: 'store-a',
        name: '运营A淘宝店',
        ownerUserId: 'user-a',
        profileDir: 'profiles/store-a',
        autoPublish: true,
        online: true
      },
      {
        id: '',
        name: ''
      }
    ],
    devices: [
      {
        id: 'device-a',
        name: '运营A电脑',
        userId: 'user-a',
        activeStoreId: 'store-a',
        enabled: true
      }
    ]
  });

  assert.equal(settings.localPublisher.autoPublish, true);
  assert.equal(settings.localPublisher.activeStoreId, 'store-a');
  assert.equal(settings.localPublisher.activeDeviceId, 'device-a');
  assert.deepEqual(settings.stores, [
    {
      id: 'store-a',
      name: '运营A淘宝店',
      ownerUserId: 'user-a',
      profileDir: 'profiles/store-a',
      autoPublish: true,
      online: true,
      createdAt: ''
    }
  ]);
  assert.deepEqual(settings.devices, [
    {
      id: 'device-a',
      name: '运营A电脑',
      userId: 'user-a',
      activeStoreId: 'store-a',
      appVersion: '',
      enabled: true,
      lastSeenAt: ''
    }
  ]);
});
