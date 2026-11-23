'use strict';

/**
 * 系统通知业务逻辑
 */

const store = require('../db/store');
const { NOTIFICATION_TYPE } = require('../models');
const { toCstIso } = require('../utils/money');

/**
 * 列表
 * @param {string} userId
 * @param {object} opts { page, pageSize, unreadOnly, category }
 */
function listNotices(userId, opts = {}) {
  let list = store.read('notifications').filter((n) => n.userId === userId);
  if (opts.unreadOnly) list = list.filter((n) => !n.read);
  if (opts.category && opts.category !== 'all') {
    list = list.filter((n) => n.type === opts.category);
  }
  list = list.slice().sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));

  const page = opts.page || 1;
  const pageSize = opts.pageSize || 20;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);

  return {
    list: items.map(toView),
    total: list.length,
    page,
    pageSize,
    hasMore: start + items.length < list.length,
    unreadCount: list.filter((n) => !n.read).length,
  };
}

/**
 * 视图
 */
function toView(n) {
  const isOrder = n.type === NOTIFICATION_TYPE.ORDER || n.type === NOTIFICATION_TYPE.REFUND;
  const refId = n.extra && n.extra.orderId ? n.extra.orderId : n.id;
  return {
    notificationId: n.id,
    category: n.type,
    title: n.title,
    content: n.content,
    isRead: !!n.read,
    refType: isOrder && n.extra && n.extra.orderId ? 'order' : 'none',
    refId,
    actionLabel: isOrder && n.extra && n.extra.orderId ? '查看订单' : null,
    extra: n.extra || null,
    createdAt: toCstIso(n.createdAt),
  };
}

/**
 * 标记已读
 * @param {string} userId
 * @param {object} payload { ids?: string[], all?: boolean }
 * @returns {number} 更新条数
 */
function markRead(userId, payload = {}) {
  const all = store.read('notifications').filter((n) => n.userId === userId && !n.read);
  const targets = payload.all
    ? all
    : all.filter((n) => (payload.ids || []).includes(n.id));

  const now = new Date().toISOString();
  for (const n of targets) {
    n.read = true;
    n.readAt = now;
  }
  if (targets.length) store.markDirty('notifications');
  return targets.length;
}

/**
 * 推送一条通知（内部使用）
 */
function push(userId, payload) {
  const now = new Date().toISOString();
  const notice = {
    id: store.nextId('ntf', 'notifications'),
    userId,
    type: payload.type || NOTIFICATION_TYPE.SYSTEM,
    title: payload.title,
    content: payload.content,
    read: false,
    extra: payload.extra || null,
    createdAt: now,
  };
  store.insert('notifications', notice);
  return notice;
}

module.exports = { listNotices, toView, markRead, push };
