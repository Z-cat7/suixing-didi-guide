# 随行（dipi）· 小程序端 API 契约

> 文档版本：v2.0（最终版 · 契约收敛后重写）· Phase 3 服务端 · 负责人：睿克斯
> 对应实现：`dipi/server/`（Node.js 22 + Express 4 + ws + JSON 文件持久化）
> 关联文档：`docs/01-visual-design.md`（视觉层）、`docs/02-ux-spec.md`（体验规范 v1.2）
> 基准地址：开发态 `http://127.0.0.1:3000`

> **本文件为客户端与服务端的唯一接口契约；与 `02-ux-spec.md` 冲突时以本文件为准。**

---

## 0. TL;DR（先读这 18 行）

1. **响应信封**统一为 `{ code, message, data, requestId }`。`code === 0` 才是成功，其余走错误分支。
2. **路径前缀只有 `/api/v1`**。不存在 `/api/xxx` 裸路径，也不存在第二套别名。
3. **字段全链路 camelCase**，只有一种写法：`guideId` `serviceId` `orderId` `conversationId` `slotId` `unreadCount` `createdAt`…… 没有 snake_case 版本。
4. **金额一律整数分**，字段名以 `Amount` 结尾：`priceAmount` `unitPriceAmount` `subtotalAmount` `discountAmount` `totalAmount` `refundAmount` `extraAmount`。客户端按 `分 ÷ 100` 格式化。
5. **时间一律 ISO8601 带时区**：`2026-11-23T14:30:00+08:00`。
6. **枚举值小驼峰**：订单状态 `pendingPayment` / `pendingAccept` / `accepted` / `inService` / `pendingConfirm` / `completed` / `cancelled` / `closed` / `refunding` / `refunded`；服务类型 `foodTour` / `cityWalk` / `sightseeing` / `photo` / `parentChild` / `errand`。
7. **订单状态→操作映射由服务端下发**。每个订单对象都含 `status` `statusText` `canUserPay` `canUserCancel` `canUserConfirm` `canUserRefund` `canUserContact` `canUserReview`。**前端只渲染，不自算状态、不做兼容判断。**
8. **订单总价由服务端算**。前端传的 `priceAmount` / `totalAmount` / `unitPriceAmount` 一律被忽略，提交后以服务端返回为准。
9. **下单只传 `slotId`**。服务端据此原子核销时段；被抢占返回 **409**（可识别的错误码，不是 500）。
10. **`idempotencyKey` 幂等**：同一次下单重试保持同一个键，重复提交返回**同一订单**。
11. **分页字段统一**：`{ list, page, pageSize, total, hasMore }`。
12. **鉴权**：请求头 `Authorization: Bearer <token>`。开发态 `POST /api/v1/auth/login` 传 `{ code: "mock-user-001" }` 直接拿 token。
13. **收藏只有一个入口**：`PUT /api/v1/me/favorites/:guideId`（toggle），返回 `{ guideId, favorited, favoritesCount }`。
14. **消息走 WebSocket**：`ws://<host>/ws?token=<token>`，信封 `{ type, payload, ts }`。
15. **消息带 `seq`**（会话内单调递增），客户端按 seq 排序与去重；发送带 `clientMessageId` 用于幂等去重与失败重发。
16. **越权返回 403**：订单 `40302`、会话 `40301`，客户端据此渲染「无权查看」错误态。
17. **WebSocket 路径仍是 `/ws`**（不带 `/api/v1`）。
18. **地陪详情与下单确认页共用 `GET /api/v1/guides/:guideId`**，`availableSlots` 内嵌，**不需要**单独的 `/available-slots` 端点。

---

## 1. 统一响应信封

### 1.1 结构

```jsonc
{
  "code": 0,              // 业务码：0 成功 / 4xxxx 客户端错 / 5xxxx 服务端错
  "message": "ok",        // 中文提示，可直接 Toast（失败时）
  "data": { },            // 业务数据；失败时为 null 或错误细节对象
  "requestId": "req_mwst..." // 本次请求 ID，排查问题用
}
```

### 1.2 code 约定

| 区间 | 含义 | 客户端处理 |
|---|---|---|
| `0` | 成功 | 正常使用 `data` |
| `400xx` | 请求本身有问题（缺参 / 格式错） | Toast `message`，不重试 |
| `401xx` | 未登录 / token 失效 | 跳登录页（`storage.dipi:redirect`） |
| `403xx` | 越权 | 渲染「无权查看」整页错误态 |
| `404xx` | 资源不存在 | 渲染「内容不存在」空态 |
| `409xx` | 状态冲突 | **刷新该订单 / 重选时段**后提示 |
| `422xx` | 参数校验失败 | 定位到 `data.errors[].field` 高亮 |
| `5xxxx` | 服务端异常 | Toast「网络好像不太稳定，点击重试」+ 重试按钮 |

### 1.3 分页信封

```jsonc
{
  "list": [],        // 当前页数据
  "page": 1,         // 当前页码，从 1 开始
  "pageSize": 20,    // 每页条数（服务端上限 50）
  "total": 137,      // 总条数
  "hasMore": true    // 是否还有下一页
}
```

分页约定：所有列表接口 `page=1` 为第一页（最新数据在前）。消息历史接口 `page=1` 表示**最新一页**，返回结果已按时间正序，前端直接渲染。

---

## 2. 鉴权

### 2.1 方式

```http
Authorization: Bearer <token>
```

WebSocket 客户端无法自定义请求头，允许用 query 传：`ws://<host>/ws?token=<token>`。

### 2.2 Token 实现

自实现 HMAC-SHA256 签名，不依赖 `jsonwebtoken`：

```
token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, SECRET))

payload = {
  "sub": "us_000001",   // 用户 ID
  "uid": "us_000001",
  "role": "user",       // user | guide
  "gid": null,          // 地陪账号绑定的地陪 ID
  "iat": 1795411132,   // 签发时间（秒）
  "exp": 1796015932,   // 过期时间（秒，默认签发后 7 天）
  "jti": "c64da99e85..."// 随机串
}
```

- 密钥：`TOKEN_SECRET` 环境变量，默认随机生成（**重启后旧 token 失效，生产必须固定**）。
- 有效期：`TOKEN_TTL_SECONDS`，默认 `604800`（7 天）。
- 校验失败分三种码：`40100`（缺 token）/ `40101`（签名错）/ `40102`（过期）。

### 2.3 开发态登录

未配置微信 AppID 时，`POST /api/v1/auth/login` 接受 mock code：

| code | 身份 | 说明 |
|---|---|---|
| `mock-user-001` | 普通用户 | 预置用户，有订单 / 收藏 / 会话数据 |
| `mock-user-002` | 普通用户 | 用于验证越权防护（看不到 user-001 的订单） |
| `mock-user-00X` | 普通用户 | 首次调用时自动创建 |
| `mock-guide-001` | 地陪（林小满） | 第 N 个对应第 N 位地陪，用于演示地陪侧动作 |

---

## 3. 接口总表（最终清单）

> 鉴权列：`—` = 公开，`✔` = 必须带 token，`○` = 可选（带了就返回个性化字段，如 `isFavorite`）

| # | 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|---|
| 1 | GET | `/api/v1/health` | — | 健康检查 |
| 2 | POST | `/api/v1/auth/login` | — | 登录 / 换 token |
| 3 | GET | `/api/v1/auth/profile` | ✔ | 当前用户资料 |
| 4 | GET | `/api/v1/home` | ○ | 首页聚合 |
| 5 | GET | `/api/v1/guides` | ○ | 地陪列表（多条件筛选） |
| 6 | GET | `/api/v1/guides/filter-options` | ○ | 筛选面板初始化 |
| 7 | GET | `/api/v1/guides/:guideId` | ○ | 地陪详情（P7 / P8 共用） |
| 8 | GET | `/api/v1/guides/:guideId/reviews` | ○ | 评价分页 |
| 9 | GET | `/api/v1/conversations` | ✔ | 会话列表 |
| 10 | POST | `/api/v1/conversations` | ✔ | 创建/获取会话（幂等） |
| 11 | GET | `/api/v1/conversations/:conversationId` | ✔ | 会话详情 |
| 12 | GET | `/api/v1/conversations/:conversationId/messages` | ✔ | 消息历史（分页） |
| 13 | POST | `/api/v1/conversations/:conversationId/messages` | ✔ | 发送消息 |
| 14 | POST | `/api/v1/conversations/:conversationId/read` | ✔ | 会话置已读 |
| 15 | GET | `/api/v1/messages` | ✔ | 消息页聚合 |
| 16 | GET | `/api/v1/notices` | ✔ | 系统通知列表 |
| 17 | POST | `/api/v1/notices/read` | ✔ | 通知置已读 |
| 18 | GET | `/api/v1/orders` | ✔ | 订单列表 |
| 19 | GET | `/api/v1/orders/summary` | ✔ | 订单状态计数（Tab 角标） |
| 20 | GET | `/api/v1/orders/:orderId` | ✔ | 订单详情 |
| 21 | POST | `/api/v1/orders` | ✔ | 创建订单 |
| 22 | POST | `/api/v1/orders/:orderId/pay` | ✔ | 模拟支付 |
| 23 | POST | `/api/v1/orders/:orderId/cancel` | ✔ | 取消订单 |
| 24 | POST | `/api/v1/orders/:orderId/confirm` | ✔ | 确认完成 |
| 25 | POST | `/api/v1/orders/:orderId/refund` | ✔ | 申请退款 |
| 26 | POST | `/api/v1/orders/:orderId/review` | ✔ | 评价 |
| 27 | GET | `/api/v1/me` | ✔ | 个人资料（含 orderStats） |
| 28 | PUT | `/api/v1/me` | ✔ | 更新资料 |
| 29 | GET | `/api/v1/me/settings` | ✔ | 设置项 |
| 30 | PUT | `/api/v1/me/settings` | ✔ | 更新设置项 |
| 31 | GET | `/api/v1/me/orders` | ✔ | 我的订单 |
| 32 | GET | `/api/v1/me/favorites` | ✔ | 我的收藏 |
| 33 | PUT | `/api/v1/me/favorites/:guideId` | ✔ | 收藏 toggle（幂等） |

**合计 33 个 HTTP 接口 + 1 个 WebSocket 端点。**

### 3.1 地陪侧动作（演示完整状态流转用；生产由地陪端或后台调用）

| 方法 | 路径 | 成功后状态 |
|---|---|---|
| POST | `/api/v1/orders/:orderId/accept` | `pendingAccept → accepted` |
| POST | `/api/v1/orders/:orderId/start` | `accepted → inService` |
| POST | `/api/v1/orders/:orderId/finish` | `inService → pendingConfirm` |
| POST | `/api/v1/orders/:orderId/close` | `pendingAccept → closed` |
| POST | `/api/v1/orders/:orderId/refund/approve` | `refunding → refunded` |
| POST | `/api/v1/orders/:orderId/refund/reject` | `refunding → refundFromStatus` |

鉴权：token 必须是**该订单对应地陪**的账号（`role === 'guide'` 且 `guideId` 匹配），否则 `40302`。

### 3.2 已废弃（不要实现 / 不要调用）

| 已废弃 | 原因 |
|---|---|
| `GET /api/health` | 统一到 `/api/v1/health` |
| `POST /api/v1/favorites/:guideId` | 统一到 `PUT /api/v1/me/favorites/:guideId` |
| `DELETE /api/v1/favorites/:guideId` | 同上 |
| `GET /api/v1/cities` | 并入 `/api/v1/guides/filter-options` |
| `GET /api/v1/users/*` | 统一到 `/api/v1/me/*` |
| `GET /api/v1/notifications` | 统一到 `/api/v1/notices` |
| `GET /api/v1/guides/suggest` | 未列入最终清单；如需联想词客户端本地过滤 |
| `GET /api/v1/conversations/unread-count` | 未列入最终清单；未读数在 `/api/v1/messages` 与 `/api/v1/conversations` 的响应里 |

---

## 4. 接口明细

### 4.1 鉴权

#### POST `/api/v1/auth/login`

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是 | 微信 `wx.login` 的 code；开发态传 `mock-user-001` |

**响应 `data`**

```jsonc
{
  "token": "eyJzdWIiOiJ1c18wMDAwMDEi...",
  "expiresIn": 604800,
  "isNewUser": false,
  "user": {
    "userId": "us_000001", "nickname": "随行用户001",
    "avatarUrl": "https://picsum.photos/seed/dipi-u001/200/200",
    "gender": "female", "phone": "13800000001", "city": "成都",
    "bio": "出差顺便玩两天", "tags": ["美食控"], "role": "user",
    "createdAt": "2026-07-26T05:18:43.067Z"
  }
}
```

**错误**：`40100` code 无效且未配置微信 AppID · `42200` 缺少 `code`

---

#### GET `/api/v1/auth/profile`

**响应 `data`**：个人资料 + 订单统计（字段同 §4.9 `GET /api/v1/me`）。

**错误**：`40100` 未登录 · `40101` token 无效 · `40102` token 过期

---

### 4.2 首页

#### GET `/api/v1/home`

**Query**：`city`（可选，指定当前城市；缺省取地陪最多的城市）

**响应 `data`**

```jsonc
{
  "currentCity": "成都",
  "searchPlaceholder": "搜索目的地或服务",
  "banners": [
    { "bannerId": "bn_01", "title": "第一次来，也能被本地人带着走",
      "subtitle": "12 位在地地陪 · 4 座城市",
      "imageUrl": "https://picsum.photos/seed/dipi-banner-01/750/320",
      "linkType": "destination", "linkValue": "成都" }
  ],
  "hotDestinations": [
    { "code": "成都", "name": "成都", "guideCount": 3,
      "cover": "https://picsum.photos/seed/dipi-city-成都/480/300" }
  ],
  "cityOptions": [ { "code": "成都", "name": "成都", "guideCount": 3 } ],
  "serviceTypes": [
    { "code": "foodTour", "name": "美食陪逛", "iconName": "food",
      "desc": "本地人带你吃地道味", "guideCount": 6 }
  ],
  "scenes": [
    { "code": "foodTour", "name": "当地美食", "iconName": "food",
      "subtitle": "跟着本地人吃", "query": { "serviceType": "foodTour" } }
  ],
  "guarantees": [
    { "code": "verified", "title": "实名认证",
      "description": "地陪身份与资质双重核验", "iconName": "verified" }
  ],
  "recommendGuides": [ /* 地陪摘要，见 §4.3 */ ],
  "topRatedGuides": [ /* 地陪摘要 */ ],
  "activeOrderSummary": {          // 无进行中订单时为 null
    "orderId": "ord_000002", "orderNo": "SX000002002",
    "status": "pendingAccept", "statusText": "待接单",
    "guideName": "高远", "serviceName": "故宫深度讲解",
    "scheduledAt": "2026-11-30T09:00:00+08:00"
  },
  "guideTotal": 14, "cityTotal": 6, "unreadCount": 3
}
```

---

### 4.3 地陪列表

#### GET `/api/v1/guides`

**Query**（任意组合 AND 生效）

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `keyword` | string | 否 | — | 地陪名 / 标签 / 头衔 / 简介模糊匹配 |
| `destination` | string | 否 | — | 城市名 |
| `serviceType` | string | 否 | — | `foodTour`\|`cityWalk`\|`sightseeing`\|`photo`\|`parentChild`\|`errand` |
| `minPrice` | number | 否 | — | 起步价下限（**元**） |
| `maxPrice` | number | 否 | — | 起步价上限（**元**） |
| `rating` | number | 否 | — | 最低评分 0–5 |
| `availableWithin` | string | 否 | — | `none`\|`today`\|`weekend`\|`week` |
| `sort` | string | 否 | `recommend` | `recommend`\|`priceAsc`\|`priceDesc`\|`rating` |
| `page` | int | 否 | 1 | 页码 |
| `pageSize` | int | 否 | 10 | 每页条数，上限 50 |

**筛选语义**：按 `priceAmount`（起步价）判定，`minPrice ≤ priceAmount ≤ maxPrice` 才命中（入参单位是元，出参单位是分）。
**排序语义**：
- `recommend`：评分 60% + 订单量 20% + 评价数 10% + 认证 5% + 活跃 5%
- `priceAsc` / `priceDesc`：按起步价，同价按评分降序
- `rating`：按评分降序，同分按评价数降序

**响应 `data`**

```jsonc
{
  "list": [ /* 地陪摘要 */ ],
  "total": 14, "page": 1, "pageSize": 10, "hasMore": true
}
```

**错误**：`42200` 非法 `sort` / `serviceType`，或 `minPrice > maxPrice`

---

#### GET `/api/v1/guides/filter-options`

筛选面板初始化数据。

**响应 `data`**

```jsonc
{
  "destinations": [ { "code": "成都", "name": "成都", "guideCount": 3, "isHot": true } ],
  "serviceTypes": [ { "code": "foodTour", "name": "美食陪逛", "iconName": "food", "guideCount": 6 } ],
  "priceRange": { "minAmount": 8800, "maxAmount": 58800, "min": 88, "max": 588 },
  "priceRanges": [ { "minAmount": 5000, "maxAmount": 10000, "min": 50, "max": 100, "label": "¥50-100" } ],
  "ratings": [ { "value": 4.8, "label": "4.8 分以上" } ],
  "availableWindows": [ { "code": "today", "label": "今天就能约" } ]
}
```

> `priceRange` 同时给分（`*Amount`，用于比较）与元（`min`/`max`，用于展示）。

---

### 4.4 地陪详情（P7 地陪详情页 / P8 下单确认页共用）

#### GET `/api/v1/guides/:guideId`

**响应 `data`**

```jsonc
{
  "guide": {
    "guideId": "gd_000001",
    "name": "林小满",
    "avatarUrl": "https://picsum.photos/seed/dipi-gd1/200/200",
    "photoUrls": ["https://…/1.jpg", "https://…/2.jpg"],
    "gender": "female",
    "city": "成都",
    "district": "成都市青羊区",
    "title": "本地人美食向导 · 十年老饕",
    "introduction": "在成都活了三十年，晓得哪条巷子里的馆子没有被游客占领。",
    "rating": 4.9,
    "ratingCount": 128,
    "completedOrderCount": 356,
    "tags": ["川菜", "本地人", "好相处"],
    "serviceTypes": ["foodTour", "cityWalk"],
    "serviceTypeName": "美食陪逛",
    "languages": ["中文", "English"],
    "languagesText": "中文 / English",
    "highlights": ["只去本地人排队的老馆子", "能帮你砍价也不怕被坑"],
    "location": "成都市青羊区 · 太古里附近",
    "responseTimeMin": 10,
    "priceAmount": 8800,          // 起步价（分）
    "priceOriginAmount": null,
    "priceMaxAmount": 32800,
    "priceUnit": "hour",          // hour | session | day | person
    "priceUnitText": "小时",
    "isResting": false,
    "status": "active",
    "verified": true,
    "identityVerified": true,
    "isFavorite": false,
    "favoritesCount": 42,
    "distanceKm": null,

    "services": [
      {
        "serviceId": "si_000001",
        "name": "老巷子美食半日陪逛",
        "serviceType": "foodTour",
        "description": "三顿当地人排队的馆子，边吃边讲这道菜背后的讲究。",
        "priceAmount": 16800,
        "priceUnit": "hour",
        "priceUnitText": "小时",
        "durationHours": 3,
        "minTravelers": 1,
        "maxTravelers": 8,
        "includes": ["3 小时在地陪逛", "3 家店试吃", "点单建议"],
        "icon": "food",
        "isAvailable": true
      }
    ],

    "availableSlots": [
      { "slotId": "2026-11-24-am", "date": "2026-11-24",
        "timeSlot": "09:00-12:00", "available": true },
      { "slotId": "2026-11-24-pm", "date": "2026-11-24",
        "timeSlot": "13:00-17:00", "available": true },
      { "slotId": "2026-11-24-night", "date": "2026-11-24",
        "timeSlot": "18:00-21:00", "available": false }
    ],

    "reviews": [
      { "reviewId": "rv_000001", "orderId": "ord_seed_1", "guideId": "gd_000001",
        "userNickname": "随行用户001",
        "userAvatarUrl": "https://…", "rating": 5,
        "content": "小满带我们去了三家本地人排队的老馆子…",
        "tags": ["本地人", "讲解好"], "images": ["https://…"],
        "serviceName": "老巷子美食半日陪逛",
        "createdAt": "2026-09-24T05:00:00.000Z", "reply": null }
    ],

    "reviewSummary": {
      "average": 4.9, "total": 128,
      "distribution": [ { "score": 5, "count": 20 }, { "score": 4, "count": 8 } ],
      "tags": [ { "name": "本地人", "count": 12 } ]
    }
  }
}
```

> ⚠️ **`services[]` 不是 `serviceItems[]`**；服务项主键是 **`serviceId`**（与下单请求体同名）。
> ⚠️ **`availableSlots[]` 元素只有 4 个字段**：`slotId` / `date` / `timeSlot` / `available`。

---

#### GET `/api/v1/guides/:guideId/reviews`

**Query**：`page`（默认 1）· `pageSize`（默认 10）

**响应 `data`**：标准分页信封，`list[]` 元素结构同上 `reviews[]`。

**错误**：`40400` 地陪不存在

---

### 4.5 地陪摘要结构

列表页 / 首页 / 收藏列表共用：

```jsonc
{
  "guideId": "gd_000001",
  "name": "林小满",
  "avatarUrl": "https://…",
  "photoUrls": ["https://…"],
  "gender": "female",
  "city": "成都",
  "district": "成都市青羊区",
  "title": "本地人美食向导 · 十年老饕",
  "introduction": "…",
  "rating": 4.9,
  "ratingCount": 128,
  "completedOrderCount": 356,
  "tags": ["川菜", "本地人", "好相处"],
  "serviceTypes": ["foodTour", "cityWalk"],
  "serviceTypeName": "美食陪逛",
  "languages": ["中文", "English"],
  "languagesText": "中文 / English",
  "highlights": ["…"],
  "location": "…",
  "responseTimeMin": 10,
  "priceAmount": 8800,
  "priceOriginAmount": null,
  "priceMaxAmount": 32800,
  "priceUnit": "hour",
  "priceUnitText": "小时",
  "isResting": false,
  "status": "active",
  "verified": true,
  "identityVerified": true,
  "isFavorite": false,
  "favoritesCount": 42,
  "distanceKm": null
}
```

> **价格缺失处理**：`priceAmount` 为 0 时前端显示「价格面议」，不要显示 `¥0`。

---

### 4.6 会话与消息

#### GET `/api/v1/conversations`

**Query**：`page` · `pageSize`

**响应 `data`**

```jsonc
{
  "list": [
    {
      "conversationId": "cv_000001",
      "userId": "us_000001",
      "peerType": "guide",
      "guideId": "gd_000001",
      "guideName": "林小满",
      "guideAvatarUrl": "https://…",
      "guideTitle": "本地人美食向导 · 十年老饕",
      "guideCity": "成都",
      "lastMessageId": "ms_000006",
      "lastMessageContent": "可以的，周六上午九点太古里南门见～",
      "lastMessageType": "text",
      "lastMessageAt": "2026-11-23T03:00:00+08:00",
      "unreadCount": 2,
      "firstUnreadSeq": 5,
      "isActive": true,
      "closed": false,
      "closedReason": null,
      "linkedOrderId": null,
      "linkedOrderStatus": null,
      "createdAt": "2026-11-20T10:00:00+08:00"
    }
  ],
  "total": 5, "page": 1, "pageSize": 10, "hasMore": false,
  "unreadTotal": 3
}
```

---

#### POST `/api/v1/conversations`

**请求体**：`{ "guideId": "gd_000001" }`

**响应 `data`**：会话对象（同上 `list[]` 元素）+ `guide: { guideId, name, avatarUrl, title }`。

**幂等**：已存在未关闭的会话时返回**同一个** `conversationId`，不新建。

**错误**：`40400` 地陪不存在

---

#### GET `/api/v1/conversations/:conversationId`

**响应 `data`**：会话对象 + `guide: { guideId, name, avatarUrl, title, city, rating }`。

**错误**：`40301` 无权查看该会话 · `40400` 会话不存在

---

#### GET `/api/v1/conversations/:conversationId/messages`

**Query**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `page` | int | 否 | 1 | `1` = 最新一页 |
| `pageSize` | int | 否 | 20 | 每页条数 |
| `since` | int | 否 | — | 断线补拉：只返回 `seq > since` 的消息 |
| `aroundSeq` | int | 否 | — | 定位锚点：返回 `aroundSeq` 附近的消息 |

**响应 `data`**

```jsonc
{
  "list": [
    {
      "messageId": "ms_000001",
      "conversationId": "cv_000001",
      "seq": 1,                          // 会话内单调递增，断线补拉游标
      "clientMessageId": null,           // 客户端生成的幂等键（回传时原样带回）
      "senderType": "user",              // user | guide | system
      "messageType": "text",             // text | image | orderCard | system
      "content": "你好，我下周六在成都…",
      "imageUrl": null,
      "orderSummary": null,
      "sentAt": "2026-11-23T02:00:00+08:00",
      "isRead": true,
      "status": "sent"
    }
  ],
  "total": 6, "page": 1, "pageSize": 20, "hasMore": false,
  "lastSeq": 6
}
```

> 返回已按时间**正序**（旧 → 新），前端直接渲染。气泡左右由 `senderType === 'user'` 判断。

**错误**：`40301` 越权 · `40400` 会话不存在

---

#### POST `/api/v1/conversations/:conversationId/messages`

**请求体**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `content` | string | 是 | — | 消息内容，≤1000 字 |
| `messageType` | string | 否 | `text` | `text`\|`image`\|`orderCard`\|`system` |
| `clientMessageId` | string | 否 | — | 客户端幂等键 |

**响应 `data`**：落库后的消息对象（同上 `list[]` 元素）。

> 这是 WebSocket 的 **HTTP 兜底通道**。WebSocket 不可用时用这个接口发消息。

**错误**：`40301` 越权 · `42200` 内容为空

---

#### POST `/api/v1/conversations/:conversationId/read`

**请求体**：空对象 `{}`

**响应 `data`**：`{ "conversationId": "cv_000001", "unreadCount": 0 }`

---

### 4.7 消息页聚合

#### GET `/api/v1/messages`

**Query**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `type` | string | 否 | `all` | `all`\|`conversation`\|`notice` |
| `page` | int | 否 | 1 | |
| `pageSize` | int | 否 | 20 | |

**响应 `data`**

```jsonc
{
  "list": [
    {   // 会话行
      "type": "conversation", "peerType": "conversation",
      "id": "cv_000001", "conversationId": "cv_000001",
      "title": "林小满", "avatarUrl": "https://…",
      "subtitle": "本地人美食向导 · 十年老饕",
      "content": "可以的，周六上午九点太古里南门见～",
      "lastMessageContent": "可以的，周六上午九点太古里南门见～",
      "lastMessageType": "text",
      "time": "2026-11-23T03:00:00+08:00",
      "lastMessageAt": "2026-11-23T03:00:00+08:00",
      "unreadCount": 2,
      "refId": "cv_000001",
      "linkedOrderId": null, "linkedOrderStatus": null, "isActive": true
    },
    {   // 通知行
      "type": "notice", "peerType": "system",
      "id": "ntf_000002", "notificationId": "ntf_000002",
      "title": "订单已待接单",
      "avatarUrl": "",
      "subtitle": "订单通知",
      "category": "order",
      "content": "你预约的「故宫深度讲解」已支付，正在等待地陪接单。",
      "time": "2026-11-22T05:00:00+08:00",
      "createdAt": "2026-11-22T05:00:00+08:00",
      "unreadCount": 1, "isRead": false,
      "refId": "ord_000002", "refType": "order", "actionLabel": "查看订单"
    }
  ],
  "total": 15, "page": 1, "pageSize": 20, "hasMore": false,
  "unreadTotal": 5,
  "conversationUnread": 3,
  "notificationUnread": 2
}
```

> 统一列表用 `type` 区分 `conversation` / `notice`，按时间倒序。

---

### 4.8 系统通知

#### GET `/api/v1/notices`

**Query**：`unreadOnly`（boolean，默认 false）· `category`（`order`\|`refund`\|`system`\|`promotion`\|`all`）· `page` · `pageSize`

**响应 `data`**

```jsonc
{
  "list": [
    {
      "notificationId": "ntf_000002",
      "category": "order",
      "title": "订单已待接单",
      "content": "你预约的「故宫深度讲解」已支付，正在等待地陪接单。",
      "isRead": false,
      "refType": "order", "refId": "ord_000002",
      "actionLabel": "查看订单",
      "extra": { "orderId": "ord_000002", "status": "pendingAccept" },
      "createdAt": "2026-11-22T05:00:00+08:00"
    }
  ],
  "total": 6, "page": 1, "pageSize": 20, "hasMore": false,
  "unreadCount": 3
}
```

---

#### POST `/api/v1/notices/read`

**请求体**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `ids` | string[] | 否 | `[]` | 精确标记的通知 ID 列表 |
| `all` | boolean | 否 | false | `true` = 全部标记已读 |

**响应 `data`**：`{ "updated": 3 }`

---

### 4.9 订单

#### GET `/api/v1/orders`

**Query**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `status` | string | 否 | — | 逗号分隔多状态，如 `completed,refunded`；**只接受 camelCase** |
| `page` | int | 否 | 1 | |
| `pageSize` | int | 否 | 10 | |

**响应 `data`**：标准分页信封，`list[]` 为订单对象（见 §4.10）。

**错误**：`42200` 含非法状态值（message 列出全部合法状态）

---

#### GET `/api/v1/orders/summary`

**响应 `data`**

```jsonc
{
  "countByStatus": {
    "all": 12,
    "pendingPayment": 1, "pendingAccept": 1, "accepted": 1,
    "inService": 1, "pendingConfirm": 1, "completed": 2,
    "cancelled": 1, "closed": 1, "refunding": 1, "refunded": 1
  }
}
```

---

#### GET `/api/v1/orders/:orderId`

**响应 `data`**：订单对象。

**错误**：`40302` 无权查看该订单 · `40400` 订单不存在

---

#### POST `/api/v1/orders`

**请求体（最终版）**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `guideId` | string | 是 | 地陪 ID |
| `serviceId` | string | 是 | 服务项 ID（与详情页 `services[].serviceId` 同名） |
| `slotId` | string | 是 | 预约时段 ID（来自 `availableSlots[].slotId`） |
| `travelers` | int | 否（默认 1） | 人数，需在 `minTravelers`–`maxTravelers` 内 |
| `contactName` | string | 是 | 联系人 ≤20 字 |
| `contactPhone` | string | 是 | 手机号，6–20 位数字 |
| `meetingPoint` | string | 否 | 集合点 ≤50 字 |
| `remark` | string | 否 | 备注 ≤200 字 |
| `conversationId` | string | 否 | 来源会话（聊天页下单时带），用于回写会话关联订单 |
| `idempotencyKey` | string | 否 | 幂等键，重复提交返回同一订单 |

> **不传** `date` + `timeSlot` 组合、**不传** `serviceItemId`、**不传** `peopleCount`。
> **服务端算总价**，前端传的 `priceAmount` / `totalAmount` / `unitPriceAmount` 一律被忽略。

**响应 `data`**：订单对象（见 §4.10）。

**错误**

| 码 | 场景 |
|---|---|
| `40400` | 地陪或服务项不存在 |
| `42200` | 人数越界 / 缺必填参数 |
| `40900` | **时段已被抢占**（`data.reason === 'slot_taken'`），message 为「该时段已被预约，请选择其他时段」 |
| `40900` | slotId 不存在（`data.reason === 'slot_not_found'`），message 为「该时段暂不可约，请选择其他时段」 |

---

#### POST `/api/v1/orders/:orderId/pay` · `cancel` · `confirm` · `refund` · `review`

| 路径 | 请求体 | 成功后状态 |
|---|---|---|
| `/pay` | `{}` | `pendingPayment → pendingAccept` |
| `/cancel` | `{ reason?, reasonCode? }` | `pendingPayment → cancelled`；已支付状态 → `refunding` |
| `/confirm` | `{}` | `inService` / `pendingConfirm` → `completed` |
| `/refund` | `{ reason, reasonCode? }` | `→ refunding` |
| `/review` | `{ rating: 1–5, comment: ≤300 }` | 状态不变，写入评价 |

**统一响应 `data`**：更新后的订单对象；`/review` 额外带 `review`：

```jsonc
"review": {
  "reviewId": "rev_000029",
  "orderId": "ord_000012", "guideId": "gd_000001",
  "userNickname": "随行用户001", "rating": 5,
  "content": "非常好的一次体验", "createdAt": "2026-11-23T05:21:31.087Z"
}
```

**错误**

| 码 | 场景 |
|---|---|
| `40901` | 订单状态不允许该操作（`data.currentStatus` / `data.currentStatusText` / `data.allowedActions` 给出上下文） |
| `40900` | 该订单已评价，不可重复评价 |
| `40302` | 越权 |
| `40400` | 订单不存在 |
| `42200` | 参数不合法（如 `rating` 越界） |

---

### 4.10 订单对象结构

```jsonc
{
  "orderId": "ord_000012",
  "orderNo": "SX000012012",
  "userId": "us_000001",
  "guideId": "gd_000001", "guideName": "林小满",
  "guideAvatarUrl": "https://…", "guideTitle": "本地人美食向导 · 十年老饕",
  "guideCity": "成都",
  "serviceId": "si_000001",
  "serviceName": "老巷子美食半日陪逛",
  "serviceType": "foodTour", "serviceIcon": "food",
  "city": "成都",

  // —— 状态：服务端下发，前端只渲染不算 ——
  "status": "pendingAccept",
  "statusText": "待接单",
  "statusBadge": "confirmed",      // 对应 .dipi-badge--confirmed
  "statusTone": "info",            // 对应 tokens.wxss 功能色
  "canUserPay": false,
  "canUserCancel": true,
  "canUserConfirm": false,
  "canUserRefund": true,
  "canUserContact": true,
  "canUserReview": false,
  "allowedActions": ["cancel", "refund", "contact"],   // 用户可执行动作，与 6 个 canUserXxx 同源

  // —— 时间 ——
  "date": "2026-12-08",
  "timeSlot": "09:00-12:00",
  "slotId": "2026-12-08-am",                    // ← 下单提交用的是这个（可原子核销）
  "scheduledAt": "2026-12-08T09:00:00+08:00",   // ← 展示用（服务端回显服务时间）
  "endAt": "2026-12-08T12:00:00+08:00",
  "durationHours": 3,
  "expireAt": "2026-11-23T05:36:28+08:00",   // 待支付截止（创建 +15 分钟）
  "serverTime": "2026-11-23T05:21:31+08:00", // 倒计时校准基准
  "createdAt": "2026-11-23T05:21:28+08:00",
  "updatedAt": "2026-11-23T05:21:30+08:00",
  "paidAt": "2026-11-23T05:21:28+08:00",
  "acceptedAt": null, "startedAt": null, "endedAt": null,
  "completedAt": null, "confirmedAt": null, "cancelledAt": null,
  "refundAppliedAt": null, "refundedAt": null,

  // —— 人数与地点 ——
  "travelers": 2,
  "meetingPoint": "宽窄巷子东广场",
  "meetingPointNote": "",

  // —— 金额：全部整数分 ——
  "unitPriceAmount": 16800,
  "subtotalAmount": 100800,
  "discountAmount": 10080,
  "discountReason": "新客首单 9 折",
  "totalAmount": 90720,
  "extraAmount": 0,
  "refundAmount": 0,
  "currency": "CNY",
  "priceUnit": "hour",
  "priceUnitText": "小时",

  // —— 备注与原因 ——
  "remark": "不吃太辣",
  "cancelReason": null, "refundReason": null, "refundReasonCode": null,
  "refundStatus": "none",        // none | processing | rejected | success
  "refundFromStatus": null,      // 退款驳回后恢复到的原状态
  "disputeStatus": "none",

  // —— 关联与幂等 ——
  "conversationId": null,
  "idempotencyKey": null,

  // —— 评价与时间轴 ——
  "rating": null, "comment": "", "reviewed": false,
  "timeline": [
    { "status": "pendingPayment", "statusText": "待支付",
      "at": "2026-11-23T05:21:28+08:00", "note": "", "operator": "user" }
  ]
}
```

---

### 4.11 「我」

#### GET `/api/v1/me`

**响应 `data`**

```jsonc
{
  "userId": "us_000001",
  "nickname": "随行用户001",
  "avatarUrl": "https://…",
  "gender": "female",
  "phone": "13800000001",
  "phoneMasked": "138****0001",      // 展示用
  "city": "成都", "bio": "出差顺便玩两天", "tags": ["美食控"],
  "role": "user", "guideId": null,
  "realNameVerified": false, "realNameStatus": "none",
  "memberLevel": "normal",
  "favoritesCount": 3,
  "favoriteGuideIds": ["gd_000001", "gd_000008", "gd_000004"],
  "orderCount": 12,
  "orderCounts": { "all": 12, "pendingPayment": 1, "completed": 2, "…": 0 },
  "orderStats": {
    "pendingPayment": 1,   // 待支付  ← pendingPayment
    "ongoing": 2,          // 服务中  ← accepted + inService
    "pendingConfirm": 1,   // 待确认  ← pendingConfirm
    "refunding": 2         // 已退款  ← refunding + refunded
  },
  "settings": { /* 见 §4.13 */ },
  "createdAt": "2026-07-26T05:18:43+08:00"
}
```

> ⚠️ **`orderStats` 的四个值是服务端聚合出的「展示分桶」，不是订单状态枚举。**
>
> **四格互斥：每笔订单有且仅落入一格，四格之和 ≤ `orderCounts.all`。**
>
> | 键 | 聚合来源 | 展示标签 |
> |---|---|---|
> | `pendingPayment` | `pendingPayment` | 待支付 |
> | `ongoing` | `accepted` + `inService` | **服务中** |
> | `pendingConfirm` | `pendingConfirm` | 待确认 |
> | `refunding` | `refunding` + `refunded` | 已退款 |
>
> 不纳入四格：`pendingAccept` / `cancelled` / `closed` / `completed`（不是需要用户处理的待办）。
> 四格统计由服务端算好，前端只渲染，不自算状态。

---

#### PUT `/api/v1/me`

**请求体**（全部可选，只传要改的）

| 字段 | 类型 | 约束 |
|---|---|---|
| `nickname` | string | ≤12 字 |
| `avatar` | string | ≤500 字 URL |
| `gender` | enum | `male`\|`female`\|`unknown` |
| `phone` | string | 6–20 位数字 |
| `city` | string | ≤30 字 |
| `bio` | string | ≤30 字 |
| `tags` | string[] | ≤8 项 |

**响应 `data`**：同 GET。

**错误**：`42200` 字段格式不合法

---

#### GET `/api/v1/me/orders`

**Query**：`status`（逗号分隔）· `page` · `pageSize`

**响应 `data`**：分页信封 + `countByStatus`。

---

#### GET `/api/v1/me/favorites`

**Query**：`page` · `pageSize`

**响应 `data`**：`list[]` 为地陪摘要 + `favoriteId` + `favTime`。

---

#### PUT `/api/v1/me/favorites/:guideId  收藏 toggle

**请求体**：无（可空对象）

**服务端行为**：**幂等切换**——同一用户同一地陪重复调用会正确翻转状态（`favorited: true ↔ false`），不是无脑 +1。并发安全（基于同一份收藏记录的存在性判断）。

**响应 `data`**

```jsonc
{ "guideId": "gd_000005", "favorited": true, "favoritesCount": 12 }
```

- `favorited`：切换后的**当前**状态
- `favoritesCount`：切换后的**最新**收藏总数（该地陪被所有人收藏的次数）

**错误**：`40400` 地陪不存在

---

### 4.12 设置项

#### GET `/api/v1/me/settings`

**响应 `data`**

```jsonc
{
  "userId": "us_000001",
  "notifyEnabled": true,     // 订单与服务通知总开关
  "notifyOrder": true,       // 订单状态通知
  "notifyMessage": true,     // 地陪消息通知
  "notifyRefund": true,      // 售后退款通知
  "notifyPromotion": false,  // 活动通知
  "notifySound": true,       // 提示音
  "privacyLocation": false,  // 允许共享位置
  "privacyShowProfile": true,
  "privacyShowOrder": false,
  "autoConfirmOrder": false,
  "updatedAt": "2026-11-18T05:00:00+08:00"
}
```

#### PUT `/api/v1/me/settings`

**请求体**：上表任意开关字段（boolean），只传要改的。
**响应 `data`**：同 GET（更新后的完整对象）。

---

## 5. WebSocket 协议

### 5.1 连接

```
ws://<host>/ws?token=<token>
```

- WS 路径**不带** `/api/v1`。
- `token` 缺失或无效 → 服务端发一条 `error` 后以关闭码 `4001` 关闭。

### 5.2 统一信封

```jsonc
{
  "type": "message.new",
  "payload": { },
  "ts": 1795411132123
}
```

> **只有这三个键**，没有 `data`。客户端**必须忽略未知 type**（向前兼容）。

### 5.3 客户端 → 服务端

| type | payload | 说明 |
|---|---|---|
| `message.send` | `{ conversationId, content, messageType?, clientMessageId }` | 发送消息。`clientMessageId` 是客户端生成的幂等键 |
| `conversation.read` | `{ conversationId }` | 会话置已读 |
| `ping` | `{ ts? }` | 心跳，回 `pong` |

### 5.4 服务端 → 客户端

| type | payload | 客户端动作 |
|---|---|---|
| `connected` | `{ serverTime, userId, role, clientId }` | 校正时钟、启动心跳、补拉 `since=lastSeq` |
| `message.new` | `{ conversationId, message }` | 插入消息；更新消息页行与会话排序 |
| `message.read` | `{ conversationId, seq }` | 标记对方已读 |
| `conversation.unreadChanged` | `{ conversationId, unreadCount, total }` | 更新角标 |
| `conversation.updated` | `{ conversation }` | 更新消息页会话行 |
| `order.statusChanged` | `{ orderId, status, statusText, order }` | 更新订单条目与角标 |
| `notification.new` | `{ notification }` | 消息页通知角标 +1 |
| `pong` | `{ ts, serverTime }` | 心跳响应 |
| `error` | `{ code, message }` | 本次上行失败（不影响连接） |

> **发送成功的确认**：服务端 `message.send` 成功后，会把该消息以 **`message.new`** 回推给发送者自己的连接，`message.clientMessageId` 与请求里的一致。客户端据此把本地 `sending` 气泡置为 `sent`（**没有独立的 ack 事件**）。

### 5.5 消息 seq 与断线补拉

- 每条消息带 `seq`：**会话内单调递增**的整数。客户端按 `seq` 排序与去重。
- 断线重连后用 `lastSeq` 游标补拉：

```
GET /api/v1/conversations/{conversationId}/messages?since={lastSeq}
```

返回 `seq > lastSeq` 的消息（按时间正序）。

### 5.6 断线重连策略（客户端责任）

1. **重连退避**：1s → 2s → 4s → 8s → 16s → 30s（上限），每次带 ±20% 随机抖动，最多重试 8 次后转「离线态」。
2. **重连成功后按序补拉**：
   - 收到 `connected` → 用 `payload.serverTime` 校正本地时钟（倒计时基准）
   - `GET /api/v1/messages` → 刷新消息页聚合与总角标
   - `GET /api/v1/conversations` → 刷新会话列表与各会话未读数
   - `GET /api/v1/conversations/{id}/messages?since={lastSeq}` → 补拉**当前打开会话**断线期间的消息
   - `GET /api/v1/orders/summary` → 刷新订单 Tab 角标
3. **消息不丢**：WebSocket 只是实时通道，**HTTP 接口才是权威数据源**。发送失败（未收到 `message.new` 回推）时把气泡置 `failed` 并提供重发入口；重发沿用原 `clientMessageId`。
4. **草稿本地保存**：离线时输入框内容存 `storage.dipi:draft:chat:{conversationId}`，重连后自动回填。

---

## 6. 错误码表

| code | HTTP | 含义 | 客户端建议动作 |
|---|---|---|---|
| `0` | 200 | 成功 | — |
| `40000` | 400 | 通用请求错误 | Toast `message` |
| `40001` | 400 | 缺少必填参数 | 高亮对应字段 |
| `40002` | 400 | 参数格式非法 | 高亮对应字段 |
| `40100` | 401 | 未登录 / 缺少 token | 跳登录页 |
| `40101` | 401 | token 无效或被篡改 | 清本地登录态，跳登录页 |
| `40102` | 401 | token 已过期 | 静默重新登录后重放请求 |
| `40200` | 402 | 支付失败 | Toast + 保留订单 |
| `40300` | 403 | 通用越权 | 「无权查看」错误态 |
| `40301` | 403 | 无权查看该会话 | 「无权查看该会话」错误态 |
| `40302` | 403 | 无权查看该订单 | 「无权查看该订单」错误态 |
| `40400` | 404 | 资源不存在 | 「内容不存在」空态 |
| `40401` | 404 | 接口不存在 | 检查 baseURL |
| `40900` | 409 | 通用状态冲突（时段被抢占 / 重复评价） | 时段冲突→重选时段并保留表单；重复评价→刷新订单 |
| `40901` | 409 | 订单状态冲突（非法迁移） | 刷新该订单后重试 |
| `42200` | 422 | 参数校验失败 | 按 `data.errors[].field` 高亮 |
| `42900` | 429 | 请求过于频繁 | 延迟重试 |
| `50000` | 500 | 服务器内部错误 | 「加载失败，点击重试」 |
| `50001` | 500 | 数据持久化失败 | 「加载失败，点击重试」 |

**错误 `data` 附加信息**

| 场景 | `data` 结构 |
|---|---|
| 422 参数校验 | `{ errors: [{ field: "travelers", message: "…" }] }` |
| 409 订单状态冲突 | `{ currentStatus, currentStatusText, action, allowedActions: [] }` |
| 409 时段被抢占 | `{ slotId, reason: "slot_taken", message: "该时段已被预约，请选择其他时段" }` |
| 404 路由不存在 | `{ path, method }` |

---

## 7. 数据模型

### 7.1 User

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 用户 ID | `us_000001` |
| `openid` | string | 是 | 微信 openid（开发态为 mock 值） | `mock-user-001` |
| `nickname` | string | 是 | 昵称 ≤12 字 | `随行用户001` |
| `avatar` | string | 是 | 头像 URL | `https://picsum.photos/seed/dipi-u001/200/200` |
| `gender` | enum | 是 | `male`\|`female`\|`unknown` | `female` |
| `phone` | string | 否 | 手机号 | `13800000001` |
| `city` | string | 否 | 常驻城市 | `成都` |
| `bio` | string | 否 | 个人简介 ≤30 字 | `出差顺便玩两天` |
| `tags` | string[] | 否 | 用户标签 | `["美食控"]` |
| `role` | enum | 是 | `user`\|`guide` | `user` |
| `guideId` | string | 否 | 地陪账号绑定的地陪 ID | `gd_000001` |
| `realNameVerified` | boolean | 否 | 是否实名 | `false` |
| `realNameStatus` | enum | 否 | `none`\|`pending`\|`verified`\|`rejected` | `none` |
| `memberLevel` | string | 否 | 会员等级 | `normal` |
| `createdAt` | string | 是 | 注册时间 ISO8601 | `2026-07-26T05:18:43.067Z` |
| `updatedAt` | string | 是 | 更新时间 ISO8601 | `2026-07-26T05:18:43.067Z` |

### 7.2 Guide

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 地陪 ID | `gd_000001` |
| `name` | string | 是 | 姓名（≤8 字显示） | `林小满` |
| `avatar` | string | 是 | 头像 URL | `https://picsum.photos/seed/dipi-gd1/200/200` |
| `cover` | string | 否 | 封面图 | `https://picsum.photos/seed/dipi-gd1/480/300` |
| `photoUrls` | string[] | 否 | 相册 | `["…"]` |
| `gender` | enum | 是 | `male`\|`female` | `female` |
| `city` | string | 是 | 所在城市 | `成都` |
| `district` | string | 否 | 区域 | `成都市青羊区` |
| `title` | string | 是 | 头衔 / 一句话介绍 | `本地人美食向导 · 十年老饕` |
| `intro` | string | 是 | 详细介绍 | `在成都活了三十年…` |
| `rating` | number | 是 | 综合评分 0–5（1 位小数） | `4.9` |
| `ratingCount` | int | 是 | 评价数 | `128` |
| `completedOrderCount` | int | 是 | 累计完成订单数 | `356` |
| `responseTimeMin` | int | 否 | 平均响应时长（分钟） | `10` |
| `priceAmount` | int | 是 | 起步价（**分**） | `8800` |
| `priceMaxAmount` | int | 是 | 最高价（分） | `32800` |
| `priceUnit` | enum | 是 | `hour`\|`session`\|`day`\|`person` | `hour` |
| `tags` | string[] | 是 | 服务标签（≤4 个） | `["川菜","本地人"]` |
| `serviceTypes` | string[] | 是 | 服务类型 code 列表 | `["foodTour","cityWalk"]` |
| `languages` | string[] | 否 | 掌握语言 | `["中文","English"]` |
| `highlights` | string[] | 否 | 服务亮点 | `["只去本地人排队的老馆子"]` |
| `verified` | boolean | 是 | 是否认证 | `true` |
| `status` | enum | 是 | `active`\|`resting`\|`offline` | `active` |
| `location` | string | 否 | 位置描述 | `成都市青羊区 · 太古里附近` |
| `favoritesCount` | int | 是 | 被收藏次数 | `42` |
| `availableSlots` | object[] | 否 | 可约时段 | `[{slotId,date,timeSlot,available}]` |
| `createdAt` | string | 是 | 创建时间 ISO8601 | — |

### 7.3 ServiceItem

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 服务项 ID | `si_000001` |
| `guideId` | string | 是 | 所属地陪 ID | `gd_000001` |
| `name` | string | 是 | 服务名称 | `老巷子美食半日陪逛` |
| `serviceType` | enum | 是 | 服务类型 code | `foodTour` |
| `description` | string | 是 | 服务说明 | `三顿当地人排队的馆子…` |
| `priceAmount` | int | 是 | 单价（**分**） | `16800` |
| `priceUnit` | enum | 是 | `hour`\|`session`\|`day`\|`person` | `hour` |
| `priceUnitText` | string | 否 | 单位中文 | `小时` |
| `durationHours` | number | 是 | 建议时长（小时） | `3` |
| `minTravelers` | int | 是 | 最少人数 | `1` |
| `maxTravelers` | int | 是 | 最多人数 | `8` |
| `includes` | string[] | 否 | 服务包含 | `["3 小时在地陪逛"]` |
| `icon` | string | 否 | 图标标识 | `food` |
| `slots` | object[] | 是 | 可约时段（含 `available`） | `[{slotId,date,timeSlot,available}]` |
| `bookedSlots` | string[] | 否 | 已核销的 slotId 列表 | `["2026-11-25-am"]` |
| `isAvailable` | boolean | 是 | 是否可约（响应字段） | `true` |

### 7.4 Conversation

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 会话 ID | `cv_000001` |
| `userId` | string | 是 | 用户 ID | `us_000001` |
| `guideId` | string | 是 | 地陪 ID | `gd_000001` |
| `lastMessage` | string | 是 | 最后一条消息摘要 | `可以的，周六上午九点…` |
| `lastMessageId` | string | 否 | 最后一条消息 ID | `ms_000006` |
| `lastMessageType` | string | 否 | 最后一条消息类型 | `text` |
| `lastTime` | string | 是 | 最后一条消息时间 ISO8601 | `2026-11-23T03:00:00.000Z` |
| `unreadCount` | int | 是 | 未读数 | `2` |
| `firstUnreadSeq` | int | 否 | 第一条未读消息 seq | `5` |
| `seq` | int | 是 | 会话内最大 seq（补拉游标） | `6` |
| `closed` | boolean | 是 | 是否已关闭 | `false` |
| `closedReason` | string | 否 | 关闭原因 | `订单已完成` |
| `linkedOrderId` | string | 否 | 关联订单 ID | `ord_000012` |
| `linkedOrderStatus` | string | 否 | 关联订单状态 | `pendingAccept` |
| `createdAt` | string | 是 | 创建时间 ISO8601 | — |

### 7.5 Message

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 消息 ID | `ms_000001` |
| `conversationId` | string | 是 | 会话 ID | `cv_000001` |
| `seq` | int | 是 | 会话内单调递增序号 | `1` |
| `from` | string | 是 | 发送方 ID（system 消息为 `system`） | `us_000001` |
| `to` | string | 是 | 接收方 ID | `guide_gd_000001` |
| `type` | enum | 是 | `text`\|`image`\|`order`\|`system` | `text` |
| `messageType` | enum | 是 | `text`\|`image`\|`orderCard`\|`system` | `text` |
| `content` | string | 否 | 文本内容 | `你好，我下周六在成都…` |
| `imageUrl` | string | 否 | 图片链接 | `null` |
| `orderSummary` | object | 否 | 订单卡摘要 | `{orderId, serviceName, status, totalAmount}` |
| `clientMessageId` | string | 否 | 客户端幂等键 | `c_7a1f` |
| `isRead` | boolean | 是 | 是否已读 | `true` |
| `createdAt` | string | 是 | 发送时间 ISO8601 | `2026-11-23T02:00:00.000Z` |

### 7.6 Order

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 订单 ID | `ord_000012` |
| `orderNo` | string | 是 | 用户可见订单号 | `SX000012012` |
| `userId` | string | 是 | 下单用户 ID | `us_000001` |
| `guideId` | string | 是 | 地陪 ID | `gd_000001` |
| `serviceId` | string | 是 | 服务项 ID | `si_000001` |
| `serviceName` | string | 是 | 服务名称快照 | `老巷子美食半日陪逛` |
| `serviceType` | string | 是 | 服务类型 code | `foodTour` |
| `priceUnit` | enum | 是 | `hour`\|`session`\|`day`\|`person` | `hour` |
| `city` | string | 是 | 服务城市 | `成都` |
| `slotId` | string | 是 | 预约时段 ID | `2026-12-08-am` |
| `date` | string | 是 | 服务日期 | `2026-12-08` |
| `timeSlot` | string | 是 | 时段 | `09:00-12:00` |
| `scheduledAt` | string | 是 | **服务端回显的服务时间，仅用于展示**；下单提交的是 `slotId`，两者语义不同 | `2026-12-08T09:00:00+08:00` |
| `endAt` | string | 否 | 约定结束时间 | `2026-12-08T12:00:00+08:00` |
| `travelers` | int | 是 | 人数 | `2` |
| `meetingPoint` | string | 否 | 集合点 | `宽窄巷子东广场` |
| `unitPriceAmount` | int | 是 | 服务单价（分） | `16800` |
| `durationHours` | number | 是 | 服务时长（小时） | `3` |
| `durationFactor` | number | 是 | 时长系数 | `3` |
| `peopleFactor` | number | 是 | 人数系数 | `2` |
| `subtotalAmount` | int | 是 | 小计（分） | `100800` |
| `discountAmount` | int | 是 | 优惠金额（分） | `10080` |
| `discountReason` | string | 否 | 优惠说明 | `新客首单 9 折` |
| `totalAmount` | int | 是 | 实付金额（分） | `90720` |
| `extraAmount` | int | 是 | 附加项金额（分） | `0` |
| `refundAmount` | int | 是 | 退款金额（分） | `0` |
| `currency` | string | 是 | 币种 | `CNY` |
| `remark` | string | 否 | 用户备注 | `不吃太辣` |
| `contactName` | string | 是 | 联系人 | `王一` |
| `contactPhone` | string | 是 | 联系电话 | `13800000001` |
| `conversationId` | string | 否 | 来源会话 | `cv_000001` |
| `idempotencyKey` | string | 否 | 幂等键 | `b7f3-4c21` |
| `status` | enum | 是 | 见 §8 状态机 | `pendingAccept` |
| `statusText` | string | 是 | 状态中文文案 | `待接单` |
| `statusBadge` | string | 是 | 徽章类 | `confirmed` |
| `statusTone` | string | 是 | 功能色语义 | `info` |
| `canUserPay` … `canUserReview` | boolean | 是 | 状态→操作映射（6 个） | `false` |
| `allowedActions` | string[] | 是 | **用户**可执行动作列表，与 6 个 `canUserXxx` 同源生成；值域固定 `pay`/`cancel`/`confirm`/`refund`/`contact`/`review`（**不含**地陪侧动作） | `["cancel","refund","contact"]` |
| `cancelReason` | string | 否 | 取消原因 | `航班时间变动` |
| `refundReason` | string | 否 | 退款原因 | `服务未按时开始` |
| `refundReasonCode` | string | 否 | 退款原因码 | `serviceAborted` |
| `refundStatus` | enum | 是 | `none`\|`processing`\|`rejected`\|`success` | `none` |
| `refundFromStatus` | string | 否 | 退款驳回后恢复到的原状态 | `completed` |
| `disputeStatus` | enum | 是 | `none`\|`open`\|`resolved` | `none` |
| `rating` | int | 否 | 评分 1–5 | `5` |
| `comment` | string | 否 | 评价内容 | `非常好的一次体验` |
| `timeline` | object[] | 是 | 状态时间轴 | `[{status,statusText,at,note,operator}]` |
| `expireAt` | string | 是 | 待支付截止时间 | `2026-11-23T05:36:28.000Z` |
| `serverTime` | string | 是 | 服务端当前时间（倒计时校准） | `2026-11-23T05:21:31+08:00` |
| `createdAt` | string | 是 | 下单时间 ISO8601 | — |
| `paidAt` / `acceptedAt` / `startedAt` / `endedAt` / `completedAt` / `confirmedAt` / `cancelledAt` / `refundAppliedAt` / `refundedAt` | string | 否 | 各节点时间 ISO8601 | `null` |

### 7.7 Review

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 评价 ID | `rev_000029` |
| `orderId` | string | 是 | 订单 ID | `ord_000012` |
| `guideId` | string | 是 | 地陪 ID | `gd_000001` |
| `userId` | string | 是 | 评价人 ID | `us_000001` |
| `userName` | string | 是 | 评价人昵称 | `随行用户001` |
| `userAvatar` | string | 否 | 评价人头像 | `https://…` |
| `rating` | int | 是 | 评分 1–5 | `5` |
| `content` | string | 是 | 评价内容 | `非常好的一次体验` |
| `tags` | string[] | 否 | 评价标签 | `["本地人","讲解好"]` |
| `images` | string[] | 否 | 图片 URL | `[]` |
| `serviceName` | string | 否 | 服务名称快照 | `老巷子美食半日陪逛` |
| `createdAt` | string | 是 | 创建时间 ISO8601 | — |

### 7.8 Notification

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 通知 ID | `ntf_000002` |
| `userId` | string | 是 | 接收用户 ID | `us_000001` |
| `type` | enum | 是 | `system`\|`order`\|`refund`\|`promotion` | `order` |
| `title` | string | 是 | 标题 | `订单已待接单` |
| `content` | string | 是 | 内容 | `你预约的「故宫深度讲解」已支付…` |
| `read` | boolean | 是 | 是否已读 | `false` |
| `extra` | object | 否 | 附加数据 | `{orderId, status}` |
| `createdAt` | string | 是 | 创建时间 ISO8601 | — |

### 7.9 Favorite

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | 是 | 收藏 ID | `fv_000005` |
| `userId` | string | 是 | 用户 ID | `us_000001` |
| `guideId` | string | 是 | 地陪 ID | `gd_000001` |
| `createdAt` | string | 是 | 收藏时间 ISO8601 | — |

### 7.10 Settings

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `userId` | string | 是 | 用户 ID | `us_000001` |
| `notifyEnabled` | boolean | 是 | 订单与服务通知总开关 | `true` |
| `notifyOrder` | boolean | 是 | 订单状态通知 | `true` |
| `notifyMessage` | boolean | 是 | 地陪消息通知 | `true` |
| `notifyRefund` | boolean | 是 | 售后退款通知 | `true` |
| `notifyPromotion` | boolean | 是 | 活动通知 | `false` |
| `notifySound` | boolean | 是 | 提示音 | `true` |
| `privacyLocation` | boolean | 是 | 允许共享位置 | `false` |
| `privacyShowProfile` | boolean | 是 | 对外展示资料 | `true` |
| `privacyShowOrder` | boolean | 是 | 对外展示订单 | `false` |
| `autoConfirmOrder` | boolean | 是 | 自动确认完成 | `false` |
| `updatedAt` | string | 是 | 更新时间 ISO8601 | — |

---

## 8. 订单状态机

### 8.1 状态定义（10 态，唯一一套 camelCase 枚举）

| # | `status` | 中文 | `statusBadge` | 用户可执行操作 |
|---|---|---|---|---|
| 1 | `pendingPayment` | 待支付 | `pending` | 支付、取消 |
| 2 | `pendingAccept` | 待接单 | `confirmed` | 取消、联系 |
| 3 | `accepted` | 已接单 | `confirmed` | 取消、联系 |
| 4 | `inService` | 服务中 | `ongoing` | 申请退款、联系 |
| 5 | `pendingConfirm` | 待确认 | `review` | 确认完成、申请退款、联系 |
| 6 | `completed` | 已完成 | `done` | 评价、再约 |
| 7 | `cancelled` | 已取消 | `closed` | 再约、咨询（**终态**） |
| 8 | `closed` | 已关闭 | `closed` | 再约、咨询（**终态**） |
| 9 | `refunding` | 退款中 | `refund` | 查看进度、联系客服 |
| 10 | `refunded` | 已退款 | `closed` | 再约（**终态**） |

> `cancelled` = 用户主动取消；`closed` = 系统 / 地陪侧关闭（超时未付、地陪拒单）。文案必须区分。
> **不存在 snake_case 版本**，`statusCode` 字段已删除。

### 8.2 合法迁移

| # | 从 | 触发动作 | 到 | 触发方 |
|---|---|---|---|---|
| T01 | — | `POST /orders` | `pendingPayment` | 用户 |
| T02 | `pendingPayment` | `pay` | `pendingAccept` | 用户 |
| T03 | `pendingPayment` | `cancel` | `cancelled` | 用户 |
| T04 | `pendingPayment` | `close` | `closed` | 系统（超时 15 分钟） |
| T05 | `pendingAccept` | `accept` | `accepted` | 地陪 |
| T06 | `pendingAccept` | `close` | `closed` | 地陪拒单 / 系统超时 |
| T07 | `pendingAccept` | `cancel` | `refunding` | 用户（已支付，自动退款） |
| T08 | `accepted` | `start` | `inService` | 地陪 |
| T09 | `accepted` | `cancel` | `refunding` | 用户（已支付，自动退款） |
| T10 | `inService` | `finish` | `pendingConfirm` | 地陪结束服务 |
| T11 | `inService` | `confirm` | `completed` | 用户直接确认完成 |
| T12 | `inService` | `refund` | `refunding` | 用户 |
| T13 | `pendingConfirm` | `confirm` | `completed` | 用户确认完成 |
| T14 | `pendingConfirm` | `refund` | `refunding` | 用户 |
| T15 | `completed` | `refund` | `refunding` | 用户（完成后 7 天内售后） |
| T16 | `refunding` | `refund:approve` | `refunded` | 系统 / 地陪 |
| T17 | `refunding` | `refund:reject` | **回到 `refundFromStatus`** | 系统 / 地陪 |
| T18 | `cancelled` / `closed` / `refunded` | — | — | **终态** |

**非法迁移一律返回 409（code `40901`）**，响应 `data` 带 `currentStatus` / `currentStatusText` / `allowedActions`，客户端应刷新该订单后重试。

> **注意 T07 / T09**：已支付状态下用户取消直接进入 `refunding`（自动发起退款），不是 `cancelled`。

---

## 9. 价格计算（服务端权威）

```
subtotalAmount = unitPriceAmount × durationFactor × peopleFactor
discountAmount = max(新客首单 9 折, 时长 ≥ 4 小时 95 折)   // 不叠加
totalAmount    = subtotalAmount - discountAmount
```

| 服务项 `priceUnit` | `durationFactor` | `peopleFactor` |
|---|---|---|
| `hour` | `durationHours` | `travelers` |
| `person` | `1` | `travelers` |
| `session` | `1` | `1` |

全部以**分**为单位计算，结果为整数。前端传入的价格字段一律忽略，提交后以服务端返回为准。

---

## 10. slotId 约定

- **结构**：`{YYYY-MM-DD}-{am|pm|night}`，例如 `2026-11-25-am`（09:00-12:00）/ `2026-11-25-pm`（13:00-17:00）/ `2026-11-25-night`（18:00-21:00）。
- **稳定性**：由服务端生成，**不是前端生成的序号**。同一天同一时段对所有用户是同一个 `slotId`。
- **覆盖范围**：至少未来 **14 天**，每天 3 个时段。
- **可用性**：`available: false` 的时段前端置灰不可选。
- **原子核销**：选时段 → 提交订单是一次原子操作。服务端在下单瞬间校验该 `slotId` 仍可用并核销（写入服务项的 `bookedSlots`）。
  - 不可用 → **409**（`code 40900`），`data.reason`：
    - `slot_taken` → message「该时段已被预约，请选择其他时段」
    - `slot_not_found` → message「该时段暂不可约，请选择其他时段」
  - 客户端收到后应提示并自动重选首个可约时段，**其余表单内容保留**。
- **释放**：订单取消 / 关闭时释放该时段。
- **核销粒度**：时段被核销是「服务项 + slotId」维度；不同地陪的同名时段互不影响。

---

## 11. 收藏 toggle 行为

- **唯一入口**：`PUT /api/v1/me/favorites/:guideId`，请求体为空。
- **语义**：幂等**切换**——同一用户对同一地陪重复调用会正确翻转（`favorited: true ↔ false`），不是无脑 +1。
- **并发安全**：基于同一份收藏记录的存在性判断，重复调用不会产生重复记录。
- **响应**：`{ guideId, favorited, favoritesCount }`
  - `favorited`：切换后的**当前**状态
  - `favoritesCount`：切换后的**最新**收藏总数（该地陪被所有人收藏的次数）
- **副作用**：地陪对象的 `favoritesCount` 同步更新，`GET /api/v1/guides/:guideId` 与列表接口读到的都是最新值。
- **不存在** `POST` / `DELETE` 版本（避免两套数据源）。

---

## 12. 客户端对接清单（速查）

| 页面 | 首屏请求 | 后续请求 |
|---|---|---|
| 首页 | `GET /api/v1/home` | `GET /api/v1/guides?...` |
| 搜索页 | `GET /api/v1/guides/filter-options`、`GET /api/v1/guides?…` | — |
| 地陪详情 P7 | `GET /api/v1/guides/:guideId` | `GET /api/v1/guides/:guideId/reviews`、`PUT /api/v1/me/favorites/:guideId`、`POST /api/v1/conversations` |
| 下单确认 P8 | `GET /api/v1/guides/:guideId`（与 P7 共用）、`GET /api/v1/me` | `POST /api/v1/orders` |
| 聊天页 | `GET /api/v1/conversations/:conversationId/messages` | WS `message.send`、`POST /api/v1/conversations/:conversationId/read` |
| 订单页 | `GET /api/v1/orders/summary`、`GET /api/v1/orders?status=…` | `POST /api/v1/orders/:orderId/{pay,cancel,confirm,refund,review}` |
| 消息页 | `GET /api/v1/messages?type=conversation`、`GET /api/v1/messages?type=notice` | `POST /api/v1/notices/read` |
| 我的 | `GET /api/v1/me`、`GET /api/v1/me/settings` | `PUT /api/v1/me`、`PUT /api/v1/me/settings`、`PUT /api/v1/me/favorites/:guideId` |

### 12.1 P8 下单确认页注意事项

1. `onShow` **只重拉 `availableSlots`**，**绝不重置用户已填的表单**。
2. `idempotencyKey` 在**同一次下单重试中保持不变**，换订单才变。
3. 提交成功后经 `dipi:nav:order` 跳转订单页；该标记**只写一次**且在 `onLoad` 后立即清除。
4. 提交体只用 `guideId` / `serviceId` / `slotId` / `travelers` / `contactName` / `contactPhone` / `meetingPoint` / `remark?` / `conversationId?` / `idempotencyKey`。

---

## 13. 本地联调建议

1. **微信开发者工具**：详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
2. **开发态登录**：`POST /api/v1/auth/login` 传 `{ "code": "mock-user-001" }`，把 `token` 存到 `storage.dipi:user:token`，后续请求带 `Authorization: Bearer <token>`。
3. **金额格式化**：服务端返回的是分，前端统一 `formatYuan(amount)` = `(amount / 100).toFixed(2)`。
4. **数据重置**：`npm run seed:force`。
5. **完整状态流转演示**：用 `mock-user-001` 与 `mock-guide-001` 两个 token 依次调 `pay → accept → start → confirm → review`。

---

*文档结束 · 字段名以本文档为准（UX 规范 §B.7.3 亦声明「完整结构以 docs/03-api-contract.md 为准」）。服务端实现见 `dipi/server/`。*
