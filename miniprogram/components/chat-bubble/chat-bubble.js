/**
 * chat-bubble · 聊天气泡组件
 * ---------------------------------------------------------------------------
 * 支持三种消息类型：text / system / order_card
 * 【铁律】status（sending / sent / failed）是本地态 + 服务端确认；
 *        重发必须复用同一个 clientMessageId（由页面负责，组件只抛事件）
 */
const format = require('../../utils/format');
const { SENDER_TYPE } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 消息对象 */
    message: {
      type: Object,
      value: {},
    },
    /** 是否是自己发的 */
    isSelf: {
      type: Boolean,
      value: false,
    },
    /** 地陪头像 */
    guideAvatarUrl: {
      type: String,
      value: '',
    },
    /** 地陪昵称（取首字做占位） */
    guideName: {
      type: String,
      value: '',
    },
  },

  data: {
    timeText: '',
    guideInitial: '伴',
    totalYuan: '0',
    orderSummary: {},
  },

    observers: {
    'message, isSelf, guideAvatarUrl, guideName': function (message, isSelf, avatarUrl, guideName) {
      if (!message) return;
      const summary = message.orderSummary || {};
      this.setData({
        timeText: format.formatDateTime(message.sentAt),
        guideInitial: guideName ? guideName.charAt(0) : '伴',
        totalYuan: summary.totalAmount !== undefined && summary.totalAmount !== null ? format.amountToYuan(summary.totalAmount) : '0',
        // scheduledAt 是服务端回显的**服务时间**（仅展示）；下单提交用的是 slotId
        orderSummary: Object.assign({}, summary, {
          scheduledAtText: format.formatDateTime(summary.scheduledAt),
        }),
      });
    },
  },

  methods: {
    /**
     * 点击失败气泡 → 触发重发（复用同一 clientMessageId）
     */
    onRetry: function () {
      this.triggerEvent('retry', { clientMessageId: this.data.message.clientMessageId });
    },

    /**
     * 点击订单卡 → 触发跳转订单详情
     */
    onOrderCardTap: function () {
      this.triggerEvent('ordertap', {
        orderId: this.data.orderSummary.orderId,
        orderSummary: this.data.orderSummary,
      });
    },
  },
});
