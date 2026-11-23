/**
 * empty-state · 空状态组件
 * ---------------------------------------------------------------------------
 * 覆盖 5 态中的：空态 / 错误态 / 无权限态 / 离线态（加载中用 skeleton-card）
 * 文案统一取自 UX 规范 §A.3.4
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 类型：empty（默认）/ error / offline / forbidden */
    type: {
      type: String,
      value: 'empty',
    },
    /** 主标题 */
    title: {
      type: String,
      value: '',
    },
    /** 描述文案 */
    desc: {
      type: String,
      value: '',
    },
    /** 主行动按钮文案 */
    actionText: {
      type: String,
      value: '',
    },
    /** 次行动按钮文案 */
    secondaryText: {
      type: String,
      value: '',
    },
  },

  methods: {
    /**
     * 主行动
     */
    onAction: function () {
      this.triggerEvent('action');
    },

    /**
     * 次行动
     */
    onSecondary: function () {
      this.triggerEvent('secondary');
    },
  },
});
