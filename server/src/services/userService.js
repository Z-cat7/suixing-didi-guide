'use strict';

/**
 * 用户 / 收藏 / 设置业务逻辑
 * ---------------------------------------------------------------------------
 * 【契约收敛】
 *   - 收藏只有 toggle 一个入口，返回 { guideId, favorited, favoritesCount }
 *   - GET /api/v1/me 携带 orderStats（服务端聚合的四格统计，前端不自算）
 */

const store = require('../db/store');
const { notFound } = require('../utils/errors');
const { userEditableFields, settingsFields } = require('../models');
const { toCstIso } = require('../utils/money');
const guideService = require('./guideService');
const orderService = require('./orderService');

/** 手机号脱敏：138****5678 */
function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/\D/g, '');
  if (s.length < 7) return phone;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/**
 * 个人资料视图
 * @param {string} userId
 */
function getProfile(userId) {
  const u = store.findById('users', userId);
  if (!u) throw notFound('用户不存在');
  const favs = store.read('favorites').filter((f) => f.userId === userId);
  const orderCounts = orderService.countByStatus(userId);

  return {
    userId: u.id,
    nickname: u.nickname,
    avatarUrl: u.avatar,
    gender: u.gender,
    phone: u.phone || '',
    phoneMasked: maskPhone(u.phone),
    city: u.city || '',
    bio: u.bio || '',
    tags: u.tags || [],
    role: u.role,
    guideId: u.guideId || null,
    realNameVerified: !!u.realNameVerified,
    realNameStatus: u.realNameStatus || 'none',
    memberLevel: u.memberLevel || 'normal',
    favoritesCount: favs.length,
    favoriteGuideIds: favs.map((f) => f.guideId),
    orderCount: orderCounts.all,
    orderCounts,
    orderStats: orderService.orderStats(userId),
    settings: getSettings(userId),
    createdAt: toCstIso(u.createdAt),
  };
}

/**
 * 更新个人资料
 */
function updateProfile(userId, patch) {
  const allowed = {};
  for (const key of Object.keys(userEditableFields)) {
    if (patch[key] !== undefined) allowed[key] = patch[key];
  }
  if (Object.keys(allowed).length === 0) return getProfile(userId);
  store.update('users', userId, allowed);
  return getProfile(userId);
}

/**
 * 收藏列表（分页）
 */
function listFavorites(userId, opts = {}) {
  const favs = store.read('favorites')
    .filter((f) => f.userId === userId)
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));

  const page = opts.page || 1;
  const pageSize = opts.pageSize || 10;
  const start = (page - 1) * pageSize;
  const items = favs.slice(start, start + pageSize);

  const list = items
    .map((f) => {
      const guide = store.findById('guides', f.guideId);
      if (!guide) return null;
      return {
        ...guideService.toCard(guide, userId),
        favoriteId: f.id,
        favTime: toCstIso(f.createdAt),
      };
    })
    .filter(Boolean);

  return {
    list,
    total: favs.length,
    page,
    pageSize,
    hasMore: start + items.length < favs.length,
  };
}

/**
 * 收藏数量（某地陪被收藏的总次数）
 * @param {string} guideId
 */
function favoritesCount(guideId) {
  return store.read('favorites').filter((f) => f.guideId === guideId).length;
}

/**
 * 收藏 toggle（幂等切换）
 * ---------------------------------------------------------------------------
 * 同一用户同一地陪重复调用 → 正确切换（不是无脑 +1）。
 * @param {string} userId
 * @param {string} guideId
 * @returns {{guideId:string, favorited:boolean, favoritesCount:number}}
 */
function toggleFavorite(userId, guideId) {
  const guide = store.findById('guides', guideId);
  if (!guide) throw notFound('地陪不存在');

  const existing = store.read('favorites').find(
    (f) => f.userId === userId && f.guideId === guideId
  );

  if (existing) {
    store.remove('favorites', existing.id);
  } else {
    const fav = {
      id: store.nextId('fav', 'favorites'),
      userId,
      guideId,
      createdAt: new Date().toISOString(),
    };
    store.insert('favorites', fav);
  }

  const favorited = !existing;
  const count = favoritesCount(guideId);

  // 回写地陪的收藏计数（保持两侧一致）
  store.update('guides', guideId, { favoritesCount: count });

  return { guideId, favorited, favoritesCount: count };
}

/** 是否已收藏 */
function isFavorited(userId, guideId) {
  return !!store.read('favorites').find(
    (f) => f.userId === userId && f.guideId === guideId
  );
}

/** 设置默认值 */
function defaultSettings(userId) {
  return {
    id: `st_${userId}`,
    userId,
    notifyEnabled: true,
    notifyOrder: true,
    notifyMessage: true,
    notifyRefund: true,
    notifyPromotion: false,
    notifySound: true,
    privacyLocation: false,
    privacyShowProfile: true,
    privacyShowOrder: false,
    autoConfirmOrder: false,
    updatedAt: new Date().toISOString(),
  };
}

/** 读取设置（不存在则用默认值创建） */
function getSettings(userId) {
  let s = store.findOne('settings', (x) => x.userId === userId);
  if (!s) {
    s = defaultSettings(userId);
    store.insert('settings', s);
  }
  return settingsView(s);
}

/** 设置视图 */
function settingsView(s) {
  return {
    userId: s.userId,
    notifyEnabled: s.notifyEnabled !== false,
    notifyOrder: !!s.notifyOrder,
    notifyMessage: !!s.notifyMessage,
    notifyRefund: s.notifyRefund !== false,
    notifyPromotion: !!s.notifyPromotion,
    notifySound: s.notifySound !== false,
    privacyLocation: !!s.privacyLocation,
    privacyShowProfile: s.privacyShowProfile !== false,
    privacyShowOrder: !!s.privacyShowOrder,
    autoConfirmOrder: !!s.autoConfirmOrder,
    updatedAt: toCstIso(s.updatedAt),
  };
}

/** 更新设置 */
function updateSettings(userId, patch) {
  const current = getSettings(userId);
  const allowed = {};
  for (const key of Object.keys(settingsFields)) {
    if (patch[key] !== undefined) allowed[key] = !!patch[key];
  }
  if (Object.keys(allowed).length === 0) return current;

  const list = store.read('settings');
  const target = list.find((s) => s.userId === userId);
  if (!target) return current;
  Object.assign(target, allowed, { updatedAt: new Date().toISOString() });
  store.markDirty('settings');
  return settingsView(target);
}

module.exports = {
  getProfile,
  updateProfile,
  listFavorites,
  toggleFavorite,
  favoritesCount,
  isFavorited,
  getSettings,
  updateSettings,
  settingsView,
  maskPhone,
};
