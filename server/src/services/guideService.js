'use strict';

/**
 * 地陪业务逻辑：搜索筛选、排序、推荐、详情组装
 * ---------------------------------------------------------------------------
 * 【契约收敛】
 *   - 金额一律整数分（*Amount）
 *   - 服务项数组名为 `services`，元素主键字段为 `serviceId`
 *   - 可约时段元素为 { slotId, date, timeSlot, available }，覆盖未来 14 天
 *   - 地陪摘要额外给出 favoritesCount（收藏数）
 */

const store = require('../db/store');
const config = require('../config');
const { SERVICE_TYPES, normalizeServiceType } = require('../models');
const { yuanToCents } = require('../utils/money');

/** 排序方式（入参归一化；响应不暴露排序字段） */
const SORT_ALIASES = {
  recommend: 'recommend',
  default: 'recommend',
  priceAsc: 'priceAsc',
  price_asc: 'priceAsc',
  priceDesc: 'priceDesc',
  price_desc: 'priceDesc',
  rating: 'rating',
};

/**
 * 地陪列表查询
 * @param {object} q { keyword, destination, serviceType, minPrice, maxPrice, rating, availableWithin, sort, page, pageSize }
 */
function searchGuides(q = {}) {
  const all = store.read('guides').filter((g) => g.status !== 'offline');

  const serviceType = q.serviceType ? normalizeServiceType(q.serviceType) : null;

  const list = all.filter((g) => {
    if (q.keyword) {
      const kw = String(q.keyword).trim().toLowerCase();
      if (kw) {
        const hay = [g.name, g.title, g.intro, g.city, ...(g.tags || [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
    }
    if (q.destination && g.city !== q.destination && !(g.cities || []).includes(q.destination)) {
      return false;
    }
    if (serviceType && !(g.serviceTypes || []).includes(serviceType)) return false;
    // 价格区间按起步价判定（单位：元）
    if (q.minPrice !== undefined && g.priceAmount < yuanToCents(q.minPrice)) return false;
    if (q.maxPrice !== undefined && g.priceAmount > yuanToCents(q.maxPrice)) return false;
    if (q.rating !== undefined && g.rating < q.rating) return false;
    if (q.availableWithin && !checkAvailableWithin(g, q.availableWithin)) return false;
    return true;
  });

  sortGuides(list, SORT_ALIASES[q.sort] || 'recommend');

  const page = q.page || 1;
  const pageSize = q.pageSize || config.pagination.defaultPageSize;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);

  return {
    list: items.map((g) => toCard(g, q.userId)),
    total: list.length,
    page,
    pageSize,
    hasMore: start + items.length < list.length,
    facets: buildFacets(all),
  };
}

/** 可约时间筛选 */
function checkAvailableWithin(g, when) {
  if (when === 'none') return false;
  const slots = g.availableSlots || [];
  if (!slots.length) return false;
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (when === 'today') return slots.some((s) => s.date === iso(today));
  if (when === 'weekend') {
    return slots.some((s) => {
      const day = new Date(`${s.date}T00:00:00`).getDay();
      return day === 0 || day === 6;
    });
  }
  if (when === 'week') {
    const end = new Date(today.getTime() + 7 * 86400 * 1000);
    return slots.some((s) => {
      const d = new Date(`${s.date}T00:00:00`);
      return d >= today && d <= end;
    });
  }
  return true;
}

/** 排序 */
function sortGuides(list, sort) {
  switch (sort) {
    case 'priceAsc':
      list.sort((a, b) => a.priceAmount - b.priceAmount || b.rating - a.rating);
      break;
    case 'priceDesc':
      list.sort((a, b) => b.priceAmount - a.priceAmount || b.rating - a.rating);
      break;
    case 'rating':
      list.sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount);
      break;
    case 'recommend':
    default:
      list.sort((a, b) => recommendScore(b) - recommendScore(a));
      break;
  }
  return list;
}

/**
 * 推荐分：评分 60% + 订单量 20% + 评价数 10% + 认证 5% + 活跃状态 5%
 */
function recommendScore(g) {
  const ratingScore = (g.rating / 5) * 60;
  const orderScore = Math.min(20, Math.log10((g.completedOrderCount || 0) + 1) * 10);
  const reviewScore = Math.min(10, (g.ratingCount || 0) / 20);
  const verifiedScore = g.verified ? 5 : 0;
  const activeScore = g.status === 'active' ? 5 : 0;
  return ratingScore + orderScore + reviewScore + verifiedScore + activeScore;
}

/**
 * 聚合筛选项（搜索页筛选面板初始化）
 */
function buildFacets(all) {
  const cities = new Map();
  const services = new Map();
  for (const g of all) {
    cities.set(g.city, (cities.get(g.city) || 0) + 1);
    for (const t of g.serviceTypes || []) {
      services.set(t, (services.get(t) || 0) + 1);
    }
  }
  const amounts = all.map((g) => g.priceAmount);
  const minAmount = amounts.length ? Math.min(...amounts) : 0;
  const maxAmount = amounts.length ? Math.max(...amounts) : 0;

  return {
    destinations: Array.from(cities, ([name, count]) => ({
      code: name, name, guideCount: count, isHot: count >= 3,
    })).sort((a, b) => b.guideCount - a.guideCount),
    serviceTypes: SERVICE_TYPES.map((t) => ({
      code: t.code,
      name: t.name,
      iconName: t.iconName,
      guideCount: services.get(t.code) || 0,
    })),
    priceRange: {
      minAmount,
      maxAmount,
      min: Math.floor(minAmount / 100),
      max: Math.ceil(maxAmount / 100),
    },
    priceRanges: buildPriceRanges(minAmount, maxAmount),
    ratings: [
      { value: 4.8, label: '4.8 分以上' },
      { value: 4.5, label: '4.5 分以上' },
      { value: 4.0, label: '4.0 分以上' },
    ],
    availableWindows: [
      { code: 'today', label: '今天就能约' },
      { code: 'weekend', label: '本周末可约' },
      { code: 'week', label: '一周内可约' },
    ],
  };
}

/** 价格区间选项（单选，单位：分 + 展示用元） */
function buildPriceRanges(minAmount, maxAmount) {
  if (!maxAmount) return [];
  const step = maxAmount > 40000 ? 10000 : 5000;
  const ranges = [];
  const start = Math.floor(minAmount / step) * step;
  for (let lo = start; lo < maxAmount; lo += step) {
    const hi = Math.min(lo + step, maxAmount);
    ranges.push({
      minAmount: lo,
      maxAmount: hi,
      min: lo / 100,
      max: hi / 100,
      label: `¥${lo / 100}-${hi / 100}`,
    });
  }
  return ranges;
}

/**
 * 地陪卡片视图（列表页 / 推荐位通用）
 */
function toCard(g, userId) {
  if (!g) return null;
  const tags = (g.tags || []).slice(0, 4);
  const firstType = (g.serviceTypes || [])[0];
  const typeMeta = SERVICE_TYPES.find((t) => t.code === firstType);

  return {
    guideId: g.id,
    name: g.name,
    avatarUrl: g.avatar,
    photoUrls: g.photoUrls || [g.cover || g.avatar],
    gender: g.gender,
    city: g.city,
    district: g.district || '',
    title: g.title,
    introduction: g.intro,
    rating: g.rating,
    ratingCount: g.ratingCount,
    completedOrderCount: g.completedOrderCount,
    tags,
    serviceTypes: g.serviceTypes || [],
    serviceTypeName: typeMeta ? typeMeta.name : '',
    languages: g.languages || [],
    languagesText: (g.languages || []).join(' / '),
    highlights: g.highlights || [],
    location: g.location || '',
    responseTimeMin: g.responseTimeMin || null,
    priceAmount: g.priceAmount,
    priceOriginAmount: g.priceOriginAmount || null,
    priceMaxAmount: g.priceMaxAmount || g.priceAmount,
    priceUnit: g.priceUnit || 'hour',
    priceUnitText: g.priceUnitText || '小时',
    isResting: g.status !== 'active',
    status: g.status,
    verified: g.verified,
    identityVerified: !!g.verified,
    isFavorite: userId
      ? !!store.read('favorites').find((f) => f.userId === userId && f.guideId === g.id)
      : false,
    favoritesCount: g.favoritesCount || 0,
    distanceKm: g.distanceKm || null,
  };
}

/**
 * 地陪详情（含 services / availableSlots / reviews 摘要）
 * @param {string} guideId
 * @param {string} [userId] 当前用户（用于 isFavorite）
 */
function getGuideDetail(guideId, userId) {
  const g = store.findById('guides', guideId);
  if (!g) return null;

  const serviceItems = store.read('serviceItems').filter((s) => s.guideId === guideId);

  const services = serviceItems.map((s) => ({
    serviceId: s.id,
    name: s.name,
    serviceType: s.serviceType,
    description: s.description,
    priceAmount: s.priceAmount,
    priceUnit: s.priceUnit || 'hour',
    priceUnitText: s.priceUnitText || '小时',
    durationHours: s.durationHours,
    minTravelers: s.minTravelers || 1,
    maxTravelers: s.maxTravelers || 8,
    includes: s.includes || [],
    icon: s.icon,
    isAvailable: true,
  }));

  const reviews = store.read('reviews').filter((r) => r.guideId === guideId);
  const ratingCount = reviews.reduce((acc, r) => {
    acc[r.rating] = (acc[r.rating] || 0) + 1;
    return acc;
  }, {});
  const avg = reviews.length
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : g.rating;

  // 可约时段：取服务项时段并集，标记已被预约的为不可用
  const booked = new Set(serviceItems.flatMap((s) => s.bookedSlots || []));
  const slotMap = new Map();
  for (const s of serviceItems) {
    for (const slot of s.slots || []) {
      if (!slotMap.has(slot.slotId)) slotMap.set(slot.slotId, slot);
    }
  }
  const availableSlots = Array.from(slotMap.values())
    .sort((a, b) => (a.date === b.date ? a.slotId.localeCompare(b.slotId) : a.date.localeCompare(b.date)))
    .map((slot) => ({
      slotId: slot.slotId,
      date: slot.date,
      timeSlot: slot.timeSlot,
      available: !booked.has(slot.slotId),
    }));

  return {
    ...toCard(g, userId),
    rating: avg,
    ratingCount: g.ratingCount,
    completedOrderCount: g.completedOrderCount,
    tags: (g.tags || []).slice(0, 4),
    favoritesCount: g.favoritesCount || 0,
    services,
    availableSlots,
    reviews: reviews.slice(0, 5).map(toReview),
    reviewSummary: {
      average: avg,
      total: g.ratingCount,
      distribution: [5, 4, 3, 2, 1].map((score) => ({
        score, count: ratingCount[score] || 0,
      })),
      tags: buildReviewTags(reviews),
    },
  };
}

/** 评价视图 */
function toReview(r) {
  return {
    reviewId: r.id,
    orderId: r.orderId,
    guideId: r.guideId,
    userNickname: r.userName,
    userAvatarUrl: r.userAvatar,
    rating: r.rating,
    content: r.content,
    tags: r.tags || [],
    images: r.images || [],
    serviceName: r.serviceName || '',
    createdAt: r.createdAt,
    reply: r.reply || null,
  };
}

/** 评价标签聚合 */
function buildReviewTags(reviews) {
  const counter = new Map();
  for (const r of reviews) {
    for (const t of r.tags || []) {
      counter.set(t, (counter.get(t) || 0) + 1);
    }
  }
  return Array.from(counter, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

/** 热门目的地聚合（首页用） */
function hotDestinations(limit = 6) {
  const counter = new Map();
  for (const g of store.read('guides')) {
    if (g.status === 'offline') continue;
    counter.set(g.city, (counter.get(g.city) || 0) + 1);
  }
  return Array.from(counter, ([name, count]) => ({
    code: name,
    name,
    guideCount: count,
    cover: `https://picsum.photos/seed/dipi-city-${encodeURIComponent(name)}/480/300`,
  }))
    .sort((a, b) => b.guideCount - a.guideCount)
    .slice(0, limit);
}

/** 首页推荐地陪 */
function recommendedGuides(limit = 6, userId) {
  const list = store.read('guides').filter((g) => g.status !== 'offline');
  sortGuides(list, 'recommend');
  return list.slice(0, limit).map((g) => toCard(g, userId));
}

module.exports = {
  searchGuides,
  sortGuides,
  recommendScore,
  toCard,
  toReview,
  getGuideDetail,
  buildFacets,
  hotDestinations,
  recommendedGuides,
};
