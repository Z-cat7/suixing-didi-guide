/**
 * price-tag · 价格标签组件
 * ---------------------------------------------------------------------------
 * 金额为「整数分」，本组件负责分 → 元；单位由 priceUnit 决定，独立展示。
 * 注意：只做展示，不做任何价格计算。
 */
const format = require('../../utils/format');
const { PRICE_UNIT_TEXT } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 金额（整数分）；传 null / undefined 显示「价格面议」 */
    amount: {
      type: null,
      value: null,
    },
    /** 划线原价（整数分） */
    originAmount: {
      type: null,
      value: null,
    },
    /** 价格单位枚举 */
    unit: {
      type: String,
      value: '',
    },
    /** 尺寸：sm（默认）/ lg */
    size: {
      type: String,
      value: 'sm',
    },
    /** 左对齐 */
    left: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    yuan: '0',
    originYuan: '',
    unitText: '',
  },

  observers: {
    'amount, originAmount, unit': function (amount, originAmount, unit) {
      this.setData({
        yuan: format.amountToYuan(amount),
        originYuan: originAmount ? format.amountToYuan(originAmount) : '',
        unitText: PRICE_UNIT_TEXT[unit] || '',
      });
    },
  },
});
