'use strict';

/**
 * 路由：鉴权
 * ---------------------------------------------------------------------------
 * POST /api/auth/login     登录 / 换 token
 * GET  /api/auth/profile   当前用户资料
 */

const express = require('express');
const authService = require('../services/authService');
const { ok } = require('../utils/response');
const { validateBody } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login
 * Body: { code }  微信 wx.login code；开发态传 'mock-user-001'
 */
router.post('/login', validateBody({
  code: { type: 'string', required: true, maxLength: 128, trim: true },
}), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.json(ok(result, res.locals.requestId, '登录成功'));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/profile
 * 返回当前登录用户的资料
 */
router.get('/profile', requireAuth, (req, res, next) => {
  try {
    res.json(ok(authService.profile(req.user.id), res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
