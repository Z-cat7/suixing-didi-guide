/**
 * 随行 dipi · 小程序端运行时配置
 * ---------------------------------------------------------------------------
 * 开发者工具中请在「详情 → 本地设置」勾选「不校验合法域名」，
 * 否则 http://127.0.0.1:3000 会被拦截。
 *
 * USE_MOCK 支持三种取值：
 *   'auto' —— 默认。先请求真实服务端；网络层失败（连不上/超时）时自动降级到 mock 数据
 *   true   —— 强制 mock，完全不发网络请求（离线演示 / 后端未就绪时用）
 *   false  —— 强制真实服务端，连不上就报错，不降级
 */

/** 服务端地址（不含 /api/v1 前缀） */
const BASE_URL = 'http://127.0.0.1:3000';

/** REST 前缀 —— 与服务端契约一致 */
const API_PREFIX = '/api/v1';

/** WebSocket 地址 */
const WS_URL = 'ws://127.0.0.1:3000/ws';

module.exports = {
  /** 服务端基地址 */
  BASE_URL,
  /** REST 前缀 */
  API_PREFIX,
  /** WebSocket 完整地址 */
  WS_URL,

  /** mock 开关：'auto' | true | false */
  USE_MOCK: 'auto',

  /** mock 模式下的「假登录」code，传给 POST /api/v1/auth/login */
  MOCK_LOGIN_CODE: 'mock-user-001',

  /** 请求超时（毫秒） */
  REQUEST_TIMEOUT: 12000,

  /** GET 请求失败重试次数（幂等，可重试） */
  GET_RETRY: 1,

  /** 分页：默认每页条数（契约要求 20） */
  PAGE_SIZE: 20,

  /** WS 心跳间隔（毫秒）—— 规范要求客户端 25s 一次 */
  WS_HEARTBEAT_INTERVAL: 25000,

  /** WS 心跳超时（毫秒）—— 45s 未响应判定断开 */
  WS_HEARTBEAT_TIMEOUT: 45000,

  /** WS 重连退避档位（毫秒），封顶 30s */
  WS_RECONNECT_STEPS: [1000, 2000, 4000, 8000, 15000, 30000],

  /** WS 降级为轮询的阈值（毫秒）—— 60s 未连上则切轮询 */
  WS_POLLING_THRESHOLD: 60000,

  /** WS 降级后轮询间隔（毫秒） */
  WS_POLLING_INTERVAL: 15000,

  /** 页面数据缓存有效期（毫秒）—— 5 分钟 */
  CACHE_TTL: 5 * 60 * 1000,
};
