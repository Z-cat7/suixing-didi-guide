/**
 * rating-stars · 评分星级组件
 * ---------------------------------------------------------------------------
 * 纯展示组件：把 0–5 的分值拆成 5 颗星（full / half / empty）。
 * 图形本身 aria-hidden="true"，由父级把分值写进无障碍名，避免碎读。
 */
Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    /** 评分 0.0–5.0，1 位小数 */
    rating: {
      type: Number,
      value: 0,
      observer: function () {
        this.buildStars();
      },
    },
    /** 星级尺寸：sm（默认）/ lg */
    size: {
      type: String,
      value: 'sm',
    },
  },

  data: {
    /** [{ full, half }] × 5 */
    stars: [],
  },

  attached: function () {
    this.buildStars();
  },

  methods: {
    /**
     * 构建星级数组
     */
    buildStars: function () {
      const score = Math.max(0, Math.min(5, Number(this.data.rating) || 0));
      const list = [];
      for (let i = 1; i <= 5; i++) {
        if (score >= i) {
          list.push({ full: true, half: false });
        } else if (score >= i - 0.5) {
          list.push({ full: false, half: true });
        } else {
          list.push({ full: false, half: false });
        }
      }
      this.setData({ stars: list });
    },
  },
});
