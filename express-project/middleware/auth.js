const { verifyToken, extractTokenFromHeader } = require('../utils/jwt');
const { prisma } = require('../config/config');
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants');
const { isGuestAccessRestricted } = require('../utils/settingsService');
const { validateSession } = require('../utils/sessionService');

/**
 * 认证中间件 - 验证JWT token
 * 优先从Redis验证会话，Redis不可用时回退到数据库
 */
async function authenticateToken(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '访问令牌缺失'
      });
    }

    // 验证token
    const decoded = verifyToken(token);

    // 检查是否为管理员token
    if (decoded.type === 'admin') {
      // 管理员token验证
      const admin = await prisma.admin.findUnique({
        where: { id: BigInt(decoded.adminId) },
        select: { id: true, username: true }
      });

      if (!admin) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '管理员不存在'
        });
      }

      // 将管理员信息添加到请求对象
      req.user = {
        id: admin.id,
        username: admin.username,
        type: 'admin',
        adminId: decoded.adminId
      };
      req.token = token;

      return next();
    } else {
      // 普通用户token验证
      if (!decoded.userId) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '无效的访问令牌'
        });
      }

      // 检查用户是否存在且活跃
      const user = await prisma.user.findFirst({
        where: {
          id: BigInt(decoded.userId),
          is_active: true
        },
        select: {
          id: true,
          user_id: true,
          xise_id: true,
          nickname: true,
          avatar: true,
          is_active: true
        }
      });

      if (!user) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '用户不存在或已被禁用'
        });
      }

      // 优先从Redis验证会话
      const redisResult = await validateSession(token, decoded.userId);

      if (redisResult === true) {
        // Redis验证通过
        req.user = user;
        req.token = token;
        return next();
      } else if (redisResult === false) {
        // Redis明确标记会话无效
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      // Redis不可用(null)，回退到数据库验证
      const session = await prisma.userSession.findFirst({
        where: {
          user_id: BigInt(decoded.userId),
          token: token,
          is_active: true,
          expires_at: { gt: new Date() }
        },
        select: { id: true }
      });

      if (!session) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          code: RESPONSE_CODES.UNAUTHORIZED,
          message: '会话已过期，请重新登录'
        });
      }

      // 将用户信息添加到请求对象
      req.user = user;
      req.token = token;

      return next();
    }
  } catch (error) {
    console.error('Token验证失败:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      code: RESPONSE_CODES.UNAUTHORIZED,
      message: '无效的访问令牌'
    });
  }
}

/**
 * 可选认证中间件 - 如果有token则验证，没有则跳过
 * 支持普通用户token和管理员token
 * 优先从Redis验证会话，Redis不可用时回退到数据库
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractTokenFromHeader(req);

    if (!token) {
      req.user = null;
      return next();
    }

    // 验证token
    const decoded = verifyToken(token);

    // 检查是否为管理员token
    if (decoded.type === 'admin') {
      // 管理员token验证
      const admin = await prisma.admin.findUnique({
        where: { id: BigInt(decoded.adminId) },
        select: { id: true, username: true }
      });

      if (admin) {
        // 将管理员信息添加到请求对象
        req.user = {
          id: admin.id,
          username: admin.username,
          type: 'admin',
          adminId: decoded.adminId
        };
        req.token = token;
      } else {
        req.user = null;
      }
      return next();
    }

    // 普通用户token验证
    if (!decoded.userId) {
      req.user = null;
      return next();
    }

    // 检查用户是否存在且活跃
    const user = await prisma.user.findFirst({
      where: {
        id: BigInt(decoded.userId),
        is_active: true
      },
      select: {
        id: true,
        user_id: true,
        xise_id: true,
        nickname: true,
        avatar: true,
        is_active: true
      }
    });

    if (user) {
      // 优先从Redis验证会话
      const redisResult = await validateSession(token, decoded.userId);

      if (redisResult === true) {
        // Redis验证通过
        req.user = user;
        req.token = token;
      } else if (redisResult === false) {
        // Redis明确标记无效
        req.user = null;
      } else {
        // Redis不可用(null)，回退到数据库验证
        const session = await prisma.userSession.findFirst({
          where: {
            user_id: BigInt(decoded.userId),
            token: token,
            is_active: true,
            expires_at: { gt: new Date() }
          },
          select: { id: true }
        });

        if (session) {
          req.user = user;
          req.token = token;
        } else {
          req.user = null;
        }
      }
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // 如果token无效，设置user为null继续执行
    req.user = null;
    next();
  }
}

/**
 * 游客访问限制中间件
 * 当后台启用游客访问限制时，未登录用户无法访问内容相关接口
 * 此中间件应在 optionalAuth 之后使用
 */
async function requireAuthIfGuestRestricted(req, res, next) {
  try {
    // 检查是否启用了游客访问限制
    const restricted = isGuestAccessRestricted();
    
    if (restricted && !req.user) {
      // 游客访问受限且用户未登录
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        code: RESPONSE_CODES.UNAUTHORIZED,
        message: '请登录后查看内容'
      });
    }
    
    // 未启用限制或用户已登录，继续处理请求
    next();
  } catch (error) {
    console.error('游客访问限制检查失败:', error);
    // 出错时不阻止访问，继续处理请求
    next();
  }
}

/**
 * 组合中间件：可选认证 + 游客访问限制检查
 * 用于需要在游客限制模式下要求登录的路由
 */
function optionalAuthWithGuestRestriction(req, res, next) {
  // 先执行 optionalAuth
  optionalAuth(req, res, (err) => {
    if (err) {
      return next(err);
    }
    // 再执行游客访问限制检查
    requireAuthIfGuestRestricted(req, res, next);
  });
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAuthIfGuestRestricted,
  optionalAuthWithGuestRestriction
};