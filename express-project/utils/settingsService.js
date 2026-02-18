/**
 * Redis 通用设置字典服务
 * 
 * @author ZTMYO
 * @description 提供后台设置的 Redis 持久化存储和统一访问接口
 *              支持设置默认值、缓存和降级到内存存储
 */

const redis = require('./redis');

// Redis 设置键前缀
const SETTINGS_KEY_PREFIX = 'settings:';

// 内存缓存（当 Redis 不可用时作为降级方案）
const memoryCache = new Map();

// 默认设置值定义
const DEFAULT_SETTINGS = {
  // AI 审核相关设置
  'ai_username_review_enabled': false,  // 用户名AI审核开关
  'ai_content_review_enabled': false,   // 内容AI审核开关
  
  // 访问控制相关设置
  'guest_access_restricted': process.env.GUEST_ACCESS_RESTRICTED === 'true',     // 游客访问限制开关

  // 初始设置页面配置
  'onboarding_interest_options': JSON.stringify([
    '美食', '旅行', '摄影', '音乐', '电影',
    '阅读', '运动', '游戏', '绘画', '舞蹈',
    '编程', '设计', '时尚', '美妆', '宠物',
    '动漫', '手工', '健身', '科技', '数码'
  ]),
  // 初始设置自定义字段配置
  'onboarding_custom_fields': JSON.stringify([]),
  // 是否允许跳过初始设置页面
  'onboarding_allow_skip': true,
};

/**
 * 获取设置的完整 Redis 键
 * @param {string} key - 设置键名
 * @returns {string} 完整的 Redis 键
 */
function getRedisKey(key) {
  return `${SETTINGS_KEY_PREFIX}${key}`;
}

/**
 * 获取设置值
 * @param {string} key - 设置键名
 * @param {any} defaultValue - 默认值（可选，如果未提供则使用 DEFAULT_SETTINGS 中的值）
 * @returns {Promise<any>} 设置值
 */
async function getSetting(key, defaultValue = undefined) {
  // 确定默认值
  const fallbackDefault = defaultValue !== undefined 
    ? defaultValue 
    : (DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : null);
  
  try {
    // 尝试从 Redis 获取
    const redisAvailable = await redis.isRedisAvailable();
    if (redisAvailable) {
      const value = await redis.get(getRedisKey(key));
      if (value !== null) {
        // 同步到内存缓存
        memoryCache.set(key, value);
        return value;
      }
      // Redis 中没有值，返回默认值
      return fallbackDefault;
    }
    
    // Redis 不可用，从内存缓存获取
    if (memoryCache.has(key)) {
      return memoryCache.get(key);
    }
    return fallbackDefault;
  } catch (error) {
    console.error(`获取设置 [${key}] 失败:`, error.message);
    // 出错时从内存缓存获取
    if (memoryCache.has(key)) {
      return memoryCache.get(key);
    }
    return fallbackDefault;
  }
}

/**
 * 设置值
 * @param {string} key - 设置键名
 * @param {any} value - 设置值
 * @returns {Promise<boolean>} 是否成功
 */
async function setSetting(key, value) {
  try {
    // 同时更新内存缓存
    memoryCache.set(key, value);
    
    // 尝试持久化到 Redis
    const redisAvailable = await redis.isRedisAvailable();
    if (redisAvailable) {
      const success = await redis.set(getRedisKey(key), value);
      if (success) {
        console.log(`✓ 设置 [${key}] 已保存到 Redis: ${JSON.stringify(value)}`);
      }
      return success;
    }
    
    console.log(`⚠ Redis 不可用，设置 [${key}] 仅保存在内存中: ${JSON.stringify(value)}`);
    return true;
  } catch (error) {
    console.error(`设置 [${key}] 失败:`, error.message);
    return false;
  }
}

/**
 * 删除设置
 * @param {string} key - 设置键名
 * @returns {Promise<boolean>} 是否成功
 */
async function deleteSetting(key) {
  try {
    // 从内存缓存删除
    memoryCache.delete(key);
    
    // 从 Redis 删除
    const redisAvailable = await redis.isRedisAvailable();
    if (redisAvailable) {
      return await redis.del(getRedisKey(key));
    }
    
    return true;
  } catch (error) {
    console.error(`删除设置 [${key}] 失败:`, error.message);
    return false;
  }
}

/**
 * 获取多个设置值
 * @param {string[]} keys - 设置键名数组
 * @returns {Promise<Object>} 键值对对象
 */
async function getSettings(keys) {
  const promises = keys.map(async (key) => {
    const value = await getSetting(key);
    return { key, value };
  });
  
  const results = await Promise.all(promises);
  const result = {};
  for (const { key, value } of results) {
    result[key] = value;
  }
  
  return result;
}

/**
 * 设置多个值
 * @param {Object} settings - 键值对对象
 * @returns {Promise<boolean>} 是否全部成功
 */
async function setSettings(settings) {
  const entries = Object.entries(settings);
  const promises = entries.map(([key, value]) => setSetting(key, value));
  const results = await Promise.all(promises);
  return results.every(success => success);
}

/**
 * 获取所有设置（包含默认值）
 * @returns {Promise<Object>} 所有设置的键值对
 */
async function getAllSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS);
  return await getSettings(keys);
}

/**
 * 从 Redis 加载所有设置到内存缓存
 * 应在应用启动时调用
 * @returns {Promise<void>}
 */
async function loadSettingsFromRedis() {
  try {
    const redisAvailable = await redis.isRedisAvailable();
    if (!redisAvailable) {
      console.log('● Redis 不可用，使用默认设置');
      // 将默认设置加载到内存缓存
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        memoryCache.set(key, value);
      }
      return;
    }
    
    console.log('● 正在从 Redis 加载后台设置...');
    let loadedCount = 0;
    
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = await redis.get(getRedisKey(key));
      if (value !== null) {
        memoryCache.set(key, value);
        loadedCount++;
      } else {
        // 使用默认值
        memoryCache.set(key, DEFAULT_SETTINGS[key]);
      }
    }
    
    console.log(`● 已从 Redis 加载 ${loadedCount} 个设置`);
  } catch (error) {
    console.error('● 从 Redis 加载设置失败:', error.message);
    // 使用默认设置
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      memoryCache.set(key, value);
    }
  }
}

/**
 * 同步获取设置值（从内存缓存）
 * 用于需要同步调用的场景
 * @param {string} key - 设置键名
 * @returns {any} 设置值
 */
function getSettingSync(key) {
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  return DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : null;
}

// ===================== 便捷的访问器函数 =====================

/**
 * 检查用户名AI审核是否开启
 * @returns {boolean}
 */
function isAiUsernameReviewEnabled() {
  return Boolean(getSettingSync('ai_username_review_enabled'));
}

/**
 * 检查内容AI审核是否开启
 * @returns {boolean}
 */
function isAiContentReviewEnabled() {
  return Boolean(getSettingSync('ai_content_review_enabled'));
}

/**
 * 检查是否有任何AI审核开启（兼容旧代码）
 * @returns {boolean}
 */
function isAiAutoReviewEnabled() {
  return isAiUsernameReviewEnabled() || isAiContentReviewEnabled();
}

/**
 * 检查游客访问是否受限
 * @returns {boolean}
 */
function isGuestAccessRestricted() {
  return Boolean(getSettingSync('guest_access_restricted'));
}

/**
 * 设置用户名AI审核开关
 * @param {boolean} enabled - 是否开启
 * @returns {Promise<boolean>}
 */
async function setAiUsernameReviewEnabled(enabled) {
  return await setSetting('ai_username_review_enabled', Boolean(enabled));
}

/**
 * 设置内容AI审核开关
 * @param {boolean} enabled - 是否开启
 * @returns {Promise<boolean>}
 */
async function setAiContentReviewEnabled(enabled) {
  return await setSetting('ai_content_review_enabled', Boolean(enabled));
}

/**
 * 设置游客访问限制开关
 * @param {boolean} restricted - 是否限制
 * @returns {Promise<boolean>}
 */
async function setGuestAccessRestricted(restricted) {
  return await setSetting('guest_access_restricted', Boolean(restricted));
}

/**
 * 获取初始设置页面兴趣选项
 * @returns {string[]}
 */
function getOnboardingInterestOptions() {
  const raw = getSettingSync('onboarding_interest_options');
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 设置初始设置页面兴趣选项
 * @param {string[]} options
 * @returns {Promise<boolean>}
 */
async function setOnboardingInterestOptions(options) {
  return await setSetting('onboarding_interest_options', JSON.stringify(options));
}

/**
 * 获取初始设置自定义字段配置
 * @returns {Array} 自定义字段数组 [{name, type, options?}]
 */
function getOnboardingCustomFields() {
  const raw = getSettingSync('onboarding_custom_fields');
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 设置初始设置自定义字段配置
 * @param {Array} fields - [{name, type, options?}]
 * @returns {Promise<boolean>}
 */
async function setOnboardingCustomFields(fields) {
  return await setSetting('onboarding_custom_fields', JSON.stringify(fields));
}

/**
 * 检查是否允许跳过初始设置页面
 * @returns {boolean}
 */
function isOnboardingSkipAllowed() {
  return Boolean(getSettingSync('onboarding_allow_skip'));
}

/**
 * 设置是否允许跳过初始设置页面
 * @param {boolean} allowed
 * @returns {Promise<boolean>}
 */
async function setOnboardingAllowSkip(allowed) {
  return await setSetting('onboarding_allow_skip', Boolean(allowed));
}

module.exports = {
  // 通用设置操作
  getSetting,
  setSetting,
  deleteSetting,
  getSettings,
  setSettings,
  getAllSettings,
  loadSettingsFromRedis,
  getSettingSync,
  
  // 便捷访问器
  isAiUsernameReviewEnabled,
  isAiContentReviewEnabled,
  isAiAutoReviewEnabled,
  isGuestAccessRestricted,
  setAiUsernameReviewEnabled,
  setAiContentReviewEnabled,
  setGuestAccessRestricted,
  getOnboardingInterestOptions,
  setOnboardingInterestOptions,
  getOnboardingCustomFields,
  setOnboardingCustomFields,
  isOnboardingSkipAllowed,
  setOnboardingAllowSkip,
  
  // 常量
  DEFAULT_SETTINGS,
  SETTINGS_KEY_PREFIX,
};
