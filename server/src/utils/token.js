'use strict';

/**
 * 自实现 HMAC 签名 Token（不引入 jsonwebtoken 依赖）
 * ---------------------------------------------------------------------------
 * 结构：base64url(payloadJson) + '.' + base64url(hmacSha256(payload))
 * payload：{ sub: userId, uid: userId, role, iat, exp, iatMs, jti }
 */

const crypto = require('crypto');
const config = require('../config');

/** base64url 编码（去掉 padding，兼容 URL 安全） */
function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** base64url 解码 */
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * 签发 token
 * @param {{id:string, role:string, guideId?:string}} user 用户
 * @param {number} [ttlSeconds] 有效期秒数
 * @returns {string} token 字符串
 */
function signToken(user, ttlSeconds = config.token.ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    uid: user.id,
    role: user.role,
    gid: user.guideId || null,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', config.token.secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * 校验并解析 token
 * @param {string} token
 * @returns {{ok:true,payload:object}|{ok:false,reason:string}}
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [body, sig] = parts;
  const expect = b64url(crypto.createHmac('sha256', config.token.secret).update(body).digest());

  // 定长比较，避免时序侧信道
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'bad_payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { ok: false, reason: 'expired', payload };
  }

  return { ok: true, payload };
}

module.exports = { signToken, verifyToken };
