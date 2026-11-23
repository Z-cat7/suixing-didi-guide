'use strict';

/**
 * 验收脚本
 * ---------------------------------------------------------------------------
 * 逐条实测 team-lead 要求的 6 项验收，输出可核对的摘要。
 * 用法：node scripts/verify.js [baseUrl]
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
// 每次运行用唯一的幂等键前缀（服务端幂等语义是「跨请求有效」，脚本需自隔离）
const RUN = `run-${Date.now()}`;
let pass = 0;
let fail = 0;

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function check(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}${detail ? `  → ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? `  → ${detail}` : ''}`);
  }
}

async function main() {
  console.log('【1】POST /api/v1/auth/login');
  const login = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-user-001' } });
  const UT = login.body.data.token;
  check('登录拿 token', login.status === 200 && !!UT, `HTTP ${login.status}, token=${UT.slice(0, 32)}…`);
  const login2 = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-user-002' } });
  const U2 = login2.body.data.token;
  const loginG = await call('POST', '/api/v1/auth/login', { body: { code: 'mock-guide-001' } });
  const GT = loginG.body.data.token;

  console.log('\n【2】GET /api/v1/home');
  const home = await call('GET', '/api/v1/home', { token: UT });
  const h = home.body.data;
  check('首页聚合', home.status === 200 && h.banners.length >= 3 && h.hotDestinations.length >= 4
    && h.serviceTypes.length === 6 && h.recommendGuides.length > 0,
  `currentCity=${h.currentCity} banners=${h.banners.length} hotDestinations=${h.hotDestinations.length}`
  + ` serviceTypes=${h.serviceTypes.length} recommendGuides=${h.recommendGuides.length}`
  + ` 首条=${h.recommendGuides[0].name} ¥${h.recommendGuides[0].priceAmount / 100} ⭐${h.recommendGuides[0].rating}`);
  check('服务类型枚举为 camelCase',
    JSON.stringify(h.serviceTypes.map((t) => t.code)) === JSON.stringify(
      ['foodTour', 'cityWalk', 'sightseeing', 'photo', 'parentChild', 'errand']));

  console.log('\n【3】GET /api/v1/guides?destination=成都&serviceType=foodTour&minPrice=100&maxPrice=300&sort=rating');
  const q = await call('GET', '/api/v1/guides?destination=%E6%88%90%E9%83%BD&serviceType=foodTour&minPrice=100&maxPrice=300&sort=rating', { token: UT });
  const l = q.body.data;
  const allMatch = l.list.every((g) => g.city === '成都' && g.serviceTypes.includes('foodTour')
    && g.priceAmount >= 10000 && g.priceAmount <= 30000);
  const ratings = l.list.map((g) => g.rating);
  const sorted = ratings.every((r, i) => i === 0 || ratings[i - 1] >= r);
  check('组合筛选生效', q.status === 200 && allMatch && sorted,
    `total=${l.total} → ${l.list.map((g) => `${g.name}(¥${g.priceAmount / 100},⭐${g.rating})`).join(' | ')}`);

  console.log('\n【4】GET /api/v1/guides/gd_000001');
  const gd = await call('GET', '/api/v1/guides/gd_000001', { token: UT });
  const g = gd.body.data.guide;
  check('有 services[] 且元素含 serviceId',
    Array.isArray(g.services) && g.services.length > 0 && !!g.services[0].serviceId,
    `services=${g.services.length} serviceId=${g.services[0].serviceId} priceAmount=${g.services[0].priceAmount}分`);
  check('有 availableSlots[] 且结构为 { slotId, date, timeSlot, available }',
    Array.isArray(g.availableSlots) && g.availableSlots.length > 0
    && Object.keys(g.availableSlots[0]).sort().join(',') === 'available,date,slotId,timeSlot',
    `slots=${g.availableSlots.length} 覆盖天数=${new Set(g.availableSlots.map((s) => s.date)).size}`
    + ` 首条={slotId:${g.availableSlots[0].slotId}, date:${g.availableSlots[0].date},`
    + ` timeSlot:${g.availableSlots[0].timeSlot}, available:${g.availableSlots[0].available}}`);
  check('有 rating / ratingCount / completedOrderCount / tags[] / favoritesCount',
    typeof g.rating === 'number' && typeof g.ratingCount === 'number'
    && typeof g.completedOrderCount === 'number' && Array.isArray(g.tags)
    && typeof g.favoritesCount === 'number',
    `rating=${g.rating} ratingCount=${g.ratingCount} completedOrderCount=${g.completedOrderCount}`
    + ` tags=${JSON.stringify(g.tags)} favoritesCount=${g.favoritesCount}`);

  console.log('\n【5】GET /api/v1/me');
  const me = await call('GET', '/api/v1/me', { token: UT });
  const m = me.body.data;
  check('有 orderStats 四格聚合',
    me.status === 200 && m.orderStats && ['pendingPayment', 'ongoing', 'pendingConfirm', 'refunding']
      .every((k) => typeof m.orderStats[k] === 'number'),
    `userId=${m.userId} orderStats=${JSON.stringify(m.orderStats)} favoritesCount=${m.favoritesCount}`);

  console.log('\n【6】下单链路 / 幂等 / 时段抢占 / 非法迁移 / 越权');
  const g2 = await call('GET', '/api/v1/guides/gd_000002', { token: UT });
  const gg = g2.body.data.guide;
  const slot = gg.availableSlots.find((s) => s.available);
  const svc = gg.services[0];
  const payload = {
    guideId: 'gd_000002', serviceId: svc.serviceId, slotId: slot.slotId,
    travelers: 2, contactName: '验收', contactPhone: '13800000001',
    meetingPoint: '宽窄巷子', idempotencyKey: `${RUN}-acc-001`, totalAmount: 1,
  };
  const created = await call('POST', '/api/v1/orders', { token: UT, body: payload });
  const orderId = created.body.data.orderId;
  check('创建订单（服务端算价，忽略前端 totalAmount=1）',
    created.status === 200 && created.body.data.totalAmount !== 1
    && created.body.data.totalAmount === svc.priceAmount * svc.durationHours * 2,
    `orderId=${orderId} unitPriceAmount=${created.body.data.unitPriceAmount}`
    + ` totalAmount=${created.body.data.totalAmount}分（前端传 1 被忽略）`);

  const idem = await call('POST', '/api/v1/orders', { token: UT, body: payload });
  check('幂等：同 idempotencyKey 返回同一订单',
    idem.body.data.orderId === orderId, `orderId=${idem.body.data.orderId}（与首次相同=${idem.body.data.orderId === orderId}）`);

  const taken = await call('POST', '/api/v1/orders', {
    token: UT, body: { ...payload, travelers: 1, idempotencyKey: `${RUN}-acc-002` },
  });
  check('时段抢占 → 409 + 可展示文案',
    taken.status === 409 && taken.body.data.reason === 'slot_taken'
    && taken.body.message.includes('已被预约'),
    `HTTP ${taken.status} code=${taken.body.code} message="${taken.body.message}" reason=${taken.body.data.reason}`);

  await call('POST', `/api/v1/orders/${orderId}/pay`, { token: UT, body: {} });
  const illegal = await call('POST', `/api/v1/orders/${orderId}/pay`, { token: UT, body: {} });
  check('非法状态迁移 → 409 / 40901',
    illegal.status === 409 && illegal.body.code === 40901,
    `HTTP ${illegal.status} code=${illegal.body.code} "${illegal.body.message}"`);

  const forbidden = await call('GET', `/api/v1/orders/${orderId}`, { token: U2 });
  check('越权访问他人订单 → 403 / 40302',
    forbidden.status === 403 && forbidden.body.code === 40302,
    `HTTP ${forbidden.status} code=${forbidden.body.code} "${forbidden.body.message}"`);

  console.log('\n【7】完整状态流转');
  // mock-guide-001 对应林小满 = gd_000001，必须用同一地陪才能跑地陪侧动作
  const flow = await call('GET', '/api/v1/guides/gd_000001', { token: UT });
  const fg = flow.body.data.guide;
  const fslot = fg.availableSlots.find((s) => s.available);
  const fsvc = fg.services[0];
  const f = await call('POST', '/api/v1/orders', {
    token: UT,
    body: {
      guideId: 'gd_000001', serviceId: fsvc.serviceId, slotId: fslot.slotId,
      travelers: 1, contactName: '流程', contactPhone: '13800000001',
      idempotencyKey: `${RUN}-acc-flow-001`,
    },
  });
  const fid = f.body.data.orderId;
  const steps = [['pay', UT], ['accept', GT], ['start', GT], ['confirm', UT]];
  for (const [act, tk] of steps) {
    const r = await call('POST', `/api/v1/orders/${fid}/${act}`, { token: tk, body: {} });
    console.log(`     ${act.padEnd(8)} HTTP ${r.status}  ${r.body.data.status}/${r.body.data.statusText}`
      + `  canPay=${r.body.data.canUserPay} canCancel=${r.body.data.canUserCancel}`
      + ` canConfirm=${r.body.data.canUserConfirm} canRefund=${r.body.data.canUserRefund}`
      + ` canReview=${r.body.data.canUserReview}`);
  }
  const rev = await call('POST', `/api/v1/orders/${fid}/review`, {
    token: UT, body: { rating: 5, comment: '非常好的一次体验' },
  });
  check('评价写入', rev.status === 200 && rev.body.data.review.reviewId,
    `reviewId=${rev.body.data.review && rev.body.data.review.reviewId} rating=${rev.body.data.rating}`);

  console.log('\n【8】收藏 toggle（幂等）');
  const f0 = await call('GET', '/api/v1/me/favorites', { token: UT });
  const before = f0.body.data.list.some((g) => g.guideId === 'gd_000012');
  const f1 = await call('PUT', '/api/v1/me/favorites/gd_000012', { token: UT });
  const f2 = await call('PUT', '/api/v1/me/favorites/gd_000012', { token: UT });
  check('toggle 两次 → 状态翻转且返回 favoritesCount',
    f1.body.data.favorited === !before && f2.body.data.favorited === before
    && typeof f1.body.data.favoritesCount === 'number',
    `初始=${before} → 1st favorited=${f1.body.data.favorited} count=${f1.body.data.favoritesCount}`
    + ` → 2nd favorited=${f2.body.data.favorited} count=${f2.body.data.favoritesCount}`
    + `（回到初始=${f2.body.data.favorited === before}）`);

  console.log(`\n通过 ${pass} · 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
