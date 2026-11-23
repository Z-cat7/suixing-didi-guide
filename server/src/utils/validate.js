'use strict';

/**
 * 轻量参数校验器（无外部依赖）
 * ---------------------------------------------------------------------------
 * 用法：
 *   const data = validate(req.query, {
 *     page:  { type: 'int', default: 1, min: 1 },
 *     keyword: { type: 'string', max: 50, trim: true },
 *     serviceType: { type: 'enum', values: ['food_tour'] },
 *   });
 * 校验失败抛出 AppError(422)。
 */

const { unprocessable } = require('./errors');
const { pagination: PAGE } = require('../config');

/**
 * @typedef {Object} FieldRule
 * @property {'string'|'int'|'number'|'boolean'|'array'|'enum'|'date'|'id'} type
 * @property {boolean} [required]
 * @property {*} [default]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [maxLength]
 * @property {string[]} [values]
 * @property {RegExp} [pattern]
 * @property {boolean} [trim]
 */

/**
 * 校验单个字段
 * @returns {{ok:true,value:*}|{ok:false,message:string}}
 */
function checkField(raw, rule, field) {
  let value = raw;

  // 空字符串视为未传（query 参数常见）
  if (value === '' || value === undefined || value === null) {
    if (rule.required) return { ok: false, message: `缺少必填参数：${field}` };
    return { ok: true, value: rule.default !== undefined ? rule.default : undefined };
  }

  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') {
        // 允许数字等原始值转字符串
        if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
        else return { ok: false, message: `参数 ${field} 必须是字符串` };
      }
      if (rule.trim) value = value.trim();
      if (rule.maxLength && value.length > rule.maxLength) {
        return { ok: false, message: `参数 ${field} 长度不能超过 ${rule.maxLength}` };
      }
      if (rule.minLength && value.length < rule.minLength) {
        return { ok: false, message: `参数 ${field} 长度不能少于 ${rule.minLength}` };
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return { ok: false, message: `参数 ${field} 格式不正确` };
      }
      return { ok: true, value };
    }

    case 'int':
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, message: `参数 ${field} 必须是数字` };
      if (rule.type === 'int' && !Number.isInteger(n)) {
        return { ok: false, message: `参数 ${field} 必须是整数` };
      }
      if (rule.min !== undefined && n < rule.min) {
        return { ok: false, message: `参数 ${field} 不能小于 ${rule.min}` };
      }
      if (rule.max !== undefined && n > rule.max) {
        return { ok: false, message: `参数 ${field} 不能大于 ${rule.max}` };
      }
      return { ok: true, value: n };
    }

    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      const s = String(value).toLowerCase();
      if (['true', '1', 'yes'].includes(s)) return { ok: true, value: true };
      if (['false', '0', 'no'].includes(s)) return { ok: true, value: false };
      return { ok: false, message: `参数 ${field} 必须是布尔值` };
    }

    case 'array': {
      if (!Array.isArray(value)) return { ok: false, message: `参数 ${field} 必须是数组` };
      if (rule.maxItems && value.length > rule.maxItems) {
        return { ok: false, message: `参数 ${field} 最多 ${rule.maxItems} 项` };
      }
      return { ok: true, value };
    }

    case 'enum': {
      if (!rule.values.includes(value)) {
        return { ok: false, message: `参数 ${field} 只能是：${rule.values.join(' / ')}` };
      }
      return { ok: true, value };
    }

    case 'date': {
      // YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return { ok: false, message: `参数 ${field} 必须是 YYYY-MM-DD 格式` };
      }
      const d = new Date(`${value}T00:00:00+08:00`);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `参数 ${field} 不是合法日期` };
      }
      return { ok: true, value };
    }

    case 'id': {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(value))) {
        return { ok: false, message: `参数 ${field} 不是合法 ID` };
      }
      return { ok: true, value };
    }

    default:
      return { ok: true, value };
  }
}

/**
 * 校验整个对象
 * @param {object} source 原始数据（req.query / req.body）
 * @param {Record<string, FieldRule>} schema
 * @param {{label?:string}} [options]
 * @returns {object} 清洗后的数据（只含 schema 中定义的字段）
 */
function validate(source, schema, options = {}) {
  const src = source && typeof source === 'object' ? source : {};
  const out = {};
  const errors = [];

  for (const [field, rule] of Object.entries(schema)) {
    const res = checkField(src[field], rule, field);
    if (!res.ok) {
      errors.push({ field, message: res.message });
      continue;
    }
    if (res.value !== undefined) out[field] = res.value;
  }

  if (errors.length) {
    throw unprocessable(errors[0].message, { errors });
  }

  return out;
}

/**
 * 分页参数校验（带默认值与上限保护）
 * @param {object} query
 */
function validatePage(query) {
  return validate(query || {}, {
    page: { type: 'int', default: 1, min: 1 },
    pageSize: { type: 'int', default: PAGE.defaultPageSize, min: 1, max: PAGE.maxPageSize },
  });
}

/**
 * 从数组中取一页
 * @param {any[]} list
 * @param {number} page
 * @param {number} pageSize
 */
function slice(list, page, pageSize) {
  const start = (page - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

module.exports = { validate, validatePage, slice };
