/**
 * 首页
 * ---------------------------------------------------------------------------
 * 数据来源接口：GET /api/v1/home?city=xxx
 *
 * 模块顺序（UX 规范 §A.4）：
 *   1 定位条 → 2 搜索框 → 3 服务类型金刚区 → 4 推荐地陪横滑
 *   → 5 场景入口 → 6 进行中订单（条件） → 7 服务保障说明
 *
 * 【铁律】首页不设任何实心主按钮（IA-04）；实心主按钮只在地陪详情页与下单确认页。
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const format = require('../../utils/format');
const { ROUTES, SERVICE_TYPE_ITEMS } = require('../../utils/constants');

Page({
  data: {
    /** 当前城市 */
    city: '成都',
    /** 是否正在定位 */
    locating: false,
    /** 定位城市与当前城市不一致（仅提示，不自动刷新） */
    cityMismatch: false,
    /** 定位到的城市名 */
    locatedCity: '',
    /** 离线 */
    offline: false,
    /** 加载中 */
    loading: true,
    /** 错误 */
    error: '',
    /** 搜索框占位文案 */
    searchPlaceholder: '输入目的地或服务',
    /** 金刚区服务类型 */
    serviceTypes: [],
    /** 推荐地陪 */
    featuredGuides: [],
    /** 场景入口 */
    scenes: [],
    /** 进行中订单摘要 */
    activeOrderSummary: null,
    /** 保障说明 */
    guarantees: [],
  },

  onLoad: function () {
    const city = storage.getCity();
    if (city) {
      this.setData({ city: city });
    }
    this.loadHome();
    this.requestLocation();
  },

  onShow: function () {
    // 首页 onShow 不重拉（除非城市变更）；仅刷新登录态相关 UI
    this.setData({ offline: !getApp().globalData.online });
  },

  onPullDownRefresh: function () {
    this.loadHome(true);
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
  },

  /**
   * 拉取首页数据
   * @param {boolean} isRefresh 是否下拉刷新
   */
  loadHome: function (isRefresh) {
    if (!isRefresh) this.setData({ loading: true, error: '' });
    const city = this.data.city;
    api
      .getHome({ city: city })
      .then((data) => {
        if (!data) return;
        const types = data.serviceTypes && data.serviceTypes.length ? data.serviceTypes : SERVICE_TYPE_ITEMS;
        this.setData({
          loading: false,
          error: '',
          city: data.currentCity || city,
          searchPlaceholder: data.searchPlaceholder || '输入目的地或服务',
          serviceTypes: types,
          featuredGuides: data.featuredGuides || [],
          scenes: data.scenes || [],
          activeOrderSummary: data.activeOrderSummary || null,
          guarantees: data.guarantees || [],
        });
      })
      .catch(() => {
        this.setData({ loading: false, error: 'load_failed' });
      })
      .then(() => {
        wx.stopPullDownRefresh();
      });
  },

  /**
   * 请求定位（失败不阻断浏览）
   */
  requestLocation: function () {
    this.setData({ locating: true });
    wx.getLocation({
      type: 'wgc02',
      success: (res) => {
        // 开发态拿不到真实城市名，用经纬度做一次「模拟城市判定」
        const city = this.guessCity(res);
        this.setData({ locating: false, locatedCity: city });
        if (city && city !== this.data.city) {
          // 不自动切换内容，仅提示
          this.setData({ cityMismatch: true });
        }
      },
      fail: () => {
        // 定位失败 / 被拒 → 降级为手动选择城市，不弹任何模态阻断
        this.setData({ locating: false });
      },
    });
  },

  /**
   * 依据经纬度粗略判定城市（开发态简化实现）
   * @param {object} res 定位结果
   * @returns {string} 城市名
   */
  guessCity: function (res) {
    // 真机接入逆地理解析服务后替换此处
    return this.data.city;
  },

  /**
   * 重试
   */
  onRetry: function () {
    this.setData({ error: '', loading: true });
    this.loadHome();
  },

  /**
   * 点击定位条 → 底部城市选择面板
   */
  onPickCity: function () {
    const self = this;
    wx.showActionSheet({
      itemList: ['成都', '南京', '上海', '杭州', '广州', '北京'],
      success: function (res) {
        const city = ['成都', '南京', '上海', '杭州', '广州', '北京'][res.tapIndex];
        self.setData({ city: city, cityMismatch: false });
        storage.setCity(city);
        getApp().setCity(city);
        self.setData({ loading: true, error: '' });
        self.loadHome();
      },
      fail: function () {
        /* 用户取消 */
      },
    });
  },

  /**
   * 「撤销」定位切换 → 恢复原城市
   */
  onSwitchToLocatedCity: function () {
    const city = this.data.locatedCity;
    if (!city) return;
    this.setData({ city: city, cityMismatch: false });
    storage.setCity(city);
    getApp().setCity(city);
    this.setData({ loading: true });
    this.loadHome();
  },

  /**
   * 点击搜索框 → 搜索页（from=home，自动聚焦）
   */
  onSearchTap: function () {
    wx.navigateTo({ url: ROUTES.SEARCH + '?from=home&city=' + encodeURIComponent(this.data.city) });
  },

  /**
   * 点击服务类型金刚区 → 搜索页（带入 serviceType，立即拉结果）
   * @param {object} e 事件
   */
  onServiceTypeTap: function (e) {
    const code = e.currentTarget.dataset.code;
    wx.navigateTo({
      url: ROUTES.SEARCH + '?from=home&serviceType=' + encodeURIComponent(code) + '&city=' + encodeURIComponent(this.data.city),
    });
  },

  /**
   * 点击地陪卡 → 地陪详情页 P7
   * @param {object} e 事件
   */
  onGuideTap: function (e) {
    const guideId = e.detail.guideId;
    if (!guideId) return;
    wx.navigateTo({ url: ROUTES.GUIDE_DETAIL + '?guideId=' + encodeURIComponent(guideId) + '&from=home' });
  },

  /**
   * 「更多」→ 搜索页
   */
  onMoreGuides: function () {
    wx.navigateTo({ url: ROUTES.SEARCH + '?from=home&city=' + encodeURIComponent(this.data.city) });
  },

  /**
   * 点击场景入口 → 搜索页（带入场景条件）
   * @param {object} e 事件
   */
  onSceneTap: function (e) {
    const code = e.currentTarget.dataset.code;
    const query = e.currentTarget.dataset.query || '';
    let url = ROUTES.SEARCH + '?from=home&scene=' + encodeURIComponent(code);
    if (query) url += '&' + query;
    wx.navigateTo({ url: url });
  },

  /**
   * 点击进行中订单 → 订单页（storage + switchTab）
   */
  onActiveOrderTap: function () {
    const summary = this.data.activeOrderSummary;
    storage.setNavOrder({
      tab: 'all',
      highlightOrderId: summary ? summary.orderId : '',
    });
    wx.switchTab({ url: ROUTES.ORDER });
  },
});
