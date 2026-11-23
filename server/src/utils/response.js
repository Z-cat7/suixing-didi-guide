'use strict';

/**
 * 统一响应封装
 * ---------------------------------------------------------------------------
 * 响应信封：{ code, message, data, requestId }
 * 分页信封：{ list, total, page, pageSize, hasMore }
 */

const { ERROR_CODES } = require('./errors');

/**
 * 构造成功信封
 * @param {any} data 业务数据
 * @param {string} requestId 请求 ID
 * @param {string} [message='ok'] 提示文案
 */
function ok(data, requestId, message = 'ok') {
  return { code: ERROR_CODES.OK, message, data: data === undefined ? null : data, requestId };
}

/**
 * 构造失败信封
 * @param {number} code 业务码
 * @param {string} message 中文提示
 * @param {string} requestId 请求 ID
 * @param {any} [details] 附加信息
 */
function fail(code, message, requestId, details) {
  return {
    code,
    message,
    data: details === undefined ? null : details,
    requestId,
  };
}

/**
 * 构造分页信封
 * @param {any[]} list 当前页数据
 * @param {number} total 总条数
 * @param {number} page 当前页码（从 1 开始）
 * @param {number} pageSize 每页条数
 */
function paginate(list, total, page, pageSize) {
  return {
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

module.exports = { ok, fail, paginate };
