/**
 * 随行 dipi · 格式化工具
 * ---------------------------------------------------------------------------
 * 契约约束：
 *   - 金额为「整数分」，字段名以 Amount 结尾 → 本模块负责分 → 元
 *   - 时间为 ISO 8601 字符串 → 本模块负责相对时间 / 日期展示
 */

/**
 * 分 → 元（保留两位小数，去掉多余的 .00）
 * @param {number|string|null|undefined} amount 金额（分）
 * @returns {string} 形如 "120" / "120.5"
 */
function amountToYuan(amount) {
  if (amount === null || amount === undefined || amount === '') return '0';
  const n = Number(amount);
  if (!isFinite(n)) return '0';
  const yuan = n / 100;
  // 避免浮点误差（如 1200/100 = 12 而非 11.9999）
  const fixed = yuan.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/**
 * 带货币符号的金额
 * @param {number} amount 金额（分）
 * @returns {string} 形如 "¥120"
 */
function formatAmount(amount) {
  return '¥' + amountToYuan(amount);
}

/**
 * 金额 + 单位（价格单位独立字段 priceUnit）
 * @param {number} amount 金额（分）
 * @param {string} unit 价格单位枚举
 * @param {object} unitText 单位中文表
 * @returns {string} 形如 "¥120 / 小时"
 */
function formatAmountWithUnit(amount, unit, unitText) {
  const text = (unitText && unitText[unit]) || '次';
  return formatAmount(amount) + ' / ' + text;
}

/**
 * 解析 ISO 时间 → Date
 * @param {string} iso ISO 8601 字符串
 * @returns {Date|null}
 */
function parseTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 / YYYY年M月D日
 * @param {string} iso ISO 8601 字符串
 * @returns {string}
 */
function formatRelativeTime(iso) {
  const d = parseTime(iso);
  if (!d) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 0) return formatDateTime(iso);

  const minute = 60 * 1000;
  const hour = 60 * minute;

  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
  if (diff < 24 * hour) return Math.floor(diff / hour) + ' 小时前';

  // 昨天
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfToday.getTime() - dayStart.getTime()) / (24 * hour));
  if (dayDiff === 1) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (dayDiff < 7) return dayDiff + ' 天前';

  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (sameYear) return d.getMonth() + 1 + '月' + d.getDate() + '日';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/**
 * 日期时间：M月D日 HH:mm
 * @param {string} iso ISO 8601 字符串
 * @returns {string}
 */
function formatDateTime(iso) {
  const d = parseTime(iso);
  if (!d) return '';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * 完整日期时间：YYYY-MM-DD HH:mm（下单确认页用）
 * @param {string} iso ISO 8601 字符串
 * @returns {string}
 */
function formatFullDateTime(iso) {
  const d = parseTime(iso);
  if (!d) return '';
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) +
    ':' + pad(d.getMinutes())
  );
}

/**
 * 时段：HH:mm – HH:mm
 * @param {string} startIso 开始时间
 * @param {string} endIso 结束时间
 * @returns {string}
 */
function formatTimeRange(startIso, endIso) {
  const s = parseTime(startIso);
  const e = parseTime(endIso);
  if (!s) return '';
  const left = pad(s.getHours()) + ':' + pad(s.getMinutes());
  if (!e) return left;
  return left + ' – ' + pad(e.getHours()) + ':' + pad(e.getMinutes());
}

/**
 * 倒计时：mm:ss（超过 1 小时显示 h:mm:ss）
 * @param {number} ms 剩余毫秒
 * @returns {string} 形如 "14:32"
 */
function formatCountdown(ms) {
  if (!ms || ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

/**
 * 文本截断（超出加省略号）
 * @param {string} text 原文
 * @param {number} max 最大长度
 * @returns {string}
 */
function truncate(text, max) {
  if (!text) return '';
  const s = String(text);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * 数值安全解析
 * @param {any} v 任意值
 * @param {number} fallback 兜底值
 * @returns {number}
 */
function toNumber(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

/**
 * 两位补零
 * @param {number} n 数字
 * @returns {string}
 */
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = {
  amountToYuan,
  formatAmount,
  formatAmountWithUnit,
  parseTime,
  formatRelativeTime,
  formatDateTime,
  formatFullDateTime,
  formatTimeRange,
  formatCountdown,
  truncate,
  toNumber,
  pad,
};
