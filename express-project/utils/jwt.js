const jwt = require('jsonwebtoken');
const config = require('../config/config');

// JWT配置
const { secret: JWT_SECRET, expiresIn: JWT_EXPIRES_IN, refreshExpiresIn: REFRESH_TOKEN_EXPIRES_IN } = config.jwt;

/**
 * 生成访问令牌
 * @param {Object} payload - 用户信息
 * @returns {String} JWT token
 */
function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 生成刷新令牌
 * @param {Object} payload - 用户信息
 * @returns {String} JWT refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

/**
 * 验证令牌
 * @param {String} token - JWT token
 * @returns {Object} 解码后的用户信息
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
}

/**
 * 从请求头中提取token
 * @param {Object} req - Express请求对象
 * @returns {String|null} token
 */
function extractTokenFromHeader(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

const DEFAULT_EXPIRES_MS = 15 * 24 * 60 * 60 * 1000; // 默认15天

/**
 * 将JWT过期时间字符串转换为毫秒数
 * @param {string} expiresIn - 过期时间字符串 (如 "15d", "7d", "24h", "30m", "60s")
 * @returns {number} 毫秒数
 */
function parseExpiresInToMs(expiresIn) {
  const match = String(expiresIn).match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) {
    return DEFAULT_EXPIRES_MS;
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * multipliers[unit];
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  extractTokenFromHeader,
  parseExpiresInToMs,
  JWT_SECRET,
  JWT_EXPIRES_IN
};