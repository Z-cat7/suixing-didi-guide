'use strict';

/**
 * 鉴权中间件
 * ---------------------------------------------------------------------------
 * 方式：请求头 `Authorization: Bearer <token>`
 * token 由 utils/token.js 用 HMAC-SHA256 自实现签名（不依赖 jsonwebtoken）。
 */

const store = require('../db/store');
const { verifyToken } = require('../utils/token');
const { unauthorized, forbidden, AppError, ERROR_CODES } = require('../utils/errors');

/** 从请求头提取 token */
function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  // 兼容 WebSocket：ws 客户端无法自定义请求头，允许 query 传 token
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return '';
}

/**
 * 强制登录
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(unauthorized('请先登录'));
  }

  const result = verifyToken(token);
  if (!result.ok) {
    if (result.reason === 'expired') {
      return next(new AppError(ERROR_CODES.TOKEN_EXPIRED, '登录已过期，请重新登录', 401));
    }
    return next(new AppError(ERROR_CODES.TOKEN_INVALID, '登录凭证无效，请重新登录', 401));
  }

  const user = store.findById('users', result.payload.sub);
  if (!user) {
    return next(unauthorized('用户不存在，请重新登录'));
  }

  req.user = {
    id: user.id,
    role: user.role,
    guideId: user.guideId || null,
    openid: user.openid,
  };
  req.tokenPayload = result.payload;
  return next();
}

/**
 * 可选登录：有 token 就解析，没有也放行（用于匿名也能看内容的接口）
 */
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  const result = verifyToken(token);
  if (!result.ok) return next();
  const user = store.findById('users', result.payload.sub);
  if (user) {
    req.user = {
      id: user.id,
      role: user.role,
      guideId: user.guideId || null,
      openid: user.openid,
    };
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
