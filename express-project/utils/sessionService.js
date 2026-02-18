/**
 * Redis 会话管理服务
 * 
 * @description 将JWT令牌和会话状态存储到Redis，提供快速的会话验证
 *              Redis作为主要存储，数据库作为持久化备份
 */

const redis = require('./redis');
const { parseExpiresInToMs } = require('./jwt');
const config = require('../config/config');

// Redis key 前缀
const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';

/**
 * 获取会话在Redis中的TTL（秒）
 * @returns {number} TTL秒数
 */
function getSessionTTLSeconds() {
  const ms = parseExpiresInToMs(config.jwt.expiresIn);
  return Math.ceil(ms / 1000);
}

/**
 * 保存会话到Redis
 * @param {Object} params - 会话参数
 * @param {BigInt|number} params.userId - 用户ID
 * @param {string} params.accessToken - 访问令牌
 * @param {string} params.refreshToken - 刷新令牌
 * @param {string} params.userAgent - 用户User-Agent
 * @returns {Promise<boolean>} 是否成功
 */
async function saveSession({ userId, accessToken, refreshToken, userAgent }) {
  try {
    const ttl = getSessionTTLSeconds();
    const sessionData = {
      userId: String(userId),
      accessToken,
      refreshToken,
      userAgent: userAgent || '',
      createdAt: Date.now(),
      isActive: true
    };

    // 存储会话数据（以access_token为key）
    await redis.set(`${SESSION_PREFIX}${accessToken}`, sessionData, ttl);

    // 存储refresh_token到access_token的映射
    await redis.set(`${SESSION_PREFIX}refresh:${refreshToken}`, accessToken, ttl);

    // 将token添加到用户的会话集合中
    await redis.sadd(`${USER_SESSIONS_PREFIX}${String(userId)}`, accessToken);
    await redis.expire(`${USER_SESSIONS_PREFIX}${String(userId)}`, ttl);

    return true;
  } catch (error) {
    console.error('Redis 保存会话失败:', error.message);
    return false;
  }
}

/**
 * 验证会话是否有效（通过access_token）
 * @param {string} token - 访问令牌
 * @param {BigInt|number} userId - 用户ID
 * @returns {Promise<boolean|null>} true=有效, false=无效, null=Redis不可用(需回退DB)
 */
async function validateSession(token, userId) {
  try {
    const available = await redis.isRedisAvailable();
    if (!available) return null;

    const sessionData = await redis.get(`${SESSION_PREFIX}${token}`);
    if (!sessionData) return null; // key不存在，可能是Redis重启，回退DB

    if (!sessionData.isActive) return false;
    if (String(sessionData.userId) !== String(userId)) return false;

    return true;
  } catch (error) {
    console.error('Redis 验证会话失败:', error.message);
    return null; // 出错时回退DB
  }
}

/**
 * 使单个会话失效（登出）
 * @param {string} token - 访问令牌
 * @param {BigInt|number} userId - 用户ID
 * @returns {Promise<boolean>} 是否成功
 */
async function invalidateSession(token, userId) {
  try {
    // 获取会话数据以找到refresh_token
    const sessionData = await redis.get(`${SESSION_PREFIX}${token}`);
    if (sessionData && sessionData.refreshToken) {
      await redis.del(`${SESSION_PREFIX}refresh:${sessionData.refreshToken}`);
    }

    // 删除会话
    await redis.del(`${SESSION_PREFIX}${token}`);

    // 从用户会话集合中移除
    await redis.srem(`${USER_SESSIONS_PREFIX}${String(userId)}`, token);

    return true;
  } catch (error) {
    console.error('Redis 使会话失效失败:', error.message);
    return false;
  }
}

/**
 * 使用户所有会话失效
 * @param {BigInt|number} userId - 用户ID
 * @returns {Promise<boolean>} 是否成功
 */
async function invalidateAllUserSessions(userId) {
  try {
    const userIdStr = String(userId);
    const tokens = await redis.smembers(`${USER_SESSIONS_PREFIX}${userIdStr}`);

    for (const token of tokens) {
      const sessionData = await redis.get(`${SESSION_PREFIX}${token}`);
      if (sessionData && sessionData.refreshToken) {
        await redis.del(`${SESSION_PREFIX}refresh:${sessionData.refreshToken}`);
      }
      await redis.del(`${SESSION_PREFIX}${token}`);
    }

    // 清空用户会话集合
    await redis.del(`${USER_SESSIONS_PREFIX}${userIdStr}`);

    return true;
  } catch (error) {
    console.error('Redis 使所有会话失效失败:', error.message);
    return false;
  }
}

/**
 * 验证刷新令牌
 * @param {string} refreshToken - 刷新令牌
 * @param {BigInt|number} userId - 用户ID
 * @returns {Promise<boolean|null>} true=有效, false=无效, null=Redis不可用
 */
async function validateRefreshToken(refreshToken, userId) {
  try {
    const available = await redis.isRedisAvailable();
    if (!available) return null;

    const accessToken = await redis.get(`${SESSION_PREFIX}refresh:${refreshToken}`);
    if (!accessToken) return null; // 可能Redis重启，回退DB

    const sessionData = await redis.get(`${SESSION_PREFIX}${accessToken}`);
    if (!sessionData) return null;

    if (!sessionData.isActive) return false;
    if (String(sessionData.userId) !== String(userId)) return false;

    return true;
  } catch (error) {
    console.error('Redis 验证刷新令牌失败:', error.message);
    return null;
  }
}

/**
 * 更新会话（刷新令牌时）
 * @param {Object} params - 更新参数
 * @param {string} params.oldAccessToken - 旧访问令牌
 * @param {string} params.oldRefreshToken - 旧刷新令牌
 * @param {string} params.newAccessToken - 新访问令牌
 * @param {string} params.newRefreshToken - 新刷新令牌
 * @param {BigInt|number} params.userId - 用户ID
 * @param {string} params.userAgent - 用户User-Agent
 * @returns {Promise<boolean>} 是否成功
 */
async function refreshSession({ oldAccessToken, oldRefreshToken, newAccessToken, newRefreshToken, userId, userAgent }) {
  try {
    // 删除旧会话
    await redis.del(`${SESSION_PREFIX}${oldAccessToken}`);
    await redis.del(`${SESSION_PREFIX}refresh:${oldRefreshToken}`);

    const userIdStr = String(userId);
    await redis.srem(`${USER_SESSIONS_PREFIX}${userIdStr}`, oldAccessToken);

    // 保存新会话
    await saveSession({
      userId,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      userAgent
    });

    return true;
  } catch (error) {
    console.error('Redis 刷新会话失败:', error.message);
    return false;
  }
}

module.exports = {
  saveSession,
  validateSession,
  invalidateSession,
  invalidateAllUserSessions,
  validateRefreshToken,
  refreshSession
};
