'use strict';

/**
 * 订单状态机
 * ---------------------------------------------------------------------------
 * 【契约收敛】状态码统一 camelCase，10 态，与 UX 规范 §D.3 一致。
 *
 * 合法迁移表：current → { action: next }
 *   - `cancel` 在「已支付」状态下进入 refunding（用户取消 → 自动退款）
 *   - `confirm` 同时允许从 inService 与 pendingConfirm 进入 completed
 *   - `refund:reject` 动态回到 refundFromStatus（驳回前的原状态）
 *
 * 任何不在表内的动作一律抛 409（code 40901）。
 */

const { conflictOrderStatus } = require('../utils/errors');
const {
  STATUS_TEXT, allowedUserActions,
  pendingPayment, pendingAccept, accepted, inService, pendingConfirm,
  completed, cancelled, closed, refunding, refunded,
} = require('../models/statusMap');

/** 合法迁移表 */
const TRANSITIONS = {
  [pendingPayment]: {
    pay: pendingAccept,
    cancel: cancelled,
    close: closed,            // 超时未支付 → 已关闭
  },
  [pendingAccept]: {
    accept: accepted,
    cancel: refunding,        // 已支付，用户取消 → 自动退款
    close: closed,            // 地陪拒单 / 超时未接单
    refund: refunding,
  },
  [accepted]: {
    start: inService,
    cancel: refunding,        // 已支付，用户取消 → 自动退款
    refund: refunding,
  },
  [inService]: {
    finish: pendingConfirm,
    confirm: completed,       // 用户直接确认完成
    refund: refunding,
  },
  [pendingConfirm]: {
    confirm: completed,
    refund: refunding,
  },
  [completed]: {
    refund: refunding,        // 完成后 7 天内售后
  },
  [refunding]: {
    'refund:approve': refunded,
    'refund:reject': null,    // 动态：回到 refundFromStatus
  },
  [cancelled]: {},
  [closed]: {},
  [refunded]: {},
};

/** 动作中文文案 */
const ACTION_TEXT = {
  pay: '支付',
  cancel: '取消订单',
  accept: '接单',
  start: '开始服务',
  finish: '结束服务',
  confirm: '确认完成',
  close: '关闭订单',
  refund: '申请退款',
  'refund:approve': '同意退款',
  'refund:reject': '驳回退款',
  review: '评价',
};

/** 用户可执行的动作 */
const USER_ACTIONS = ['pay', 'cancel', 'confirm', 'refund', 'review'];
/** 地陪可执行的动作 */
const GUIDE_ACTIONS = ['accept', 'start', 'finish', 'close', 'refund:approve', 'refund:reject'];

/**
 * 判断某状态是否允许某动作
 */
function canTransition(status, action) {
  const map = TRANSITIONS[status];
  return !!(map && Object.prototype.hasOwnProperty.call(map, action));
}

/**
 * 状态机内部允许的迁移动作（含地陪侧动作）
 * ---------------------------------------------------------------------------
 * 这是**服务端内部**使用；对外下发给客户端的是 statusMap.allowedUserActions()，
 * 值域只有 pay/cancel/confirm/refund/contact/review。
 */
function machineActions(status) {
  return Object.keys(TRANSITIONS[status] || {});
}

/**
 * 执行一次状态迁移判定（纯函数，不落库）
 * @param {object} order
 * @param {string} action
 * @returns {{ok:true,next:string}|{ok:false,message:string,allowed:string[]}}
 */
function transition(order, action) {
  const status = order.status;
  const allowed = machineActions(status);

  if (!allowed.includes(action)) {
    const statusText = STATUS_TEXT[status] || status;
    const actionText = ACTION_TEXT[action] || action;
    const terminal = allowed.length === 0;
    const message = terminal
      ? `订单当前为「${statusText}」，${actionText}操作不可执行`
      : `订单当前为「${statusText}」，不支持${actionText}操作`;
    return { ok: false, message, allowed };
  }

  return { ok: true, next: TRANSITIONS[status][action] };
}

/**
 * 断言迁移合法，否则抛 409（code 40901）
 * @returns {string} 目标状态
 */
function assertTransition(order, action) {
  const res = transition(order, action);
  if (!res.ok) {
    const status = order.status;
    throw conflictOrderStatus(res.message, {
      currentStatus: status,
      currentStatusText: STATUS_TEXT[status] || status,
      action,
      allowedActions: allowedUserActions(status),
    });
  }
  return res.next;
}

module.exports = {
  TRANSITIONS,
  ACTION_TEXT,
  USER_ACTIONS,
  GUIDE_ACTIONS,
  canTransition,
  machineActions,
  transition,
  assertTransition,
};
