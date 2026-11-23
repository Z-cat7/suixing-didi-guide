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
    /**
     * 价格单位文案（服务端下发的 priceUnitText，如「小时」「次」）
     * 传了就直接用，不再由前端拼装；不传则回退到 unit 枚举映射
     */
    unitText: {
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
    'amount, originAmount, unit, unitText': function (amount, originAmount, unit, unitText) {
      this.setData({
        yuan: format.amountToYuan(amount),
        originYuan: originAmount ? format.amountToYuan(originAmount) : '',
        // 单位文案优先用服务端下发的 priceUnitText，前端不自行拼装
        unitText: unitText || PRICE_UNIT_TEXT[unit] || '',
      });
    },
  },
});
