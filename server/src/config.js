'use strict';

/**
 * 集中配置
 * ---------------------------------------------------------------------------
 * 所有可调项均可通过环境变量覆盖，便于开发 / 测试 / 生产切换。
 */

const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/** 读取环境变量并转数字（无值时用默认值） */
function envNum(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 读取环境变量并转布尔（'1'/'true'/'yes' 视为真） */
function envBool(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

const config = {
  /** 项目根目录（server/） */
  root: ROOT,

  /** 运行环境 */
  env: process.env.NODE_ENV || 'development',

  /** HTTP / WS 监听端口（WS 与 HTTP 同端口，通过 upgrade 区分） */
  port: envNum('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',

  /** JSON 数据目录 */
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),

  /** Token 配置：HMAC-SHA256 自实现签名，无外部依赖 */
  token: {
    /** 签名密钥。生产环境务必通过环境变量注入 */
    secret: process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex'),
    /** token 有效期（秒），默认 7 天 */
    ttlSeconds: envNum('TOKEN_TTL_SECONDS', 7 * 24 * 60 * 60),
  },

  /** 微信小程序登录（未配置 appId 时启用 mock 登录） */
  wechat: {
    appId: process.env.WECHAT_APP_ID || '',
    appSecret: process.env.WECHAT_APP_SECRET || '',
    /** mock 登录开关：开发态无微信环境时用 code=mock-user-001 直接登录 */
    enableMock: envBool('ENABLE_MOCK_LOGIN', true),
  },

  /** 分页默认值 */
  pagination: {
    defaultPageSize: envNum('DEFAULT_PAGE_SIZE', 10),
    maxPageSize: envNum('MAX_PAGE_SIZE', 50),
  },

  /** WebSocket 心跳：interval 毫秒发一次 ping，timeout 毫秒无响应则断开 */
  ws: {
    heartbeatIntervalMs: envNum('WS_HEARTBEAT_INTERVAL_MS', 30000),
    heartbeatTimeoutMs: envNum('WS_HEARTBEAT_TIMEOUT_MS', 90000),
    /** 单条消息最大字节数 */
    maxPayloadBytes: envNum('WS_MAX_PAYLOAD_BYTES', 64 * 1024),
  },

  /** 业务常量 */
  business: {
    /** 订单取消时限：下单后 N 分钟内允许自助取消（未支付时） */
    cancelWindowMinutes: envNum('ORDER_CANCEL_WINDOW_MINUTES', 30),
  },
};

module.exports = config;
