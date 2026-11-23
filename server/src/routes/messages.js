'use strict';

/**
 * 路由：消息页聚合 + 系统通知
 * ---------------------------------------------------------------------------
 * GET  /api/messages        消息页聚合（系统通知 + 聊天会话统一列表）
 * GET  /api/notices         系统通知列表
 * POST /api/notices/read    标记通知已读
 */

const express = require('express');
const conversationService = require('../services/conversationService');
const notificationService = require('../services/notificationService');
const { ok } = require('../utils/response');
const { validateQuery, validateBody, validatePage } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/messages
 * Query: type（all|conversation|notice，默认 all） / page / pageSize
 */
router.get('/', validateQuery({
  type: { type: 'enum', values: ['all', 'conversation', 'notice'], default: 'all' },
}), validatePage(), (req, res, next) => {
  try {
    const data = conversationService.aggregateMessages(req.user.id, {
      type: req.valid.type,
      page: req.valid.page,
      pageSize: req.valid.pageSize,
    });
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
