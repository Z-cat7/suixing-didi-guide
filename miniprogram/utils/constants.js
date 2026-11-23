/**
 * 随行 dipi · 枚举常量
 * ---------------------------------------------------------------------------
 * 【铁律】订单的「可执行操作」不由前端推导，一律读服务端下发的
 *        canUserPay / canUserCancel / canUserConfirm / canUserRefund /
 *        canUserContact / canUserReview 六个布尔位。
 *        本文件中的 ORDER_STATUS 仅用于：
 *          1) 状态枚举白名单（识别未知值，做容错降级）
 *          2) 徽章样式类映射（纯视觉，不含任何操作语义）
 *        状态文案一律读服务端 statusText。
 */

/** 订单状态枚举（10 个） */
const ORDER_STATUS = {
  PENDING_PAYMENT: 'pendingPayment',
  PENDING_ACCEPT: 'pendingAccept',
  ACCEPTED: 'accepted',
  IN_SERVICE: 'inService',
  PENDING_CONFIRM: 'pendingConfirm',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
};

/** 订单状态白名单数组 */
const ORDER_STATUS_LIST = [
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PENDING_ACCEPT,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.IN_SERVICE,
  ORDER_STATUS.PENDING_CONFIRM,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.CLOSED,
  ORDER_STATUS.REFUNDING,
  ORDER_STATUS.REFUNDED,
];

/**
 * 订单状态 → 徽章样式类（纯视觉映射，来自 UX 规范 §A.3.3）
 * 注意：这里**不包含**任何按钮/操作语义。
 */
const ORDER_STATUS_BADGE_CLASS = {
  pendingPayment: 'dipi-badge--pending',
  pendingAccept: 'dipi-badge--confirmed',
  accepted: 'dipi-badge--confirmed',
  inService: 'dipi-badge--ongoing',
  pendingConfirm: 'dipi-badge--review',
  completed: 'dipi-badge--done',
  cancelled: 'dipi-badge--closed',
  closed: 'dipi-badge--closed',
  refunding: 'dipi-badge--refund',
  refunded: 'dipi-badge--closed',
};

/**
 * 未知状态的兜底徽章类（服务端新增状态时不至于白屏）
 */
const ORDER_STATUS_FALLBACK_BADGE_CLASS = 'dipi-badge--closed';

/**
 * 取订单徽章样式类
 * @param {string} status 订单状态
 * @returns {string} 样式类名
 */
function getOrderBadgeClass(status) {
  return ORDER_STATUS_BADGE_CLASS[status] || ORDER_STATUS_FALLBACK_BADGE_CLASS;
}

/** 服务类型枚举（小驼峰，与服务端契约一致） */
const SERVICE_TYPE = {
  FOOD_TOUR: 'foodTour',
  CITY_WALK: 'cityWalk',
  SIGHTSEEING: 'sightseeing',
  PHOTO: 'photo',
  PARENT_CHILD: 'parentChild',
  ERRAND: 'errand',
};

/** 首页金刚区服务类型（code 与服务端枚举一致） */
const SERVICE_TYPE_ITEMS = [
  { code: SERVICE_TYPE.FOOD_TOUR, name: '美食陪逛', iconName: 'food' },
  { code: SERVICE_TYPE.CITY_WALK, name: '城市漫游', iconName: 'walk' },
  { code: SERVICE_TYPE.SIGHTSEEING, name: '景点讲解', iconName: 'ticket' },
  { code: SERVICE_TYPE.PHOTO, name: '拍照跟拍', iconName: 'camera' },
  { code: SERVICE_TYPE.PARENT_CHILD, name: '亲子陪玩', iconName: 'child' },
  { code: SERVICE_TYPE.ERRAND, name: '办事协助', iconName: 'errand' },
];

/** 排序方式（与契约 sortBy 参数一致） */
const SORT = {
  DEFAULT: 'default',
  PRICE_ASC: 'priceAsc',
  PRICE_DESC: 'priceDesc',
  RATING: 'rating',
};

/** 搜索页排序项 */
const SORT_OPTIONS = [
  { code: SORT.DEFAULT, label: '综合' },
  { code: SORT.PRICE_ASC, label: '价格↑' },
  { code: SORT.PRICE_DESC, label: '价格↓' },
  { code: SORT.RATING, label: '评分' },
];

/** 价格单位 */
const PRICE_UNIT = {
  HOUR: 'hour',
  SESSION: 'session',
  DAY: 'day',
  PERSON: 'person',
};

/** 价格单位中文 */
const PRICE_UNIT_TEXT = {
  hour: '小时',
  session: '次',
  day: '天',
  person: '人',
};

/** 消息发送方 */
const SENDER_TYPE = {
  USER: 'user',
  GUIDE: 'guide',
  SYSTEM: 'system',
};

/** 消息类型 */
const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  ORDER_CARD: 'order_card',
  SYSTEM: 'system',
};

/** WS 连接状态 */
const WS_STATE = {
  CONNECTED: 'connected',
  CONNECTING: 'connecting',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
  POLLING: 'polling',
};

/** 订单页状态分栏（Tab） */
const ORDER_TAB = {
  ALL: 'all',
  PENDING_PAYMENT: 'pendingPayment',
  ONGOING: 'ongoing',
  PENDING_CONFIRM: 'pendingConfirm',
  COMPLETED: 'completed',
  REFUNDING: 'refunding',
};

/** 订单页 Tab 定义（label 为前端导航文案，不参与状态判定） */
const ORDER_TABS = [
  { code: ORDER_TAB.ALL, label: '全部' },
  { code: ORDER_TAB.PENDING_PAYMENT, label: '待支付' },
  { code: ORDER_TAB.ONGOING, label: '进行中' },
  { code: ORDER_TAB.PENDING_CONFIRM, label: '待确认' },
  { code: ORDER_TAB.COMPLETED, label: '已完成' },
  { code: ORDER_TAB.REFUNDING, label: '退款' },
];

/** 退款原因（客户端采集，提交给服务端） */
const REFUND_REASON = [
  { code: 'not_started', label: '服务未开始' },
  { code: 'service_aborted', label: '服务中止' },
  { code: 'not_as_agreed', label: '与约定不符' },
  { code: 'poor_quality', label: '服务质量不达标' },
  { code: 'other', label: '其他' },
];

/** 取消原因（客户端采集，可选） */
const CANCEL_REASON = [
  { code: 'busy', label: '临时有事' },
  { code: 'plan_changed', label: '计划有变' },
  { code: 'choose_other', label: '选到其他地陪' },
  { code: 'other', label: '其他' },
];

/**
 * 订单统计展示分桶
 * ---------------------------------------------------------------------------
 * 【重要】这些 code 是**服务端聚合后的展示分桶**，不是订单状态枚举：
 *   - `ongoing` = accepted + inService（进行中）
 *   - 退款格 = refunding + refunded（服务端可能下发 `refunded` 或 `refunding`，
 *     两者语义相同；`alias` 用于兼容两种命名，客户端按 `code` 优先、`alias` 兜底取值）
 * 数量由服务端在 GET /api/v1/me 的 `orderStats` 字段中下发，
 * 前端**只渲染，不按订单状态自行聚合**。
 */
const ORDER_STAT_BUCKETS = [
  { code: 'pendingPayment', label: '待支付', alias: '' },
  { code: 'ongoing', label: '进行中', alias: '' },
  { code: 'pendingConfirm', label: '待确认', alias: '' },
  { code: 'refunding', label: '已退款', alias: 'refunded' },
];

/** 存储 key（统一 dipi: 前缀 + 冒号分层） */
const STORAGE_KEY = {
  TOKEN: 'dipi:user:token',
  PROFILE: 'dipi:user:profile',
  CITY: 'dipi:user:city',
  LOCATION_ASKED: 'dipi:user:locationAsked',
  DRAFT_ORDER: 'dipi:draft:order',
  DRAFT_CHAT_PREFIX: 'dipi:draft:chat:',
  NAV_ORDER: 'dipi:nav:order',
  MESSAGE_TAB: 'dipi:message:tab',
  SEARCH_HISTORY: 'dipi:search:history',
  REDIRECT: 'dipi:redirect',
  IDEM_PREFIX: 'dipi:idem:',
};

/** 页面路由 */
const ROUTES = {
  HOME: '/pages/home/home',
  SEARCH: '/pages/search/search',
  CHAT: '/pages/chat/chat',
  ORDER: '/pages/order/order',
  MESSAGE: '/pages/message/message',
  PROFILE: '/pages/profile/profile',
  GUIDE_DETAIL: '/pages/guide/detail',
  ORDER_CREATE: '/pages/order/create',
};

/** TabBar 项（与 app.json tabBar.list 顺序一致） */
const TAB_BAR_ITEMS = [
  { key: 'home', label: '首页', pagePath: ROUTES.HOME, iconName: 'home' },
  { key: 'message', label: '消息', pagePath: ROUTES.MESSAGE, iconName: 'message' },
  { key: 'order', label: '订单', pagePath: ROUTES.ORDER, iconName: 'order' },
  { key: 'profile', label: '我的', pagePath: ROUTES.PROFILE, iconName: 'profile' },
];

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_LIST,
  ORDER_STATUS_BADGE_CLASS,
  ORDER_STATUS_FALLBACK_BADGE_CLASS,
  getOrderBadgeClass,
  SERVICE_TYPE,
  SERVICE_TYPE_ITEMS,
  SORT,
  SORT_OPTIONS,
  PRICE_UNIT,
  PRICE_UNIT_TEXT,
  SENDER_TYPE,
  MESSAGE_TYPE,
  WS_STATE,
  ORDER_TAB,
  ORDER_TABS,
  REFUND_REASON,
  CANCEL_REASON,
  ORDER_STAT_BUCKETS,
  STORAGE_KEY,
  ROUTES,
  TAB_BAR_ITEMS,
};
