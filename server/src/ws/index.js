'use strict';

/**
 * WebSocket 服务
 * ---------------------------------------------------------------------------
 * 【契约收敛】消息体统一 { type, payload, ts }，事件类型严格对齐 UX 规范 §C.1.3。
 *
 * 连接：ws://<host>/ws?token=<token>
 *
 * 客户端 → 服务端：
 *   { type:'message.send',      payload:{ conversationId, content, messageType?, clientMessageId } }
 *   { type:'conversation.read', payload:{ conversationId } }
 *   { type:'ping',              payload:{ ts } }
 *
 * 服务端 → 客户端：
 *   { type:'connected',                payload:{ serverTime, userId, role, clientId } }
 *   { type:'message.new',              payload:{ conversationId, message } }
 *   { type:'message.read',             payload:{ conversationId, seq } }
 *   { type:'conversation.unreadChanged', payload:{ conversationId, unreadCount, total } }
 *   { type:'conversation.updated',     payload:{ conversation } }
 *   { type:'order.statusChanged',      payload:{ orderId, status, statusText, order } }
 *   { type:'notification.new',         payload:{ notification } }
 *   { type:'pong',                     payload:{ ts, serverTime } }
 *   { type:'error',                    payload:{ code, message } }
 *
 * 消息必须带 seq（会话内单调递增），客户端按 seq 排序与去重；
 * 客户端发送带 clientMessageId，用于幂等去重与失败重发
 * —— 发送成功后服务端会把该消息以 message.new 回推（含 clientMessageId），
 *    客户端据此把本地 sending 气泡置为 sent。
 *
 * 心跳：服务端每 30s 巡检一次，客户端 ping → 服务端 pong；90s 无响应主动断开。
 * 重连与补发策略见 docs/03-api-contract.md §5.5。
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const config = require('../config');
const store = require('../db/store');
const { verifyToken } = require('../utils/token');
const conversationService = require('../services/conversationService');
const notificationService = require('../services/notificationService');
const bus = require('../services/eventBus');
const { EVENTS } = bus;

/** @type {Map<string, {ws:import('ws').WebSocket, userId:string, role:string, guideId:string|null, alive:boolean}>} */
const clients = new Map();

/** 鉴权：token → 用户 */
function authenticate(req) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const result = verifyToken(token);
  if (!result.ok) return null;
  const user = store.findById('users', result.payload.sub);
  if (!user) return null;
  return { id: user.id, role: user.role, guideId: user.guideId || null };
}

/** 发送事件：信封固定 { type, payload, ts } */
function send(ws, type, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  } catch (err) {
    console.error('[ws] 发送失败:', err.message);
  }
}

/** 向指定用户的全部连接推送 */
function pushToUser(userId, type, payload) {
  for (const client of clients.values()) {
    if (client.userId === userId) send(client.ws, type, payload);
  }
}

/**
 * 挂载 WS 服务到 HTTP server（同端口）
 * @param {import('http').Server} server
 */
function attachWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: config.ws.maxPayloadBytes,
  });

  wss.on('connection', (ws, req) => {
    const user = authenticate(req);
    if (!user) {
      send(ws, 'error', { code: 40100, message: '鉴权失败，请重新登录' });
      ws.close(4001, 'unauthorized');
      return;
    }

    const clientId = crypto.randomBytes(8).toString('hex');
    clients.set(clientId, {
      ws, userId: user.id, role: user.role, guideId: user.guideId, alive: true,
    });

    console.log(`[ws] 客户端接入 ${clientId} user=${user.id} role=${user.role}`);
    send(ws, 'connected', {
      serverTime: new Date().toISOString(),
      userId: user.id,
      role: user.role,
      clientId,
    });

    ws.on('pong', () => {
      const c = clients.get(clientId);
      if (c) c.alive = true;
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        send(ws, 'error', { code: 40002, message: '消息不是合法 JSON' });
        return;
      }
      handleMessage(clientId, ws, msg);
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[ws] 客户端断开 ${clientId}`);
    });

    ws.on('error', (err) => {
      console.error(`[ws] 连接错误 ${clientId}:`, err.message);
    });
  });

  // 心跳巡检
  const timer = setInterval(() => {
    for (const [clientId, client] of clients) {
      if (!client.alive) {
        console.log(`[ws] 心跳超时，断开 ${clientId}`);
        client.ws.terminate();
        clients.delete(clientId);
        continue;
      }
      client.alive = false;
      try {
        client.ws.ping();
      } catch (err) {
        console.error(`[ws] ping 失败 ${clientId}:`, err.message);
      }
    }
  }, config.ws.heartbeatIntervalMs);
  if (timer.unref) timer.unref();

  // 订阅业务事件 → 推送到对应用户
  bus.on(EVENTS.NEW_MESSAGE, (payload) => {
    pushToUser(payload.userId, 'message.new', {
      conversationId: payload.conversationId,
      message: payload.message,
    });
  });

  bus.on(EVENTS.ORDER_STATUS, (payload) => {
    const order = payload.order;
    pushToUser(payload.userId, 'order.statusChanged', {
      orderId: order.orderId,
      status: order.status,
      statusText: order.statusText,
      order,
    });
  });

  bus.on(EVENTS.CONVERSATION_READ, (payload) => {
    const total = conversationService.unreadCount(payload.userId);
    pushToUser(payload.userId, 'conversation.unreadChanged', {
      conversationId: payload.conversationId,
      unreadCount: payload.unreadCount,
      total,
    });
  });

  bus.on(EVENTS.NEW_NOTICE, (payload) => {
    pushToUser(payload.userId, 'notification.new', {
      notification: notificationService.toView(payload.notification),
    });
  });

  bus.on(EVENTS.CONVERSATION_UPDATED, (payload) => {
    pushToUser(payload.userId, 'conversation.updated', {
      conversation: payload.conversation,
    });
  });

  bus.on(EVENTS.MESSAGE_READ, (payload) => {
    pushToUser(payload.userId, 'message.read', {
      conversationId: payload.conversationId,
      seq: payload.seq,
    });
  });

  return wss;
}

/**
 * 处理客户端上行消息
 */
function handleMessage(clientId, ws, msg) {
  const client = clients.get(clientId);
  if (!client) return;
  const { type, payload = {} } = msg;

  switch (type) {
    case 'ping': {
      send(ws, 'pong', { ts: payload.ts || Date.now(), serverTime: new Date().toISOString() });
      break;
    }

    case 'message.send': {
      try {
        const conv = conversationService.assertOwnership(payload.conversationId, {
          id: client.userId,
        });
        const guide = store.findById('guides', conv.guideId);
        const created = conversationService.createMessage(conv, {
          from: client.userId,
          to: guide ? `guide_${conv.guideId}` : conv.guideId,
          content: payload.content,
          type: payload.messageType || 'text',
          clientMessageId: payload.clientMessageId || null,
        });
        const view = conversationService.toMessageView(created);

        // 回推给会话参与方（含发送者本人；客户端凭 clientMessageId 把本地气泡置 sent）
        bus.emit(EVENTS.NEW_MESSAGE, {
          conversationId: conv.id,
          userId: conv.userId,
          guideId: conv.guideId,
          message: view,
        });
        bus.emit(EVENTS.CONVERSATION_UPDATED, {
          userId: conv.userId,
          conversation: conversationService.toView(conv, conv.userId),
        });
      } catch (err) {
        send(ws, 'error', {
          code: err.code || 40000,
          message: err.message || '消息发送失败',
        });
      }
      break;
    }

    case 'conversation.read': {
      try {
        const conv = conversationService.assertOwnership(payload.conversationId, {
          id: client.userId,
        });
        conversationService.markRead(conv.id);
        bus.emit(EVENTS.CONVERSATION_READ, {
          userId: client.userId,
          conversationId: conv.id,
          unreadCount: 0,
        });
        bus.emit(EVENTS.MESSAGE_READ, {
          userId: conv.userId,
          conversationId: conv.id,
          seq: conv.seq || 0,
        });
      } catch (err) {
        send(ws, 'error', { code: err.code || 40000, message: err.message || '操作失败' });
      }
      break;
    }

    default:
      send(ws, 'error', { code: 40002, message: `未知的消息类型：${type}` });
  }
}

/** 关闭所有连接（优雅退出用） */
function closeAll() {
  for (const client of clients.values()) {
    try {
      client.ws.close(1001, 'server shutdown');
    } catch (err) {
      /* 忽略关闭异常 */
    }
  }
  clients.clear();
}

module.exports = { attachWebSocket, pushToUser, closeAll, clients };
