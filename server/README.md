# 随行 dipi · 服务端

线下地陪服务交易平台的 Node.js 后端。**零外部服务依赖**——`npm install` 后即可启动，数据落在本地 JSON 文件。

- 运行时：Node.js 22+（开发使用 v22.22.2）
- 框架：Express 4 + ws（同端口 HTTP / WebSocket）
- 存储：JSON 文件（内存缓存 + 防抖落盘 + 原子写）
- 依赖：`express`、`ws`（仅此两个）

> **接口契约以 `dipi/docs/03-api-contract.md` 为准**（路径只有 `/api/v1`，字段全链路 camelCase，金额为整数分）。

---

## 1. 快速开始

```bash
cd dipi/server
npm install
npm run seed      # 生成种子数据（首次启动会自动执行，也可手动跑）
npm start         # 启动服务，默认 http://127.0.0.1:3000
```

其他脚本：

```bash
npm run dev        # node --watch 热重启
npm run seed       # 数据为空时写入（已有数据则跳过）
npm run seed:force # 清空后重写种子数据
npm test           # 运行全部接口测试（node:test，83 个用例）
node scripts/smoke.js          # 冒烟脚本：逐个探测所有主要接口 + 完整状态流转
node scripts/verify.js         # 验收脚本：15 项契约断言（登录/首页/筛选/详情/下单/幂等/409/403/收藏）
node scripts/shutdown-check.js # 优雅退出 + 落盘自检
```

启动成功会看到：

```
  随行 dipi · 服务端已启动
  ------------------------------------------
  环境      : development
  HTTP      : http://0.0.0.0:3000
  WebSocket : ws://0.0.0.0:3000/ws?token=<token>
  数据目录  : .../dipi/server/data
  健康检查  : http://0.0.0.0:3000/api/v1/health
  ------------------------------------------
```

---

## 2. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口（HTTP 与 WS 同端口） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `<server>/data` | JSON 数据目录 |
| `TOKEN_SECRET` | 随机 32 字节 | **生产必须固定**，否则重启后旧 token 全部失效 |
| `TOKEN_TTL_SECONDS` | `604800`（7 天） | token 有效期 |
| `ENABLE_MOCK_LOGIN` | `true` | 是否允许 mock 登录（上线请置 `false`） |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 空 | 微信小程序凭据；为空时只能用 mock 登录 |
| `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` | `10` / `50` | 分页默认与上限 |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WS 巡检间隔 |
| `WS_HEARTBEAT_TIMEOUT_MS` | `90000` | WS 无响应断开阈值 |

---

## 3. 目录结构

```
server/
├── package.json
├── README.md
├── .gitignore
├── scripts/
│   ├── smoke.js              冒烟脚本
│   ├── verify.js             验收脚本（15 项契约断言）
│   └── shutdown-check.js     优雅退出自检
├── data/                     运行时 JSON 数据（.gitignore 忽略 *.json）
│   └── .gitkeep
├── src/
│   ├── app.js                Express 装配、路由挂载（唯一前缀 /api/v1）、错误处理
│   ├── server.js             HTTP + WS 同端口启动、优雅退出
│   ├── config.js             集中配置
│   ├── db/
│   │   ├── store.js          JSON 持久化（内存缓存 + 原子写）
│   │   └── seed.js           种子数据生成
│   ├── models/
│   │   ├── index.js          实体定义、服务类型字典、校验规则
│   │   └── statusMap.js      订单状态枚举 + 文案 + canUserXxx 标志
│   ├── middleware/
│   │   ├── auth.js           Bearer token 校验
│   │   ├── cors.js           轻量 CORS
│   │   ├── error.js          统一错误响应
│   │   ├── requestId.js      请求 ID
│   │   └── validate.js       参数校验中间件
│   ├── routes/
│   │   ├── auth.js  home.js  guides.js  conversations.js
│   │   ├── messages.js  notices.js  orders.js  me.js
│   ├── services/
│   │   ├── authService.js       登录 / 换 token
│   │   ├── guideService.js      搜索筛选 / 排序 / 推荐 / 详情
│   │   ├── orderService.js      价格计算 / 订单整形 / 时段核销 / orderStats
│   │   ├── orderStateMachine.js 状态机（迁移表 + 守卫）
│   │   ├── conversationService.js 会话与消息
│   │   ├── notificationService.js 系统通知
│   │   ├── userService.js       资料 / 收藏 toggle / 设置
│   │   ├── homeService.js       首页聚合
│   │   └── eventBus.js          HTTP → WS 事件广播
│   ├── utils/
│   │   ├── errors.js         错误类与错误码表
│   │   ├── response.js       响应信封封装
│   │   ├── token.js          HMAC 自实现 token
│   │   ├── validate.js       轻量校验器
│   │   └── money.js          分/元换算、ISO8601 时间
│   └── ws/
│       └── index.js          WebSocket 服务（信封 { type, payload, ts }）
└── test/
    ├── api.test.js           66 个接口测试
    ├── contract.test.js      7 个契约静态守卫（命名收敛 / 路由前缀 / import 完整性）
    └── ws.test.js            9 个 WebSocket 测试
```

---

## 4. 调试示例（curl）

### 4.1 登录拿 token

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"code":"mock-user-001"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")
```

地陪账号（演示接单 / 开始服务 / 同意退款）：

```bash
GUIDE_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"code":"mock-guide-001"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")
```

### 4.2 首页聚合

```bash
curl -s http://127.0.0.1:3000/api/v1/home
```

### 4.3 地陪列表：多条件组合筛选

```bash
curl -s "http://127.0.0.1:3000/api/v1/guides?destination=成都&serviceType=foodTour&minPrice=80&maxPrice=200&rating=4.5&sort=priceAsc"
```

返回：

```jsonc
{
  "code": 0, "message": "ok",
  "data": {
    "list": [
      { "guideId": "gd_000001", "name": "林小满", "city": "成都", "priceAmount": 8800, "rating": 4.9 },
      { "guideId": "gd_000003", "name": "周慕青", "city": "成都", "priceAmount": 16800, "rating": 4.7 }
    ],
    "total": 2, "page": 1, "pageSize": 10, "hasMore": false
  },
  "requestId": "req_..."
}
```

> `priceAmount` 单位是**分**；`minPrice` / `maxPrice` 入参单位是**元**。

### 4.4 完整订单状态流转

```bash
# 取一个可用时段与服务项
SLOT=$(curl -s http://127.0.0.1:3000/api/v1/guides/gd_000001 \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.guide.availableSlots.find(s=>s.available).slotId")
SERVICE=$(curl -s http://127.0.0.1:3000/api/v1/guides/gd_000001 \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.guide.services[0].serviceId")

# 1) 创建订单（前端传 totalAmount=1 也会被服务端忽略并重算）
ORDER_ID=$(curl -s -X POST http://127.0.0.1:3000/api/v1/orders \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"guideId\":\"gd_000001\",\"serviceId\":\"$SERVICE\",\"slotId\":\"$SLOT\",\"travelers\":2,\"contactName\":\"测试\",\"contactPhone\":\"13800000001\",\"meetingPoint\":\"宽窄巷子东广场\",\"idempotencyKey\":\"demo-001\",\"totalAmount\":1}" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).data.orderId")

# 2) 支付 → pendingAccept
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/pay -H "Authorization: Bearer $TOKEN"

# 3) 地陪接单 → accepted
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/accept -H "Authorization: Bearer $GUIDE_TOKEN"

# 4) 地陪开始服务 → inService
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/start -H "Authorization: Bearer $GUIDE_TOKEN"

# 5) 用户确认完成 → completed
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/confirm -H "Authorization: Bearer $TOKEN"

# 6) 评价
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/review \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"rating":5,"comment":"非常好的一次体验"}'
```

### 4.5 非法迁移返回 409

```bash
curl -s -X POST http://127.0.0.1:3000/api/v1/orders/$ORDER_ID/pay -H "Authorization: Bearer $TOKEN"
# {"code":40901,"message":"订单当前为「已完成」，不支持支付操作",...}
```

### 4.6 越权返回 403

```bash
# mock-user-002 访问 mock-user-001 的订单
curl -s http://127.0.0.1:3000/api/v1/orders/ord_000001 -H "Authorization: Bearer $OTHER_TOKEN"
# {"code":40302,"message":"无权查看该订单",...}
```

### 4.7 时段被抢占返回 409

```bash
# 用同一个 slotId 再下一单（换个 idempotencyKey）
curl -s -X POST http://127.0.0.1:3000/api/v1/orders \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"guideId\":\"gd_000001\",\"serviceId\":\"$SERVICE\",\"slotId\":\"$SLOT\",\"travelers\":1,\"contactName\":\"测试\",\"contactPhone\":\"13800000001\",\"idempotencyKey\":\"demo-002\"}"
# {"code":40900,"message":"该时段已被预约，请选择其他时段","data":{"slotId":"...","reason":"slot_taken"}}
```

### 4.8 收藏 toggle

```bash
curl -s -X PUT http://127.0.0.1:3000/api/v1/me/favorites/gd_000001 -H "Authorization: Bearer $TOKEN"
# {"guideId":"gd_000001","favorited":true,"favoritesCount":12}
```

### 4.9 WebSocket

```js
const WebSocket = require('ws');
const ws = new WebSocket(`ws://127.0.0.1:3000/ws?token=${TOKEN}`);

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  // { type, payload, ts }
  if (msg.type === 'connected') {
    ws.send(JSON.stringify({
      type: 'message.send',
      payload: {
        conversationId: 'cv_000001',
        content: '你好',
        messageType: 'text',
        clientMessageId: 'c-1',
      },
    }));
  }
  // 发送成功会以 message.new 回推（含 clientMessageId 与 seq）
  if (msg.type === 'message.new') console.log('已发送 seq=', msg.payload.message.seq);
});
```

---

## 5. 微信开发者工具配置

1. 打开 **微信开发者工具** → 右上角 **详情** → **本地设置**。
2. 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。
3. 在小程序端 `wx.request` 中把 baseURL 设为 `http://127.0.0.1:3000/api/v1`（真机调试时改成 `http://<你的局域网IP>:3000/api/v1`，并确保防火墙放行）。
4. **登录**：开发态调用 `POST /api/v1/auth/login` 传 `{ code: "mock-user-001" }`；真实环境传 `wx.login()` 拿到的 code，并在服务端配置 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`。
5. **WebSocket**：`wx.connectSocket({ url: 'ws://127.0.0.1:3000/ws?token=<token>' })`（WS 路径不带 `/api/v1`）。

> 生产环境务必：`ENABLE_MOCK_LOGIN=false`、固定 `TOKEN_SECRET`、使用 HTTPS/WSS。

---

## 6. 数据与持久化

- 数据文件位于 `data/`：`users.json`、`guides.json`、`serviceItems.json`、`conversations.json`、`messages.json`、`orders.json`、`reviews.json`、`notifications.json`、`favorites.json`、`settings.json`。
- **写入策略**：内存缓存 → 标记 dirty → 50ms 防抖 → 写临时文件（`.tmp`）→ `rename` 原子替换。
- 进程退出（SIGINT / SIGTERM）时 `flushAll()` 落盘后退出；文件损坏时自动备份为 `.corrupt-<时间戳>` 并以空集合启动，不会整体崩溃。
- `data/*.json` 已在 `.gitignore` 中，保留 `data/.gitkeep`。

---

## 7. 测试

```bash
npm test
```

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `test/api.test.js` | 66 | 鉴权、首页、搜索组合筛选、排序分页、筛选面板、地陪详情与时段结构、会话消息与 seq、订单全状态流转、409 状态冲突与时段抢占、幂等下单、越权 403、收藏 toggle、设置、orderStats |
| `test/contract.test.js` | 7 | **契约静态守卫**：路由只有 /api/v1、无 snake_case / 废弃字段、无 snake 状态常量、模块可加载、状态常量 import 完整性、测试脚本命名一致 |
| `test/ws.test.js` | 9 | WS 鉴权、信封结构 { type, payload, ts }、心跳、消息发送与回推、越权拦截、订单状态推送 |

> `contract.test.js` 把「契约收敛」变成机器可验证的断言——以后任何一次重构若重新引入双前缀 / 双状态名 / 双金额单位，或漏 import 状态常量，测试会直接失败。

测试使用独立的临时数据目录，**不会污染** `data/` 下的开发数据。

> 整套测试约 1–2 秒；如遇网络抖动偶发变慢属正常。

---

## 8. API 契约

完整契约见 **`dipi/docs/03-api-contract.md`**（字段名以该文档为准）。要点：

- 统一信封 `{ code, message, data, requestId }`；`code === 0` 为成功。
- **路径前缀只有 `/api/v1`**。
- **字段全链路 camelCase**，只有一种写法。
- **金额一律整数分**，字段名以 `Amount` 结尾。
- **订单状态只有 camelCase 一种**；用 `statusText` 显示徽章、`canUserXxx` 决定按钮，前端不做状态判断。
- **订单总价由服务端计算**，前端传的价格字段一律忽略。
- **下单只传 `slotId`**，服务端原子核销；被抢占返回 409。
- **收藏只有 toggle 一个入口**：`PUT /api/v1/me/favorites/:guideId`。

---

## 9. 已知限制

- 微信 `code2Session` 未做缓存，每次换 token 都会请求一次微信接口。
- 未实现订单超时自动流转（`pendingPayment → closed` / `pendingAccept → closed`）的定时任务，需外部调度器调用 `POST /api/v1/orders/:orderId/close`。
- JSON 文件存储适合开发与演示；生产建议换成 SQLite / PostgreSQL（仅需替换 `src/db/store.js`）。
- WebSocket 未做集群广播（多实例部署需引入 Redis Pub/Sub）。
- 时段核销粒度为「服务项 + slotId」，同一时段下不同服务项互不影响。
