'use strict';

/**
 * 路由：订单
 * ---------------------------------------------------------------------------
 * GET  /api/v1/orders                订单列表（status 逗号分隔多值）
 * GET  /api/v1/orders/summary        各状态数量（Tab 角标）
 * GET  /api/v1/orders/:orderId       订单详情
 * POST /api/v1/orders                创建订单（服务端算价 + 幂等）
 * POST /api/v1/orders/:orderId/cancel 取消
 * POST /api/v1/orders/:orderId/pay    模拟支付
 * POST /api/v1/orders/:orderId/confirm 确认完成
 * POST /api/v1/orders/:orderId/refund  申请退款
 * POST /api/v1/orders/:orderId/review  评价
 *
 * 地陪侧动作（演示完整状态流转用；生产由地陪端或后台调用）：
 * POST /api/v1/orders/:orderId/accept            接单
 * POST /api/v1/orders/:orderId/start             开始服务
 * POST /api/v1/orders/:orderId/finish            结束服务
 * POST /api/v1/orders/:orderId/close             拒单 / 关闭
 * POST /api/v1/orders/:orderId/refund/approve    同意退款
 * POST /api/v1/orders/:orderId/refund/reject     驳回退款
 */

const express = require('express');
const store = require('../db/store');
const orderService = require('../services/orderService');
const notificationService = require('../services/notificationService');
const bus = require('../services/eventBus');
const { EVENTS } = bus;
const { ok } = require('../utils/response');
const { validateQuery, validateBody, validatePage } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { ALL_STATUSES, STATUS_TEXT, completed, refunding } = require('../models/statusMap');
const {
  notFound, forbiddenOrder, unprocessable, conflictOrderStatus, conflict,
} = require('../utils/errors');

const router = express.Router();

router.use(requireAuth);

/**
 * 广播订单状态变更 + 生成用户侧通知
 */
function notifyOrderChange(order, extraText) {
  const view = orderService.toView(order);
  bus.emit(EVENTS.ORDER_STATUS, {
    userId: order.userId,
    guideId: order.guideId,
    order: view,
  });
  notificationService.push(order.userId, {
    type: order.status === refunding ? 'refund' : 'order',
    title: `订单${view.statusText}`,
    content: extraText
      || `${order.serviceName} · ${order.date} ${order.timeSlot}，订单状态更新为「${view.statusText}」`,
    extra: { orderId: order.id, status: view.status },
  });
  return view;
}

/**
 * GET /api/v1/orders
 * Query: status（逗号分隔多状态，camelCase）/ page / pageSize
 */
router.get('/', validateQuery({
  status: { type: 'string', maxLength: 200, trim: true },
}), validatePage(), (req, res, next) => {
  try {
    let statuses = [];
    if (req.valid.status) {
      statuses = req.valid.status.split(',').map((s) => s.trim()).filter(Boolean);
      for (const s of statuses) {
        if (!ALL_STATUSES.includes(s)) {
          throw unprocessable(`订单状态只能是：${ALL_STATUSES.join(' / ')}`);
        }
      }
    }
    const data = orderService.listOrders(req.user.id, {
      status: statuses,
      page: req.valid.page,
      pageSize: req.valid.pageSize,
    });
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/orders/summary
 * → data.countByStatus（订单页 Tab 角标）
 */
router.get('/summary', (req, res, next) => {
  try {
    const counts = orderService.countByStatus(req.user.id);
    res.json(ok({ countByStatus: counts }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/orders/:orderId
 */
router.get('/:orderId', (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    res.json(ok(orderService.toView(order), res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/orders
 * Body: guideId, serviceId, slotId, travelers, contactName, contactPhone,
 *       meetingPoint, remark?, conversationId?, idempotencyKey
 * 说明：前端传入的任何价格字段一律被忽略，服务端按服务项单价重算。
 */
router.post('/', validateBody({
  guideId: { type: 'string', required: true, maxLength: 64, trim: true },
  serviceId: { type: 'string', required: true, maxLength: 64, trim: true },
  slotId: { type: 'string', required: true, maxLength: 64, trim: true },
  travelers: { type: 'int', min: 1, max: 50 },
  contactName: { type: 'string', required: true, maxLength: 20, trim: true },
  contactPhone: { type: 'string', required: true, maxLength: 20, trim: true, pattern: /^[\d+\-\s]{6,20}$/ },
  meetingPoint: { type: 'string', maxLength: 50, trim: true, default: '' },
  remark: { type: 'string', maxLength: 200, trim: true, default: '' },
  conversationId: { type: 'string', maxLength: 64, trim: true },
  idempotencyKey: { type: 'string', maxLength: 64, trim: true },
}), (req, res, next) => {
  try {
    const order = orderService.createOrder(req.user.id, req.body);
    const view = notifyOrderChange(order, '订单已创建，请在 15 分钟内完成支付');
    res.json(ok(view, res.locals.requestId, '订单已创建'));
  } catch (err) {
    next(err);
  }
});

/** POST /api/v1/orders/:orderId/pay  模拟支付 */
router.post('/:orderId/pay', (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    const updated = orderService.applyTransition(order, 'pay');
    const view = notifyOrderChange(updated, '支付成功，等待地陪接单');
    res.json(ok(view, res.locals.requestId, '支付成功'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/orders/:orderId/cancel
 * Body: { reason?, reasonCode? }
 */
router.post('/:orderId/cancel', validateBody({
  reason: { type: 'string', maxLength: 100, trim: true, default: '' },
  reasonCode: { type: 'string', maxLength: 40, trim: true, default: '' },
}), (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    const updated = orderService.applyTransition(order, 'cancel', {
      cancelReason: req.body.reason || '用户主动取消',
      note: req.body.reason || '用户主动取消',
      operator: 'user',
    });
    const view = notifyOrderChange(updated, `订单已取消：${req.body.reason || '用户主动取消'}`);
    res.json(ok(view, res.locals.requestId, '已取消订单'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/orders/:orderId/confirm  用户确认完成
 */
router.post('/:orderId/confirm', (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    const updated = orderService.applyTransition(order, 'confirm', {
      note: '用户确认完成', operator: 'user',
    });
    const view = notifyOrderChange(updated, '感谢你的确认，欢迎给地陪写个评价');
    res.json(ok(view, res.locals.requestId, '已确认完成'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/orders/:orderId/refund  申请退款
 * Body: { reason, reasonCode? }
 */
router.post('/:orderId/refund', validateBody({
  reason: { type: 'string', required: true, maxLength: 200, trim: true },
  reasonCode: { type: 'string', maxLength: 40, trim: true, default: '' },
}), (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    const updated = orderService.applyTransition(order, 'refund', {
      refundReason: req.body.reason,
      refundReasonCode: req.body.reasonCode,
      note: req.body.reason, operator: 'user',
    });
    const view = notifyOrderChange(updated, `已提交退款申请：${req.body.reason}`);
    res.json(ok(view, res.locals.requestId, '退款申请已提交，1–3 个工作日原路退回'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/orders/:orderId/review  评价
 * Body: { rating, comment }
 */
router.post('/:orderId/review', validateBody({
  rating: { type: 'int', required: true, min: 1, max: 5 },
  comment: { type: 'string', required: true, maxLength: 300, trim: true },
}), (req, res, next) => {
  try {
    const order = orderService.assertOwnership(req.params.orderId, req.user);
    if (order.status !== completed) {
      throw conflictOrderStatus(`只有「${STATUS_TEXT.completed}」的订单可以评价`, {
        currentStatus: order.status,
        currentStatusText: STATUS_TEXT[order.status],
        action: 'review',
      });
    }
    if (store.findOne('reviews', (r) => r.orderId === order.id)) {
      throw conflict('该订单已评价，不可重复评价', { orderId: order.id });
    }

    const user = store.findById('users', req.user.id);
    const now = new Date().toISOString();
    const review = {
      id: store.nextId('rev', 'reviews'),
      orderId: order.id,
      guideId: order.guideId,
      userId: req.user.id,
      userName: user ? user.nickname : '匿名用户',
      userAvatar: user ? user.avatar : '',
      rating: req.body.rating,
      content: req.body.comment,
      tags: [],
      images: [],
      serviceName: order.serviceName,
      createdAt: now,
    };
    store.insert('reviews', review);

    // 评价不改变订单状态，直接回写评分
    const updated = store.update('orders', order.id, {
      rating: req.body.rating,
      comment: req.body.comment,
      reviewedAt: now,
    });

    // 更新地陪聚合评分
    const guide = store.findById('guides', order.guideId);
    if (guide) {
      const allReviews = store.read('reviews').filter((r) => r.guideId === guide.id);
      const avg = allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length;
      store.update('guides', guide.id, {
        rating: Math.round(avg * 10) / 10,
        ratingCount: (guide.ratingCount || 0) + 1,
      });
    }

    const view = orderService.toView(updated);
    bus.emit(EVENTS.ORDER_STATUS, {
      userId: order.userId,
      guideId: order.guideId,
      order: view,
    });

    res.json(ok({
      ...view,
      review: {
        reviewId: review.id,
        orderId: review.orderId,
        guideId: review.guideId,
        userNickname: review.userName,
        rating: review.rating,
        content: review.content,
        createdAt: review.createdAt,
      },
    }, res.locals.requestId, '评价成功'));
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------------------
 * 地陪侧动作
 * ------------------------------------------------------------------------ */

/** 校验当前登录者是该订单对应的地陪 */
function assertGuideOwnsOrder(req, order) {
  if (req.user.role !== 'guide' || !req.user.guideId) {
    throw forbiddenOrder('仅地陪本人可执行该操作', { orderId: order.id });
  }
  if (req.user.guideId !== order.guideId) {
    throw forbiddenOrder('无权操作该订单', { orderId: order.id });
  }
  return order;
}

/** POST /api/v1/orders/:orderId/accept  地陪接单 */
router.post('/:orderId/accept', (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'accept', {
      note: '地陪已接单', operator: 'guide',
    });
    const view = notifyOrderChange(updated);
    return res.json(ok(view, res.locals.requestId, '已接单'));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/v1/orders/:orderId/start  地陪开始服务 */
router.post('/:orderId/start', (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'start', {
      note: '服务已开始', operator: 'guide',
    });
    const view = notifyOrderChange(updated);
    return res.json(ok(view, res.locals.requestId, '服务已开始'));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/v1/orders/:orderId/finish  地陪标记服务结束 → 待用户确认 */
router.post('/:orderId/finish', (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'finish', {
      note: '服务已结束，等待用户确认', operator: 'guide',
    });
    const view = notifyOrderChange(updated);
    return res.json(ok(view, res.locals.requestId, '服务已结束，等待用户确认'));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/v1/orders/:orderId/close  地陪拒单 / 系统关闭 */
router.post('/:orderId/close', validateBody({
  reason: { type: 'string', maxLength: 100, trim: true, default: '地陪未能接单，订单已关闭' },
}), (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'close', {
      cancelReason: req.body.reason,
      note: req.body.reason, operator: 'guide',
    });
    const view = notifyOrderChange(updated, req.body.reason);
    return res.json(ok(view, res.locals.requestId, '订单已关闭'));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/v1/orders/:orderId/refund/approve  地陪同意退款 */
router.post('/:orderId/refund/approve', (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'refund:approve', {
      note: '退款申请已通过', operator: 'guide',
    });
    const view = notifyOrderChange(updated, '退款申请已通过，款项将原路退回');
    return res.json(ok(view, res.locals.requestId, '已同意退款'));
  } catch (err) {
    return next(err);
  }
});

/** POST /api/v1/orders/:orderId/refund/reject  地陪驳回退款（回到 refundFromStatus） */
router.post('/:orderId/refund/reject', validateBody({
  reason: { type: 'string', maxLength: 100, trim: true, default: '' },
}), (req, res, next) => {
  try {
    const order = store.findById('orders', req.params.orderId);
    if (!order) return next(notFound('订单不存在'));
    assertGuideOwnsOrder(req, order);
    const updated = orderService.applyTransition(order, 'refund:reject', {
      note: req.body.reason || '退款申请被驳回', operator: 'guide',
    });
    const view = notifyOrderChange(updated, '退款申请未通过');
    return res.json(ok(view, res.locals.requestId, '退款申请未通过'));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
