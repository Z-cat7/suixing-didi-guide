/**
 * 地陪详情页 P7（独立二级页）
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET /api/v1/guides/:guideId      —— 地陪详情（取 data.guide）
 *   PUT /api/v1/me/favorites/:guideId —— 收藏 toggle（幂等，返回 favorited）
 *   POST /api/v1/conversations        —— 「咨询」创建/复用会话
 *
 * 规格：docs/02-ux-spec.md §B.7
 *
 * 【纪律】
 *   - 页面底部唯一实心主按钮是「立即预约」
 *   - 「咨询」「收藏」放在导航栏右侧（次级），避免吸底条出现两个大按钮
 *   - 休息中（isResting）/ 无可约时段 → 按钮禁用 + 顶部提示解释（不能只禁用不解释）
 *   - 收藏状态以服务端返回的 favorited 为准，前端**不自行取反**
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const format = require('../../utils/format');
const { ROUTES, PRICE_UNIT_TEXT } = require('../../utils/constants');

Page({
  data: {
    /** 地陪 ID */
    guideId: '',
    /** 来源标记 */
    from: '',
    /** 地陪详情 */
    guide: {},
    /** 昵称首字 */
    guideInitial: '伴',
    /** 语言文案 */
    languagesText: '',
    /** 照片轮播 */
    photoUrls: [],
    /** 服务项（已装饰） */
    services: [],
    /** 选中的服务项 ID */
    selectedServiceId: '',
    /** 当前选中的服务项对象 */
    selectedService: null,
    /** 选中服务项的价格（元） */
    selectedPriceYuan: '0',
    /** 可约时段 */
    slots: [],
    /** 是否有可约时段 */
    hasAvailableSlot: false,
    /** 评价（首屏 3 条） */
    reviews: [],
    /** 评价是否全部展开 */
    reviewsExpanded: false,
    /** 保障说明 */
    guarantees: [],
    /** 是否已收藏 */
    isFavorite: false,
    /** 「立即预约」是否禁用 */
    bookDisabled: false,
    /** 加载中 */
    loading: true,
    /** 错误：'' / 'load_failed' / 'not_found' */
    error: '',
    /** 离线 */
    offline: false,
  },

  onLoad: function (options) {
    const opts = options || {};
    const guideId = opts.guideId || '';
    if (!guideId) {
      // 参数错误 → 不发起请求，直接返回
      wx.showToast({ title: '页面参数错误', icon: 'none', duration: 2000 });
      wx.navigateBack();
      return;
    }
    this.setData({ guideId: guideId, from: opts.from || '' });
    this.loadDetail(guideId);
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
  },

  /**
   * 拉取地陪详情
   * @param {string} guideId 地陪 ID
   */
  loadDetail: function (guideId) {
    const self = this;
    this.setData({ loading: true, error: '' });
    api
      .getGuideDetail(guideId)
      .then(function (data) {
        if (!data) {
          self.setData({ loading: false, error: 'not_found' });
          return;
        }
        const services = (data.services || []).map(function (item) {
          return Object.assign({}, item, {
            priceText:
              format.amountToYuan(item.priceAmount) +
              ' 元 / ' +
              (PRICE_UNIT_TEXT[item.priceUnit] || '次'),
          });
        });
        const reviews = (data.reviews || []).map(function (r) {
          return Object.assign({}, r, { createdAtText: format.formatRelativeTime(r.createdAt) });
        });
        const slots = data.availableSlots || [];
        const hasAvailableSlot = slots.some(function (s) {
          return s.available !== false;
        });

        self.setData({
          loading: false,
          error: '',
          guide: data,
          guideInitial: data.name ? data.name.charAt(0) : '伴',
          languagesText: (data.languages || []).join(' / '),
          photoUrls: (data.photoUrls || []).slice(0, 5),
          services: services,
          slots: slots,
          hasAvailableSlot: hasAvailableSlot,
          reviews: reviews,
          reviewsExpanded: false,
          guarantees: data.guarantees || [],
          isFavorite: !!data.isFavorite,
        });
        self.setNavigationTitle(data.name);
        // 默认选中第一个可约服务项
        const first = services.filter(function (s) {
          return s.isAvailable !== false;
        })[0];
        if (first) self.selectService(first);
        self.updateBookDisabled();
      })
      .catch(function (err) {
        const notFound = err && (err.code === 40400 || err.code === 404);
        self.setData({ loading: false, error: notFound ? 'not_found' : 'load_failed' });
      });
  },

  /**
   * 设置导航栏标题（≤8 字）
   * @param {string} name 地陪名
   */
  setNavigationTitle: function (name) {
    if (!name) return;
    wx.setNavigationBarTitle({ title: name.length > 8 ? name.slice(0, 8) : name });
  },

  /**
   * 选择服务项（单选）
   * @param {object} e 事件
   */
  onSelectService: function (e) {
    const item = e.currentTarget.dataset.service;
    if (!item) return;
    if (item.isAvailable === false) {
      wx.showToast({ title: '该服务暂不可约', icon: 'none', duration: 2000 });
      return;
    }
    this.selectService(item);
  },

  /**
   * 设定选中的服务项并更新吸底条价格
   * @param {object} item 服务项
   */
  selectService: function (item) {
    this.setData({
      selectedServiceId: item.serviceId,
      selectedService: item,
      selectedPriceYuan: format.amountToYuan(item.priceAmount),
    });
    this.updateBookDisabled();
  },

  /**
   * 更新「立即预约」禁用态
   */
  updateBookDisabled: function () {
    const guide = this.data.guide || {};
    const disabled = !!guide.isResting || !this.data.hasAvailableSlot || !this.data.selectedServiceId;
    this.setData({ bookDisabled: disabled });
  },

  /**
   * 「立即预约」→ 下单确认页 P8
   */
  onBook: function () {
    const guide = this.data.guide || {};
    if (guide.isResting) {
      wx.showToast({ title: '该地陪今日休息，可先咨询', icon: 'none', duration: 2000 });
      return;
    }
    if (!this.data.hasAvailableSlot) {
      wx.showToast({ title: '该地陪近期暂无可约时段，可先咨询', icon: 'none', duration: 2000 });
      return;
    }
    if (!this.data.selectedServiceId) {
      wx.showToast({ title: '请先选择一个服务', icon: 'none', duration: 2000 });
      return;
    }
    // 防未登录：记录回跳信息 → 登录 → 回跳继续
    if (!getApp().globalData.isLoggedIn) {
      storage.setRedirect({
        path: ROUTES.ORDER_CREATE,
        query: {
          guideId: this.data.guideId,
          serviceId: this.data.selectedServiceId,
        },
      });
      wx.showToast({ title: '登录后即可预约 ' + guide.name, icon: 'none', duration: 2000 });
      getApp().ensureLogin();
      return;
    }
    wx.navigateTo({
      url:
        ROUTES.ORDER_CREATE +
        '?guideId=' +
        encodeURIComponent(this.data.guideId) +
        '&serviceId=' +
        encodeURIComponent(this.data.selectedServiceId),
    });
  },

  /**
   * 「咨询」→ 创建/复用会话 → 聊天页
   */
  onConsult: function () {
    const self = this;
    if (this.data.offline) {
      wx.showToast({ title: '网络连接已断开，操作暂不可用', icon: 'none', duration: 2000 });
      return;
    }
    if (!getApp().globalData.isLoggedIn) {
      storage.setRedirect({ path: ROUTES.CHAT, query: { guideId: this.data.guideId } });
      wx.showToast({ title: '登录后即可咨询', icon: 'none', duration: 2000 });
      getApp().ensureLogin();
      return;
    }
    api
      .createConversation({ guideId: this.data.guideId })
      .then(function (data) {
        if (!data || !data.conversationId) {
          wx.showToast({ title: '发起咨询失败，请稍后重试', icon: 'none', duration: 2500 });
          return;
        }
        wx.navigateTo({
          url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(data.conversationId),
        });
      })
      .catch(function () {
        wx.showToast({ title: '发起咨询失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 切换收藏（幂等 toggle，以服务端返回为准）
   */
  onToggleFavorite: function () {
    const self = this;
    if (this.data.offline) {
      wx.showToast({ title: '网络连接已断开，操作暂不可用', icon: 'none', duration: 2000 });
      return;
    }
    const previous = this.data.isFavorite;
    api
      .toggleFavorite(this.data.guideId)
      .then(function (data) {
        if (!data) {
          self.setData({ isFavorite: previous });
          wx.showToast({ title: '操作失败，请稍后重试', icon: 'none', duration: 2500 });
          return;
        }
        // 以服务端返回的 favorited 为准，不自行取反
        const favorited = data.favorited !== undefined ? data.favorited : data.isFavorite;
        self.setData({ isFavorite: !!favorited });
        wx.showToast({
          title: favorited ? '已收藏' : '已取消收藏',
          icon: 'none',
          duration: 1500,
        });
      })
      .catch(function () {
        // 失败 → 回滚图标状态
        self.setData({ isFavorite: previous });
        wx.showToast({ title: '操作失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 展开全部评价
   */
  onExpandReviews: function () {
    this.setData({ reviewsExpanded: true });
  },

  /**
   * 错误态操作
   */
  onErrorAction: function () {
    if (this.data.error === 'not_found') {
      wx.navigateBack();
      return;
    }
    this.setData({ error: '' });
    this.loadDetail(this.data.guideId);
  },
});
