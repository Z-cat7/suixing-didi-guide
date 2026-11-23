'use strict';

/**
 * 路由：系统通知
 * ---------------------------------------------------------------------------
 * GET  /api/notices       通知列表（别名 /api/notifications）
 * POST /api/notices/read  标记已读（支持 ids 精确标记或 all 全部标记）
 */

const express = require('express');
const notificationService = require('../services/notificationService');
const { ok } = require('../utils/response');
const { validateQuery, validateBody, validatePage } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/notices
 * Query: unreadOnly(boolean) / category(order|refund|system|promotion) / page / pageSize
 */
router.get('/', validateQuery({
  unreadOnly: { type: 'boolean', default: false },
  category: { type: 'enum', values: ['order', 'refund', 'system', 'promotion', 'all'] },
}), validatePage(), (req, res, next) => {
  try {
    const data = notificationService.listNotices(req.user.id, {
      unreadOnly: req.valid.unreadOnly,
      category: req.valid.category,
      page: req.valid.page,
      pageSize: req.valid.pageSize,
    });
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notices/read
 * Body: { ids?: string[], all?: boolean }
 */
router.post('/read', validateBody({
  ids: { type: 'array', maxItems: 200 },
  all: { type: 'boolean', default: false },
}), (req, res, next) => {
  try {
    const updated = notificationService.markRead(req.user.id, {
      ids: req.body.ids,
      all: req.body.all,
    });
    res.json(ok({ updated }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
