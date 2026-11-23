'use strict';

/**
 * JSON 文件持久化封装
 * ---------------------------------------------------------------------------
 * 设计要点：
 *   1. 内存缓存 + 异步落盘：读全走内存，写入后标记 dirty 并异步落盘。
 *   2. 原子写：先写临时文件（`.tmp`），再 `rename` 覆盖目标文件。
 *      POSIX 下 rename 是原子操作，可避免进程被杀导致文件半截损坏。
 *   3. 写入串行化：所有落盘动作进入同一条 Promise 链，避免并发写互相覆盖。
 *   4. 优雅退出：进程退出前调用 `flushAll()` 确保数据落盘。
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');

/** 所有集合名称 */
const COLLECTIONS = [
  'users',
  'guides',
  'serviceItems',
  'conversations',
  'messages',
  'orders',
  'reviews',
  'notifications',
  'favorites',
  'settings',
];

class JsonStore {
  constructor(dir) {
    this.dir = dir || config.dataDir;
    /** @type {Map<string, any[]>} 内存缓存 */
    this.cache = new Map();
    /** @type {Map<string, string>} 集合名 → 索引缓存 */
    this.indexes = new Map();
    /** @type {Set<string>} 待落盘集合 */
    this.dirty = new Set();
    /** @type {Promise<void>} 落盘串行链 */
    this.writeChain = Promise.resolve();
    this._ensureDir();
  }

  /** 确保数据目录存在 */
  _ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch (err) {
      console.error(`[store] 无法创建数据目录 ${this.dir}:`, err.message);
    }
  }

  /** 集合对应的文件路径 */
  _filePath(name) {
    return path.join(this.dir, `${name}.json`);
  }

  /**
   * 读取集合（懒加载 + 内存缓存）
   * @param {string} name 集合名
   * @returns {any[]}
   */
  read(name) {
    if (this.cache.has(name)) return this.cache.get(name);

    const file = this._filePath(name);
    let data = [];
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          data = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          data = parsed.items;
        }
      } catch (err) {
        // 文件损坏：备份后以空集合启动，避免整个服务起不来
        const backup = `${file}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(file, backup);
          console.error(`[store] ${file} 解析失败，已备份至 ${backup}`);
        } catch (e) {
          console.error(`[store] 备份损坏文件失败: ${e.message}`);
        }
        data = [];
      }
    }
    this.cache.set(name, data);
    return data;
  }

  /**
   * 标记集合为 dirty（异步落盘）
   * @param {string} name
   */
  markDirty(name) {
    this.dirty.add(name);
    this._scheduleFlush();
  }

  /** 合并写入（防抖 50ms，避免高频写放大） */
  _scheduleFlush() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushAll().catch((err) => console.error('[store] 落盘失败:', err));
    }, 50);
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * 立即落盘所有 dirty 集合
   */
  flushAll() {
    this.writeChain = this.writeChain.then(() => this._writeDirty()).catch((err) => {
      console.error('[store] 落盘异常:', err);
    });
    return this.writeChain;
  }

  /** 实际执行写盘 */
  async _writeDirty() {
    if (this.dirty.size === 0) return;
    const names = Array.from(this.dirty);
    this.dirty.clear();

    for (const name of names) {
      const data = this.cache.get(name);
      if (!data) continue;
      const file = this._filePath(name);
      const tmp = `${file}.${process.pid}.tmp`;
      const json = JSON.stringify(data, null, 2);
      try {
        await fsp.writeFile(tmp, json, 'utf8');
        await fsp.rename(tmp, file); // 原子替换
      } catch (err) {
        console.error(`[store] 写入 ${file} 失败:`, err.message);
        try { await fsp.unlink(tmp); } catch (e) { /* 忽略清理失败 */ }
        this.dirty.add(name); // 保留 dirty，下一轮重试
      }
    }
  }

  /** 全量落盘（退出前调用） */
  async close() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this.flushAll();
  }

  /**
   * 按 id 查找单条
   * @param {string} name
   * @param {string} id
   */
  findById(name, id) {
    return this.read(name).find((item) => item && item.id === id) || null;
  }

  /**
   * 条件查找
   * @param {string} name
   * @param {(item:any)=>boolean} predicate
   */
  find(name, predicate) {
    return this.read(name).filter(predicate);
  }

  /**
   * 条件查找单条
   */
  findOne(name, predicate) {
    return this.read(name).find(predicate) || null;
  }

  /**
   * 插入一条记录
   * @param {string} name
   * @param {object} doc
   */
  insert(name, doc) {
    this.read(name).push(doc);
    this.markDirty(name);
    return doc;
  }

  /**
   * 批量插入
   */
  insertMany(name, docs) {
    const list = this.read(name);
    list.push(...docs);
    this.markDirty(name);
    return docs;
  }

  /**
   * 局部更新
   * @param {string} name
   * @param {string} id
   * @param {object} patch
   */
  update(name, id, patch) {
    const list = this.read(name);
    const idx = list.findIndex((item) => item && item.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
    this.markDirty(name);
    return list[idx];
  }

  /**
   * 删除
   * @param {string} name
   * @param {string} id
   */
  remove(name, id) {
    const list = this.read(name);
    const idx = list.findIndex((item) => item && item.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.markDirty(name);
    return true;
  }

  /**
   * 清空整个集合（seed 用）
   * @param {string} name
   */
  clear(name) {
    this.cache.set(name, []);
    this.markDirty(name);
  }

  /** 清空所有集合 */
  clearAll() {
    for (const name of COLLECTIONS) this.clear(name);
  }

  /**
   * 生成自增 ID（形如 usr_000001）
   * @param {string} prefix 前缀
   * @param {string} collection 集合名（用于统计）
   */
  nextId(prefix, collection) {
    const list = this.read(collection);
    let max = 0;
    for (const item of list) {
      if (!item || !item.id) continue;
      const m = /_(\d+)$/.exec(item.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const next = max + 1;
    return `${prefix}_${String(next).padStart(6, '0')}`;
  }
}

module.exports = new JsonStore(config.dataDir);
module.exports.JsonStore = JsonStore;
module.exports.COLLECTIONS = COLLECTIONS;
