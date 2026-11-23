/**
 * 聊天页
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET  /api/v1/conversations/:conversationId/messages —— 历史消息（倒序返回，前端反转）
 *   POST /api/v1/conversations/:conversationId/messages —— 发送消息
 *   POST /api/v1/conversations/:conversationId/read      —— 标记已读
 *   POST /api/v1/conversations                          —— 无 conversationId 时建会话
 *
 * WS 事件：message.new（追加消息 + seq 去重）/ conversation.unreadChanged / order.statusChanged
 *
 * 【关键约束】
 *   - 消息先本地插入（sending）→ 失败转 failed + 感叹号；重发复用同一 clientMessageId
 *   - sending 状态禁止并发重发；空内容/纯空格发送按钮禁用
 *   - 离线草稿：输入/失焦/onHide 三处落盘；恢复后回填但不自动发送
 *   - 未读定位：命中 firstUnreadSeq → 滚动至上方 1/3 处 + 高亮 3s + 「以下为新消息」分隔
 *   - 上滑加载更早消息：前插并补偿滚动位置，不产生跳动
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const ws = require('../../utils/ws');
const format = require('../../utils/format');
const { ROUTES, SENDER_TYPE, MESSAGE_TYPE, WS_STATE } = require('../../utils/constants');

Page({
  data: {
    /** 会话 ID */
    conversationId: '',
    /** 对端地陪 */
    guideId: '',
    guideName: '',
    guideAvatarUrl: '',
    guideInitial: '伴',
    /** 关联订单 */
    linkedOrder: null,
    /** 会话是否可继续沟通 */
    isActive: true,
    /** 关闭提示 */
    closedNotice: '',
    /** 消息列表 */
    messages: [],
    /** 加载中 */
    loading: true,
    /** 错误 */
    error: '',
    /** 错误类型：load / forbidden */
    errorType: 'load',
    /** 加载更早消息中 */
    loadingMore: false,
    /** 还有更早消息 */
    hasMoreHistory: true,
    /** 已加载到顶 */
    historyFinished: false,
    /** 历史页码 */
    historyPage: 1,
    /** 输入框内容 */
    inputText: '',
    /** 输入框占位 */
    inputPlaceholder: '发消息…',
    /** 是否可发送 */
    canSend: false,
    /** 输入栏禁用（会话已关闭） */
    inputDisabled: false,
    /** 未读定位锚点 */
    firstUnreadSeq: null,
    /** 已收到的最大 seq（补拉游标） */
    lastSeq: 0,
    /** 新消息浮标数量 */
    newMessageCount: 0,
    /** 滚动位置（前插补偿用） */
    scrollTop: 0,
    /** WS 提示条 */
    wsNotice: '',
    wsNoticeType: 'warning',
    /** 建议话术 */
    suggestQuestions: ['能帮我推荐一顿本地菜？', '明天有空吗？', '大概要花多少钱？'],
    /** 离线 */
    offline: false,
  },

  /** 消息区高度（用于定位） */
  _scrollHeight: 0,
  /** 消息内容总高度（前插补偿用） */
  _contentHeight: 0,
  /** 当前滚动位置 */
  _scrollTop: 0,
  /** 是否已滚动到底部 */
  _atBottom: true,

  onLoad: function (options) {
    const opts = options || {};
    const conversationId = opts.conversationId || '';
    const guideId = opts.guideId || '';
    const firstUnreadSeq = opts.firstUnreadSeq ? Number(opts.firstUnreadSeq) : null;

    this.setData({
      conversationId: conversationId,
      guideId: guideId,
      firstUnreadSeq: firstUnreadSeq,
    });

    if (conversationId) {
      this.loadConversation();
      this.loadHistory(true);
      this.connectWs();
    } else if (guideId) {
      this.createConversation(guideId);
    } else {
      this.setData({ loading: false, error: 'not_found', errorType: 'forbidden' });
    }
  },

  onReady: function () {
    // 记录消息区高度，用于未读定位与滚动补偿
    const self = this;
    wx.createSelectorQuery()
      .select('.chat__scroll')
      .boundingClientRect(function (rect) {
        if (rect) self._scrollHeight = rect.height;
      })
      .exec();
  },

  /**
   * 滚动监听：判断用户是否在底部附近 + 记录滚动位置
   * @param {object} e 事件
   */
  onScroll: function (e) {
    const scrollTop = e.detail.scrollTop;
    const scrollHeight = e.detail.scrollHeight;
    const viewHeight = this._scrollHeight || 0;
    this._scrollTop = scrollTop;
    // 距底部 60px 以内视为「在底部」
    this._atBottom = scrollHeight - scrollTop - viewHeight < 60;
    if (this._atBottom && this.data.newMessageCount > 0) {
      this.setData({ newMessageCount: 0 });
    }
  },

  onShow: function () {
    // 前台恢复：若 WS 非 connected → 立刻尝试重连一次
    if (!ws.isConnected()) {
      this.connectWs();
    }
  },

  onHide: function () {
    // 离开时保存草稿（防进程被杀）
    this.saveDraft();
  },

  onUnload: function () {
    this.saveDraft();
    // 退订 WS 事件
    ws.off('message.new', this._onMessageNew);
    ws.off('conversation.unreadChanged', this._onUnreadChanged);
    ws.off('order.statusChanged', this._onOrderStatusChanged);
    ws.off('stateChanged', this._onWsState);
    this._onMessageNew = null;
    this._onUnreadChanged = null;
    this._onOrderStatusChanged = null;
    this._onWsState = null;
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
    if (!online) {
      this.setWsNotice('网络连接已断开，消息将无法发送', 'warning');
      this.saveDraft();
    }
  },

  /**
   * 连接 WS 并订阅事件
   */
  connectWs: function () {
    const self = this;
    this._onMessageNew = function (payload) {
      self.handleMessageNew(payload);
    };
    this._onUnreadChanged = function (payload) {
      self.handleUnreadChanged(payload);
    };
    this._onOrderStatusChanged = function (payload) {
      self.handleOrderStatusChanged(payload);
    };
    this._onWsState = function (payload) {
      self.handleWsState(payload);
    };

    ws.on('message.new', this._onMessageNew);
    ws.on('conversation.unreadChanged', this._onUnreadChanged);
    ws.on('order.statusChanged', this._onOrderStatusChanged);
    ws.on('stateChanged', this._onWsState);

    // 注册降级轮询回调（WS 60s 未连上时）
    ws.setPollHandler(function () {
      self.pollNewMessages();
    });

    ws.connect();
  },

  /**
   * WS 状态变化 → 提示条文案分三档
   * @param {object} payload { state, retryCount }
   */
  handleWsState: function (payload) {
    const state = payload.state;
    const retryCount = payload.retryCount || 0;
    if (state === WS_STATE.CONNECTED) {
      this.setWsNotice('');
      // 重连成功后按 lastSeq 补拉
      this.pollNewMessages();
    } else if (state === WS_STATE.RECONNECTING) {
      let text = '连接已断开，正在重连…';
      if (retryCount >= 3) text = '连接已断开，正在重连…（第 ' + retryCount + ' 次）';
      this.setWsNotice(text, 'warning');
    } else if (state === WS_STATE.POLLING) {
      this.setWsNotice('网络不稳定，已切换为轮询更新', 'warning');
    } else if (state === WS_STATE.OFFLINE) {
      this.setWsNotice('网络连接已断开，消息将无法发送', 'warning');
    }
  },

  /**
   * 设置 WS 提示条
   * @param {string} text 文案（空则隐藏）
   * @param {string} type 提示条类型
   */
  setWsNotice: function (text, type) {
    this.setData({ wsNotice: text, wsNoticeType: type || 'warning' });
  },

  /**
   * 创建会话（无 conversationId 时）
   * @param {string} guideId 地陪 ID
   */
  createConversation: function (guideId) {
    const self = this;
    api
      .createConversation({ guideId: guideId })
      .then((data) => {
        if (!data || !data.conversationId) {
          self.setData({ loading: false, error: 'load_failed' });
          return;
        }
        self.setData({ conversationId: data.conversationId });
        // 用 replace 改写当前 URL，避免返回时回到错误页面
        wx.redirectTo({
          url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(data.conversationId),
        });
      })
      .catch(() => {
        self.setData({ loading: false, error: 'load_failed' });
      });
  },

  /**
   * 拉取会话详情（地陪信息 / 是否可沟通）
   */
  loadConversation: function () {
    const self = this;
    api
      .getConversation(this.data.conversationId)
      .then((data) => {
        if (!data) return;
        const name = data.guideName || '地陪';
        self.setData({
          guideId: data.guideId || self.data.guideId,
          guideName: name,
          guideAvatarUrl: data.guideAvatarUrl || '',
          guideInitial: name.charAt(0),
          isActive: data.isActive !== false,
          linkedOrder: data.linkedOrderStatus
            ? { orderId: data.linkedOrderId, status: data.linkedOrderStatus }
            : null,
          closedNotice: data.isActive === false ? data.closedReason || '订单已完成，无法继续沟通' : '',
          inputDisabled: data.isActive === false,
          inputPlaceholder: '给 ' + name + ' 发消息',
        });
        wx.setNavigationBarTitle({ title: name.length > 8 ? name.slice(0, 8) : name });
      })
      .catch(() => {
        /* 会话详情失败不阻断消息加载 */
      });
  },

  /**
   * 拉取历史消息
   * @param {boolean} reset 是否重置
   */
  loadHistory: function (reset) {
    const self = this;
    if (reset) {
      this.setData({ loading: true, error: '' });
    }
    return api
      .getMessages(this.data.conversationId, { page: 1, pageSize: 20 })
      .then((data) => {
        if (!data) {
          self.setData({ loading: false });
          return;
        }
        const list = (data.list || []).slice().reverse(); // 倒序返回 → 反转成升序
        const messages = list.map(function (m) {
          return api.normalizeMessage(m);
        });
        self.setData({
          loading: false,
          error: '',
          messages: messages,
          historyPage: 1,
          hasMoreHistory: !!data.hasMore,
          historyFinished: !data.hasMore,
        });
        self.updateLastSeq();
        self.markRead();
        self.restoreDraft();
        self.locateUnread();
        self.scrollToBottom();
      })
      .catch((err) => {
        const forbidden = err && err.code === 40301;
        self.setData({
          loading: false,
          error: forbidden ? 'forbidden' : 'load_failed',
          errorType: forbidden ? 'forbidden' : 'load',
        });
      });
  },

  /**
   * 上滑加载更早消息（前插 + 补偿滚动位置）
   */
  onLoadMoreHistory: function () {
    if (this.data.loadingMore || !this.data.hasMoreHistory) return;
    const self = this;
    // 记录前插前的滚动位置与内容高度
    const beforeTop = this._scrollTop || 0;
    const beforeHeight = this._contentHeight || 0;
    this.setData({ loadingMore: true });

    api
      .getMessages(this.data.conversationId, { page: this.data.historyPage + 1, pageSize: 20 })
      .then((data) => {
        if (!data) {
          self.setData({ loadingMore: false });
          return;
        }
        const older = (data.list || []).slice().reverse();
        const messages = older.concat(self.data.messages);
        self.setData({
          loadingMore: false,
          messages: messages,
          historyPage: self.data.historyPage + 1,
          hasMoreHistory: !!data.hasMore,
          historyFinished: !data.hasMore,
        });
        // 补偿滚动位置：测量新增内容高度差，向下偏移相同距离，避免视图跳动
        setTimeout(function () {
          wx.createSelectorQuery()
            .select('.chat__content')
            .boundingClientRect(function (rect) {
              if (!rect) return;
              const afterHeight = rect.height;
              self._contentHeight = afterHeight;
              const delta = afterHeight - beforeHeight;
              if (delta > 0) {
                // scroll-top 需要配合 scroll-with-animation=false 才不会动画
                self.setData({ scrollTop: beforeTop + delta });
              }
            })
            .exec();
        }, 40);
      })
      .catch(() => {
        self.setData({ loadingMore: false });
      });
  },

  /**
   * 滚动到顶部 → 加载更早消息
   */
  onScrollTop: function () {
    if (this.data.hasMoreHistory && !this.data.loadingMore) {
      this.onLoadMoreHistory();
    }
  },

  /**
   * 未读定位（从消息页进入）
   */
  locateUnread: function () {
    const anchor = this.data.firstUnreadSeq;
    if (!anchor) return;
    const messages = this.data.messages.slice();
    let found = false;
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].seq === anchor) {
        messages[i] = Object.assign({}, messages[i], { showUnreadDivider: true, highlight: true });
        found = true;
        break;
      }
    }
    if (!found) {
      // 不在已加载页内 → aroundSeq 精确拉取
      this.loadAroundSeq(anchor);
      return;
    }
    this.setData({ messages: messages });
    // 高亮 3 秒后渐隐
    setTimeout(() => {
      const list = this.data.messages.map(function (m) {
        return Object.assign({}, m, { highlight: false });
      });
      this.setData({ messages: list });
    }, 3000);
  },

  /**
   * aroundSeq 精确拉取
   * @param {number} aroundSeq 锚点 seq
   */
  loadAroundSeq: function (aroundSeq) {
    const self = this;
    api
      .getMessages(this.data.conversationId, { aroundSeq: aroundSeq })
      .then((data) => {
        if (!data) return;
        const list = (data.list || []).slice().reverse();
        const messages = list.map(function (m) {
          let divider = false;
          if (m.seq === aroundSeq) divider = true;
          return Object.assign({}, api.normalizeMessage(m), { showUnreadDivider: divider });
        });
        self.setData({ messages: messages, hasMoreHistory: false, historyFinished: true });
        self.updateLastSeq();
      })
      .catch(() => {
        /* 定位失败 → 回退到定位到最后一条 */
        self.scrollToBottom();
      });
  },

  /**
   * 更新 lastSeq（补拉游标）
   */
  updateLastSeq: function () {
    let max = this.data.lastSeq;
    this.data.messages.forEach(function (m) {
      if (m.seq && m.seq > max) max = m.seq;
    });
    if (max !== this.data.lastSeq) this.setData({ lastSeq: max });
  },

  /**
   * 标记会话已读
   */
  markRead: function () {
    if (!this.data.conversationId) return;
    api.markConversationRead(this.data.conversationId);
    const app = getApp();
    if (app.globalData.unreadTotal > 0) {
      app.setUnreadTotal(app.globalData.unreadTotal - 1);
    }
  },

  /**
   * WS 收到新消息 → 追加 + seq 去重
   * @param {object} payload { conversationId, message }
   */
  handleMessageNew: function (payload) {
    if (!payload) return;
    const cid = payload.conversationId || (payload.message && payload.message.conversationId);
    if (cid && cid !== this.data.conversationId) return;
    const message = payload.message;
    if (!message) return;

    const messages = this.data.messages.slice();
    // 按 messageId 去重（重发场景）
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].messageId === message.messageId) return;
    }
    const normalized = api.normalizeMessage(message);
    messages.push(normalized);
    this.setData({ messages: messages });
    this.updateLastSeq();

    if (this._atBottom) {
      this.scrollToBottom();
    } else {
      this.setData({ newMessageCount: this.data.newMessageCount + 1 });
    }
  },

  /**
   * WS 未读数变化
   * @param {object} payload { conversationId, unreadCount, total }
   */
  handleUnreadChanged: function (payload) {
    if (!payload) return;
    const app = getApp();
    if (typeof payload.total === 'number') {
      app.setUnreadTotal(payload.total);
    }
  },

  /**
   * WS 订单状态变化 → 更新顶部订单状态条
   * @param {object} payload { orderId, status, statusText, order }
   */
  handleOrderStatusChanged: function (payload) {
    if (!payload) return;
    const linked = this.data.linkedOrder;
    if (!linked || linked.orderId !== payload.orderId) return;
    this.setData({
      linkedOrder: { orderId: payload.orderId, status: payload.status },
    });
  },

  /**
   * 降级轮询：按 since 拉增量消息
   */
  pollNewMessages: function () {
    const self = this;
    if (!this.data.conversationId) return;
    api
      .getMessages(this.data.conversationId, { since: this.data.lastSeq })
      .then((data) => {
        if (!data || !data.list || !data.list.length) return;
        const incoming = data.list.slice().reverse();
        let messages = self.data.messages.slice();
        let changed = false;
        incoming.forEach(function (m) {
          let exists = false;
          for (let i = 0; i < messages.length; i++) {
            if (messages[i].messageId === m.messageId) {
              exists = true;
              break;
            }
          }
          if (!exists) {
            messages.push(api.normalizeMessage(m));
            changed = true;
          }
        });
        if (changed) {
          self.setData({ messages: messages });
          self.updateLastSeq();
          if (self._atBottom) self.scrollToBottom();
        }
      })
      .catch(() => {
        /* 轮询失败静默 */
      });
  },

  /* ---------------- 发送消息 ---------------- */

  /**
   * 输入
   * @param {object} e 事件
   */
  onInput: function (e) {
    const value = e.detail.value;
    this.setData({
      inputText: value,
      canSend: value.trim().length > 0 && !this.data.inputDisabled,
    });
    this.saveDraft();
  },

  /**
   * 失焦 → 保存草稿
   */
  onInputBlur: function () {
    this.saveDraft();
  },

  /**
   * 清空输入
   */
  onClearInput: function () {
    this.setData({ inputText: '', canSend: false });
    this.saveDraft();
  },

  /**
   * 点击建议话术 → 填入输入框
   * @param {object} e 事件
   */
  onSuggestionTap: function (e) {
    const text = e.currentTarget.dataset.text;
    this.setData({ inputText: text, canSend: true });
    this.saveDraft();
  },

  /**
   * 发送消息
   */
  onSend: function () {
    const text = this.data.inputText;
    if (!text || !text.trim()) return;
    if (this.data.inputDisabled) return;
    if (this.data.offline) {
      wx.showToast({ title: '网络连接已断开，消息将无法发送', icon: 'none', duration: 2000 });
      return;
    }

    const clientMessageId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const localMessage = {
      messageId: clientMessageId,
      clientMessageId: clientMessageId,
      conversationId: this.data.conversationId,
      seq: null,
      senderType: SENDER_TYPE.USER,
      messageType: MESSAGE_TYPE.TEXT,
      content: text,
      imageUrl: null,
      orderSummary: null,
      sentAt: new Date().toISOString(),
      status: 'sending',
      isRead: false,
    };

    // 先本地插入
    const messages = this.data.messages.concat([localMessage]);
    this.setData({
      messages: messages,
      inputText: '',
      canSend: false,
    });
    this.scrollToBottom();
    this.sendMessage(localMessage);
  },

  /**
   * 调用发送接口
   * @param {object} message 本地消息对象
   */
  sendMessage: function (message) {
    const self = this;
    // 客户端兜底幂等：若列表中已存在同 clientMessageId 且已发送成功，则不再重复提交
    const already = this.data.messages.filter(function (m) {
      return m.clientMessageId === message.clientMessageId && m.status === 'sent';
    })[0];
    if (already) return;

    api
      .sendMessage(this.data.conversationId, {
        clientMessageId: message.clientMessageId,
        content: message.content,
        messageType: message.messageType,
      })
      .then((data) => {
        if (!data) return;
        const server = api.normalizeMessage(data);
        const messages = self.data.messages.map(function (m) {
          if (m.clientMessageId !== message.clientMessageId) return m;
          return Object.assign({}, m, {
            messageId: server.messageId || m.messageId,
            seq: server.seq !== null && server.seq !== undefined ? server.seq : m.seq,
            sentAt: server.sentAt || m.sentAt,
            status: 'sent',
          });
        });
        self.setData({ messages: messages });
        self.updateLastSeq();
        storage.clearChatDraft(self.data.conversationId);
      })
      .catch(() => {
        // 失败 → 转 failed（不弹 Toast，避免打断连续对话）
        const messages = self.data.messages.map(function (m) {
          if (m.clientMessageId !== message.clientMessageId) return m;
          return Object.assign({}, m, { status: 'failed' });
        });
        self.setData({ messages: messages });
      });
  },

  /**
   * 重发失败消息（复用同一 clientMessageId）
   * @param {object} e 事件
   */
  onRetrySend: function (e) {
    const clientMessageId = e.detail.clientMessageId;
    if (!clientMessageId) return;
    const target = this.data.messages.filter(function (m) {
      return m.clientMessageId === clientMessageId;
    })[0];
    if (!target || target.status === 'sending') return; // sending 状态禁止并发重发

    const messages = this.data.messages.map(function (m) {
      if (m.clientMessageId !== clientMessageId) return m;
      return Object.assign({}, m, { status: 'sending' });
    });
    this.setData({ messages: messages });
    this.sendMessage(target);
  },

  /**
   * 保存聊天草稿
   */
  saveDraft: function () {
    if (!this.data.conversationId) return;
    storage.setChatDraft(this.data.conversationId, this.data.inputText || '');
  },

  /**
   * 恢复聊天草稿（回填但不自动发送）
   */
  restoreDraft: function () {
    if (!this.data.conversationId) return;
    const draft = storage.getChatDraft(this.data.conversationId);
    if (draft && !this.data.inputText) {
      this.setData({ inputText: draft, canSend: draft.trim().length > 0 });
    }
  },

  /* ---------------- 导航 ---------------- */

  /**
   * 点击订单卡 / 服务卡
   * 规格 §B.3.2 流程 6：服务卡（带 serviceId）→ 下单确认页 P8
   * 规格 §B.4.2 流程 7：已有订单卡（带 orderId + status）→ 订单页详情
   * @param {object} e 事件
   */
  onOrderCardTap: function (e) {
    const summary = e.detail.orderSummary || {};
    const orderId = e.detail.orderId || summary.orderId;

    // 服务卡（服务意向）→ 进下单确认页
    if (summary.serviceId) {
      this.onServiceCardTap({ detail: { orderSummary: summary } });
      return;
    }

    // 已有订单卡 → 进订单页详情
    if (!orderId) return;
    storage.setNavOrder({ tab: 'all', highlightOrderId: orderId });
    wx.switchTab({ url: ROUTES.ORDER });
  },

  /**
   * 点击服务卡（order_card 消息）→ 下单确认页 P8
   * 规格 §B.3.2 流程 6：navigateTo('/pages/order/create?guideId=&serviceId=&conversationId=')
   * @param {object} e 事件
   */
  onServiceCardTap: function (e) {
    const summary = e.detail.orderSummary || {};
    if (!this.data.guideId) return;
    let url =
      ROUTES.ORDER_CREATE +
      '?guideId=' +
      encodeURIComponent(this.data.guideId) +
      '&conversationId=' +
      encodeURIComponent(this.data.conversationId);
    if (summary.serviceId) {
      url += '&serviceId=' + encodeURIComponent(summary.serviceId);
    }
    wx.navigateTo({ url: url });
  },

  /**
   * 「再次咨询」→ 新建会话
   */
  onConsultAgain: function () {
    const self = this;
    api
      .createConversation({ guideId: this.data.guideId })
      .then((data) => {
        if (!data || !data.conversationId) return;
        wx.redirectTo({
          url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(data.conversationId),
        });
      })
      .catch(() => {
        self.setWsNotice('暂时无法创建会话，请稍后重试', 'error');
      });
  },

  /**
   * 错误态操作
   */
  onErrorAction: function () {
    if (this.data.errorType === 'forbidden') {
      wx.switchTab({ url: ROUTES.MESSAGE });
      return;
    }
    this.setData({ error: '' });
    this.loadHistory(true);
  },

  /* ---------------- 滚动 ---------------- */

  /**
   * 滚动到底部
   */
  scrollToBottom: function () {
    const self = this;
    setTimeout(function () {
      // 测量内容高度 → 计算目标 scrollTop（scroll-top 与 scroll-into-view 互斥，统一用前者）
      wx.createSelectorQuery()
        .select('.chat__content')
        .boundingClientRect(function (rect) {
          if (!rect) return;
          const viewport = self._scrollHeight || 0;
          const target = Math.max(0, rect.height - viewport);
          self.setData({ scrollTop: target, newMessageCount: 0 });
          self._atBottom = true;
        })
        .exec();
    }, 60);
  },

  /**
   * 点击「新消息」浮标 → 回到最新
   */
  onScrollToLatest: function () {
    this.scrollToBottom();
  },
});
