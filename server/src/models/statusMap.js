'use strict';

/**
 * 订单状态映射与权限标志
 * ---------------------------------------------------------------------------
 * 【契约收敛】全链路 camelCase，只有一套状态码命名，不保留 snake_case 别名。
 * 代码里也不存在 snake_case 命名的状态常量——常量名与状态值都是 camelCase。
 *
 * 对外输出：
 *   status       状态码（camelCase 枚举）
 *   statusText   中文文案（服务端下发，前端不自行翻译）
 *   statusBadge  徽章类（对应 components.wxss 的 .dipi-badge--*）
 *   statusTone   功能色语义（对应 tokens.wxss 功能色族）
 *   canUserXxx   状态 → 用户可执行操作标志（UX 规范 §D.3 铁律：前端只读不算）
 */

/* ---- 订单状态（camelCase 枚举，10 态）----
 * 常量名与状态值同名小驼峰，代码里不存在 snake_case 状态标识符。 */
const pendingPayment = 'pendingPayment';
const pendingAccept = 'pendingAccept';
const accepted = 'accepted';
const inService = 'inService';
const pendingConfirm = 'pendingConfirm';
const completed = 'completed';
const cancelled = 'cancelled';
const closed = 'closed';
const refunding = 'refunding';
const refunded = 'refunded';

/** 订单状态集合（键即状态值，便于枚举遍历） */
const ORDER_STATUS = {
  pendingPayment,
  pendingAccept,
  accepted,
  inService,
  pendingConfirm,
  completed,
  cancelled,
  closed,
  refunding,
  refunded,
};

/** 全部合法状态值 */
const ALL_STATUSES = Object.values(ORDER_STATUS);

/** 状态 → 中文文案 */
const STATUS_TEXT = {
  pendingPayment: '待支付',
  pendingAccept: '待接单',
  accepted: '已接单',
  inService: '服务中',
  pendingConfirm: '待确认',
  completed: '已完成',
  cancelled: '已取消',
  closed: '已关闭',
  refunding: '退款中',
  refunded: '已退款',
};

/**
 * 状态 → 徽章类（样式决策）
 * ---------------------------------------------------------------------------
 * 取值**必须**是 components.wxss 里真实存在的类名后缀，否则样式丢失：
 *   .dipi-badge--pending   warning-100 / warning-700
 *   .dipi-badge--confirmed info-100    / info-700
 *   .dipi-badge--ongoing   brand-100   / brand-700
 *   .dipi-badge--review    accent-100  / accent-700
 *   .dipi-badge--refunding accent-100  / accent-700
 *   .dipi-badge--done      success-100 / success-700
 *   .dipi-badge--closed    ink-100     / ink-500
 *   .dipi-badge--refund    error-100   / error-700
 *   .dipi-badge--dispute   error-100   / error-700
 *
 * 多个状态共用一个 badge（按视觉紧迫度归并），语义靠 status（语义身份）/ statusText 区分。
 */
const STATUS_BADGE = {
  pendingPayment: 'pending',      // 还没确认，有时限 → warning
  pendingAccept: 'pending',       // 还没确认，有时限 → warning
  accepted: 'ongoing',            // 已确认，等开始 → brand
  inService: 'ongoing',           // 在推进中 → brand
  pendingConfirm: 'review',       // 等你行动（暖色＝行动召唤）→ accent
  completed: 'done',              // 顺利完成 → success
  cancelled: 'closed',            // 已结束 → ink
  closed: 'closed',               // 已结束 → ink
  refunding: 'refunding',         // 等你关注 → accent
  refunded: 'closed',             // 已结束 → ink
};

/**
 * 徽章类 → 功能色语义
 * ---------------------------------------------------------------------------
 * 与 components.wxss 的实际配色严格一致（statusTone 是「色弱 / 单色模式」
 * 的第二重信息，必须与徽章底色同色系，否则两个通道会互相矛盾）。
 */
const BADGE_TONE = {
  pending: 'warning',
  confirmed: 'info',
  ongoing: 'brand',
  review: 'accent',
  refunding: 'accent',
  done: 'success',
  closed: 'ink',
  refund: 'error',
  dispute: 'error',
};

/** 状态 → 功能色语义（由徽章类推导，保证两通道一致） */
const STATUS_TONE = Object.fromEntries(
  Object.entries(STATUS_BADGE).map(([status, badge]) => [status, BADGE_TONE[badge]])
);

/**
 * 状态 → 用户可执行操作标志
 * @param {string} status camelCase 状态码
 */
function statusFlags(status) {
  return {
    canUserPay: status === pendingPayment,
    canUserCancel: [pendingPayment, pendingAccept, accepted].includes(status),
    canUserConfirm: [inService, pendingConfirm].includes(status),
    canUserRefund: [
      pendingAccept, accepted, inService, pendingConfirm, completed,
    ].includes(status),
    canUserContact: ![cancelled, closed, refunded].includes(status),
    canUserReview: status === completed,
  };
}

/** 用户可执行动作的固定顺序 */
const USER_ACTION_ORDER = ['pay', 'cancel', 'confirm', 'refund', 'contact', 'review'];

/**
 * 状态 → 用户可执行动作列表
 * ---------------------------------------------------------------------------
 * 与 6 个 canUserXxx **同源生成**（同一份 statusFlags），
 * 值域固定为：pay / cancel / confirm / refund / contact / review。
 * 不包含地陪侧动作（accept / start / finish / close / refund:approve / refund:reject），
 * 那些是状态机内部迁移，前端不应感知。
 * @param {string} status camelCase 状态码
 * @returns {string[]}
 */
function allowedUserActions(status) {
  const f = statusFlags(status);
  const map = {
    pay: f.canUserPay,
    cancel: f.canUserCancel,
    confirm: f.canUserConfirm,
    refund: f.canUserRefund,
    contact: f.canUserContact,
    review: f.canUserReview,
  };
  return USER_ACTION_ORDER.filter((a) => map[a]);
}

/**
 * 生成订单的状态视图字段
 * @param {string} status camelCase 状态码
 */
function statusView(status) {
  return {
    status,                       // 语义身份（与 ?status= 过滤参数同名对齐）
    statusText: STATUS_TEXT[status] || status,
    statusBadge: STATUS_BADGE[status] || 'closed',
    statusTone: STATUS_TONE[status] || 'ink',
    ...statusFlags(status),
    allowedActions: allowedUserActions(status),
  };
}

/** 计费单位枚举（hour|session|day|person） */
const UNIT_TEXT = {
  hour: '小时',
  session: '次',
  trip: '次',
  person: '人次',
  day: '天',
};

/** 内部 unit → 对外 priceUnit */
const UNIT_ENUM = {
  hour: 'hour',
  trip: 'session',
  person: 'person',
  day: 'day',
};

module.exports = {
  ORDER_STATUS,
  ALL_STATUSES,
  STATUS_TEXT,
  STATUS_BADGE,
  STATUS_TONE,
  BADGE_TONE,
  UNIT_TEXT,
  UNIT_ENUM,
  statusFlags,
  statusView,
  allowedUserActions,
  USER_ACTION_ORDER,
  // 单个状态常量：便于调用方免点号直接引用
  pendingPayment,
  pendingAccept,
  accepted,
  inService,
  pendingConfirm,
  completed,
  cancelled,
  closed,
  refunding,
  refunded,
};
