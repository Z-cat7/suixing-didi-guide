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
 * 订单徽章类名白名单（服务端 `statusBadge` 的实际取值集合）
 * ---------------------------------------------------------------------------
 * 这是**服务端 `models/statusMap.js` 的 STATUS_BADGE 会下发的值**，
 * 与 `docs/03-api-contract.md` §8 映射表一一对应：
 *   pendingPayment/pendingAccept → pending
 *   accepted/inService           → ongoing
 *   pendingConfirm               → review
 *   completed                    → done
 *   cancelled/closed/refunded    → closed
 *   refunding                    → refunding
 *
 * ⚠️ 本表**只用于校验**（静态检查脚本断言「样式层必须能覆盖每一个」），
 *    不做「状态 → 类名」的转换 —— 那是服务端职责。
 */
const ORDER_STATUS_BADGE_WHITELIST = [
  'pending',   // 待支付 / 待接单
  'ongoing',   // 已接单 / 服务中
  'review',    // 待确认
  'done',      // 已完成
  'closed',    // 已取消 / 已关闭 / 已退款
  'refunding', // 退款中
];

/**
 * 样式层存在、但服务端订单状态**不下发**的徽章类（非订单语义徽章）
 * ---------------------------------------------------------------------------
 * `.dipi-badge--confirmed` → 系统通知 / 处理中 / 平台介入中
 * `.dipi-badge--dispute`   → 纠纷 / 异常
 * `.dipi-badge--refund`    → `.dipi-badge--dispute` 的历史兼容别名（红）
 * 保留它们不算漂移，但若出现**白名单与别名都没有**的类 → 说明样式层与契约层悄悄分叉了。
 */
const ORDER_STATUS_BADGE_ALIASES = ['confirmed', 'dispute', 'refund'];

/** 徽章类名缺失时的兜底值（.dipi-badge--closed 一定存在） */
const ORDER_STATUS_BADGE_FALLBACK = 'closed';

/**
 * `statusTone` 值域（7 值）
 * ---------------------------------------------------------------------------
 * 功能色语义，是**色弱 / 单色模式下的第二重信息**。
 * 徽章本身仍必须带文字（不能只靠颜色区分状态）。
 */
const ORDER_STATUS_TONE_WHITELIST = [
  'warning', 'info', 'brand', 'accent', 'success', 'ink', 'error',
];

/**
 * 订单可用操作（allowedActions 取值域）
 * ---------------------------------------------------------------------------
 * 与 6 个 canUserXxx 布尔位**同源生成**（服务端的同一份 statusFlags）。
 * 前端**优先读 allowedActions[]**，缺失才退化到布尔位；绝不做状态换算。
 */
const ORDER_ACTION = {
  PAY: 'pay',
  CANCEL: 'cancel',
  CONFIRM: 'confirm',
  REFUND: 'refund',
  CONTACT: 'contact',
  REVIEW: 'review',
};

/** 订单操作 → 6 个 canUserXxx 布尔位的键名映射（仅用于「读 allowedActions 缺失时退化」） */
const ORDER_ACTION_FLAG = {
  pay: 'canUserPay',
  cancel: 'canUserCancel',
  confirm: 'canUserConfirm',
  refund: 'canUserRefund',
  contact: 'canUserContact',
  review: 'canUserReview',
};

/**
 * 判断订单某操作是否可用
 * ---------------------------------------------------------------------------
 * 【铁律】**优先读服务端下发的 `allowedActions[]`**（权威数组）；
 *         只有它缺失时，才退化到 6 个 `canUserXxx` 布尔位（与前者同源）。
 *         前端**绝不做「状态 → 操作」的换算**。
 * @param {object} order 订单对象
 * @param {string} action 操作名（pay/cancel/confirm/refund/contact/review）
 * @returns {boolean}
 */
function hasOrderAction(order, action) {
  if (!order) return false;
  const allowed = order.allowedActions;
  if (Array.isArray(allowed)) {
    return allowed.indexOf(action) >= 0;
  }
  // 退化路径：读布尔位
  const flagKey = ORDER_ACTION_FLAG[action];
  return flagKey ? !!order[flagKey] : false;
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

/**
 * 排序方式（与契约 `sort` 查询参数一致）
 * 值域：recommend | priceAsc | priceDesc | rating
 */
const SORT = {
  RECOMMEND: 'recommend',
  PRICE_ASC: 'priceAsc',
  PRICE_DESC: 'priceDesc',
  RATING: 'rating',
};

/** 搜索页排序项 */
const SORT_OPTIONS = [
  { code: SORT.RECOMMEND, label: '综合' },
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

/**
 * 订单页 Tab 定义（label 为前端导航文案，不参与状态判定）
 * ---------------------------------------------------------------------------
 * `statusQuery` 是**发给服务端的 status 查询参数**（逗号分隔的 camelCase 状态枚举）。
 * ⚠️ 服务端只接受**状态枚举值**，不接受展示分桶名（如 `ongoing`）——
 *    发错会拿到 422（"订单状态只能是：…"）。所以 Tab 必须带 statusQuery 映射。
 */
const ORDER_TABS = [
  { code: ORDER_TAB.ALL, label: '全部', statusQuery: '' },
  { code: ORDER_TAB.PENDING_PAYMENT, label: '待支付', statusQuery: 'pendingPayment' },
  // 进行中 = accepted + inService（服务端按逗号分隔多状态过滤）
  { code: ORDER_TAB.ONGOING, label: '进行中', statusQuery: 'accepted,inService' },
  { code: ORDER_TAB.PENDING_CONFIRM, label: '待确认', statusQuery: 'pendingConfirm' },
  { code: ORDER_TAB.COMPLETED, label: '已完成', statusQuery: 'completed' },
  // 退款 = refunding + refunded
  { code: ORDER_TAB.REFUNDING, label: '退款', statusQuery: 'refunding,refunded' },
];

/**
 * 取 Tab 对应的服务端 status 查询参数
 * @param {string} tabCode Tab code
 * @returns {string} 逗号分隔的状态枚举（全部 Tab 返回空串）
 */
function getOrderTabStatusQuery(tabCode) {
  const found = ORDER_TABS.filter(function (t) {
    return t.code === tabCode;
  })[0];
  return found ? found.statusQuery : '';
}

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
  { code: 'ongoing', label: '服务中', alias: '' },
  { code: 'pendingConfirm', label: '待确认', alias: '' },
  { code: 'refunded', label: '退款', alias: 'refunding' },
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
  ORDER_STATUS_BADGE_WHITELIST,
  ORDER_STATUS_BADGE_ALIASES,
  ORDER_STATUS_BADGE_FALLBACK,
  ORDER_STATUS_TONE_WHITELIST,
  ORDER_ACTION,
  ORDER_ACTION_FLAG,
  hasOrderAction,
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
  getOrderTabStatusQuery,
  REFUND_REASON,
  CANCEL_REASON,
  ORDER_STAT_BUCKETS,
  STORAGE_KEY,
  ROUTES,
  TAB_BAR_ITEMS,
};
