# 随行 dipi · 整体架构说明

> 面向读者：产品负责人 / 新加入的前后端工程师
> 配套文档：[`01-visual-design.md`](./01-visual-design.md)（视觉规范）、[`02-ux-spec.md`](./02-ux-spec.md)（体验规范）、[`03-api-contract.md`](./03-api-contract.md)（接口契约，唯一权威）

---

## 1. 一句话架构

```
微信小程序客户端  ──REST(/api/v1)──▶  Node.js 单进程服务  ──▶  JSON 文件存储
        │                                    │
        └────────WebSocket(/ws)──────────────┘
                     （聊天消息 / 订单状态 / 未读数 实时推送）
```

**关键设计取舍**：服务端是**单进程 + 单端口**（HTTP 与 WebSocket 同端口），存储用 JSON 文件而非数据库。这是为「开箱即跑、零外部依赖」刻意选的——`npm install && npm start` 就能跑通完整业务，评审与教学场景不需要先起 MongoDB。代价是并发写入能力弱，因此存储层做了**内存缓存 + 防抖落盘 + 原子写**（写临时文件再 rename），避免进程崩溃时写坏文件。

替换成 MySQL/PostgreSQL 时，只需重写 `server/src/db/store.js` 一个文件，上层 service/route 不动。

---

## 2. 目录结构

```
dipi/
├── docs/                       ← 规格文档（设计与契约的唯一来源）
│   ├── 01-visual-design.md     视觉规范：色板/字阶/间距/组件视觉
│   ├── 02-ux-spec.md           体验规范：6+2 页面流程/字段/状态机/无障碍
│   └── 03-api-contract.md      接口契约：路径/字段/枚举/WS 事件
├── miniprogram/                ← 微信小程序客户端
│   ├── app.js                  全局状态：登录态、token、WS 实例、未读数
│   ├── app.json                8 页路由 + 4 项 TabBar
│   ├── app.wxss                @import tokens + components
│   ├── config/index.js         BASE_URL / API_PREFIX / USE_MOCK 开关
│   ├── styles/                 tokens.wxss（设计令牌）+ components.wxss（组件类）
│   ├── components/             12 个自研组件（卡片/筛选条/气泡/徽章/骨架屏…）
│   ├── pages/                  8 个页面
│   │   ├── home/               首页：推荐地陪 + 搜索入口
│   │   ├── search/             搜索页：多条件筛选 + 排序 + 分页
│   │   ├── chat/               聊天页：实时消息 + 失败重发 + 离线草稿
│   │   ├── order/              订单页：状态分栏 + 详情子视图 + 操作
│   │   ├── message/            消息页：系统通知 + 会话汇总
│   │   ├── profile/            我的：资料 + 订单记录 + 设置
│   │   ├── guide/detail/       地陪详情（二级页）
│   │   └── order/create/       下单确认（二级页）
│   └── utils/                  request / api / ws / storage / format / mock
├── server/                     ← Node.js 服务端
│   ├── src/
│   │   ├── app.js              Express 装配、路由挂载、错误处理
│   │   ├── server.js           HTTP + WS 同端口启动
│   │   ├── db/                 store.js（原子写）+ seed.js（种子数据）
│   │   ├── middleware/         auth / validate / error / requestId / cors
│   │   ├── models/             实体定义 + 订单状态机映射
│   │   ├── routes/             8 个路由模块
│   │   ├── services/           业务逻辑（订单流转/搜索/会话/推荐）
│   │   └── ws/                 WebSocket：鉴权、心跳、事件路由
│   └── test/                   node:test 接口测试
└── scripts/                    跨端校验脚本（静态检查 + 客户端冒烟）
```

---

## 3. 页面 ↔ 接口 ↔ 数据字段 对照表

这是「各页面核心功能、数据字段、交互逻辑」的速查总表。完整字段定义见 `02-ux-spec.md` §B，接口参数见 `03-api-contract.md`。

### P1 首页 `/pages/home/home`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 推荐地陪（横向滑动卡片） | `GET /api/v1/home` | `recommendGuides[]`：`guideId` `name` `avatar` `rating` `ratingCount` `priceAmount` `serviceTypes[]` `tags[]` `destination` `completedOrderCount` |
| 热门目的地宫格 | 同上 | `hotDestinations[]`：`destination` `guideCount` `coverImage` |
| 服务类型分类 | 同上 | `serviceTypes[]`：`type` `name` `icon` `count` |
| 搜索入口 → P2 | `GET /api/v1/guides/filter-options` | `destinations[]` `serviceTypes[]` `priceRange{min,max}` `ratingOptions[]` |

### P2 搜索页 `/pages/search/search`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 关键词搜索（300ms 防抖） | `GET /api/v1/guides?keyword=` | 请求参数 `keyword` `destination` `serviceType` `minPrice` `maxPrice` `rating` `sort` `page` `pageSize` |
| 多条件组合筛选 | 同上 | `sort`：`recommend` / `priceAsc` / `priceDesc` / `rating` |
| 筛选抽屉（目的地/服务类型/价格区间/评分） | `GET /api/v1/guides/filter-options` | 筛选面板选项来自服务端 |
| 分页加载 | 同上 | 响应 `list[]` `total` `page` `pageSize` `hasMore` |
| 卡片 → P7 详情 | — | 传参 `guideId` |

### P3 聊天页 `/pages/chat/chat`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 消息历史分页 | `GET /api/v1/conversations/:conversationId/messages` | `messages[]`：`messageId` `seq` `fromUserId` `type` `content` `createdAt` `status` |
| 实时收发 | WS `message.send` ↔ `message.new` | 发送体带 `clientMessageId`（幂等去重）；接收体带 `seq`（单调递增） |
| 失败重发 | 同上 | 重发**复用同一 `clientMessageId`** |
| 离线草稿 | 本地 storage | `dipi:draft:chat:<conversationId>` |
| 未读定位 / 已读回执 | WS `message.read` | — |
| 从聊天下单 → P8 | `POST /api/v1/orders` | 提交体带 `conversationId` |

### P4 订单页 `/pages/order/order`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 状态分栏（全部/待支付/进行中/已完成） | `GET /api/v1/orders?status=` | `status` 支持逗号分隔多值 |
| 订单详情（页内子视图 `viewMode:'detail'`） | `GET /api/v1/orders/:orderId` | `orderId` `status` `statusText` `guideName` `serviceName` `slotId` `scheduledAt` `travelers` `meetingPoint` `totalAmount` `contactName` `contactPhone` `remark` `createdAt` |
| 状态→按钮（**服务端下发，前端只渲染**） | 同上 | `canUserPay` `canUserCancel` `canUserConfirm` `canUserRefund` `canUserContact` `canUserReview` |
| 支付/取消/确认/退款/评价 | `POST /api/v1/orders/:orderId/{pay,cancel,confirm,refund,review}` | 非法迁移返回 409 |
| 状态实时更新 | WS `order.statusChanged` | 推送体含新的 `status` + `statusText` + 全部布尔位 |

### P5 消息页 `/pages/message/message`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 会话 + 通知统一列表 | `GET /api/v1/messages` | `type`：`conversation` / `notice`；会话项含 `conversationId` `guideId` `guideName` `avatar` `lastMessage` `lastMessageAt` `unreadCount` |
| 系统通知 | `GET /api/v1/notices` | `notices[]`：`noticeId` `title` `content` `type` `createdAt` `read` |
| 标记已读 | `POST /api/v1/notices/read` | — |
| 未读数实时同步 | WS `conversation.unreadChanged` | `conversationId` `unreadCount` |

### P6 我的 `/pages/profile/profile`
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 个人信息 | `GET /api/v1/me` | `userId` `nickname` `avatar` `phone` `bio` `favoriteCount` `realNameStatus` |
| 订单统计（**服务端聚合**） | 同上 | `orderStats`：`pendingPayment` `ongoing` `pendingConfirm` `refunding` |
| 我的订单 | `GET /api/v1/me/orders` | 按状态分页 |
| 我的收藏 | `GET /api/v1/me/favorites` | `list[]`：`guideId` `name` `avatar` `priceAmount` |
| 收藏切换 | `PUT /api/v1/me/favorites/:guideId` | 响应 `{ guideId, favorited, favoritesCount }`（toggle 后状态） |
| 设置项 | `GET/PUT /api/v1/me/settings` | `notifyEnabled` `notifyOrder` `notifyMessage` `notifyRefund` `privacyLocation` `showProfilePublic` |

### P7 地陪详情 `/pages/guide/detail`（二级页）
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 地陪完整资料 | `GET /api/v1/guides/:guideId` | `guideId` `name` `avatar` `bio` `rating` `ratingCount` `completedOrderCount` `tags[]` `favoritesCount` `destination` |
| 服务项选择 | 同上 | `services[]`：`serviceId` `name` `type` `priceAmount` `durationHours` `desc` |
| 可约时段 | 同上 | `availableSlots[]`：`slotId` `date` `timeSlot` `available`（覆盖未来 14 天） |
| 评价列表 | `GET /api/v1/guides/:guideId/reviews` | `reviews[]`：`reviewId` `rating` `content` `userName` `createdAt` |
| 咨询地陪 | `POST /api/v1/conversations` | `{ guideId }`，幂等 |

### P8 下单确认 `/pages/order/create`（二级页）
| 核心功能 | 主要接口 | 关键数据字段 |
|---|---|---|
| 联系人预填 | `GET /api/v1/me` | `contactName` `contactPhone` |
| 提交订单 | `POST /api/v1/orders` | body：`guideId` `serviceId` `slotId` `travelers` `contactName` `contactPhone` `meetingPoint` `remark?` `conversationId?` `idempotencyKey` |
| 金额显示 | 提交响应 | `totalAmount`（服务端算，前端不参与计算） |
| 时段被抢占 | 409 | message「该时段已被预约，请选择其他时段」 |
| 草稿恢复 | 本地 storage | `dipi:draft:order`（`guideId` 不一致则丢弃） |

---

## 4. 客户端 ↔ 服务端数据交互方式

### 4.1 三条通道

| 通道 | 用途 | 协议 | 触发时机 |
|---|---|---|---|
| **REST** | 所有读写业务数据 | HTTP + JSON，`/api/v1` 前缀 | 页面 `onLoad`/`onShow`、用户操作 |
| **WebSocket** | 实时推送（消息/订单状态/未读数） | WS，`/ws?token=` | 进入小程序建连，页面级按需订阅 |
| **本地存储** | 登录态、token、搜索历史、订单草稿、导航包 | `wx.setStorageSync` | 关键状态变更时 |

### 4.2 统一响应信封

所有 REST 响应结构一致：

```jsonc
{
  "code": 0,                  // 0 成功；4xxxx 客户端错；5xxxx 服务端错
  "message": "ok",            // 中文提示，失败时可直接 Toast
  "data": { },                // 业务数据
  "requestId": "req_xxx"      // 链路追踪，排查用
}
```

分页统一为 `{ list, total, page, pageSize, hasMore }`。

### 4.3 命名与单位约定（**不可妥协**）

| 项 | 约定 | 反例（禁止） |
|---|---|---|
| 路径前缀 | 只有 `/api/v1` | `/api/home`、双挂载 |
| 字段命名 | 全链路 camelCase | `unread_count`、`guide_id` |
| 订单状态 | camelCase 枚举 10 态 | 同时给 `statusCode: 'pending_payment'` |
| 金额 | **整数分**，字段名以 `Amount` 结尾 | 同时给 `totalPrice: 128.00`（元） |
| 时间 | ISO8601 字符串 | Unix 秒/毫秒时间戳 |
| 服务项 | `serviceId`（读写同名） | `serviceItemId` |
| 时段 | `slotId`（稳定唯一标识） | `date` + `timeSlot` 组合 |
| 分页参数 | `page` 从 1 起 | `page` 从 0 起 |

> **为什么严格**：状态名双写会让前端忍不住写 `status === 'xxx'` 判断，状态漂移立刻回来；金额双单位是真实的资损风险（显示价 ≠ 实付价）。本项目只有一套契约。

### 4.4 请求生命周期

```
页面发起请求
  → utils/request.js
      ├─ 拼接 BASE_URL + API_PREFIX + path
      ├─ 注入 Authorization: Bearer <token>
      ├─ 注入 requestId（便于全链路排查）
      ├─ 超时控制（默认 15s）
      ├─ 幂等 GET 失败自动重试 1 次
      ├─ 收到 401 → 自动重新登录一次 → 重放原请求（仅重放一次，避免循环）
      └─ 收到 4xxx/5xxx → 统一 Toast + 抛出带 code 的错误
  → 成功：setData 渲染
  → 失败：按各页 §状态态 渲染错误块 / 空态（不白屏）
```

**降级**：`config/index.js` 的 `USE_MOCK` 开关打开、或服务端不可达时，自动切换到 `utils/mock.js` 的本地数据，mock 结构与真实契约**逐字段同构**，保证演示与断网场景下页面仍完整可用。

### 4.5 WebSocket 事件契约

```
连接：ws://<host>/ws?token=<token>
消息体：{ type, payload, ts }
```

| 方向 | type | 说明 |
|---|---|---|
| 服务端 → 客户端 | `connected` | 连接建立，带 `userId` |
| 服务端 → 客户端 | `message.new` | 新消息，payload 含 `seq`（每会话单调递增）、`clientMessageId` |
| 服务端 → 客户端 | `message.read` | 消息已读回执 |
| 服务端 → 客户端 | `conversation.unreadChanged` | 未读数变化，payload 含 `conversationId`、`unreadCount` |
| 服务端 → 客户端 | `order.statusChanged` | 订单状态变化，payload 含 `orderId`、新 `status`、`statusText` 及全部操作位布尔位 |
| 服务端 → 客户端 | `conversation.updated` | 会话信息更新 |
| 服务端 → 客户端 | `notification.new` | 新系统通知 |
| 服务端 → 客户端 | `pong` | 心跳应答 |
| 客户端 → 服务端 | `message.send` | 发送消息，payload 含 `conversationId`、`content`、`type`、`clientMessageId` |
| 客户端 → 服务端 | `ping` | 心跳 |

**客户端可靠性设计**（`utils/ws.js`）：
- **断线重连**：指数退避 1/2/4/8/15/30 秒，封顶 30 秒
- **seq 去重**：按 `seq` 排序并丢弃重复消息（不同会话的相同 seq 互不影响）
- **发送幂等**：`clientMessageId` 由客户端生成，失败重发复用同一 ID，服务端据此去重
- **事件别名归一**：兼容 `order.status` / `order.statusChanged` 两种写法（防御性设计，服务端下发规范名）
- **连接生命周期**：进入聊天页连接、离开断开，避免多连接泄漏

### 4.6 刷新策略

| 页面 | 策略 |
|---|---|
| 首页 | `onShow` 拉取（保持推荐新鲜），下拉刷新 |
| 搜索页 | 条件变化即拉取，滚动触底分页；进页恢复上次筛选条件 |
| 聊天页 | 进入拉历史（倒序分页）+ WS 增量推送；离开断开 WS |
| 订单页 | `onShow` 拉取（回到页面状态要准）+ WS `order.statusChanged` 局部更新 |
| 消息页 | `onShow` 拉取 + WS 增量 |
| 我的 | `onShow` 拉取（资料 5 分钟 TTL 缓存） |
| P7 详情 | `onLoad` 拉取；收藏 toggle 后乐观更新，失败回滚 |
| P8 下单 | `onShow` **只重拉 `availableSlots`，绝不重置已填表单** |

### 4.7 页面间传参

统一用 URL query（`utils/constants.js` 的 `ROUTES` 集中定义）：

| 键 | 来源 → 目标 |
|---|---|
| `guideId` | 首页/搜索卡片 → P7；P7 → P8 |
| `serviceId` | P7 → P8 |
| `conversationId` | 消息页/订单 → P3 |
| `orderId` | 消息页/首页 → P4（进详情子视图） |
| `from` | P4 → P3（来源标记，用于返回行为） |

跨页的一次性动作（如「下单成功后跳订单页」）用 storage 传递：`dipi:nav:order`，消费后立即清除。

---

## 5. 关键设计决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | **订单状态→按钮映射由服务端下发**（6 个布尔位 + `statusText`），前端只渲染 | 从根上消除前后端状态漂移。前端不写 `status === 'xxx'` 判断。 |
| 2 | **金额只用整数分**，服务端算总价 | 避免显示价与实付价不一致的资损风险；前端不参与计价。 |
| 3 | **`slotId` 原子核销**（选时段→提交一次完成） | 避免用户选到已被抢走的时段；被抢占返回 409 且文案可直接展示。 |
| 4 | **下单幂等键 `idempotencyKey`** | 网络重试不产生重复订单。 |
| 5 | **地陪详情与下单确认升为独立页**（共 8 页） | 下单表单 + 吸底 CTA 无法在半屏承载；详情是长滚动富内容。 |
| 6 | **订单详情留在订单页内子视图** | 符合「订单页展示状态、详情及操作」的需求，减少跳转层级。 |
| 7 | **契约单一化**（无兼容层） | 首次交付没有历史包袱；双写会在首次联调就变成两个 bug。 |
| 8 | **JSON 文件存储 + 原子写** | 零外部依赖，`npm install` 即可跑通完整业务；换数据库只动 `db/store.js`。 |
| 9 | **mock 层与真实契约同构** | 服务端不可达时页面仍完整可用，便于演示与前端独立开发。 |
| 10 | **≤360px 小屏用 px 固定值** | rpx 自动缩放会让正文降到 12.8px，低于可读下限。 |

---

## 6. 本地运行

```bash
# 1. 服务端
cd dipi/server
npm install
npm run seed     # 生成种子数据（12+ 地陪 / 20+ 评价 / 覆盖全部 10 态的订单 / 会话 / 通知）
npm start        # http://127.0.0.1:3000

# 2. 客户端
# 用微信开发者工具「导入项目」，目录选 dipi/miniprogram
# 本地调试需在「详情 → 本地设置」勾选「不校验合法域名、IP 或 TLS」
# 或把 miniprogram/config/index.js 的 BASE_URL 指向你的服务器

# 3. 验证
cd dipi
node scripts/check-miniprogram.js   # 客户端静态检查（页面完整性/裸 HEX/组件声明）
node scripts/smoke-miniprogram.js   # 客户端逻辑冒烟（60 用例）
cd server && npm test                # 服务端接口测试
```

---

## 7. 后续演进建议

1. **存储层替换**：`db/store.js` 换成 MySQL/PG 适配器，service 层无需改动
2. **鉴权升级**：当前 `POST /api/v1/auth/login` 接受 `code`（开发态为 mock），接入微信 `wx.login` + `code2Session` 即可换成真实 openid 体系
3. **支付**：当前 `POST /api/v1/orders/:orderId/pay` 是模拟支付，接微信支付需服务端统一下单并处理回调
4. **推送**：`notification.new` 目前走 WS，可接入微信订阅消息做离线触达
5. **多端**：服务端契约与传输层解耦（纯 REST + WS），可直接复用于 H5 / App / 小程序多端
