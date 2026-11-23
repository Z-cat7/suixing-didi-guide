'use strict';

/**
 * 参数校验中间件
 * ---------------------------------------------------------------------------
 * 用法：
 *   router.get('/guides', validateQuery({ keyword: {...} }), handler);
 *   router.post('/orders', validateBody({ guideId: { type:'string', required:true } }), handler);
 * 校验结果挂到 req.valid（query）或 req.body（body，覆盖原值）。
 */

const { validate, validatePage: validatePageSchema } = require('../utils/validate');

/** 校验 query 参数，结果挂到 req.valid */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      req.valid = validate(req.query, schema);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * 分页参数校验中间件
 * 把 page / pageSize 合并进 req.valid（不覆盖已有字段）。
 * 用法：router.get('/', validateQuery({...}), validatePage(), handler)
 */
function validatePage() {
  return (req, res, next) => {
    try {
      req.valid = { ...(req.valid || {}), ...validatePageSchema(req.query) };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 校验 body 参数，结果覆盖到 req.body */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      req.body = validate(req.body, schema);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * 通用校验：一次校验 query + body，合并到 req.valid
 */
function validateInput(querySchema, bodySchema) {
  return (req, res, next) => {
    try {
      const q = querySchema ? validate(req.query, querySchema) : {};
      const b = bodySchema ? validate(req.body, bodySchema) : {};
      req.valid = { ...q, ...b };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validateQuery, validateBody, validateInput, validatePage };
