/**
 * load-more · 触底加载组件
 * ---------------------------------------------------------------------------
 * 加载更多失败时保留已有内容 + 可点「重试」（不用 Toast，Toast 会消失）
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 状态：idle / loading / nomore / error */
    status: {
      type: String,
      value: 'idle',
    },
  },

  methods: {
    /**
     * 点击重试
     */
    onRetry: function () {
      this.triggerEvent('retry');
    },
  },
});
