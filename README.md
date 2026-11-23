# 随行 dipi · 线下地陪服务小程序

> 微信小程序客户端 + Node.js 服务端的完整实现。用户在异地旅行 / 出差 / 探亲时，预约当地地陪做陪同向导服务（美食陪逛、城市漫游、景点讲解、拍照跟拍、亲子陪玩、代排队办事）。

```
客户端：微信小程序原生（WXML / WXSS / JS），零 npm 依赖，自研组件
服务端：Node.js 22 + Express 4 + ws 8，JSON 文件持久化，零外部服务
```

---

## 快速开始

### 服务端

```bash
cd server
npm install
npm run seed     # 生成种子数据（首次启动会自动执行）
npm start        # http://127.0.0.1:3000
```

```bash
npm test              # 接口测试（node:test）
node scripts/smoke.js # 冒烟脚本：逐个探测主要接口
```

### 客户端

1. 微信开发者工具 → **导入项目** → 目录选 `miniprogram/`
2. **详情 → 本地设置** → 勾选「不校验合法域名、IP 或 TLS」（本地联调必需）
3. 确认 `miniprogram/config/index.js` 的 `BASE_URL` 指向你的服务端地址

### 验证脚本

```bash
node scripts/check-miniprogram.js   # 静态检查：页面完整性 / 裸 HEX / 组件声明 / 请求收敛
node scripts/smoke-miniprogram.js   # 客户端逻辑冒烟：60 个用例
```

---

## 页面构成（8 页）

| 路由 | 页面 | 核心能力 |
|---|---|---|
| `/pages/home/home` | 首页 | 推荐地陪横向卡片、热门目的地、服务类型分类、搜索入口 |
| `/pages/search/search` | 搜索页 | 关键词防抖、目的地/服务类型/价格区间/评分组合筛选、4 种排序、分页 |
| `/pages/chat/chat` | 聊天页 | 实时消息、失败重发（幂等 `clientMessageId`）、离线草稿、未读定位 |
| `/pages/order/order` | 订单页 | 状态分栏、详情子视图、支付/取消/确认/退款/评价 |
| `/pages/message/message` | 消息页 | 系统通知 + 聊天会话统一列表、未读数实时同步 |
| `/pages/profile/profile` | 我的 | 资料、订单统计、我的订单、我的收藏、设置项 |
| `/pages/guide/detail` | 地陪详情 | 完整资料、服务项选择、可约时段、评价、咨询、收藏 |
| `/pages/order/create` | 下单确认 | 服务项/时段/人数/联系人表单、实时总价、幂等提交、草稿恢复 |

底部 TabBar 4 项：首页 / 消息 / 订单 / 我的。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/01-visual-design.md`](docs/01-visual-design.md) | 视觉规范：色板（含对比度实测）、字阶、间距标尺、组件视觉 4 态、避免清单 |
| [`docs/02-ux-spec.md`](docs/02-ux-spec.md) | 体验规范：8 页逐页的交互流程 / 数据字段 / 状态态 / 无障碍清单、订单状态机、跨页数据流转、风险与降级 |
| [`docs/03-api-contract.md`](docs/03-api-contract.md) | 接口契约（唯一权威）：路径、字段、枚举、WS 事件、错误码、数据模型 |
| [`docs/04-architecture.md`](docs/04-architecture.md) | 整体架构：页面↔接口↔字段对照表、数据交互方式、关键决策记录 |

---

## 核心设计约定

这三条是本项目的铁律，改动前请先读 `docs/02-ux-spec.md` 的对应章节：

1. **订单状态 → 按钮映射由服务端下发**
   订单列表与详情都返回 `status`、`statusText` 和 6 个操作位布尔位
   （`canUserPay` / `canUserCancel` / `canUserConfirm` / `canUserRefund` / `canUserContact` / `canUserReview`）。
   前端**只渲染，不写 `status === 'xxx'` 判断**——这从根上消除了前后端状态漂移。

2. **金额只有整数分，字段名以 `Amount` 结尾**
   `priceAmount` / `totalAmount` / `unitPriceAmount`。订单总价由服务端算，前端传的价格一律忽略。
   同时只给元（`totalPrice`）和分（`totalAmount`）会造成显示价与实付价不一致的资损风险。

3. **契约单一化**
   路径只有 `/api/v1`；字段全链路 camelCase；订单状态 camelCase 10 态；
   服务项读写同名 `serviceId`；时段用稳定唯一标识 `slotId`。
   没有兼容层——首次交付不存在需要兼容的历史，双写会在第一次联调就变成两个 bug。

---

## 目录结构

```
dipi/
├── docs/            规格文档（设计与契约的唯一来源）
├── miniprogram/     微信小程序客户端
│   ├── app.js       全局状态：登录态、token、WS 实例、未读数
│   ├── config/      BASE_URL / API_PREFIX / USE_MOCK
│   ├── styles/      tokens.wxss（设计令牌）+ components.wxss（组件类）
│   ├── components/  12 个自研组件
│   ├── pages/       8 个页面
│   └── utils/       request / api / ws / storage / format / mock
├── server/          Node.js 服务端
│   ├── src/
│   │   ├── routes/  8 个路由模块
│   │   ├── services/ 业务逻辑（订单状态机 / 搜索 / 会话 / 推荐）
│   │   ├── models/  实体定义 + 状态映射
│   │   ├── db/      store.js（原子写）+ seed.js
│   │   ├── middleware/ auth / validate / error / requestId
│   │   └── ws/      WebSocket：鉴权 / 心跳 / 事件路由
│   └── test/        node:test 接口测试
└── scripts/         跨端校验脚本
```

---

## 离线与降级

服务端不可达时，`miniprogram/config/index.js` 的 `USE_MOCK` 开关会让客户端自动切换到
`utils/mock.js` 的本地数据。mock 与真实契约**逐字段同构**（含订单的 6 个操作位、
`availableSlots` 结构、整数分金额），因此页面不会白屏，演示与前端独立开发都不受阻。
