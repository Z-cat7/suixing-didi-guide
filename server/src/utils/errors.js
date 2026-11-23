'use strict';

/**
 * 业务错误类
 * ---------------------------------------------------------------------------
 * code 约定：
 *   0      成功
 *   4xxxx  客户端错误（参数、鉴权、越权、资源不存在、状态冲突）
 *   5xxxx  服务端错误
 */

/** 错误码表（与 docs/03-api-contract.md 保持一致） */
const ERROR_CODES = {
  OK: 0,

  // ---- 4xxxx 客户端错误 ----
  BAD_REQUEST: 40000,          // 通用请求错误
  PARAM_MISSING: 40001,        // 缺少必填参数
  PARAM_INVALID: 40002,        // 参数格式非法
  UNAUTHORIZED: 40100,         // 未登录 / token 缺失
  TOKEN_INVALID: 40101,        // token 签名错误或被篡改
  TOKEN_EXPIRED: 40102,        // token 已过期
  FORBIDDEN: 40300,            // 通用越权
  FORBIDDEN_CONVERSATION: 40301, // 无权查看该会话
  FORBIDDEN_ORDER: 40302,      // 无权查看该订单
  NOT_FOUND: 40400,            // 资源不存在
  NOT_FOUND_ROUTE: 40401,      // 接口不存在
  CONFLICT: 40900,             // 通用状态冲突
  CONFLICT_ORDER_STATUS: 40901,// 订单状态冲突（非法迁移）
  CONFLICT_REVIEWED: 40902,    // 订单已评价，不可重复评价
  PAYMENT_FAILED: 40200,       // 支付失败
  UNPROCESSABLE: 42200,        // 参数校验失败
  TOO_MANY_REQUESTS: 42900,    // 请求过于频繁

  // ---- 5xxxx 服务端错误 ----
  INTERNAL_ERROR: 50000,       // 未预期异常
  STORAGE_ERROR: 50001,        // 持久化失败
};

class AppError extends Error {
  /**
   * @param {number} code 业务错误码
   * @param {string} message 中文提示
   * @param {number} [status=400] HTTP 状态码
   * @param {object} [details] 附加信息（如字段级错误）
   */
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expected = true;
  }
}

/** 404 资源不存在 */
const notFound = (message = '资源不存在', details) =>
  new AppError(ERROR_CODES.NOT_FOUND, message, 404, details);

/** 401 未登录 */
const unauthorized = (message = '请先登录', details) =>
  new AppError(ERROR_CODES.UNAUTHORIZED, message, 401, details);

/** 403 越权（通用） */
const forbidden = (message = '无权访问该资源', details) =>
  new AppError(ERROR_CODES.FORBIDDEN, message, 403, details);

/** 403 越权（会话） */
const forbiddenConversation = (message = '无权查看该会话', details) =>
  new AppError(ERROR_CODES.FORBIDDEN_CONVERSATION, message, 403, details);

/** 403 越权（订单） */
const forbiddenOrder = (message = '无权查看该订单', details) =>
  new AppError(ERROR_CODES.FORBIDDEN_ORDER, message, 403, details);

/** 409 状态冲突（通用） */
const conflict = (message = '当前状态不允许该操作', details) =>
  new AppError(ERROR_CODES.CONFLICT, message, 409, details);

/** 409 订单状态冲突 */
const conflictOrderStatus = (message = '当前状态不允许该操作', details) =>
  new AppError(ERROR_CODES.CONFLICT_ORDER_STATUS, message, 409, details);

/** 422 参数校验失败 */
const unprocessable = (message = '参数校验失败', details) =>
  new AppError(ERROR_CODES.UNPROCESSABLE, message, 422, details);

/** 400 参数缺失 */
const paramMissing = (message = '缺少必填参数', details) =>
  new AppError(ERROR_CODES.PARAM_MISSING, message, 400, details);

/** 400 参数格式非法 */
const paramInvalid = (message = '参数格式非法', details) =>
  new AppError(ERROR_CODES.PARAM_INVALID, message, 400, details);

module.exports = {
  AppError,
  ERROR_CODES,
  notFound,
  unauthorized,
  forbidden,
  forbiddenConversation,
  forbiddenOrder,
  conflict,
  conflictOrderStatus,
  unprocessable,
  paramMissing,
  paramInvalid,
};
