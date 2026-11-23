/**
 * 随行 dipi · WebSocket 封装
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 连接 / 断开 / 生命周期管理（单例，避免多连接泄漏）
 *   2. 心跳（25s 一次；45s 未响应判定断开）
 *   3. 断线指数退避重连：1s → 2s → 4s → 8s → 15s → 30s（封顶 30s，每档 ±20% 抖动）
 *   4. 60s 未连上 → 降级为 15s 轮询
 *   5. 事件订阅 / 退订（按 type 分发）
 *   6. seq 去重（每会话单调递增 seq；按 messageId + seq 双重去重）
 *   7. 未读数同步（conversation.unreadChanged → app.globalData.unreadTotal → TabBar 角标）
 *
 * 【协议】服务端推送 { type, payload, ts }
 *   为兼容服务端实现差异，同时兼容 { type, data, ts } 与
 *   order.status / order.statusChanged、notice.new / notification.new 等别名。
 */
const config = require('../config/index');
const storage = require('./storage');
const { WS_STATE } = require('./constants');

/** 事件类型归一化：把服务端可能出现的别名映射到契约标准名 */
const EVENT_ALIAS = {
  'order.status': 'order.statusChanged',
  'order.statusChanged': 'order.statusChanged',
  'notice.new': 'notification.new',
  'notification.new': 'notification.new',
  'message.new': 'message.new',
  'message.read': 'message.read',
  'conversation.read': 'conversation.unreadChanged',
  'conversation.unreadChanged': 'conversation.unreadChanged',
  'conversation.updated': 'conversation.updated',
  'connected': 'connected',
  'pong': 'pong',
};

class DipiSocket {
  constructor() {
    /** @type {WebSocket|null} */
    this.socket = null;
    /** 当前状态 */
    this.state = WS_STATE.CONNECTING;
    /** 已重连次数 */
    this.retryCount = 0;
    /** 重连定时器 */
    this.retryTimer = null;
    /** 心跳定时器 */
    this.heartbeatTimer = null;
    /** 心跳超时定时器 */
    this.heartbeatTimeoutTimer = null;
    /** 是否主动断开（主动断开不重连） */
    this.manualClose = false;
    /** 首次连接失败的时间戳（用于 60s 降级轮询判定） */
    this.firstFailAt = 0;
    /** 轮询定时器 */
    this.pollTimer = null;
    /** 轮询回调（由页面注册：拉取增量消息） */
    this.pollHandler = null;
    /** 事件订阅表：type → Set<handler> */
    this.listeners = {};
    /** seq 去重表：conversationId → Set<seq> */
    this.seenSeq = {};
    /** 最近一次收到消息的时间 */
    this.lastActiveAt = 0;
  }

  /**
   * 连接（幂等：已连接直接返回）
   * @returns {Promise<void>}
   */
  connect() {
    if (this.socket && (this.state === WS_STATE.CONNECTED || this.state === WS_STATE.CONNECTING)) {
      return Promise.resolve();
    }
    const token = storage.getToken();
    if (!token) {
      this.setState(WS_STATE.OFFLINE);
      return Promise.resolve();
    }
    this.manualClose = false;
    this.setState(this.retryCount > 0 ? WS_STATE.RECONNECTING : WS_STATE.CONNECTING);

    const url = config.WS_URL + '?token=' + encodeURIComponent(token);
    let sock = null;
    try {
      sock = wx.connectSocket({ url: url, fail: () => {} });
    } catch (e) {
      this.scheduleReconnect();
      return Promise.resolve();
    }
    this.socket = sock;

    return new Promise((resolve) => {
      sock.onOpen(() => {
        this.retryCount = 0;
        this.firstFailAt = 0;
        this.stopPolling();
        this.setState(WS_STATE.CONNECTED);
        this.startHeartbeat();
        this.emit('connected', { serverTime: new Date().toISOString() });
        resolve();
      });

      sock.onMessage((res) => {
        this.handleMessage(res);
      });

      sock.onClose(() => {
        this.socket = null;
        this.stopHeartbeat();
        if (!this.manualClose) {
          this.scheduleReconnect();
        } else {
          this.setState(WS_STATE.OFFLINE);
        }
      });

      sock.onError(() => {
        this.socket = null;
        this.stopHeartbeat();
        if (!this.manualClose) {
          this.scheduleReconnect();
        }
      });
    });
  }

  /**
   * 主动断开（离开聊天页时调用）
   */
  close() {
    this.manualClose = true;
    this.retryCount = 0;
    this.firstFailAt = 0;
    this.stopHeartbeat();
    this.stopPolling();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close({ code: 1000, reason: 'client closed' });
      } catch (e) {
        /* 忽略 */
      }
      this.socket = null;
    }
    this.setState(WS_STATE.OFFLINE);
  }

  /**
   * 发送消息
   * @param {string} type 消息类型
   * @param {object} data 负载
   */
  send(type, data) {
    if (!this.socket || this.state !== WS_STATE.CONNECTED) return false;
    try {
      this.socket.send({
        data: JSON.stringify({ type: type, data: data || {}, payload: data || {} }),
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 订阅事件
   * @param {string} type 事件类型
   * @param {function} handler 回调
   */
  on(type, handler) {
    const key = EVENT_ALIAS[type] || type;
    if (!this.listeners[key]) this.listeners[key] = [];
    if (this.listeners[key].indexOf(handler) < 0) {
      this.listeners[key].push(handler);
    }
  }

  /**
   * 退订事件
   * @param {string} type 事件类型
   * @param {function} handler 回调
   */
  off(type, handler) {
    const key = EVENT_ALIAS[type] || type;
    const list = this.listeners[key];
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * 注册轮询回调（WS 降级时由页面拉增量）
   * @param {function} handler 回调
   */
  setPollHandler(handler) {
    this.pollHandler = handler;
  }

  /**
   * 处理服务端推送
   * @param {object} res onMessage 事件
   */
  handleMessage(res) {
    this.lastActiveAt = Date.now();
    let payload = null;
    try {
      payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } catch (e) {
      return;
    }
    if (!payload || !payload.type) return;

    const type = EVENT_ALIAS[payload.type] || payload.type;
    const body = payload.payload || payload.data || {};

    // 心跳响应
    if (type === 'pong') {
      this.clearHeartbeatTimeout();
      return;
    }

    // 消息去重（按 conversationId + seq）
    if (type === 'message.new' && body.message) {
      const cid = body.conversationId || (body.message && body.message.conversationId) || '';
      const seq = body.message.seq;
      if (cid && seq !== undefined && seq !== null) {
        if (!this.seenSeq[cid]) this.seenSeq[cid] = [];
        if (this.seenSeq[cid].indexOf(seq) >= 0) {
          return; // 重复消息，丢弃
        }
        this.seenSeq[cid].push(seq);
        // 只保留最近 500 个 seq，防止内存无限增长
        if (this.seenSeq[cid].length > 500) {
          this.seenSeq[cid] = this.seenSeq[cid].slice(-500);
        }
      }
    }

    this.emit(type, body);
  }

  /**
   * 触发事件
   * @param {string} type 事件类型
   * @param {object} body 负载
   */
  emit(type, body) {
    const list = this.listeners[type];
    if (!list || !list.length) return;
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](body);
      } catch (e) {
        console.error('[ws] 事件处理异常', type, e);
      }
    }
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('ping', { ts: Date.now() });
      this.heartbeatTimeoutTimer = setTimeout(() => {
        // 45s 未收到 pong → 判定连接已死，主动断开触发重连
        try {
          if (this.socket) this.socket.close({ code: 4000, reason: 'heartbeat timeout' });
        } catch (e) {
          /* 忽略 */
        }
      }, config.WS_HEARTBEAT_TIMEOUT);
    }, config.WS_HEARTBEAT_INTERVAL);
  }

  /** 停止心跳 */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  /** 清除心跳超时定时器 */
  clearHeartbeatTimeout() {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 安排重连（指数退避 + 抖动）
   */
  scheduleReconnect() {
    if (this.manualClose) return;
    if (this.retryTimer) return;

    const now = Date.now();
    if (!this.firstFailAt) this.firstFailAt = now;

    const steps = config.WS_RECONNECT_STEPS;
    const step = steps[Math.min(this.retryCount, steps.length - 1)];
    // ±20% 抖动
    const jitter = step * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(500, Math.round(step + jitter));

    this.retryCount += 1;
    this.setState(WS_STATE.RECONNECTING);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // 60s 未连上 → 降级为轮询模式
      if (now - this.firstFailAt >= config.WS_POLLING_THRESHOLD) {
        this.startPolling();
      }
      this.connect();
    }, delay);
  }

  /**
   * 启动降级轮询
   */
  startPolling() {
    if (this.pollTimer) return;
    this.setState(WS_STATE.POLLING);
    this.pollTimer = setInterval(() => {
      if (this.pollHandler) {
        try {
          this.pollHandler();
        } catch (e) {
          console.error('[ws] 轮询回调异常', e);
        }
      }
    }, config.WS_POLLING_INTERVAL);
  }

  /** 停止降级轮询 */
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 设置状态并广播
   * @param {string} state 新状态
   */
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('stateChanged', { state: state, retryCount: this.retryCount });
  }

  /**
   * 当前是否可用
   * @returns {boolean}
   */
  isConnected() {
    return this.state === WS_STATE.CONNECTED;
  }
}

/** 单例 */
const socket = new DipiSocket();

module.exports = socket;
module.exports.DipiSocket = DipiSocket;
module.exports.EVENT_ALIAS = EVENT_ALIAS;
