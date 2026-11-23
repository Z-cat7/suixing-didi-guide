/**
 * 搜索页
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET /api/v1/guides                —— 结果列表（多条件组合 + 排序 + 分页）
 *   GET /api/v1/guides/filter-options —— 筛选项字典（目的地 / 服务类型 / 价格区间 / 评分 / 可约时间）
 *
 * 【关键约束】
 *   - 本页唯一筛选状态源是 this.filters；抽屉里改的是 this.draftFilters（草稿）
 *   - 条件变化 → page=1 + 清空旧列表 + 滚动回顶
 *   - requestId 校验：只接受最后一次请求的结果（丢弃过期响应）
 *   - loadingMore 互斥锁
 *   - 关键词输入 300ms 防抖后直接请求列表（最终契约无联想端点）
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const { ROUTES, SORT_OPTIONS } = require('../../utils/constants');

/** 输入防抖时长（毫秒） */
const DEBOUNCE_DELAY = 300;

Page({
  data: {
    /** 关键词 */
    keyword: '',
    /** 输入框占位文案 */
    placeholder: '搜地陪昵称、服务名、城市',
    /** 是否自动聚焦 */
    autoFocus: false,
    /** 输入框聚焦态 */
    inputFocused: false,
    /** 联想浮层 */

    /** 生效中的筛选条件 */
    filters: {
      destination: '',
      serviceTypes: [],
      priceRangeIndex: -1,
      rating: null,
      availableWithin: '',
    },
    /** 抽屉草稿条件 */
    draftFilters: {
      destination: '',
      serviceTypes: [],
      priceRangeIndex: -1,
      rating: null,
      availableWithin: '',
    },
    /** 筛选项字典 */
    filterOptions: {
      cities: [],
      serviceTypes: [],
      priceRanges: [],
      ratings: [],
      availableWindows: [],
    },
    /** 排序 */
    sortBy: 'default',
    sortOptions: SORT_OPTIONS,

    /** 结果列表 */
    list: [],
    /** 已生效条件数量 */
    activeFilterCount: 0,
    /** 已生效条件 chip */
    activeChips: [],
    /** 抽屉内预估结果数 */
    filteredCount: 0,

    /** 加载中（首屏） */
    loading: true,
    /** 首屏错误 */
    error: '',
    /** 加载更多状态：idle/loading/nomore/error */
    loadMoreStatus: 'idle',
    /** 是否正在加载更多（互斥锁） */
    loadingMore: false,
    /** 当前页 */
    page: 1,
    /** 是否还有更多 */
    hasMore: false,
    /** 离线 */
    offline: false,
    /** 非法筛选值提示 */
    filterError: false,
    /** 筛选抽屉是否打开 */
    filterPanelOpen: false,
  },

  /** 请求序号：用于丢弃过期响应 */
  _requestId: 0,
  /** 防抖定时器 */
  _debounceTimer: null,

  onLoad: function (options) {
    const opts = options || {};
    const filters = {
      destination: opts.city || '',
      serviceTypes: opts.serviceType ? [opts.serviceType] : [],
      priceRangeIndex: -1,
      rating: null,
      availableWithin: '',
    };
    this.setData({
      filters: filters,
      draftFilters: Object.assign({}, filters, { serviceTypes: filters.serviceTypes.slice() }),
      keyword: opts.keyword || '',
      // from=home 且无 keyword → 自动聚焦；有关键词则不聚焦，避免键盘遮挡结果
      autoFocus: opts.from === 'home' && !opts.keyword,
      placeholder: '搜地陪昵称、服务名、城市',
    });
    this.loadFilterOptions();
    this.loadList(true);
  },

  onUnload: function () {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
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
   * 加载筛选项字典
   */
  loadFilterOptions: function () {
    api
      .getFilterOptions()
      .then((data) => {
        if (!data) return;
        this.setData({ filterOptions: data });
        this.updateDraftCount();
      })
      .catch(() => {
        /* 字典失败不阻断主流程 */
      });
  },

  /**
   * 拉取结果列表
   * @param {boolean} reset 是否重置（page=1 + 清空列表 + 滚动回顶）
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

    const filters = this.data.filters;
    const priceRange =
      filters.priceRangeIndex >= 0 && this.data.filterOptions.priceRanges[filters.priceRangeIndex]
        ? this.data.filterOptions.priceRanges[filters.priceRangeIndex]
        : null;

    // 参数名对齐最终契约：destination / minPrice / maxPrice / rating / sort（服务端单位：价格按「元」）
    // 同时带上别名，兼容服务端两种命名（destination|city、minPrice|priceMin、rating|minRating、sort|sortBy）
    const query = {
      keyword: this.data.keyword,
      destination: filters.destination,
      city: filters.destination,
      serviceType: filters.serviceTypes.length ? filters.serviceTypes[0] : '',
      minPrice: priceRange ? priceRange.min : '',
      maxPrice: priceRange ? priceRange.max === null ? '' : priceRange.max : '',
      priceMin: priceRange ? priceRange.min : '',
      priceMax: priceRange ? priceRange.max === null ? '' : priceRange.max : '',
      rating: filters.rating === null ? '' : filters.rating,
      minRating: filters.rating === null ? '' : filters.rating,
      availableWithin: filters.availableWithin,
      sort: this.data.sortBy,
      sortBy: this.data.sortBy,
      page: this.data.page,
      pageSize: 20,
    };

    return api
      .getGuides(query)
      .then((data) => {
        // 丢弃过期响应
        if (requestId !== self._requestId) return;
        if (!data) {
          self.setData({ loading: false, loadingMore: false, loadMoreStatus: 'idle' });
          return;
        }
        const list = data.list || [];
        const newList = reset ? list : self.data.list.concat(list);
        self.setData({
          loading: false,
          loadingMore: false,
          error: '',
          list: newList,
          page: data.page || self.data.page,
          hasMore: !!data.hasMore,
          loadMoreStatus: data.hasMore ? 'idle' : 'nomore',
        });
        self.updateActiveChips();
      })
      .catch(() => {
        if (requestId !== self._requestId) return;
        if (reset) {
          self.setData({ loading: false, error: 'load_failed', loadMoreStatus: 'idle' });
        } else {
          // 加载更多失败：保留已有内容 + 可点「重试」
          self.setData({ loading: false, loadingMore: false, loadMoreStatus: 'error' });
        }
      });
  },

  /**
   * 计算并更新已生效条件 chip + 数量
   */
  updateActiveChips: function () {
    const filters = this.data.filters;
    const chips = [];
    if (filters.destination) {
      chips.push({ key: 'destination', label: filters.destination, isPrice: false });
    }
    const typeNames = {};
    this.data.filterOptions.serviceTypes.forEach(function (t) {
      typeNames[t.code] = t.name;
    });
    filters.serviceTypes.forEach(function (code) {
      chips.push({ key: 'serviceType:' + code, label: typeNames[code] || code, isPrice: false });
    });
    if (filters.priceRangeIndex >= 0 && this.data.filterOptions.priceRanges[filters.priceRangeIndex]) {
      chips.push({
        key: 'priceRange',
        label: this.data.filterOptions.priceRanges[filters.priceRangeIndex].label,
        isPrice: true,
      });
    }
    if (filters.rating !== null) {
      const rating = this.data.filterOptions.ratings.filter(function (r) {
        return r.value === filters.rating;
      })[0];
      chips.push({ key: 'rating', label: rating ? rating.label : filters.rating + ' 分以上', isPrice: false });
    }
    if (filters.availableWithin) {
      const win = this.data.filterOptions.availableWindows.filter(function (w) {
        return w.code === filters.availableWithin;
      })[0];
      chips.push({ key: 'availableWithin', label: win ? win.label : filters.availableWithin, isPrice: false });
    }
    this.setData({ activeChips: chips, activeFilterCount: chips.length });
  },

  /**
   * 更新抽屉内的预估结果数（本地粗算，仅用于按钮文案）
   */
  updateDraftCount: function () {
    this.setData({ filteredCount: this.data.list.length || 0 });
  },

  /* ---------------- 输入与联想 ---------------- */

  /**
   * 输入关键词（300ms 防抖 → 直接拉结果）
   * @param {object} e 事件
   */
  onInput: function (e) {
    const value = e.detail.value;
    this.setData({ keyword: value });
    if (this._debounceTimer) clearTimeout(this._debounceTimer);

    if (!value) {
      // 清空 → 立即拉全量
      this.loadList(true);
      return;
    }

    const self = this;
    this._debounceTimer = setTimeout(function () {
      self.loadList(true);
    }, DEBOUNCE_DELAY);
  },

  /**
   * 输入框聚焦
   */
  onFocus: function () {
    this.setData({ inputFocused: true });
  },

  /**
   * 输入框失焦
   */
  onBlur: function () {
    this.setData({ inputFocused: false });
  },

  /**
   * 清空搜索词
   */
  onClearKeyword: function () {
    this.setData({ keyword: '' });
    this.loadList(true);
  },

  /**
   * 提交搜索
   */
  onConfirm: function () {
    if (this.data.keyword) storage.pushSearchHistory(this.data.keyword);
    this.loadList(true);
  },

  /* ---------------- 排序 ---------------- */

  /**
   * 切换排序
   * @param {object} e 事件
   */
  onSortChange: function (e) {
    this.setData({ sortBy: e.detail.sortBy });
    this.loadList(true);
  },

  /* ---------------- 筛选抽屉 ---------------- */

  /**
   * 打开筛选抽屉（保留当前条件，让用户微调）
   */
  onOpenFilter: function () {
    this.setData({
      filterPanelOpen: true,
      draftFilters: Object.assign({}, this.data.filters, {
        serviceTypes: this.data.filters.serviceTypes.slice(),
      }),
    });
    this.updateDraftCount();
  },

  /**
   * 关闭筛选抽屉（不生效）
   */
  onCloseFilter: function () {
    this.setData({ filterPanelOpen: false });
  },

  /**
   * 切换目的地
   * @param {object} e 事件
   */
  onToggleCity: function (e) {
    const name = e.currentTarget.dataset.name;
    const draft = Object.assign({}, this.data.draftFilters);
    draft.destination = draft.destination === name ? '' : name;
    this.setData({ draftFilters: draft });
  },

  /**
   * 切换服务类型（多选）
   * @param {object} e 事件
   */
  onToggleServiceType: function (e) {
    const code = e.currentTarget.dataset.code;
    const draft = Object.assign({}, this.data.draftFilters);
    const list = draft.serviceTypes.slice();
    const idx = list.indexOf(code);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(code);
    }
    draft.serviceTypes = list;
    this.setData({ draftFilters: draft });
  },

  /**
   * 选择价格区间（单选）
   * @param {object} e 事件
   */
  onSelectPriceRange: function (e) {
    const index = Number(e.currentTarget.dataset.index);
    const draft = Object.assign({}, this.data.draftFilters);
    draft.priceRangeIndex = draft.priceRangeIndex === index ? -1 : index;
    this.setData({ draftFilters: draft });
  },

  /**
   * 选择评分
   * @param {object} e 事件
   */
  onSelectRating: function (e) {
    const value = Number(e.currentTarget.dataset.value);
    const draft = Object.assign({}, this.data.draftFilters);
    draft.rating = draft.rating === value ? null : value;
    this.setData({ draftFilters: draft });
  },

  /**
   * 选择最快可约
   * @param {object} e 事件
   */
  onSelectAvailable: function (e) {
    const code = e.currentTarget.dataset.code;
    const draft = Object.assign({}, this.data.draftFilters);
    draft.availableWithin = draft.availableWithin === code ? '' : code;
    this.setData({ draftFilters: draft });
  },

  /**
   * 重置筛选（不自动请求，需点「查看 N 个结果」才生效）
   */
  onResetFilter: function () {
    this.setData({
      draftFilters: {
        destination: '',
        serviceTypes: [],
        priceRangeIndex: -1,
        rating: null,
        availableWithin: '',
      },
    });
  },

  /**
   * 应用筛选 → 关闭抽屉 + 拉结果 + 滚动回顶
   */
  onApplyFilter: function () {
    this.setData({
      filterPanelOpen: false,
      filters: Object.assign({}, this.data.draftFilters, {
        serviceTypes: this.data.draftFilters.serviceTypes.slice(),
      }),
    });
    this.loadList(true);
  },

  /**
   * 移除单个已选条件 chip
   * @param {object} e 事件
   */
  onRemoveChip: function (e) {
    const key = e.currentTarget.dataset.key;
    const filters = Object.assign({}, this.data.filters);
    filters.serviceTypes = this.data.filters.serviceTypes.slice();
    if (key === 'destination') filters.destination = '';
    else if (key === 'priceRange') filters.priceRangeIndex = -1;
    else if (key === 'rating') filters.rating = null;
    else if (key === 'availableWithin') filters.availableWithin = '';
    else if (key.indexOf('serviceType:') === 0) {
      const code = key.slice('serviceType:'.length);
      filters.serviceTypes = filters.serviceTypes.filter(function (c) {
        return c !== code;
      });
    }
    this.setData({ filters: filters });
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
   * 点击地陪卡 → 详情页
   * @param {object} e 事件
   */
  onGuideTap: function (e) {
    const guideId = e.detail.guideId;
    if (!guideId) return;
    wx.navigateTo({ url: ROUTES.GUIDE_DETAIL + '?guideId=' + encodeURIComponent(guideId) + '&from=search' });
  },
});
