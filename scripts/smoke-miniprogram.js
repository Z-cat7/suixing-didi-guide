#!/usr/bin/env node
'use strict';

/**
 * 随行 dipi · 小程序端逻辑冒烟测试
 * ---------------------------------------------------------------------------
 * 用法：node dipi/scripts/smoke-miniprogram.js
 *
 * 在 Node 环境里模拟 wx / getApp / getCurrentPages 等小程序全局对象，
 * 加载 utils 与页面逻辑，验证：
 *   T1 mock 层与真实契约同构（信封 / 分页 / 金额 / 状态枚举 / 操作位）
 *   T2 格式化工具（分→元、相对时间、倒计时、截断）
 *   T3 存储封装（token / 草稿 / 导航包消费）
 *   T4 页面逻辑（搜索筛选、订单操作位渲染、聊天发送/重发、幂等下单）
 *   T5 WS 封装（退避序列 / seq 去重 / 事件分发）
 */

const path = require('path');
const assert = require('assert');

const MP_ROOT = path.resolve(__dirname, '..', 'miniprogram');

/* ==========================================================================
 * 小程序运行时模拟
 * ========================================================================== */
const storageMap = {};

global.wx = {
  getStorageSync: function (k) {
    return Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : '';
  },
  setStorageSync: function (k, v) {
    storageMap[k] = v;
  },
  removeStorageSync: function (k) {
    delete storageMap[k];
  },
  showToast: function () {},
  showModal: function () {},
  showActionSheet: function () {},
  navigateTo: function () {},
  redirectTo: function () {},
  switchTab: function () {},
  reLaunch: function () {},
  pageScrollTo: function () {},
  stopPullDownRefresh: function () {},
  setNavigationBarTitle: function () {},
  createSelectorQuery: function () {
    const q = {
      select: function () {
        return q;
      },
      boundingClientRect: function () {
        return q;
      },
      exec: function () {},
    };
    return q;
  },
  getNetworkType: function () {},
  onNetworkStatusChange: function () {},
  getLocation: function () {},
  login: function () {},
  connectSocket: function () {
    return {
      onOpen: function () {},
      onMessage: function () {},
      onClose: function () {},
      onError: function () {},
      send: function () {},
      close: function () {},
    };
  },
  setTabBarBadge: function () {},
  removeTabBarBadge: function () {},
  request: function () {},
  requestPayment: function () {},
  chooseMedia: function () {},
  getSetting: function () {},
  requestSubscribeMessage: function () {},
};

global.getApp = function () {
  return global.__appInstance;
};
global.getCurrentPages = function () {
  return [];
};

/* ==========================================================================
 * 测试框架
 * ========================================================================== */
let passed = 0;
let failed = 0;
const failures = [];

/**
 * 断言测试
 * @param {string} name 用例名
 * @param {function} fn 测试体
 */
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed += 1;
    failures.push({ name: name, error: e });
    console.log('  ✗ ' + name + ' — ' + e.message);
  }
}

/**
 * 异步断言测试
 * @param {string} name 用例名
 * @param {function} fn 测试体（返回 Promise）
 * @returns {Promise<void>}
 */
async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed += 1;
    failures.push({ name: name, error: e });
    console.log('  ✗ ' + name + ' — ' + e.message);
  }
}

/**
 * 加载模块（相对 miniprogram 根）
 * @param {string} rel 相对路径
 * @returns {any}
 */
function load(rel) {
  return require(path.join(MP_ROOT, rel));
}

/* ==========================================================================
 * T1 —— mock 层与契约同构
 * ========================================================================== */
console.log('');
console.log('── T1 mock 层与契约同构 ──────────────────────────────');

const mock = load('utils/mock.js');
const constants = load('utils/constants.js');

test('首页信封结构正确（code=0 + data）', function () {
  const res = mock.handle('GET', '/home', {}, {});
  assert.strictEqual(res.code, 0);
  assert.ok(res.data.currentCity);
  assert.ok(Array.isArray(res.data.serviceTypes));
  assert.ok(Array.isArray(res.data.featuredGuides));
  assert.ok(Array.isArray(res.data.guarantees));
});

test('地陪列表分页信封正确（list/page/pageSize/total/hasMore）', function () {
  const res = mock.handle('GET', '/guides', { page: 1, pageSize: 20 }, {});
  assert.strictEqual(res.code, 0);
  const d = res.data;
  assert.ok(Array.isArray(d.list));
  assert.strictEqual(typeof d.page, 'number');
  assert.strictEqual(typeof d.pageSize, 'number');
  assert.strictEqual(typeof d.total, 'number');
  assert.strictEqual(typeof d.hasMore, 'boolean');
});

test('地陪摘要字段命名合规（camelCase + Amount 后缀）', function () {
  const res = mock.handle('GET', '/guides', {}, {});
  const g = res.data.list[0];
  assert.ok(g.guideId);
  assert.strictEqual(typeof g.priceAmount, 'number');
  assert.strictEqual(typeof g.rating, 'number');
  // 不应出现 snake_case 字段
  const snake = Object.keys(g).filter(function (k) {
    return /_/.test(k);
  });
  assert.deepStrictEqual(snake, [], '发现 snake_case 字段：' + snake.join(','));
});

test('订单 status 属于 10 个合法枚举', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    assert.ok(
      constants.ORDER_STATUS_LIST.indexOf(o.status) >= 0,
      '非法订单状态：' + o.status
    );
  });
});

test('订单操作位由服务端下发（6 个布尔位齐全）', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    ['canUserPay', 'canUserCancel', 'canUserConfirm', 'canUserRefund', 'canUserContact', 'canUserReview'].forEach(
      function (k) {
        assert.strictEqual(typeof o[k], 'boolean', o.orderId + ' 缺少 ' + k);
      }
    );
  });
});

test('订单金额为整数分且以 Amount 结尾', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    assert.strictEqual(Math.round(o.totalAmount), o.totalAmount);
    assert.strictEqual(Math.round(o.priceAmount), o.priceAmount);
    assert.ok('totalAmount' in o && 'priceAmount' in o);
  });
});

test('订单时间为 ISO 8601 带时区字符串', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(o.createdAt), '非法时间：' + o.createdAt);
  });
});

test('订单列表按状态分栏过滤正确', function () {
  const all = mock.handle('GET', '/orders', { status: 'all' }, {}).data.list;
  const pending = mock.handle('GET', '/orders', { status: 'pendingPayment' }, {}).data.list;
  pending.forEach(function (o) {
    assert.strictEqual(o.status, 'pendingPayment');
  });
  assert.ok(all.length >= pending.length);
});

test('下单幂等：同一 idempotencyKey 返回同一 orderId', function () {
  const key = 'smoke-idem-key';
  const body = { guideId: 'g_2051', serviceItemId: 'si_9012', travelers: 2, idempotencyKey: key };
  const r1 = mock.handle('POST', '/orders', {}, body);
  const r2 = mock.handle('POST', '/orders', {}, body);
  assert.strictEqual(r1.code, 0);
  assert.strictEqual(r1.data.orderId, r2.data.orderId);
});

test('发送消息幂等：同一 clientMessageId 返回同一 messageId', function () {
  const body = { clientMessageId: 'c_smoke_1', content: '你好' };
  const r1 = mock.handle('POST', '/conversations/cv_77213/messages', {}, body);
  const r2 = mock.handle('POST', '/conversations/cv_77213/messages', {}, body);
  assert.strictEqual(r1.data.messageId, r2.data.messageId);
});

test('消息 seq 单调递增且带 clientMessageId', function () {
  const res = mock.handle('GET', '/conversations/cv_77213/messages', { page: 1, pageSize: 20 }, {});
  const list = res.data.list.slice().reverse();
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].seq > list[i - 1].seq, 'seq 非单调递增');
  }
});

test('会话列表含未读数与 firstUnreadSeq', function () {
  const res = mock.handle('GET', '/conversations', {}, {});
  res.data.list.forEach(function (c) {
    assert.strictEqual(typeof c.unreadCount, 'number');
    assert.ok('conversationId' in c);
  });
});

test('通知列表含 refType / isRead', function () {
  const res = mock.handle('GET', '/notices', {}, {});
  res.data.list.forEach(function (n) {
    assert.ok(['order', 'refund', 'system', 'none'].indexOf(n.refType) >= 0);
    assert.strictEqual(typeof n.isRead, 'boolean');
  });
});

test('筛选项字典结构完整', function () {
  const res = mock.handle('GET', '/guides/filter-options', {}, {});
  const d = res.data;
  assert.ok(Array.isArray(d.cities));
  assert.ok(Array.isArray(d.serviceTypes));
  assert.ok(Array.isArray(d.priceRanges));
  assert.ok(Array.isArray(d.ratings));
  assert.ok(Array.isArray(d.availableWindows));
});

test('地陪详情：services 数组元素只有 serviceId（契约读/写同名，不双写）', function () {
  const res = mock.handle('GET', '/guides/g_2051', {}, {});
  const guide = res.data.guide || res.data;
  assert.ok(Array.isArray(guide.services));
  assert.ok(guide.services.length > 0);
  guide.services.forEach(function (s) {
    assert.ok(s.serviceId, '服务项必须有 serviceId');
    // 契约：只有 serviceId，不得出现 serviceItemId（避免前端写第二套映射）
    assert.strictEqual('serviceItemId' in s, false, '服务项不应出现 serviceItemId');
    assert.strictEqual(typeof s.isAvailable, 'boolean');
    assert.strictEqual(typeof s.priceAmount, 'number');
  });
  // 详情顶层也不应再有 serviceItems 数组
  assert.strictEqual('serviceItems' in guide, false, '详情顶层不应出现 serviceItems');
});

test('地陪详情：availableSlots 带稳定 slotId', function () {
  const res = mock.handle('GET', '/guides/g_2051', {}, {});
  const guide = res.data.guide || res.data;
  assert.ok(Array.isArray(guide.availableSlots));
  assert.ok(guide.availableSlots.length > 0);
  guide.availableSlots.forEach(function (s) {
    assert.ok(s.slotId, 'slotId 不能为空');
    assert.strictEqual(typeof s.available, 'boolean');
    assert.ok(s.date);
  });
  // slotId 必须唯一
  const ids = guide.availableSlots.map(function (s) {
    return s.slotId;
  });
  assert.strictEqual(new Set(ids).size, ids.length, 'slotId 必须唯一');
});

test('地陪详情：封面至少覆盖 14 天', function () {
  const res = mock.handle('GET', '/guides/g_2051', {}, {});
  const guide = res.data.guide || res.data;
  const dates = {};
  guide.availableSlots.forEach(function (s) {
    dates[s.date] = true;
  });
  assert.ok(Object.keys(dates).length >= 14, 'availableSlots 至少覆盖未来 14 天');
});

test('收藏 toggle：返回 favorited（前端不自行取反）', function () {
  const res = mock.handle('PUT', '/me/favorites/g_1180', {}, {});
  assert.strictEqual(res.code, 0);
  assert.strictEqual(typeof res.data.favorited, 'boolean');
  assert.strictEqual(typeof res.data.favoritesCount, 'number');
  // 再 toggle 一次应回到 false
  const res2 = mock.handle('PUT', '/me/favorites/g_1180', {}, {});
  assert.notStrictEqual(res.data.favorited, res2.data.favorited);
});

test('我的资料走 /me 路径', function () {
  const res = mock.handle('GET', '/me', {}, {});
  assert.strictEqual(res.code, 0);
  assert.ok(res.data.userId);
  assert.ok(res.data.orderCounts);
});

test('下单提交接受 slotId + serviceId', function () {
  const res = mock.handle(
    'POST',
    '/orders',
    {},
    {
      guideId: 'g_2051',
      serviceId: 'si_9012',
      slotId: '2026-11-25_0900',
      travelers: 2,
      contactName: '小满',
      contactPhone: '13800005678',
      idempotencyKey: 'smoke-slot-key',
    }
  );
  assert.strictEqual(res.code, 0);
  assert.ok(res.data.orderId);
  // 2 人 × 36000 = 72000
  assert.strictEqual(res.data.totalAmount, 72000);
});

test('契约：已废弃端点在 mock 中不存在', function () {
  assert.notStrictEqual(mock.handle('GET', '/cities', {}, {}).code, 0, '/cities 已废弃');
  assert.notStrictEqual(mock.handle('GET', '/guides/suggest', {}, {}).code, 0, '/guides/suggest 已废弃');
  assert.notStrictEqual(mock.handle('GET', '/users/me', {}, {}).code, 0, '/users/me 已废弃');
});

test('契约：订单对象含 serviceId 与 slotId，且无 serviceItemId', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    assert.ok('serviceId' in o, '订单应含 serviceId');
    assert.strictEqual('serviceItemId' in o, false, '订单不应含 serviceItemId');
  });
  const created = mock.handle(
    'POST',
    '/orders',
    {},
    {
      guideId: 'g_2051',
      serviceId: 'si_9012',
      slotId: '2026-11-25_0900',
      travelers: 1,
      contactName: '小满',
      contactPhone: '13800005678',
      idempotencyKey: 'smoke-slot-field-key',
    }
  );
  const order = mock.handle('GET', '/orders/' + created.data.orderId, {}, {}).data;
  assert.strictEqual(order.serviceId, 'si_9012');
  assert.strictEqual(order.slotId, '2026-11-25_0900');
  assert.strictEqual('serviceItemId' in order, false);
});

test('契约：mock 用户含 orderStats 展示分桶（服务端聚合，非订单状态）', function () {
  const res = mock.handle('GET', '/me', {}, {});
  assert.ok(res.data.orderStats, 'mock /me 必须含 orderStats');
  ['pendingPayment', 'ongoing', 'pendingConfirm', 'refunding'].forEach(function (k) {
    assert.strictEqual(typeof res.data.orderStats[k], 'number', '缺少分桶 ' + k);
  });
});

test('契约：mock 服务项元素含 serviceId / name / type / priceAmount / durationHours', function () {
  const res = mock.handle('GET', '/guides/g_2051', {}, {});
  const guide = res.data.guide || res.data;
  guide.services.forEach(function (s) {
    assert.ok(s.serviceId);
    assert.ok(s.name);
    assert.ok(s.type);
    assert.strictEqual(typeof s.priceAmount, 'number');
    assert.strictEqual(typeof s.durationHours, 'number');
  });
});

test('契约：mock 订单金额全部是整数分', function () {
  const res = mock.handle('GET', '/orders', {}, {});
  res.data.list.forEach(function (o) {
    ['priceAmount', 'totalAmount', 'extraAmount', 'discountAmount'].forEach(function (k) {
      if (o[k] === undefined) return;
      assert.strictEqual(Math.round(o[k]), o[k], k + ' 必须是整数分');
    });
    // 不得出现元为单位的字段
    assert.strictEqual('totalPrice' in o, false);
    assert.strictEqual('unitPrice' in o, false);
    assert.strictEqual('statusCode' in o, false);
  });
});

/* ==========================================================================
 * T2 —— 格式化工具
 * ========================================================================== */
console.log('');
console.log('── T2 格式化工具 ────────────────────────────────────');

const format = load('utils/format.js');

test('分 → 元：12000 → "120"', function () {
  assert.strictEqual(format.amountToYuan(12000), '120');
});

test('分 → 元：3650 → "36.5"', function () {
  assert.strictEqual(format.amountToYuan(3650), '36.5');
});

test('分 → 元：null → "0"', function () {
  assert.strictEqual(format.amountToYuan(null), '0');
});

test('带符号金额', function () {
  assert.strictEqual(format.formatAmount(12000), '¥120');
});

test('相对时间：刚刚', function () {
  assert.strictEqual(format.formatRelativeTime(new Date().toISOString()), '刚刚');
});

test('相对时间：N 分钟前', function () {
  const t = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.strictEqual(format.formatRelativeTime(t), '5 分钟前');
});

test('倒计时：mm:ss', function () {
  assert.strictEqual(format.formatCountdown(14 * 60 * 1000 + 32 * 1000), '14:32');
});

test('倒计时：归零', function () {
  assert.strictEqual(format.formatCountdown(0), '00:00');
});

test('文本截断加省略号', function () {
  assert.strictEqual(format.truncate('一二三四五', 3), '一二三…');
  assert.strictEqual(format.truncate('一二', 5), '一二');
});

/* ==========================================================================
 * T3 —— 存储封装
 * ========================================================================== */
console.log('');
console.log('── T3 存储封装 ──────────────────────────────────────');

const storage = load('utils/storage.js');

test('token 读写', function () {
  storage.setToken('tok_123');
  assert.strictEqual(storage.getToken(), 'tok_123');
});

test('聊天草稿读写与清除', function () {
  storage.setChatDraft('cv_1', '草稿内容');
  assert.strictEqual(storage.getChatDraft('cv_1'), '草稿内容');
  storage.clearChatDraft('cv_1');
  assert.strictEqual(storage.getChatDraft('cv_1'), '');
});

test('下单草稿读写与清除', function () {
  storage.setOrderDraft({ guideId: 'g_1', travelers: 2 });
  assert.strictEqual(storage.getOrderDraft().travelers, 2);
  storage.clearOrderDraft();
  assert.strictEqual(storage.getOrderDraft(), null);
});

test('跨 Tab 导航包消费后即删除（防重复消费）', function () {
  storage.setNavOrder({ tab: 'pendingPayment', highlightOrderId: 'ord_1' });
  const v = storage.consumeNavOrder();
  assert.strictEqual(v.tab, 'pendingPayment');
  assert.strictEqual(storage.consumeNavOrder(), null);
});

test('退出登录清理登录态但保留草稿', function () {
  storage.setToken('tok_x');
  storage.setProfile({ nickname: '小满' });
  storage.setOrderDraft({ guideId: 'g_1' });
  storage.clearUserStorage();
  assert.strictEqual(storage.getToken(), '');
  assert.strictEqual(storage.getProfile(), null);
  assert.ok(storage.getOrderDraft());
  storage.clearOrderDraft();
});

test('搜索历史去重且限 10 条', function () {
  storage.clearSearchHistory();
  for (let i = 0; i < 15; i++) storage.pushSearchHistory('kw' + i);
  storage.pushSearchHistory('kw14');
  const list = storage.getSearchHistory();
  assert.ok(list.length <= 10);
  assert.strictEqual(list[0], 'kw14');
});

/* ==========================================================================
 * T4 —— 页面逻辑
 * ========================================================================== */
console.log('');
console.log('── T4 页面逻辑 ──────────────────────────────────────');

/**
 * 加载一个页面模块并构造其 Page 实例
 * @param {string} rel 相对路径
 * @returns {object} Page 实例
 */
function loadPage(rel) {
  let pageDef = null;
  const prevPage = global.Page;
  global.Page = function (def) {
    pageDef = def;
  };
  delete require.cache[require.resolve(path.join(MP_ROOT, rel))];
  require(path.join(MP_ROOT, rel));
  global.Page = prevPage;

  const instance = Object.assign({}, pageDef);
  instance.data = JSON.parse(JSON.stringify(pageDef.data || {}));
  instance.setData = function (patch) {
    const self = this;
    Object.keys(patch).forEach(function (k) {
      if (k.indexOf('.') > 0) {
        // 支持 'a.b' 形式的路径写入
        const parts = k.split('.');
        let obj = self.data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = patch[k];
      } else {
        self.data[k] = patch[k];
      }
    });
  };
  // 绑定方法
  Object.keys(pageDef).forEach(function (k) {
    if (typeof pageDef[k] === 'function') instance[k] = pageDef[k].bind(instance);
  });
  return instance;
}

/** 全局 app 实例（模拟） */
global.__appInstance = {
  globalData: {
    user: null,
    city: '成都',
    unreadTotal: 0,
    wsState: 'connected',
    isLoggedIn: true,
    online: true,
    currentTab: 'home',
  },
  setCity: function (c) {
    this.globalData.city = c;
  },
  setUnreadTotal: function (n) {
    this.globalData.unreadTotal = n;
  },
  ensureLogin: function () {
    return Promise.resolve('tok');
  },
  logout: function () {
    this.globalData.isLoggedIn = false;
  },
  redirectAfterLogin: function () {},
};

const searchPage = loadPage('pages/search/search.js');
const orderPage = loadPage('pages/order/order.js');
const chatPage = loadPage('pages/chat/chat.js');
const createPage = loadPage('pages/order/create.js');

test('搜索页：URL 参数预置筛选条件', function () {
  const p = loadPage('pages/search/search.js');
  p.onLoad({ from: 'home', serviceType: 'foodTour', city: '成都' });
  assert.strictEqual(p.data.filters.serviceTypes[0], 'foodTour');
  assert.strictEqual(p.data.filters.destination, '成都');
  assert.strictEqual(p.data.autoFocus, true);
});

test('搜索页：有 keyword 时不自动聚焦', function () {
  const p = loadPage('pages/search/search.js');
  p.onLoad({ from: 'home', keyword: '美食' });
  assert.strictEqual(p.data.autoFocus, false);
  assert.strictEqual(p.data.keyword, '美食');
});

test('搜索页：已选条件 chip 与数量同步', function () {
  const p = loadPage('pages/search/search.js');
  p.setData({
    filters: { destination: '成都', serviceTypes: ['foodTour'], priceRangeIndex: -1, rating: null, availableWithin: '' },
    filterOptions: {
      cities: [], serviceTypes: [{ code: 'foodTour', name: '美食陪逛' }],
      priceRanges: [], ratings: [], availableWindows: [],
    },
  });
  p.updateActiveChips();
  assert.strictEqual(p.data.activeFilterCount, 2);
  assert.strictEqual(p.data.activeChips[0].key, 'destination');
});

test('搜索页：移除单个已选条件', function () {
  const p = loadPage('pages/search/search.js');
  p.setData({
    filters: { destination: '成都', serviceTypes: ['foodTour'], priceRangeIndex: -1, rating: null, availableWithin: '' },
  });
  p.onRemoveChip({ currentTarget: { dataset: { key: 'serviceType:foodTour' } } });
  assert.strictEqual(p.data.filters.serviceTypes.length, 0);
  assert.strictEqual(p.data.filters.destination, '成都');
});

test('搜索页：筛选面板草稿不污染生效条件', function () {
  const p = loadPage('pages/search/search.js');
  p.setData({
    filters: { destination: '', serviceTypes: [], priceRangeIndex: -1, rating: null, availableWithin: '' },
  });
  p.onOpenFilter();
  p.onToggleCity({ currentTarget: { dataset: { name: '成都' } } });
  assert.strictEqual(p.data.draftFilters.destination, '成都');
  assert.strictEqual(p.data.filters.destination, '', '草稿不应直接改生效条件');
});

test('搜索页：价格区间单选（再点取消）', function () {
  const p = loadPage('pages/search/search.js');
  p.setData({
    draftFilters: { destination: '', serviceTypes: [], priceRangeIndex: -1, rating: null, availableWithin: '' },
  });
  p.onSelectPriceRange({ currentTarget: { dataset: { index: 2 } } });
  assert.strictEqual(p.data.draftFilters.priceRangeIndex, 2);
  p.onSelectPriceRange({ currentTarget: { dataset: { index: 2 } } });
  assert.strictEqual(p.data.draftFilters.priceRangeIndex, -1);
});

test('订单页：按钮完全由服务端布尔位驱动', function () {
  const order = {
    orderId: 'ord_1',
    orderNo: 'SX1',
    status: 'pendingPayment',
    statusText: '待支付',
    totalAmount: 36000,
    priceAmount: 36000,
    scheduledAt: new Date().toISOString(),
    expireAt: new Date(Date.now() + 600000).toISOString(),
    serverTime: new Date().toISOString(),
    canUserPay: true,
    canUserCancel: true,
    canUserConfirm: false,
    canUserRefund: false,
    canUserContact: true,
    canUserReview: false,
  };
  const decorated = orderPage.decorateOrder(order);
  // 前端不新增任何操作位，只是原样透传
  assert.strictEqual(decorated.canUserPay, true);
  assert.strictEqual(decorated.canUserConfirm, false);
  assert.strictEqual(decorated.totalYuan, '360');
});

test('订单页：详情页实心主按钮由操作位推导', function () {
  const detail = orderPage.decorateDetail({
    orderId: 'ord_1',
    status: 'pendingConfirm',
    statusText: '待确认',
    priceAmount: 1000,
    totalAmount: 1000,
    durationHours: 3,
    travelers: 2,
    canUserPay: false,
    canUserCancel: false,
    canUserConfirm: true,
    canUserRefund: true,
    canUserContact: true,
    canUserReview: false,
    timeline: [],
  });
  assert.strictEqual(detail.hasPrimaryAction, true);
  assert.strictEqual(detail.totalYuan, '10');
});

test('订单页：倒计时基于 expireAt + serverTime', function () {
  const serverTime = new Date().toISOString();
  const expireAt = new Date(Date.now() + 14 * 60 * 1000 + 32 * 1000).toISOString();
  const text = orderPage.buildCountdown(expireAt, serverTime);
  assert.ok(/^剩余 \d{2}:\d{2}$/.test(text), '非法倒计时文案：' + text);
});

test('订单页：已过期订单不显示倒计时', function () {
  const serverTime = new Date().toISOString();
  const expireAt = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(orderPage.buildCountdown(expireAt, serverTime), '');
});

test('订单页：Tab 切换会重置列表并重新请求', function () {
  const p = loadPage('pages/order/order.js');
  p.setData({ currentTab: 'all', list: [{ orderId: 'x' }] });
  p.onTabChange({ currentTarget: { dataset: { code: 'pendingPayment' } } });
  assert.strictEqual(p.data.currentTab, 'pendingPayment');
  assert.strictEqual(p.data.list.length, 0, '条件变化后必须清空旧列表');
});

test('订单页：详情视图返回切回列表态（不调 navigateBack）', function () {
  const p = loadPage('pages/order/order.js');
  p.setData({ viewMode: 'detail', detail: { orderId: 'ord_1' } });
  p.onBackToList();
  assert.strictEqual(p.data.viewMode, 'list');
  assert.strictEqual(p.data.detail, null);
});

test('聊天页：发送消息先本地插入 sending', function () {
  const p = loadPage('pages/chat/chat.js');
  p.setData({ conversationId: 'cv_1', inputText: '你好', canSend: true, messages: [], offline: false });
  p.onSend();
  assert.strictEqual(p.data.messages.length, 1);
  assert.strictEqual(p.data.messages[0].status, 'sending');
  assert.strictEqual(p.data.inputText, '');
});

test('聊天页：空内容不可发送', function () {
  const p = loadPage('pages/chat/chat.js');
  p.setData({ conversationId: 'cv_1', inputText: '   ', canSend: false, messages: [] });
  p.onSend();
  assert.strictEqual(p.data.messages.length, 0);
});

test('聊天页：sending 状态禁止并发重发', function () {
  const p = loadPage('pages/chat/chat.js');
  const cid = 'c_test_1';
  p.setData({
    conversationId: 'cv_1',
    messages: [{ clientMessageId: cid, status: 'sending', content: 'x' }],
  });
  p.onRetrySend({ detail: { clientMessageId: cid } });
  assert.strictEqual(p.data.messages[0].status, 'sending');
});

test('聊天页：重发复用同一 clientMessageId', function () {
  const p = loadPage('pages/chat/chat.js');
  const cid = 'c_test_2';
  p.setData({
    conversationId: 'cv_1',
    messages: [{ clientMessageId: cid, status: 'failed', content: 'x' }],
  });
  let captured = null;
  p.sendMessage = function (msg) {
    captured = msg.clientMessageId;
  };
  p.onRetrySend({ detail: { clientMessageId: cid } });
  assert.strictEqual(captured, cid, '重发必须复用同一 clientMessageId');
  assert.strictEqual(p.data.messages[0].status, 'sending');
});

test('聊天页：草稿落盘与回填', function () {
  const p = loadPage('pages/chat/chat.js');
  p.setData({ conversationId: 'cv_draft_1', inputText: '半句话' });
  p.saveDraft();
  assert.strictEqual(storage.getChatDraft('cv_draft_1'), '半句话');
  const p2 = loadPage('pages/chat/chat.js');
  p2.setData({ conversationId: 'cv_draft_1', inputText: '' });
  p2.restoreDraft();
  assert.strictEqual(p2.data.inputText, '半句话');
  storage.clearChatDraft('cv_draft_1');
});

test('下单页：幂等键进入页面生成一次', function () {
  const p = loadPage('pages/order/create.js');
  p.onLoad({ guideId: 'g_2051', serviceItemId: 'si_9012' });
  assert.ok(p._idempotencyKey);
  const first = p._idempotencyKey;
  // 模拟重试：不重新生成
  assert.strictEqual(p._idempotencyKey, first);
});

test('下单页：人数限制 1–20', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({ draft: { travelers: 1 } });
  p.onTravelersMinus();
  assert.strictEqual(p.data.draft.travelers, 1);
  p.setData({ draft: { travelers: 20 } });
  p.onTravelersPlus();
  assert.strictEqual(p.data.draft.travelers, 20);
});

test('下单页：校验拦截空联系人', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({
    selectedServiceId: 'si_1',
    selectedSlotId: 'slot_1',
    travelers: 2,
    contactName: '',
    contactPhone: '',
  });
  assert.strictEqual(p.validate(), false);
  assert.ok(p.data.contactError);
});

test('下单页：校验通过', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({
    selectedServiceId: 'si_1',
    selectedSlotId: 'slot_1',
    travelers: 2,
    contactName: '小满',
    contactPhone: '13800005678',
  });
  assert.strictEqual(p.validate(), true);
});

test('下单页：草稿节流落盘（500ms 后写入）', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({ guideId: 'g_2051', travelers: 3, contactName: '小满' });
  p.saveDraft();
  // 节流窗口内还没落盘
  assert.strictEqual(storage.getOrderDraft(), null);
  // 退出时立即落盘
  p.onUnload();
  const saved = storage.getOrderDraft();
  assert.ok(saved, '退出后草稿必须落盘');
  assert.strictEqual(saved.guideId, 'g_2051');
  assert.strictEqual(saved.travelers, 3);
  assert.strictEqual(saved.contactName, '小满');
  storage.clearOrderDraft();
});

test('下单页：草稿落盘包含 guideId（避免串号）', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({ guideId: 'g_2051', travelers: 3 });
  p.flushDraft();
  const saved = storage.getOrderDraft();
  assert.ok(saved);
  assert.strictEqual(saved.guideId, 'g_2051');
  assert.strictEqual(saved.travelers, 3);
  storage.clearOrderDraft();
});

test('下单页：草稿恢复时不串号（guideId 不匹配则忽略）', function () {
  storage.setOrderDraft({ guideId: 'g_OTHER', travelers: 9 });
  const p = loadPage('pages/order/create.js');
  p.onLoad({ guideId: 'g_2051' });
  assert.notStrictEqual(p.data.travelers, 9, '不同地陪的草稿不应被复用');
  assert.strictEqual(p.data.draftDiscarded, true);
  storage.clearOrderDraft();
});

test('下单页：草稿回填不覆盖 URL 传入的 serviceId', function () {
  storage.setOrderDraft({ guideId: 'g_2051', serviceId: 'si_OLD', contactName: '旧名字', travelers: 3 });
  const p = loadPage('pages/order/create.js');
  p.onLoad({ guideId: 'g_2051', serviceId: 'si_NEW' });
  assert.strictEqual(p.data.selectedServiceId, 'si_NEW', 'URL 传入的 serviceId 优先');
  assert.strictEqual(p.data.contactName, '旧名字', '其他草稿字段应回填');
  assert.strictEqual(p.data.draftRestored, true);
  storage.clearOrderDraft();
});

test('下单页：实时算价 = 单价 × 人数', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({
    selectedService: { serviceId: 'si_1', priceAmount: 36000, maxTravelers: 8 },
    travelers: 2,
    extraAmount: 0,
    discountAmount: 0,
  });
  p.recalcPrice();
  assert.strictEqual(p.data.priceAmount, 72000);
  assert.strictEqual(p.data.totalAmount, 72000);
  assert.strictEqual(p.data.totalYuan, '720');
});

test('下单页：人数上限来自服务项 maxTravelers', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({ selectedService: { serviceId: 'si_1', priceAmount: 1000, maxTravelers: 4 }, travelers: 4 });
  p.recalcPrice();
  assert.strictEqual(p.data.maxTravelers, 4);
  p.onTravelersPlus();
  assert.strictEqual(p.data.travelers, 4, '达到上限后不再增加');
  assert.ok(p.data.travelersError);
});

test('下单页：手机号必须 11 位数字', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({
    draft: { serviceItemId: 'si_1', dateLabel: '今天', timeSlot: '10:00', travelers: 2 },
    contactName: '小满',
    contactPhone: '138000',
  });
  assert.strictEqual(p.validate(), false);
  assert.strictEqual(p.data.contactError, '请填写 11 位手机号');
  p.setData({ contactPhone: '13800005678' });
  assert.strictEqual(p.validate(), true);
});

test('下单页：不可约时段点击不响应', function () {
  const p = loadPage('pages/order/create.js');
  p.setData({ selectedSlotId: 'slot_1', slots: [] });
  p.onSelectSlot({ currentTarget: { dataset: { slot: { slotId: 'slot_x', available: false } } } });
  assert.strictEqual(p.data.selectedSlotId, 'slot_1', '不可约时段不应改变选中态');
});

test('下单页：时段按日期分组', function () {
  const p = loadPage('pages/order/create.js');
  const groups = p.groupSlots([
    { slotId: 'a', date: '2026-11-25', dateLabel: '11 月 25 日 周三', available: true },
    { slotId: 'b', date: '2026-11-25', dateLabel: '11 月 25 日 周三', available: true },
    { slotId: 'c', date: '2026-11-26', dateLabel: '11 月 26 日 周四', available: true },
  ]);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].slots.length, 2);
});

test('地陪详情页：选服务项后吸底条价格跟随', function () {
  const p = loadPage('pages/guide/detail.js');
  p.selectService({ serviceId: 'si_2', priceAmount: 26000 });
  assert.strictEqual(p.data.selectedServiceId, 'si_2');
  assert.strictEqual(p.data.selectedPriceYuan, '260');
});

test('地陪详情页：不可约服务项不切换选中', function () {
  const p = loadPage('pages/guide/detail.js');
  p.selectService({ serviceId: 'si_2', priceAmount: 26000 });
  p.onSelectService({ currentTarget: { dataset: { service: { serviceId: 'si_3', isAvailable: false } } } });
  assert.strictEqual(p.data.selectedServiceId, 'si_2', '不可约服务项不应切换');
});

/* ==========================================================================
 * T5 —— WS 封装
 * ========================================================================== */
console.log('');
console.log('── T5 WebSocket 封装 ────────────────────────────────');

const ws = load('utils/ws.js');

test('退避档位序列 1/2/4/8/15/30 秒且封顶 30s', function () {
  const config = load('config/index.js');
  assert.deepStrictEqual(config.WS_RECONNECT_STEPS, [1000, 2000, 4000, 8000, 15000, 30000]);
  assert.strictEqual(config.WS_RECONNECT_STEPS[config.WS_RECONNECT_STEPS.length - 1], 30000);
});

test('事件别名归一（order.status → order.statusChanged）', function () {
  assert.strictEqual(ws.EVENT_ALIAS['order.status'], 'order.statusChanged');
  assert.strictEqual(ws.EVENT_ALIAS['notice.new'], 'notification.new');
});

test('订阅 / 退订事件分发正确', function () {
  const received = [];
  const handler = function (payload) {
    received.push(payload);
  };
  ws.on('message.new', handler);
  ws.emit('message.new', { a: 1 });
  assert.strictEqual(received.length, 1);
  ws.off('message.new', handler);
  ws.emit('message.new', { a: 2 });
  assert.strictEqual(received.length, 1);
});

test('seq 去重：重复 seq 的消息被丢弃', function () {
  const received = [];
  const handler = function (payload) {
    received.push(payload);
  };
  ws.on('message.new', handler);
  ws.handleMessage({ data: JSON.stringify({ type: 'message.new', payload: { conversationId: 'cv_dup', message: { messageId: 'm1', seq: 100 } } }) });
  ws.handleMessage({ data: JSON.stringify({ type: 'message.new', payload: { conversationId: 'cv_dup', message: { messageId: 'm1', seq: 100 } } }) });
  assert.strictEqual(received.length, 1, '重复 seq 应被去重');
  ws.off('message.new', handler);
});

test('不同会话的相同 seq 不互相去重', function () {
  const received = [];
  const handler = function (payload) {
    received.push(payload);
  };
  ws.on('message.new', handler);
  ws.handleMessage({ data: JSON.stringify({ type: 'message.new', payload: { conversationId: 'cv_a', message: { messageId: 'm1', seq: 200 } } }) });
  ws.handleMessage({ data: JSON.stringify({ type: 'message.new', payload: { conversationId: 'cv_b', message: { messageId: 'm2', seq: 200 } } }) });
  assert.strictEqual(received.length, 2);
  ws.off('message.new', handler);
});

test('兼容服务端 { type, data } 信封', function () {
  const received = [];
  const handler = function (payload) {
    received.push(payload);
  };
  ws.on('order.statusChanged', handler);
  ws.handleMessage({ data: JSON.stringify({ type: 'order.status', data: { orderId: 'ord_1' } }) });
  assert.strictEqual(received.length, 1);
  assert.strictEqual(received[0].orderId, 'ord_1');
  ws.off('order.statusChanged', handler);
});

test('未知事件类型被忽略（向前兼容）', function () {
  assert.doesNotThrow(function () {
    ws.handleMessage({ data: JSON.stringify({ type: 'some.future.event', payload: {} }) });
  });
});

/* ==========================================================================
 * 输出
 * ========================================================================== */
console.log('');
console.log('══════════════════════════════════════════════════════');
console.log(' 冒烟测试：' + passed + ' 通过, ' + failed + ' 失败');
console.log('══════════════════════════════════════════════════════');
if (failed) {
  console.log('');
  failures.forEach(function (f) {
    console.log('  ✗ ' + f.name);
    console.log('    ' + (f.error && f.error.stack ? f.error.stack.split('\n')[0] : f.error));
  });
  process.exit(1);
}
console.log('');
process.exit(0);
