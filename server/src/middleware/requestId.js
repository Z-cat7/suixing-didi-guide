'use strict';

/**
 * 请求 ID 中间件
 * ---------------------------------------------------------------------------
 * 优先使用客户端传入的 X-Request-Id，否则生成一个；回写到响应头与响应信封。
 */

const crypto = require('crypto');

module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const rid = incoming && /^[\w-]{1,64}$/.test(incoming)
    ? incoming
    : `req_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

  req.requestId = rid;
  res.locals.requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
};
