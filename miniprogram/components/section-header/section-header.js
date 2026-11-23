/**
 * section-header · 模块标题组件
 * ---------------------------------------------------------------------------
 * 用法：<section-header title="推荐地陪" more="更多" bind:more="onMore" />
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 区块标题 */
    title: {
      type: String,
      value: '',
    },
    /** 右侧「更多」文案；为空则不渲染 */
    more: {
      type: String,
      value: '',
    },
  },

  methods: {
    /**
     * 点击「更多」
     */
    onMore: function () {
      this.triggerEvent('more');
    },
  },
});
