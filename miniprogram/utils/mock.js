/**
 * 随行 dipi · mock 数据层（降级用）
 * ---------------------------------------------------------------------------
 * 【定位】当服务端不可用（连不上 / 超时）时，request.js 会把请求转发到这里，
 *        返回**与真实契约完全同构**的数据，保证页面不白屏、演示链路可跑通。
 *
 * 【同构要求】
 *   - 信封：{ code: 0, message: 'ok', data }
 *   - 分页：{ list, page, pageSize, total, hasMore }
 *   - 金额：整数分，字段名以 Amount 结尾
 *   - 时间：ISO 8601 带时区字符串
 *   - 枚举：小驼峰
 *   - 订单操作位：canUserPay / canUserCancel / canUserConfirm / canUserRefund /
 *                 canUserContact / canUserReview（mock 在这里扮演"服务端"的角色）
 *
 * 【注意】mock 内部的订单状态 → 操作位映射是 mock 服务端的行为，
 *        不属于前端页面的"自算状态"（前端页面仍然只渲染服务端下发的布尔位）。
 */
const { ORDER_STATUS } = require('./constants');

/** 当前模拟时间基准（ISO） */
function nowIso() {
  return new Date().toISOString();
}

/** 生成 ISO 时间（相对当前偏移小时数） */
function isoOffset(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

/* ==========================================================================
 * 地陪数据
 * ========================================================================== */

const GUIDES = [
  {
    guideId: 'g_2051',
    name: '阿May',
    title: '成都本地美食向导',
    avatarUrl: '',
    rating: 4.9,
    ratingCount: 128,
    tags: ['美食陪逛', '川菜', '本地人'],
    city: '成都',
    district: '武侯区',
    priceAmount: 12000,
    priceOriginAmount: 15000,
    priceUnit: 'hour',
    isResting: false,
    isFavorite: true,
    distanceKm: 2.4,
    responseTimeMin: 10,
    completedOrderCount: 312,
    introduction: '土生土长成都人，开了十年苍蝇馆子。带你去吃本地人排队的老店，不踩坑、不摆拍。',
    highlights: ['可拼桌', '可换一家', '本地菜市'],
    languages: ['中文', 'English'],
    identityVerified: true,
    responseRate: 98,
    services: [
      {
        serviceId: 'si_9012',
        name: '川菜陪吃 3 小时',
        type: 'foodTour',
        durationHours: 3,
        priceAmount: 36000,
        priceUnit: 'session',
        description: '逛菜市场 + 3 家老店 tasting，边吃边讲成都人的口味',
        includes: ['菜市场导览', '3 家老店 tasting', '老板故事讲解'],
      },
      {
        serviceId: 'si_9013',
        name: '街头小吃半日巡游',
        type: 'foodTour',
        durationHours: 2.5,
        priceAmount: 26000,
        priceUnit: 'session',
        description: '从玉林到建设路，6 样本地经典小吃',
        includes: ['6 样小吃', '老板娘 interview', '拍照点推荐'],
      },
    ],
    certificates: [{ name: '实名认证', issuer: '随行平台', issuedAt: '2026-03-11T09:20:00+08:00' }],
    availableDates: ['今天', '明天', '周六', '周日'],
    availableSlots: ['09:00', '11:00', '14:00', '18:00'],
  },
  {
    guideId: 'g_1180',
    name: '老周',
    title: '城墙与老街故事讲解',
    avatarUrl: '',
    rating: 4.8,
    ratingCount: 76,
    tags: ['景点讲解', '历史', '摄影'],
    city: '南京',
    district: '秦淮区',
    priceAmount: 9800,
    priceOriginAmount: null,
    priceUnit: 'hour',
    isResting: false,
    isFavorite: false,
    distanceKm: 5.1,
    responseTimeMin: 20,
    completedOrderCount: 188,
    introduction: '在南京城墙上跑了十年，肚子里装着半部民国史。',
    highlights: ['历史现场', '小众机位', '可定制'],
    languages: ['中文'],
    identityVerified: true,
    responseRate: 95,
    services: [
      {
        serviceId: 'si_7711',
        name: '城墙徒步讲解 2 小时',
        type: 'sightseeing',
        durationHours: 2,
        priceAmount: 20000,
        priceUnit: 'session',
        description: '从中华门到台城，一路讲六朝',
        includes: ['专业讲解', '历史地图', '拍照点位'],
      },
    ],
    certificates: [{ name: '实名认证', issuer: '随行平台', issuedAt: '2026-01-05T10:00:00+08:00' }],
    availableDates: ['今天', '周六', '周日'],
    availableSlots: ['09:30', '15:00'],
  },
  {
    guideId: 'g_3320',
    name: '林小满',
    title: '城市漫游 · 街拍跟拍',
    avatarUrl: '',
    rating: 4.7,
    ratingCount: 54,
    tags: ['拍照跟拍', 'cityWalk', '出片'],
    city: '上海',
    district: '黄浦区',
    priceAmount: 15000,
    priceOriginAmount: 18000,
    priceUnit: 'hour',
    isResting: false,
    isFavorite: false,
    distanceKm: 3.6,
    responseTimeMin: 15,
    completedOrderCount: 96,
    introduction: '不摆拍不修图，走走停停的自然光跟拍。',
    highlights: ['自然光', '不修图', '含 20 张'],
    languages: ['中文', '日本語'],
    identityVerified: true,
    responseRate: 92,
    services: [
      {
        serviceId: 'si_5521',
        name: '外滩源街拍 2 小时',
        type: 'photo',
        durationHours: 2,
        priceAmount: 30000,
        priceUnit: 'session',
        description: '含 20 张精修 + 全部原片',
        includes: ['20 张精修', '全部原片', '服装建议'],
      },
    ],
    certificates: [{ name: '实名认证', issuer: '随行平台', issuedAt: '2026-02-18T11:30:00+08:00' }],
    availableDates: ['明天', '周六'],
    availableSlots: ['10:00', '16:00'],
  },
  {
    guideId: 'g_4410',
    name: '豆豆妈',
    title: '亲子陪玩 · 半天不折腾',
    avatarUrl: '',
    rating: 5.0,
    ratingCount: 203,
    tags: ['亲子陪玩', '博物馆', '不催娃'],
    city: '杭州',
    district: '西湖区',
    priceAmount: 20000,
    priceOriginAmount: null,
    priceUnit: 'hour',
    isResting: true,
    isFavorite: false,
    distanceKm: 8.2,
    responseTimeMin: 30,
    completedOrderCount: 421,
    introduction: '两个孩子的妈，知道哪个馆能让五岁小孩安静两小时。',
    highlights: ['带娃友好', '有耐心', '含儿童餐推荐'],
    languages: ['中文'],
    identityVerified: true,
    responseRate: 99,
    services: [
      {
        serviceId: 'si_6642',
        name: '博物馆 + 公园半日',
        type: 'parentChild',
        durationHours: 4,
        priceAmount: 80000,
        priceUnit: 'session',
        description: '室内为主，避开暴晒，含儿童午休安排',
        includes: ['儿童路线', '点心与午休', '相册整理'],
      },
    ],
    certificates: [{ name: '实名认证', issuer: '随行平台', issuedAt: '2025-12-01T08:00:00+08:00' }],
    availableDates: ['周六', '周日'],
    availableSlots: ['09:00', '13:30'],
  },
  {
    guideId: 'g_5560',
    name: '阿KEN',
    title: '办事协助 · 排队跑腿',
    avatarUrl: '',
    rating: 4.6,
    ratingCount: 31,
    tags: ['办事协助', '效率', '本地通'],
    city: '广州',
    district: '越秀区',
    priceAmount: 8000,
    priceOriginAmount: null,
    priceUnit: 'session',
    isResting: false,
    isFavorite: false,
    distanceKm: 4.4,
    responseTimeMin: 8,
    completedOrderCount: 57,
    introduction: '医院、证件、市场，各类要排队的事我替你跑。',
    highlights: ['熟悉流程', '可代办', '当天完成'],
    languages: ['中文', '粤语'],
    identityVerified: true,
    responseRate: 90,
    services: [
      {
        serviceId: 'si_2210',
        name: '窗口代排队 2 小时',
        type: 'errand',
        durationHours: 2,
        priceAmount: 16000,
        priceUnit: 'session',
        description: '到场排队，材料办完即走',
        includes: ['代排队', '进度播报', '最多 3 项业务'],
      },
    ],
    certificates: [{ name: '实名认证', issuer: '随行平台', issuedAt: '2026-04-08T09:00:00+08:00' }],
    availableDates: ['今天', '明天', '周六'],
    availableSlots: ['08:30', '13:00'],
  },
  {
    guideId: 'g_6620',
    name: '小柯',
    title: '景点讲解 · 博物馆特展',
    avatarUrl: '',
    rating: 4.5,
    ratingCount: 22,
    tags: ['景点讲解', '博物馆', '安静'],
    city: '北京',
    district: '东城区',
    priceAmount: 11000,
    priceOriginAmount: null,
    priceUnit: 'hour',
    isResting: false,
    isFavorite: false,
    distanceKm: 12.0,
    responseTimeMin: 25,
    completedOrderCount: 41,
    introduction: '博物馆志愿讲解员，听得懂也讲得清。',
    highlights: ['特展讲解', '少人时段', '可延伸'],
    languages: ['中文', 'English'],
    identityVerified: false,
    responseRate: 88,
    services: [
      {
        serviceId: 'si_3311',
        name: '特展精讲 90 分钟',
        type: 'sightseeing',
        durationHours: 1.5,
        priceAmount: 16500,
        priceUnit: 'session',
        description: '提前拿到展线，含 3 件重点展品细讲',
        includes: ['展线规划', '重点展品精讲', '笔记摘要'],
      },
    ],
    certificates: [],
    availableDates: ['周六', '周日'],
    availableSlots: ['10:00', '14:30'],
  },
];

/** 评价数据 */
const REVIEWS = [
  {
    reviewId: 'rv_01',
    guideId: 'g_2051',
    userNickname: '小满',
    rating: 5,
    content: '带我们避开了所有游客店，菜市场那顿是真的值。',
    createdAt: '2026-11-10T19:20:00+08:00',
    reply: '下次来还找阿May！',
  },
  {
    reviewId: 'rv_02',
    guideId: 'g_2051',
    userNickname: '阿哲',
    rating: 4,
    content: '老板故事讲得很有意思，就是那天有点热。',
    createdAt: '2026-11-05T21:02:00+08:00',
    reply: '',
  },
  {
    reviewId: 'rv_03',
    guideId: 'g_1180',
    userNickname: 'Luna',
    rating: 5,
    content: '讲城墙历史比导游生动多了，照片也帮我们拍了不少。',
    createdAt: '2026-11-08T12:40:00+08:00',
    reply: '欢迎再来南京。',
  },
];

/* ==========================================================================
 * 会话 / 消息 / 通知
 * ========================================================================== */

let seqCounter = 1247;

const CONVERSATIONS = [
  {
    conversationId: 'cv_77213',
    peerType: 'guide',
    guideId: 'g_2051',
    guideName: '阿May',
    guideAvatarUrl: '',
    guideTitle: '成都本地美食向导',
    lastMessageId: 'm_99301',
    lastMessageType: 'text',
    lastMessageContent: '明天中午有空吗？我带你去两家本地人常去的。',
    lastMessageAt: isoOffset(-2),
    unreadCount: 3,
    firstUnreadSeq: 1245,
    isActive: true,
    linkedOrderId: 'ord_20261123_0001',
    linkedOrderStatus: ORDER_STATUS.PENDING_ACCEPT,
  },
  {
    conversationId: 'cv_77120',
    peerType: 'guide',
    guideId: 'g_1180',
    guideName: '老周',
    guideAvatarUrl: '',
    guideTitle: '城墙与老街故事讲解',
    lastMessageId: 'm_99230',
    lastMessageType: 'text',
    lastMessageContent: '好的，周六上午九点半台城集合。',
    lastMessageAt: isoOffset(-26),
    unreadCount: 0,
    firstUnreadSeq: null,
    isActive: true,
    linkedOrderId: null,
    linkedOrderStatus: null,
  },
  {
    conversationId: 'cv_76988',
    peerType: 'guide',
    guideId: 'g_3320',
    guideName: '林小满',
    guideAvatarUrl: '',
    guideTitle: '城市漫游 · 街拍跟拍',
    lastMessageId: 'm_99001',
    lastMessageType: 'order_card',
    lastMessageContent: '[订单]',
    lastMessageAt: isoOffset(-80),
    unreadCount: 0,
    firstUnreadSeq: null,
    isActive: false,
    linkedOrderId: 'ord_20261118_0002',
    linkedOrderStatus: ORDER_STATUS.COMPLETED,
  },
];

/** 消息体：conversationId → 消息数组（升序 seq） */
const MESSAGES = {
  cv_77213: [
    {
      messageId: 'm_99300',
      clientMessageId: '',
      conversationId: 'cv_77213',
      seq: 1244,
      senderType: 'user',
      messageType: 'text',
      content: '你好，我下周想去成都待三天，想吃本地的东西。',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-3),
      isRead: true,
    },
    {
      messageId: 'm_99301',
      clientMessageId: '',
      conversationId: 'cv_77213',
      seq: 1245,
      senderType: 'guide',
      messageType: 'text',
      content: '明天中午有空吗？我带你去两家本地人常去的。',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-2),
      isRead: false,
    },
    {
      messageId: 'm_99302',
      clientMessageId: '',
      conversationId: 'cv_77213',
      seq: 1246,
      senderType: 'guide',
      messageType: 'text',
      content: '还是川菜陪吃 3 小时那个服务？',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-2),
      isRead: false,
    },
    {
      messageId: 'm_99303',
      clientMessageId: '',
      conversationId: 'cv_77213',
      seq: 1247,
      senderType: 'guide',
      messageType: 'text',
      content: '这个服务包含菜市场导览，拍照也好看～',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-2),
      isRead: false,
    },
  ],
  cv_77120: [
    {
      messageId: 'm_99229',
      clientMessageId: '',
      conversationId: 'cv_77120',
      seq: 1180,
      senderType: 'user',
      messageType: 'text',
      content: '城墙徒步要穿运动鞋吗？',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-27),
      isRead: true,
    },
    {
      messageId: 'm_99230',
      clientMessageId: '',
      conversationId: 'cv_77120',
      seq: 1181,
      senderType: 'guide',
      messageType: 'text',
      content: '好的，周六上午九点半台城集合。',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-26),
      isRead: true,
    },
  ],
  cv_76988: [
    {
      messageId: 'm_99000',
      clientMessageId: '',
      conversationId: 'cv_76988',
      seq: 1102,
      senderType: 'user',
      messageType: 'text',
      content: '外滩源那套出片吗？',
      imageUrl: null,
      orderSummary: null,
      sentAt: isoOffset(-82),
      isRead: true,
    },
    {
      messageId: 'm_99001',
      clientMessageId: '',
      conversationId: 'cv_76988',
      seq: 1103,
      senderType: 'guide',
      messageType: 'order_card',
      content: '',
      imageUrl: null,
      orderSummary: {
        orderId: 'ord_20261118_0002',
        orderNo: 'SX20261118002',
        serviceId: 'si_5521',
        serviceName: '外滩源街拍 2 小时',
        status: ORDER_STATUS.COMPLETED,
        statusText: '已完成',
        totalAmount: 30000,
        priceUnit: 'session',
        scheduledAt: isoOffset(-60),
      },
      sentAt: isoOffset(-80),
      isRead: true,
    },
  ],
};

const NOTICES = [
  {
    notificationId: 'n_4412',
    category: 'order',
    title: '阿May 已接受你的订单',
    content: '订单 SX20261123001 已接单，服务开始时间 11 月 24 日 11:00。',
    createdAt: isoOffset(-5),
    isRead: false,
    refType: 'order',
    refId: 'ord_20261123_0001',
    actionLabel: '查看订单',
  },
  {
    notificationId: 'n_4408',
    category: 'refund',
    title: '退款进度更新',
    content: '订单 SX20261118002 的退款已原路退回，请留意到账。',
    createdAt: isoOffset(-30),
    isRead: false,
    refType: 'order',
    refId: 'ord_20261118_0002',
    actionLabel: '查看订单',
  },
  {
    notificationId: 'n_4401',
    category: 'system',
    title: '实名认证已通过',
    content: '你现在可以预约全部实名服务了。',
    createdAt: isoOffset(-100),
    isRead: true,
    refType: 'none',
    refId: null,
    actionLabel: null,
  },
];

/* ==========================================================================
 * 订单
 * ========================================================================== */

/**
 * mock 服务端行为：依据状态推导可执行操作位
 * （这是 mock 扮演服务端的职责，前端页面依旧只渲染这些布尔位）
 */
function computeActions(status) {
  return {
    canUserPay: status === ORDER_STATUS.PENDING_PAYMENT,
    canUserCancel:
      status === ORDER_STATUS.PENDING_PAYMENT ||
      status === ORDER_STATUS.PENDING_ACCEPT ||
      status === ORDER_STATUS.ACCEPTED,
    canUserConfirm: status === ORDER_STATUS.PENDING_CONFIRM,
    canUserRefund:
      status === ORDER_STATUS.IN_SERVICE ||
      status === ORDER_STATUS.PENDING_CONFIRM ||
      status === ORDER_STATUS.ACCEPTED ||
      status === ORDER_STATUS.COMPLETED,
    canUserContact:
      status !== ORDER_STATUS.CANCELLED &&
      status !== ORDER_STATUS.CLOSED &&
      status !== ORDER_STATUS.REFUNDED,
    canUserReview: status === ORDER_STATUS.COMPLETED,
  };
}

function makeOrder(overrides) {
  const status = overrides.status;
  const actions = computeActions(status);
  return Object.assign(
    {
      orderId: 'ord_mock_0001',
      orderNo: 'SX20261123001',
      status: status,
      statusText: '',
      userId: 'u_102395',
      guideId: 'g_2051',
      guideName: '阿May',
      guideAvatarUrl: '',
      guideTitle: '成都本地美食向导',
      serviceId: 'si_9012',
      serviceName: '川菜陪吃 3 小时',
      city: '成都',
      meetingPoint: '宽窄巷子东广场',
      meetingPointNote: '地铁 4 号线宽窄巷子站 B 口',
      scheduledAt: isoOffset(20),
      durationHours: 3,
      endAt: isoOffset(23),
      travelers: 2,
      priceAmount: 36000,
      extraAmount: 0,
      totalAmount: 36000,
      discountAmount: 0,
      currency: 'CNY',
      priceUnit: 'session',
      remark: '不吃辣，多点一份汤',
      contactName: '小满',
      contactPhone: '138****5678',
      createdAt: isoOffset(-1),
      paidAt: null,
      acceptedAt: null,
      startedAt: null,
      endedAt: null,
      confirmedAt: null,
      cancelledAt: null,
      refundAppliedAt: null,
      refundedAt: null,
      expireAt: null,
      serverTime: nowIso(),
      cancelReason: null,
      refundAmount: 0,
      refundReason: null,
      refundReasonCode: null,
      refundStatus: 'none',
      refundFromStatus: null,
      disputeStatus: 'none',
      timeline: [],
    },
    actions,
    overrides
  );
}

const ORDERS = [
  makeOrder({
    orderId: 'ord_20261123_0001',
    orderNo: 'SX20261123001',
    status: ORDER_STATUS.PENDING_PAYMENT,
    statusText: '待支付',
    expireAt: isoOffset(0.24),
    paidAt: null,
    timeline: [
      { status: ORDER_STATUS.PENDING_PAYMENT, statusText: '待支付', at: isoOffset(-1), note: '订单已创建', operator: 'user' },
    ],
  }),
  makeOrder({
    orderId: 'ord_20261122_0005',
    orderNo: 'SX20261122005',
    status: ORDER_STATUS.IN_SERVICE,
    statusText: '服务中',
    guideId: 'g_1180',
    guideName: '老周',
    guideTitle: '城墙与老街故事讲解',
    serviceId: 'si_7711',
    serviceName: '城墙徒步讲解 2 小时',
    city: '南京',
    totalAmount: 20000,
    priceAmount: 20000,
    scheduledAt: isoOffset(-1),
    endAt: isoOffset(1),
    paidAt: isoOffset(-26),
    acceptedAt: isoOffset(-25),
    startedAt: isoOffset(-1),
    timeline: [
      { status: ORDER_STATUS.PENDING_PAYMENT, statusText: '待支付', at: isoOffset(-27), note: '订单已创建', operator: 'user' },
      { status: ORDER_STATUS.PENDING_ACCEPT, statusText: '待接单', at: isoOffset(-26), note: '支付成功', operator: 'system' },
      { status: ORDER_STATUS.ACCEPTED, statusText: '已接单', at: isoOffset(-25), note: '老周 已接单', operator: 'guide' },
      { status: ORDER_STATUS.IN_SERVICE, statusText: '服务中', at: isoOffset(-1), note: '服务已开始', operator: 'guide' },
    ],
  }),
  makeOrder({
    orderId: 'ord_20261120_0003',
    orderNo: 'SX20261120003',
    status: ORDER_STATUS.COMPLETED,
    statusText: '已完成',
    guideId: 'g_3320',
    guideName: '林小满',
    guideTitle: '城市漫游 · 街拍跟拍',
    serviceId: 'si_5521',
    serviceName: '外滩源街拍 2 小时',
    city: '上海',
    totalAmount: 30000,
    priceAmount: 30000,
    scheduledAt: isoOffset(-72),
    endAt: isoOffset(-70),
    paidAt: isoOffset(-80),
    acceptedAt: isoOffset(-79),
    startedAt: isoOffset(-72),
    endedAt: isoOffset(-70),
    confirmedAt: isoOffset(-69),
    timeline: [
      { status: ORDER_STATUS.PENDING_PAYMENT, statusText: '待支付', at: isoOffset(-81), note: '订单已创建', operator: 'user' },
      { status: ORDER_STATUS.COMPLETED, statusText: '已完成', at: isoOffset(-69), note: '服务已确认', operator: 'user' },
    ],
  }),
  makeOrder({
    orderId: 'ord_20261118_0002',
    orderNo: 'SX20261118002',
    status: ORDER_STATUS.CANCELLED,
    statusText: '已取消',
    guideId: 'g_3320',
    guideName: '林小满',
    guideTitle: '城市漫游 · 街拍跟拍',
    serviceId: 'si_5521',
    serviceName: '外滩源街拍 2 小时',
    city: '上海',
    totalAmount: 30000,
    priceAmount: 30000,
    cancelReason: '计划有变',
    cancelledAt: isoOffset(-120),
    timeline: [
      { status: ORDER_STATUS.CANCELLED, statusText: '已取消', at: isoOffset(-120), note: '用户取消订单', operator: 'user' },
    ],
  }),
];

/* ==========================================================================
 * 用户 / 设置 / 收藏
 * ========================================================================== */

const USER = {
  userId: 'u_102395',
  nickname: '小满',
  avatarUrl: '',
  gender: 'unknown',
  city: '成都',
  bio: '爱逛菜市场',
  phoneMasked: '138****5678',
  realNameVerified: true,
  realNameStatus: 'verified',
  memberLevel: 'normal',
  createdAt: '2026-03-11T09:20:00+08:00',
  orderCounts: {
    all: 4,
    pendingPayment: 1,
    pendingAccept: 0,
    accepted: 0,
    inService: 1,
    pendingConfirm: 0,
    completed: 1,
    cancelled: 1,
    closed: 0,
    refunding: 0,
    refunded: 0,
  },
  // orderStats 是服务端聚合出的「展示分桶」，非订单状态枚举（前端只渲染）
  orderStats: {
    pendingPayment: 1,
    ongoing: 1,
    pendingConfirm: 0,
    refunding: 0,
  },
  favoriteCount: 1,
};

const SETTINGS = {
  notifyEnabled: true,
  notifyOrder: true,
  notifyMessage: true,
  notifyRefund: true,
  privacyLocation: false,
  showProfilePublic: true,
  subscribeMessageAuthorized: false,
  cacheSizeMb: 4.2,
};

const FAVORITES = ['g_2051'];

/* ==========================================================================
 * 首页数据
 * ========================================================================== */

const HOME_CITY = '成都';

const HOME_DATA = {
  currentCity: HOME_CITY,
  searchPlaceholder: '输入目的地或服务',
  serviceTypes: [
    { code: 'foodTour', name: '美食陪逛', iconName: 'food', guideCount: 128 },
    { code: 'cityWalk', name: '城市漫游', iconName: 'walk', guideCount: 96 },
    { code: 'sightseeing', name: '景点讲解', iconName: 'ticket', guideCount: 74 },
    { code: 'photo', name: '拍照跟拍', iconName: 'camera', guideCount: 52 },
    { code: 'parentChild', name: '亲子陪玩', iconName: 'child', guideCount: 31 },
    { code: 'errand', name: '办事协助', iconName: 'errand', guideCount: 18 },
  ],
  featuredGuides: GUIDES.slice(0, 4),
  scenes: [
    { code: 'today', name: '今天就能约', iconName: 'clock', subtitle: '2 位地陪今天有空', query: 'availableWithin=today' },
    { code: 'weekend', name: '周末可用', iconName: 'calendar', subtitle: '24 位地陪周末排满', query: 'availableWithin=weekend' },
    { code: 'family', name: '亲子优选', iconName: 'child', subtitle: '13 位亲子地陪', query: 'serviceType=parentChild' },
    { code: 'airport', name: '机场接送', iconName: 'car', subtitle: '6 位接机地陪', query: 'serviceType=errand' },
  ],
  activeOrderSummary: {
    orderId: 'ord_20261123_0001',
    orderNo: 'SX20261123001',
    status: ORDER_STATUS.PENDING_PAYMENT,
    statusText: '待支付',
    guideName: '阿May',
    serviceName: '川菜陪吃 3 小时',
    scheduledAt: isoOffset(20),
  },
  guarantees: [
    { code: 'verified', title: '实名认证', description: '每位地陪均通过实名核验', iconName: 'shield' },
    { code: 'insured', title: '平台保障', description: '服务未开始可全额退款', iconName: 'lock' },
    { code: 'support', title: '售后无忧', description: '争议由平台介入处理', iconName: 'service' },
  ],
  cityOptions: [
    { code: 'chengdu', name: '成都', guideCount: 128 },
    { code: 'nanjing', name: '南京', guideCount: 76 },
    { code: 'shanghai', name: '上海', guideCount: 92 },
    { code: 'hangzhou', name: '杭州', guideCount: 41 },
    { code: 'guangzhou', name: '广州', guideCount: 33 },
    { code: 'beijing', name: '北京', guideCount: 58 },
  ],
};

const FILTER_OPTIONS = {
  cities: [
    { code: 'chengdu', name: '成都', guideCount: 128, isHot: true },
    { code: 'nanjing', name: '南京', guideCount: 76, isHot: true },
    { code: 'shanghai', name: '上海', guideCount: 92, isHot: true },
    { code: 'hangzhou', name: '杭州', guideCount: 41, isHot: false },
    { code: 'guangzhou', name: '广州', guideCount: 33, isHot: false },
    { code: 'beijing', name: '北京', guideCount: 58, isHot: true },
  ],
  serviceTypes: [
    { code: 'foodTour', name: '美食陪逛', guideCount: 128 },
    { code: 'cityWalk', name: '城市漫游', guideCount: 96 },
    { code: 'sightseeing', name: '景点讲解', guideCount: 74 },
    { code: 'photo', name: '拍照跟拍', guideCount: 52 },
    { code: 'parentChild', name: '亲子陪玩', guideCount: 31 },
    { code: 'errand', name: '办事协助', guideCount: 18 },
  ],
  // 价格区间：min/max 用「元」（查询参数单位），minAmount/maxAmount 用「分」（金额整数分口径）
  priceRanges: [
    { min: 0, max: 100, label: '¥100 以下', minAmount: 0, maxAmount: 10000 },
    { min: 100, max: 150, label: '¥100-150', minAmount: 10000, maxAmount: 15000 },
    { min: 150, max: 200, label: '¥150-200', minAmount: 15000, maxAmount: 20000 },
    { min: 200, max: null, label: '¥200 以上', minAmount: 20000, maxAmount: null },
  ],
  ratings: [
    { value: 4.5, label: '4.5 分以上' },
    { value: 4.0, label: '4.0 分以上' },
    { value: 3.5, label: '3.5 分以上' },
  ],
  availableWindows: [
    { code: 'none', label: '不限时间' },
    { code: 'today', label: '今天就能约' },
    { code: 'weekend', label: '周末可用' },
    { code: 'week', label: '一周内' },
  ],
};

/* ==========================================================================
 * 路由处理
 * ========================================================================== */

/** 构造分页信封 */
function paginate(list, page, pageSize) {
  const total = list.length;
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);
  return {
    list: items,
    page: page,
    pageSize: pageSize,
    total: total,
    hasMore: start + items.length < total,
  };
}

/** 深拷贝（避免页面改到 mock 内部状态） */
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** 服务类型 → mock 关键词映射（用于近似筛选） */
const SERVICE_TYPE_KEYWORD = {
  foodTour: '美食',
  cityWalk: '漫游',
  sightseeing: '讲解',
  photo: '拍',
  parentChild: '亲子',
  errand: '协助',
};

/**
 * 构造可约时段列表
 * slotId 为稳定唯一标识（形如 2026-11-25-am），P8 提交时原样回传
 * @param {object} guide 地陪
 * @returns {array} 时段数组
 */
function buildSlots(guide) {
  const slots = [];
  const base = new Date();
  const times =
    guide.availableSlots && guide.availableSlots.length ? guide.availableSlots : ['09:00', '11:00', '14:00'];

  // 生成未来 14 天
  for (let i = 0; i < 14; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000);
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    const dateStr = d.getFullYear() + '-' + pad2(mm) + '-' + pad2(dd);

    times.forEach(function (time) {
      const hour = parseInt(time, 10);
      const startMs = new Date(dateStr + 'T00:00:00+08:00').getTime() + hour * 3600 * 1000;
      slots.push({
        // slotId 必须稳定唯一（与服务端同构：date_时间），P8 提交时原样回传
        slotId: dateStr + '_' + time.replace(':', ''),
        date: dateStr,
        dateLabel: mm + ' 月 ' + dd + ' 日 周' + week,
        timeSlot: time,
        timeLabel: time,
        available: !(hour < 9 && i === 0),
        remaining: hour < 12 ? 2 : null,
        // 展示用（服务端回显的服务时间），下单提交用 slotId
        scheduledAt: new Date(startMs).toISOString(),
        endAt: new Date(startMs + 3 * 3600 * 1000).toISOString(),
      });
    });
  }
  return slots;
}

/**
 * 两位补零
 * @param {number} n 数字
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 地陪摘要 → 列表项（去掉详情专有字段） */
function guideSummary(g) {
  return {
    guideId: g.guideId,
    name: g.name,
    title: g.title,
    avatarUrl: g.avatarUrl,
    rating: g.rating,
    ratingCount: g.ratingCount,
    tags: g.tags,
    city: g.city,
    district: g.district,
    priceAmount: g.priceAmount,
    priceOriginAmount: g.priceOriginAmount,
    priceUnit: g.priceUnit,
    isResting: g.isResting,
    isFavorite: g.isFavorite,
    distanceKm: g.distanceKm,
    responseTimeMin: g.responseTimeMin,
    completedOrderCount: g.completedOrderCount,
  };
}

function findGuide(guideId) {
  for (let i = 0; i < GUIDES.length; i++) {
    if (GUIDES[i].guideId === guideId) return GUIDES[i];
  }
  return null;
}

/** 订单列表过滤（状态分栏） */
function filterOrders(tab) {
  if (!tab || tab === 'all') return ORDERS.slice();
  if (tab === 'ongoing') {
    return ORDERS.filter((o) => o.status === ORDER_STATUS.ACCEPTED || o.status === ORDER_STATUS.IN_SERVICE);
  }
  if (tab === 'refunding') {
    return ORDERS.filter((o) => o.status === ORDER_STATUS.REFUNDING || o.status === ORDER_STATUS.REFUNDED);
  }
  return ORDERS.filter((o) => o.status === tab);
}

/** 构造订单新增（mock 下单） */
function createMockOrder(body) {
  const guide = findGuide(body.guideId) || GUIDES[0];
  const services = guide.services || [];
  const serviceItem = services.filter((s) => s.serviceId === body.serviceId)[0] || services[0];
  const orderId = 'ord_mock_' + Date.now();
  const travelers = body.travelers || 1;
  const priceAmount = (serviceItem ? serviceItem.priceAmount : guide.priceAmount) * travelers;
  // slotId 原样保留（服务端据此原子核销时段）；mock 据此反查展示用的服务时间
  const slot = findSlotById(guide, body.slotId);
  const order = makeOrder({
    orderId: orderId,
    orderNo: 'SX' + String(Date.now()).slice(-11),
    status: ORDER_STATUS.PENDING_PAYMENT,
    statusText: '待支付',
    guideId: guide.guideId,
    guideName: guide.name,
    guideTitle: guide.title,
    serviceId: serviceItem ? serviceItem.serviceId : '',
    serviceName: serviceItem ? serviceItem.name : guide.title,
    city: guide.city,
    slotId: body.slotId || '',
    scheduledAt: slot ? slot.scheduledAt : isoOffset(24),
    endAt: slot ? slot.endAt : isoOffset(27),
    travelers: travelers,
    priceAmount: priceAmount,
    totalAmount: priceAmount,
    expireAt: isoOffset(0.25),
    remark: body.remark || '',
    meetingPoint: body.meetingPoint || '',
    contactName: body.contactName || USER.nickname,
    contactPhone: body.contactPhone || USER.phoneMasked,
    timeline: [
      { status: ORDER_STATUS.PENDING_PAYMENT, statusText: '待支付', at: nowIso(), note: '订单已创建', operator: 'user' },
    ],
  });
  ORDERS.unshift(order);
  return order;
}

/**
 * 按 slotId 反查时段的展示信息（scheduledAt / endAt）
 * @param {object} guide 地陪
 * @param {string} slotId 时段 ID
 * @returns {object|null}
 */
function findSlotById(guide, slotId) {
  if (!slotId) return null;
  const slots = buildSlots(guide);
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].slotId === slotId) {
      return { scheduledAt: slots[i].scheduledAt, endAt: slots[i].endAt };
    }
  }
  return null;
}

/**
 * mock 请求处理
 * @param {string} method HTTP 方法
 * @param {string} path 去掉 API_PREFIX 的路径，如 '/guides'
 * @param {object} query 查询参数
 * @param {object} body 请求体
 * @returns {object} { code, message, data }
 */
function handle(method, path, query, body) {
  const p = path.replace(/\/+$/, '') || '/';
  const m = method.toUpperCase();

  /* ---- 登录 ---- */
  if (m === 'POST' && p === '/auth/login') {
    return {
      code: 0,
      message: 'ok',
      data: {
        token: 'mock-token-' + Date.now(),
        userId: USER.userId,
        nickname: USER.nickname,
        avatarUrl: USER.avatarUrl,
      },
    };
  }

  /* ---- 首页 ---- */
  if (m === 'GET' && p === '/home') {
    const city = query.city || HOME_CITY;
    const data = clone(HOME_DATA);
    data.currentCity = city;
    data.featuredGuides = GUIDES.filter((g) => g.city === city).length
      ? GUIDES.filter((g) => g.city === city)
      : GUIDES.slice(0, 4);
    return { code: 0, message: 'ok', data: data };
  }

  /* ---- 地陪列表 ---- */
  if (m === 'GET' && p === '/guides') {
    let list = GUIDES.map(guideSummary);
    const kw = (query.keyword || '').trim().toLowerCase();
    if (kw) {
      list = list.filter((g) => {
        const hay = [g.name, g.title, g.city, (g.tags || []).join(' ')].join(' ').toLowerCase();
        return hay.indexOf(kw) >= 0;
      });
    }
    const destination = query.destination || query.city;
    if (destination) {
      list = list.filter((g) => g.city === destination);
    }
    if (query.serviceType) {
      // mock 的服务类型以地陪服务项/标签的关键词近似匹配
      const key = SERVICE_TYPE_KEYWORD[query.serviceType] || '';
      list = list.filter((g) => {
        const gd = findGuide(g.guideId);
        if (!gd) return false;
        if (!key) return true;
        const hay = [gd.title, gd.introduction, (gd.tags || []).join(' ')].join(' ');
        return hay.indexOf(key) >= 0;
      });
    }
    const minPrice = query.priceMin !== undefined && query.priceMin !== '' ? query.priceMin : query.minPrice;
    const maxPrice = query.priceMax !== undefined && query.priceMax !== '' ? query.priceMax : query.maxPrice;
    const rating = query.minRating !== undefined && query.minRating !== '' ? query.minRating : query.rating;
    // 查询参数的价格单位是「元」（与服务端一致）；地陪 priceAmount 是「分」
    if (minPrice !== undefined && minPrice !== '') {
      const min = Number(minPrice) * 100;
      list = list.filter((g) => g.priceAmount >= min);
    }
    if (maxPrice !== undefined && maxPrice !== '') {
      const max = Number(maxPrice) * 100;
      list = list.filter((g) => g.priceAmount <= max);
    }
    if (rating !== undefined && rating !== '') {
      const r = Number(rating);
      list = list.filter((g) => g.rating >= r);
    }
    const sort = query.sortBy || query.sort || 'default';
    if (sort === 'priceAsc' || sort === 'price_asc') list.sort((a, b) => a.priceAmount - b.priceAmount);
    else if (sort === 'priceDesc' || sort === 'price_desc') list.sort((a, b) => b.priceAmount - a.priceAmount);
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating);
    else list.sort((a, b) => b.completedOrderCount - a.completedOrderCount);

    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 筛选项字典 ---- */
  if (m === 'GET' && p === '/guides/filter-options') {
    // 同时给出 destinations 别名（服务端两种命名都出现过），cities 为规范名
    const options = clone(FILTER_OPTIONS);
    return { code: 0, message: 'ok', data: Object.assign({}, options, { destinations: options.cities }) };
  }

  /* ---- 地陪详情 ---- */
  const guideDetailMatch = p.match(/^\/guides\/([^/]+)$/);
  if (m === 'GET' && guideDetailMatch) {
    const g = findGuide(guideDetailMatch[1]);
    if (!g) return { code: 40400, message: '地陪不存在', data: null };
    const detail = guideSummary(g);
    detail.introduction = g.introduction;
    detail.highlights = g.highlights;
    detail.languages = g.languages;
    detail.identityVerified = g.identityVerified;
    detail.responseRate = g.responseRate;
    detail.photoUrls = g.photoUrls || [];
    detail.certificates = g.certificates;
    detail.guarantees = g.guarantees || [];
    detail.reviews = REVIEWS.filter((r) => r.guideId === g.guideId);
    detail.isFavorite = FAVORITES.indexOf(g.guideId) >= 0;

    // 服务项：契约统一为 services[]，元素主键 serviceId（读/写同名）
    detail.services = (g.services || []).map(function (s) {
      return Object.assign({}, s, {
        isAvailable: s.isAvailable !== false,
        minTravelers: s.minTravelers || 1,
        maxTravelers: s.maxTravelers || 8,
      });
    });

    // 可约时段：slotId 为稳定唯一标识（形如 2026-11-25-am），提交时原样回传
    detail.availableSlots = buildSlots(g);

    // 兼容两种信封：data 与 data.guide
    return { code: 0, message: 'ok', data: Object.assign({}, detail, { guide: detail }) };
  }

  /* ---- 地陪评价 ---- */
  const guideReviewsMatch = p.match(/^\/guides\/([^/]+)\/reviews$/);
  if (m === 'GET' && guideReviewsMatch) {
    const list = REVIEWS.filter((r) => r.guideId === guideReviewsMatch[1]);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 会话列表 ---- */
  if (m === 'GET' && p === '/conversations') {
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(CONVERSATIONS), page, pageSize) };
  }

  /* ---- 创建会话 ---- */
  if (m === 'POST' && p === '/conversations') {
    const guideId = body.guideId;
    let conv = null;
    for (let i = 0; i < CONVERSATIONS.length; i++) {
      if (CONVERSATIONS[i].guideId === guideId && CONVERSATIONS[i].isActive) {
        conv = CONVERSATIONS[i];
        break;
      }
    }
    if (!conv) {
      const g = findGuide(guideId) || GUIDES[0];
      conv = {
        conversationId: 'cv_mock_' + Date.now(),
        peerType: 'guide',
        guideId: g.guideId,
        guideName: g.name,
        guideAvatarUrl: g.avatarUrl,
        guideTitle: g.title,
        lastMessageId: '',
        lastMessageType: 'text',
        lastMessageContent: '',
        lastMessageAt: nowIso(),
        unreadCount: 0,
        firstUnreadSeq: null,
        isActive: true,
        linkedOrderId: null,
        linkedOrderStatus: null,
      };
      CONVERSATIONS.unshift(conv);
      MESSAGES[conv.conversationId] = [];
    }
    return { code: 0, message: 'ok', data: clone(conv) };
  }

  /* ---- 会话详情 ---- */
  const convMatch = p.match(/^\/conversations\/([^/]+)$/);
  if (m === 'GET' && convMatch) {
    let conv = null;
    CONVERSATIONS.forEach((c) => {
      if (c.conversationId === convMatch[1]) conv = c;
    });
    if (!conv) return { code: 40400, message: '会话不存在', data: null };
    const g = findGuide(conv.guideId);
    return {
      code: 0,
      message: 'ok',
      data: {
        conversationId: conv.conversationId,
        guideId: conv.guideId,
        guideName: conv.guideName,
        guideAvatarUrl: conv.guideAvatarUrl,
        guideTitle: conv.guideTitle,
        isActive: conv.isActive,
        closedReason: conv.isActive ? null : '订单已完成',
        linkedOrderId: conv.linkedOrderId,
        linkedOrderStatus: conv.linkedOrderStatus,
        identityVerified: g ? g.identityVerified : false,
      },
    };
  }

  /* ---- 会话消息 ---- */
  const msgMatch = p.match(/^\/conversations\/([^/]+)\/messages$/);
  if (m === 'GET' && msgMatch) {
    const cid = msgMatch[1];
    let list = (MESSAGES[cid] || []).slice();
    if (query.since) {
      const since = Number(query.since);
      list = list.filter((msg) => msg.seq > since);
    }
    if (query.aroundSeq) {
      const around = Number(query.aroundSeq);
      list = list.filter((msg) => msg.seq >= around - 20 && msg.seq <= around + 20);
    }
    // 倒序返回（最新一页在前），前端反转后渲染
    list.sort((a, b) => b.seq - a.seq);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    const paged = paginate(clone(list), page, pageSize);
    paged.total = list.length;
    paged.hasMore = page * pageSize < list.length;
    return { code: 0, message: 'ok', data: paged };
  }

  /* ---- 发送消息 ---- */
  if (m === 'POST' && msgMatch) {
    const cid = msgMatch[1];
    if (!MESSAGES[cid]) MESSAGES[cid] = [];
    const clientMessageId = body.clientMessageId || '';
    // 幂等：同一 clientMessageId 直接返回已有消息
    let exist = null;
    MESSAGES[cid].forEach((msg) => {
      if (clientMessageId && msg.clientMessageId === clientMessageId) exist = msg;
    });
    if (exist) return { code: 0, message: 'ok', data: clone(exist) };

    seqCounter += 1;
    const message = {
      messageId: 'm_mock_' + seqCounter,
      clientMessageId: clientMessageId,
      conversationId: cid,
      seq: seqCounter,
      senderType: 'user',
      messageType: body.messageType || 'text',
      content: body.content || '',
      imageUrl: body.imageUrl || null,
      orderSummary: body.orderSummary || null,
      sentAt: nowIso(),
      isRead: true,
    };
    MESSAGES[cid].push(message);
    CONVERSATIONS.forEach((c) => {
      if (c.conversationId === cid) {
        c.lastMessageId = message.messageId;
        c.lastMessageContent = message.content;
        c.lastMessageType = message.messageType;
        c.lastMessageAt = message.sentAt;
      }
    });
    return { code: 0, message: 'ok', data: clone(message) };
  }

  /* ---- 会话已读 ---- */
  const readMatch = p.match(/^\/conversations\/([^/]+)\/read$/);
  if (m === 'POST' && readMatch) {
    const cid = readMatch[1];
    CONVERSATIONS.forEach((c) => {
      if (c.conversationId === cid) {
        c.unreadCount = 0;
        c.firstUnreadSeq = null;
      }
    });
    (MESSAGES[cid] || []).forEach((msg) => {
      msg.isRead = true;
    });
    return { code: 0, message: 'ok', data: { conversationId: cid, unreadCount: 0 } };
  }

  /* ---- 未读总数 ---- */
  if (m === 'GET' && (p === '/conversations/unread-count' || p === '/messages/unread-count')) {
    let total = 0;
    CONVERSATIONS.forEach((c) => {
      total += c.unreadCount || 0;
    });
    return { code: 0, message: 'ok', data: { total: total } };
  }

  /* ---- 消息聚合 ---- */
  if (m === 'GET' && p === '/messages') {
    const all = [];
    Object.keys(MESSAGES).forEach((cid) => {
      MESSAGES[cid].forEach((msg) => {
        all.push({
          messageId: msg.messageId,
          conversationId: msg.conversationId,
          seq: msg.seq,
          senderType: msg.senderType,
          messageType: msg.messageType,
          content: msg.content,
          sentAt: msg.sentAt,
        });
      });
    });
    all.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(all), page, pageSize) };
  }

  /* ---- 通知 ---- */
  if (m === 'GET' && p === '/notices') {
    let list = NOTICES.slice();
    if (query.category && query.category !== 'all') {
      list = list.filter((n) => n.category === query.category);
    }
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 通知已读 ---- */
  if (m === 'POST' && (p === '/notices/read' || p === '/notifications/read')) {
    NOTICES.forEach((n) => {
      n.isRead = true;
    });
    return { code: 0, message: 'ok', data: { readCount: NOTICES.length } };
  }

  /* ---- 订单列表 ---- */
  if (m === 'GET' && p === '/orders') {
    const list = filterOrders(query.status);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 订单统计 ---- */
  if (m === 'GET' && p === '/orders/summary') {
    const counts = { all: ORDERS.length };
    ORDERS.forEach((o) => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    counts.ongoing = filterOrders('ongoing').length;
    counts.refunding = filterOrders('refunding').length;
    return { code: 0, message: 'ok', data: counts };
  }

  /* ---- 创建订单 ---- */
  if (m === 'POST' && p === '/orders') {
    const idemKey = body.idempotencyKey;
    if (idemKey && MOCK_IDEMPOTENCY[idemKey]) {
      const existed = MOCK_IDEMPOTENCY[idemKey];
      const order = ORDERS.filter((o) => o.orderId === existed)[0];
      return {
        code: 0,
        message: 'ok',
        data: {
          orderId: existed,
          orderNo: order ? order.orderNo : '',
          totalAmount: order ? order.totalAmount : 0,
          payParams: null,
        },
      };
    }
    const order = createMockOrder(body);
    if (idemKey) MOCK_IDEMPOTENCY[idemKey] = order.orderId;
    return {
      code: 0,
      message: 'ok',
      data: {
        orderId: order.orderId,
        orderNo: order.orderNo,
        totalAmount: order.totalAmount,
        expireAt: order.expireAt,
        payParams: { timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: 'mocknonce', package: 'prepay_id=mock' },
      },
    };
  }

  /* ---- 订单详情 ---- */
  const orderMatch = p.match(/^\/orders\/([^/]+)$/);
  if (m === 'GET' && orderMatch) {
    let order = null;
    ORDERS.forEach((o) => {
      if (o.orderId === orderMatch[1]) order = o;
    });
    if (!order) return { code: 40400, message: '订单不存在', data: null };
    const data = clone(order);
    data.serverTime = nowIso();
    return { code: 0, message: 'ok', data: data };
  }

  /* ---- 订单动作 ---- */
  const actionMatch = p.match(/^\/orders\/([^/]+)\/(pay|cancel|confirm|refund|review)$/);
  if (m === 'POST' && actionMatch) {
    let order = null;
    ORDERS.forEach((o) => {
      if (o.orderId === actionMatch[1]) order = o;
    });
    if (!order) return { code: 40400, message: '订单不存在', data: null };
    const action = actionMatch[2];
    const actions = computeActions(order.status);

    if (action === 'pay') {
      if (!actions.canUserPay) {
        return { code: 40900, message: '订单当前状态不支持支付操作', data: null };
      }
      order.status = ORDER_STATUS.PENDING_ACCEPT;
      order.statusText = '待接单';
      order.paidAt = nowIso();
      order.timeline.push({
        status: ORDER_STATUS.PENDING_ACCEPT,
        statusText: '待接单',
        at: nowIso(),
        note: '支付成功',
        operator: 'system',
      });
    } else if (action === 'cancel') {
      if (!actions.canUserCancel) {
        return { code: 40900, message: '订单当前状态不支持取消操作', data: null };
      }
      order.status = ORDER_STATUS.CANCELLED;
      order.statusText = '已取消';
      order.cancelledAt = nowIso();
      order.cancelReason = body.cancelReasonCode || 'other';
      order.timeline.push({
        status: ORDER_STATUS.CANCELLED,
        statusText: '已取消',
        at: nowIso(),
        note: '用户取消订单',
        operator: 'user',
      });
    } else if (action === 'confirm') {
      if (!actions.canUserConfirm) {
        return { code: 40900, message: '订单当前状态不支持确认操作', data: null };
      }
      order.status = ORDER_STATUS.COMPLETED;
      order.statusText = '已完成';
      order.confirmedAt = nowIso();
      order.timeline.push({
        status: ORDER_STATUS.COMPLETED,
        statusText: '已完成',
        at: nowIso(),
        note: '用户确认服务完成',
        operator: 'user',
      });
    } else if (action === 'refund') {
      if (!actions.canUserRefund) {
        return { code: 40900, message: '订单当前状态不支持退款操作', data: null };
      }
      order.refundFromStatus = order.status;
      order.status = ORDER_STATUS.REFUNDING;
      order.statusText = '退款中';
      order.refundStatus = 'processing';
      order.refundAppliedAt = nowIso();
      order.refundReasonCode = body.refundReasonCode || 'other';
      order.refundReason = body.description || '';
      order.refundAmount = order.totalAmount;
      order.timeline.push({
        status: ORDER_STATUS.REFUNDING,
        statusText: '退款中',
        at: nowIso(),
        note: '用户申请退款',
        operator: 'user',
      });
    } else if (action === 'review') {
      if (!actions.canUserReview) {
        return { code: 40900, message: '订单当前状态不支持评价操作', data: null };
      }
      order.rating = body.rating || 5;
      order.comment = body.content || '';
    }

    // 重新下发操作位
    const next = computeActions(order.status);
    Object.keys(next).forEach((k) => {
      order[k] = next[k];
    });
    const data = clone(order);
    data.serverTime = nowIso();
    if (action === 'pay') {
      data.payParams = { timeStamp: String(Math.floor(Date.now() / 1000)), nonceStr: 'mocknonce', package: 'prepay_id=mock' };
    }
    return { code: 0, message: 'ok', data: data };
  }

  /* ---- 我的资料 ---- */
  if (m === 'GET' && p === '/me') {
    return { code: 0, message: 'ok', data: clone(USER) };
  }
  if (m === 'PUT' && p === '/me') {
    if (body.nickname !== undefined) USER.nickname = body.nickname;
    if (body.gender !== undefined) USER.gender = body.gender;
    if (body.city !== undefined) USER.city = body.city;
    if (body.bio !== undefined) USER.bio = body.bio;
    if (body.avatarUrl !== undefined) USER.avatarUrl = body.avatarUrl;
    return { code: 0, message: 'ok', data: clone(USER) };
  }

  /* ---- 我的订单 ---- */
  if (m === 'GET' && p === '/me/orders') {
    const list = filterOrders(query.status);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 我的收藏 ---- */
  if (m === 'GET' && p === '/me/favorites') {
    const list = FAVORITES.map((id) => {
      const g = findGuide(id);
      return g ? guideSummary(g) : null;
    }).filter(Boolean);
    const page = Number(query.page || 1);
    const pageSize = Number(query.pageSize || 20);
    return { code: 0, message: 'ok', data: paginate(clone(list), page, pageSize) };
  }

  /* ---- 收藏 toggle（PUT /me/favorites/:guideId，幂等切换） ---- */
  const favPutMatch = p.match(/^\/me\/favorites\/([^/]+)$/);
  if (m === 'PUT' && favPutMatch) {
    const id = favPutMatch[1];
    const idx = FAVORITES.indexOf(id);
    const current = idx >= 0;
    // 不传 favorited → toggle；传了 → 设为目标态
    const target = body && body.favorited !== undefined ? !!body.favorited : !current;
    const at = FAVORITES.indexOf(id);
    if (target && at < 0) FAVORITES.push(id);
    if (!target && at >= 0) FAVORITES.splice(at, 1);
    USER.favoriteCount = FAVORITES.length;
    return {
      code: 0,
      message: target ? '已收藏' : '已取消收藏',
      data: { guideId: id, favorited: target, favoritesCount: FAVORITES.length },
    };
  }

  /* ---- 设置 ---- */
  if (m === 'GET' && p === '/me/settings') {
    return { code: 0, message: 'ok', data: clone(SETTINGS) };
  }
  if (m === 'PUT' && p === '/me/settings') {
    Object.keys(body || {}).forEach((k) => {
      SETTINGS[k] = body[k];
    });
    return { code: 0, message: 'ok', data: clone(SETTINGS) };
  }


  return { code: 40400, message: 'Mock 未实现该接口：' + m + ' ' + p, data: null };
}

/** 幂等键 → 订单 ID */
const MOCK_IDEMPOTENCY = {};

module.exports = {
  handle,
  GUIDES,
  CONVERSATIONS,
  ORDERS,
  NOTICES,
  USER,
  SETTINGS,
  HOME_DATA,
  FILTER_OPTIONS,
};
