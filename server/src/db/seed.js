'use strict';

/**
 * 种子数据
 * ---------------------------------------------------------------------------
 * 【契约收敛】
 *   - 订单状态一律 camelCase（pendingPayment / pendingAccept / …）
 *   - 金额一律整数分（*Amount）
 *   - 服务项字段：serviceId / name / priceAmount / priceUnit / description / durationHours
 *   - 可约时段：{ slotId, date, timeSlot, available }，覆盖未来 14 天
 *
 * 内容规模：
 *   - 地陪 14 位（6 座城市 · 6 类服务 · 评分 4.2–4.9 · 单价 88–588 元）
 *   - 服务项 42 项
 *   - 评价 28 条
 *   - 订单 12 单（覆盖全部 10 种状态）
 *   - 会话 5 个 · 消息 16 条
 *   - 系统通知 6 条 · 收藏 4 条 · 设置 2 项
 *   - 用户 16 个（1 个普通用户 + 1 个越权测试用户 + 14 个地陪账号）
 *
 * 用法：npm run seed        # 数据为空时写入
 *      npm run seed:force  # 清空后重写
 */

const store = require('./store');
const {
  STATUS_TEXT, STATUS_BADGE, STATUS_TONE,
  pendingPayment, pendingAccept, accepted, inService, pendingConfirm,
  completed, cancelled, closed, refunding, refunded,
} = require('../models/statusMap');
const orderService = require('../services/orderService');
const { yuanToCents, toCstIso } = require('../utils/money');

/* ---------------------------------------------------------------------------
 * 工具
 * ------------------------------------------------------------------------ */

/** 相对今天的第 n 天 */
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 相对现在的第 n 小时 ISO 时间 */
function hoursFromNow(n) {
  return new Date(Date.now() + n * 3600 * 1000).toISOString();
}

/** 相对现在的第 n 天前 ISO 时间 */
function daysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

/** 头像占位图 */
function avatar(seed) {
  return `https://picsum.photos/seed/${seed}/200/200`;
}

/** 封面占位图 */
function cover(seed) {
  return `https://picsum.photos/seed/${seed}/480/300`;
}

/** 时段后缀 */
const SLOT_SUFFIX = [
  { timeSlot: '09:00-12:00', suffix: 'am' },
  { timeSlot: '13:00-17:00', suffix: 'pm' },
  { timeSlot: '18:00-21:00', suffix: 'night' },
];

/**
 * 可约时段（未来 14 天，每天 3 个时段）
 * slotId 形如 2026-11-25-am，为稳定唯一标识
 */
function buildSlots() {
  const result = [];
  for (let i = 1; i <= 14; i += 1) {
    const date = dayOffset(i);
    for (const t of SLOT_SUFFIX) {
      result.push({
        slotId: `${date}-${t.suffix}`,
        date,
        timeSlot: t.timeSlot,
        available: true,
      });
    }
  }
  return result;
}

/* ---------------------------------------------------------------------------
 * 地陪定义
 * ------------------------------------------------------------------------ */

const GUIDE_SEEDS = [
  {
    id: 'gd_000001', name: '林小满', gender: 'female', city: '成都',
    title: '本地人美食向导 · 十年老饕',
    intro: '在成都活了三十年，晓得哪条巷子里的馆子没有被游客占领。带你从菜市场一路吃到深夜摊。',
    rating: 4.9, ratingCount: 128, completedOrderCount: 356, price: 88, priceMax: 328,
    tags: ['川菜', '本地人', '好相处'], serviceTypes: ['foodTour', 'cityWalk'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '成都市青羊区 · 太古里附近',
    highlights: ['只去本地人排队的老馆子', '能帮你砍价也不怕被坑', '自带手冲咖啡与故事'],
  },
  {
    id: 'gd_000002', name: '陈知远', gender: 'male', city: '成都',
    title: '城市漫游者 · 建筑与老街',
    intro: '学建筑出身，习惯把一座城市当作一本立体书。带你走老街、看骑楼、听老成都的市井声。',
    rating: 4.8, ratingCount: 96, completedOrderCount: 214, price: 128, priceMax: 398,
    tags: ['建筑', '摄影', '深度'], serviceTypes: ['cityWalk', 'sightseeing'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '成都市锦江区 · 春熙路',
    highlights: ['会给你画一张手绘路线图', '知道哪个角度人最少', '讲解不念稿'],
  },
  {
    id: 'gd_000003', name: '周慕青', gender: 'female', city: '成都',
    title: '亲子陪伴向导 · 两个孩子的妈',
    intro: '自己也带娃。所有路线都按小孩子的节奏设计，不赶路、不吵闹，家长坐着也能歇。',
    rating: 4.7, ratingCount: 74, completedOrderCount: 168, price: 168, priceMax: 368,
    tags: ['亲子', '耐心', '安全'], serviceTypes: ['parentChild', 'foodTour'],
    languages: ['中文'], verified: true, status: 'active',
    location: '成都市武侯区 · 玉林片区',
    highlights: ['带儿童厕所地图', '有儿童急救证', '会准备小零食'],
  },
  {
    id: 'gd_000004', name: '苏念', gender: 'female', city: '重庆',
    title: '山城火锅寻味人 · 夜景摄影师',
    intro: '重庆的坡和梯子比攻略复杂。我带你从江边爬到山顶，顺手拍一组好看的夜景。',
    rating: 4.9, ratingCount: 142, completedOrderCount: 402, price: 98, priceMax: 428,
    tags: ['夜景', '火锅', '出片'], serviceTypes: ['foodTour', 'photo'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '重庆市渝中区 · 解放碑',
    highlights: ['知道哪条梯坎最出片', '会避开人潮高峰', '自带补光灯'],
  },
  {
    id: 'gd_000005', name: '阿杰', gender: 'male', city: '重庆',
    title: '大足石刻讲解员 · 持证',
    intro: '在景区讲了六年故事。给你讲清楚那些石头上的人，而不是背几句说明牌。',
    rating: 4.6, ratingCount: 58, completedOrderCount: 132, price: 158, priceMax: 458,
    tags: ['讲解', '专业', '历史'], serviceTypes: ['sightseeing', 'cityWalk'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '重庆市大足区 · 宝顶山',
    highlights: ['持景区讲解证', '有教师证', '能用方言讲段子'],
  },
  {
    id: 'gd_000006', name: '郑楠', gender: 'male', city: '西安',
    title: '长安文化讲解 · 博物馆志愿者',
    intro: '在博物馆做志愿讲解五年。城墙、碑林、兵马俑，我都能给你讲出不一样的一层。',
    rating: 4.8, ratingCount: 111, completedOrderCount: 287, price: 120, priceMax: 458,
    tags: ['博物馆', '历史', '好讲解'], serviceTypes: ['sightseeing', 'cityWalk'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '西安市碑林区 · 城墙南门',
    highlights: ['可走未开放区域', '赠手绘地图', '避人流路线'],
  },
  {
    id: 'gd_000007', name: '何清', gender: 'female', city: '西安',
    title: '旅拍摄影师 · 十年胶片经验',
    intro: '不摆拍，不喊“看这里”。我拍的是你在那条街上真实的样子，两小时出片。',
    rating: 4.5, ratingCount: 63, completedOrderCount: 149, price: 288, priceMax: 588,
    tags: ['旅拍', '自然光', '出片'], serviceTypes: ['photo', 'cityWalk'],
    languages: ['中文'], verified: true, status: 'active',
    location: '西安市雁塔区 · 大雁塔北广场',
    highlights: ['自带稳定器与补光', '当天精修 10 张', '妆造可选'],
  },
  {
    id: 'gd_000008', name: '高远', gender: 'male', city: '北京',
    title: '胡同与中轴线 · 城市设计师',
    intro: '做城市设计十年，逛胡同是我的日常。带你从钟楼走到什刹海，看真正的老北京怎么生活。',
    rating: 4.9, ratingCount: 156, completedOrderCount: 388, price: 168, priceMax: 528,
    tags: ['胡同', '设计', '深度'], serviceTypes: ['cityWalk', 'sightseeing'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '北京市东城区 · 南锣鼓巷',
    highlights: ['有社区钥匙能进院子', '知道哪条胡同最安静', '带手绘胡同地图'],
  },
  {
    id: 'gd_000009', name: '沈墨', gender: 'male', city: '北京',
    title: '办事跑腿 · 医院与政务经验',
    intro: '在大医院跑过三年陪诊。挂号、缴费、拿报告、找窗口，这些事交给我。',
    rating: 4.4, ratingCount: 87, completedOrderCount: 241, price: 208, priceMax: 468,
    tags: ['办事', '效率', '靠谱'], serviceTypes: ['errand', 'foodTour'],
    languages: ['中文'], verified: true, status: 'active',
    location: '北京市西城区 · 什刹海',
    highlights: ['熟悉各医院流程', '全程微信同步进度', '可代排队'],
  },
  {
    id: 'gd_000010', name: '江予', gender: 'female', city: '上海',
    title: '梧桐区行走 · 城市文学向导',
    intro: '喜欢在梧桐树下读张爱玲。我带你走一遍老上海的咖啡馆、书店和老洋房。',
    rating: 4.8, ratingCount: 103, completedOrderCount: 246, price: 198, priceMax: 498,
    tags: ['文学', '梧桐', '咖啡'], serviceTypes: ['cityWalk', 'foodTour'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '上海市徐汇区 · 武康路',
    highlights: ['能进百年老洋房', '推荐独立书店', '会讲张爱玲'],
  },
  {
    id: 'gd_000011', name: '白露', gender: 'female', city: '上海',
    title: '商业人像摄影师 · 品牌合作',
    intro: '拍过很多商业人像，最懂怎么让人在镜头前放松下来。两小时给你一组能用的照片。',
    rating: 4.7, ratingCount: 79, completedOrderCount: 187, price: 368, priceMax: 598,
    tags: ['人像', '专业', '修图'], serviceTypes: ['photo', 'parentChild'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '上海市静安区 · 南京西路',
    highlights: ['商业拍摄经验', '现场出片预览', '精修 20 张'],
  },
  {
    id: 'gd_000012', name: '韩笑', gender: 'male', city: '厦门',
    title: '海岛骑楼漫游 · 闽南话十级',
    intro: '本地土生土长，骑楼下的老厝我小时候全玩过。带你吃沙茶面、听闽南话、骑环岛路。',
    rating: 4.9, ratingCount: 92, completedOrderCount: 218, price: 128, priceMax: 428,
    tags: ['闽南', '海边', '骑行'], serviceTypes: ['cityWalk', 'foodTour'],
    languages: ['中文', '闽南语'], verified: true, status: 'active',
    location: '厦门市思明区 · 中山路骑楼街',
    highlights: ['能带你进老厝', '会推荐不踩雷的海鲜', '提供自行车'],
  },
  {
    id: 'gd_000013', name: '罗一鸣', gender: 'male', city: '成都',
    title: '机场接送与跑腿 · 早七到晚十',
    intro: '在机场附近开了六年车，接过凌晨四点的航班，也跑过加急取件。',
    rating: 4.2, ratingCount: 41, completedOrderCount: 176, price: 88, priceMax: 288,
    tags: ['接送', '准时', '好说话'], serviceTypes: ['errand', 'cityWalk'],
    languages: ['中文'], verified: false, status: 'active',
    location: '成都市双流区 · 机场周边',
    highlights: ['举牌接机', '车况干净', '可跑腿办事'],
  },
  {
    id: 'gd_000014', name: '温言', gender: 'female', city: '北京',
    title: '亲子博物馆讲解 · 幼教背景',
    intro: '学幼教出身，知道怎么跟四岁到十岁的孩子说话。博物馆不再枯燥，孩子会主动提问。',
    rating: 4.6, ratingCount: 68, completedOrderCount: 152, price: 228, priceMax: 458,
    tags: ['亲子', '讲解', '耐心'], serviceTypes: ['parentChild', 'sightseeing'],
    languages: ['中文', 'English'], verified: true, status: 'active',
    location: '北京市海淀区 · 中关村',
    highlights: ['幼教专业背景', '给孩子准备任务卡', '会带材料包'],
  },
];

/* ---------------------------------------------------------------------------
 * 服务项定义
 * ------------------------------------------------------------------------ */

const SERVICE_SEEDS = [
  { id: 'si_000001', guideId: 'gd_000001', name: '老巷子美食半日陪逛', serviceType: 'foodTour', price: 168, unit: 'hour', durationHours: 3, description: '三顿当地人排队的馆子，边吃边讲这道菜背后的讲究。', includes: ['3 小时在地陪逛', '3 家店试吃', '点单建议'], icon: 'food' },
  { id: 'si_000002', guideId: 'gd_000001', name: '菜市场与早茶半日体验', serviceType: 'foodTour', price: 88, unit: 'hour', durationHours: 2, description: '从菜市场开始的一天，认识一座城市的味觉地图。', includes: ['2 小时陪逛', '1 顿早茶', '食材讲解'], icon: 'food' },
  { id: 'si_000003', guideId: 'gd_000001', name: '成都市中心老街漫步', serviceType: 'cityWalk', price: 128, unit: 'hour', durationHours: 2, description: '少宽窄巷子，多居民区，看真实生活的样子。', includes: ['2 小时步行', '手绘路线图', '6 个点位'], icon: 'walk' },

  { id: 'si_000004', guideId: 'gd_000002', name: '建筑与骑楼深度漫步', serviceType: 'cityWalk', price: 188, unit: 'hour', durationHours: 3, description: '用建筑学的眼睛看一遍成都的老房子。', includes: ['3 小时', '手绘地图', '历史讲解'], icon: 'walk' },
  { id: 'si_000005', guideId: 'gd_000002', name: '熊猫基地半日陪同', serviceType: 'sightseeing', price: 198, unit: 'hour', durationHours: 4, description: '避开人潮高峰，讲解熊猫行为与基地历史。', includes: ['4 小时', '讲解', '早出发避人'], icon: 'ticket' },
  { id: 'si_000006', guideId: 'gd_000002', name: '都江堰与青城山一日游', serviceType: 'sightseeing', price: 398, unit: 'session', durationHours: 8, description: '包车一日，含讲解与午餐。', includes: ['专车 8 小时', '午餐', '专业讲解'], icon: 'ticket' },

  { id: 'si_000007', guideId: 'gd_000003', name: '亲子博物馆任务式导览', serviceType: 'parentChild', price: 168, unit: 'hour', durationHours: 2, description: '把博物馆变成一场寻宝游戏。', includes: ['2 小时', '任务卡', '亲子合影'], icon: 'child' },
  { id: 'si_000008', guideId: 'gd_000003', name: '动物园半日亲子陪玩', serviceType: 'parentChild', price: 188, unit: 'hour', durationHours: 3, description: '慢节奏逛园，避开人流高峰时段。', includes: ['3 小时', '望远镜借用', '休息点推荐'], icon: 'child' },
  { id: 'si_000009', guideId: 'gd_000003', name: '亲子友好川菜体验课', serviceType: 'foodTour', price: 228, unit: 'hour', durationHours: 2, description: '让孩子亲手做一个川菜，成品打包带走。', includes: ['2 小时', '食材', '成品打包'], icon: 'food' },

  { id: 'si_000010', guideId: 'gd_000004', name: '洪崖洞与南山夜景跟拍', serviceType: 'photo', price: 328, unit: 'hour', durationHours: 2, description: '两处最佳机位，自然光实拍，当天出片。', includes: ['2 小时跟拍', '20 张精修', '原片全送'], icon: 'camera' },
  { id: 'si_000011', guideId: 'gd_000004', name: '火锅一条街寻味', serviceType: 'foodTour', price: 98, unit: 'hour', durationHours: 2, description: '带你去排长队那家，但不让你白等。', includes: ['2 小时', '代取号', '点单攻略'], icon: 'food' },
  { id: 'si_000012', guideId: 'gd_000004', name: '李子坝轻轨穿楼打卡', serviceType: 'cityWalk', price: 158, unit: 'hour', durationHours: 2, description: '本地人视角的城市竖井奇观。', includes: ['2 小时', '机位指导', '轻轨时刻表'], icon: 'walk' },

  { id: 'si_000013', guideId: 'gd_000005', name: '大足石刻深度讲解', serviceType: 'sightseeing', price: 358, unit: 'hour', durationHours: 4, description: '三小时讲清楚宝顶山上的普通人。', includes: ['4 小时', '持证讲解', '免排队协助'], icon: 'ticket' },
  { id: 'si_000014', guideId: 'gd_000005', name: '磁器口与山城步道', serviceType: 'cityWalk', price: 158, unit: 'hour', durationHours: 3, description: '从码头走到崖壁上的老街。', includes: ['3 小时', '历史故事', '拍照点'], icon: 'walk' },
  { id: 'si_000015', guideId: 'gd_000005', name: '两江夜游讲解专享', serviceType: 'sightseeing', price: 458, unit: 'session', durationHours: 3, description: '船上讲解两江夜景与城市史。', includes: ['3 小时', '讲解', '观景位预留'], icon: 'ticket' },

  { id: 'si_000016', guideId: 'gd_000006', name: '兵马俑专车专讲', serviceType: 'sightseeing', price: 398, unit: 'session', durationHours: 7, description: '避开旅行团，独立讲解俑坑细节。', includes: ['专车往返', '讲解', '讲解器'], icon: 'ticket' },
  { id: 'si_000017', guideId: 'gd_000006', name: '碑林与城墙骑行', serviceType: 'sightseeing', price: 158, unit: 'hour', durationHours: 3, description: '骑车绕城墙一圈，碑林里读碑。', includes: ['3 小时', '租车', '讲解'], icon: 'ticket' },
  { id: 'si_000018', guideId: 'gd_000006', name: '回民街美食人文线', serviceType: 'foodTour', price: 120, unit: 'hour', durationHours: 2, description: '边吃边讲这条街的历史与迁客。', includes: ['2 小时', '4 样小吃', '历史讲解'], icon: 'food' },

  { id: 'si_000019', guideId: 'gd_000007', name: '大唐不夜城古风写真', serviceType: 'photo', price: 388, unit: 'hour', durationHours: 2, description: '两小时三套造型，现场看片。', includes: ['2 小时', '3 套造型', '10 张精修'], icon: 'camera' },
  { id: 'si_000020', guideId: 'gd_000007', name: '城市胶片街拍', serviceType: 'photo', price: 288, unit: 'hour', durationHours: 2, description: '胶片质感，不摆拍。', includes: ['2 小时', '20 张精修', '原片全送'], icon: 'camera' },
  { id: 'si_000021', guideId: 'gd_000007', name: '城墙落日跟拍', serviceType: 'cityWalk', price: 328, unit: 'hour', durationHours: 2, description: '在最好的光线时间里走城墙。', includes: ['2 小时', '黄金时刻跟拍', '10 张精修'], icon: 'walk' },

  { id: 'si_000022', guideId: 'gd_000008', name: '中轴线与胡同深度漫步', serviceType: 'cityWalk', price: 268, unit: 'hour', durationHours: 3, description: '从钟楼走到什刹海，进得去老院子。', includes: ['3 小时', '院落参观', '手绘地图'], icon: 'walk' },
  { id: 'si_000023', guideId: 'gd_000008', name: '故宫深度讲解', serviceType: 'sightseeing', price: 458, unit: 'hour', durationHours: 4, description: '避开团队高峰，讲建筑与家族史。', includes: ['4 小时', '讲解', '速查路线'], icon: 'ticket' },
  { id: 'si_000024', guideId: 'gd_000008', name: '长城包车一日游', serviceType: 'sightseeing', price: 528, unit: 'session', durationHours: 10, description: '整车出发，含午餐与司机。', includes: ['专车 10 小时', '午餐', '讲解'], icon: 'ticket' },

  { id: 'si_000025', guideId: 'gd_000009', name: '医院陪诊全流程代办', serviceType: 'errand', price: 288, unit: 'session', durationHours: 4, description: '挂号、排队、缴费、取报告，全程微信同步。', includes: ['4 小时', '全程同步', '代排队'], icon: 'ticket' },
  { id: 'si_000026', guideId: 'gd_000009', name: '政务跑腿代办', serviceType: 'errand', price: 208, unit: 'session', durationHours: 3, description: '居住证、证明、盖章等流程代办。', includes: ['3 小时', '跑腿', '进度同步'], icon: 'ticket' },
  { id: 'si_000027', guideId: 'gd_000009', name: '使馆区西餐探店', serviceType: 'foodTour', price: 268, unit: 'hour', durationHours: 2, description: '使馆区里的隐藏餐厅本地才知道。', includes: ['2 小时', '3 家店', '推荐菜'], icon: 'food' },

  { id: 'si_000028', guideId: 'gd_000010', name: '梧桐区文学漫步', serviceType: 'cityWalk', price: 268, unit: 'hour', durationHours: 3, description: '武康路到思南公馆，六个故事。', includes: ['3 小时', '6 个故事', '手绘地图'], icon: 'walk' },
  { id: 'si_000029', guideId: 'gd_000010', name: '独立书店与咖啡馆巡礼', serviceType: 'foodTour', price: 198, unit: 'hour', durationHours: 3, description: '四家书店加两杯咖啡，慢慢来。', includes: ['3 小时', '4 家书店', '2 杯咖啡'], icon: 'food' },
  { id: 'si_000030', guideId: 'gd_000010', name: '外滩建筑群讲解', serviceType: 'sightseeing', price: 328, unit: 'hour', durationHours: 2, description: '从外滩源讲到陆家嘴。', includes: ['2 小时', '讲解', '机位指导'], icon: 'ticket' },

  { id: 'si_000031', guideId: 'gd_000011', name: '外滩人像写真', serviceType: 'photo', price: 428, unit: 'hour', durationHours: 2, description: '经典机位，自然光加补光。', includes: ['2 小时', '2 套造型', '15 张精修'], icon: 'camera' },
  { id: 'si_000032', guideId: 'gd_000011', name: '亲子家庭写真', serviceType: 'parentChild', price: 368, unit: 'hour', durationHours: 2, description: '抓拍为主，不打扰孩子。', includes: ['2 小时', '抓拍', '20 张精修'], icon: 'child' },
  { id: 'si_000033', guideId: 'gd_000011', name: '西装商务形象照', serviceType: 'photo', price: 588, unit: 'session', durationHours: 3, description: '三套商务造型，当天可用。', includes: ['3 小时', '3 套造型', '精修 20 张'], icon: 'camera' },

  { id: 'si_000034', guideId: 'gd_000012', name: '骑楼街与老厝半日', serviceType: 'cityWalk', price: 168, unit: 'hour', durationHours: 3, description: '走进老厝，尝一碗地道的沙茶面。', includes: ['3 小时', '进老厝', '闽南话讲解'], icon: 'walk' },
  { id: 'si_000035', guideId: 'gd_000012', name: '环岛路骑行看海', serviceType: 'cityWalk', price: 128, unit: 'hour', durationHours: 2, description: '自行车、椰林与日落。', includes: ['2 小时', '自行车', '拍照指导'], icon: 'walk' },
  { id: 'si_000036', guideId: 'gd_000012', name: '鼓浪屿人少路线', serviceType: 'sightseeing', price: 328, unit: 'session', durationHours: 5, description: '避开主街，钻进小巷和老别墅。', includes: ['5 小时', '船票代订', '路线设计'], icon: 'ticket' },

  { id: 'si_000037', guideId: 'gd_000013', name: '机场接送单程', serviceType: 'errand', price: 88, unit: 'session', durationHours: 1, description: '举牌接机，车况干净。', includes: ['1 次接送', '举牌', '免费等待 30 分钟'], icon: 'ticket' },
  { id: 'si_000038', guideId: 'gd_000013', name: '加急取件与跑腿', serviceType: 'errand', price: 128, unit: 'session', durationHours: 2, description: '同城文件、证件加急取送。', includes: ['2 小时', '跑腿', '进度同步'], icon: 'ticket' },
  { id: 'si_000039', guideId: 'gd_000013', name: '成都周边一日包车', serviceType: 'cityWalk', price: 288, unit: 'session', durationHours: 8, description: '车 + 司机，按你的行程走。', includes: ['专车 8 小时', '司机', '油费'], icon: 'walk' },

  { id: 'si_000040', guideId: 'gd_000014', name: '国家博物馆亲子讲解', serviceType: 'parentChild', price: 328, unit: 'hour', durationHours: 3, description: '任务卡式导览，孩子全程有参与。', includes: ['3 小时', '任务卡', '材料包'], icon: 'child' },
  { id: 'si_000041', guideId: 'gd_000014', name: '首都博物馆半日', serviceType: 'sightseeing', price: 228, unit: 'hour', durationHours: 3, description: '避开人潮，孩子不累。', includes: ['3 小时', '讲解', '休息安排'], icon: 'ticket' },
  { id: 'si_000042', guideId: 'gd_000014', name: '科技馆动手课堂', serviceType: 'parentChild', price: 258, unit: 'hour', durationHours: 3, description: '动手实验为主，适合 6 岁以上。', includes: ['3 小时', '实验材料', '讲解'], icon: 'child' },
];

/* ---------------------------------------------------------------------------
 * 用户
 * ------------------------------------------------------------------------ */

function buildUsers() {
  const now = new Date().toISOString();
  const users = [
    {
      id: 'us_000001', openid: 'mock-user-001', nickname: '随行用户001',
      avatar: avatar('dipi-u001'), gender: 'female', phone: '13800000001',
      city: '成都', bio: '出差顺便玩两天，想找个本地人带路。',
      tags: ['美食控', '轻装出行'], role: 'user', guideId: null,
      realNameVerified: false, realNameStatus: 'none', memberLevel: 'normal',
      createdAt: daysAgo(120), updatedAt: daysAgo(3),
    },
    {
      id: 'us_000002', openid: 'mock-user-002', nickname: '随行用户002',
      avatar: avatar('dipi-u002'), gender: 'male', phone: '13800000002',
      city: '上海', bio: '另一个测试用户，用于验证越权防护。',
      tags: ['摄影'], role: 'user', guideId: null,
      realNameVerified: false, realNameStatus: 'none', memberLevel: 'normal',
      createdAt: daysAgo(60), updatedAt: daysAgo(10),
    },
  ];

  // 地陪账号：openid = mock-guide-XXX（XXX 与地陪序号对应）
  GUIDE_SEEDS.forEach((g, idx) => {
    users.push({
      id: `us_${String(100 + idx).padStart(6, '0')}`,
      openid: `mock-guide-${String(idx + 1).padStart(3, '0')}`,
      nickname: g.name,
      avatar: avatar(`dipi-gd${idx + 1}`),
      gender: g.gender,
      phone: `1380000${String(200 + idx).padStart(4, '0')}`,
      city: g.city,
      bio: g.title,
      tags: [],
      role: 'guide',
      guideId: g.id,
      realNameVerified: true,
      realNameStatus: 'verified',
      memberLevel: 'normal',
      createdAt: daysAgo(300 + idx),
      updatedAt: daysAgo(idx + 1),
    });
  });

  return users;
}

/* ---------------------------------------------------------------------------
 * 评价
 * ------------------------------------------------------------------------ */

const REVIEW_SEEDS = [
  { guide: 'gd_000001', user: 'us_000001', rating: 5, content: '小满带我们去了三家本地人排队的老馆子，其中一家连地图上都搜不到。讲解很实在，没有一句广告。', tags: ['本地人', '讲解好'], service: '老巷子美食半日陪逛' },
  { guide: 'gd_000001', user: 'us_000002', rating: 5, content: '全程两个半小时，吃得很撑。她还会提醒哪些菜别点、哪些必点。', tags: ['性价比高'], service: '菜市场与早茶半日体验' },
  { guide: 'gd_000001', user: 'us_000001', rating: 4, content: '内容很棒，就是中间有一段路程稍远，走了不少路。总体推荐。', tags: ['体验好'], service: '成都市中心老街漫步' },
  { guide: 'gd_000002', user: 'us_000001', rating: 5, content: '建筑背景的人讲建筑，完全不一样。给的路线图手绘的，太有用了。', tags: ['专业', '手绘地图'], service: '建筑与骑楼深度漫步' },
  { guide: 'gd_000002', user: 'us_000002', rating: 5, content: '熊猫基地早上七点到，人少熊猫活跃。讲解把基地的历史讲清楚了。', tags: ['避人潮', '讲解好'], service: '熊猫基地半日陪同' },
  { guide: 'gd_000003', user: 'us_000002', rating: 5, content: '孩子四岁，本来担心听不懂，结果全程主动提问。任务卡设计得很好。', tags: ['耐心', '亲子首选'], service: '亲子博物馆任务式导览' },
  { guide: 'gd_000003', user: 'us_000001', rating: 4, content: '节奏很好，不赶。中途安排的休息点也准。', tags: ['轻松'], service: '动物园半日亲子陪玩' },
  { guide: 'gd_000004', user: 'us_000001', rating: 5, content: '夜景照片真的绝，洪崖洞那个机位她提前一小时就占了。', tags: ['出片', '专业'], service: '洪崖洞与南山夜景跟拍' },
  { guide: 'gd_000004', user: 'us_000002', rating: 5, content: '她带我们避开了排队高峰，代取号也很靠谱。火锅攻略非常准。', tags: ['效率高'], service: '火锅一条街寻味' },
  { guide: 'gd_000005', user: 'us_000001', rating: 5, content: '三小时讲石刻上的普通人，不是照着说明牌念。非常值。', tags: ['讲解好', '历史'], service: '大足石刻深度讲解' },
  { guide: 'gd_000005', user: 'us_000002', rating: 4, content: '讲得好，就是从市区过去车程比较久，建议留足时间。', tags: ['讲解好'], service: '磁器口与山城步道' },
  { guide: 'gd_000006', user: 'us_000002', rating: 5, content: '专车专讲太值了，不用跟大部队挤。', tags: ['专业', '避人流'], service: '兵马俑专车专讲' },
  { guide: 'gd_000006', user: 'us_000001', rating: 5, content: '骑车绕城墙一圈那段特别好，比走有意思。碑林也讲得清楚。', tags: ['体验好'], service: '碑林与城墙骑行' },
  { guide: 'gd_000007', user: 'us_000001', rating: 4, content: '照片很自然，不尴尬。妆造换得挺快，整体不错。', tags: ['自然', '出片'], service: '大唐不夜城古风写真' },
  { guide: 'gd_000007', user: 'us_000002', rating: 4, content: '等光线等了一会儿，但出来的片子确实好看。', tags: ['出片'], service: '城市胶片街拍' },
  { guide: 'gd_000008', user: 'us_000002', rating: 5, content: '居然进得去一个老院子，那一刻觉得值回票价。', tags: ['深度', '本地人'], service: '中轴线与胡同深度漫步' },
  { guide: 'gd_000008', user: 'us_000001', rating: 5, content: '故宫四小时讲得密而不乱，给的速查路线救命了。', tags: ['讲解好', '专业'], service: '故宫深度讲解' },
  { guide: 'gd_000008', user: 'us_000002', rating: 5, content: '长城包车很舒服，车况好，路上还停下来讲了两个小村子的故事。', tags: ['包车', '讲解好'], service: '长城包车一日游' },
  { guide: 'gd_000009', user: 'us_000001', rating: 4, content: '全程微信同步进度，医院里排队那段确实省了我半天。', tags: ['靠谱', '效率高'], service: '医院陪诊全流程代办' },
  { guide: 'gd_000009', user: 'us_000002', rating: 4, content: '跑腿速度可以，就是等待时间有点长，整体还行。', tags: ['效率高'], service: '政务跑腿代办' },
  { guide: 'gd_000010', user: 'us_000002', rating: 5, content: '六个故事讲梧桐区，每一段都有细节。文艺路线首选。', tags: ['文学', '深度'], service: '梧桐区文学漫步' },
  { guide: 'gd_000010', user: 'us_000001', rating: 5, content: '书店咖啡馆清单太实用了，每家都待了半小时，一点不赶。', tags: ['轻松', '本地人'], service: '独立书店与咖啡馆巡礼' },
  { guide: 'gd_000011', user: 'us_000001', rating: 5, content: '修图很专业，交付也快。', tags: ['修图好', '出片'], service: '外滩人像写真' },
  { guide: 'gd_000011', user: 'us_000002', rating: 4, content: '孩子一开始紧张，后来完全放开了，抓拍很自然。', tags: ['亲子', '自然'], service: '亲子家庭写真' },
  { guide: 'gd_000012', user: 'us_000002', rating: 5, content: '能进老厝这一项就值了。闽南话夹杂着讲，很有意思。', tags: ['本地人', '体验好'], service: '骑楼街与老厝半日' },
  { guide: 'gd_000012', user: 'us_000001', rating: 4, content: '环岛路骑行很舒服，就是中午太阳有点晒，建议带帽子。', tags: ['轻松'], service: '环岛路骑行看海' },
  { guide: 'gd_000013', user: 'us_000001', rating: 4, content: '接机准时，车很干净。下次还找他。', tags: ['准时', '靠谱'], service: '机场接送单程' },
  { guide: 'gd_000014', user: 'us_000002', rating: 5, content: '任务卡让孩子全程有目标，最后还得了张奖状。', tags: ['亲子首选', '耐心'], service: '国家博物馆亲子讲解' },
];

/* ---------------------------------------------------------------------------
 * 会话与消息
 * ------------------------------------------------------------------------ */

const CONVERSATION_SEEDS = [
  {
    id: 'cv_000001', userId: 'us_000001', guideId: 'gd_000001',
    lastMessage: '可以的，周六上午九点太古里南门见～',
    lastTime: hoursFromNow(-2), unreadCount: 2,
    messages: [
      { from: 'us_000001', type: 'text', content: '你好，我下周六在成都，想找个人带我吃一吃本地的东西，半天就行。' },
      { from: 'gd_000001', type: 'text', content: '你好呀～本地人带路这事儿我在行。想吃辣的还是清淡一点？' },
      { from: 'us_000001', type: 'text', content: '都可以，主要想尝点平时吃不到的，不要游客店。' },
      { from: 'gd_000001', type: 'text', content: '懂了，那走菜市场 + 老馆子那条线。上午九点开始，中午就能吃到三家。' },
      { from: 'us_000001', type: 'text', content: '周六上午九点可以吗？' },
      { from: 'gd_000001', type: 'text', content: '可以的，周六上午九点太古里南门见～' },
    ],
  },
  {
    id: 'cv_000002', userId: 'us_000001', guideId: 'gd_000008',
    lastMessage: '故宫那张路线图我发你邮箱了。',
    lastTime: hoursFromNow(-26), unreadCount: 0,
    messages: [
      { from: 'us_000001', type: 'text', content: '下个月想去故宫，怕人多，有没有什么避开高峰的办法？' },
      { from: 'gd_000008', type: 'text', content: '有。开门第一批进去，八点半前的中轴线人少一半。我给你画了条速查路线。' },
      { from: 'gd_000008', type: 'text', content: '故宫那张路线图我发你邮箱了。' },
    ],
  },
  {
    id: 'cv_000003', userId: 'us_000001', guideId: 'gd_000003',
    lastMessage: '好的，四岁孩子，麻烦准备了。',
    lastTime: hoursFromNow(-50), unreadCount: 1,
    messages: [
      { from: 'us_000001', type: 'text', content: '带四岁小孩，博物馆这种会不会太闷？' },
      { from: 'gd_000003', type: 'text', content: '不会，我有一套任务卡，全程孩子都有事做。' },
      { from: 'us_000001', type: 'text', content: '好的，四岁孩子，麻烦准备了。' },
    ],
  },
  {
    id: 'cv_000004', userId: 'us_000002', guideId: 'gd_000010',
    lastMessage: '武康路那边我周末常在，随时可以约。',
    lastTime: hoursFromNow(-5), unreadCount: 0,
    messages: [
      { from: 'us_000002', type: 'text', content: '想拍一组复古点的照片，梧桐区适合吗？' },
      { from: 'gd_000010', type: 'text', content: '太适合了，我周末常在那边。周末下午光线最好，随时可以约。' },
    ],
  },
  {
    id: 'cv_000005', userId: 'us_000001', guideId: 'gd_000004',
    lastMessage: '日落前四十分钟到就行，我把机位踩好了。',
    lastTime: hoursFromNow(-72), unreadCount: 0,
    messages: [
      { from: 'us_000001', type: 'text', content: '重庆夜景跟拍大概需要多久？' },
      { from: 'gd_000004', type: 'text', content: '两小时足够，洪崖洞和南山各一段。日落前四十分钟到就行，我把机位踩好了。' },
    ],
  },
];

/* ---------------------------------------------------------------------------
 * 订单（覆盖全部 10 态）
 * ------------------------------------------------------------------------ */

const ORDER_SEEDS = [
  { id: 'ord_000001', userId: 'us_000001', guideId: 'gd_000001', serviceId: 'si_000001', status: pendingPayment, dayOffsetDays: 3, slotSuffix: 'am', travelers: 2, createdDaysAgo: 0, remark: '不吃太辣', contactName: '王一', contactPhone: '13800000001' },
  { id: 'ord_000002', userId: 'us_000001', guideId: 'gd_000008', serviceId: 'si_000023', status: pendingAccept, dayOffsetDays: 7, slotSuffix: 'am', travelers: 2, createdDaysAgo: 1, remark: '', contactName: '王一', contactPhone: '13800000001' },
  { id: 'ord_000003', userId: 'us_000001', guideId: 'gd_000006', serviceId: 'si_000017', status: accepted, dayOffsetDays: 5, slotSuffix: 'pm', travelers: 3, createdDaysAgo: 3, remark: '带一位长辈', contactName: '王一', contactPhone: '13800000001' },
  { id: 'ord_000004', userId: 'us_000001', guideId: 'gd_000012', serviceId: 'si_000034', status: inService, dayOffsetDays: 0, slotSuffix: 'am', travelers: 2, createdDaysAgo: 6, remark: '', contactName: '王一', contactPhone: '13800000001' },
  { id: 'ord_000005', userId: 'us_000001', guideId: 'gd_000010', serviceId: 'si_000028', status: pendingConfirm, dayOffsetDays: -1, slotSuffix: 'pm', travelers: 2, createdDaysAgo: 8, remark: '', contactName: '王一', contactPhone: '13800000001' },
  { id: 'ord_000006', userId: 'us_000001', guideId: 'gd_000002', serviceId: 'si_000005', status: completed, dayOffsetDays: -12, slotSuffix: 'am', travelers: 2, createdDaysAgo: 20, remark: '孩子很喜欢', contactName: '王一', contactPhone: '13800000001', rating: 5, comment: '讲解很棒，孩子回来一直在讲熊猫。' },
  { id: 'ord_000007', userId: 'us_000001', guideId: 'gd_000007', serviceId: 'si_000020', status: completed, dayOffsetDays: -25, slotSuffix: 'pm', travelers: 1, createdDaysAgo: 33, remark: '', contactName: '王一', contactPhone: '13800000001', rating: 4, comment: '照片很自然，就是等光线等了一会儿。' },
  { id: 'ord_000008', userId: 'us_000001', guideId: 'gd_000013', serviceId: 'si_000037', status: cancelled, dayOffsetDays: -5, slotSuffix: 'am', travelers: 1, createdDaysAgo: 9, remark: '', contactName: '王一', contactPhone: '13800000001', cancelReason: '航班时间变动' },
  { id: 'ord_000009', userId: 'us_000001', guideId: 'gd_000009', serviceId: 'si_000025', status: refunding, dayOffsetDays: -2, slotSuffix: 'am', travelers: 1, createdDaysAgo: 14, remark: '', contactName: '王一', contactPhone: '13800000001', refundReason: '服务未按时开始' },
  { id: 'ord_000010', userId: 'us_000001', guideId: 'gd_000014', serviceId: 'si_000040', status: refunded, dayOffsetDays: -18, slotSuffix: 'am', travelers: 2, createdDaysAgo: 26, remark: '', contactName: '王一', contactPhone: '13800000001', refundReason: '临时有事，无法成行' },
  { id: 'ord_000011', userId: 'us_000002', guideId: 'gd_000011', serviceId: 'si_000031', status: pendingPayment, dayOffsetDays: 4, slotSuffix: 'pm', travelers: 1, createdDaysAgo: 0, remark: '', contactName: '李二', contactPhone: '13800000002' },
  { id: 'ord_000012', userId: 'us_000001', guideId: 'gd_000009', serviceId: 'si_000026', status: closed, dayOffsetDays: -9, slotSuffix: 'am', travelers: 1, createdDaysAgo: 11, remark: '', contactName: '王一', contactPhone: '13800000001', cancelReason: '地陪未能接单，订单已关闭，金额原路退回' },
];

/* ---------------------------------------------------------------------------
 * 通知 / 收藏 / 设置
 * ------------------------------------------------------------------------ */

const NOTICE_SEEDS = [
  { userId: 'us_000001', type: 'system', title: '欢迎来到随行', content: '在这里，你可以预约当地的私人向导，让每一次出行都有人带路。', extra: null, createdDaysAgo: 30, read: true },
  { userId: 'us_000001', type: 'order', title: '订单已待接单', content: '你预约的「故宫深度讲解」已支付，正在等待地陪接单。', extra: { orderId: 'ord_000002' }, createdDaysAgo: 1, read: false },
  { userId: 'us_000001', type: 'order', title: '服务即将开始', content: '明天 13:00 的「梧桐区文学漫步」记得准时出发。', extra: { orderId: 'ord_000005' }, createdDaysAgo: 1, read: false },
  { userId: 'us_000001', type: 'refund', title: '退款申请已提交', content: '「医院陪诊全流程代办」的退款申请已提交，地陪将在 24 小时内处理。', extra: { orderId: 'ord_000009' }, createdDaysAgo: 2, read: false },
  { userId: 'us_000001', type: 'promotion', title: '新人专享：首单 9 折', content: '你的首单已享受 9 折优惠，下一单继续有新人礼包。', extra: null, createdDaysAgo: 12, read: true },
  { userId: 'us_000002', type: 'system', title: '欢迎来到随行', content: '选择一位地陪，让你的城市之行有人带路。', extra: null, createdDaysAgo: 20, read: false },
];

const FAVORITE_SEEDS = [
  { userId: 'us_000001', guideId: 'gd_000001' },
  { userId: 'us_000001', guideId: 'gd_000008' },
  { userId: 'us_000001', guideId: 'gd_000004' },
  { userId: 'us_000002', guideId: 'gd_000010' },
];

const SETTINGS_SEEDS = [
  {
    userId: 'us_000001', notifyEnabled: true, notifyOrder: true, notifyMessage: true,
    notifyRefund: true, notifyPromotion: false, notifySound: true,
    privacyLocation: false, privacyShowProfile: true, privacyShowOrder: false,
    autoConfirmOrder: false,
  },
  {
    userId: 'us_000002', notifyEnabled: true, notifyOrder: true, notifyMessage: true,
    notifyRefund: true, notifyPromotion: true, notifySound: false,
    privacyLocation: true, privacyShowProfile: true, privacyShowOrder: true,
    autoConfirmOrder: true,
  },
];

/* ---------------------------------------------------------------------------
 * 写库
 * ------------------------------------------------------------------------ */

/**
 * 按订单状态生成时间轴
 */
function buildTimeline(status, createdAt, o) {
  const t = [];
  const push = (s, note, operator) => t.push({
    status: s,
    statusText: STATUS_TEXT[s] || s,
    at: toCstIso(createdAt),
    note: note || '',
    operator: operator || 'system',
  });

  push(pendingPayment, '订单已创建', 'user');
  if (status !== pendingPayment) push(pendingAccept, '支付成功', 'system');
  if ([accepted, inService, pendingConfirm,
    completed, refunding, refunded].includes(status)) {
    push(accepted, '地陪已接单', 'guide');
  }
  if ([inService, pendingConfirm, completed].includes(status)) {
    push(inService, '服务已开始', 'guide');
  }
  if ([pendingConfirm, completed].includes(status)) {
    push(pendingConfirm, '服务已结束，等待确认', 'guide');
  }
  if (status === completed) push(completed, '用户已确认完成', 'user');
  if (status === cancelled) push(cancelled, o.cancelReason || '用户主动取消', 'user');
  if (status === closed) push(closed, o.cancelReason || '订单已关闭', 'system');
  if (status === refunding) push(refunding, o.refundReason || '已提交退款申请', 'user');
  if (status === refunded) push(refunded, '退款已到账', 'system');
  return t;
}

/**
 * 生成种子数据并写入 JSON 文件
 * @param {{silent?:boolean, force?:boolean}} [opts]
 */
async function seed(opts = {}) {
  const { silent = false, force = false } = opts;

  if (force) {
    store.clearAll();
  } else if (store.read('guides').length > 0) {
    if (!silent) console.log('[seed] 数据已存在，跳过。如需重写请执行：npm run seed:force');
    return { skipped: true };
  }

  const log = (...args) => { if (!silent) console.log(...args); };
  const slots = buildSlots();

  /* ---- 地陪 ---- */
  const guides = GUIDE_SEEDS.map((g, idx) => ({
    id: g.id,
    name: g.name,
    avatar: avatar(`dipi-gd${idx + 1}`),
    cover: cover(`dipi-gd${idx + 1}`),
    photoUrls: [cover(`dipi-gd${idx + 1}-1`), cover(`dipi-gd${idx + 1}-2`), cover(`dipi-gd${idx + 1}-3`)],
    gender: g.gender,
    city: g.city,
    district: g.location ? String(g.location).split(' ')[0] : '',
    cities: [g.city],
    title: g.title,
    intro: g.intro,
    rating: g.rating,
    ratingCount: g.ratingCount,
    completedOrderCount: g.completedOrderCount,
    responseTimeMin: 5 + (idx % 6) * 3,
    priceAmount: yuanToCents(g.price),
    priceMaxAmount: yuanToCents(g.priceMax),
    priceUnit: 'hour',
    tags: g.tags,
    serviceTypes: g.serviceTypes,
    languages: g.languages,
    highlights: g.highlights,
    verified: g.verified,
    status: g.status,
    location: g.location,
    favoritesCount: 0,
    bookedSlots: [],          // 地陪级时段占用（同一时段该地陪只能陪一个人）
    availableSlots: slots,
    createdAt: daysAgo(360 - idx * 5),
    updatedAt: daysAgo(idx + 1),
  }));
  store.read('guides').length = 0;
  store.insertMany('guides', guides);
  log(`[seed] 地陪 ${guides.length} 位`);

  /* ---- 服务项 ---- */
  const services = SERVICE_SEEDS.map((s) => ({
    id: s.id,
    guideId: s.guideId,
    name: s.name,
    serviceType: s.serviceType,
    description: s.description,
    priceAmount: yuanToCents(s.price),
    priceUnit: s.unit === 'trip' ? 'session' : s.unit,
    priceUnitText: s.unit === 'trip' ? '次' : (s.unit === 'hour' ? '小时' : '人次'),
    durationHours: s.durationHours,
    minTravelers: 1,
    maxTravelers: s.unit === 'session' ? 6 : 8,
    includes: s.includes,
    icon: s.icon,
    slots,
    createdAt: daysAgo(300),
  }));
  store.read('serviceItems').length = 0;
  store.insertMany('serviceItems', services);
  log(`[seed] 服务项 ${services.length} 项（时段 ${slots.length} 个 / 项）`);

  /* ---- 用户 ---- */
  const users = buildUsers();
  store.read('users').length = 0;
  store.insertMany('users', users);
  log(`[seed] 用户 ${users.length} 个`);

  /* ---- 评价 ---- */
  const reviews = REVIEW_SEEDS.map((r, idx) => {
    const guide = guides.find((g) => g.id === r.guide);
    const user = users.find((u) => u.id === r.user);
    return {
      id: `rv_${String(idx + 1).padStart(6, '0')}`,
      orderId: `ord_seed_${idx + 1}`,
      guideId: r.guide,
      userId: r.user,
      userName: user ? user.nickname : '用户',
      userAvatar: user ? user.avatar : avatar('dipi-anon'),
      rating: r.rating,
      content: r.content,
      tags: r.tags,
      images: [cover(`dipi-rev-${idx + 1}`)],
      serviceName: r.service,
      createdAt: daysAgo(60 - idx),
    };
  });
  store.read('reviews').length = 0;
  store.insertMany('reviews', reviews);
  log(`[seed] 评价 ${reviews.length} 条`);

  /* ---- 会话与消息 ---- */
  const conversations = [];
  const messages = [];
  let msgIdx = 0;
  CONVERSATION_SEEDS.forEach((c) => {
    const conv = {
      id: c.id,
      userId: c.userId,
      guideId: c.guideId,
      lastMessage: c.lastMessage,
      lastMessageId: '',
      lastMessageType: 'text',
      lastTime: c.lastTime,
      unreadCount: c.unreadCount,
      firstUnreadSeq: null,
      seq: c.messages.length,
      closed: false,
      closedReason: '',
      linkedOrderId: null,
      linkedOrderStatus: null,
      createdAt: hoursFromNow(-(c.messages.length * 2 + 6)),
      updatedAt: c.lastTime,
    };
    conversations.push(conv);

    const total = c.messages.length;
    c.messages.forEach((m, i) => {
      msgIdx += 1;
      const createdAt = hoursFromNow(-(total - i) * 2 - 1);
      messages.push({
        id: `ms_${String(msgIdx).padStart(6, '0')}`,
        conversationId: c.id,
        seq: i + 1,
        from: m.from,
        fromUserId: m.from,
        to: m.from === c.userId ? `guide_${c.guideId}` : c.userId,
        type: m.type || 'text',
        messageType: m.type || 'text',
        content: m.content,
        imageUrl: null,
        orderSummary: null,
        clientMessageId: null,
        isRead: true,
        createdAt,
      });
    });
    conv.lastMessageId = messages[messages.length - 1].id;
  });
  store.read('conversations').length = 0;
  store.read('messages').length = 0;
  store.insertMany('conversations', conversations);
  store.insertMany('messages', messages);
  log(`[seed] 会话 ${conversations.length} 个 · 消息 ${messages.length} 条`);

  /* ---- 订单 ---- */
  const orders = ORDER_SEEDS.map((o, oi) => {
    const serviceItem = services.find((s) => s.id === o.serviceId);
    const guide = guides.find((g) => g.id === o.guideId);
    const price = orderService.calcPrice(serviceItem, o.travelers, { isFirstOrder: false });
    const createdAt = daysAgo(o.createdDaysAgo);
    const status = o.status;
    const date = dayOffset(o.dayOffsetDays);
    const slotInfo = SLOT_SUFFIX.find((t) => t.suffix === o.slotSuffix) || SLOT_SUFFIX[0];
    const slotId = `${date}-${slotInfo.suffix}`;
    const paid = status !== pendingPayment;

    return {
      id: o.id,
      orderNo: `SX${o.id.slice(-4)}${String(oi + 1).padStart(3, '0')}`,
      userId: o.userId,
      guideId: o.guideId,
      serviceId: o.serviceId,
      serviceName: serviceItem.name,
      serviceType: serviceItem.serviceType,
      serviceIcon: serviceItem.icon,
      priceUnit: serviceItem.priceUnit,
      city: guide.city,
      slotId,
      date,
      timeSlot: slotInfo.timeSlot,
      // scheduledAt 是服务端回显的服务时间，仅用于展示；
      // 下单提交的是 slotId，两者语义不同（slotId 是稳定唯一标识，可被原子核销）
      scheduledAt: `${date}T${slotInfo.timeSlot.split('-')[0]}:00+08:00`,
      endAt: null,
      travelers: o.travelers,
      meetingPoint: '',
      unitPriceAmount: price.unitPriceAmount,
      durationHours: serviceItem.durationHours,
      durationFactor: price.durationFactor,
      peopleFactor: price.peopleFactor,
      subtotalAmount: price.subtotalAmount,
      discountAmount: price.discountAmount,
      discountReason: price.discountReason,
      totalAmount: price.totalAmount,
      extraAmount: 0,
      refundAmount: status === refunding || status === refunded
        ? price.totalAmount : 0,
      currency: 'CNY',
      remark: o.remark || '',
      contactName: o.contactName,
      contactPhone: o.contactPhone,
      conversationId: null,
      idempotencyKey: null,
      status,
      statusText: STATUS_TEXT[status],
      statusBadge: STATUS_BADGE[status],
      statusTone: STATUS_TONE[status],
      cancelReason: o.cancelReason || null,
      refundReason: o.refundReason || null,
      refundReasonCode: null,
      refundStatus: status === refunding ? 'processing'
        : (status === refunded ? 'success' : 'none'),
      refundFromStatus: status === refunding ? completed : null,
      disputeStatus: 'none',
      rating: o.rating || null,
      comment: o.comment || '',
      timeline: buildTimeline(status, createdAt, o),
      createdAt,
      updatedAt: createdAt,
      expireAt: new Date(new Date(createdAt).getTime() + 15 * 60000).toISOString(),
      paidAt: paid ? createdAt : null,
      acceptedAt: [accepted, inService, pendingConfirm,
        completed, refunding, refunded].includes(status) ? createdAt : null,
      startedAt: [inService, pendingConfirm, completed].includes(status) ? createdAt : null,
      endedAt: [pendingConfirm, completed].includes(status) ? createdAt : null,
      completedAt: status === completed ? createdAt : null,
      confirmedAt: status === completed ? createdAt : null,
      cancelledAt: status === cancelled || status === closed ? createdAt : null,
      refundAppliedAt: [refunding, refunded].includes(status) ? createdAt : null,
      refundedAt: status === refunded ? createdAt : null,
    };
  });
  store.read('orders').length = 0;
  store.insertMany('orders', orders);

  // 地陪级时段核销：把「未来日期」订单已占用的时段登记到地陪的 bookedSlots
  const todayStr = dayOffset(0);
  for (const o of orders) {
    if (o.date < todayStr) continue;              // 过去的订单不再占用未来时段
    const guide = guides.find((g) => g.id === o.guideId);
    if (!guide) continue;
    if (!guide.bookedSlots.includes(o.slotId)) guide.bookedSlots.push(o.slotId);
  }
  store.markDirty('guides');
  const bookedCount = guides.reduce((n, g) => n + g.bookedSlots.length, 0);
  log(`[seed] 订单 ${orders.length} 单（覆盖 ${new Set(orders.map((o) => o.status)).size} 种状态）`
    + ` · 地陪级已占用时段 ${bookedCount} 个`);

  /* ---- 通知 ---- */
  const notices = NOTICE_SEEDS.map((n, idx) => ({
    id: `ntf_${String(idx + 1).padStart(6, '0')}`,
    userId: n.userId,
    type: n.type,
    title: n.title,
    content: n.content,
    read: n.read,
    extra: n.extra,
    createdAt: daysAgo(n.createdDaysAgo),
  }));
  store.read('notifications').length = 0;
  store.insertMany('notifications', notices);
  log(`[seed] 通知 ${notices.length} 条`);

  /* ---- 收藏 ---- */
  const favorites = FAVORITE_SEEDS.map((f, idx) => ({
    id: `fv_${String(idx + 1).padStart(6, '0')}`,
    userId: f.userId,
    guideId: f.guideId,
    createdAt: daysAgo(20 - idx),
  }));
  store.read('favorites').length = 0;
  store.insertMany('favorites', favorites);
  // 回写地陪收藏计数
  for (const g of guides) {
    g.favoritesCount = favorites.filter((f) => f.guideId === g.id).length;
  }
  store.markDirty('guides');
  log(`[seed] 收藏 ${favorites.length} 条`);

  /* ---- 设置 ---- */
  const settings = SETTINGS_SEEDS.map((s) => ({
    ...s,
    id: `st_${s.userId}`,
    updatedAt: daysAgo(5),
  }));
  store.read('settings').length = 0;
  store.insertMany('settings', settings);
  log(`[seed] 设置 ${settings.length} 项`);

  await store.flushAll();

  if (!silent) {
    console.log('');
    console.log('[seed] 种子数据生成完成 →', store.dir);
    console.log('[seed] 测试账号：用户 code=mock-user-001，地陪 code=mock-guide-001');
    console.log('');
  }

  return { skipped: false, guides: guides.length, orders: orders.length, reviews: reviews.length };
}

module.exports = { seed, GUIDE_SEEDS, SERVICE_SEEDS, ORDER_SEEDS };

if (require.main === module) {
  const force = process.argv.includes('--force');
  seed({ force })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] 生成失败:', err);
      process.exit(1);
    });
}
