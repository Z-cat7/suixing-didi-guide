'use strict';

/**
 * 路由：「我」
 * ---------------------------------------------------------------------------
 * GET    /api/v1/me                    个人资料（含 orderStats 四格统计）
 * PUT    /api/v1/me                    更新资料
 * GET    /api/v1/me/settings           设置项
 * PUT    /api/v1/me/settings           更新设置项
 * GET    /api/v1/me/orders             我的订单（分状态）
 * GET    /api/v1/me/favorites          我的收藏
 * PUT    /api/v1/me/favorites/:guideId 收藏 toggle（幂等切换）
 */

const express = require('express');
const userService = require('../services/userService');
const orderService = require('../services/orderService');
const { ok } = require('../utils/response');
const { validateQuery, validateBody, validatePage } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { userEditableFields, settingsFields } = require('../models');

const router = express.Router();

router.use(requireAuth);

/** GET /api/v1/me */
router.get('/', (req, res, next) => {
  try {
    res.json(ok(userService.getProfile(req.user.id), res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/** PUT /api/v1/me */
router.put('/', validateBody(userEditableFields), (req, res, next) => {
  try {
    res.json(ok(userService.updateProfile(req.user.id, req.body), res.locals.requestId, '已保存'));
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/me/settings */
router.get('/settings', (req, res, next) => {
  try {
    res.json(ok(userService.getSettings(req.user.id), res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/** PUT /api/v1/me/settings */
router.put('/settings', validateBody(settingsFields), (req, res, next) => {
  try {
    res.json(ok(userService.updateSettings(req.user.id, req.body), res.locals.requestId, '已保存'));
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/me/orders */
router.get('/orders', validateQuery({
  status: { type: 'string', maxLength: 200, trim: true },
}), validatePage(), (req, res, next) => {
  try {
    let statuses = [];
    if (req.valid.status) {
      statuses = req.valid.status.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const data = orderService.listOrders(req.user.id, {
      status: statuses,
      page: req.valid.page,
      pageSize: req.valid.pageSize,
    });
    data.countByStatus = orderService.countByStatus(req.user.id);
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/** GET /api/v1/me/favorites */
router.get('/favorites', validatePage(), (req, res, next) => {
  try {
    const data = userService.listFavorites(req.user.id, {
      page: req.valid.page,
      pageSize: req.valid.pageSize,
    });
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/me/favorites/:guideId  收藏 toggle（幂等切换）
 * → { guideId, favorited, favoritesCount }
 */
router.put('/favorites/:guideId', (req, res, next) => {
  try {
    const data = userService.toggleFavorite(req.user.id, req.params.guideId);
    res.json(ok(data, res.locals.requestId, data.favorited ? '已收藏' : '已取消收藏'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
