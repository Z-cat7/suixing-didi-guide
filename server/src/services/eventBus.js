'use strict';

/**
 * 事件总线
 * ---------------------------------------------------------------------------
 * HTTP 路由通过它向 WebSocket 层广播事件，避免路由层与 WS 层互相依赖。
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** 事件名常量 */
const EVENTS = {
  ORDER_STATUS: 'order.status',
  NEW_MESSAGE: 'message.new',
  CONVERSATION_READ: 'conversation.read',
  CONVERSATION_UPDATED: 'conversation.updated',
  MESSAGE_READ: 'message.read',
  NEW_NOTICE: 'notice.new',
};

module.exports = bus;
module.exports.EVENTS = EVENTS;
