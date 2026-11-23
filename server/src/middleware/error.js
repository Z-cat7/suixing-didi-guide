'use strict';

/**
 * 统一错误响应中间件
 * ---------------------------------------------------------------------------
 * 把各类异常转成 `{ code, message, data, requestId }` 信封。
 */

const { AppError, ERROR_CODES } = require('../utils/errors');
const { fail } = require('../utils/response');

/** 404 兜底：未匹配到任何路由 */
function notFoundHandler(req, res, next) {
  res.status(404).json(
    fail(ERROR_CODES.NOT_FOUND, `接口不存在：${req.method} ${req.path}`, res.locals.requestId, {
      path: req.path,
      method: req.method,
    })
  );
}

/**
 * 错误处理（必须保留 4 个参数，Express 才会识别为错误中间件）
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = res.locals.requestId || '';

  if (err instanceof AppError) {
    return res.status(err.status).json(
      fail(err.code, err.message, requestId, err.details)
    );
  }

  // express.json() 的 JSON 解析错误
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json(
      fail(ERROR_CODES.PARAM_INVALID, '请求体不是合法的 JSON', requestId)
    );
  }

  // 请求体过大
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json(
      fail(ERROR_CODES.BAD_REQUEST, '请求体过大', requestId)
    );
  }

  console.error(`[error] ${requestId} ${req.method} ${req.path}`, err);
  return res.status(500).json(
    fail(ERROR_CODES.INTERNAL_ERROR, '服务器内部错误，请稍后重试', requestId)
  );
}

module.exports = { errorHandler, notFoundHandler };
