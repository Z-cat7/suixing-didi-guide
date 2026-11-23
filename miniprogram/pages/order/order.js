/**
 * 订单页
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET  /api/v1/orders            —— 订单列表（?status=&page=&pageSize=）
 *   GET  /api/v1/orders/summary    —— 各状态数量（Tab 角标）
 *   GET  /api/v1/orders/:orderId   —— 订单详情
 *   POST /api/v1/orders/:orderId/pay     —— 支付
 *   POST /api/v1/orders/:orderId/cancel  —— 取消
 *   POST /api/v1/orders/:orderId/confirm —— 确认完成
 *   POST /api/v1/orders/:orderId/refund  —— 申请退款
 *   POST /api/v1/orders/:orderId/review  —— 评价
 *   POST /api/v1/conversations           —— 联系地陪（创建/复用会话）
 *
 * 【全局铁律】订单可用操作**完全由服务端下发的布尔位驱动**：
 *   canUserPay / canUserCancel / canUserConfirm / canUserRefund /
 *   canUserContact / canUserReview
 *   前端只渲染，不自算状态 → 按钮。statusText 也由服务端下发。
 *
 * 【视图结构】列表视图 ⇄ 详情视图（viewMode 切换，同页不 push 新页）
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const ws = require('../../utils/ws');
const format = require('../../utils/format');
const { ROUTES, ORDER_TABS, ORDER_TAB, CANCEL_REASON, REFUND_REASON } = require('../../utils/constants');

/** 倒计时刷新间隔（毫秒） */
const COUNTDOWN_INTERVAL = 1000;

Page({
  data: {
    /** 视图模式：list / detail */
    viewMode: 'list',
    /** 当前状态 Tab */
    currentTab: ORDER_TAB.ALL,
    /** Tab 中文名（用于空态文案） */
    currentTabText: '',
    /** Tab 定义 */
    tabs: ORDER_TABS,
    /** 各状态数量 */
    countByStatus: {},
    /** 订单列表 */
    list: [],
    /** 加载中 */
    loading: true,
    /** 错误 */
    error: '',
    /** 加载更多状态 */
    loadMoreStatus: 'idle',
    /** 加载更多锁 */
    loadingMore: false,
    /** 当前页 */
    page: 1,
    /** 是否还有更多 */
    hasMore: false,
    /** 离线 */
    offline: false,
    /** 需高亮的订单 ID（跨 Tab 进入时） */
    highlightOrderId: '',

    /** 详情视图 */
    detail: null,
    detailLoading: false,
    detailError: '',
    /** 退款驳回提示 */
    refundRejected: '',
    /** 地陪已下架 */
    guideOffline: false,

    /** 取消订单弹层 */
    cancelDialogOpen: false,
    cancelDialogDesc: '',
    cancelReasonCode: '',
    cancelReasons: CANCEL_REASON,
    /** 待操作订单 ID */
    actionOrderId: '',

    /** 退款面板 */
    refundPanelOpen: false,
    refundReasonCode: '',
    refundDescription: '',
    refundReasons: REFUND_REASON,
  },

  /** 倒计时定时器 */
  _countdownTimer: null,
  /** 请求序号（丢弃过期响应） */
  _requestId: 0,

  onLoad: function () {
    // 消费跨 Tab 导航包（读后即删，防重复消费）
    const nav = storage.consumeNavOrder();
    if (nav && nav.tab) {
      this.setData({ currentTab: nav.tab, highlightOrderId: nav.highlightOrderId || '' });
    }
    this.updateTabText(this.data.currentTab);
    this.onLoadSubscribe();
    this.loadSummary();
    this.loadList(true);
  },

  onShow: function () {
    // 订单状态是最易变的数据 → onShow 总是重新拉列表
    if (this.data.viewMode === 'list') {
      this.loadList(true);
    }
  },

  onUnload: function () {
    this.stopCountdown();
    ws.off('order.statusChanged', this._onOrderStatusChanged);
    this._onOrderStatusChanged = null;
  },

  /**
   * 订阅 WS 订单状态变化
   */
  onLoadSubscribe: function () {
    const self = this;
    this._onOrderStatusChanged = function (payload) {
      self.handleOrderStatusChanged(payload);
    };
    ws.on('order.statusChanged', this._onOrderStatusChanged);
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
  },

  onPullDownRefresh: function () {
    this.loadList(true).then(function () {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 更新 Tab 中文名
   * @param {string} tab Tab code
   */
  updateTabText: function (tab) {
    const found = ORDER_TABS.filter(function (t) {
      return t.code === tab;
    })[0];
    this.setData({ currentTabText: found ? found.label : '' });
  },

  /**
   * 拉取状态统计（Tab 角标）
   */
  loadSummary: function () {
    api
      .getOrderSummary()
      .then((data) => {
        if (data) this.setData({ countByStatus: data });
      })
      .catch(() => {
        /* 统计失败不阻断列表 */
      });
  },

  /**
   * 拉取订单列表
   * @param {boolean} reset 是否重置
   */
  loadList: function (reset) {
    const self = this;
    const requestId = ++this._requestId;

    if (reset) {
      this.setData({ loading: true, error: '', page: 1, list: [], loadMoreStatus: 'idle' });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } else {
      if (this.data.loadingMore) return Promise.resolve();
      this.setData({ loadingMore: true, loadMoreStatus: 'loading' });
    }

    const query = {
      status: this.data.currentTab === ORDER_TAB.ALL ? '' : this.data.currentTab,
      page: this.data.page,
      pageSize: 20,
    };

    return api
      .getOrders(query)
      .then((data) => {
        if (requestId !== self._requestId) return;
        if (!data) {
          self.setData({ loading: false, loadingMore: false });
          return;
        }
        const list = (data.list || []).map(self.decorateOrder);
        const merged = reset ? list : self.data.list.concat(list);
        self.setData({
          loading: false,
          loadingMore: false,
          error: '',
          list: merged,
          page: data.page || self.data.page,
          hasMore: !!data.hasMore,
          loadMoreStatus: data.hasMore ? 'idle' : 'nomore',
        });
        self.startCountdown();
      })
      .catch(() => {
        if (requestId !== self._requestId) return;
        if (reset) {
          self.setData({ loading: false, error: 'load_failed', loadMoreStatus: 'idle' });
        } else {
          self.setData({ loading: false, loadingMore: false, loadMoreStatus: 'error' });
        }
      });
  },

  /**
   * 装饰订单（补展示字段，不改原始业务字段）
   *
   * 【字段语义澄清】
   *   `scheduledAt` 是**服务端订单响应体里的展示字段**（服务端算好的服务开始时间），
   *   仅用于界面展示；**下单提交时提交的是 `slotId`**（时段稳定唯一标识），两者语义不同。
   * @param {object} order 订单
   * @returns {object}
   */
  decorateOrder: function (order) {
    const self = this;
    const decorated = Object.assign({}, order, {
      totalYuan: format.amountToYuan(order.totalAmount),
      scheduledAtText: format.formatDateTime(order.scheduledAt),
      countdownText: '',
    });
    if (order.expireAt && order.status === 'pendingPayment') {
      decorated.countdownText = self.buildCountdown(order.expireAt, order.serverTime);
    }
    if (this.data.highlightOrderId && order.orderId === this.data.highlightOrderId) {
      decorated.highlight = true;
    }
    return decorated;
  },

  /**
   * 构建倒计时文案（基于 serverTime 校正）
   * @param {string} expireAt 截止时间
   * @param {string} serverTime 服务端时间
   * @returns {string}
   */
  buildCountdown: function (expireAt, serverTime) {
    const expire = format.parseTime(expireAt);
    if (!expire) return '';
    const server = format.parseTime(serverTime);
    // 用服务端时间校正本地时钟偏差
    const offset = server ? server.getTime() - Date.now() : 0;
    const remain = expire.getTime() - (Date.now() + offset);
    if (remain <= 0) return '';
    return '剩余 ' + format.formatCountdown(remain);
  },

  /**
   * 启动倒计时刷新
   */
  startCountdown: function () {
    const self = this;
    this.stopCountdown();
    if (!this.data.list.some(function (o) {
      return o.status === 'pendingPayment' && o.expireAt;
    })) {
      return;
    }
    this._countdownTimer = setInterval(function () {
      let expired = false;
      const list = self.data.list.map(function (order) {
        if (order.status !== 'pendingPayment' || !order.expireAt) return order;
        const text = self.buildCountdown(order.expireAt, order.serverTime);
        if (!text) {
          // 到期 → 本地乐观置 closed（以服务端返回为准）
          expired = true;
          return Object.assign({}, order, {
            status: 'closed',
            statusText: '已关闭',
            countdownText: '',
          });
        }
        return Object.assign({}, order, { countdownText: text });
      });
      self.setData({ list: list });
      if (expired) self.loadSummary();
    }, COUNTDOWN_INTERVAL);
  },

  /** 停止倒计时 */
  stopCountdown: function () {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  /**
   * WS 订单状态变化 → 只更新对应条目，不整页刷新
   * @param {object} payload { orderId, status, statusText, order }
   */
  handleOrderStatusChanged: function (payload) {
    if (!payload) return;
    const orderId = payload.orderId || (payload.order && payload.order.orderId);
    if (!orderId) return;

    // 详情视图
    if (this.data.viewMode === 'detail' && this.data.detail && this.data.detail.orderId === orderId) {
      const merged = Object.assign({}, this.data.detail, payload.order || {}, {
        status: payload.status || (payload.order && payload.order.status),
        statusText: payload.statusText || (payload.order && payload.order.statusText),
      });
      this.setData({ detail: this.decorateDetail(merged) });
      return;
    }

    // 列表视图：只改这一条
    const list = this.data.list.map(function (order) {
      if (order.orderId !== orderId) return order;
      const merged = Object.assign({}, order, payload.order || {}, {
        status: payload.status || order.status,
        statusText: payload.statusText || order.statusText,
      });
      return this.decorateOrder(merged);
    }, this);
    this.setData({ list: list });
    this.loadSummary();
  },

  /**
   * 装饰订单详情
   * @param {object} order 订单
   * @returns {object}
   */
  decorateDetail: function (order) {
    const timeline = (order.timeline || []).map(function (t) {
      return Object.assign({}, t, { atText: format.formatDateTime(t.at) });
    });
    return Object.assign({}, order, {
      priceYuan: format.amountToYuan(order.priceAmount),
      extraYuan: format.amountToYuan(order.extraAmount),
      discountYuan: format.amountToYuan(order.discountAmount),
      totalYuan: format.amountToYuan(order.totalAmount),
      scheduledAtText: format.formatDateTime(order.scheduledAt),
      timeline: timeline,
      // 详情页是否有实心主按钮
      hasPrimaryAction: !!(order.canUserPay || order.canUserConfirm || order.canUserReview),
    });
  },

  /* ---------------- 列表交互 ---------------- */

  /**
   * 切换状态 Tab
   * @param {object} e 事件
   */
  onTabChange: function (e) {
    const code = e.currentTarget.dataset.code;
    if (!code || code === this.data.currentTab) return;
    this.setData({ currentTab: code, highlightOrderId: '' });
    this.updateTabText(code);
    this.loadList(true);
  },

  /**
   * 点击订单卡 → 详情视图
   * @param {object} e 事件
   */
  onOrderTap: function (e) {
    const orderId = e.currentTarget.dataset.orderId;
    if (!orderId) return;
    this.openDetail(orderId);
  },

  /**
   * 打开详情视图
   * @param {string} orderId 订单 ID
   */
  openDetail: function (orderId) {
    const self = this;
    this.setData({
      viewMode: 'detail',
      detail: null,
      detailLoading: true,
      detailError: '',
      refundRejected: '',
    });
    wx.setNavigationBarTitle({ title: '订单详情' });

    api
      .getOrder(orderId)
      .then((data) => {
        if (!data) {
          self.setData({ detailLoading: false, detailError: 'load_failed' });
          return;
        }
        self.setData({ detailLoading: false, detail: self.decorateDetail(data) });
      })
      .catch((err) => {
        const forbidden = err && err.code === 40302;
        self.setData({
          detailLoading: false,
          detailError: forbidden ? 'forbidden' : 'load_failed',
        });
      });
  },

  /**
   * 返回列表视图（不调 navigateBack，保留列表与滚动位置）
   */
  onBackToList: function () {
    this.setData({ viewMode: 'list', detail: null, detailError: '' });
    wx.setNavigationBarTitle({ title: '订单' });
  },

  /**
   * 详情错误态操作
   */
  onDetailErrorAction: function () {
    if (this.data.detailError === 'forbidden') {
      this.onBackToList();
      return;
    }
    const orderId = this.data.actionOrderId;
    this.setData({ detailError: '' });
    if (orderId) this.openDetail(orderId);
  },

  /* ---------------- 订单操作 ---------------- */

  /**
   * 去支付（先校验状态）
   * @param {object} e 事件
   */
  onPay: function (e) {
    const self = this;
    const orderId = e && e.currentTarget ? e.currentTarget.dataset.orderId : this.data.detail.orderId;
    if (!orderId) return;
    this.setData({ actionOrderId: orderId });

    // 先校验仍为待支付且未过期
    api
      .getOrder(orderId)
      .then(function (order) {
        if (!order || order.status !== 'pendingPayment') {
          wx.showToast({ title: '订单状态已变化', icon: 'none', duration: 2000 });
          self.refreshAfterAction(orderId);
          return;
        }
        return api.payOrder(orderId).then(function (result) {
          self.requestPayment(result, orderId);
        });
      })
      .catch(function () {
        wx.showToast({ title: '支付未完成，可稍后再试', icon: 'none', duration: 2000 });
      });
  },

  /**
   * 调起微信支付
   * @param {object} result 支付接口返回
   * @param {string} orderId 订单 ID
   */
  requestPayment: function (result, orderId) {
    const self = this;
    const payParams = (result && result.payParams) || null;
    if (!payParams) {
      // 无支付参数（如 mock 模式）→ 直接标记为已支付
      wx.showToast({ title: '支付成功，等待地陪接单', icon: 'none', duration: 2000 });
      this.refreshAfterAction(orderId);
      return;
    }
    wx.requestPayment({
      timeStamp: payParams.timeStamp,
      nonceStr: payParams.nonceStr,
      package: payParams.package,
      signType: payParams.signType || 'MD5',
      paySign: payParams.paySign,
      success: function () {
        wx.showToast({ title: '支付成功，等待地陪接单', icon: 'none', duration: 2000 });
        self.refreshAfterAction(orderId);
      },
      fail: function (err) {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) {
          wx.showToast({ title: '支付未完成，订单已保留 15 分钟', icon: 'none', duration: 2000 });
        } else {
          wx.showToast({ title: '支付未成功，可重试或稍后在订单页支付', icon: 'none', duration: 2500 });
        }
      },
    });
  },

  /**
   * 取消订单 → 二次确认弹层
   * @param {object} e 事件
   */
  onCancel: function (e) {
    const orderId = e && e.currentTarget ? e.currentTarget.dataset.orderId : this.data.detail.orderId;
    if (!orderId) return;
    const order = this.findOrder(orderId);
    // 已支付的订单取消 → 会发起退款，需在弹层写明
    const paid = order && order.paidAt;
    this.setData({
      actionOrderId: orderId,
      cancelDialogOpen: true,
      cancelReasonCode: '',
      cancelDialogDesc: paid
        ? '已支付，取消后将发起退款，1–3 个工作日原路退回。'
        : '取消后不可恢复，确定取消这笔订单吗？',
    });
  },

  /**
   * 选择取消原因
   * @param {object} e 事件
   */
  onSelectCancelReason: function (e) {
    this.setData({ cancelReasonCode: e.currentTarget.dataset.code });
  },

  /**
   * 关闭取消弹层
   */
  onCancelDialogClose: function () {
    this.setData({ cancelDialogOpen: false });
  },

  /**
   * 提交取消
   */
  onSubmitCancel: function () {
    const self = this;
    const orderId = this.data.actionOrderId;
    if (!orderId) return;
    this.setData({ cancelDialogOpen: false });
    api
      .cancelOrder(orderId, { cancelReasonCode: this.data.cancelReasonCode || 'other' })
      .then(function (result) {
        wx.showToast({ title: '已取消订单', icon: 'none', duration: 1500 });
        self.refreshAfterAction(orderId, result);
      })
      .catch(function (err) {
        wx.showToast({
          title: (err && err.message) || '取消失败，请稍后重试',
          icon: 'none',
          duration: 2500,
        });
      });
  },

  /**
   * 确认完成 → 二次确认
   * @param {object} e 事件
   */
  onConfirm: function (e) {
    const self = this;
    const orderId = e && e.currentTarget ? e.currentTarget.dataset.orderId : this.data.detail.orderId;
    if (!orderId) return;
    wx.showModal({
      title: '确认完成',
      content: '确认服务已完成？确认后金额将结算给地陪。',
      confirmText: '确认完成',
      cancelText: '还没结束',
      success: function (res) {
        if (!res.confirm) return;
        api
          .confirmOrder(orderId)
          .then(function (result) {
            wx.showToast({ title: '已确认完成', icon: 'none', duration: 1500 });
            self.refreshAfterAction(orderId, result);
          })
          .catch(function (err) {
            wx.showToast({
              title: (err && err.message) || '操作失败，请稍后重试',
              icon: 'none',
              duration: 2500,
            });
          });
      },
    });
  },

  /**
   * 申请退款 → 打开退款原因面板
   * @param {object} e 事件
   */
  onRefund: function (e) {
    const orderId = e && e.currentTarget ? e.currentTarget.dataset.orderId : this.data.detail.orderId;
    if (!orderId) return;
    this.setData({
      actionOrderId: orderId,
      refundPanelOpen: true,
      refundReasonCode: '',
      refundDescription: '',
    });
  },

  /**
   * 选择退款原因
   * @param {object} e 事件
   */
  onSelectRefundReason: function (e) {
    this.setData({ refundReasonCode: e.currentTarget.dataset.code });
  },

  /**
   * 退款说明输入
   * @param {object} e 事件
   */
  onRefundDescriptionInput: function (e) {
    this.setData({ refundDescription: e.detail.value });
  },

  /**
   * 关闭退款面板
   */
  onRefundPanelClose: function () {
    this.setData({ refundPanelOpen: false });
  },

  /**
   * 提交退款申请
   */
  onSubmitRefund: function () {
    const self = this;
    const orderId = this.data.actionOrderId;
    if (!this.data.refundReasonCode) {
      wx.showToast({ title: '请选择退款原因', icon: 'none', duration: 2000 });
      return;
    }
    this.setData({ refundPanelOpen: false });
    api
      .refundOrder(orderId, {
        refundReasonCode: this.data.refundReasonCode,
        description: this.data.refundDescription,
      })
      .then(function (result) {
        wx.showToast({
          title: '退款申请已提交，1–3 个工作日原路退回',
          icon: 'none',
          duration: 2500,
        });
        self.refreshAfterAction(orderId, result);
      })
      .catch(function (err) {
        wx.showToast({
          title: (err && err.message) || '提交失败，请稍后重试',
          icon: 'none',
          duration: 2500,
        });
      });
  },

  /**
   * 评价
   * @param {object} e 事件
   */
  onReview: function (e) {
    const self = this;
    const orderId = e && e.currentTarget ? e.currentTarget.dataset.orderId : this.data.detail.orderId;
    if (!orderId) return;
    wx.showModal({
      title: '去评价',
      content: '评价功能本期为占位，确认提交默认五星好评？',
      confirmText: '提交',
      cancelText: '再想想',
      success: function (res) {
        if (!res.confirm) return;
        api
          .reviewOrder(orderId, { rating: 5, content: '' })
          .then(function () {
            wx.showToast({ title: '已提交评价', icon: 'none', duration: 1500 });
            self.refreshAfterAction(orderId);
          })
          .catch(function () {
            wx.showToast({ title: '评价失败，请稍后重试', icon: 'none', duration: 2500 });
          });
      },
    });
  },

  /**
   * 联系地陪 → 创建/复用会话 → 聊天页
   * @param {object} e 事件
   */
  onContact: function (e) {
    const self = this;
    const order = this.data.detail || this.findOrder(e && e.currentTarget ? e.currentTarget.dataset.orderId : '');
    if (!order) return;
    api
      .createConversation({ guideId: order.guideId, orderId: order.orderId })
      .then(function (data) {
        if (!data || !data.conversationId) return;
        wx.navigateTo({
          url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(data.conversationId),
        });
      })
      .catch(function () {
        self.setData({ detailError: 'load_failed' });
      });
  },

  /**
   * 查找订单
   * @param {string} orderId 订单 ID
   * @returns {object|null}
   */
  findOrder: function (orderId) {
    if (!orderId) return null;
    if (this.data.detail && this.data.detail.orderId === orderId) return this.data.detail;
    const found = this.data.list.filter(function (o) {
      return o.orderId === orderId;
    })[0];
    return found || null;
  },

  /**
   * 操作后刷新（详情原地更新 + 列表单条更新）
   * @param {string} orderId 订单 ID
   * @param {object} result 操作返回的订单
   */
  refreshAfterAction: function (orderId, result) {
    const self = this;
    this.loadSummary();
    if (this.data.viewMode === 'detail' && this.data.detail && this.data.detail.orderId === orderId) {
      api
        .getOrder(orderId)
        .then(function (data) {
          if (data) self.setData({ detail: self.decorateDetail(data) });
        })
        .catch(function () {
          /* 详情刷新失败不阻塞 */
        });
    }
    this.loadList(true);
  },

  /* ---------------- 其他 ---------------- */

  /**
   * 首屏重试
   */
  onRetry: function () {
    this.setData({ error: '' });
    this.loadList(true);
  },

  /**
   * 加载更多重试
   */
  onRetryLoadMore: function () {
    this.setData({ page: this.data.page + 1 });
    this.loadList(false);
  },

  /**
   * 触底加载更多
   */
  onReachBottom: function () {
    if (!this.data.hasMore) return;
    if (this.data.loadingMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1 });
    this.loadList(false);
  },

  /**
   * 「去找地陪」
   */
  onFindGuide: function () {
    wx.switchTab({ url: ROUTES.HOME });
  },

  /**
   * 「查看全部订单」
   */
  onShowAllOrders: function () {
    this.setData({ currentTab: ORDER_TAB.ALL, highlightOrderId: '' });
    this.updateTabText(ORDER_TAB.ALL);
    this.loadList(true);
  },
});
