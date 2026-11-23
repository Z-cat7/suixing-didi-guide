/**
 * 消息页
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET  /api/v1/conversations —— 会话列表
 *   GET  /api/v1/notices       —— 系统通知
 *   POST /api/v1/notices/read  —— 全部已读
 *
 * WS 事件：conversation.updated（原地更新会话行）/ message.new / conversation.unreadChanged
 *
 * 【刷新策略】onShow 总是重拉当前 Tab 的列表（未读数会变）
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const ws = require('../../utils/ws');
const format = require('../../utils/format');
const { ROUTES, STORAGE_KEY, MESSAGE_TYPE } = require('../../utils/constants');

Page({
  data: {
    /** 当前 Tab：conversation / notification */
    activeTab: 'conversation',
    /** 会话列表 */
    conversationList: [],
    /** 通知列表 */
    noticeList: [],
    /** 加载中 */
    loading: true,
    /** 错误 */
    error: '',
    /** 加载更多状态 */
    loadMoreStatus: 'idle',
    loadingMore: false,
    page: 1,
    hasMore: false,
    /** 未读总数（会话） */
    unreadTotal: 0,
    /** 未读通知数 */
    unreadNoticeCount: 0,
    /** 离线 */
    offline: false,
  },

  onLoad: function () {
    // 恢复上次 Tab
    const savedTab = storage.get(STORAGE_KEY.MESSAGE_TAB, 'conversation');
    this.setData({ activeTab: savedTab === 'notification' ? 'notification' : 'conversation' });

    this.onLoadSubscribe();
    // 并行拉取两个列表
    this.loadConversations(true);
    if (this.data.activeTab === 'notification') {
      this.loadNotices(true);
    }
  },

  onShow: function () {
    // 重拉当前 Tab 的列表（未读数会变）
    if (this.data.activeTab === 'conversation') {
      this.loadConversations(true);
    } else {
      this.loadNotices(true);
    }
  },

  onUnload: function () {
    ws.off('conversation.updated', this._onConversationUpdated);
    ws.off('message.new', this._onMessageNew);
    ws.off('conversation.unreadChanged', this._onUnreadChanged);
    ws.off('notification.new', this._onNotificationNew);
    this._onConversationUpdated = null;
    this._onMessageNew = null;
    this._onUnreadChanged = null;
    this._onNotificationNew = null;
  },

  /**
   * 订阅 WS 事件
   */
  onLoadSubscribe: function () {
    const self = this;
    this._onConversationUpdated = function (payload) {
      self.handleConversationUpdated(payload);
    };
    this._onMessageNew = function (payload) {
      self.handleMessageNew(payload);
    };
    this._onUnreadChanged = function (payload) {
      self.handleUnreadChanged(payload);
    };
    this._onNotificationNew = function () {
      self.setData({ unreadNoticeCount: self.data.unreadNoticeCount + 1 });
    };
    ws.on('conversation.updated', this._onConversationUpdated);
    ws.on('message.new', this._onMessageNew);
    ws.on('conversation.unreadChanged', this._onUnreadChanged);
    ws.on('notification.new', this._onNotificationNew);
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
  },

  onPullDownRefresh: function () {
    const self = this;
    const task =
      this.data.activeTab === 'conversation' ? this.loadConversations(true) : this.loadNotices(true);
    task.then(function () {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 切换 Tab
   * @param {object} e 事件
   */
  onTabChange: function (e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    storage.set(STORAGE_KEY.MESSAGE_TAB, tab);
    this.setData({ activeTab: tab, loading: true, error: '' });
    if (tab === 'conversation') {
      this.loadConversations(true);
    } else {
      this.loadNotices(true);
    }
  },

  /**
   * 拉取会话列表
   * @param {boolean} reset 是否重置
   */
  loadConversations: function (reset) {
    const self = this;
    if (reset) {
      this.setData({ loading: true, error: '', page: 1, conversationList: [], loadMoreStatus: 'idle' });
    } else {
      if (this.data.loadingMore) return Promise.resolve();
      this.setData({ loadingMore: true, loadMoreStatus: 'loading' });
    }

    return api
      .getConversations({ page: this.data.page, pageSize: 20 })
      .then(function (data) {
        if (!data) {
          self.setData({ loading: false, loadingMore: false });
          return;
        }
        const list = data.list || [];
        const merged = reset ? list : self.data.conversationList.concat(list);
        let unread = 0;
        merged.forEach(function (c) {
          unread += c.unreadCount || 0;
        });
        self.setData({
          loading: false,
          loadingMore: false,
          error: '',
          conversationList: merged,
          page: data.page || self.data.page,
          hasMore: !!data.hasMore,
          loadMoreStatus: data.hasMore ? 'idle' : 'nomore',
          unreadTotal: unread,
        });
        // 同步 TabBar 角标
        getApp().setUnreadTotal(unread);
      })
      .catch(function () {
        if (reset) {
          self.setData({ loading: false, error: 'load_failed' });
        } else {
          self.setData({ loading: false, loadingMore: false, loadMoreStatus: 'error' });
        }
      });
  },

  /**
   * 拉取通知列表
   * @param {boolean} reset 是否重置
   */
  loadNotices: function (reset) {
    const self = this;
    if (reset) {
      this.setData({ loading: true, error: '', page: 1, noticeList: [], loadMoreStatus: 'idle' });
    } else {
      if (this.data.loadingMore) return Promise.resolve();
      this.setData({ loadingMore: true, loadMoreStatus: 'loading' });
    }

    return api
      .getNotices({ page: this.data.page, pageSize: 20 })
      .then(function (data) {
        if (!data) {
          self.setData({ loading: false, loadingMore: false });
          return;
        }
        const list = data.list || [];
        const merged = reset ? list : self.data.noticeList.concat(list);
        let unread = 0;
        merged.forEach(function (n) {
          if (!n.isRead) unread += 1;
        });
        self.setData({
          loading: false,
          loadingMore: false,
          error: '',
          noticeList: merged,
          page: data.page || self.data.page,
          hasMore: !!data.hasMore,
          loadMoreStatus: data.hasMore ? 'idle' : 'nomore',
          unreadNoticeCount: unread,
        });
      })
      .catch(function () {
        if (reset) {
          self.setData({ loading: false, error: 'load_failed' });
        } else {
          self.setData({ loading: false, loadingMore: false, loadMoreStatus: 'error' });
        }
      });
  },

  /**
   * WS：会话更新 → 原地更新该行（不整表 setData）
   * @param {object} payload { conversation }
   */
  handleConversationUpdated: function (payload) {
    if (!payload) return;
    const conv = payload.conversation || payload;
    if (!conv || !conv.conversationId) return;

    const list = this.data.conversationList.map(function (item) {
      if (item.conversationId !== conv.conversationId) return item;
      return Object.assign({}, item, conv);
    });
    // 该会话不在列表里 → 插入到顶部
    const exists = list.some(function (item) {
      return item.conversationId === conv.conversationId;
    });
    if (!exists) {
      list.unshift(Object.assign({}, conv));
    }
    this.setData({ conversationList: list });
  },

  /**
   * WS：新消息 → 原地更新会话行预览 + 置顶
   * @param {object} payload { conversationId, message }
   */
  handleMessageNew: function (payload) {
    if (!payload || !payload.message) return;
    const message = payload.message;
    const cid = payload.conversationId || message.conversationId;

    let preview = message.content || '';
    if (message.messageType === MESSAGE_TYPE.IMAGE) preview = '[图片]';
    else if (message.messageType === MESSAGE_TYPE.ORDER_CARD) preview = '[订单]';

    const list = this.data.conversationList.map(function (item) {
      if (item.conversationId !== cid) return item;
      return Object.assign({}, item, {
        lastMessageId: message.messageId,
        lastMessageContent: preview,
        lastMessageType: message.messageType,
        lastMessageAt: message.sentAt,
        unreadCount: (item.unreadCount || 0) + 1,
      });
    });
    // 该会话不在列表里 → 插入顶部
    const exists = list.some(function (item) {
      return item.conversationId === cid;
    });
    if (!exists) {
      list.unshift({
        conversationId: cid,
        guideName: '',
        guideAvatarUrl: '',
        lastMessageContent: preview,
        lastMessageType: message.messageType,
        lastMessageAt: message.sentAt,
        unreadCount: 1,
        isActive: true,
        firstUnreadSeq: message.seq,
      });
    }
    // 置顶（按时间倒序）
    list.sort(function (a, b) {
      return (a.lastMessageAt || '') < (b.lastMessageAt || '') ? 1 : -1;
    });
    this.setData({ conversationList: list });
  },

  /**
   * WS：未读数变化
   * @param {object} payload { conversationId, unreadCount, total }
   */
  handleUnreadChanged: function (payload) {
    if (!payload) return;
    if (typeof payload.total === 'number') {
      this.setData({ unreadTotal: payload.total });
      getApp().setUnreadTotal(payload.total);
      return;
    }
    // 单会话未读变化 → 更新对应行
    const list = this.data.conversationList.map(function (item) {
      if (item.conversationId !== payload.conversationId) return item;
      return Object.assign({}, item, { unreadCount: payload.unreadCount });
    });
    this.setData({ conversationList: list });
  },

  /**
   * 点击会话 → 聊天页（带未读定位锚点）
   * @param {object} e 事件
   */
  onConversationTap: function (e) {
    const item = e.detail.item;
    if (!item) return;
    if (item.isActive === false) {
      wx.showToast({ title: '该地陪已停止服务', icon: 'none', duration: 2000 });
      return;
    }
    if (this.data.offline) {
      wx.showToast({ title: '网络连接已断开，暂时无法进入会话', icon: 'none', duration: 2000 });
      return;
    }

    // 乐观清零
    const list = this.data.conversationList.map(function (c) {
      if (c.conversationId !== item.conversationId) return c;
      return Object.assign({}, c, { unreadCount: 0 });
    });
    this.setData({ conversationList: list });

    let url = ROUTES.CHAT + '?conversationId=' + encodeURIComponent(item.conversationId);
    if (item.firstUnreadSeq) {
      url += '&firstUnreadSeq=' + item.firstUnreadSeq;
    }
    wx.navigateTo({ url: url });
  },

  /**
   * 点击通知 → 按 refType 路由
   * @param {object} e 事件
   */
  onNoticeTap: function (e) {
    const item = e.detail.item;
    if (!item) return;
    // 本地标记已读
    const list = this.data.noticeList.map(function (n) {
      if (n.notificationId !== item.notificationId) return n;
      return Object.assign({}, n, { isRead: true });
    });
    this.setData({ noticeList: list });

    if (item.refType === 'order' && item.refId) {
      storage.setNavOrder({ tab: 'all', highlightOrderId: item.refId });
      wx.switchTab({ url: ROUTES.ORDER });
      return;
    }
    if (item.refType === 'conversation' && item.refId) {
      wx.navigateTo({ url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(item.refId) });
    }
  },

  /**
   * 全部已读
   */
  onReadAllNotices: function () {
    const self = this;
    api
      .readAllNotices()
      .then(function () {
        const list = self.data.noticeList.map(function (n) {
          return Object.assign({}, n, { isRead: true });
        });
        self.setData({ noticeList: list, unreadNoticeCount: 0 });
        wx.showToast({ title: '已全部标记为已读', icon: 'none', duration: 1500 });
      })
      .catch(function () {
        wx.showToast({ title: '操作失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 首屏重试
   */
  onRetry: function () {
    this.setData({ error: '' });
    if (this.data.activeTab === 'conversation') {
      this.loadConversations(true);
    } else {
      this.loadNotices(true);
    }
  },

  /**
   * 加载更多重试
   */
  onRetryLoadMore: function () {
    this.setData({ page: this.data.page + 1 });
    if (this.data.activeTab === 'conversation') {
      this.loadConversations(false);
    } else {
      this.loadNotices(false);
    }
  },

  /**
   * 触底加载更多
   */
  onReachBottom: function () {
    if (!this.data.hasMore) return;
    if (this.data.loadingMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1 });
    if (this.data.activeTab === 'conversation') {
      this.loadConversations(false);
    } else {
      this.loadNotices(false);
    }
  },

  /**
   * 「去找地陪」
   */
  onFindGuide: function () {
    wx.switchTab({ url: ROUTES.HOME });
  },
});
