'use strict';

/**
 * 首页聚合服务
 * ---------------------------------------------------------------------------
 * 字段名对齐 UX 规范 §B.1.3 / 团队契约：
 *   banners / hotDestinations / serviceTypes / recommendGuides
 */

const store = require('../db/store');
const { SERVICE_TYPES } = require('../models');
const guideService = require('./guideService');
const orderService = require('./orderService');
const { pendingPayment, pendingAccept, accepted, inService, pendingConfirm } = require('../models/statusMap');

/** 轮播位 */
const BANNERS = [
  {
    bannerId: 'bn_01',
    title: '第一次来，也能被本地人带着走',
    subtitle: '12 位在地地陪 · 4 座城市',
    imageUrl: 'https://picsum.photos/seed/dipi-banner-01/750/320',
    linkType: 'destination',
    linkValue: '成都',
  },
  {
    bannerId: 'bn_02',
    title: '一日三餐，从巷子开始',
    subtitle: '美食陪逛 · 私藏菜单',
    imageUrl: 'https://picsum.photos/seed/dipi-banner-02/750/320',
    linkType: 'serviceType',
    linkValue: 'foodTour',
  },
  {
    bannerId: 'bn_03',
    title: '带着娃也能逛半天',
    subtitle: '亲子陪玩 · 安全第一',
    imageUrl: 'https://picsum.photos/seed/dipi-banner-03/750/320',
    linkType: 'serviceType',
    linkValue: 'parentChild',
  },
];

/** 场景入口 */
const SCENES = [
  { code: 'foodTour', name: '当地美食', iconName: 'food', subtitle: '跟着本地人吃', query: { serviceType: 'foodTour' } },
  { code: 'cityWalk', name: '城市漫游', iconName: 'walk', subtitle: '半天读懂一座城', query: { serviceType: 'cityWalk' } },
  { code: 'parentChild', name: '亲子同行', iconName: 'child', subtitle: '带娃也省心', query: { serviceType: 'parentChild' } },
  { code: 'errand', name: '办事协助', iconName: 'ticket', subtitle: '排队跑腿代劳', query: { serviceType: 'errand' } },
];

/** 保障说明 */
const GUARANTEES = [
  { code: 'verified', title: '实名认证', description: '地陪身份与资质双重核验', iconName: 'verified' },
  { code: 'refund', title: '随时可退', description: '服务未开始可全额退款', iconName: 'refund' },
  { code: 'support', title: '全程护航', description: '订单异常 24 小时内介入', iconName: 'support' },
];

/**
 * 首页聚合
 * @param {string|null} userId 当前用户（可为匿名）
 * @param {string} [currentCity] 当前服务城市
 */
function getHome(userId, currentCity) {
  const guides = store.read('guides').filter((g) => g.status !== 'offline');

  const hotDestinations = guideService.hotDestinations(6);
  const cityOptions = hotDestinations.map((d) => ({
    code: d.code, name: d.name, guideCount: d.guideCount,
  }));
  const city = currentCity || (cityOptions[0] ? cityOptions[0].name : '');

  // 金刚区服务类型
  const serviceTypes = SERVICE_TYPES.map((t) => ({
    code: t.code,
    name: t.name,
    iconName: t.iconName,
    desc: t.desc,
    guideCount: guides.filter((g) => (g.serviceTypes || []).includes(t.code)).length,
  }));

  // 推荐地陪
  const recommendGuides = guideService.recommendedGuides(6, userId);

  // 好评精选
  const topRatedGuides = guides
    .filter((g) => g.rating >= 4.8)
    .sort((a, b) => b.ratingCount - a.ratingCount)
    .slice(0, 4)
    .map((g) => guideService.toCard(g, userId));

  // 进行中订单提醒
  let activeOrderSummary = null;
  if (userId) {
    const active = store.read('orders')
      .filter((o) => o.userId === userId)
      .filter((o) => [
        pendingPayment, pendingAccept, accepted, inService, pendingConfirm,
      ].includes(o.status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (active) {
      const view = orderService.toView(active);
      activeOrderSummary = {
        orderId: view.orderId,
        orderNo: view.orderNo,
        status: view.status,
        statusText: view.statusText,
        guideName: view.guideName,
        serviceName: view.serviceName,
        scheduledAt: view.scheduledAt,
      };
    }
  }

  // 未读消息数
  let unreadCount = 0;
  if (userId) {
    unreadCount = store.read('conversations')
      .filter((c) => c.userId === userId)
      .reduce((s, c) => s + (c.unreadCount || 0), 0);
    unreadCount += store.read('notifications')
      .filter((n) => n.userId === userId && !n.read).length;
  }

  return {
    currentCity: city,
    searchPlaceholder: '搜索目的地或服务',
    banners: BANNERS,
    hotDestinations,
    cityOptions,
    serviceTypes,
    scenes: SCENES,
    guarantees: GUARANTEES,
    recommendGuides,
    topRatedGuides,
    activeOrderSummary,
    guideTotal: guides.length,
    cityTotal: cityOptions.length,
    unreadCount,
  };
}

module.exports = { getHome, BANNERS, SCENES, GUARANTEES };
