/**
 * 随行 dipi · 小程序入口
 * ---------------------------------------------------------------------------
 * 全局职责：
 *   1. 登录态管理（token 注入 / 401 自动重登 / 退出登录）
 *   2. 全局数据（用户资料、当前城市、未读总数、WS 状态）
 *   3. WebSocket 连接管理（单例；页面只订阅事件，不各自建连接）
 *   4. 网络状态监听（断网提示条 + 草稿落盘）
 *   5. TabBar 未读角标同步
 *
 * 【重要】globalData 只放「会话态」（wsState / unreadTotal / 连接实例），
 *   跨页业务对象一律走 URL query 或 storage（见 UX 规范 §C.2.3）。
 */
const api = require('./utils/api');
const request = require('./utils/request');
const storage = require('./utils/storage');
const ws = require('./utils/ws');
const { WS_STATE, ROUTES } = require('./utils/constants');

App({
  /** 全局数据（仅会话态） */
  globalData: {
    /** 用户资料对象（可序列化，放内存便于快速渲染） */
    user: null,
    /** 当前城市 */
    city: '',
    /** 未读总数（会话 + 通知） */
    unreadTotal: 0,
    /** WS 状态 */
    wsState: WS_STATE.CONNECTING,
    /** 是否已登录 */
    isLoggedIn: false,
    /** 网络是否可用 */
    online: true,
    /** 当前所在 Tab（用于自定义 TabBar 高亮） */
    currentTab: 'home',
  },

  /** 页面级共享的 WS 事件转发器 */
  _wsHandlers: [],

  onLaunch() {
    // 1. 恢复本地登录态
    const token = storage.getToken();
    const profile = storage.getProfile();
    this.globalData.city = storage.getCity() || '成都';
    if (token) {
      this.globalData.isLoggedIn = true;
      if (profile) this.globalData.user = profile;
    }

    // 2. 静默登录（无 token 时走 mock/真实登录）
    this.ensureLogin();

    // 3. 网络状态监听
    this.setupNetworkWatch();

    // 4. WS 状态广播（供页面订阅）
    ws.on('stateChanged', (payload) => {
      this.globalData.wsState = payload.state;
      this.broadcastWsState(payload.state);
    });

    // 5. 未读数变化 → 同步 TabBar 角标
    ws.on('conversation.unreadChanged', (payload) => {
      const total = typeof payload.total === 'number' ? payload.total : this.globalData.unreadTotal;
      this.setUnreadTotal(total);
    });

    ws.on('notification.new', () => {
      this.setUnreadTotal(this.globalData.unreadTotal + 1);
    });
  },

  onShow() {
    // 前台恢复：WS 非 connected 时立刻尝试重连一次
    if (!ws.isConnected() && storage.getToken()) {
      ws.connect();
    }
  },

  onHide() {
    // 后台不断开 WS（保持重连），仅在极端情况下回收
    // 30 分钟后台 → 主动断开省电
    if (this._hideAt && Date.now() - this._hideAt > 30 * 60 * 1000) {
      ws.close();
    }
  },

  /**
   * 确保登录态（静默；失败不阻塞浏览）
   */
  ensureLogin() {
    if (this.globalData.isLoggedIn && storage.getToken()) {
      // 已登录 → 刷新一次资料（失败保留缓存）
      this.refreshProfile();
      return Promise.resolve(this.globalData.user);
    }
    return request
      .ensureToken()
      .then(() => this.refreshProfile())
      .catch(() => {
        // 登录失败不阻塞浏览：页面降级为未登录态
        this.globalData.isLoggedIn = false;
        return null;
      });
  },

  /**
   * 拉取用户资料
   * @returns {Promise<object|null>}
   */
  refreshProfile() {
    return api
      .getMe()
      .then((data) => {
        if (data) {
          this.globalData.user = data;
          this.globalData.isLoggedIn = true;
          storage.setProfile(data);
        }
        return data;
      })
      .catch(() => {
        // 保留缓存
        const cached = storage.getProfile();
        if (cached) {
          this.globalData.user = cached;
          this.globalData.isLoggedIn = true;
        }
        return cached;
      });
  },

  /**
   * 退出登录
   */
  logout() {
    storage.clearUserStorage();
    this.globalData.user = null;
    this.globalData.isLoggedIn = false;
    this.globalData.unreadTotal = 0;
    this.setUnreadTotal(0);
    ws.close();
  },

  /**
   * 设置当前城市
   * @param {string} city 城市名
   */
  setCity(city) {
    this.globalData.city = city;
    storage.setCity(city);
  },

  /**
   * 设置未读总数并同步 TabBar 角标
   * @param {number} total 未读总数
   */
  setUnreadTotal(total) {
    const n = typeof total === 'number' && total >= 0 ? total : 0;
    this.globalData.unreadTotal = n;
    try {
      if (n > 0) {
        wx.setTabBarBadge({ index: 1, text: n > 99 ? '99+' : String(n), fail: () => {} });
      } else {
        wx.removeTabBarBadge({ index: 1, fail: () => {} });
      }
    } catch (e) {
      /* 非 TabBar 页调用会失败，忽略 */
    }
  },

  /**
   * 建立 WS 连接（幂等）
   * @returns {Promise<void>}
   */
  connectWs() {
    return ws.connect();
  },

  /**
   * 断开 WS
   */
  closeWs() {
    ws.close();
  },

  /**
   * 订阅 WS 状态（页面级）
   * @param {function} handler 回调 (state)
   */
  onWsState(handler) {
    this._wsHandlers.push(handler);
    handler(this.globalData.wsState);
  },

  /**
   * 退订 WS 状态
   * @param {function} handler 回调
   */
  offWsState(handler) {
    const idx = this._wsHandlers.indexOf(handler);
    if (idx >= 0) this._wsHandlers.splice(idx, 1);
  },

  /**
   * 广播 WS 状态
   * @param {string} state 状态
   */
  broadcastWsState(state) {
    const snapshot = this._wsHandlers.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](state);
      } catch (e) {
        /* 忽略单个订阅者异常 */
      }
    }
  },

  /**
   * 网络状态监听：断网时广播 + 草稿落盘
   */
  setupNetworkWatch() {
    wx.getNetworkType({
      success: (res) => {
        this.globalData.online = res.networkType !== 'none';
      },
      fail: () => {},
    });
    wx.onNetworkStatusChange((res) => {
      const online = res.networkType !== 'none';
      const wasOnline = this.globalData.online;
      this.globalData.online = online;
      if (!online) {
        wx.showToast({ title: '网络连接已断开', icon: 'none', duration: 2000 });
        this.broadcastNetwork(false);
      } else {
        if (!wasOnline) {
          wx.showToast({ title: '网络已恢复', icon: 'none', duration: 1500 });
          // 恢复后立即尝试重连 WS
          if (storage.getToken()) ws.connect();
        }
        this.broadcastNetwork(true);
      }
    });
  },

  /**
   * 广播网络状态
   * @param {boolean} online 是否在线
   */
  broadcastNetwork(online) {
    const pages = getCurrentPages();
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (page && typeof page.onNetworkChange === 'function') {
        try {
          page.onNetworkChange(online);
        } catch (e) {
          /* 忽略 */
        }
      }
    }
  },

  /**
   * 登录后回跳
   * @param {object} options { path, query }
   */
  redirectAfterLogin(options) {
    const target = options || storage.consumeRedirect();
    if (!target || !target.path) {
      wx.switchTab({ url: ROUTES.HOME });
      return;
    }
    let url = target.path;
    if (target.query) {
      const parts = [];
      Object.keys(target.query).forEach((k) => {
        const v = target.query[k];
        if (v === undefined || v === null || v === '') return;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      if (parts.length) url += '?' + parts.join('&');
    }
    wx.navigateTo({ url: url });
  },
});
