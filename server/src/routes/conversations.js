'use strict';

/**
 * 路由：会话与消息
 * ---------------------------------------------------------------------------
 * GET  /api/conversations                 会话列表
 * POST /api/conversations                 创建或获取会话（幂等）
 * GET  /api/conversations/unread-count    会话未读总数
 * GET  /api/conversations/:id             会话详情
 * GET  /api/conversations/:id/messages    消息历史（分页，支持 since 补拉）
 * POST /api/conversations/:id/messages    发送消息（HTTP 通道，WS 不可用时的兜底）
 * POST /api/conversations/:id/read       标记会话已读
 */

const express = require('express');
const store = require('../db/store');
const conversationService = require('../services/conversationService');
const bus = require('../services/eventBus');
const { EVENTS } = bus;
const { ok, paginate } = require('../utils/response');
const { validateQuery, validateBody, validatePage } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/conversations
 * Query: page / pageSize
 */
router.get('/', validatePage(), (req, res, next) => {
  try {
    const all = conversationService.listConversations(req.user.id);
    const { page, pageSize } = req.valid;
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    const data = paginate(items, all.length, page, pageSize);
    data.unreadTotal = all.reduce((s, c) => s + (c.unreadCount || 0), 0);
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversations/unread-count
 * → data.total
 */
router.get('/unread-count', (req, res, next) => {
  try {
    const total = conversationService.unreadCount(req.user.id);
    res.json(ok({ total, unreadCount: total }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations
 * Body: { guideId }
 * 幂等：已存在则返回原会话
 */
router.post('/', validateBody({
  guideId: { type: 'string', required: true, maxLength: 64, trim: true },
}), (req, res, next) => {
  try {
    const conv = conversationService.ensureConversation(req.user.id, req.body.guideId);
    const guide = store.findById('guides', conv.guideId);
    const view = conversationService.toView(conv, req.user.id);
    res.json(ok({
      ...view,
      guide: guide
        ? {
          guideId: guide.id,
          name: guide.name,
          avatarUrl: guide.avatar,
          title: guide.title,
        }
        : null,
    }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversations/:id
 * 会话详情（聊天页导航栏 + 关联订单）
 */
router.get('/:id', (req, res, next) => {
  try {
    const conv = conversationService.assertOwnership(req.params.id, req.user);
    const view = conversationService.toView(conv, req.user.id);
    const guide = store.findById('guides', conv.guideId);
    res.json(ok({
      ...view,
      guide: guide
        ? {
          guideId: guide.id,
          name: guide.name,
          avatarUrl: guide.avatar,
          title: guide.title,
          city: guide.city,
          rating: guide.rating,
        }
        : null,
    }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/conversations/:id/messages
 * Query: page（1 = 最新一页） / pageSize / since（断线补拉，返回 seq > since）
 */
router.get('/:id/messages', validateQuery({
  since: { type: 'int', min: 0 },
}), validatePage(), (req, res, next) => {
  try {
    const conv = conversationService.assertOwnership(req.params.id, req.user);
    const result = conversationService.listMessages(conv.id, req.valid);
    res.json(ok(result, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/messages
 * Body: { content, type?, clientMessageId? }
 * 作为 WebSocket 的 HTTP 兜底通道，返回落库后的消息。
 */
router.post('/:id/messages', validateBody({
  content: { type: 'string', required: true, maxLength: 1000, trim: true },
  messageType: { type: 'enum', values: ['text', 'image', 'orderCard', 'system'], default: 'text' },
  clientMessageId: { type: 'string', maxLength: 64, trim: true },
}), (req, res, next) => {
  try {
    const conv = conversationService.assertOwnership(req.params.id, req.user);
    const guide = store.findById('guides', conv.guideId);
    const msg = conversationService.createMessage(conv, {
      from: req.user.id,
      to: guide ? `guide_${conv.guideId}` : conv.guideId,
      content: req.body.content,
      type: req.body.messageType,
      clientMessageId: req.body.clientMessageId,
    });
    const view = conversationService.toMessageView(msg);

    bus.emit(EVENTS.NEW_MESSAGE, {
      conversationId: conv.id,
      userId: conv.userId,
      guideId: conv.guideId,
      message: view,
    });

    res.json(ok(view, res.locals.requestId, '发送成功'));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/conversations/:id/read
 */
router.post('/:id/read', (req, res, next) => {
  try {
    const conv = conversationService.assertOwnership(req.params.id, req.user);
    conversationService.markRead(conv.id);
    bus.emit(EVENTS.CONVERSATION_READ, {
      userId: req.user.id,
      conversationId: conv.id,
      unreadCount: 0,
    });
    res.json(ok({ conversationId: conv.id, unreadCount: 0 }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
