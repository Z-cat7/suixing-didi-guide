/**
 * dipi-tabbar · 自定义 TabBar 组件
 * ---------------------------------------------------------------------------
 * 4 项：首页 / 消息 / 订单 / 我的（顺序固定，见 UX 规范 §A.1）
 * 消息项带未读数红点（唯一允许的红色实心块，见视觉规范 §9）
 *
 * 【用法】
 *   1. app.json → tabBar.custom = true
 *   2. custom-tab-bar/index.json → usingComponents 指向 components/dipi-tabbar
 *   3. 各 Tab 页 onShow → this.getTabBar().setData({ active: 'home' })
 */
const { TAB_BAR_ITEMS } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
    multipleSlots: false,
  },

  properties: {
    /** 当前选中项 key */
    active: {
      type: String,
      value: 'home',
    },
    /** 未读总数 */
    unreadTotal: {
      type: Number,
      value: 0,
    },
  },

  data: {
    list: TAB_BAR_ITEMS,
    iconText: {
      home: '首页',
      message: '消息',
      order: '订单',
      profile: '我的',
    },
  },

  methods: {
    /**
     * 点击 Tab → switchTab（TabBar 页之间不能用 navigateTo）
     * @param {object} e 事件
     */
    onTap: function (e) {
      const key = e.currentTarget.dataset.key;
      const path = e.currentTarget.dataset.path;
      if (!key || !path) return;
      if (key === this.data.active) return;
      wx.switchTab({ url: path });
    },
  },
});
