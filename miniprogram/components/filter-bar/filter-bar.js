/**
 * filter-bar · 筛选 chip 条组件
 * ---------------------------------------------------------------------------
 * 包含两部分：
 *   1. 排序行（综合 / 价格↑ / 价格↓ / 评分）—— 点选立即重新请求
 *   2. 「筛选」按钮（打开筛选抽屉）—— 带已选条件数量角标
 *
 * 【纪律】价格区间 chip 是全 App 唯一允许的红色 chip，由搜索页的筛选面板渲染，
 *        本组件只负责排序与筛选入口。
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 排序项列表 [{ code, label }] */
    sortOptions: {
      type: Array,
      value: [],
    },
    /** 当前排序 */
    sortBy: {
      type: String,
      value: 'default',
    },
    /** 已生效筛选条件数量 */
    activeFilterCount: {
      type: Number,
      value: 0,
    },
  },

  methods: {
    /**
     * 点击排序项
     * @param {object} e 事件
     */
    onSort: function (e) {
      const code = e.currentTarget.dataset.code;
      if (!code || code === this.data.sortBy) return;
      this.triggerEvent('sortchange', { sortBy: code });
    },

    /**
     * 点击筛选按钮
     */
    onFilter: function () {
      this.triggerEvent('filter');
    },
  },
});
