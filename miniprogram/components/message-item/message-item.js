/**
 * message-item · 消息列表项组件
 * ---------------------------------------------------------------------------
 * variant:
 *   conversation —— 会话项（未读角标 + 最后消息预览 + 时间）
 *   notification —— 系统通知项（分类图标 + 标题 + 正文 + 未读点）
 *
 * 数据来源：GET /api/v1/conversations / GET /api/v1/notices
 */
const format = require('../../utils/format');
const { MESSAGE_TYPE } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 变体 */
    variant: {
      type: String,
      value: 'conversation',
    },
    /** 列表项数据 */
    item: {
      type: Object,
      value: {},
    },
  },

  data: {
    timeText: '',
    previewText: '',
    initial: '伴',
    badgeText: '',
    ariaLabel: '',
    categoryIcon: '·',
  },

  observers: {
    'variant, item': function (variant, item) {
      if (!item) return;
      const timeText = format.formatRelativeTime(item.lastMessageAt || item.createdAt);

      if (variant === 'conversation') {
        const preview = this.buildPreview(item);
        const badgeText = item.unreadCount > 99 ? '99+' : String(item.unreadCount || 0);
        this.setData({
          timeText: timeText,
          previewText: preview,
          initial: item.guideName ? item.guideName.charAt(0) : '伴',
          badgeText: badgeText,
          ariaLabel:
            item.guideName +
            '，' +
            preview +
            '，' +
            timeText +
            (item.unreadCount > 0 ? '，' + item.unreadCount + ' 条未读' : '') +
            (item.isActive ? '' : '，会话已完成'),
        });
        return;
      }

      // 系统通知
      const iconMap = { order: '单', refund: '退', system: '通' };
      this.setData({
        timeText: timeText,
        previewText: item.content,
        categoryIcon: iconMap[item.category] || '通',
        ariaLabel: item.title + '，' + item.content + '，' + timeText + (item.isRead ? '' : '，未读'),
      });
    },
  },

  methods: {
    /**
     * 构建会话预览文本（图片 / 订单卡由前端映射）
     * @param {object} item 会话项
     * @returns {string}
     */
    buildPreview: function (item) {
      if (item.lastMessageType === MESSAGE_TYPE.IMAGE) return '[图片]';
      if (item.lastMessageType === MESSAGE_TYPE.ORDER_CARD) return '[订单]';
      if (item.lastMessageType === MESSAGE_TYPE.SYSTEM) return '[系统消息]';
      return format.truncate(item.lastMessageContent || '', 40);
    },

    /**
     * 点击列表项 → 抛事件（页面负责跳转）
     */
    onTap: function () {
      this.triggerEvent('tap', { item: this.data.item, variant: this.data.variant });
    },
  },
});
