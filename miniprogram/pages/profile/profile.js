/**
 * 用户主页
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET /api/v1/me           —— 我的资料（含 orderCounts）
 *   GET /api/v1/me/settings  —— 用户设置
 *   PUT /api/v1/me           —— 更新资料
 *   PUT /api/v1/me/settings  —— 更新设置
 *
 * 【关键约束】
 *   - 未登录时页面**正常渲染**（不白屏、不报错），订单区显示「登录后查看订单」
 *   - 设置开关失败**回滚** UI 状态 + Toast「设置保存失败」
 *   - 破坏性操作（退出登录 / 清除缓存）二次确认，默认焦点在「取消」
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const { ROUTES, ORDER_TAB, ORDER_STAT_BUCKETS } = require('../../utils/constants');

/** 资料缓存有效期（毫秒）—— 5 分钟 */
const PROFILE_TTL = 5 * 60 * 1000;

Page({
  data: {
    /** 加载中 */
    loading: true,
    /** 资料加载失败（头部降级，下方内容区错误块） */
    error: false,
    /** 是否已登录 */
    isLoggedIn: false,
    /** 用户资料 */
    user: {},
    /** 昵称首字 */
    userInitial: '我',
    /** 实名状态文案 */
    realNameText: '还未实名认证',
    realNameAction: '去实名',
    /** 收藏数 */
    favoriteCount: 0,
    /**
     * 订单统计格：直接渲染服务端下发的 orderStats 展示分桶
     * 【铁律】前端**不按订单状态枚举自行聚合**；`ongoing` 是服务端聚合出的
     *        展示分桶（accepted + inService），**不是订单状态枚举**。
     *        分桶定义见 utils/constants.js 的 ORDER_STAT_BUCKETS。
     */
    orderStatItems: ORDER_STAT_BUCKETS.map(function (b) {
      return { code: b.code, label: b.label, count: 0 };
    }),
    /** 设置 */
    settings: {
      notifyEnabled: true,
      notifyOrder: true,
      notifyMessage: true,
      notifyRefund: true,
      privacyLocation: false,
      showProfilePublic: true,
      subscribeMessageAuthorized: false,
      cacheSizeMb: 0,
    },
    /** 设置项是否禁用（无权限时全禁用） */
    settingsDisabled: false,
    /** 缓存占用（MB） */
    cacheSizeMb: 0,
    /** 离线 */
    offline: false,
    /**
     * switch 组件的主题色（switch 的 color 是原生组件属性，不支持 CSS 变量）
     * = --dipi-brand-600（设计令牌）；HEX 只在此处出现一次，以本注释绑定令牌
     */
    brandColor: '#0F6F63',
    /** 编辑资料面板 */
    editPanelOpen: false,
    profileDraft: { nickname: '', gender: 'unknown', city: '', bio: '' },
    /** 昵称错误 */
    nicknameError: '',
    /** 性别选项 */
    genderOptions: [
      { code: 'male', label: '男' },
      { code: 'female', label: '女' },
      { code: 'unknown', label: '不填' },
    ],
  },

  /** 资料缓存时间戳 */
  _profileFetchedAt: 0,

  onLoad: function () {
    this.loadProfile();
    this.loadSettings();
  },

  onShow: function () {
    // 退出登录后 onShow 立即重渲染为未登录态（不重载整页）
    const app = getApp();
    this.setData({ isLoggedIn: !!app.globalData.isLoggedIn });
    // 5 分钟内可跳过资料刷新
    if (Date.now() - this._profileFetchedAt < PROFILE_TTL && this.data.user.nickname) {
      this.setData({ loading: false });
      return;
    }
    this.loadProfile();
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
    this.loadProfile();
    this.loadSettings();
    setTimeout(function () {
      wx.stopPullDownRefresh();
    }, 300);
  },

  /**
   * 拉取我的资料
   */
  loadProfile: function () {
    const self = this;
    return api
      .getMe()
      .then(function (data) {
        self._profileFetchedAt = Date.now();
        if (!data) {
          self.setData({ loading: false, isLoggedIn: false });
          return;
        }
        const counts = data.orderCounts || {};
        // 订单统计格：数量直接取服务端下发的 orderStats 展示分桶（前端不自行聚合）
        const stats = data.orderStats || {};
        const statItems = ORDER_STAT_BUCKETS.map(function (b) {
          return { code: b.code, label: b.label, count: stats[b.code] || 0 };
        });
        const realNameText = data.realNameVerified ? '已实名认证' : '还未实名认证';
        self.setData({
          loading: false,
          isLoggedIn: true,
          user: data,
          userInitial: data.nickname ? data.nickname.charAt(0) : '我',
          orderStatItems: statItems,
          favoriteCount: data.favoriteCount || 0,
          realNameText: realNameText,
          realNameAction: data.realNameVerified ? '查看' : '去实名',
        });
        storage.setProfile(data);
      })
      .catch(function () {
        // 失败 → 页面头部降级为「登录/注册」态，下方内容区错误块，不整页白屏
        self.setData({
          loading: false,
          error: true,
          isLoggedIn: !!getApp().globalData.isLoggedIn,
        });
      });
  },

  /**
   * 重新加载资料
   */
  onRetry: function () {
    this.setData({ error: false, loading: true });
    this.loadProfile();
    this.loadSettings();
  },

  /**
   * 拉取设置
   */
  loadSettings: function () {
    const self = this;
    api
      .getSettings()
      .then(function (data) {
        if (!data) return;
        self.setData({
          settings: data,
          cacheSizeMb: data.cacheSizeMb || 0,
          settingsDisabled: false,
        });
      })
      .catch(function (err) {
        // 403 → 设置项全部置灰 + 说明
        const forbidden = err && err.code === 40300;
        self.setData({ settingsDisabled: !!forbidden });
      });
  },

  /* ---------------- 订单统计跳转 ---------------- */

  /**
   * 点击订单统计格 → 订单页（storage + switchTab）
   * @param {object} e 事件
   */
  onOrderStatTap: function (e) {
    const code = e.currentTarget.dataset.code;
    const tabMap = {
      pendingPayment: ORDER_TAB.PENDING_PAYMENT,
      ongoing: ORDER_TAB.ONGOING,
      pendingConfirm: ORDER_TAB.PENDING_CONFIRM,
      refunding: ORDER_TAB.REFUNDING,
    };
    storage.setNavOrder({ tab: tabMap[code] || ORDER_TAB.ALL });
    wx.switchTab({ url: ROUTES.ORDER });
  },

  /**
   * 「我的订单」总入口
   */
  onAllOrders: function () {
    storage.setNavOrder({ tab: ORDER_TAB.ALL });
    wx.switchTab({ url: ROUTES.ORDER });
  },

  /**
   * 收藏行 → 搜索页（带 favorites 视图）
   */
  onFavorites: function () {
    wx.navigateTo({ url: ROUTES.SEARCH + '?from=profile&view=favorites' });
  },

  /* ---------------- 资料编辑 ---------------- */

  /**
   * 打开编辑资料面板
   */
  onEditProfile: function () {
    const user = this.data.user || {};
    this.setData({
      editPanelOpen: true,
      nicknameError: '',
      profileDraft: {
        nickname: user.nickname || '',
        gender: user.gender || 'unknown',
        city: user.city || '',
        bio: user.bio || '',
      },
    });
  },

  /**
   * 关闭面板（有未保存改动 → 二次确认）
   */
  onEditPanelClose: function () {
    const draft = this.data.profileDraft;
    const user = this.data.user || {};
    const changed =
      draft.nickname !== (user.nickname || '') ||
      draft.gender !== (user.gender || 'unknown') ||
      draft.city !== (user.city || '') ||
      draft.bio !== (user.bio || '');
    if (!changed) {
      this.setData({ editPanelOpen: false });
      return;
    }
    wx.showModal({
      title: '放弃修改？',
      content: '未保存的内容将丢失。',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: function (res) {
        if (res.confirm) {
          this.setData({ editPanelOpen: false });
        }
      }.bind(this),
    });
  },

  /**
   * 昵称输入
   * @param {object} e 事件
   */
  onNicknameInput: function (e) {
    const value = e.detail.value;
    this.setData({
      'profileDraft.nickname': value,
      nicknameError: !value ? '请填写昵称' : value.length > 12 ? '昵称最多 12 个字' : '',
    });
  },

  /**
   * 性别切换
   * @param {object} e 事件
   */
  onGenderChange: function (e) {
    this.setData({ 'profileDraft.gender': e.currentTarget.dataset.code });
  },

  /**
   * 城市输入
   * @param {object} e 事件
   */
  onCityInput: function (e) {
    this.setData({ 'profileDraft.city': e.detail.value });
  },

  /**
   * 简介输入
   * @param {object} e 事件
   */
  onBioInput: function (e) {
    this.setData({ 'profileDraft.bio': e.detail.value });
  },

  /**
   * 保存资料
   */
  onSaveProfile: function () {
    const self = this;
    const draft = this.data.profileDraft;
    if (!draft.nickname) {
      this.setData({ nicknameError: '请填写昵称' });
      return;
    }
    if (draft.nickname.length > 12) {
      this.setData({ nicknameError: '昵称最多 12 个字' });
      return;
    }
    api
      .updateMe({
        nickname: draft.nickname,
        gender: draft.gender,
        city: draft.city,
        bio: draft.bio,
      })
      .then(function (data) {
        wx.showToast({ title: '已保存', icon: 'none', duration: 1500 });
        self.setData({ editPanelOpen: false, user: data || self.data.user });
        getApp().globalData.user = data || self.data.user;
        storage.setProfile(data || self.data.user);
      })
      .catch(function (err) {
        wx.showToast({
          title: (err && err.message) || '保存失败，请稍后重试',
          icon: 'none',
          duration: 2500,
        });
      });
  },

  /**
   * 修改头像
   */
  onEditAvatar: function () {
    const self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: function (res) {
        const path = res.tempFiles && res.tempFiles[0] ? res.tempFiles[0].tempFilePath : '';
        if (!path) return;
        // 头像上传接口由服务端提供；此处先用本地路径占位，实际应先上传再 PUT
        api
          .updateMe({ avatarUrl: path })
          .then(function (data) {
            self.setData({ user: data || self.data.user });
            storage.setProfile(data || self.data.user);
            wx.showToast({ title: '已保存', icon: 'none', duration: 1500 });
          })
          .catch(function () {
            wx.showToast({ title: '保存失败，请稍后重试', icon: 'none', duration: 2500 });
          });
      },
      fail: function () {
        /* 用户取消 */
      },
    });
  },

  /* ---------------- 设置开关 ---------------- */

  /**
   * 通知总开关
   * @param {object} e 事件
   */
  onNotifyToggle: function (e) {
    const value = e.detail.value;
    const previous = this.data.settings.notifyEnabled;
    this.setData({ 'settings.notifyEnabled': value });

    if (!value) {
      // 关闭全部通知 → 需系统订阅消息授权
      const self = this;
      wx.getSetting({
        success: function (res) {
          if (res.authSetting['scope.subscribeMessage'] === true) {
            self.saveSettings({ notifyEnabled: false });
            return;
          }
          wx.showModal({
            title: '关闭通知',
            content: '关闭后将不再接收订单与消息通知，可随时在设置中重新开启。',
            confirmText: '继续',
            cancelText: '取消',
            success: function (modalRes) {
              if (!modalRes.confirm) {
                // 用户取消 → 回滚开关
                self.setData({ 'settings.notifyEnabled': previous });
                return;
              }
              wx.requestSubscribeMessage({
                tmplIds: [],
                success: function () {
                  self.saveSettings({ notifyEnabled: false });
                },
                fail: function () {
                  self.setData({ 'settings.notifyEnabled': previous });
                },
              });
            },
          });
        },
        fail: function () {
          self.saveSettings({ notifyEnabled: false });
        },
      });
      return;
    }
    this.saveSettings({ notifyEnabled: true });
  },

  /**
   * 隐私授权开关
   * @param {object} e 事件
   */
  onPrivacyToggle: function (e) {
    this.saveSettings({ privacyLocation: e.detail.value });
  },

  /**
   * 保存设置（失败回滚）
   * @param {object} patch 设置项
   */
  saveSettings: function (patch) {
    const self = this;
    const previous = Object.assign({}, this.data.settings);
    api
      .updateSettings(patch)
      .then(function (data) {
        self.setData({ settings: data || Object.assign({}, previous, patch) });
      })
      .catch(function () {
        // 回滚 UI 状态
        self.setData({ settings: previous });
        wx.showToast({ title: '设置保存失败', icon: 'none', duration: 2500 });
      });
  },

  /* ---------------- 其他 ---------------- */

  /**
   * 登录
   */
  onLogin: function () {
    const app = getApp();
    app
      .ensureLogin()
      .then(function () {
        wx.showToast({ title: '登录成功', icon: 'none', duration: 1500 });
        app.redirectAfterLogin(null);
      })
      .catch(function () {
        wx.showToast({ title: '登录失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 实名认证
   */
  onRealName: function () {
    if (this.data.user.realNameVerified) {
      wx.showToast({ title: '你已完成实名认证', icon: 'none', duration: 2000 });
      return;
    }
    wx.showModal({
      title: '实名认证',
      content: '实名认证后可预约全部实名服务。',
      confirmText: '去认证',
      cancelText: '再想想',
      success: function (res) {
        if (res.confirm) {
          wx.showToast({ title: '实名认证功能开发中', icon: 'none', duration: 2000 });
        }
      },
    });
  },

  /**
   * 联系客服
   */
  onSupport: function () {
    wx.showModal({
      title: '联系客服',
      content: '客服在线时间 9:00–22:00，微信搜索公众号「随行客服」。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /**
   * 意见反馈
   */
  onFeedback: function () {
    wx.showModal({
      title: '意见反馈',
      content: '功能开发中，敬请期待。你也可以直接联系客服反馈。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /**
   * 关于我们
   */
  onAbout: function () {
    wx.showModal({
      title: '关于随行',
      content: '随行 · 线下地陪服务平台 v1.0.0\n让异地旅行有人带路。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /**
   * 清除缓存（二次确认）
   */
  onClearCache: function () {
    wx.showModal({
      title: '清除缓存',
      content: '将清除本地草稿与列表缓存，不影响账号登录。',
      confirmText: '清除',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return;
        storage.clearLocalCache();
        this.setData({ cacheSizeMb: 0 });
        wx.showToast({ title: '缓存已清除', icon: 'none', duration: 1500 });
      }.bind(this),
    });
  },

  /**
   * 退出登录（二次确认）
   */
  onLogout: function () {
    wx.showModal({
      title: '退出登录',
      content: '退出后需重新登录才能查看订单与消息。',
      confirmText: '退出登录',
      cancelText: '取消',
      success: function (res) {
        if (!res.confirm) return;
        getApp().logout();
        wx.showToast({ title: '已退出登录', icon: 'none', duration: 1500 });
        wx.reLaunch({ url: ROUTES.HOME });
      },
    });
  },
});
