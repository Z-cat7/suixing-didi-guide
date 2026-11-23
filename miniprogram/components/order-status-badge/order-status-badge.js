/**
 * order-status-badge · 订单状态徽章组件
 * ---------------------------------------------------------------------------
 * 【铁律】statusText 一律来自服务端（前端不自行翻译状态文案）；
 *        badgeClass 仅是纯视觉映射（UX 规范 §A.3.3 的样式类表），不含任何操作语义。
 */
const { getOrderBadgeClass } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 订单状态枚举 */
    status: {
      type: String,
      value: '',
    },
    /** 状态文案（服务端下发） */
    statusText: {
      type: String,
      value: '',
    },
    /** 尺寸：md（默认）/ sm */
    size: {
      type: String,
      value: 'md',
    },
  },

  data: {
    badgeClass: 'dipi-badge--closed',
  },

  observers: {
    status: function (status) {
      this.setData({ badgeClass: getOrderBadgeClass(status) });
    },
  },
});
