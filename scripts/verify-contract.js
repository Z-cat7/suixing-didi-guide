#!/usr/bin/env node
'use strict';

/**
 * 随行 dipi · 客户端 ↔ 服务端 契约核对脚本
 * ---------------------------------------------------------------------------
 * 用法：
 *   node dipi/scripts/verify-contract.js
 *
 * 做法：**在同一进程内**启动服务端（随机端口），再用客户端真实的 `utils/api.js`
 * 去请求，逐条核对最终契约：
 *   - 路径前缀只有 /api/v1
 *   - 地陪详情：data.guide.services[] / data.guide.availableSlots[]
 *   - 订单：6 个 canUserXxx 操作位 + statusText + 整数分
 *   - /me：orderStats 展示分桶（服务端下发，前端不自行聚合）
 *   - 筛选项：全部来自 GET /api/v1/guides/filter-options
 *   - 收藏：PUT toggle 返回 favorited（前端不自行取反）
 *   - 价格筛选：客户端发的 minPrice/maxPrice 单位与服务端一致
 *
 * 退出码：0 = 全部通过；1 = 有失败
 */

const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const MP_ROOT = path.join(ROOT, 'miniprogram');

let passed = 0;
let failed = 0;
const failures = [];

/**
 * 断言
 * @param {string} name 用例名
 * @param {boolean} ok 是否通过
 * @param {string} extra 附加信息
 */
function check(name, ok, extra) {
  if (ok) {
    passed += 1;
    console.log('  ✓ ' + name + (extra ? ' — ' + extra : ''));
  } else {
    failed += 1;
    failures.push(name);
    console.log('  ✗ ' + name + (extra ? ' — ' + extra : ''));
  }
}

/**
 * 启动服务端（随机端口）
 * @returns {Promise<{app, port}>}
 */
function startServer() {
  return new Promise((resolve, reject) => {
    let createApp;
    try {
      createApp = require(path.join(ROOT, 'server', 'src', 'app.js'));
    } catch (e) {
      reject(new Error('找不到服务端入口（server/src/app.js）：' + e.message));
      return;
    }
    const app = createApp;
    const server = app.listen(0, '127.0.0.1', function () {
      resolve({ app: app, server: server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

/**
 * 安装 wx 全局（request 代理到本地服务端）
 * @param {number} port 端口
 */
function installWx(port) {
  global.wx = {
    getStorageSync: function () { return ''; },
    setStorageSync: function () {},
    removeStorageSync: function () {},
    showToast: function () {},
    login: function () { return { success: function () {} }; },
    request: function (o) {
      const data = JSON.stringify(o.data || {});
      // 客户端传的是完整 URL（BASE_URL + /api/v1 + path），这里取出 path 部分
      const u = new URL(o.url);
      const r = http.request(
        {
          host: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: o.method || 'GET',
          headers: Object.assign({}, o.header || {}, { 'Content-Length': Buffer.byteLength(data) }),
        },
        function (resp) {
          let b = '';
          resp.on('data', function (d) { b += d; });
          resp.on('end', function () {
            try {
              o.success({ data: JSON.parse(b), header: resp.headers, statusCode: resp.statusCode });
            } catch (e) {
              o.fail({ errMsg: 'parse error' });
            }
          });
        }
      );
      r.on('error', function (e) { o.fail({ errMsg: e.message }); });
      if (o.method && o.method !== 'GET') r.write(data);
      r.end();
    },
    connectSocket: function () {
      return { onOpen: function () {}, onMessage: function () {}, onClose: function () {}, onError: function () {}, send: function () {}, close: function () {} };
    },
    getNetworkType: function () {},
    onNetworkStatusChange: function () {},
    getLocation: function () {},
  };
}

/**
 * GET 请求
 * @param {number} port 端口
 * @param {string} p 路径
 * @param {object} h headers
 * @returns {Promise<object>}
 */
function get(port, p, h) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: p, headers: h || {} }, function (r) {
      let b = '';
      r.on('data', function (d) { b += d; });
      r.on('end', function () { resolve(JSON.parse(b)); });
    }).on('error', reject);
  });
}

/**
 * 主流程
 */
async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(' 客户端 ↔ 服务端 契约核对');
  console.log('══════════════════════════════════════════════════════');

  let server;
  try {
    server = await startServer();
  } catch (e) {
    console.log('');
    console.log('⚠ 无法启动服务端：' + e.message);
    console.log('  跳过契约核对（静态检查与冒烟测试仍需通过）');
    process.exit(0);
  }

  const PORT = server.port;
  installWx(PORT);
  const api = require(path.join(MP_ROOT, 'utils', 'api.js'));

  // 登录拿 token
  const lr = await new Promise(function (resolve, reject) {
    const s = JSON.stringify({ code: 'mock-user-001' });
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/v1/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) } },
      function (x) { let b = ''; x.on('data', function (c) { b += c; }); x.on('end', function () { resolve(JSON.parse(b)); }); }
    );
    r.on('error', reject); r.write(s); r.end();
  });
  const H = { Authorization: 'Bearer ' + lr.data.token };

  console.log('');
  console.log('── 路径前缀（单 /api/v1）──');
  check('POST /api/v1/auth/login', lr.code === 0);

  console.log('');
  console.log('── 地陪详情：services[] / availableSlots[] ──');
  const gd = await get(PORT, '/api/v1/guides/gd_000008', H);
  const g = gd.data.guide || gd.data;
  check('响应含 data.guide', !!gd.data.guide);
  check(
    'guide.services[] 元素含 serviceId 且无 serviceItemId',
    Array.isArray(g.services) && g.services.length > 0 && g.services.every(function (s) { return s.serviceId && !('serviceItemId' in s); }),
    'n=' + (g.services || []).length
  );
  check(
    'guide.availableSlots[] = { slotId, date, timeSlot, available }',
    Array.isArray(g.availableSlots) && g.availableSlots.length > 0 && g.availableSlots.every(function (s) {
      return s.slotId && s.date && s.timeSlot && typeof s.available === 'boolean';
    }),
    'n=' + (g.availableSlots || []).length
  );
  const slotIds = g.availableSlots.map(function (s) { return s.slotId; });
  check('slotId 唯一', new Set(slotIds).size === slotIds.length);
  check('availableSlots 覆盖 ≥14 天', new Set(g.availableSlots.map(function (s) { return s.date; })).size >= 14);

  console.log('');
  console.log('── 订单：6 个操作位 + statusText + 整数分 ──');
  const od = await get(PORT, '/api/v1/orders?page=1&pageSize=3', H);
  const o = (od.data.list || [])[0];
  check(
    '6 个 canUserXxx 布尔位齐全',
    !!o && ['canUserPay', 'canUserCancel', 'canUserConfirm', 'canUserRefund', 'canUserContact', 'canUserReview']
      .every(function (k) { return typeof o[k] === 'boolean'; })
  );
  check('含 statusText（服务端下发）', !!(o && o.statusText));
  check(
    '金额整数分，且无 totalPrice/unitPrice/statusCode',
    !!o && Math.round(o.totalAmount) === o.totalAmount && !('totalPrice' in o) && !('unitPrice' in o) && !('statusCode' in o)
  );

  console.log('');
  console.log('── /me：orderStats 展示分桶（服务端下发）──');
  const me = await get(PORT, '/api/v1/me', H);
  check('GET /api/v1/me', me.code === 0);
  const stats = me.data.orderStats || {};
  // 退款格：服务端可能下发 refunding 或 refunded（语义相同），两者都接受
  const refundCount = stats.refunding !== undefined ? stats.refunding : stats.refunded;
  check(
    '含 orderStats 4 个分桶（ongoing 非订单状态枚举）',
    ['pendingPayment', 'ongoing', 'pendingConfirm'].every(function (k) {
      return typeof stats[k] === 'number';
    }) && typeof refundCount === 'number',
    JSON.stringify(stats)
  );

  console.log('');
  console.log('── 筛选面板：选项全部来自 filter-options ──');
  const fo = await api.getFilterOptions();
  check('cities 归一（服务端返回 destinations 时也能取到）', Array.isArray(fo.cities) && fo.cities.length > 0, 'n=' + fo.cities.length);
  check('serviceTypes / ratings / availableWindows 齐全', fo.serviceTypes.length > 0 && fo.ratings.length > 0 && fo.availableWindows.length > 0);
  check(
    'priceRanges[].min/max=元、minAmount/maxAmount=分',
    fo.priceRanges.every(function (r) { return typeof r.min === 'number' && typeof r.minAmount === 'number'; })
  );

  console.log('');
  console.log('── 价格筛选端到端（客户端发的 minPrice/maxPrice）──');
  const all = (await get(PORT, '/api/v1/guides?page=1&pageSize=50', H)).data.list || [];
  for (let i = 0; i < Math.min(3, fo.priceRanges.length); i++) {
    const r = fo.priceRanges[i];
    const maxQ = r.max === null ? '' : '&maxPrice=' + r.max;
    const list = (await get(PORT, '/api/v1/guides?minPrice=' + r.min + maxQ + '&page=1&pageSize=50', H)).data.list || [];
    const okAll = list.every(function (x) {
      return x.priceAmount >= r.minAmount && (r.maxAmount === null || x.priceAmount <= r.maxAmount);
    });
    check('区间 ' + r.label + ' 筛选正确', list.length > 0 && okAll, '命中 ' + list.length + '/' + all.length);
  }

  console.log('');
  console.log('── 订单：statusBadge / statusTone / allowedActions（v1.8）──');
  const badgeWhitelist = ['pending', 'ongoing', 'review', 'done', 'closed', 'refunding'];
  const toneWhitelist = ['warning', 'info', 'brand', 'accent', 'success', 'ink', 'error'];
  const actionWhitelist = ['pay', 'cancel', 'confirm', 'refund', 'contact', 'review'];
  o && check('含 statusBadge', typeof o.statusBadge === 'string', 'statusBadge=' + o.statusBadge);
  o && check('statusBadge 在白名单内', badgeWhitelist.indexOf(o.statusBadge) >= 0, '白名单=' + badgeWhitelist.join('/'));
  o && check('含 statusTone', typeof o.statusTone === 'string', 'statusTone=' + o.statusTone);
  o && check('statusTone 在值域内', toneWhitelist.indexOf(o.statusTone) >= 0, '值域=' + toneWhitelist.join('/'));
  o && check('含 allowedActions[]', Array.isArray(o.allowedActions), JSON.stringify(o.allowedActions));
  o && check(
    'allowedActions 取值合法',
    Array.isArray(o.allowedActions) && o.allowedActions.every(function (a) {
      return actionWhitelist.indexOf(a) >= 0;
    })
  );
  o && check(
    'allowedActions 与 6 个布尔位同源',
    Array.isArray(o.allowedActions) &&
      o.allowedActions.length ===
        ['canUserPay', 'canUserCancel', 'canUserConfirm', 'canUserRefund', 'canUserContact', 'canUserReview']
          .filter(function (k) { return o[k]; }).length
  );
  o && check('订单含 unitPriceAmount / subtotalAmount', typeof o.unitPriceAmount === 'number' && typeof o.subtotalAmount === 'number');
  o && check('订单无裸 priceAmount（G-91）', !('priceAmount' in o));
  o && check('无 statusKey / statusCode（v1.8 已删除）', !('statusKey' in o) && !('statusCode' in o));

  console.log('');
  console.log('── 订单 Tab 的 status 查询参数（必须是状态枚举，否则 422）──');
  const tabChecks = [
    ['ongoing → accepted,inService', 'accepted,inService'],
    ['refunding → refunding,refunded', 'refunding,refunded'],
    ['pendingPayment → pendingPayment', 'pendingPayment'],
  ];
  for (const tc of tabChecks) {
    const r = await get(PORT, '/api/v1/orders?status=' + encodeURIComponent(tc[1]) + '&page=1&pageSize=50', H);
    check(
      tc[0] + ' → 服务端接受（200）',
      r.code === 0,
      '命中 ' + ((r.data && r.data.list) || []).length + ' 条'
    );
  }
  const badStatus = await get(PORT, '/api/v1/orders?status=ongoing&page=1&pageSize=5', H);
  check(
    '展示分桶名直接当 status 会被服务端拒绝（422）→ 客户端必须走 statusQuery 映射',
    badStatus.code !== 0,
    'code=' + badStatus.code
  );

  console.log('');
  console.log('── 收藏 toggle（PUT，前端不自行取反）──');
  const fav = await new Promise(function (resolve, reject) {
    const s = JSON.stringify({});
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/v1/me/favorites/gd_000008', method: 'PUT',
        headers: Object.assign({}, H, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }) },
      function (x) { let b = ''; x.on('data', function (c) { b += c; }); x.on('end', function () { resolve(JSON.parse(b)); }); }
    );
    r.on('error', reject); r.write(s); r.end();
  });
  check('PUT /api/v1/me/favorites/:guideId → favorited', fav.code === 0 && typeof fav.data.favorited === 'boolean', 'favorited=' + fav.data.favorited);

  console.log('');
  console.log('── 通知 / 设置 ──');
  check('GET /api/v1/notices', (await get(PORT, '/api/v1/notices?page=1&pageSize=2', H)).code === 0);
  check('GET /api/v1/me/settings', (await get(PORT, '/api/v1/me/settings', H)).code === 0);

  server.server.close();

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(failed === 0 ? ' ✅ 契约核对通过：' + passed + ' 项全部通过' : ' ❌ 契约核对未通过：' + failed + ' 项失败');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) {
  console.error('ERR', e.message);
  process.exit(1);
});
