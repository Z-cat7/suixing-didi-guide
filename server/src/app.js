'use strict';

/**
 * Express 应用装配
 * ---------------------------------------------------------------------------
 * 【契约收敛】REST 只挂 `/api/v1` 一个前缀，不存在第二套路径。
 *
 * 路由挂载顺序：
 *   requestId → cors → json body → 业务路由 → 404 → 统一错误处理
 */

const express = require('express');
const config = require('./config');
const requestId = require('./middleware/requestId');
const cors = require('./middleware/cors');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { ok } = require('./utils/response');
const { ERROR_CODES } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const homeRoutes = require('./routes/home');
const guideRoutes = require('./routes/guides');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const noticeRoutes = require('./routes/notices');
const orderRoutes = require('./routes/orders');
const meRoutes = require('./routes/me');

/**
 * 创建 Express 应用
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // ---- 全局中间件 ----
  app.use(requestId);
  app.use(cors);
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // 访问日志
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const cost = Date.now() - start;
      console.log(
        `[http] ${req.method} ${req.originalUrl} → ${res.statusCode} ${cost}ms (${res.locals.requestId})`
      );
    });
    next();
  });

  // ---- 健康检查 ----
  app.get('/api/v1/health', (req, res) => {
    res.json(ok({
      status: 'ok',
      env: config.env,
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    }, res.locals.requestId));
  });

  // ---- 业务路由（唯一前缀 /api/v1）----
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/home', homeRoutes);
  app.use('/api/v1/guides', guideRoutes);
  app.use('/api/v1/conversations', conversationRoutes);
  app.use('/api/v1/messages', messageRoutes);
  app.use('/api/v1/notices', noticeRoutes);
  app.use('/api/v1/orders', orderRoutes);
  app.use('/api/v1/me', meRoutes);

  // ---- 兜底 ----
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
module.exports.ERROR_CODES = ERROR_CODES;
