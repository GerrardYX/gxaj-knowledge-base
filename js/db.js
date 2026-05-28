/**
 * db.js — IndexedDB 存储模块
 *
 * 解决 localStorage 的 5MB 限制问题：
 * - 文档内容和 Float32Array 向量数据直接存入 IndexedDB
 * - 支持几百兆的知识库数据
 * - 异步读写，不阻塞主线程 UI 渲染
 * - 对外接口与原 localStorage 方式兼容，迁移成本低
 */

const DB_CONFIG = {
  name: 'gxaj_knowledge_db',
  version: 1,
  stores: {
    documents: { keyPath: 'id', indexes: [] },
    conversations: { keyPath: 'id', indexes: ['updatedAt'] },
    settings: { keyPath: 'key', indexes: [] }
  }
};

let dbInstance = null;

/**
 * 打开/创建数据库连接
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // 创建对象仓库
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('conversations')) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;

      // 连接意外关闭时自动重置
      dbInstance.onclose = () => {
        console.warn('[DB] 数据库连接已关闭');
        dbInstance = null;
      };

      dbInstance.onerror = (event) => {
        console.error('[DB] 数据库错误:', event.target.error);
      };

      console.log('[DB] IndexedDB 已就绪:', DB_CONFIG.name);
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[DB] 无法打开数据库:', event.target.error);
      reject(event.target.error);
    };
  });
}

// ========== 通用 CRUD 操作 ==========

/**
 * 获取单条记录
 */
function get(storeName, key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * 获取某 store 的所有记录
 */
function getAll(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * 写入/更新记录（支持批量）
 */
function put(storeName, records) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      if (Array.isArray(records)) {
        records.forEach(record => store.put(record));
      } else {
        store.put(records);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/**
 * 删除记录
 */
function remove(storeName, key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/**
 * 清空某个 store
 */
function clearStore(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

/**
 * 获取记录数量
 */
function count(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}


// ========== 文档操作 API ==========

const DocsDB = {
  /**
   * 加载所有文档（启动时调用）
   * 自动恢复 Float32Array 向量
   */
  async loadAll() {
    const docs = await getAll('documents');
    return docs.map(doc => ({
      ...doc,
      chunks: (doc.chunks || []).map(c => ({
        text: c.text,
        embedding: c.embedding ? new Float32Array(c.embedding) : null
      }))
    }));
  },

  /**
   * 保存单个或多个文档
   */
  async save(docs) {
    const serializable = (Array.isArray(docs) ? docs : [docs]).map(doc => ({
      ...doc,
      chunks: doc.chunks.map(c => ({
        text: c.text,
        embedding: c.embedding ? Array.from(c.embedding) : null
      }))
    }));
    await put('documents', serializable);
  },

  /**
   * 删除指定文档
   */
  async remove(id) {
    await remove('documents', id);
  },

  /**
   * 清空所有文档
   */
  async clear() {
    await clearStore('documents');
  },

  /**
   * 获取文档总数
   */
  async count() {
    return count('documents');
  }
};


// ========== 对话历史操作 API ==========

const ConversationsDB = {
  /**
   * 加载所有对话历史
   */
  async loadAll() {
    return getAll('conversations');
  },

  /**
   * 保存/更新一条对话
   */
  async save(conversation) {
    await put('conversations', conversation);
  },

  /**
   * 删除一条对话
   */
  async remove(id) {
    await remove('conversations', id);
  },

  /**
   * 清空所有对话历史
   */
  async clear() {
    await clearStore('conversations');
  },

  /**
   * 获取对话数量
   */
  async count() {
    return count('conversations');
  }
};


// ========== 设置操作 API ==========

const SettingsDB = {
  async get(key) {
    const result = await get('settings', key);
    return result ? result.value : null;
  },

  async set(key, value) {
    await put('settings', { key, value });
  },

  async remove(key) {
    await remove('settings', key);
  }
};


// ========== 迁移工具 ==========

const MigrationDB = {
  /**
   * 从 localStorage 迁移文档到 IndexedDB
   * 首次使用新版本时自动执行
   * @returns {{migrated: boolean, docCount: number}}
   */
  async migrateDocumentsFromLocalStorage() {
    const migrationFlag = localStorage.getItem('gxaj_idb_migrated_docs');
    if (migrationFlag === '1') {
      return { migrated: false, docCount: 0 };
    }

    const raw = localStorage.getItem('gxaj_documents');
    if (!raw || raw === '[]') {
      localStorage.setItem('gxaj_idb_migrated_docs', '1');
      return { migrated: false, docCount: 0 };
    }

    try {
      const docs = JSON.parse(raw);
      if (docs.length > 0) {
        await DocsDB.save(docs);
        console.log(`[Migration] 已迁移 ${docs.length} 个文档到 IndexedDB`);

        // 清理 localStorage 中的文档数据释放空间
        localStorage.removeItem('gxaj_documents');
      }

      localStorage.setItem('gxaj_idb_migrated_docs', '1');
      return { migrated: true, docCount: docs.length };
    } catch (e) {
      console.error('[Migration] 文档迁移失败:', e);
      return { migrated: false, docCount: 0 };
    }
  },

  /**
   * 从 localStorage 迁移对话历史到 IndexedDB
   */
  async migrateConversationsFromLocalStorage() {
    const migrationFlag = localStorage.getItem('gxaj_idb_migrated_convs');
    if (migrationFlag === '1') {
      return { migrated: false, count: 0 };
    }

    const raw = localStorage.getItem('gxaj_conversations');
    if (!raw || raw === '[]') {
      localStorage.setItem('gxaj_idb_migrated_convs', '1');
      return { migrated: false, count: 0 };
    }

    try {
      const conversations = JSON.parse(raw);
      if (conversations.length > 0) {
        // 批量写入
        await put('conversations', conversations);
        console.log(`[Migration] 已迁移 ${conversations.length} 条对话到 IndexedDB`);
        localStorage.removeItem('gxaj_conversations');
      }

      localStorage.setItem('gxaj_idb_migrated_convs', '1');
      return { migrated: true, count: conversations.length };
    } catch (e) {
      console.error('[Migration] 对话迁移失败:', e);
      return { migrated: false, count: 0 };
    }
  }
};


// ========== 导出 ==========
window.DB = {
  openDB,
  DocsDB,
  ConversationsDB,
  SettingsDB,
  MigrationDB
};

console.log('[DB] IndexedDB 存储模块已加载');
