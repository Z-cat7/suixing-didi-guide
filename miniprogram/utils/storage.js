/**
 * 随行 dipi · 本地存储封装
 * ---------------------------------------------------------------------------
 * 统一 key 前缀（dipi:）+ 分层（dipi:user:* / dipi:draft:* / dipi:nav:*），
 * 全部通过本模块读写，避免散落字符串。
 */
const { STORAGE_KEY } = require('./constants');

/**
 * 读取（带 JSON 反序列化）
 * @param {string} key 键
 * @param {any} fallback 默认值
 * @returns {any}
 */
function get(key, fallback) {
  try {
    const raw = wx.getStorageSync(key);
    if (raw === '' || raw === null || raw === undefined) return fallback;
    // 兼容存成对象（wx.setStorageSync 对象）的情况
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return raw;
    }
  } catch (e) {
    return fallback;
  }
}

/**
 * 写入
 * @param {string} key 键
 * @param {any} value 值（对象自动 JSON 序列化）
 * @returns {boolean}
 */
function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 删除
 * @param {string} key 键
 */
function remove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    /* 忽略 */
  }
}

/** 读取 token */
function getToken() {
  return get(STORAGE_KEY.TOKEN, '') || '';
}

/** 写入 token */
function setToken(token) {
  set(STORAGE_KEY.TOKEN, token);
}

/** 读取用户资料 */
function getProfile() {
  return get(STORAGE_KEY.PROFILE, null);
}

/** 写入用户资料 */
function setProfile(profile) {
  set(STORAGE_KEY.PROFILE, profile);
}

/** 读取当前城市 */
function getCity() {
  return get(STORAGE_KEY.CITY, '') || '';
}

/** 写入当前城市 */
function setCity(city) {
  set(STORAGE_KEY.CITY, city);
}

/** 读取下单草稿 */
function getOrderDraft() {
  return get(STORAGE_KEY.DRAFT_ORDER, null);
}

/** 写入下单草稿 */
function setOrderDraft(draft) {
  set(STORAGE_KEY.DRAFT_ORDER, draft);
}

/** 清除下单草稿 */
function clearOrderDraft() {
  remove(STORAGE_KEY.DRAFT_ORDER);
}

/**
 * 读取聊天草稿
 * @param {string} conversationId 会话 ID
 * @returns {string}
 */
function getChatDraft(conversationId) {
  return get(STORAGE_KEY.DRAFT_CHAT_PREFIX + conversationId, '') || '';
}

/**
 * 写入聊天草稿
 * @param {string} conversationId 会话 ID
 * @param {string} text 草稿内容
 */
function setChatDraft(conversationId, text) {
  if (!conversationId) return;
  const key = STORAGE_KEY.DRAFT_CHAT_PREFIX + conversationId;
  if (!text) {
    remove(key);
    return;
  }
  set(key, text);
}

/**
 * 清除聊天草稿
 * @param {string} conversationId 会话 ID
 */
function clearChatDraft(conversationId) {
  if (!conversationId) return;
  remove(STORAGE_KEY.DRAFT_CHAT_PREFIX + conversationId);
}

/**
 * 读取跨 Tab 导航包（订单页消费）
 * @returns {object|null}
 */
function getNavOrder() {
  return get(STORAGE_KEY.NAV_ORDER, null);
}

/**
 * 写入跨 Tab 导航包
 * @param {object} payload { tab, highlightOrderId }
 */
function setNavOrder(payload) {
  set(STORAGE_KEY.NAV_ORDER, payload);
}

/**
 * 消费跨 Tab 导航包（读取后立即删除，防重复消费）
 * @returns {object|null}
 */
function consumeNavOrder() {
  const v = getNavOrder();
  remove(STORAGE_KEY.NAV_ORDER);
  return v;
}

/** 读取登录后回跳信息 */
function getRedirect() {
  return get(STORAGE_KEY.REDIRECT, null);
}

/** 写入登录后回跳信息 */
function setRedirect(payload) {
  set(STORAGE_KEY.REDIRECT, payload);
}

/** 消费登录后回跳信息 */
function consumeRedirect() {
  const v = getRedirect();
  remove(STORAGE_KEY.REDIRECT);
  return v;
}

/** 读取搜索历史 */
function getSearchHistory() {
  return get(STORAGE_KEY.SEARCH_HISTORY, []) || [];
}

/**
 * 写入搜索历史（去重 + 最多 10 条）
 * @param {string} keyword 关键词
 */
function pushSearchHistory(keyword) {
  if (!keyword) return;
  const list = getSearchHistory();
  const filtered = list.filter((k) => k !== keyword);
  filtered.unshift(keyword);
  set(STORAGE_KEY.SEARCH_HISTORY, filtered.slice(0, 10));
}

/** 清空搜索历史 */
function clearSearchHistory() {
  remove(STORAGE_KEY.SEARCH_HISTORY);
}

/**
 * 幂等键：同一 key 重试复用（防重复下单）
 * @param {string} key 幂等键
 * @returns {string}
 */
function getIdempotencyKey(key) {
  return get(STORAGE_KEY.IDEM_PREFIX + key, null);
}

/**
 * 保存幂等键
 * @param {string} key 幂等键
 * @param {string} value 服务端返回的订单 ID
 */
function setIdempotencyKey(key, value) {
  set(STORAGE_KEY.IDEM_PREFIX + key, value);
}

/** 清除登录态相关存储（退出登录时调用，不清草稿） */
function clearUserStorage() {
  remove(STORAGE_KEY.TOKEN);
  remove(STORAGE_KEY.PROFILE);
}

/**
 * 清除本地缓存（清除缓存按钮用，不动登录态）
 */
function clearLocalCache() {
  clearOrderDraft();
  clearSearchHistory();
  remove(STORAGE_KEY.MESSAGE_TAB);
}

module.exports = {
  get,
  set,
  remove,
  getToken,
  setToken,
  getProfile,
  setProfile,
  getCity,
  setCity,
  getOrderDraft,
  setOrderDraft,
  clearOrderDraft,
  getChatDraft,
  setChatDraft,
  clearChatDraft,
  getNavOrder,
  setNavOrder,
  consumeNavOrder,
  getRedirect,
  setRedirect,
  consumeRedirect,
  getSearchHistory,
  pushSearchHistory,
  clearSearchHistory,
  getIdempotencyKey,
  setIdempotencyKey,
  clearUserStorage,
  clearLocalCache,
};
