'use strict';

/**
 * 路由：首页
 * ---------------------------------------------------------------------------
 * GET /api/home  首页聚合（轮播、热门目的地、服务类型、推荐地陪）
 */

const express = require('express');
const homeService = require('../services/homeService');
const { ok } = require('../utils/response');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', optionalAuth, (req, res, next) => {
  try {
    const data = homeService.getHome(req.user ? req.user.id : null);
    res.json(ok(data, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
