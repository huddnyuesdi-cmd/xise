/**
 * Redis 会话管理服务
 * 
 * @author ZTMYO
 * @description 提供用户会话的 Redis 存储和管理
 *              将会话状态从数据库迁移到 Redis
 */

const redis = require('./redis');

// Redis 会话键前缀
const SESSION_KEY_PREFIX = 'session:';
// 用户会话索引键前缀（用于按用户查找所有会话）
const USER_SESSIONS_KEY_PREFIX = 'user_sessions:';
// 所有会话 ID 的有序集合键（用于分页查询）
const ALL_SESSIONS_KEY = 'all_sessions';

// 默认会话过期时间（秒）: 7天
const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60;

// 会话 ID 计数器键
const SESSION_ID_COUNTER_KEY = 'session:id_counter';

/**
 * 生成新的会话 ID
 * @returns {Promise<number>} 新的会话 ID
 */
async function generateSessionId() {
  return await redis.incr(SESSION_ID_COUNTER_KEY);
}

/**
 * 获取会话的 Redis 键
 * @param {string} token - 访问令牌
 * @returns {string} Redis 键
 */
function getSessionKey(token) {
  return `${SESSION_KEY_PREFIX}token:${token}`;
}

/**
 * 获取会话 ID 的 Redis 键
 * @param {number|string} sessionId - 会话 ID
 * @returns {string} Redis 键
 */
function getSessionIdKey(sessionId) {
  return `${SESSION_KEY_PREFIX}id:${sessionId}`;
}

/**
 * 获取用户会话索引的 Redis 键
 * @param {number|string} userId - 用户 ID
 * @returns {string} Redis 键
 */
function getUserSessionsKey(userId) {
  return `${USER_SESSIONS_KEY_PREFIX}${userId}`;
}

/**
 * 获取刷新令牌的 Redis 键
 * @param {string} refreshToken - 刷新令牌
 * @returns {string} Redis 键
 */
function getRefreshTokenKey(refreshToken) {
  return `${SESSION_KEY_PREFIX}refresh:${refreshToken}`;
}

/**
 * 创建会话
 * @param {Object} sessionData - 会话数据
 * @param {BigInt|number|string} sessionData.user_id - 用户 ID
 * @param {string} sessionData.token - 访问令牌
 * @param {string} sessionData.refresh_token - 刷新令牌
 * @param {Date} sessionData.expires_at - 过期时间
 * @param {string} sessionData.user_agent - 用户代理
 * @param {boolean} sessionData.is_active - 是否活跃
 * @returns {Promise<Object|null>} 创建的会话对象
 */
async function createSession(sessionData) {
  try {
    const sessionId = await generateSessionId();
    const userId = String(sessionData.user_id);
    const now = new Date();
    const expiresAt = sessionData.expires_at || new Date(Date.now() + DEFAULT_SESSION_TTL * 1000);
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
    
    const session = {
      id: sessionId,
      user_id: userId,
      token: sessionData.token,
      refresh_token: sessionData.refresh_token,
      user_agent: sessionData.user_agent || '',
      is_active: sessionData.is_active !== undefined ? sessionData.is_active : true,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString()
    };

    const client = await redis.getRedisClient();
    const pipeline = client.pipeline();
    
    const serialized = JSON.stringify(session);
    
    // 存储会话（按 token 索引）
    pipeline.setex(getSessionKey(session.token), ttlSeconds, serialized);
    // 存储会话（按 ID 索引）
    pipeline.setex(getSessionIdKey(sessionId), ttlSeconds, serialized);
    // 存储刷新令牌索引
    pipeline.setex(getRefreshTokenKey(session.refresh_token), ttlSeconds, serialized);
    // 添加到用户会话集合
    pipeline.sadd(getUserSessionsKey(userId), String(sessionId));
    // 添加到全局会话有序集合（score 为创建时间戳）
    pipeline.zadd(ALL_SESSIONS_KEY, now.getTime(), String(sessionId));
    
    await pipeline.exec();
    
    return session;
  } catch (error) {
    console.error('创建会话失败:', error.message);
    return null;
  }
}

/**
 * 通过令牌查找活跃会话
 * @param {string} token - 访问令牌
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|null>} 会话对象
 */
async function findActiveSession(token, userId) {
  try {
    const session = await redis.get(getSessionKey(token));
    if (!session) return null;
    
    // 检查是否活跃且属于该用户
    if (!session.is_active) return null;
    if (String(session.user_id) !== String(userId)) return null;
    
    // 检查是否过期
    if (new Date(session.expires_at) <= new Date()) {
      // 会话已过期，清理
      await deleteSessionByToken(token);
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('查找活跃会话失败:', error.message);
    return null;
  }
}

/**
 * 通过刷新令牌查找活跃会话
 * @param {string} refreshToken - 刷新令牌
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object|null>} 会话对象
 */
async function findSessionByRefreshToken(refreshToken, userId) {
  try {
    const session = await redis.get(getRefreshTokenKey(refreshToken));
    if (!session) return null;
    
    // 检查是否活跃且属于该用户
    if (!session.is_active) return null;
    if (String(session.user_id) !== String(userId)) return null;
    
    // 检查是否过期
    if (new Date(session.expires_at) <= new Date()) {
      await deleteSessionByToken(session.token);
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('通过刷新令牌查找会话失败:', error.message);
    return null;
  }
}

/**
 * 通过 ID 查找会话
 * @param {number|string} sessionId - 会话 ID
 * @returns {Promise<Object|null>} 会话对象
 */
async function findSessionById(sessionId) {
  try {
    return await redis.get(getSessionIdKey(sessionId));
  } catch (error) {
    console.error('通过ID查找会话失败:', error.message);
    return null;
  }
}

/**
 * 更新会话
 * @param {number|string} sessionId - 会话 ID
 * @param {Object} updateData - 更新数据
 * @returns {Promise<boolean>} 是否成功
 */
async function updateSession(sessionId, updateData) {
  try {
    const session = await findSessionById(sessionId);
    if (!session) return false;
    
    const oldToken = session.token;
    const oldRefreshToken = session.refresh_token;
    
    // 合并更新数据
    const updatedSession = { ...session, ...updateData };
    
    const expiresAt = new Date(updatedSession.expires_at);
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    
    const client = await redis.getRedisClient();
    const pipeline = client.pipeline();
    const serialized = JSON.stringify(updatedSession);
    
    // 如果 token 变了，删除旧的 token 索引
    if (updateData.token && updateData.token !== oldToken) {
      pipeline.del(getSessionKey(oldToken));
    }
    // 如果刷新令牌变了，删除旧的刷新令牌索引
    if (updateData.refresh_token && updateData.refresh_token !== oldRefreshToken) {
      pipeline.del(getRefreshTokenKey(oldRefreshToken));
    }
    
    // 更新所有索引
    pipeline.setex(getSessionKey(updatedSession.token), ttlSeconds, serialized);
    pipeline.setex(getSessionIdKey(sessionId), ttlSeconds, serialized);
    pipeline.setex(getRefreshTokenKey(updatedSession.refresh_token), ttlSeconds, serialized);
    
    await pipeline.exec();
    
    return true;
  } catch (error) {
    console.error('更新会话失败:', error.message);
    return false;
  }
}

/**
 * 通过令牌使会话失效（设为非活跃）
 * @param {string} token - 访问令牌
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<boolean>} 是否成功
 */
async function deactivateSessionByToken(token, userId) {
  try {
    const session = await redis.get(getSessionKey(token));
    if (!session) return false;
    if (String(session.user_id) !== String(userId)) return false;
    
    // 直接删除会话（失效即删除）
    await deleteSessionByToken(token);
    return true;
  } catch (error) {
    console.error('使会话失效失败:', error.message);
    return false;
  }
}

/**
 * 使用户的所有会话失效
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<boolean>} 是否成功
 */
async function deactivateAllUserSessions(userId) {
  try {
    const userSessionsKey = getUserSessionsKey(String(userId));
    const client = await redis.getRedisClient();
    const sessionIds = await client.smembers(userSessionsKey);
    
    if (sessionIds.length === 0) return true;
    
    const pipeline = client.pipeline();
    
    for (const sid of sessionIds) {
      const session = await redis.get(getSessionIdKey(sid));
      if (session) {
        pipeline.del(getSessionKey(session.token));
        pipeline.del(getRefreshTokenKey(session.refresh_token));
        pipeline.del(getSessionIdKey(sid));
        pipeline.zrem(ALL_SESSIONS_KEY, String(sid));
      }
    }
    
    // 清空用户会话集合
    pipeline.del(userSessionsKey);
    
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('使所有用户会话失效失败:', error.message);
    return false;
  }
}

/**
 * 通过令牌删除会话
 * @param {string} token - 访问令牌
 * @returns {Promise<boolean>} 是否成功
 */
async function deleteSessionByToken(token) {
  try {
    const session = await redis.get(getSessionKey(token));
    if (!session) return false;
    
    const client = await redis.getRedisClient();
    const pipeline = client.pipeline();
    
    pipeline.del(getSessionKey(token));
    pipeline.del(getSessionIdKey(session.id));
    pipeline.del(getRefreshTokenKey(session.refresh_token));
    pipeline.srem(getUserSessionsKey(String(session.user_id)), String(session.id));
    pipeline.zrem(ALL_SESSIONS_KEY, String(session.id));
    
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('删除会话失败:', error.message);
    return false;
  }
}

/**
 * 通过 ID 删除会话
 * @param {number|string} sessionId - 会话 ID
 * @returns {Promise<boolean>} 是否成功
 */
async function deleteSessionById(sessionId) {
  try {
    const session = await findSessionById(sessionId);
    if (!session) return false;
    
    const client = await redis.getRedisClient();
    const pipeline = client.pipeline();
    
    pipeline.del(getSessionKey(session.token));
    pipeline.del(getSessionIdKey(sessionId));
    pipeline.del(getRefreshTokenKey(session.refresh_token));
    pipeline.srem(getUserSessionsKey(String(session.user_id)), String(sessionId));
    pipeline.zrem(ALL_SESSIONS_KEY, String(sessionId));
    
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('通过ID删除会话失败:', error.message);
    return false;
  }
}

/**
 * 批量删除会话
 * @param {Array<number|string>} sessionIds - 会话 ID 列表
 * @returns {Promise<number>} 成功删除的数量
 */
async function deleteSessionsByIds(sessionIds) {
  let deletedCount = 0;
  for (const sid of sessionIds) {
    const success = await deleteSessionById(sid);
    if (success) deletedCount++;
  }
  return deletedCount;
}

/**
 * 获取会话列表（分页，支持过滤）
 * @param {Object} options - 查询选项
 * @param {number} options.page - 页码
 * @param {number} options.limit - 每页数量
 * @param {string} options.user_display_id - 用户汐社号过滤
 * @param {boolean} options.is_active - 活跃状态过滤
 * @param {string} options.sortField - 排序字段
 * @param {string} options.sortOrder - 排序方向
 * @param {Function} options.getUserInfo - 获取用户信息的函数
 * @returns {Promise<{sessions: Array, total: number}>}
 */
async function listSessions({ page = 1, limit = 20, user_display_id, is_active, sortField = 'created_at', sortOrder = 'desc', getUserInfo }) {
  try {
    const client = await redis.getRedisClient();
    
    // 获取所有会话 ID（从有序集合中）
    const allSessionIds = await client.zrange(ALL_SESSIONS_KEY, 0, -1);
    
    // 获取所有会话详情
    let sessions = [];
    for (const sid of allSessionIds) {
      const session = await redis.get(getSessionIdKey(sid));
      if (session) {
        sessions.push(session);
      } else {
        // 清理不存在的会话引用
        await client.zrem(ALL_SESSIONS_KEY, sid);
      }
    }
    
    // 应用过滤
    if (is_active !== undefined) {
      sessions = sessions.filter(s => s.is_active === is_active);
    }
    
    // 如果需要按用户汐社号过滤，需要获取用户信息
    if (user_display_id && getUserInfo) {
      const filteredSessions = [];
      for (const session of sessions) {
        const userInfo = await getUserInfo(session.user_id);
        if (userInfo && userInfo.user_id && userInfo.user_id.includes(user_display_id)) {
          session._userInfo = userInfo;
          filteredSessions.push(session);
        }
      }
      sessions = filteredSessions;
    }
    
    // 排序
    sessions.sort((a, b) => {
      let aVal, bVal;
      if (sortField === 'created_at' || sortField === 'expires_at') {
        aVal = new Date(a[sortField]).getTime();
        bVal = new Date(b[sortField]).getTime();
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }
      
      if (sortOrder === 'desc') {
        return bVal - aVal;
      }
      return aVal - bVal;
    });
    
    const total = sessions.length;
    
    // 分页
    const skip = (page - 1) * limit;
    const paginatedSessions = sessions.slice(skip, skip + limit);
    
    return { sessions: paginatedSessions, total };
  } catch (error) {
    console.error('获取会话列表失败:', error.message);
    return { sessions: [], total: 0 };
  }
}

module.exports = {
  createSession,
  findActiveSession,
  findSessionByRefreshToken,
  findSessionById,
  updateSession,
  deactivateSessionByToken,
  deactivateAllUserSessions,
  deleteSessionByToken,
  deleteSessionById,
  deleteSessionsByIds,
  listSessions,
  SESSION_KEY_PREFIX,
  DEFAULT_SESSION_TTL
};
