'use strict';

/**
 * 轻量 CORS 中间件
 * ---------------------------------------------------------------------------
 * 小程序本身不需要 CORS，但 Web 端调试 / 本地联调需要。
 * 不引入 cors 依赖，保持零外部依赖。
 */

module.exports = function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', req.get('origin') || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Request-Id,X-Mock-Role'
  );
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  return next();
};
