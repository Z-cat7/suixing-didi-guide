'use strict';

/**
 * 接口测试（核心契约）
 * ---------------------------------------------------------------------------
 * 运行方式：npm test
 * 实现：node:test + 原生 fetch（不需要 supertest 等额外依赖）。
 *
 * 测试会启动一个独立端口的临时服务实例，使用独立数据目录，
 * 不会污染 data/ 下的开发数据。
 *
 * 契约要点（见 docs/03-api-contract.md）：
 *   - 路径前缀只有 /api/v1
 *   - 字段全链路 camelCase
 *   - 金额一律整数分（*Amount）
 *   - 订单状态只有 camelCase 一种
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 使用独立数据目录，避免污染开发数据
const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dipi-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.TOKEN_SECRET = 'test-secret-dipi';
process.env.ENABLE_MOCK_LOGIN = 'true';

const app = require('../src/app');
const { seed } = require('../src/db/seed');

/* ---------------------------------------------------------------------------
 * 测试脚手架
 * ------------------------------------------------------------------------ */

let server;
let baseUrl;
let userToken;
let user2Token;
let guideToken;

async function request(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

const GET = (url, token) => request('GET', url, { token });
const POST = (url, body, token) => request('POST', url, { body, token });
const PUT = (url, body, token) => request('PUT', url, { body, token });

test.before(async () => {
  await seed({ force: true, silent: true });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const r1 = await POST('/api/v1/auth/login', { code: 'mock-user-001' });
  userToken = r1.body.data.token;
  const r2 = await POST('/api/v1/auth/login', { code: 'mock-user-002' });
  user2Token = r2.body.data.token;
  const r3 = await POST('/api/v1/auth/login', { code: 'mock-guide-001' });
  guideToken = r3.body.data.token;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch (err) {
    /* 忽略清理失败 */
  }
});

/** 取一个可用的 slotId（从地陪详情里挑第一个 available 的） */
async function firstAvailableSlot(guideId = 'gd_000001') {
  const res = await GET(`/api/v1/guides/${guideId}`);
  return res.body.data.guide.availableSlots.find((s) => s.available);
}

/* ---------------------------------------------------------------------------
 * 1. 健康检查与登录
 * ------------------------------------------------------------------------ */

test('GET /api/v1/health 返回 ok', async () => {
  const { status, body } = await GET('/api/v1/health');
  assert.equal(status, 200);
  assert.equal(body.code, 0);
  assert.equal(body.data.status, 'ok');
  assert.ok(body.requestId);
});

test('裸 /api/health 已不存在（只有 /api/v1）', async () => {
  const { status } = await GET('/api/health');
  assert.equal(status, 404);
});

test('POST /api/v1/auth/login 缺少 code 返回 422', async () => {
  const { status, body } = await POST('/api/v1/auth/login', {});
  assert.equal(status, 422);
  assert.equal(body.code, 42200);
});

test('POST /api/v1/auth/login mock 登录返回 token 与用户资料', async () => {
  const { status, body } = await POST('/api/v1/auth/login', { code: 'mock-user-001' });
  assert.equal(status, 200);
  assert.equal(body.code, 0);
  assert.ok(body.data.token);
  assert.equal(body.data.user.nickname, '随行用户001');
  assert.equal(body.data.user.userId, 'us_000001');
  assert.equal(body.data.expiresIn, 604800);
});

test('GET /api/v1/auth/profile 无 token 返回 401', async () => {
  const { status, body } = await GET('/api/v1/auth/profile');
  assert.equal(status, 401);
  assert.equal(body.code, 40100);
});

test('GET /api/v1/auth/profile 携带 token 返回当前用户', async () => {
  const { status, body } = await GET('/api/v1/auth/profile', userToken);
  assert.equal(status, 200);
  assert.equal(body.data.userId, 'us_000001');
  assert.ok(body.data.orderCount > 0);
});

test('GET /api/v1/auth/profile 伪造 token 返回 401', async () => {
  const { status, body } = await GET('/api/v1/auth/profile', 'abc.def');
  assert.equal(status, 401);
  assert.equal(body.code, 40101);
});

/* ---------------------------------------------------------------------------
 * 2. 首页
 * ------------------------------------------------------------------------ */

test('GET /api/v1/home 返回轮播/目的地/服务类型/推荐地陪', async () => {
  const { status, body } = await GET('/api/v1/home');
  assert.equal(status, 200);
  const d = body.data;
  assert.ok(Array.isArray(d.banners) && d.banners.length >= 3);
  assert.ok(Array.isArray(d.hotDestinations) && d.hotDestinations.length >= 4);
  assert.equal(d.serviceTypes.length, 6);
  assert.ok(Array.isArray(d.recommendGuides) && d.recommendGuides.length > 0);
  assert.ok(d.currentCity);
  assert.ok(d.recommendGuides[0].priceAmount > 0);
});

test('服务类型枚举为 camelCase', async () => {
  const { body } = await GET('/api/v1/home');
  const codes = body.data.serviceTypes.map((t) => t.code);
  assert.deepEqual(codes, [
    'foodTour', 'cityWalk', 'sightseeing', 'photo', 'parentChild', 'errand',
  ]);
});

/* ---------------------------------------------------------------------------
 * 3. 地陪列表：多条件组合筛选 + 排序 + 分页
 * ------------------------------------------------------------------------ */

test('GET /api/v1/guides 默认返回分页信封', async () => {
  const { status, body } = await GET('/api/v1/guides');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.list));
  assert.equal(typeof body.data.total, 'number');
  assert.equal(body.data.page, 1);
  assert.ok('hasMore' in body.data);
  assert.ok(body.data.total >= 12, `地陪总数应 ≥ 12，实际 ${body.data.total}`);
});

test('GET /api/v1/guides 按 destination 筛选', async () => {
  const { body } = await GET('/api/v1/guides?destination=成都');
  assert.ok(body.data.list.length > 0);
  for (const g of body.data.list) assert.equal(g.city, '成都');
});

test('GET /api/v1/guides 按 serviceType 筛选（camelCase 枚举）', async () => {
  const { body } = await GET('/api/v1/guides?serviceType=foodTour');
  assert.ok(body.data.list.length > 0);
  for (const g of body.data.list) assert.ok(g.serviceTypes.includes('foodTour'));
});

test('GET /api/v1/guides 按 keyword 模糊匹配（地陪名）', async () => {
  const { body } = await GET('/api/v1/guides?keyword=林小满');
  assert.equal(body.data.list.length, 1);
  assert.equal(body.data.list[0].name, '林小满');
});

test('GET /api/v1/guides 按 keyword 模糊匹配（标签）', async () => {
  const { body } = await GET('/api/v1/guides?keyword=胡同');
  assert.ok(body.data.list.length >= 1);
  assert.equal(body.data.list[0].name, '高远');
});

test('GET /api/v1/guides 按价格区间筛选（minPrice/maxPrice，单位元）', async () => {
  const { body } = await GET('/api/v1/guides?minPrice=300');
  for (const g of body.data.list) assert.ok(g.priceAmount >= 30000);
});

test('GET /api/v1/guides 按 rating 门槛筛选', async () => {
  const { body } = await GET('/api/v1/guides?rating=4.8');
  for (const g of body.data.list) assert.ok(g.rating >= 4.8);
});

test('GET /api/v1/guides 多条件组合筛选（城市+服务类型+价格+评分）', async () => {
  const { body } = await GET('/api/v1/guides?destination=北京&serviceType=cityWalk&minPrice=100&maxPrice=400&rating=4.5');
  assert.ok(body.data.list.length > 0);
  for (const g of body.data.list) {
    assert.equal(g.city, '北京');
    assert.ok(g.serviceTypes.includes('cityWalk'));
    assert.ok(g.priceAmount >= 10000 && g.priceAmount <= 40000);
    assert.ok(g.rating >= 4.5);
  }
});

test('GET /api/v1/guides sort=priceAsc 价格升序', async () => {
  const { body } = await GET('/api/v1/guides?sort=priceAsc');
  const amounts = body.data.list.map((g) => g.priceAmount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => a - b));
});

test('GET /api/v1/guides sort=priceDesc 价格降序', async () => {
  const { body } = await GET('/api/v1/guides?sort=priceDesc');
  const amounts = body.data.list.map((g) => g.priceAmount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
});

test('GET /api/v1/guides sort=rating 评分降序', async () => {
  const { body } = await GET('/api/v1/guides?sort=rating');
  const ratings = body.data.list.map((g) => g.rating);
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
});

test('GET /api/v1/guides 分页参数生效', async () => {
  const p1 = await GET('/api/v1/guides?page=1&pageSize=3');
  const p2 = await GET('/api/v1/guides?page=2&pageSize=3');
  assert.equal(p1.body.data.list.length, 3);
  assert.equal(p1.body.data.hasMore, true);
  assert.notEqual(p1.body.data.list[0].guideId, p2.body.data.list[0].guideId);
});

test('GET /api/v1/guides 非法 sort 返回 422', async () => {
  const { status, body } = await GET('/api/v1/guides?sort=xxx');
  assert.equal(status, 422);
  assert.equal(body.code, 42200);
});

test('GET /api/v1/guides/filter-options 返回筛选面板初始化数据', async () => {
  const { status, body } = await GET('/api/v1/guides/filter-options');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.destinations));
  assert.ok(Array.isArray(body.data.serviceTypes));
  assert.ok(body.data.priceRange.minAmount >= 0);
  assert.ok(body.data.priceRange.maxAmount > 0);
  assert.ok(Array.isArray(body.data.ratings));
});

/* ---------------------------------------------------------------------------
 * 4. 地陪详情（P7 / P8 共用）
 * ------------------------------------------------------------------------ */

test('GET /api/v1/guides/:guideId 返回完整详情', async () => {
  const { status, body } = await GET('/api/v1/guides/gd_000001');
  assert.equal(status, 200);
  const g = body.data.guide;
  assert.equal(g.guideId, 'gd_000001');
  assert.ok(g.name);
  assert.ok(g.rating >= 4);
  assert.ok(g.ratingCount > 0);
  assert.ok(g.completedOrderCount > 0);
  assert.ok(Array.isArray(g.tags));
  assert.ok(Array.isArray(g.services));
  assert.ok(g.services.length >= 2);
  assert.ok(g.services[0].serviceId);
  assert.ok(g.services[0].priceAmount > 0);
  assert.equal(Number.isInteger(g.services[0].priceAmount), true);
  assert.ok(Array.isArray(g.availableSlots));
  assert.ok(Array.isArray(g.reviews));
  assert.ok('favoritesCount' in g);
});

test('availableSlots 元素结构为 { slotId, date, timeSlot, available } 且覆盖 14 天', async () => {
  const { body } = await GET('/api/v1/guides/gd_000001');
  const slots = body.data.guide.availableSlots;
  assert.ok(slots.length >= 42, `时段数应 ≥ 42，实际 ${slots.length}`);
  const dates = new Set(slots.map((s) => s.date));
  assert.ok(dates.size >= 14, `应覆盖 ≥14 天，实际 ${dates.size}`);
  for (const s of slots) {
    assert.ok(s.slotId);
    assert.ok(s.date);
    assert.ok(s.timeSlot);
    assert.equal(typeof s.available, 'boolean');
  }
});

test('GET /api/v1/guides/:guideId 不存在返回 404', async () => {
  const { status, body } = await GET('/api/v1/guides/gd_999999');
  assert.equal(status, 404);
  assert.equal(body.code, 40400);
});

test('GET /api/v1/guides/:guideId/reviews 返回评价分页', async () => {
  const { status, body } = await GET('/api/v1/guides/gd_000001/reviews');
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  assert.ok(body.data.list[0].reviewId);
  assert.ok(body.data.list[0].rating >= 1 && body.data.list[0].rating <= 5);
  assert.equal(body.data.page, 1);
  assert.ok('hasMore' in body.data);
});

/* ---------------------------------------------------------------------------
 * 5. 会话与消息
 * ------------------------------------------------------------------------ */

test('GET /api/v1/conversations 未登录返回 401', async () => {
  const { status } = await GET('/api/v1/conversations');
  assert.equal(status, 401);
});

test('POST /api/v1/conversations 创建会话（幂等）', async () => {
  const r1 = await POST('/api/v1/conversations', { guideId: 'gd_000011' }, userToken);
  assert.equal(r1.status, 200);
  assert.ok(r1.body.data.conversationId);

  const r2 = await POST('/api/v1/conversations', { guideId: 'gd_000011' }, userToken);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.data.conversationId, r1.body.data.conversationId, '重复创建应返回同一会话');
});

test('GET /api/v1/conversations 返回会话列表含未读数', async () => {
  const { status, body } = await GET('/api/v1/conversations', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  const item = body.data.list[0];
  assert.ok('unreadCount' in item);
  assert.ok('lastMessageContent' in item);
  assert.ok('guideName' in item);
});

test('GET /api/v1/conversations/:conversationId/messages 他人会话返回 403', async () => {
  const { status, body } = await GET('/api/v1/conversations/cv_000004/messages', userToken);
  assert.equal(status, 403);
  assert.equal(body.code, 40301);
});

test('GET /api/v1/conversations/:conversationId/messages 返回消息历史（正序 + seq）', async () => {
  const { status, body } = await GET('/api/v1/conversations/cv_000001/messages', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  const times = body.data.list.map((m) => m.sentAt);
  assert.deepEqual(times, [...times].sort(), '消息应按时间正序返回');
  const seqs = body.data.list.map((m) => m.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'seq 应单调递增');
});

test('GET /api/v1/conversations/:conversationId/messages?since= 支持断线补拉', async () => {
  const all = await GET('/api/v1/conversations/cv_000001/messages', userToken);
  const lastSeq = all.body.data.list[all.body.data.list.length - 1].seq;
  const since = await GET(`/api/v1/conversations/cv_000001/messages?since=${lastSeq}`, userToken);
  assert.equal(since.status, 200);
  assert.equal(since.body.data.list.length, 0);
});

test('POST /api/v1/conversations/:conversationId/messages 发送消息成功', async () => {
  const { status, body } = await POST(
    '/api/v1/conversations/cv_000001/messages',
    { content: '测试消息内容', clientMessageId: 'c-test-1' },
    userToken
  );
  assert.equal(status, 200);
  assert.equal(body.data.content, '测试消息内容');
  assert.equal(body.data.clientMessageId, 'c-test-1');
  assert.equal(body.data.senderType, 'user');
  assert.ok(body.data.seq > 0);
});

test('GET /api/v1/messages 聚合通知与会话', async () => {
  const { status, body } = await GET('/api/v1/messages', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  const types = new Set(body.data.list.map((m) => m.type));
  assert.ok(types.has('conversation'));
});

test('GET /api/v1/messages?type=notice 只返回系统通知', async () => {
  const { body } = await GET('/api/v1/messages?type=notice', userToken);
  for (const m of body.data.list) assert.equal(m.type, 'notice');
});

/* ---------------------------------------------------------------------------
 * 6. 通知
 * ------------------------------------------------------------------------ */

test('GET /api/v1/notices 返回通知列表', async () => {
  const { status, body } = await GET('/api/v1/notices', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  assert.ok(body.data.list[0].notificationId);
  assert.ok('unreadCount' in body.data);
});

test('POST /api/v1/notices/read 标记全部已读', async () => {
  const { status, body } = await POST('/api/v1/notices/read', { all: true }, userToken);
  assert.equal(status, 200);
  assert.ok(body.data.updated > 0);

  const after = await GET('/api/v1/notices', userToken);
  assert.equal(after.body.data.unreadCount, 0);
});

/* ---------------------------------------------------------------------------
 * 7. 订单状态机：完整流转 + 非法迁移 409
 * ------------------------------------------------------------------------ */

test('POST /api/v1/orders 服务端计算价格（忽略前端传入的价格）', async () => {
  const guide = await GET('/api/v1/guides/gd_000001');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);

  const { status, body } = await POST('/api/v1/orders', {
    guideId: 'gd_000001',
    serviceId: service.serviceId,
    slotId: slot.slotId,
    travelers: 2,
    contactName: '测试',
    contactPhone: '13800000001',
    meetingPoint: '宽窄巷子东广场',
    remark: '测试订单',
    idempotencyKey: 'idem-price-test-1',
    // 恶意价格：应被忽略
    priceAmount: 1,
    totalAmount: 1,
    unitPriceAmount: 1,
  }, userToken);

  assert.equal(status, 200);
  assert.equal(body.data.status, 'pendingPayment');
  assert.equal(body.data.unitPriceAmount, service.priceAmount);
  assert.ok(body.data.totalAmount > 0);
  assert.notEqual(body.data.totalAmount, 1);
  assert.equal(Number.isInteger(body.data.totalAmount), true);
  assert.ok(body.data.discountAmount < body.data.subtotalAmount);
  assert.equal(body.data.travelers, 2);
  assert.equal(body.data.meetingPoint, '宽窄巷子东广场');
});

test('POST /api/v1/orders 缺少必填参数返回 422', async () => {
  const { status, body } = await POST('/api/v1/orders', { guideId: 'gd_000001' }, userToken);
  assert.equal(status, 422);
  assert.equal(body.code, 42200);
});

test('POST /api/v1/orders 服务项不属于该地陪返回 404', async () => {
  const slot = await firstAvailableSlot('gd_000002');
  const { status } = await POST('/api/v1/orders', {
    guideId: 'gd_000002',
    serviceId: 'si_000001', // 属于 gd_000001
    slotId: slot.slotId,
    travelers: 1,
    contactName: '测试',
    contactPhone: '13800000001',
  }, userToken);
  assert.equal(status, 404);
});

test('POST /api/v1/orders 幂等：相同 idempotencyKey 返回同一订单', async () => {
  const guide = await GET('/api/v1/guides/gd_000003');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);
  const payload = {
    guideId: 'gd_000003',
    serviceId: service.serviceId,
    slotId: slot.slotId,
    travelers: 1,
    contactName: '幂等测试',
    contactPhone: '13800000001',
    idempotencyKey: 'idem-test-001',
  };
  const r1 = await POST('/api/v1/orders', payload, userToken);
  const r2 = await POST('/api/v1/orders', payload, userToken);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.data.orderId, r1.body.data.orderId, '相同幂等键应返回同一订单');
});

test('POST /api/v1/orders 时段被抢占返回 409', async () => {
  const guide = await GET('/api/v1/guides/gd_000004');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);
  const payload = {
    guideId: 'gd_000004',
    serviceId: service.serviceId,
    slotId: slot.slotId,
    travelers: 1,
    contactName: '抢占测试',
    contactPhone: '13800000001',
    idempotencyKey: 'idem-slot-a',
  };
  const first = await POST('/api/v1/orders', payload, userToken);
  assert.equal(first.status, 200);

  // 换一个幂等键，但用同一个已被核销的 slotId
  const second = await POST('/api/v1/orders', { ...payload, idempotencyKey: 'idem-slot-b' }, userToken);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 40900);
  assert.ok(second.body.message.includes('已被预约'));
});

test('订单完整状态流转：创建→支付→接单→服务中→确认→完成→评价', async () => {
  const guide = await GET('/api/v1/guides/gd_000001');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);

  // 1. 创建
  const created = await POST('/api/v1/orders', {
    guideId: 'gd_000001',
    serviceId: service.serviceId,
    slotId: slot.slotId,
    travelers: 1,
    contactName: '流程测试',
    contactPhone: '13800000001',
    idempotencyKey: 'idem-flow-001',
  }, userToken);
  assert.equal(created.status, 200);
  const orderId = created.body.data.orderId;
  assert.equal(created.body.data.status, 'pendingPayment');

  // 2. 支付
  const paid = await POST(`/api/v1/orders/${orderId}/pay`, {}, userToken);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.data.status, 'pendingAccept');
  assert.equal(paid.body.data.statusText, '待接单');

  // 3. 接单（地陪）
  const accepted = await POST(`/api/v1/orders/${orderId}/accept`, {}, guideToken);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.status, 'accepted');

  // 4. 开始服务（地陪）
  const started = await POST(`/api/v1/orders/${orderId}/start`, {}, guideToken);
  assert.equal(started.status, 200);
  assert.equal(started.body.data.status, 'inService');

  // 5. 确认完成（用户）
  const confirmed = await POST(`/api/v1/orders/${orderId}/confirm`, {}, userToken);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.status, 'completed');
  assert.equal(confirmed.body.data.statusText, '已完成');
  assert.equal(confirmed.body.data.canUserReview, true);

  // 6. 评价
  const reviewed = await POST(`/api/v1/orders/${orderId}/review`, {
    rating: 5, comment: '非常好的一次体验',
  }, userToken);
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.data.rating, 5);
  assert.ok(reviewed.body.data.review.reviewId);
});

test('allowedActions 与 6 个 canUserXxx 同源，值域只有用户动作', async () => {
  const list = await GET('/api/v1/orders?status=pendingPayment', userToken);
  const order = list.body.data.list[0];
  const { body } = await GET(`/api/v1/orders/${order.orderId}`, userToken);
  const o = body.data;

  const USER_ACTIONS = ['pay', 'cancel', 'confirm', 'refund', 'contact', 'review'];
  for (const a of o.allowedActions) {
    assert.ok(USER_ACTIONS.includes(a), `allowedActions 含非用户动作：${a}`);
  }
  // 地陪侧动作不得出现在 allowedActions
  for (const guideAction of ['accept', 'start', 'finish', 'close', 'refund:approve', 'refund:reject']) {
    assert.ok(!o.allowedActions.includes(guideAction), `allowedActions 不应含地陪动作 ${guideAction}`);
  }
  // 与 canUserXxx 严格一致
  const expect = {
    pay: o.canUserPay, cancel: o.canUserCancel, confirm: o.canUserConfirm,
    refund: o.canUserRefund, contact: o.canUserContact, review: o.canUserReview,
  };
  for (const [action, flag] of Object.entries(expect)) {
    assert.equal(o.allowedActions.includes(action), flag, `${action} 与 canUser* 不一致`);
  }
  assert.ok(o.allowedActions.includes('pay'));
});

test('orderStats 四格互斥：每单只落一格，且不含 pendingConfirm', async () => {
  const { body } = await GET('/api/v1/me', userToken);
  const s = body.data.orderStats;
  const c = body.data.orderCounts;

  // ongoing 只 = accepted + inService，不含 pendingConfirm
  assert.equal(s.ongoing, c.accepted + c.inService);
  assert.equal(s.pendingConfirm, c.pendingConfirm);
  assert.equal(s.pendingPayment, c.pendingPayment);
  assert.equal(s.refunding, c.refunding + c.refunded);

  // 四格之和 ≤ 全部订单数（互斥性）
  const sum = s.pendingPayment + s.ongoing + s.pendingConfirm + s.refunding;
  assert.ok(sum <= c.all, `四格之和 ${sum} 不应超过 ${c.all}`);
});

test('订单对象含服务端下发的状态→操作映射（前端不自算）', async () => {
  const list = await GET('/api/v1/orders?status=pendingPayment', userToken);
  const order = list.body.data.list[0];
  const { body } = await GET(`/api/v1/orders/${order.orderId}`, userToken);
  for (const k of ['status', 'statusText', 'canUserPay', 'canUserCancel', 'canUserConfirm',
    'canUserRefund', 'canUserContact', 'canUserReview']) {
    assert.ok(k in body.data, `订单对象缺少 ${k}`);
  }
  assert.equal(body.data.canUserPay, true);
  assert.equal(body.data.canUserReview, false);
  assert.ok(Array.isArray(body.data.timeline));
  assert.ok('serverTime' in body.data);
});

test('POST /api/v1/orders/:orderId/pay 重复支付返回 409', async () => {
  const list = await GET('/api/v1/orders?status=pendingPayment', userToken);
  const pending = list.body.data.list[0];
  assert.ok(pending, '种子数据应包含待支付订单');

  const first = await POST(`/api/v1/orders/${pending.orderId}/pay`, {}, userToken);
  assert.equal(first.status, 200);

  const second = await POST(`/api/v1/orders/${pending.orderId}/pay`, {}, userToken);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 40901);
});

test('POST /api/v1/orders/:orderId/confirm 非服务中状态返回 409', async () => {
  const list = await GET('/api/v1/orders?status=pendingAccept', userToken);
  const order = list.body.data.list[0];
  const res = await POST(`/api/v1/orders/${order.orderId}/confirm`, {}, userToken);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 40901);
  assert.ok(res.body.data.allowedActions, '409 应返回允许的动作列表');
});

test('POST /api/v1/orders/:orderId/cancel 已完成订单取消返回 409', async () => {
  const list = await GET('/api/v1/orders?status=completed', userToken);
  const order = list.body.data.list[0];
  const res = await POST(`/api/v1/orders/${order.orderId}/cancel`, { reason: '测试' }, userToken);
  assert.equal(res.status, 409);
});

test('POST /api/v1/orders/:orderId/refund 待支付订单申请退款返回 409', async () => {
  const list = await GET('/api/v1/orders?status=pendingPayment', userToken);
  const order = list.body.data.list[0];
  const res = await POST(`/api/v1/orders/${order.orderId}/refund`, { reason: '测试' }, userToken);
  assert.equal(res.status, 409);
});

test('GET /api/v1/orders/:orderId 他人订单返回 403', async () => {
  const list = await GET('/api/v1/orders', userToken);
  const order = list.body.data.list[0];
  const res = await GET(`/api/v1/orders/${order.orderId}`, user2Token);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 40302);
});

test('GET /api/v1/orders 状态过滤支持逗号分隔多状态（camelCase）', async () => {
  const { body } = await GET('/api/v1/orders?status=completed,refunded', userToken);
  assert.ok(body.data.list.length > 0);
  for (const o of body.data.list) {
    assert.ok(['completed', 'refunded'].includes(o.status));
  }
});

test('GET /api/v1/orders 非法状态过滤返回 422（只接受 camelCase）', async () => {
  const { status, body } = await GET('/api/v1/orders?status=not_exist', userToken);
  assert.equal(status, 422);
  assert.equal(body.code, 42200);
});

test('GET /api/v1/orders/summary 返回 countByStatus', async () => {
  const { status, body } = await GET('/api/v1/orders/summary', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.countByStatus.all > 0);
  assert.ok('pendingPayment' in body.data.countByStatus);
});

test('GET /api/v1/orders/:orderId 不存在返回 404', async () => {
  const { status, body } = await GET('/api/v1/orders/ord_999999', userToken);
  assert.equal(status, 404);
});

test('POST /api/v1/orders/:orderId/accept 非地陪身份返回 403', async () => {
  const guide = await GET('/api/v1/guides/gd_000001');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);
  const created = await POST('/api/v1/orders', {
    guideId: 'gd_000001',
    serviceId: service.serviceId,
    slotId: slot.slotId,
    travelers: 1,
    contactName: '越权测试',
    contactPhone: '13800000001',
    idempotencyKey: 'idem-403-001',
  }, userToken);
  const orderId = created.body.data.orderId;
  await POST(`/api/v1/orders/${orderId}/pay`, {}, userToken);

  const res = await POST(`/api/v1/orders/${orderId}/accept`, {}, userToken);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 40302);
});

test('POST /api/v1/orders/:orderId/review 非 completed 状态返回 409', async () => {
  const list = await GET('/api/v1/orders?status=pendingPayment', userToken);
  const order = list.body.data.list[0];
  const res = await POST(`/api/v1/orders/${order.orderId}/review`, {
    rating: 5, comment: '不应该成功',
  }, userToken);
  assert.equal(res.status, 409);
});

/* ---------------------------------------------------------------------------
 * 8. 「我」：资料 / 收藏 / 设置
 * ------------------------------------------------------------------------ */

test('GET /api/v1/me 返回个人资料与 orderStats 四格统计', async () => {
  const { status, body } = await GET('/api/v1/me', userToken);
  assert.equal(status, 200);
  assert.equal(body.data.userId, 'us_000001');
  assert.ok('favoritesCount' in body.data);
  assert.ok(body.data.orderStats, '必须含 orderStats 聚合');
  for (const k of ['pendingPayment', 'ongoing', 'pendingConfirm', 'refunding']) {
    assert.ok(k in body.data.orderStats, `orderStats 缺少 ${k}`);
    assert.equal(typeof body.data.orderStats[k], 'number');
  }
});

test('PUT /api/v1/me 更新资料', async () => {
  const { status, body } = await PUT('/api/v1/me', {
    nickname: '新的昵称', city: '重庆', bio: '更新后的简介',
  }, userToken);
  assert.equal(status, 200);
  assert.equal(body.data.nickname, '新的昵称');
  assert.equal(body.data.city, '重庆');
});

test('PUT /api/v1/me 非法性别返回 422', async () => {
  const { status } = await PUT('/api/v1/me', { gender: 'xxx' }, userToken);
  assert.equal(status, 422);
});

test('GET /api/v1/me/orders 返回订单与状态计数', async () => {
  const { status, body } = await GET('/api/v1/me/orders', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  assert.ok(body.data.countByStatus.pendingPayment >= 0);
});

test('PUT /api/v1/me/favorites/:guideId 收藏 toggle（幂等切换）', async () => {
  const r1 = await PUT('/api/v1/me/favorites/gd_000005', {}, userToken);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.data.guideId, 'gd_000005');
  assert.equal(r1.body.data.favorited, true);
  assert.equal(typeof r1.body.data.favoritesCount, 'number');

  const r2 = await PUT('/api/v1/me/favorites/gd_000005', {}, userToken);
  assert.equal(r2.status, 200);
  assert.equal(r2.body.data.favorited, false, '再次调用应切回未收藏');

  const r3 = await PUT('/api/v1/me/favorites/gd_000005', {}, userToken);
  assert.equal(r3.body.data.favorited, true);
  await PUT('/api/v1/me/favorites/gd_000005', {}, userToken); // 复原
});

test('GET /api/v1/me/favorites 返回收藏列表', async () => {
  const { status, body } = await GET('/api/v1/me/favorites', userToken);
  assert.equal(status, 200);
  assert.ok(body.data.list.length > 0);
  assert.ok(body.data.list[0].guideId.startsWith('gd_'));
});

test('GET /api/v1/me/settings 返回默认设置', async () => {
  const { status, body } = await GET('/api/v1/me/settings', userToken);
  assert.equal(status, 200);
  assert.equal(typeof body.data.notifyOrder, 'boolean');
  assert.equal(typeof body.data.privacyLocation, 'boolean');
});

test('PUT /api/v1/me/settings 更新设置', async () => {
  const { status, body } = await PUT('/api/v1/me/settings', {
    notifyPromotion: true, notifySound: false,
  }, userToken);
  assert.equal(status, 200);
  assert.equal(body.data.notifyPromotion, true);
  assert.equal(body.data.notifySound, false);
});

/* ---------------------------------------------------------------------------
 * 9. 通用：404 与响应信封
 * ------------------------------------------------------------------------ */

test('未知路由返回 404 且带 requestId', async () => {
  const { status, body } = await GET('/api/v1/not-exist');
  assert.equal(status, 404);
  assert.equal(body.code, 40400);
  assert.ok(body.requestId);
});

test('响应信封结构完整', async () => {
  const { body } = await GET('/api/v1/health');
  for (const key of ['code', 'message', 'data', 'requestId']) {
    assert.ok(key in body, `响应缺少字段 ${key}`);
  }
});
