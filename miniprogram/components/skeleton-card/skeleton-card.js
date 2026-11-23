/**
 * skeleton-card · 骨架屏组件
 * ---------------------------------------------------------------------------
 * type: list（列表项骨架）/ card（卡片骨架）/ msg（消息页行骨架）
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 骨架类型 */
    type: {
      type: String,
      value: 'list',
    },
    /** 骨架条数 */
    count: {
      type: Number,
      value: 3,
    },
  },
});
