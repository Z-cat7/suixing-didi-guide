'use strict';

/**
 * 订单业务逻辑
 * ---------------------------------------------------------------------------
 * 【契约收敛】
 *   - 金额一律整数分（*Amount），服务端权威计算，前端传的价格字段一律忽略
 *   - 状态一律 camelCase（见 models/statusMap.js）
 *   - 预约时段用稳定唯一标识 slotId（下单时原子核销）
 *   - idempotencyKey 幂等：重复提交返回同一订单
 */

const store = require('../db/store');
const { assertTransition, ACTION_TEXT } = require('./orderStateMachine');
const {
  STATUS_TEXT, statusView, allowedUserActions, UNIT_TEXT, UNIT_ENUM,
  pendingPayment, pendingAccept, accepted, inService, pendingConfirm,
  completed, cancelled, closed, refunding, refunded,
} = require('../models/statusMap');
const { discountOf, toCstIso, nowCst, addHoursIso } = require('../utils/money');
const {
  notFound, forbiddenOrder, unprocessable, conflictOrderStatus, conflict,
} = require('../utils/errors');

/** 待支付有效期（分钟） */
const PAY_EXPIRE_MINUTES = 15;

/**
 * 计算订单价格（服务端权威，全程整数分）
 * ---------------------------------------------------------------------------
 * 公式：总价 = 服务项单价(分) × 时长系数 × 人数系数 - 优惠(分)
 *   - 时长系数 durationFactor：
 *       priceUnit='hour'   → durationHours（按小时计费）
 *       priceUnit='session'→ 1（按次计费）
 *       priceUnit='person' → 1（按人计费，人数已在人数系数中体现）
 *   - 人数系数 peopleFactor：
 *       priceUnit='hour'   → travelers
 *       priceUnit='session'→ 1（按次不乘人数）
 *       priceUnit='person' → travelers
 *   - 优惠：新人首单 9 折 / 时长 ≥ 4 小时 95 折，取更优（不叠加）
 *
 * @param {object} serviceItem 服务项（priceAmount 为分）
 * @param {number} travelers 人数
 * @param {object} opts { isFirstOrder }
 */
function calcPrice(serviceItem, travelers, opts = {}) {
  const unitPriceAmount = Number(serviceItem.priceAmount) || 0;
  const durationHours = Number(serviceItem.durationHours) || 1;
  const unit = serviceItem.priceUnit || 'hour';

  let durationFactor = 1;
  let peopleFactor = 1;

  if (unit === 'hour') {
    durationFactor = durationHours;
    peopleFactor = travelers;
  } else if (unit === 'person') {
    durationFactor = 1;
    peopleFactor = travelers;
  } else {
    durationFactor = 1;   // session：按次计费，不随人数变化
    peopleFactor = 1;
  }

  const subtotalAmount = unitPriceAmount * durationFactor * peopleFactor;

  const rules = [];
  if (opts.isFirstOrder) rules.push({ rate: 0.1, reason: '新客首单 9 折' });
  if (durationHours >= 4) rules.push({ rate: 0.05, reason: '长单服务 95 折' });

  let discountAmount = 0;
  let discountReason = '';
  for (const r of rules) {
    const amount = discountOf(subtotalAmount, r.rate);
    if (amount > discountAmount) {
      discountAmount = amount;
      discountReason = r.reason;
    }
  }

  return {
    unitPriceAmount,
    durationFactor,
    peopleFactor,
    subtotalAmount,
    discountAmount,
    discountReason,
    totalAmount: subtotalAmount - discountAmount,
  };
}

/**
 * 判断用户是否是首单（没有任何已支付过的订单）
 */
function isFirstOrder(userId) {
  const orders = store.read('orders').filter((o) => o.userId === userId);
  return !orders.some((o) => o.status !== pendingPayment
    && o.status !== cancelled);
}

/**
 * 按 idempotencyKey 查找已有订单（幂等）
 * @param {string} userId
 * @param {string} idempotencyKey
 */
function findByIdempotencyKey(userId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return store.read('orders').find(
    (o) => o.userId === userId && o.idempotencyKey === idempotencyKey
  ) || null;
}

/**
 * 收集某地陪的全部可约时段（其所有服务项的时段并集）
 * @param {string} guideId
 * @returns {object[]} [{ slotId, date, timeSlot, available }]
 */
function collectGuideSlots(guideId) {
  const map = new Map();
  for (const s of store.read('serviceItems')) {
    if (s.guideId !== guideId) continue;
    for (const slot of s.slots || []) {
      if (!map.has(slot.slotId)) map.set(slot.slotId, slot);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (a.date === b.date ? a.slotId.localeCompare(b.slotId) : a.date.localeCompare(b.date))
  );
}

/**
 * 校验并预约时段（原子核销）
 * ---------------------------------------------------------------------------
 * 核销维度：**地陪 + slotId**（不是「服务项 + slotId」）。
 * 理由：地陪是一个真人，同一天同一时段只能陪一个人——
 *       约了「美食陪逛」就同时约不了「城市漫游」。
 * 因此占用记录放在 guide.bookedSlots（地陪级），与地陪的所有服务项共享。
 *
 * 校验通过即核销：把 slotId 写入 guide.bookedSlots。
 * 已被占用 → 409，message 可直接展示给用户。
 *
 * @param {object} guide 地陪
 * @param {string} slotId
 * @returns {object} { slotId, date, timeSlot }
 */
function reserveSlot(guide, slotId) {
  const slots = collectGuideSlots(guide.id);
  const slot = slots.find((s) => s.slotId === slotId);
  if (!slot) {
    throw conflict('该时段暂不可约，请选择其他时段', {
      slotId,
      reason: 'slot_not_found',
      message: '该时段暂不可约，请选择其他时段',
    });
  }
  const booked = Array.isArray(guide.bookedSlots) ? guide.bookedSlots : [];
  if (booked.includes(slotId)) {
    throw conflict('该时段已被预约，请选择其他时段', {
      slotId,
      reason: 'slot_taken',
      message: '该时段已被预约，请选择其他时段',
    });
  }
  // 核销（地陪级）
  guide.bookedSlots = [...booked, slotId];
  store.markDirty('guides');
  return slot;
}

/**
 * 释放已预约时段（订单取消/关闭时）
 * @param {string} guideId
 * @param {string} slotId
 */
function releaseSlot(guideId, slotId) {
  if (!guideId || !slotId) return;
  const guide = store.findById('guides', guideId);
  if (!guide) return;
  const booked = Array.isArray(guide.bookedSlots) ? guide.bookedSlots : [];
  if (!booked.includes(slotId)) return;
  guide.bookedSlots = booked.filter((x) => x !== slotId);
  store.markDirty('guides');
}

/**
 * 创建订单
 * @param {string} userId
 * @param {object} payload { guideId, serviceId, slotId, travelers, contactName, contactPhone, meetingPoint, remark, conversationId, idempotencyKey }
 */
function createOrder(userId, payload) {
  // 幂等：同一用户 + 同一 idempotencyKey 直接返回原订单
  const existing = findByIdempotencyKey(userId, payload.idempotencyKey);
  if (existing) return existing;

  const guide = store.findById('guides', payload.guideId);
  if (!guide) throw notFound('地陪不存在');

  const serviceItem = store.read('serviceItems').find(
    (s) => s.id === payload.serviceId && s.guideId === guide.id
  );
  if (!serviceItem) throw notFound('服务项目不存在或不属于该地陪');

  const travelers = Number(payload.travelers) || 1;
  const minT = serviceItem.minTravelers || 1;
  const maxT = serviceItem.maxTravelers || 8;
  if (travelers < minT || travelers > maxT) {
    throw unprocessable(`该服务最多 ${maxT} 人`, { maxTravelers: maxT, minTravelers: minT });
  }

  // 原子核销时段（不可用 → 409）
  const slot = reserveSlot(guide, payload.slotId);

  // 价格全部由服务端计算，前端传入的 price / totalAmount 一律忽略
  const price = calcPrice(serviceItem, travelers, { isFirstOrder: isFirstOrder(userId) });

  const now = new Date();
  const nowIso = now.toISOString();
  const expireAt = new Date(now.getTime() + PAY_EXPIRE_MINUTES * 60000).toISOString();

  const order = {
    id: store.nextId('ord', 'orders'),
    orderNo: buildOrderNo(now),
    userId,
    guideId: guide.id,
    serviceId: serviceItem.id,
    serviceName: serviceItem.name,
    serviceType: serviceItem.serviceType,
    serviceIcon: serviceItem.icon,
    priceUnit: serviceItem.priceUnit || 'hour',
    city: guide.city,

    slotId: slot.slotId,
    date: slot.date,
    timeSlot: slot.timeSlot,
    scheduledAt: `${slot.date}T${String(slot.timeSlot).split('-')[0]}:00+08:00`,
    endAt: addHoursIso(`${slot.date}T${String(slot.timeSlot).split('-')[0]}:00+08:00`,
      serviceItem.durationHours || 1),
    travelers,
    meetingPoint: payload.meetingPoint || '',
    meetingPointNote: '',

    unitPriceAmount: price.unitPriceAmount,
    durationHours: serviceItem.durationHours,
    durationFactor: price.durationFactor,
    peopleFactor: price.peopleFactor,
    subtotalAmount: price.subtotalAmount,
    discountAmount: price.discountAmount,
    discountReason: price.discountReason,
    totalAmount: price.totalAmount,
    extraAmount: 0,
    refundAmount: 0,
    currency: 'CNY',

    remark: payload.remark || '',
    contactName: payload.contactName,
    contactPhone: payload.contactPhone,
    conversationId: payload.conversationId || null,
    idempotencyKey: payload.idempotencyKey || null,

    status: pendingPayment,
    statusText: STATUS_TEXT.pendingPayment,
    cancelReason: null,
    refundReason: null,
    refundReasonCode: null,
    refundStatus: 'none',
    refundFromStatus: null,
    disputeStatus: 'none',
    rating: null,
    comment: '',
    timeline: [
      {
        status: pendingPayment,
        statusText: STATUS_TEXT.pendingPayment,
        at: toCstIso(nowIso), note: '', operator: 'user',
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
    expireAt,
    paidAt: null,
    acceptedAt: null,
    startedAt: null,
    endedAt: null,
    completedAt: null,
    confirmedAt: null,
    cancelledAt: null,
    refundAppliedAt: null,
    refundedAt: null,
  };

  store.insert('orders', order);

  // 回写会话关联订单
  if (payload.conversationId) {
    const conv = store.findById('conversations', payload.conversationId);
    if (conv && conv.userId === userId) {
      store.update('conversations', conv.id, {
        linkedOrderId: order.id,
        linkedOrderStatus: order.status,
      });
    }
  }

  return order;
}

/** 生成用户可见订单号：SX + yyyyMMdd + 4 位序号 */
function buildOrderNo(date) {
  const p = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const seq = String(store.read('orders').length + 1).padStart(4, '0');
  return `SX${d}${seq}`;
}

/**
 * 校验订单归属（越权防护）
 * @param {string} orderId
 * @param {object} user 当前用户
 */
function assertOwnership(orderId, user) {
  const order = store.findById('orders', orderId);
  if (!order) throw notFound('订单不存在');
  if (order.userId !== user.id) {
    throw forbiddenOrder('无权查看该订单', { orderId });
  }
  return order;
}

/**
 * 执行一次状态迁移并落库（同时写时间轴）
 * @param {object} order
 * @param {string} action
 * @param {object} patch 附加字段
 */
function applyTransition(order, action, patch = {}) {
  let nextStatus = assertTransition(order, action);
  const now = new Date().toISOString();

  // 退款驳回：动态恢复到申请退款前的状态
  if (action === 'refund:reject') {
    nextStatus = order.refundFromStatus || pendingConfirm;
  }

  const extra = { ...patch };
  if (action === 'pay') extra.paidAt = now;
  if (action === 'accept') extra.acceptedAt = now;
  if (action === 'start') extra.startedAt = now;
  if (action === 'finish') extra.endedAt = now;
  if (action === 'confirm') { extra.completedAt = now; extra.confirmedAt = now; }
  if (action === 'cancel') extra.cancelledAt = now;
  if (action === 'refund') {
    extra.refundAppliedAt = now;
    extra.refundStatus = 'processing';
    extra.refundFromStatus = order.status;
    extra.refundAmount = order.totalAmount;
  }
  if (action === 'refund:approve') { extra.refundedAt = now; extra.refundStatus = 'success'; }
  if (action === 'refund:reject') extra.refundStatus = 'rejected';

  // 取消/关闭时释放时段（地陪级）
  if (action === 'cancel' || action === 'close') {
    releaseSlot(order.guideId, order.slotId);
  }

  // 时间轴追加一条
  const timeline = Array.isArray(order.timeline) ? order.timeline.slice() : [];
  timeline.push({
    status: nextStatus,
    statusText: STATUS_TEXT[nextStatus] || nextStatus,
    at: toCstIso(now),
    note: patch.note || '',
    operator: patch.operator || 'system',
  });

  return store.update('orders', order.id, {
    ...extra,
    timeline,
    status: nextStatus,
    statusText: STATUS_TEXT[nextStatus] || nextStatus,
  });
}

/**
 * 订单列表（分页 + 状态过滤）
 * @param {string} userId
 * @param {object} opts { status, page, pageSize }
 */
function listOrders(userId, opts = {}) {
  let list = store.read('orders').filter((o) => o.userId === userId);

  if (opts.status && opts.status.length) {
    const set = new Set(opts.status);
    list = list.filter((o) => set.has(o.status));
  }

  list = list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const page = opts.page || 1;
  const pageSize = opts.pageSize || 10;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);

  return {
    list: items.map((o) => toView(o)),
    total: list.length,
    page,
    pageSize,
    hasMore: start + items.length < list.length,
  };
}

/**
 * 各状态数量统计（订单页 Tab 角标）
 * @param {string} userId
 * @returns {object} countByStatus（含 all）
 */
function countByStatus(userId) {
  const all = store.read('orders').filter((o) => o.userId === userId);
  const counts = {
    all: all.length,
    pendingPayment: 0,
    pendingAccept: 0,
    accepted: 0,
    inService: 0,
    pendingConfirm: 0,
    completed: 0,
    cancelled: 0,
    closed: 0,
    refunding: 0,
    refunded: 0,
  };
  for (const o of all) {
    if (o.status in counts) counts[o.status] += 1;
  }
  return counts;
}

/**
 * 「我的」页四格统计（服务端聚合，前端只渲染）
 * ---------------------------------------------------------------------------
 * ⚠️ 四格是**服务端聚合出的展示分桶**，不是订单状态枚举。
 *
 * **硬约束：每笔订单有且仅落入一格**（else-if 链保证），四格之和 ≤ orderCounts.all。
 *   pendingPayment ← pendingPayment          待支付
 *   ongoing        ← accepted + inService    服务中   （不含 pendingConfirm）
 *   pendingConfirm ← pendingConfirm          待确认
 *   refunded       ← refunding + refunded    退款
 *
 * 不纳入四格：pendingAccept / cancelled / closed / completed
 * （不是需要用户处理的待办）。
 * @param {string} userId
 */
function orderStats(userId) {
  const orders = store.read('orders').filter((o) => o.userId === userId);
  const stats = { pendingPayment: 0, ongoing: 0, pendingConfirm: 0, refunded: 0 };

  for (const o of orders) {
    const s = o.status;
    // else-if 链：保证一笔订单只落一格
    if (s === pendingPayment) {
      stats.pendingPayment += 1;
    } else if (s === accepted || s === inService) {
      stats.ongoing += 1;
    } else if (s === pendingConfirm) {
      stats.pendingConfirm += 1;
    } else if (s === refunding || s === refunded) {
      stats.refunded += 1;
    }
    // else: pendingAccept / cancelled / closed / completed → 不纳入四格
  }

  return stats;
}

/**
 * 订单视图整形（对外输出）
 */
function toView(order) {
  if (!order) return null;
  const guide = store.findById('guides', order.guideId);
  const sv = statusView(order.status);

  return {
    // —— 主键 ——
    orderId: order.id,
    orderNo: order.orderNo || order.id,
    userId: order.userId,
    guideId: order.guideId,
    serviceId: order.serviceId,
    serviceName: order.serviceName,
    serviceType: order.serviceType,
    serviceIcon: order.serviceIcon,
    city: order.city,

    // —— 状态（服务端下发，前端只渲染不算）——
    status: sv.status,
    statusText: sv.statusText,
    statusBadge: sv.statusBadge,
    statusTone: sv.statusTone,
    canUserPay: sv.canUserPay,
    canUserCancel: sv.canUserCancel,
    canUserConfirm: sv.canUserConfirm,
    canUserRefund: sv.canUserRefund,
    canUserContact: sv.canUserContact,
    canUserReview: sv.canUserReview,
    allowedActions: allowedUserActions(order.status),

    // —— 地陪 ——
    guideName: guide ? guide.name : '未知地陪',
    guideAvatarUrl: guide ? guide.avatar : '',
    guideTitle: guide ? guide.title : '',
    guideCity: guide ? guide.city : '',

    // —— 时间 ——
    date: order.date,
    timeSlot: order.timeSlot,
    slotId: order.slotId,
    scheduledAt: order.scheduledAt,
    endAt: order.endAt,
    durationHours: order.durationHours,
    expireAt: toCstIso(order.expireAt),
    serverTime: nowCst(),
    createdAt: toCstIso(order.createdAt),
    updatedAt: toCstIso(order.updatedAt),
    paidAt: order.paidAt ? toCstIso(order.paidAt) : null,
    acceptedAt: order.acceptedAt ? toCstIso(order.acceptedAt) : null,
    startedAt: order.startedAt ? toCstIso(order.startedAt) : null,
    endedAt: order.endedAt ? toCstIso(order.endedAt) : null,
    completedAt: order.completedAt ? toCstIso(order.completedAt) : null,
    confirmedAt: order.confirmedAt ? toCstIso(order.confirmedAt) : null,
    cancelledAt: order.cancelledAt ? toCstIso(order.cancelledAt) : null,
    refundAppliedAt: order.refundAppliedAt ? toCstIso(order.refundAppliedAt) : null,
    refundedAt: order.refundedAt ? toCstIso(order.refundedAt) : null,

    // —— 人数与地点 ——
    travelers: order.travelers,
    meetingPoint: order.meetingPoint || '',
    meetingPointNote: '',

    // —— 金额（全部整数分）——
    unitPriceAmount: order.unitPriceAmount,
    subtotalAmount: order.subtotalAmount,
    discountAmount: order.discountAmount,
    discountReason: order.discountReason || '',
    totalAmount: order.totalAmount,
    extraAmount: order.extraAmount || 0,
    refundAmount: order.refundAmount || 0,
    currency: 'CNY',
    priceUnit: order.priceUnit || 'hour',
    priceUnitText: UNIT_TEXT[order.priceUnit] || '次',

    // —— 备注与原因 ——
    remark: order.remark || '',
    cancelReason: order.cancelReason || null,
    refundReason: order.refundReason || null,
    refundReasonCode: order.refundReasonCode || null,
    refundStatus: order.refundStatus || 'none',
    refundFromStatus: order.refundFromStatus || null,
    disputeStatus: order.disputeStatus || 'none',

    // —— 关联与幂等 ——
    conversationId: order.conversationId || null,
    idempotencyKey: order.idempotencyKey || null,

    // —— 评价与时间轴 ——
    rating: order.rating,
    comment: order.comment || '',
    reviewed: !!order.rating,
    timeline: (order.timeline || []).map((t) => ({
      status: t.status,
      statusText: t.statusText,
      at: toCstIso(t.at),
      note: t.note || '',
      operator: t.operator || 'system',
    })),
  };
}

module.exports = {
  PAY_EXPIRE_MINUTES,
  calcPrice,
  isFirstOrder,
  findByIdempotencyKey,
  reserveSlot,
  releaseSlot,
  collectGuideSlots,
  createOrder,
  assertOwnership,
  applyTransition,
  listOrders,
  countByStatus,
  orderStats,
  toView,
  ACTION_TEXT,
  UNIT_ENUM,
};
