'use strict';

/**
 * 鉴权业务逻辑：登录 / 换 token / 读取当前用户
 * ---------------------------------------------------------------------------
 * 真实环境走微信 code2Session；开发态无微信环境时，
 * 接受 `{ code: 'mock-user-001' }` 直接返回固定用户 token。
 */

const crypto = require('crypto');
const store = require('../db/store');
const config = require('../config');
const { signToken } = require('../utils/token');
const { unauthorized, AppError, ERROR_CODES } = require('../utils/errors');

/**
 * 登录 / 换 token
 * @param {object} payload { code }
 * @returns {{token:string, expiresIn:number, user:object}}
 */
async function login(payload) {
  const { code } = payload;

  if (!code) {
    throw new AppError(ERROR_CODES.PARAM_MISSING, '缺少参数 code', 400);
  }

  // ---- mock 登录（开发态）----
  if (config.wechat.enableMock && String(code).startsWith('mock-')) {
    const user = ensureMockUser(code);
    return buildLoginResult(user);
  }

  // ---- 真实微信登录 ----
  if (!config.wechat.appId || !config.wechat.appSecret) {
    throw new AppError(
      ERROR_CODES.UNAUTHORIZED,
      '开发模式：请使用 { code: "mock-user-001" } 登录（未配置微信 AppID）',
      401
    );
  }

  const openid = await code2Session(code);
  let user = store.findOne('users', (u) => u.openid === openid);
  if (!user) {
    const now = new Date().toISOString();
    user = {
      id: store.nextId('usr', 'users'),
      openid,
      nickname: `随行用户${openid.slice(-4)}`,
      avatar: `https://picsum.photos/seed/dupi-${openid}/200/200`,
      gender: 'unknown',
      phone: '',
      city: '',
      bio: '',
      tags: [],
      role: 'user',
      guideId: null,
      realNameVerified: false,
      realNameStatus: 'none',
      memberLevel: 'normal',
      createdAt: now,
      updatedAt: now,
    };
    store.insert('users', user);
  }
  return buildLoginResult(user);
}

/**
 * 确保 mock 用户存在（首次登录时创建）
 * @param {string} code mock code，如 mock-user-001 / mock-guide-001
 */
function ensureMockUser(code) {
  const openid = code;
  let user = store.findOne('users', (u) => u.openid === openid);
  if (user) return user;

  const now = new Date().toISOString();

  // mock-guide-XXX → 绑定到第 XXX 位地陪（用于地陪侧操作与越权测试）
  const guideMatch = /^mock-guide-(\d+)$/.exec(code);
  if (guideMatch) {
    const idx = Number(guideMatch[1]);
    const guides = store.read('guides');
    const guide = guides[idx - 1];
    if (guide) {
      user = {
        id: store.nextId('usr', 'users'),
        openid,
        nickname: guide.name,
        avatar: guide.avatar,
        gender: guide.gender,
        phone: '13800000000',
        city: guide.city,
        bio: guide.title,
        tags: [],
        role: 'guide',
        guideId: guide.id,
        realNameVerified: true,
        realNameStatus: 'verified',
        memberLevel: 'normal',
        createdAt: now,
        updatedAt: now,
      };
      store.insert('users', user);
      return user;
    }
  }

  const suffix = openid.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'guest';
  user = {
    id: store.nextId('usr', 'users'),
    openid,
    nickname: `随行用户${suffix}`,
    avatar: `https://picsum.photos/seed/dipi-${suffix}/200/200`,
    gender: 'unknown',
    phone: '13800000000',
    city: '成都',
    bio: '喜欢找当地人带着逛。',
    tags: ['美食控'],
    role: 'user',
    guideId: null,
    realNameVerified: false,
    realNameStatus: 'none',
    memberLevel: 'normal',
    createdAt: now,
    updatedAt: now,
  };
  store.insert('users', user);
  return user;
}

/**
 * 组装登录返回
 */
function buildLoginResult(user) {
  const token = signToken({ id: user.id, role: user.role, guideId: user.guideId });
  return {
    token,
    expiresIn: config.token.ttlSeconds,
    isNewUser: !user.loggedInAt,
    user: publicUser(user),
  };
}

/**
 * 对外用户信息（脱敏：不含 openid）
 */
function publicUser(user) {
  return {
    userId: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatar,
    gender: user.gender,
    phone: user.phone || '',
    city: user.city || '',
    bio: user.bio || '',
    tags: user.tags || [],
    role: user.role,
    guideId: user.guideId || null,
    createdAt: user.createdAt,
  };
}

/**
 * 当前用户资料
 * @param {string} userId
 */
function profile(userId) {
  const u = store.findById('users', userId);
  if (!u) throw unauthorized('用户不存在，请重新登录');
  const favCount = store.read('favorites').filter((f) => f.userId === userId).length;
  const orderCount = store.read('orders').filter((o) => o.userId === userId).length;
  const orderService = require('./orderService');
  return {
    ...publicUser(u),
    favoritesCount: favCount,
    orderCount,
    orderCounts: orderService.countByStatus(userId),
    orderStats: orderService.orderStats(userId),
  };
}

/**
 * 微信 code2Session（真实环境）
 * @param {string} code
 * @returns {Promise<string>} openid
 */
async function code2Session(code) {
  const url = `https://api.weixin.qq.com/sns/jscode2session`
    + `?appid=${config.wechat.appId}`
    + `&secret=${config.wechat.appSecret}`
    + `&js_code=${encodeURIComponent(code)}`
    + `&grant_type=authorization_code`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, '微信登录服务不可用，请稍后重试', 502);
  }
  const data = await res.json();
  if (!data.openid) {
    throw new AppError(ERROR_CODES.UNAUTHORIZED, `微信登录失败：${data.errmsg || 'code 无效'}`, 401);
  }
  return data.openid;
}

/**
 * 生成随机短 id（用于消息 id 兜底）
 */
function shortId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { login, profile, publicUser, ensureMockUser, shortId };
