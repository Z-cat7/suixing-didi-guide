'use strict';

/**
 * 路由：地陪
 * ---------------------------------------------------------------------------
 * GET /api/v1/guides                  列表（多条件组合筛选 + 排序 + 分页）
 * GET /api/v1/guides/filter-options   筛选面板初始化
 * GET /api/v1/guides/:guideId         详情（含 services / availableSlots / reviews 摘要）
 * GET /api/v1/guides/:guideId/reviews 评价分页
 */

const express = require('express');
const store = require('../db/store');
const guideService = require('../services/guideService');
const { ok, paginate } = require('../utils/response');
const { validateQuery, validatePage } = require('../middleware/validate');
const { optionalAuth } = require('../middleware/auth');
const { notFound, unprocessable } = require('../utils/errors');

const router = express.Router();

// 列表可匿名访问；带 token 时返回 isFavorite 等个性化字段
router.use(optionalAuth);

/**
 * GET /api/v1/guides
 * Query：
 *   keyword        string  地陪名/标签/头衔/简介模糊匹配
 *   destination    string  城市
 *   serviceType    string  服务类型（foodTour / cityWalk / sightseeing / photo / parentChild / errand）
 *   minPrice       number  起步价下限（**元**）
 *   maxPrice       number  起步价上限（**元**）
 *   rating         number  最低评分 0–5
 *   sort           enum    recommend / priceAsc / priceDesc / rating（默认 recommend）
 *   page / pageSize
 */
router.get('/', validateQuery({
  keyword: { type: 'string', maxLength: 50, trim: true },
  destination: { type: 'string', maxLength: 30, trim: true },
  serviceType: { type: 'string', maxLength: 30, trim: true },
  minPrice: { type: 'number', min: 0, max: 100000 },
  maxPrice: { type: 'number', min: 0, max: 100000 },
  rating: { type: 'number', min: 0, max: 5 },
  availableWithin: { type: 'enum', values: ['none', 'today', 'weekend', 'week'] },
  sort: {
    type: 'enum',
    values: ['recommend', 'priceAsc', 'priceDesc', 'rating', 'default'],
    default: 'recommend',
  },
}), validatePage(), (req, res, next) => {
  try {
    const v = req.valid;
    if (v.minPrice !== undefined && v.maxPrice !== undefined && v.minPrice > v.maxPrice) {
      throw unprocessable('minPrice 不能大于 maxPrice');
    }
    if (v.serviceType && !require('../models').normalizeServiceType(v.serviceType)) {
      throw unprocessable('serviceType 只能是：foodTour / cityWalk / sightseeing / photo / parentChild / errand');
    }

    const result = guideService.searchGuides({
      keyword: v.keyword,
      destination: v.destination,
      serviceType: v.serviceType,
      minPrice: v.minPrice,
      maxPrice: v.maxPrice,
      rating: v.rating,
      availableWithin: v.availableWithin,
      sort: v.sort,
      page: v.page,
      pageSize: v.pageSize,
      userId: req.user ? req.user.id : null,
    });

    res.json(ok({
      list: result.list,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    }, res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guides/filter-options
 * 筛选面板初始化：目的地、服务类型、价格区间上下界、评分档位
 */
router.get('/filter-options', (req, res, next) => {
  try {
    const all = store.read('guides').filter((g) => g.status !== 'offline');
    res.json(ok(guideService.buildFacets(all), res.locals.requestId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/guides/:guideId
 */
router.get('/:guideId', (req, res, next) => {
  try {
    const detail = guideService.getGuideDetail(req.params.guideId, req.user ? req.user.id : null);
    if (!detail) return next(notFound('地陪不存在'));
    return res.json(ok({ guide: detail }, res.locals.requestId));
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/v1/guides/:guideId/reviews
 * Query: page / pageSize
 */
router.get('/:guideId/reviews', validatePage(), (req, res, next) => {
  try {
    const guide = store.findById('guides', req.params.guideId);
    if (!guide) return next(notFound('地陪不存在'));

    const all = store.read('reviews')
      .filter((r) => r.guideId === req.params.guideId)
      .slice()
      .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));

    const { page, pageSize } = req.valid;
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize).map(guideService.toReview);

    return res.json(ok(paginate(items, all.length, page, pageSize), res.locals.requestId));
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
