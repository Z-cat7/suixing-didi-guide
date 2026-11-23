'use strict';

/**
 * 冒烟脚本：逐个探测所有主要接口，打印 HTTP 状态与关键字段。
 * 用法：node scripts/smoke.js [baseUrl]
 *
 * 契约：路径前缀只有 /api/v1；字段全链路 camelCase；金额为整数分。
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

function summarize(r) {
  const d = r.body.data;
  if (d === null || d === undefined) return `code=${r.body.code} ${r.body.message}`;
  if (Array.isArray(d.list)) return `list=${d.list.length} total=${d.total} hasMore=${d.hasMore}`;
  if (d.guide && d.guide.services) {
    return `guide=${d.guide.guideId} services=${d.guide.services.length}`
      + ` slots=${d.guide.availableSlots.length} reviews=${d.guide.reviews.length}`;
  }
  if (d.conversationId) {
    return `conversationId=${d.conversationId} guide=${d.guideName || (d.guide && d.guide.name)}`
      + ` unread=${d.unreadCount}`;
  }
  if (d.status && d.statusText) {
    return `${d.status}/${d.statusText} ¥${(d.totalAmount / 100).toFixed(2)}`
      + ` canPay=${d.canUserPay} canCancel=${d.canUserCancel} canReview=${d.canUserReview}`;
  }
  if (d.status) return `status=${d.status}`;
  if (d.userId) return `userId=${d.userId} orderStats=${JSON.stringify(d.orderStats)}`;
  if (d.token) return 'token ok';
  if (d.guideId) return `guideId=${d.guideId} favorited=${d.favorited} count=${d.favoritesCount}`;
  return Object.keys(d).slice(0, 6).join(',');
}

async function main() {
  const login = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-user-001' } });
  const UT = login.body.data.token;
  const login2 = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-user-002' } });
  const U2 = login2.body.data.token;
  const loginG = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-guide-001' } });
  const GT = loginG.body.data.token;

  const cases = [
    ['GET', '/api/v1/health', {}],
    ['GET', '/api/v1/home', {}],
    ['GET', '/api/v1/guides', {}],
    ['GET', '/api/v1/guides?destination=成都&serviceType=foodTour&minPrice=80&maxPrice=200&rating=4.5&sort=priceAsc', {}],
    ['GET', '/api/v1/guides?sort=rating', {}],
    ['GET', '/api/v1/guides/filter-options', {}],
    ['GET', '/api/v1/guides/gd_000004', {}],
    ['GET', '/api/v1/guides/gd_999999', {}],
    ['GET', '/api/v1/guides/gd_000004/reviews', {}],
    ['GET', '/api/v1/auth/profile', { token: UT }],
    ['GET', '/api/v1/auth/profile', {}],
    ['GET', '/api/v1/conversations', { token: UT }],
    ['POST', '/api/v1/conversations', { token: UT, body: { guideId: 'gd_000012' } }],
    ['GET', '/api/v1/conversations/cv_000001/messages', { token: UT }],
    ['GET', '/api/v1/conversations/cv_000004/messages', { token: UT }],
    ['POST', '/api/v1/conversations/cv_000001/messages', { token: UT, body: { content: 'smoke test' } }],
    ['GET', '/api/v1/messages', { token: UT }],
    ['GET', '/api/v1/messages?type=notice', { token: UT }],
    ['GET', '/api/v1/notices', { token: UT }],
    ['POST', '/api/v1/notices/read', { token: UT, body: { all: true } }],
    ['GET', '/api/v1/orders', { token: UT }],
    ['GET', '/api/v1/orders?status=completed,refunded', { token: UT }],
    ['GET', '/api/v1/orders?status=bogus', { token: UT }],
    ['GET', '/api/v1/orders/summary', { token: UT }],
    ['GET', '/api/v1/orders/ord_000001', { token: UT }],
    ['GET', '/api/v1/orders/ord_000001', { token: U2 }],
    ['GET', '/api/v1/me', { token: UT }],
    ['PUT', '/api/v1/me', { token: UT, body: { city: '成都' } }],
    ['GET', '/api/v1/me/orders', { token: UT }],
    ['GET', '/api/v1/me/favorites', { token: UT }],
    ['PUT', '/api/v1/me/favorites/gd_000005', { token: UT }],
    ['GET', '/api/v1/me/settings', { token: UT }],
    ['PUT', '/api/v1/me/settings', { token: UT, body: { notifyPromotion: true } }],
    ['GET', '/api/v1/not-exist', {}],
    ['GET', '/api/health', {}],
  ];

  let okCount = 0;
  let errCount = 0;
  for (const [method, path, opts] of cases) {
    const r = await call(method, path, opts);
    const label = `${method} ${path}`;
    console.log(`${String(r.status).padEnd(4)} ${label.padEnd(74)} ${summarize(r)}`);
    if (r.status < 400) okCount += 1; else errCount += 1;
  }

  // 完整状态流转
  console.log('\n--- 完整状态流转 ---');
  const guide = await call('GET', '/api/v1/guides/gd_000001');
  const service = guide.body.data.guide.services[0];
  const slot = guide.body.data.guide.availableSlots.find((s) => s.available);
  const created = await call('POST', '/api/v1/orders', {
    token: UT,
    body: {
      guideId: 'gd_000001',
      serviceId: service.serviceId,
      slotId: slot.slotId,
      travelers: 2,
      contactName: '冒烟测试',
      contactPhone: '13800000001',
      meetingPoint: '宽窄巷子东广场',
      idempotencyKey: `smoke-${Date.now()}`,
      totalAmount: 1, // 恶意价格，应被忽略
    },
  });
  const orderId = created.body.data.orderId;
  console.log(`创建   ${orderId}  ${summarize(created)}`);

  for (const step of ['pay', 'accept', 'start', 'confirm']) {
    const token = (step === 'accept' || step === 'start') ? GT : UT;
    const r = await call('POST', `/api/v1/orders/${orderId}/${step}`, { token, body: {} });
    console.log(`${step.padEnd(6)} ${summarize(r)}`);
  }
  const reviewed = await call('POST', `/api/v1/orders/${orderId}/review`, {
    token: UT, body: { rating: 5, comment: '非常好的一次体验' },
  });
  console.log(`review ${summarize(reviewed)}`);

  console.log(`\n成功 ${okCount} · 失败 ${errCount}（4xx 中含预期越权/校验场景）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
