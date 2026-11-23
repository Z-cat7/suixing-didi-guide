/**
 * 随行 dipi · 接口函数封装
 * ---------------------------------------------------------------------------
 * 与 docs/03-api-contract.md 一一对应。路径均**不含** /api/v1 前缀（前缀在 request.js 统一拼接）。
 * 所有函数返回 Promise<data>（data 已从信封中取出）。
 */
const request = require('./request');
const config = require('../config/index');

/** 默认分页大小 */
const PAGE_SIZE = config.PAGE_SIZE;

/* ==========================================================================
 * 鉴权
 * ========================================================================== */

/**
 * 登录（code 换 token）
 * @param {string} code wx.login 得到的 code（开发态用 mock-user-001）
 * @returns {Promise<object>} { token, userId, nickname, avatarUrl }
 */
function login(code) {
  return request.post('/auth/login', { code: code }, { auth: false, showError: false });
}

/* ==========================================================================
 * 首页
 * ========================================================================== */

/**
 * 首页聚合数据
 * @param {object} query { city }
 * @returns {Promise<object>}
 */
function getHome(query) {
  return request.get('/home', query || {});
}

/* ==========================================================================
 * 地陪
 * ========================================================================== */

/**
 * 地陪列表（多条件组合筛选 + 排序 + 分页）
 * @param {object} query { keyword, destination, serviceType, minPrice, maxPrice, rating, sort, page, pageSize }
 * @returns {Promise<object>} { list, page, pageSize, total, hasMore }
 */
function getGuides(query) {
  const q = Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {});
  return request.get('/guides', q);
}

/**
 * 筛选项字典（搜索页筛选面板初始化用 —— 选项一律来自服务端，客户端不硬编码）
 *
 * 【归一化】服务端不同版本的字段命名略有差异，这里统一成 UX 规范的形状：
 *   - 目的地：cities（服务端别名 destinations）
 *   - 价格区间：{ min, max, label }，其中 min/max 为**元**（查询参数单位），
 *     minAmount/maxAmount 为**分**（与金额字段「整数分」口径一致）
 * @returns {Promise<object>} { cities, serviceTypes, priceRanges, ratings, availableWindows }
 */
function getFilterOptions() {
  return request.get('/guides/filter-options', {}).then(function (data) {
    if (!data) return null;
    const priceRanges = (data.priceRanges || []).map(function (r) {
      return Object.assign({}, r, {
        // min / max 用「元」，与查询参数 minPrice/maxPrice 的单位一致
        min: r.min !== undefined ? r.min : r.minAmount / 100,
        max: r.max !== undefined ? r.max : r.maxAmount === null ? null : r.maxAmount / 100,
        // minAmount / maxAmount 用「分」，与金额整数分口径一致
        minAmount: r.minAmount !== undefined ? r.minAmount : r.min === undefined ? 0 : r.min * 100,
        maxAmount: r.maxAmount !== undefined ? r.maxAmount : r.max === undefined || r.max === null ? null : r.max * 100,
      });
    });
    return {
      cities: data.cities || data.destinations || [],
      serviceTypes: data.serviceTypes || [],
      priceRanges: priceRanges,
      ratings: data.ratings || [],
      availableWindows: data.availableWindows || [],
    };
  });
}

/**
 * 地陪详情
 * 返回体在不同版本中可能是 data 或 data.guide，本方法统一归一为 detail 对象
 * @param {string} guideId 地陪 ID
 * @returns {Promise<object>}
 */
function getGuideDetail(guideId) {
  return request.get('/guides/' + guideId, {}).then(function (data) {
    if (!data) return null;
    const guide = data.guide || data;
    // 服务项：契约统一为 services[]，元素主键为 serviceId（读接口与写接口同名）
    const services = guide.services || [];
    const normalized = Object.assign({}, guide, {
      services: services.map(function (s) {
        return Object.assign({}, s, { serviceId: s.serviceId });
      }),
      // 时段：slotId 是稳定唯一标识（原样回传）；date / timeSlot 仅用于展示
      availableSlots: (guide.availableSlots || []).map(function (slot) {
        return Object.assign({}, slot, {
          slotId: slot.slotId,
          date: slot.date,
          timeSlot: slot.timeSlot,
          available: slot.available !== false,
        });
      }),
    });
    return normalized;
  });
}

/**
 * 地陪评价列表
 * @param {string} guideId 地陪 ID
 * @param {object} query { page, pageSize }
 * @returns {Promise<object>} { list, page, pageSize, total, hasMore }
 */
function getGuideReviews(guideId, query) {
  return request.get('/guides/' + guideId + '/reviews', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/* ==========================================================================
 * 会话 / 消息
 * ========================================================================== */

/**
 * 会话列表
 * @param {object} query { page, pageSize }
 * @returns {Promise<object>}
 */
function getConversations(query) {
  return request.get('/conversations', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 会话详情
 * @param {string} conversationId 会话 ID
 * @returns {Promise<object>}
 */
function getConversation(conversationId) {
  return request.get('/conversations/' + conversationId, {});
}

/**
 * 创建会话（同地陪幂等，已有活跃会话直接复用）
 * @param {object} body { guideId, orderId }
 * @returns {Promise<object>}
 */
function createConversation(body) {
  return request.post('/conversations', body || {});
}

/**
 * 消息历史（倒序返回，前端反转后渲染）
 * @param {string} conversationId 会话 ID
 * @param {object} query { page, pageSize, since, aroundSeq }
 * @returns {Promise<object>}
 */
function getMessages(conversationId, query) {
  return request.get('/conversations/' + conversationId + '/messages', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 发送消息
 * @param {string} conversationId 会话 ID
 * @param {object} body { clientMessageId, content, messageType, imageUrl, orderSummary }
 * @returns {Promise<object>} 服务端消息对象
 */
function sendMessage(conversationId, body) {
  return request.post('/conversations/' + conversationId + '/messages', body || {}, { showError: false });
}

/**
 * 标记会话已读
 * @param {string} conversationId 会话 ID
 * @returns {Promise<object>}
 */
function markConversationRead(conversationId) {
  return request.post('/conversations/' + conversationId + '/read', {}, { silent: true, showError: false });
}

/**
 * 未读总数
 * @returns {Promise<object>} { total }
 */
function getUnreadCount() {
  return request.get('/conversations/unread-count', {}, { silent: true, showError: false });
}

/**
 * 消息聚合（全局最近消息）
 * @param {object} query { page, pageSize }
 * @returns {Promise<object>}
 */
function getGlobalMessages(query) {
  return request.get('/messages', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/* ==========================================================================
 * 通知
 * ========================================================================== */

/**
 * 通知列表
 * @param {object} query { page, pageSize, category }
 * @returns {Promise<object>}
 */
function getNotices(query) {
  return request.get('/notices', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 全部标记已读
 * @returns {Promise<object>}
 */
function readAllNotices() {
  return request.post('/notices/read', {}, { silent: true });
}

/* ==========================================================================
 * 订单
 * ========================================================================== */

/**
 * 订单列表
 * @param {object} query { status, page, pageSize }
 * @returns {Promise<object>}
 */
function getOrders(query) {
  return request.get('/orders', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 订单统计（Tab 角标）
 * @returns {Promise<object>}
 */
function getOrderSummary() {
  return request.get('/orders/summary', {}, { silent: true, showError: false });
}

/**
 * 订单详情
 * @param {string} orderId 订单 ID
 * @returns {Promise<object>}
 */
function getOrder(orderId) {
  return request.get('/orders/' + orderId, {});
}

/**
 * 创建订单（幂等）
 *
 * 【提交体最终契约】
 *   guideId, serviceId, slotId, travelers, contactName, contactPhone,
 *   meetingPoint, remark?, conversationId?, idempotencyKey
 *
 * - `serviceId` 与 `guide.services[].serviceId` 同名（读/写同名，前端不写第二套映射）
 * - `slotId` 是服务端给的稳定唯一标识，**原样回传**，服务端据此原子核销时段；
 *   `date` / `timeSlot` 仅用于界面展示，**不参与提交**
 * - `idempotencyKey` 同一次下单的重试中保持不变（换订单才换新的）
 *
 * @param {object} body 见上
 * @returns {Promise<object>} { orderId, orderNo, totalAmount, expireAt, payParams }
 */
function createOrder(body) {
  return request.post('/orders', body || {}, { showError: false });
}

/**
 * 订单支付
 * @param {string} orderId 订单 ID
 * @returns {Promise<object>} { payParams, ...order }
 */
function payOrder(orderId) {
  return request.post('/orders/' + orderId + '/pay', {}, { showError: false });
}

/**
 * 取消订单
 * @param {string} orderId 订单 ID
 * @param {object} body { cancelReasonCode, remark }
 * @returns {Promise<object>}
 */
function cancelOrder(orderId, body) {
  return request.post('/orders/' + orderId + '/cancel', body || {}, { showError: false });
}

/**
 * 确认完成
 * @param {string} orderId 订单 ID
 * @returns {Promise<object>}
 */
function confirmOrder(orderId) {
  return request.post('/orders/' + orderId + '/confirm', {}, { showError: false });
}

/**
 * 申请退款
 * @param {string} orderId 订单 ID
 * @param {object} body { refundReasonCode, description }
 * @returns {Promise<object>}
 */
function refundOrder(orderId, body) {
  return request.post('/orders/' + orderId + '/refund', body || {}, { showError: false });
}

/**
 * 评价
 * @param {string} orderId 订单 ID
 * @param {object} body { rating, content }
 * @returns {Promise<object>}
 */
function reviewOrder(orderId, body) {
  return request.post('/orders/' + orderId + '/review', body || {}, { showError: false });
}

/* ==========================================================================
 * 用户
 * ========================================================================== */

/**
 * 我的资料（含 orderCounts）
 * @returns {Promise<object>}
 */
function getMe() {
  return request.get('/me', {}, { showError: false });
}

/**
 * 更新资料
 * @param {object} body { nickname, gender, city, bio, avatarUrl }
 * @returns {Promise<object>}
 */
function updateMe(body) {
  return request.put('/me', body || {});
}

/**
 * 我的订单
 * @param {object} query { status, page, pageSize }
 * @returns {Promise<object>}
 */
function getMyOrders(query) {
  return request.get('/me/orders', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 我的收藏
 * @param {object} query { page, pageSize }
 * @returns {Promise<object>}
 */
function getMyFavorites(query) {
  return request.get('/me/favorites', Object.assign({ page: 1, pageSize: PAGE_SIZE }, query || {}));
}

/**
 * 切换收藏状态（幂等 toggle）
 * 前端**不自行取反**，以服务端返回的 favorited 为准
 * @param {string} guideId 地陪 ID
 * @param {boolean} favorited 目标状态（不传则由服务端 toggle）
 * @returns {Promise<object>} { guideId, favorited, favoritesCount }
 */
function toggleFavorite(guideId, favorited) {
  return request.put(
    '/me/favorites/' + guideId,
    favorited === undefined ? {} : { favorited: favorited },
    { showError: false }
  );
}

/**
 * 用户设置
 * @returns {Promise<object>}
 */
function getSettings() {
  return request.get('/me/settings', {}, { showError: false });
}

/**
 * 更新用户设置
 * @param {object} body 设置项
 * @returns {Promise<object>}
 */
function updateSettings(body) {
  return request.put('/me/settings', body || {});
}

/**
 * 归一化一条消息对象
 * 兼容服务端在不同版本下的字段差异：
 *   - senderType：服务端对 guide 侧消息可能落到 'user'，这里按 from 前缀修正
 *   - messageType：兼容服务端 type 枚举（text/system/order）与 messageType（text/system/order_card）
 * @param {object} msg 原始消息
 * @returns {object} 归一后的消息
 */
function normalizeMessage(msg) {
  if (!msg) return msg;
  const type = msg.messageType || msg.type || 'text';
  const typeMap = { order: 'order_card', text: 'text', system: 'system', image: 'image' };
  let senderType = msg.senderType || 'user';
  if (typeof msg.from === 'string' && msg.from.indexOf('guide') === 0) {
    senderType = 'guide';
  }
  return Object.assign({}, msg, {
    messageId: msg.messageId || msg.id,
    clientMessageId: msg.clientMessageId || '',
    senderType: senderType,
    messageType: typeMap[type] || type,
    seq: msg.seq === undefined ? null : msg.seq,
    sentAt: msg.sentAt || msg.createdAt,
    orderSummary: msg.orderSummary || null,
    status: msg.status || 'sent',
  });
}

module.exports = {
  PAGE_SIZE,
  login,
  getHome,
  getGuides,
  getFilterOptions,
  getGuideDetail,
  getGuideReviews,
  getConversations,
  getConversation,
  createConversation,
  getMessages,
  sendMessage,
  markConversationRead,
  getUnreadCount,
  getGlobalMessages,
  getNotices,
  readAllNotices,
  getOrders,
  getOrderSummary,
  getOrder,
  createOrder,
  payOrder,
  cancelOrder,
  confirmOrder,
  refundOrder,
  reviewOrder,
  getMe,
  updateMe,
  getMyOrders,
  getMyFavorites,
  toggleFavorite,
  getSettings,
  updateSettings,
  normalizeMessage,
};
