'use strict';

/**
 * 实体定义与字段校验
 * ---------------------------------------------------------------------------
 * 【契约收敛】全链路 camelCase；金额一律整数分（字段名以 Amount 结尾）；
 * 枚举值小驼峰（服务类型 foodTour / cityWalk / …）。
 */

/** 服务类型字典（首页金刚区 / 搜索筛选共用） */
const SERVICE_TYPES = [
  { code: 'foodTour', name: '美食陪逛', iconName: 'food', desc: '本地人带你吃地道味' },
  { code: 'cityWalk', name: '城市漫游', iconName: 'walk', desc: '跟着本地人逛城市' },
  { code: 'sightseeing', name: '景点讲解', iconName: 'ticket', desc: '有人讲故事的景点' },
  { code: 'photo', name: '拍照跟拍', iconName: 'camera', desc: '自然光跟拍不摆拍' },
  { code: 'parentChild', name: '亲子陪玩', iconName: 'child', desc: '带娃出行的稳妥安排' },
  { code: 'errand', name: '办事协助', iconName: 'ticket', desc: '排队跑腿代办事' },
];

/** 服务类型 code 集合（用于校验入参） */
const SERVICE_TYPE_CODES = SERVICE_TYPES.map((t) => t.code);

/**
 * 服务类型入参归一化
 * ---------------------------------------------------------------------------
 * 响应中只出现 camelCase 一种形式（`foodTour`）；但入参允许各历史写法，
 * 归一化后统一处理，避免客户端硬编码了 `food` 之类的别名时直接报错。
 * @param {string} v
 * @returns {string|null} 归一化后的 code，非法返回 null
 */
function normalizeServiceType(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (SERVICE_TYPE_CODES.includes(s)) return s;
  const alias = {
    food: 'foodTour', food_tour: 'foodTour', foodtour: 'foodTour',
    city: 'cityWalk', city_walk: 'cityWalk', citywalk: 'cityWalk',
    sightseeing: 'sightseeing', ticket: 'sightseeing',
    photo: 'photo', camera: 'photo',
    parent: 'parentChild', parent_child: 'parentChild', parentchild: 'parentChild',
    errand: 'errand', service: 'errand',
  };
  return alias[s.toLowerCase()] || null;
}

/** 消息类型 */
const MESSAGE_TYPE = {
  TEXT: 'text',
  SYSTEM: 'system',
  ORDER: 'order',
};

/** 通知类型 */
const NOTIFICATION_TYPE = {
  SYSTEM: 'system',
  ORDER: 'order',
  REFUND: 'refund',
  PROMOTION: 'promotion',
};

/**
 * @typedef {Object} User
 * @property {string} id                用户 ID
 * @property {string} openid            微信 openid（开发态为 mock 值）
 * @property {string} nickname          昵称
 * @property {string} avatar            头像 URL
 * @property {'male'|'female'|'unknown'} gender 性别
 * @property {string} [phone]           手机号
 * @property {string} [city]            常驻城市
 * @property {string} [bio]             个人简介
 * @property {string[]} [tags]          用户标签
 * @property {string} createdAt         创建时间 ISO
 */

/**
 * @typedef {Object} Guide
 * @property {string} id                 地陪 ID
 * @property {string} name               姓名
 * @property {string} avatar             头像 URL
 * @property {string} city               所在城市
 * @property {string} title              头衔/一句话介绍
 * @property {string} intro              详细介绍
 * @property {number} rating             综合评分 0–5
 * @property {number} ratingCount        评价数
 * @property {number} completedOrderCount 完成订单数
 * @property {number} priceAmount        起步价（分）
 * @property {string[]} tags             服务标签
 * @property {string[]} serviceTypes     服务类型 code 列表
 * @property {boolean} verified          是否认证
 * @property {'active'|'resting'|'offline'} status 状态
 */

/**
 * @typedef {Object} ServiceItem
 * @property {string} serviceId      服务项 ID
 * @property {string} guideId        所属地陪 ID
 * @property {string} name           服务名称
 * @property {string} serviceType    服务类型 code
 * @property {string} description    服务说明
 * @property {number} priceAmount    单价（分）
 * @property {'hour'|'session'|'day'|'person'} priceUnit 计费单位
 * @property {number} durationHours  建议时长（小时）
 * @property {number} minTravelers   最少人数
 * @property {number} maxTravelers   最多人数
 * @property {string[]} includes     服务包含
 * @property {boolean} isAvailable   是否可约
 */

/**
 * @typedef {Object} Conversation
 * @property {string} id          会话 ID
 * @property {string} userId      用户 ID
 * @property {string} guideId     地陪 ID
 * @property {string} lastMessageContent 最后一条消息摘要
 * @property {number} unreadCount 未读数
 * @property {boolean} isActive   是否可继续沟通
 */

/**
 * @typedef {Object} Message
 * @property {string} id             消息 ID
 * @property {string} conversationId 会话 ID
 * @property {number} seq            会话内单调递增序号
 * @property {string} clientMessageId 客户端幂等键
 * @property {'user'|'guide'|'system'} senderType 发送方类型
 * @property {'text'|'image'|'orderCard'|'system'} messageType 消息类型
 * @property {string} content        消息内容
 * @property {string} sentAt         发送时间 ISO8601
 * @property {boolean} isRead        是否已读
 */

/**
 * @typedef {Object} Order
 * @property {string} id            订单 ID
 * @property {string} userId        下单用户 ID
 * @property {string} guideId       地陪 ID
 * @property {string} serviceId     服务项 ID
 * @property {string} slotId        预约时段 ID
 * @property {number} travelers     人数
 * @property {number} unitPriceAmount 服务单价（分）
 * @property {number} totalAmount   实付金额（分）
 * @property {string} status        订单状态（camelCase）
 * @property {string} statusText    状态中文文案
 */

/**
 * @typedef {Object} Review
 * @property {string} reviewId    评价 ID
 * @property {string} orderId     订单 ID
 * @property {string} guideId     地陪 ID
 * @property {number} rating      评分 1–5
 * @property {string} content     评价内容
 */

/**
 * @typedef {Object} Notification
 * @property {string} notificationId 通知 ID
 * @property {string} category       通知分类
 * @property {string} title          标题
 * @property {string} content        内容
 * @property {boolean} isRead        是否已读
 */

/**
 * @typedef {Object} Favorite
 * @property {string} id        收藏 ID
 * @property {string} userId    用户 ID
 * @property {string} guideId   地陪 ID
 */

/**
 * @typedef {Object} Settings
 * @property {string} userId           用户 ID
 * @property {boolean} notifyEnabled   通知总开关
 * @property {boolean} privacyLocation 允许共享位置
 */

/** 用户可编辑字段（PUT /api/v1/me） */
const userEditableFields = {
  nickname: { type: 'string', maxLength: 12, trim: true },
  avatar: { type: 'string', maxLength: 500, trim: true },
  gender: { type: 'enum', values: ['male', 'female', 'unknown'] },
  phone: { type: 'string', maxLength: 20, trim: true, pattern: /^[\d+\-\s]{6,20}$/ },
  city: { type: 'string', maxLength: 30, trim: true },
  bio: { type: 'string', maxLength: 30, trim: true },
  tags: { type: 'array', maxItems: 8 },
};

/** 设置项字段（PUT /api/v1/me/settings） */
const settingsFields = {
  notifyEnabled: { type: 'boolean' },
  notifyOrder: { type: 'boolean' },
  notifyMessage: { type: 'boolean' },
  notifyRefund: { type: 'boolean' },
  notifyPromotion: { type: 'boolean' },
  notifySound: { type: 'boolean' },
  privacyLocation: { type: 'boolean' },
  privacyShowProfile: { type: 'boolean' },
  privacyShowOrder: { type: 'boolean' },
  autoConfirmOrder: { type: 'boolean' },
};

module.exports = {
  SERVICE_TYPES,
  SERVICE_TYPE_CODES,
  normalizeServiceType,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  userEditableFields,
  settingsFields,
};
