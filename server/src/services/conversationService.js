'use strict';

/**
 * 会话与消息业务逻辑
 * ---------------------------------------------------------------------------
 * 约定：
 *   - 用户与地陪之间唯一会话（幂等创建）
 *   - 消息按 sentAt 升序返回；分页按「倒序取回、正序展示」
 *   - 每条消息带会话内单调递增 seq，用于断线补拉与定位
 *   - 输出字段以 UX 规范 camelCase 为主，附 snake_case 别名
 */

const store = require('../db/store');
const { MESSAGE_TYPE } = require('../models');
const { toCstIso } = require('../utils/money');
const { notFound, forbiddenConversation, unprocessable } = require('../utils/errors');

/** 消息类型 → UX 规范 messageType */
const MESSAGE_TYPE_ENUM = {
  text: 'text',
  image: 'image',
  order: 'orderCard',
  orderCard: 'orderCard',
  system: 'system',
};

/** 发送方类型 */
const SENDER_TYPE = {
  user: 'user',
  guide: 'guide',
  system: 'system',
};

/**
 * 获取（或创建）用户与地陪的会话（幂等）
 * @param {string} userId
 * @param {string} guideId
 */
function ensureConversation(userId, guideId) {
  const existing = store.read('conversations').find(
    (c) => c.userId === userId && c.guideId === guideId && !c.closed
  );
  if (existing) return existing;

  const guide = store.findById('guides', guideId);
  if (!guide) throw notFound('地陪不存在');

  const now = new Date().toISOString();
  const conv = {
    id: store.nextId('conv', 'conversations'),
    userId,
    guideId,
    lastMessage: '',
    lastMessageId: '',
    lastMessageType: 'system',
    lastTime: now,
    unreadCount: 0,
    firstUnreadSeq: null,
    seq: 0,
    closed: false,
    closedReason: '',
    linkedOrderId: null,
    linkedOrderStatus: null,
    createdAt: now,
    updatedAt: now,
  };
  store.insert('conversations', conv);

  // 附一条系统欢迎语，让聊天页不空
  const welcome = {
    id: store.nextId('msg', 'messages'),
    conversationId: conv.id,
    seq: 1,
    from: 'system',
    fromUserId: 'system',
    to: userId,
    type: MESSAGE_TYPE.SYSTEM,
    messageType: 'system',
    content: `你好，我是${guide.name}。想了解哪段路线？`,
    imageUrl: null,
    orderSummary: null,
    extra: null,
    clientMessageId: null,
    isRead: true,
    createdAt: now,
  };
  store.insert('messages', welcome);
  conv.lastMessage = welcome.content;
  conv.lastMessageId = welcome.id;
  conv.lastMessageType = 'system';
  conv.lastTime = welcome.createdAt;
  conv.seq = 1;
  store.markDirty('conversations');

  return conv;
}

/**
 * 会话列表（含未读数、最后一条消息摘要、对方地陪信息）
 * @param {string} userId
 */
function listConversations(userId) {
  return store.read('conversations')
    .filter((c) => c.userId === userId)
    .slice()
    .sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1))
    .map((c) => toView(c, userId));
}

/**
 * 会话视图
 */
function toView(conv, userId) {
  const guide = store.findById('guides', conv.guideId);
  const lastMessageAt = toCstIso(conv.lastTime);
  return {
    conversationId: conv.id,
    userId: conv.userId,
    peerType: 'guide',
    guideId: conv.guideId,
    guideName: guide ? guide.name : '未知地陪',
    guideAvatarUrl: guide ? guide.avatar : '',
    guideTitle: guide ? guide.title : '',
    guideCity: guide ? guide.city : '',
    lastMessageId: conv.lastMessageId || null,
    lastMessageContent: conv.lastMessage || '',
    lastMessageType: conv.lastMessageType || 'text',
    lastMessageAt,
    lastTime: lastMessageAt,
    unreadCount: conv.unreadCount || 0,
    firstUnreadSeq: conv.firstUnreadSeq || null,
    isActive: !conv.closed,
    closed: !!conv.closed,
    closedReason: conv.closedReason || null,
    linkedOrderId: conv.linkedOrderId || null,
    linkedOrderStatus: conv.linkedOrderStatus || null,
    createdAt: toCstIso(conv.createdAt),
  };
}

/**
 * 校验会话归属（越权防护）
 * @param {string} conversationId
 * @param {object} user
 */
function assertOwnership(conversationId, user) {
  const conv = store.findById('conversations', conversationId);
  if (!conv) throw notFound('会话不存在');
  if (conv.userId !== user.id) throw forbiddenConversation('无权查看该会话', { conversationId });
  return conv;
}

/**
 * 消息历史（分页）
 * ---------------------------------------------------------------------------
 * 按时间倒序取回一页，再翻转为正序返回，保证前端直接渲染。
 * @param {string} conversationId
 * @param {object} opts { page, pageSize, since }
 */
function listMessages(conversationId, opts = {}) {
  const all = store.read('messages')
    .filter((m) => m.conversationId === conversationId)
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));

  // 断线补拉：只返回 seq 大于 since 的消息
  let items = all;
  if (opts.since !== undefined && opts.since !== null) {
    items = all.filter((m) => (m.seq || 0) > opts.since);
  }

  const page = opts.page || 1;
  const pageSize = opts.pageSize || 20;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 约定：page=1 表示最新的一页
  const reversePage = totalPages - page + 1;
  const start = (reversePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    list: pageItems.map((m) => toMessageView(m)),
    total,
    page,
    pageSize,
    hasMore: page < totalPages,
    lastSeq: items.length ? items[items.length - 1].seq || 0 : 0,
  };
}

/**
 * 消息视图
 */
function toMessageView(m) {
  const messageType = m.messageType || MESSAGE_TYPE_ENUM[m.type] || 'text';
  return {
    messageId: m.id,
    conversationId: m.conversationId,
    seq: m.seq || 0,
    clientMessageId: m.clientMessageId || null,
    senderType: m.senderType || SENDER_TYPE[m.from] || (m.from === 'system' ? 'system' : 'user'),
    messageType,
    content: m.content,
    imageUrl: m.imageUrl || null,
    orderSummary: m.orderSummary || null,
    sentAt: toCstIso(m.createdAt),
    isRead: m.isRead !== false,
    status: 'sent',
  };
}

/**
 * 写入一条消息并更新会话摘要
 * @param {object} conv 会话
 * @param {object} payload { from, to, content, type, clientMessageId }
 */
function createMessage(conv, payload) {
  if (!payload.content || !String(payload.content).trim()) {
    throw unprocessable('消息内容不能为空');
  }
  if (String(payload.content).length > 1000) {
    throw unprocessable('消息内容不能超过 1000 字');
  }

  const now = new Date().toISOString();
  const seq = (conv.seq || 0) + 1;
  const msg = {
    id: store.nextId('msg', 'messages'),
    conversationId: conv.id,
    seq,
    from: payload.from,
    fromUserId: payload.from,
    to: payload.to,
    type: payload.type || MESSAGE_TYPE.TEXT,
    messageType: payload.messageType || MESSAGE_TYPE_ENUM[payload.type] || 'text',
    content: String(payload.content).trim(),
    imageUrl: payload.imageUrl || null,
    orderSummary: payload.orderSummary || null,
    extra: payload.extra || null,
    clientMessageId: payload.clientMessageId || null,
    isRead: true,
    createdAt: now,
  };
  store.insert('messages', msg);

  const fromUser = payload.from === conv.userId;
  const unread = fromUser ? 0 : (conv.unreadCount || 0) + 1;
  store.update('conversations', conv.id, {
    lastMessage: msg.content,
    lastMessageId: msg.id,
    lastMessageType: msg.messageType,
    lastTime: msg.createdAt,
    unreadCount: unread,
    seq,
    firstUnreadSeq: fromUser ? conv.firstUnreadSeq : seq,
  });

  return msg;
}

/**
 * 标记会话已读
 * @param {string} conversationId
 */
function markRead(conversationId) {
  const list = store.read('messages');
  for (const m of list) {
    if (m.conversationId === conversationId) m.isRead = true;
  }
  store.markDirty('messages');
  return store.update('conversations', conversationId, {
    unreadCount: 0,
    firstUnreadSeq: null,
  });
}

/**
 * 会话未读总数（TabBar 角标）
 * @param {string} userId
 */
function unreadCount(userId) {
  return store.read('conversations')
    .filter((c) => c.userId === userId)
    .reduce((s, c) => s + (c.unreadCount || 0), 0);
}

/**
 * 消息页聚合：系统通知 + 聊天会话，统一列表返回，用 type 区分
 * @param {string} userId
 * @param {object} opts { page, pageSize, type }
 */
function aggregateMessages(userId, opts = {}) {
  const convs = listConversations(userId).map((c) => ({
    type: 'conversation',
    peerType: 'conversation',
    id: c.id,
    conversationId: c.id,
    title: c.guideName,
    avatarUrl: c.guideAvatarUrl,
    subtitle: c.guideTitle,
    content: c.lastMessageContent,
    lastMessageContent: c.lastMessageContent,
    lastMessageType: c.lastMessageType,
    time: c.lastMessageAt,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    refId: c.id,
    linkedOrderId: c.linkedOrderId,
    linkedOrderStatus: c.linkedOrderStatus,
    isActive: c.isActive,
  }));

  const notices = store.read('notifications')
    .filter((n) => n.userId === userId)
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))
    .map((n) => ({
      type: 'notice',
      peerType: 'system',
      id: n.id,
      notificationId: n.id,
      title: n.title,
      avatarUrl: '',
      subtitle: n.type === 'system' ? '系统通知' : '订单通知',
      category: n.type,
      content: n.content,
      time: toCstIso(n.createdAt),
      createdAt: toCstIso(n.createdAt),
      unreadCount: n.read ? 0 : 1,
      isRead: !!n.read,
      refId: n.extra && n.extra.orderId ? n.extra.orderId : n.id,
      refType: n.extra && n.extra.orderId ? 'order' : 'none',
      actionLabel: n.extra && n.extra.orderId ? '查看订单' : null,
      extra: n.extra || null,
    }));

  let merged = convs.concat(notices);
  if (opts.type && opts.type !== 'all') {
    merged = merged.filter((m) => m.type === opts.type);
  }
  merged.sort((a, b) => (a.time > b.time ? 1 : -1));

  const page = opts.page || 1;
  const pageSize = opts.pageSize || 20;
  const start = (page - 1) * pageSize;
  const items = merged.slice(start, start + pageSize);

  const noticeUnread = notices.filter((n) => n.unreadCount > 0).length;

  return {
    list: items,
    total: merged.length,
    page,
    pageSize,
    hasMore: start + items.length < merged.length,
    unreadTotal: convs.reduce((s, c) => s + (c.unreadCount || 0), 0) + noticeUnread,
    conversationUnread: convs.reduce((s, c) => s + (c.unreadCount || 0), 0),
    notificationUnread: noticeUnread,
  };
}

module.exports = {
  ensureConversation,
  listConversations,
  toView,
  assertOwnership,
  listMessages,
  createMessage,
  markRead,
  unreadCount,
  aggregateMessages,
  toMessageView,
  MESSAGE_TYPE_ENUM,
};
