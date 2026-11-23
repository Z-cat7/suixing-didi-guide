'use strict';

/**
 * 金额与时间工具
 * ---------------------------------------------------------------------------
 * 【契约收敛】金额一律整数分，字段名以 Amount 结尾；
 * 服务端内部也全程用分计算，避免浮点误差。
 * 时间一律 ISO8601 带时区（+08:00）。
 */

/** 元 → 分（仅用于种子数据录入，接口出参不用） */
function yuanToCents(yuan) {
  return Math.round((Number(yuan) || 0) * 100);
}

/** 分 → 元（仅用于日志/调试展示，接口出参不用） */
function centsToYuan(cents) {
  return (Number(cents) || 0) / 100;
}

/**
 * 按比例计算优惠（分）
 * @param {number} cents 基数（分）
 * @param {number} rate 折扣比例（0.1 = 9 折）
 * @returns {number} 优惠金额（分，整数）
 */
function discountOf(cents, rate) {
  return Math.round((Number(cents) || 0) * rate);
}

/** ISO 时间 → 北京时间偏移的 ISO8601 字符串（+08:00） */
function toCstIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const offset = 8 * 60 * 60 * 1000;
  const t = new Date(d.getTime() + offset);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
    + `T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}+08:00`;
}

/** 当前北京时间 ISO8601 字符串 */
function nowCst() {
  return toCstIso(new Date().toISOString());
}

/** ISO 时间加小时数（返回 +08:00 字符串） */
function addHoursIso(iso, hours) {
  const base = new Date(iso).getTime();
  if (Number.isNaN(base)) return null;
  return toCstIso(new Date(base + hours * 3600 * 1000).toISOString());
}

module.exports = {
  yuanToCents,
  centsToYuan,
  discountOf,
  toCstIso,
  nowCst,
  addHoursIso,
};
