/**
 * 随行 dipi · 统一请求封装
 * ---------------------------------------------------------------------------
 * 能力清单：
 *   1. BASE_URL + /api/v1 前缀拼接
 *   2. token 自动注入（Authorization: Bearer <token>）
 *   3. 超时控制（默认 12s）
 *   4. 幂等 GET 失败重试 1 次
 *   5. 统一错误处理 + Toast 提示
 *   6. 401 → 自动重新登录一次 → 重放原请求
 *   7. requestId 透传（请求头 X-Request-Id → 响应头回读）
 *   8. 服务端不可用 → 自动降级到 mock 数据（页面不白屏）
 *
 * 【全链路约定】
 *   - 字段命名 camelCase；金额整数分且以 Amount 结尾；时间 ISO8601
 *   - 响应信封 { code, message, data }，code === 0 为成功
 */
const config = require('../config/index');
const storage = require('./storage');
const mock = require('./mock');

/** 是否已降级到 mock（一旦服务端恢复可由 resetMockMode 复位） */
let mockMode = config.USE_MOCK === true;
let mockModeLocked = config.USE_MOCK === true;

/** 正在进行的重新登录 Promise（避免并发多次登录） */
let refreshingPromise = null;

/**
 * 生成 requestId（用于链路追踪）
 * @returns {string}
 */
function genRequestId() {
  return (
    'wx-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 8)
  );
}

/**
 * 是否处于 mock 模式
 * @returns {boolean}
 */
function isMockMode() {
  if (mockModeLocked) return true;
  return config.USE_MOCK === 'auto' ? mockMode : false;
}

/**
 * 复位 mock 模式（下次请求重新尝试真实服务端）
 */
function resetMockMode() {
  if (!mockModeLocked) mockMode = false;
}

/**
 * 切换到 mock 模式（服务端不可用时）
 */
function enterMockMode() {
  if (config.USE_MOCK === 'auto') mockMode = true;
}

/**
 * 统一 Toast 错误提示
 * @param {string} message 文案
 * @param {string} type success|error|warning
 */
function toast(message, type) {
  if (!message) return;
  wx.showToast({
    title: message,
    icon: type === 'error' ? 'none' : 'none',
    duration: type === 'error' ? 2500 : type === 'success' ? 1500 : 2000,
  });
}

/**
 * 登录（重新登录用）
 * @returns {Promise<string>} token
 */
function doLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        // 开发态：mock code 直登；生产环境用真实 code
        const code = config.USE_MOCK === true ? config.MOCK_LOGIN_CODE : res.code;
        requestRaw(
          {
            url: '/auth/login',
            method: 'POST',
            data: { code: code },
            auth: false,
            retried: true,
          },
          0
        )
          .then((data) => {
            const token = (data && data.token) || '';
            if (!token) {
              reject(new Error('登录失败'));
              return;
            }
            storage.setToken(token);
            if (data.user) storage.setProfile(data.user);
            resolve(token);
          })
          .catch(reject);
      },
      fail: () => {
        // wx.login 失败（开发者工具未配置 appid 时）→ 用 mock code 再试
        requestRaw(
          { url: '/auth/login', method: 'POST', data: { code: config.MOCK_LOGIN_CODE }, auth: false, retried: true },
          0
        )
          .then((data) => {
            const token = (data && data.token) || '';
            if (!token) {
              reject(new Error('登录失败'));
              return;
            }
            storage.setToken(token);
            resolve(token);
          })
          .catch(reject);
      },
    });
  });
}

/**
 * 确保有 token（无 token 或 401 后重新登录一次）
 * @returns {Promise<string>} token
 */
function ensureToken() {
  const token = storage.getToken();
  if (token) return Promise.resolve(token);
  if (!refreshingPromise) {
    refreshingPromise = doLogin();
    // 手动收尾，避免依赖 Promise.prototype.finally 的兼容性
    refreshingPromise = refreshingPromise.then(
      (t) => {
        refreshingPromise = null;
        return t;
      },
      (e) => {
        refreshingPromise = null;
        throw e;
      }
    );
  }
  return refreshingPromise;
}

/**
 * 底层请求（走 mock 或真实服务端）
 * @param {object} options 选项
 * @param {number} retryLeft 剩余重试次数
 * @returns {Promise<any>} data 字段
 */
function requestRaw(options, retryLeft) {
  const opt = options || {};
  const method = (opt.method || 'GET').toUpperCase();
  const isMock = isMockMode();

  if (isMock) {
    return Promise.resolve()
      .then(() => {
        const res = mock.handle(method, opt.url, opt.query || opt.data || {}, opt.data || {});
        if (res && res.code === 0) return res.data;
        const err = new Error((res && res.message) || '请求失败');
        err.code = res && res.code;
        throw err;
      })
      .catch((e) => {
        throw e;
      });
  }

  return new Promise((resolve, reject) => {
    const requestId = genRequestId();
    const header = Object.assign(
      {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      opt.header || {}
    );

    const token = opt.auth === false ? '' : storage.getToken();
    if (token) header.Authorization = 'Bearer ' + token;

    let url = config.BASE_URL + config.API_PREFIX + opt.url;
    if (opt.query) {
      const parts = [];
      Object.keys(opt.query).forEach((k) => {
        const v = opt.query[k];
        if (v === undefined || v === null || v === '') return;
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      if (parts.length) url += '?' + parts.join('&');
    }

    wx.request({
      url: url,
      method: method,
      data: opt.data || {},
      header: header,
      timeout: opt.timeout || config.REQUEST_TIMEOUT,
      success: (res) => {
        const body = res.data || {};
        // 透传 requestId，便于排查
        if (res.header && res.header['X-Request-Id']) body.requestId = res.header['X-Request-Id'];
        if (body.code === 0) {
          resolve(body.data);
          return;
        }
        const err = new Error(body.message || '请求失败');
        err.code = body.code;
        err.requestId = body.requestId || requestId;
        err.isBusiness = true;
        reject(err);
      },
      fail: (err) => {
        const e = new Error((err && err.errMsg) || '网络连接失败');
        e.code = -1;
        e.isNetwork = true;
        e.requestId = requestId;
        e.rawMsg = err && err.errMsg;
        // 服务端连不上 → 降级到 mock
        if (config.USE_MOCK === 'auto' && e.isNetwork) {
          enterMockMode();
        }
        reject(e);
      },
    });
  });
}

/**
 * 统一请求入口
 * @param {object} options
 *   url        —— 去掉 /api/v1 的路径，如 '/guides'
 *   method     —— 默认 GET
 *   data       —— 请求体
 *   query      —— query 参数（GET 用）
 *   auth       —— 是否带 token，默认 true
 *   silent     —— 是否静默（不弹 Toast），默认 false
 *   showError  —— 是否弹错误 Toast，默认 true
 *   retry      —— 是否允许重试（仅 GET），默认按方法判断
 * @returns {Promise<any>} data 字段
 */
function request(options) {
  const opt = options || {};
  const method = (opt.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const allowRetry = opt.retry === undefined ? isGet : opt.retry;

  const run = (retryLeft) => {
    return requestRaw(opt, retryLeft).catch((err) => {
      // 401 → 重新登录一次后重放
      if (err && err.code === 40100 && !opt._relogged) {
        opt._relogged = true;
        return ensureToken()
          .then(() => requestRaw(opt, 0))
          .catch((e2) => {
            if (!opt.silent && opt.showError !== false) toast(e2.message || '登录已失效，请重试', 'error');
            throw e2;
          });
      }
      // 网络层失败 → 降级到 mock 后重试一次
      if (err && err.isNetwork && config.USE_MOCK === 'auto' && isMockMode()) {
        return requestRaw(opt, 0).catch((e2) => {
          if (!opt.silent && opt.showError !== false) toast(e2.message || '网络连接失败', 'error');
          throw e2;
        });
      }
      // 幂等 GET 重试
      if (allowRetry && retryLeft > 0 && err && err.isNetwork) {
        return run(retryLeft - 1);
      }
      if (!opt.silent && opt.showError !== false) {
        toast(err.message || '网络连接失败', 'error');
      }
      throw err;
    });
  };

  return run(allowRetry ? config.GET_RETRY : 0);
}

/**
 * GET 请求
 * @param {string} url 路径
 * @param {object} query 参数
 * @param {object} options 其他选项
 * @returns {Promise<any>}
 */
function get(url, query, options) {
  return request(Object.assign({}, options || {}, { url: url, method: 'GET', query: query || {} }));
}

/**
 * POST 请求
 * @param {string} url 路径
 * @param {object} data 请求体
 * @param {object} options 其他选项
 * @returns {Promise<any>}
 */
function post(url, data, options) {
  return request(Object.assign({}, options || {}, { url: url, method: 'POST', data: data || {} }));
}

/**
 * PUT 请求
 * @param {string} url 路径
 * @param {object} data 请求体
 * @param {object} options 其他选项
 * @returns {Promise<any>}
 */
function put(url, data, options) {
  return request(Object.assign({}, options || {}, { url: url, method: 'PUT', data: data || {} }));
}

/**
 * DELETE 请求
 * @param {string} url 路径
 * @param {object} options 其他选项
 * @returns {Promise<any>}
 */
function del(url, options) {
  return request(Object.assign({}, options || {}, { url: url, method: 'DELETE' }));
}

module.exports = {
  request,
  get,
  post,
  put,
  del,
  toast,
  ensureToken,
  doLogin,
  isMockMode,
  resetMockMode,
  enterMockMode,
  genRequestId,
};
