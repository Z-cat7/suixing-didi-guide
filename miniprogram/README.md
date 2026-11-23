# 随行（dipi）· 微信小程序客户端

> 线下地陪服务交易平台的小程序端。原生微信小程序（**零 npm 依赖 / 无构建步骤**），导入微信开发者工具即可运行。

---

## 一、快速开始

### 1. 导入项目

1. 打开 **微信开发者工具** → 导入项目
2. **目录**选择本目录：`dipi/miniprogram/`
3. **AppID** 选择「测试号」或使用占位 `touristicappid`
4. **基础库** 选择 **≥ 2.32.0**（依赖 ARIA 属性与 `wx.getWindowInfo`）

> 也可以直接导入 `dipi/` 目录 —— `project.config.json` 已把 `miniprogramRoot` 指向 `miniprogram/`。

### 2. 关闭合法域名校验（本地联调必做）

**详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**

不勾选的话，`http://127.0.0.1:3000` 的请求会被微信拦截。

### 3. 启动服务端（可选）

服务端在同级目录 `../server/`，另开终端：

```bash
cd ../server
npm install
npm run seed     # 首次需要：生成演示数据
npm start        # 默认 http://127.0.0.1:3000
```

### 4. 开启 mock 模式（**推荐先跑这个**）

服务端未就绪时，小程序**不会白屏**，会自动降级到内置 mock 数据。

修改 `miniprogram/config/index.js`：

```js
/** mock 开关：'auto' | true | false */
USE_MOCK: 'auto',   // auto = 优先连服务端，连不上自动降级 mock
```

| 取值 | 行为 |
|---|---|
| `'auto'`（默认） | 先请求真实服务端；**网络层失败（连不上/超时）自动降级到 mock** |
| `true` | **强制 mock**，完全不发网络请求（离线演示用） |
| `false` | 强制真实服务端，连不上就报错，不降级 |

服务端地址在同文件的 `BASE_URL` / `WS_URL`：

```js
const BASE_URL = 'http://127.0.0.1:3000';
const API_PREFIX = '/api/v1';
const WS_URL = 'ws://127.0.0.1:3000/ws';
```

> **mock 数据与真实契约完全同构**：信封 `{ code, message, data }`、分页 `{ list, page, pageSize, total, hasMore }`、金额整数分且字段名以 `Amount` 结尾、时间 ISO8601、订单状态小驼峰、6 个 `canUserXxx` 操作位齐全。

---

## 二、目录结构

```
dipi/miniprogram/
├── app.js                    # 入口：登录态 / 全局数据 / WS 管理 / 网络监听 / TabBar 角标
├── app.json                  # 页面注册 + 原生 tabBar（4 项）
├── app.wxss                  # 全局样式（@import tokens + components）
├── project.config.json       # 项目配置（libVersion 2.32.0）
├── sitemap.json
├── config/
│   └── index.js              # BASE_URL / API_PREFIX / WS_URL / USE_MOCK 等开关
├── styles/
│   ├── tokens.wxss           # 设计令牌（CSS 变量）—— Phase 1 产出，勿改
│   └── components.wxss       # 组件视觉类（dipi- 前缀）—— Phase 1 产出，勿改
├── components/               # 12 个自研组件（每个含 wxml/wxss/js/json）
│   ├── guide-card/           # 地陪卡片
│   ├── filter-bar/           # 排序 + 筛选 chip 条
│   ├── price-tag/            # 价格标签
│   ├── rating-stars/         # 评分星级（含半星裁切）
│   ├── order-status-badge/   # 订单状态徽章
│   ├── chat-bubble/          # 聊天气泡（text / system / order_card）
│   ├── message-item/         # 消息列表项（会话 / 通知）
│   ├── empty-state/          # 空态 / 错误态 / 离线态
│   ├── skeleton-card/        # 骨架屏
│   ├── load-more/            # 触底加载
│   ├── section-header/       # 模块标题
│   └── dipi-tabbar/          # 自定义 TabBar（4 项 + 未读红点）
├── pages/
│   ├── home/home.*           # 首页（7 个模块）
│   ├── search/search.*       # 搜索页（防抖 / 多条件筛选 / 排序 / 分页）
│   ├── chat/chat.*           # 聊天页（WS / 历史分页 / 重发 / 草稿）
│   ├── order/order.*         # 订单页（列表 ⇄ 详情双视图）
│   ├── message/message.*     # 消息页（会话 / 通知双 Tab）
│   ├── profile/profile.*     # 用户主页
│   ├── guide/detail.*        # 地陪详情页 P7
│   └── order/create.*        # 下单确认页 P8
├── utils/
│   ├── request.js            # 统一请求（超时 / 重试 / 401 重登 / requestId / mock 降级）
│   ├── api.js                # 接口函数（与契约一一对应）
│   ├── ws.js                 # WebSocket（心跳 / 退避重连 / seq 去重 / 未读同步）
│   ├── format.js             # 金额（分→元）/ 时间（相对）/ 截断 / 倒计时
│   ├── storage.js            # 本地存储（token / 草稿 / 导航包 / 搜索历史）
│   ├── mock.js               # mock 数据层（与真实契约同构）
│   └── constants.js          # 枚举常量（订单状态 / 服务类型 / 排序 / 路由 …）
└── README.md
```

---

## 三、页面与接口对照

| 页面 | 路由 | 核心功能 | 消费的接口 |
|---|---|---|---|
| 首页 | `/pages/home/home` | 7 模块：定位条 / 搜索框 / 服务类型金刚区 / 推荐地陪横滑 / 场景入口 / 进行中订单 / 保障说明 | `GET /api/v1/home` |
| 搜索页 | `/pages/search/search` | 关键词防抖 300ms + 目的地/服务类型/价格/评分/时间多条件组合 + 4 种排序 + 筛选抽屉 + 分页 | `GET /api/v1/guides`、`GET /api/v1/guides/filter-options` |
| 地陪详情 P7 | `/pages/guide/detail` | 照片轮播 / 身份卡 / 服务项单选 / 可约时段 / 评价展开 / 收藏 toggle / 吸底「立即预约」 | `GET /api/v1/guides/:guideId`、`PUT /api/v1/me/favorites/:guideId`、`POST /api/v1/conversations` |
| 下单确认 P8 | `/pages/order/create` | 时段按日期分组选择 + 服务项 + 人数步进 + 联系人 + 备注 + 实时算价预览 + 幂等提交 + 草稿回填 | `GET /api/v1/guides/:guideId`、`GET /api/v1/me`、`POST /api/v1/orders` |
| 聊天页 | `/pages/chat/chat` | 历史分页（向上前插 + 滚动补偿）/ 发送 / 失败重发 / 未读定位 / 离线草稿 / WS 状态提示 | `GET /api/v1/conversations/:id/messages`、`POST /api/v1/conversations/:id/messages`、`POST /api/v1/conversations/:id/read` |
| 订单页 | `/pages/order/order` | 状态分栏 + 列表/详情双视图 + 支付/取消/确认完成/退款/评价（**按钮全由服务端 `allowedActions[]` 驱动**） | `GET /api/v1/orders`、`/orders/:id`、`/orders/summary`、`POST /api/v1/orders/:id/{pay\|cancel\|confirm\|refund\|review}` |
| 消息页 | `/pages/message/message` | 会话/通知双 Tab + 未读角标 + 触底分页 + 按 `refType` 路由 | `GET /api/v1/conversations`、`GET /api/v1/notices`、`POST /api/v1/notices/read` |
| 用户主页 | `/pages/profile/profile` | 资料编辑 / 实名状态 / 订单统计跳转 / 收藏 / 设置开关 / 退出登录 | `GET/PUT /api/v1/me`、`GET/PUT /api/v1/me/settings` |

---

## 四、关键设计说明

### 1. 订单状态铁律

订单的**状态、操作、样式一律由服务端下发**，前端只渲染，不自算：

```js
// ① 语义身份（唯一权威）
status          // pendingPayment / pendingAccept / accepted / inService / pendingConfirm / …
// ② 中文文案（徽章必须与色块同时渲染，不能只靠颜色区分状态）
statusText      // 待支付 / 待接单 / …
// ③ 样式决策（CSS 类名后缀）
statusBadge     // pending / ongoing / review / done / closed / refunding
// ④ 功能色语义（色弱 / 单色模式的第二重信息）
statusTone      // warning / info / brand / accent / success / ink / error
// ⑤ 按钮显隐的唯一依据（与 6 个 canUserXxx 同源生成）
allowedActions  // ['pay', 'cancel', 'confirm', 'refund', 'contact', 'review']
```

前端**不做任何「状态 → 按钮 / 状态 → 徽章样式」的映射**：

- **徽章**：`components/order-status-badge/` 只接收 `statusBadge` + `statusText`，
  拼 `class="dipi-badge dipi-badge--{{badgeClass}}"`；白名单兜底（未知值 → `closed`）
- **按钮**：`utils/constants.js` 的 `hasOrderAction(order, action)` **优先读 `allowedActions[]`**，
  只有它缺失时才退化到 6 个 `canUserXxx` 布尔位
- **防漂移**：`scripts/check-miniprogram.js` 动态扫 `components.wxss` 的 `.dipi-badge--*`，
  断言与客户端白名单**完全一致**（任一侧漂移都报错）

### 2. WebSocket 封装（`utils/ws.js`）

| 能力 | 实现 |
|---|---|
| 单例连接 | 全局一个实例，页面只订阅事件，不各自建连接 → 避免连接泄漏 |
| 心跳 | 25s 一次 ping；45s 未响应判定断开并触发重连 |
| 重连退避 | 1s → 2s → 4s → 8s → 15s → 30s（封顶 30s，每档 ±20% 抖动） |
| 降级轮询 | 60s 仍未连上 → 切 15s 轮询 `GET messages?since={lastSeq}` |
| 断线补拉 | 重连成功后按 `lastSeq` 补拉增量，按 `messageId` + `seq` 双重去重 |
| 未读同步 | `conversation.unreadChanged` → `app.globalData.unreadTotal` → `wx.setTabBarBadge({index:1})` |
| 向前兼容 | 未知 `type` 直接忽略；同时兼容 `{type,payload,ts}` 与 `{type,data,ts}` 两种信封 |

事件别名归一：`order.status → order.statusChanged`、`notice.new → notification.new`。

### 3. 请求层容错（`utils/request.js`）

- 超时默认 12s
- **幂等 GET 失败重试 1 次**
- 统一错误 Toast（成功 1500ms / 常规 2000ms / 错误 2500ms）
- **401 → 自动重新登录一次 → 重放原请求**
- `X-Request-Id` 请求头透传，响应 `requestId` 回读到错误对象
- 服务端不可用 → 自动降级到 mock（页面不白屏）

### 4. 幂等与草稿

| 场景 | 机制 |
|---|---|
| 下单 | `idempotencyKey` 进入页面生成一次，请求超时重试**复用同一 key**；服务端返回同一 `orderId` |
| 发消息 | `clientMessageId` 同上；重发**复用同一 clientMessageId**（`sending` 态禁止并发重发） |
| 下单草稿 | `storage.dipi:draft:order`，变更节流 500ms 落盘，`onUnload` 立即落盘；`guideId` 不一致 → 丢弃 |
| 聊天草稿 | `storage.dipi:draft:chat:{conversationId}`，输入 / 失焦 / `onHide` 三处落盘；恢复后**回填但不自动发送** |

### 5. ⚠️ 单位与结构（最容易踩坑的三处）

| 位置 | 规则 |
|---|---|
| **查询参数** `minPrice` / `maxPrice` | 单位是**元** —— 与 `filter-options.priceRanges[].min/max` 同口径。**提交时不要乘 100** |
| **响应体** `xxxAmount`（`priceAmount` / `unitPriceAmount` / `subtotalAmount` / `totalAmount` / `extraAmount` / `discountAmount` / `refundAmount`） | 单位是**分**（整数）—— 客户端按 `分 ÷ 100` 展示 |
| **地陪详情结构** | `GET /api/v1/guides/:guideId` 返回 **`data.guide` 包裹**（取服务项用 `data.guide.services`）；**列表接口 `data.list[]` 不包裹**，每项就是地陪对象本身 |

> `priceAmount` 只出现在**地陪层**（`guide.priceAmount` 起步价、`guide.services[].priceAmount` 服务项单价）；
> **订单对象里没有**裸 `priceAmount` —— 订单只有 `unitPriceAmount`（单价）/ `subtotalAmount`（小计）/ `totalAmount`（总额）。

### 6. 最终契约要点（与 `docs/03-api-contract.md` 一致）

| 项 | 契约 |
|---|---|
| 路径前缀 | **只有 `/api/v1`**（`config/index.js` 的 `API_PREFIX` 统一拼接，请求层不出现裸前缀） |
| 个人资料 | `GET /api/v1/me`、`PUT /api/v1/me`、`GET/PUT /api/v1/me/settings`、`GET /api/v1/me/orders`、`GET /api/v1/me/favorites` |
| 筛选项 | `GET /api/v1/guides/filter-options`（选项一律来自服务端，客户端不硬编码） |
| 服务项 | `guide.services[]`，元素主键 **`serviceId`**（读接口与写接口同名，前端不写第二套映射） |
| 时段 | `guide.availableSlots[]` = `{ slotId, date, timeSlot, available }`；**`slotId` 原样回传**，`date`/`timeSlot` 仅用于展示 |
| 下单提交体 | `guideId, serviceId, slotId, travelers, contactName, contactPhone, meetingPoint, remark?, conversationId?, idempotencyKey` |
| 收藏 | `PUT /api/v1/me/favorites/:guideId`（幂等 toggle），返回 `{ guideId, favorited, favoritesCount }`；**以返回的 `favorited` 更新图标态，不自行取反** |
| 通知 | `GET /api/v1/notices`、`POST /api/v1/notices/read` |
| 金额 | 一律**整数分**，字段名以 `Amount` 结尾；订单响应体里的 `scheduledAt` 是**服务端回显的服务时间**（仅展示），与提交用的 `slotId` 语义不同 |
| 订单操作位 | 6 个布尔位由服务端下发，前端只渲染；`statusText` 也由服务端下发 |

### 6. 价格与时段

- **P8 实时算价仅供预览**：`priceAmount × travelers + extraAmount − discountAmount`；
  提交后**以服务端返回的 `totalAmount` 为准**，不一致 → 弹层「价格已更新，请确认」（不静默改价）。
- **时段用 `slotId` 原子核销**：`availableSlots[].slotId` 是稳定唯一标识，P8 **原样回传**，不传 `date + timeSlot` 组合。
  `available: false` 的时段置灰不可选，点击不响应。
- **服务项 `serviceId` 读接口与写接口同名**，前端不写第二套映射。

---

## 五、静态检查与自测

```bash
# 静态检查（10 类规则：页面清单 / 组件声明 / 裸 HEX / 字号阶梯 / wx.request 绕过 / 事件绑定 / 标签闭合 / 无障碍 …）
node dipi/scripts/check-miniprogram.js

# 逻辑冒烟测试（80 个用例：mock 契约同构 / 格式化 / 存储 / 页面逻辑 / WS）
node dipi/scripts/smoke-miniprogram.js

# 契约核对（需服务端源码；同进程内起服务端，逐条比对最终契约，20 项）
node dipi/scripts/verify-contract.js
```

三个脚本都**不需要安装任何依赖**（纯 Node，无 npm 包）。

`verify-contract.js` 会在随机端口上拉起服务端，用客户端真实的 `utils/api.js` 发请求，
核对：路径前缀只有 `/api/v1`、`services[]` 只含 `serviceId`、`availableSlots[]` 结构、
订单 6 个操作位、`/me` 的 `orderStats` 分桶、筛选项来自 `filter-options`、
收藏 `PUT` toggle 返回 `favorited`、价格筛选单位一致。

> **兼容说明**：服务端不同版本在少数字段上有别名，客户端做了**双向兼容**（不写第二套映射）：
> | 字段 | 服务端可能下发 | 客户端取值 |
> |---|---|---|
> | 筛选项·目的地 | `cities` / `destinations` | 两者都取 |
> | 价格区间 | `min`/`max`（元）/ `minAmount`/`maxAmount`（分） | 都保留，查询用「元」 |
> | 订单统计·退款格 | `refunding` / `refunded` | `refunding` 优先，`refunded` 兜底 |
> | 详情信封 | `data` / `data.guide` | 两者都取 |
| 订单统计·退款格 | `refunded` / `refunding` | `refunded` 优先，`refunding` 兜底 |

---

## 六、已知限制与后续可补

| 项 | 说明 |
|---|---|
| 逆地理解析 | 首页定位当前用经纬度做「模拟城市判定」，生产需接入逆地理解析服务后替换 `pages/home/home.js` 的 `guessCity()` |
| 服务端报价接口 | P8 的价格是**客户端实时算价预览**（`unitPriceAmount × travelers + extra − discount`），提交后**以服务端返回的 `totalAmount` 为准**；不一致时弹层「价格已更新，请确认」，不静默改价 |
| 头像上传 | 当前直接把 `chooseMedia` 的临时路径写进资料；生产需先上传再 `PUT /api/v1/me` |
| 自定义 TabBar | `components/dipi-tabbar/` 已完整实现（含未读红点），但当前 `app.json` 用的是**原生 tabBar**（UX 规范 §A.1 要求用 `wx.setTabBarBadge` 同步角标）。如需切换：把 `app.json` 的 `tabBar.custom` 设为 `true`，并把该组件挂到 `custom-tab-bar/index` |
| 订阅消息授权 | `wx.requestSubscribeMessage` 的 `tmplIds` 目前传空数组（模板 ID 未定）；生产需填入实际模板 ID |
| 评价功能 | 本期按 UX 规范 §B.4.2 流程 5 为**占位**（弹层确认默认五星），未做评分 UI |
| 横屏 / 大屏 | 已按 E.1 断点写好 CSS（≤360px 用 px 固定字号、≥768px 居中、横向 sticky CTA），但**未做真机横屏验证** |
| 读屏走查 | 已按 E.3 补齐 `aria-label` / `aria-role` / `aria-hidden` / `aria-live`，但**未做 VoiceOver / TalkBack 实机走查** |
| 动效 | 按 E.2 实现骨架屏高光与面板过渡；未做视差、自动轮播（动效红线） |

---

## 七、视觉纪律（自检要点）

1. 每屏最多 **1 个主色实心按钮** + **1 个红色实心块**（红色只给价格 / 评分 / 已选中价格 chip）
2. 一屏字号档位 ≤ 3 档；字号只取 `tokens.wxss` 的 5 档阶梯
3. 页面底 `ink-100`、卡片白底，不用彩色卡片底
4. 所有可点击元素渲染盒子 ≥ 88rpx
5. ≤360px 小屏：正文/辅助文字改 px 固定值（15px / 13px），不用 rpx
6. 颜色一律 `var(--dipi-*)`，页面/组件 WXSS 中**禁止裸 HEX**（由静态检查脚本强制）

---

*规范来源：`docs/01-visual-design.md`（视觉）+ `docs/02-ux-spec.md`（体验）+ `docs/03-api-contract.md`（接口契约）*
