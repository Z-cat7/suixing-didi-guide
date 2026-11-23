/**
 * order-status-badge · 订单状态徽章组件
 * ---------------------------------------------------------------------------
 * 【铁律】**样式决策完全由服务端下发**：
 *   - `statusBadge` —— 徽章类名后缀（服务端从 `models/statusMap.js` 产出）
 *   - `statusText`  —— 徽章文字（必须渲染，不能只靠颜色区分状态）
 *
 * 本组件**不维护「状态 → 类名」映射表**（那是服务端职责）。
 *
 * 【白名单兜底】(G-83)
 *   服务端下发未知值时 → 降级 `.dipi-badge--closed`（中性灰）+ 仍显示 statusText，
 *   **不得渲染出不存在的类**（否则徽章丢失底色变成默认样式，视觉全错）。
 *   白名单来自 `utils/constants.js` 的 ORDER_STATUS_BADGE_WHITELIST
 *   （由静态检查脚本断言与 components.wxss 的实际类名集合一致）。
 */
const { ORDER_STATUS_BADGE_WHITELIST, ORDER_STATUS_BADGE_FALLBACK } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /**
     * 徽章类名后缀（服务端下发）
     * 白名单：pending / ongoing / review / refunding / done / closed
     */
    statusBadge: {
      type: String,
      value: '',
    },
    /** 状态中文文案（服务端下发） */
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
    /** 最终用于拼接类名的后缀（已做白名单兜底） */
    badgeClass: ORDER_STATUS_BADGE_FALLBACK,
  },

  observers: {
    statusBadge: function (badge) {
      // 白名单兜底：未知值降级为 closed
      const safe =
        badge && ORDER_STATUS_BADGE_WHITELIST.indexOf(badge) >= 0
          ? badge
          : ORDER_STATUS_BADGE_FALLBACK;
      this.setData({ badgeClass: safe });
    },
  },
});
