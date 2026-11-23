/**
 * 下单确认页 P8（独立二级页）
 * ---------------------------------------------------------------------------
 * 数据来源接口：
 *   GET  /api/v1/guides/:guideId —— 地陪详情（取 data.guide 的 services 与 availableSlots）
 *   GET  /api/v1/me               —— 预填联系人（昵称 / 手机号）
 *   POST /api/v1/orders           —— 创建订单（带 idempotencyKey）
 *
 * 规格：docs/02-ux-spec.md §B.8
 *
 * 【关键约束】
 *   1. **价格**：实时算价仅供预览（priceAmount × travelers + extraAmount − discountAmount）；
 *      提交后**以服务端返回的 totalAmount 为准**，不一致 → 弹层「价格已更新，请确认」
 *   2. **幂等提交**：idempotencyKey 进入页面生成一次，重试复用同一 key
 *   3. **草稿**：`dipi:draft:order`；guideId 不一致 → 丢弃；回填不覆盖本次 URL 传入的 serviceId
 *   4. **slotId 原样回传**：提交只传 slotId，不传 date + timeSlot 组合
 *   5. 吸底 CTA 是页面内唯一实心主按钮
 */
const api = require('../../utils/api');
const storage = require('../../utils/storage');
const format = require('../../utils/format');
const { ROUTES, PRICE_UNIT_TEXT } = require('../../utils/constants');

/** 草稿落盘节流时长（毫秒） */
const DRAFT_THROTTLE = 500;

Page({
  data: {
    /** 地陪 ID */
    guideId: '',
    /** 来源会话（聊天页下单时带） */
    conversationId: '',
    /** 地陪信息 */
    guide: {},
    /** 地陪名首字 */
    guideInitial: '伴',
    /** 可选服务项（已装饰） */
    services: [],
    /** 选中的服务项 ID */
    selectedServiceId: '',
    /** 选中的服务项对象 */
    selectedService: null,
    /** 时段（按日期分组） */
    slotGroups: [],
    /** 全部时段（扁平） */
    slots: [],
    /** 选中的时段 ID */
    selectedSlotId: '',
    /** 选中的时段对象 */
    selectedSlot: null,
    /** 同行人数 */
    travelers: 1,
    /** 人数上限（来自服务项） */
    maxTravelers: 20,
    /** 联系人姓名 */
    contactName: '',
    /** 联系人手机号 */
    contactPhone: '',
    /** 见面地点 */
    meetingPoint: '',
    /** 备注 */
    remark: '',

    /** 金额（整数分）：unitPriceAmount 单价 / subtotalAmount 小计 / totalAmount 总额 */
    unitPriceAmount: 0,
    subtotalAmount: 0,
    extraAmount: 0,
    discountAmount: 0,
    totalAmount: 0,
    /** 金额展示（元） */
    unitPriceYuan: '0',
    subtotalYuan: '0',
    extraYuan: '0',
    discountYuan: '0',
    totalYuan: '0',
    /** 人数下限（来自服务项 minTravelers） */
    minTravelers: 1,

    /** 草稿回填提示 */
    draftRestored: false,
    /** 草稿地陪不一致（已丢弃） */
    draftDiscarded: false,
    /** 支付未完成提示 */
    payPending: false,

    /** 加载中 */
    loading: true,
    /** 错误：'' / 'load_failed' / 'not_found' */
    error: '',
    /** 提交中 */
    submitting: false,
    /** CTA 禁用 */
    submitDisabled: true,
    /** CTA 上方错误文案 */
    ctaError: '',
    /** 人数错误 */
    travelersError: '',
    /** 联系人错误 */
    contactError: '',
    /** 离线 */
    offline: false,
  },

  /** 幂等键（进入页面生成一次，重试复用） */
  _idempotencyKey: '',
  /** 草稿落盘定时器 */
  _draftTimer: null,

  onLoad: function (options) {
    const opts = options || {};
    const guideId = opts.guideId || '';
    const serviceId = opts.serviceId || '';
    const conversationId = opts.conversationId || '';

    if (!guideId) {
      wx.showToast({ title: '页面参数错误', icon: 'none', duration: 2000 });
      wx.navigateBack();
      return;
    }

    // 幂等键：进入页面生成一次；请求超时重试复用同一 key
    this._idempotencyKey = 'idem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    this.setData({ guideId: guideId, conversationId: conversationId });

    // 草稿回填：guideId 不一致 → 丢弃（不提示、不回填）
    const draft = storage.getOrderDraft();
    let draftRestored = false;
    let draftDiscarded = false;
    if (draft) {
      if (draft.guideId === guideId) {
        draftRestored = true;
        this.setData({
          contactName: draft.contactName || '',
          contactPhone: draft.contactPhone || '',
          meetingPoint: draft.meetingPoint || '',
          remark: draft.remark || '',
          travelers: draft.travelers || 1,
          selectedSlotId: draft.slotId || '',
          // 回填**不覆盖**本次 URL 传入的 serviceId
          selectedServiceId: serviceId || draft.serviceId || '',
        });
      } else {
        draftDiscarded = true;
        storage.clearOrderDraft();
      }
    }
    this.setData({ draftRestored: draftRestored, draftDiscarded: draftDiscarded });

    this.loadDetail(guideId, serviceId);
    this.prefillContact();
  },

  onUnload: function () {
    // 立即落盘草稿（防止 500ms 节流窗口内退出导致草稿丢失）
    this.flushDraft();
  },

  /**
   * 网络状态变化
   * @param {boolean} online 是否在线
   */
  onNetworkChange: function (online) {
    this.setData({ offline: !online });
    this.updateSubmitState();
  },

  /**
   * 预填联系人（来自用户资料）
   */
  prefillContact: function () {
    const app = getApp();
    const user = app.globalData.user || storage.getProfile();
    if (!user) return;
    // 草稿回填优先，不覆盖用户已填内容
    if (!this.data.contactName && user.nickname) {
      this.setData({ contactName: user.nickname });
    }
    if (!this.data.contactPhone && user.phoneMasked) {
      // 脱敏手机号不能直接提交，留空由用户填写
      this.setData({ contactPhone: '' });
    }
  },

  /**
   * 拉取地陪详情（拿服务项与可约时段）
   * @param {string} guideId 地陪 ID
   * @param {string} serviceId URL 传入的预选服务项
   */
  loadDetail: function (guideId, serviceId) {
    const self = this;
    this.setData({ loading: true, error: '' });
    api
      .getGuideDetail(guideId)
      .then(function (data) {
        if (!data) {
          self.setData({ loading: false, error: 'not_found' });
          return;
        }
        const services = (data.services || []).map(function (item) {
          return Object.assign({}, item, {
            priceText:
              format.amountToYuan(item.priceAmount) +
              ' 元 / ' +
              (PRICE_UNIT_TEXT[item.priceUnit] || '次'),
          });
        });
        const slots = data.availableSlots || [];
        const slotGroups = self.groupSlots(slots);

        self.setData({
          loading: false,
          error: '',
          guide: data,
          guideInitial: data.name ? data.name.charAt(0) : '伴',
          services: services,
          slots: slots,
          slotGroups: slotGroups,
        });

        // 服务项：URL 传入优先 → 否则第一个可约服务项
        let selected = null;
        if (serviceId) {
          selected = services.filter(function (s) {
            return s.serviceId === serviceId;
          })[0];
        }
        if (!selected) {
          selected = services.filter(function (s) {
            return s.isAvailable !== false;
          })[0];
        }
        if (selected) self.setData({ selectedServiceId: selected.serviceId, selectedService: selected });

        // 时段：默认选第一个可约时段
        if (!self.data.selectedSlotId) {
          const first = slots.filter(function (s) {
            return s.available !== false;
          })[0];
          if (first) self.setData({ selectedSlotId: first.slotId, selectedSlot: first });
        }

        self.recalcPrice();
        self.updateSubmitState();
      })
      .catch(function (err) {
        const notFound = err && (err.code === 40400 || err.code === 404);
        self.setData({ loading: false, error: notFound ? 'not_found' : 'load_failed' });
      });
  },

  /**
   * 把时段按日期分组
   * @param {array} slots 时段数组
   * @returns {array} [{ date, dateLabel, slots }]
   */
  groupSlots: function (slots) {
    const map = {};
    const order = [];
    slots.forEach(function (slot) {
      const key = slot.date || slot.dateLabel || '';
      if (!map[key]) {
        map[key] = { date: key, dateLabel: slot.dateLabel || slot.date || '', slots: [] };
        order.push(map[key]);
      }
      map[key].slots.push(slot);
    });
    return order;
  },

  /**
   * 实时算价（仅供预览；提交后以服务端为准）
   * priceAmount = service.priceAmount × travelers
   * totalAmount = priceAmount + extraAmount − discountAmount
   */
  recalcPrice: function () {
    const service = this.data.selectedService;
    const travelers = this.data.travelers || 1;
    // 服务项的 priceAmount 是**单价**（分）；小计 = 单价 × 人数
    const unitPriceAmount = service && service.priceAmount ? service.priceAmount : 0;
    const subtotalAmount = unitPriceAmount * travelers;
    const extraAmount = this.data.extraAmount || 0;
    const discountAmount = this.data.discountAmount || 0;
    const totalAmount = Math.max(0, subtotalAmount + extraAmount - discountAmount);
    this.setData({
      unitPriceAmount: unitPriceAmount,
      subtotalAmount: subtotalAmount,
      extraAmount: extraAmount,
      discountAmount: discountAmount,
      totalAmount: totalAmount,
      unitPriceYuan: format.amountToYuan(unitPriceAmount),
      subtotalYuan: format.amountToYuan(subtotalAmount),
      extraYuan: format.amountToYuan(extraAmount),
      discountYuan: format.amountToYuan(discountAmount),
      totalYuan: format.amountToYuan(totalAmount),
      // 人数上下限取自服务项的 minTravelers / maxTravelers
      minTravelers: service && service.minTravelers ? service.minTravelers : 1,
      maxTravelers: service && service.maxTravelers ? service.maxTravelers : 20,
    });
  },

  /* ---------------- 表单交互 ---------------- */

  /**
   * 选择服务项
   * @param {object} e 事件
   */
  onSelectService: function (e) {
    const item = e.currentTarget.dataset.service;
    if (!item) return;
    if (item.isAvailable === false) {
      wx.showToast({ title: '该服务暂不可约', icon: 'none', duration: 2000 });
      return;
    }
    this.setData({ selectedServiceId: item.serviceId, selectedService: item });
    // 人数超出新服务项上限 → 收敛
    if (this.data.travelers > (item.maxTravelers || 20)) {
      this.setData({ travelers: item.maxTravelers || 20 });
    }
    this.recalcPrice();
    this.updateSubmitState();
    this.saveDraft();
  },

  /**
   * 选择时段（记录 slotId，原样保存）
   * @param {object} e 事件
   */
  onSelectSlot: function (e) {
    const slot = e.currentTarget.dataset.slot;
    if (!slot) return;
    if (slot.available === false) {
      // 不可约 → 点击不响应，不 Toast（避免噪音）
      return;
    }
    this.setData({ selectedSlotId: slot.slotId, selectedSlot: slot });
    this.updateSubmitState();
    this.saveDraft();
  },

  /**
   * 人数减
   */
  onTravelersMinus: function () {
    const travelers = Math.max(this.data.minTravelers || 1, this.data.travelers - 1);
    this.setData({ travelers: travelers, travelersError: '' });
    this.recalcPrice();
    this.updateSubmitState();
    this.saveDraft();
  },

  /**
   * 人数加
   */
  onTravelersPlus: function () {
    const max = this.data.maxTravelers || 20;
    if (this.data.travelers >= max) {
      this.setData({ travelersError: '该服务最多 ' + max + ' 人' });
      return;
    }
    const travelers = Math.min(max, this.data.travelers + 1);
    this.setData({ travelers: travelers, travelersError: '' });
    this.recalcPrice();
    this.updateSubmitState();
    this.saveDraft();
  },

  /**
   * 联系人姓名输入
   * @param {object} e 事件
   */
  onContactNameInput: function (e) {
    this.setData({ contactName: e.detail.value, contactError: '' });
    this.updateSubmitState();
  },

  /**
   * 手机号输入
   * @param {object} e 事件
   */
  onContactPhoneInput: function (e) {
    this.setData({ contactPhone: e.detail.value, contactError: '' });
    this.updateSubmitState();
  },

  /**
   * 见面地点输入
   * @param {object} e 事件
   */
  onMeetingPointInput: function (e) {
    this.setData({ meetingPoint: e.detail.value });
  },

  /**
   * 备注输入
   * @param {object} e 事件
   */
  onRemarkInput: function (e) {
    this.setData({ remark: e.detail.value });
  },

  /**
   * 字段失焦 → 落盘草稿
   */
  onFieldBlur: function () {
    this.saveDraft();
  },

  /**
   * 清空草稿
   */
  onClearDraft: function () {
    storage.clearOrderDraft();
    this.setData({
      draftRestored: false,
      contactName: '',
      contactPhone: '',
      meetingPoint: '',
      remark: '',
      travelers: 1,
    });
    this.recalcPrice();
    this.updateSubmitState();
  },

  /**
   * 保存草稿（节流 500ms）
   */
  saveDraft: function () {
    const self = this;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(function () {
      self._draftTimer = null;
      self.flushDraft();
    }, DRAFT_THROTTLE);
  },

  /**
   * 立即落盘草稿
   */
  flushDraft: function () {
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    storage.setOrderDraft({
      guideId: this.data.guideId,
      serviceId: this.data.selectedServiceId,
      slotId: this.data.selectedSlotId,
      travelers: this.data.travelers,
      contactName: this.data.contactName,
      contactPhone: this.data.contactPhone,
      meetingPoint: this.data.meetingPoint,
      remark: this.data.remark,
    });
  },

  /**
   * 更新提交按钮禁用态与错误文案
   */
  updateSubmitState: function () {
    const name = this.data.contactName;
    const phone = this.data.contactPhone;
    let ctaError = '';
    let contactError = '';

    if (!name || !phone) {
      ctaError = '请填写联系人和手机号';
    } else if (!/^\d{11}$/.test(phone)) {
      contactError = '请填写 11 位手机号';
      ctaError = '请填写 11 位手机号';
    }
    if (!this.data.selectedSlotId) {
      ctaError = ctaError || '请选择预约时段';
    }
    if (!this.data.selectedServiceId) {
      ctaError = ctaError || '请先选择一个服务';
    }

    const disabled = !!ctaError || this.data.submitting || this.data.offline;
    this.setData({ ctaError: ctaError, contactError: contactError, submitDisabled: disabled });
  },

  /**
   * 校验表单
   * @returns {boolean} 是否通过
   */
  validate: function () {
    const name = this.data.contactName;
    const phone = this.data.contactPhone;
    let contactError = '';
    let travelersError = '';
    let ok = true;

    if (!name || !phone) {
      contactError = '请填写联系人和手机号';
      ok = false;
    } else if (!/^\d{11}$/.test(phone)) {
      contactError = '请填写 11 位手机号';
      ok = false;
    }
    const minT = this.data.minTravelers || 1;
    const maxT = this.data.maxTravelers || 20;
    if (this.data.travelers < minT || this.data.travelers > maxT) {
      travelersError = '人数需为 ' + minT + '–' + maxT + ' 之间的整数';
      ok = false;
    }
    this.setData({ contactError: contactError, travelersError: travelersError });
    return ok;
  },

  /**
   * 提交订单（幂等）
   */
  onSubmit: function () {
    const self = this;
    if (this.data.submitting) return; // 提交期间禁用，防重复
    if (this.data.offline) {
      wx.showToast({ title: '网络连接已断开，暂不能提交订单', icon: 'none', duration: 2000 });
      return;
    }
    if (!getApp().globalData.isLoggedIn) {
      // 未登录 → 记录回跳 → 登录 → 回跳并回填表单（草稿仍在）
      storage.setRedirect({
        path: ROUTES.ORDER_CREATE,
        query: { guideId: this.data.guideId, serviceId: this.data.selectedServiceId },
      });
      wx.showToast({ title: '登录后即可提交订单', icon: 'none', duration: 2000 });
      getApp().ensureLogin();
      return;
    }
    if (!this.validate()) {
      wx.showToast({ title: '请完善预约信息', icon: 'none', duration: 2000 });
      return;
    }

    this.setData({ submitting: true });
    this.updateSubmitState();

    // 【提交体最终契约】
    //   guideId, serviceId, slotId, travelers, contactName, contactPhone,
    //   meetingPoint, remark?, conversationId?, idempotencyKey
    //   - slotId 是服务端给的稳定唯一标识，**原样回传**，服务端据此原子核销时段
    //   - date / timeSlot 仅用于界面展示，**不参与提交**
    const body = {
      guideId: this.data.guideId,
      serviceId: this.data.selectedServiceId,
      slotId: this.data.selectedSlotId,
      travelers: this.data.travelers,
      contactName: this.data.contactName,
      contactPhone: this.data.contactPhone,
      meetingPoint: this.data.meetingPoint,
      remark: this.data.remark,
      idempotencyKey: this._idempotencyKey,
    };
    if (this.data.conversationId) body.conversationId = this.data.conversationId;

    api
      .createOrder(body)
      .then(function (data) {
        if (!data || !data.orderId) {
          self.setData({ submitting: false });
          self.updateSubmitState();
          wx.showToast({ title: '提交失败，请稍后重试', icon: 'none', duration: 2500 });
          return;
        }
        // 记录幂等键 → 同一 key 重试返回同一 orderId
        storage.setIdempotencyKey(self._idempotencyKey, data.orderId);
        // 提交成功 → 清草稿
        storage.clearOrderDraft();
        self.setData({ submitting: false, totalYuan: format.amountToYuan(data.totalAmount) });
        self.updateSubmitState();

        // 价格与预览不一致 → 弹层「价格已更新，请确认」，不静默改价
        const serverTotal = data.totalAmount;
        if (serverTotal !== undefined && serverTotal !== null && serverTotal !== self.data.totalAmount) {
          self.confirmPriceChange(serverTotal, data);
          return;
        }
        self.payAndRedirect(data);
      })
      .catch(function (err) {
        self.setData({ submitting: false });
        self.updateSubmitState();
        // 时段被抢占 → 提示 + 自动重选第一个可约时段，其余表单保留
        const message = (err && err.message) || '';
        if (message.indexOf('时段') >= 0 || (err && err.code === 40902)) {
          self.reselectFirstSlot();
          wx.showToast({ title: '该时段刚被约走，请选择其他时段', icon: 'none', duration: 2500 });
          return;
        }
        wx.showToast({ title: message || '提交失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 自动重选第一个可约时段
   */
  reselectFirstSlot: function () {
    const first = this.data.slots.filter(function (s) {
      return s.available !== false;
    })[0];
    if (first) {
      this.setData({ selectedSlotId: first.slotId, selectedSlot: first });
    }
    this.updateSubmitState();
  },

  /**
   * 价格已更新确认弹层
   * @param {number} serverTotal 服务端返回的总额（分）
   * @param {object} orderData 创建订单返回
   */
  confirmPriceChange: function (serverTotal, orderData) {
    const self = this;
    wx.showModal({
      title: '价格已更新，请确认',
      content: '原预估 ¥' + this.data.totalYuan + '，当前 ¥' + format.amountToYuan(serverTotal),
      confirmText: '确认提交',
      cancelText: '再想想',
      success: function (res) {
        if (res.confirm) {
          self.payAndRedirect(orderData);
        }
      },
    });
  },

  /**
   * 下单成功后调起支付
   * @param {object} data 创建订单返回
   */
  payAndRedirect: function (data) {
    const payParams = data.payParams || null;

    if (!payParams) {
      // 无支付参数（如 mock 模式）→ 直接进订单页
      wx.showToast({ title: '订单已创建', icon: 'none', duration: 1500 });
      storage.setNavOrder({ tab: 'all', highlightOrderId: data.orderId });
      wx.switchTab({ url: ROUTES.ORDER });
      return;
    }

    const self = this;
    wx.requestPayment({
      timeStamp: payParams.timeStamp,
      nonceStr: payParams.nonceStr,
      package: payParams.package,
      signType: payParams.signType || 'MD5',
      paySign: payParams.paySign,
      success: function () {
        wx.showToast({ title: '支付成功，等待地陪接单', icon: 'none', duration: 1500 });
        storage.setNavOrder({ tab: 'all', highlightOrderId: data.orderId });
        wx.switchTab({ url: ROUTES.ORDER });
      },
      fail: function (err) {
        const msg = (err && err.errMsg) || '';
        // 回到表单态，保留全部已填内容
        self.setData({ payPending: true });
        wx.showToast({
          title: msg.indexOf('cancel') >= 0 ? '支付未完成，订单已保留 15 分钟' : '支付未成功，可重试或稍后在订单页支付',
          icon: 'none',
          duration: 2500,
        });
        storage.setNavOrder({ tab: 'all', highlightOrderId: data.orderId });
      },
    });
  },

  /**
   * 「咨询TA」（空态用）
   */
  onConsult: function () {
    const self = this;
    api
      .createConversation({ guideId: this.data.guideId })
      .then(function (data) {
        if (!data || !data.conversationId) return;
        wx.navigateTo({
          url: ROUTES.CHAT + '?conversationId=' + encodeURIComponent(data.conversationId),
        });
      })
      .catch(function () {
        wx.showToast({ title: '发起咨询失败，请稍后重试', icon: 'none', duration: 2500 });
      });
  },

  /**
   * 错误态操作
   */
  onErrorAction: function () {
    if (this.data.error === 'not_found') {
      wx.navigateBack();
      return;
    }
    this.setData({ error: '' });
    this.loadDetail(this.data.guideId, this.data.selectedServiceId);
  },
});
