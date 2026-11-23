/**
 * guide-card · 地陪卡片组件
 * ---------------------------------------------------------------------------
 * 数据来源：GET /api/v1/guides → data.list[]（摘要结构，与首页推荐共用）
 * 整卡可点 → 跳转地陪详情页 P7（/pages/guide/detail?guideId=xxx）
 */
const format = require('../../utils/format');
const { PRICE_UNIT_TEXT } = require('../../utils/constants');

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 地陪摘要对象 */
    guide: {
      type: Object,
      value: {},
    },
    /** 横向滑排模式（首页推荐模块） */
    horizontal: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isResting: false,
    ariaLabel: '',
  },

  observers: {
    guide: function (guide) {
      if (!guide) {
        this.setData({ isResting: false, ariaLabel: '地陪信息加载中' });
        return;
      }
      const unit = PRICE_UNIT_TEXT[guide.priceUnit] || '次';
      const priceText =
        guide.priceAmount === null || guide.priceAmount === undefined
          ? '价格面议'
          : format.amountToYuan(guide.priceAmount) + ' 元每' + unit;
      const ratingText = guide.rating ? '评分 ' + guide.rating : '暂无评分';
      this.setData({
        isResting: !!guide.isResting,
        ariaLabel:
          guide.name +
          '，' +
          (guide.title || '') +
          '，' +
          ratingText +
          '，' +
          priceText +
          '，点击查看详情',
      });
    },
  },

  methods: {
    /**
     * 整卡点击 → 触发 tap 事件（由页面负责跳转）
     * @param {object} e 事件
     */
    onTap: function (e) {
      this.triggerEvent('tap', { guideId: this.data.guide ? this.data.guide.guideId : '' });
    },
  },
});
