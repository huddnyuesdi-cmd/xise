/**
 * 汐社校园图文社区 - 应用配置文件
 * 集中管理所有配置项
 * 
 * @author ZTMYO
 * @github https://github.com/ZTMYO
 * @description Express应用的核心配置管理
 * @version v1.3.0
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * 将大小字符串转换为字节数
 * @param {string|number} sizeStr - 大小字符串 (如 "100mb", "50MB") 或数字
 * @returns {number} 字节数
 */
function parseSizeToBytes(sizeStr) {
  const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
  
  if (typeof sizeStr === 'number') {
    return sizeStr;
  }
  
  if (typeof sizeStr !== 'string') {
    return DEFAULT_MAX_SIZE_BYTES;
  }
  
  const units = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024
  };
  
  const match = sizeStr.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) {
    return DEFAULT_MAX_SIZE_BYTES;
  }
  
  const value = parseFloat(match[1]);
  const unit = match[2] || 'b';
  
  return Math.floor(value * units[unit]);
}

const config = {
  // 服务器配置
  server: {
    port: process.env.PORT || 3001,
    env: process.env.NODE_ENV || 'development'
  },

  // JWT配置
  jwt: {
    secret: process.env.JWT_SECRET || 'xiaoshiliu_secret_key_2025',
    expiresIn: process.env.JWT_EXPIRES_IN || '15d',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
  },

  // 数据库配置
  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'xiaoshiliu',
    port: process.env.DB_PORT || 3306,
    charset: 'utf8mb4',
    timezone: '+08:00'
  },

  // 上传配置
  upload: {
    // 图片上传配置
    image: {
      maxSize: process.env.IMAGE_MAX_SIZE || '10mb',
      allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      // 图片上传策略配置
      strategy: process.env.IMAGE_UPLOAD_STRATEGY || 'imagehost', // 'local', 'imagehost' 或 'r2'
      // 本地存储配置
      local: {
        uploadDir: process.env.IMAGE_LOCAL_UPLOAD_DIR || 'uploads/images',
        baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001'
      },
      // 第三方图床配置
      imagehost: {
        apiUrl: process.env.IMAGEHOST_API_URL || 'https://api.xinyew.cn/api/jdtc',
        timeout: parseInt(process.env.IMAGEHOST_TIMEOUT) || 60000
      },
      // Cloudflare R2配置
      r2: {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        endpoint: process.env.R2_ENDPOINT,
        publicUrl: process.env.R2_PUBLIC_URL, // 可选：自定义域名
        region: process.env.R2_REGION || 'auto'
      }
    },
    // 视频上传配置
    video: {
      maxSize: process.env.VIDEO_MAX_SIZE || '100mb',
      maxSizeBytes: parseSizeToBytes(process.env.VIDEO_MAX_SIZE || '100mb'),
      allowedTypes: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv', 'video/webm'],
      // 视频上传策略配置（只支持本地和R2，不支持第三方图床）
      strategy: process.env.VIDEO_UPLOAD_STRATEGY || 'local', // 'local' 或 'r2'
      // 本地存储配置
      local: {
        uploadDir: process.env.VIDEO_LOCAL_UPLOAD_DIR || 'uploads/videos',
        baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001'
      },
      // Cloudflare R2配置
      r2: {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        endpoint: process.env.R2_ENDPOINT,
        publicUrl: process.env.R2_PUBLIC_URL, // 可选：自定义域名
        region: process.env.R2_REGION || 'auto'
      },
      // 分片上传配置
      chunk: {
        // 分片临时存储目录
        tempDir: process.env.VIDEO_CHUNK_TEMP_DIR || 'uploads/chunks',
        // 分片大小（字节），默认3MB
        chunkSize: parseInt(process.env.VIDEO_CHUNK_SIZE) || 3 * 1024 * 1024,
        // 分片自动清理间隔（毫秒），默认30分钟
        cleanupInterval: parseInt(process.env.VIDEO_CHUNK_CLEANUP_INTERVAL) || 30 * 60 * 1000,
        // 分片过期时间（毫秒），默认2小时
        expireTime: parseInt(process.env.VIDEO_CHUNK_EXPIRE_TIME) || 2 * 60 * 60 * 1000
      }
    },
    // 附件上传配置
    attachment: {
      maxSize: process.env.ATTACHMENT_MAX_SIZE || '50mb',
      maxSizeBytes: parseSizeToBytes(process.env.ATTACHMENT_MAX_SIZE || '50mb'),
      allowedTypes: [
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/gzip',
        'application/x-tar',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain'
      ],
      // 附件上传策略配置
      strategy: process.env.ATTACHMENT_UPLOAD_STRATEGY || 'local', // 'local' 或 'r2'
      // 本地存储配置
      local: {
        uploadDir: process.env.ATTACHMENT_LOCAL_UPLOAD_DIR || 'uploads/attachments',
        baseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001'
      }
    }
  },

  // WebP图片优化配置
  webp: {
    // 是否启用WebP转换
    enableConversion: process.env.WEBP_ENABLE_CONVERSION !== 'false', // 默认启用
    // WebP质量 (1-100)
    quality: parseInt(process.env.WEBP_QUALITY) || 85,
    // 是否转换JPEG图片
    convertJpeg: process.env.WEBP_CONVERT_JPEG !== 'false',
    // 是否转换PNG图片
    convertPng: process.env.WEBP_CONVERT_PNG !== 'false',
    // 是否保留原图
    keepOriginal: process.env.WEBP_KEEP_ORIGINAL === 'true',
    // 最大宽度 (留空表示不限制)
    maxWidth: process.env.WEBP_MAX_WIDTH ? parseInt(process.env.WEBP_MAX_WIDTH) : null,
    // 最大高度 (留空表示不限制)
    maxHeight: process.env.WEBP_MAX_HEIGHT ? parseInt(process.env.WEBP_MAX_HEIGHT) : null,
    // 是否使用无损压缩
    lossless: process.env.WEBP_LOSSLESS === 'true',
    // 透明度质量 (0-100)
    alphaQuality: parseInt(process.env.WEBP_ALPHA_QUALITY) || 100,
    
    // 水印设置
    watermark: {
      // 是否启用水印
      enabled: process.env.WATERMARK_ENABLED === 'true',
      // 水印类型: 'text' 或 'image'
      type: process.env.WATERMARK_TYPE || 'text',
      // 水印文字 (支持@username占位符)
      text: process.env.WATERMARK_TEXT || '',
      // 字体大小
      fontSize: parseInt(process.env.WATERMARK_FONT_SIZE) || 24,
      // 字体路径 (可选，用于支持中文字体)
      fontPath: process.env.WATERMARK_FONT_PATH || null,
      // 水印图片路径 (当type为image时使用)
      imagePath: process.env.WATERMARK_IMAGE_PATH || null,
      // 水印透明度 (0-100)
      opacity: parseInt(process.env.WATERMARK_OPACITY) || 50,
      // 水印位置 (九宫格: 1-9, 1=左上, 5=中心, 9=右下)
      position: process.env.WATERMARK_POSITION || '9',
      // 定位模式: 'grid' 或 'precise'
      positionMode: process.env.WATERMARK_POSITION_MODE || 'grid',
      // 精确X坐标 (当positionMode为precise时使用)
      preciseX: parseInt(process.env.WATERMARK_PRECISE_X) || 0,
      // 精确Y坐标 (当positionMode为precise时使用)
      preciseY: parseInt(process.env.WATERMARK_PRECISE_Y) || 0,
      // 图片水印比例 (1-10, 表示水印占原图较小边的10%-100%)
      imageRatio: parseInt(process.env.WATERMARK_IMAGE_RATIO) || 4,
      // 水印平铺模式 (true=平铺, false=单个)
      tileMode: process.env.WATERMARK_TILE_MODE === 'true',
      // 水印颜色 (hex格式)
      color: process.env.WATERMARK_COLOR || '#ffffff'
    },
    
    // 用户名水印设置 (独立于主水印)
    usernameWatermark: {
      // 是否启用用户名水印
      enabled: process.env.USERNAME_WATERMARK_ENABLED === 'true',
      // 字体大小
      fontSize: parseInt(process.env.USERNAME_WATERMARK_FONT_SIZE) || 20,
      // 字体路径
      fontPath: process.env.USERNAME_WATERMARK_FONT_PATH || null,
      // 透明度 (0-100)
      opacity: parseInt(process.env.USERNAME_WATERMARK_OPACITY) || 70,
      // 位置 (九宫格: 1-9)
      position: process.env.USERNAME_WATERMARK_POSITION || '7',
      // 定位模式
      positionMode: process.env.USERNAME_WATERMARK_POSITION_MODE || 'grid',
      // 精确X坐标
      preciseX: parseInt(process.env.USERNAME_WATERMARK_PRECISE_X) || 20,
      // 精确Y坐标
      preciseY: parseInt(process.env.USERNAME_WATERMARK_PRECISE_Y) || 20,
      // 颜色
      color: process.env.USERNAME_WATERMARK_COLOR || '#ffffff',
      // 自定义文本 (支持@username占位符)
      text: process.env.USERNAME_WATERMARK_TEXT || '@username'
    }
  },

  // 视频转码配置
  videoTranscoding: {
    // 是否启用视频转码
    enabled: process.env.VIDEO_TRANSCODING_ENABLED === 'true',
    // FFmpeg可执行文件路径
    ffmpegPath: process.env.FFMPEG_PATH || '/app/bin/ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || '/app/bin/ffprobe',
    // 转码最大线程数 (避免资源占用过多)
    maxThreads: (() => {
      const threads = Number.parseInt(process.env.VIDEO_TRANSCODING_MAX_THREADS, 10);
      return (threads > 0) ? threads : 4;
    })(),
    // 转码队列最大并发数 (避免过多任务同时运行)
    maxConcurrentTasks: (() => {
      const concurrent = Number.parseInt(process.env.VIDEO_TRANSCODING_MAX_CONCURRENT, 10);
      return (concurrent > 0) ? concurrent : 2;
    })(),
    // DASH转码输出目录格式
    outputFormat: process.env.VIDEO_DASH_OUTPUT_FORMAT || '{date}/{userId}/{timestamp}',
    // DASH配置
    dash: {
      // 分片时长（秒）
      segmentDuration: parseInt(process.env.DASH_SEGMENT_DURATION) || 4,
      // 最小码率 (kbps)
      minBitrate: parseInt(process.env.DASH_MIN_BITRATE) || 500,
      // 最大码率 (kbps)
      maxBitrate: parseInt(process.env.DASH_MAX_BITRATE) || 5000,
      // 原始视频最大码率 (kbps) - 对原始视频进行压缩时使用
      originalMaxBitrate: parseInt(process.env.ORIGINAL_VIDEO_MAX_BITRATE) || 8000,
      // 支持的分辨率配置（解析环境变量）
      resolutions: (process.env.DASH_RESOLUTIONS || '1920x1080:5000,1280x720:2500,854x480:1000,640x360:750')
        .split(',')
        .map(r => {
          const [resolution, bitrate] = r.trim().split(':');
          const [width, height] = resolution.split('x').map(n => parseInt(n));
          return { width, height, bitrate: parseInt(bitrate) };
        })
    },
    // 是否删除原始视频文件
    deleteOriginal: process.env.DELETE_ORIGINAL_VIDEO === 'true',
    // FFmpeg 高级优化参数
    ffmpeg: {
      // 编码预设 (速度vs质量)
      preset: process.env.FFMPEG_PRESET || 'medium',
      // 编码配置
      profile: process.env.FFMPEG_PROFILE || 'main',
      // CRF值 (恒定质量模式) - 验证范围10-51
      crf: (() => {
        if (!process.env.FFMPEG_CRF) return null;
        const crf = parseInt(process.env.FFMPEG_CRF);
        if (isNaN(crf) || crf < 10 || crf > 51) {
          console.warn(`⚠️ 无效的 FFMPEG_CRF 值: ${process.env.FFMPEG_CRF}，有效范围10-51，将使用 VBR 模式`);
          return null;
        }
        return crf;
      })(),
      // GOP大小 (关键帧间隔)
      gopSize: process.env.FFMPEG_GOP_SIZE ? parseInt(process.env.FFMPEG_GOP_SIZE) : null,
      // B帧数量
      bFrames: process.env.FFMPEG_B_FRAMES ? parseInt(process.env.FFMPEG_B_FRAMES) : null,
      // 参考帧数量
      refFrames: process.env.FFMPEG_REF_FRAMES ? parseInt(process.env.FFMPEG_REF_FRAMES) : null,
      // 编码复杂度 (VP9/AV1)
      complexity: process.env.FFMPEG_COMPLEXITY ? parseInt(process.env.FFMPEG_COMPLEXITY) : null,
      // 音频编码码率 (kbps)
      audioBitrate: parseInt(process.env.FFMPEG_AUDIO_BITRATE) || 128,
      // 音频采样率 (Hz)
      audioSampleRate: parseInt(process.env.FFMPEG_AUDIO_SAMPLE_RATE) || 48000,
      // 像素格式
      pixelFormat: process.env.FFMPEG_PIXEL_FORMAT || 'yuv420p',
      // 硬件加速
      hardwareAccel: process.env.FFMPEG_HARDWARE_ACCEL === 'true',
      // 硬件加速类型
      hardwareAccelType: process.env.FFMPEG_HARDWARE_ACCEL_TYPE || ''
    }
  },

  // API配置
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
    timeout: 30000
  },

  // 分页配置
  pagination: {
    defaultLimit: 20,
    maxLimit: 100
  },

  // 缓存配置
  cache: {
    ttl: 300 // 5分钟
  },

  // 邮件服务配置
  email: {
    // 是否启用邮件功能
    enabled: process.env.EMAIL_ENABLED === 'true', // 默认不启用
    // SMTP服务器配置
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.qq.com',
      port: parseInt(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE === 'false' ? false : true, // 默认使用SSL
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || ''
      }
    },
    // 发件人配置
    from: {
      email: process.env.EMAIL_FROM || '',
      name: process.env.EMAIL_FROM_NAME || '汐社校园图文社区'
    }
  },

  // 通知渠道配置
  notificationChannels: {
    // 是否启用通知邮件推送（评论、回复、@提及、关注者发帖等）
    emailEnabled: process.env.NOTIFICATION_EMAIL_ENABLED === 'true',
    // 系统通知/活动通知是否发送邮件
    systemEmailEnabled: process.env.SYSTEM_NOTIFICATION_EMAIL_ENABLED === 'true',
    // Discord Webhook配置
    discord: {
      enabled: process.env.DISCORD_WEBHOOK_ENABLED === 'true',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      siteName: process.env.DISCORD_SITE_NAME || '汐社校园图文社区',
      siteUrl: process.env.DISCORD_SITE_URL || 'http://localhost:5173'
    }
  },

  // OAuth2 登录配置
  oauth2: {
    // 是否启用OAuth2登录
    enabled: process.env.OAUTH2_ENABLED === 'true', // 默认不启用
    // 是否仅允许OAuth2登录（禁用传统登录/注册）
    onlyOAuth2: process.env.OAUTH2_ONLY_LOGIN === 'true', // 默认允许传统登录
    // OAuth2服务器地址
    loginUrl: process.env.OAUTH2_LOGIN_URL || '',
    // OAuth2 Client ID（从管理后台获取的API令牌）
    clientId: process.env.OAUTH2_CLIENT_ID || '',
    // OAuth2回调地址（本站回调路径）
    callbackPath: '/api/auth/oauth2/callback'
  },

  // 余额中心配置
  balanceCenter: {
    // 是否启用余额中心功能
    enabled: process.env.BALANCE_CENTER_ENABLED === 'true', // 默认不启用
    // 外部用户中心API地址
    apiUrl: process.env.BALANCE_API_URL || 'https://user.yuelk.com',
    // API密钥
    apiKey: process.env.BALANCE_API_KEY || '',
    // 兑入比例：1本站积分 = exchangeRateIn 用户中心余额
    exchangeRateIn: parseFloat(process.env.BALANCE_EXCHANGE_RATE_IN) || 1.0,
    // 兑出比例：1用户中心余额 = exchangeRateOut 本站积分
    exchangeRateOut: parseFloat(process.env.BALANCE_EXCHANGE_RATE_OUT) || 1.0
  },

  // 创作者中心配置
  creatorCenter: {
    // 平台抽成比例 (0.1 = 10%)
    platformFeeRate: parseFloat(process.env.CREATOR_PLATFORM_FEE_RATE) || 0.10,
    // 是否允许提现到石榴点
    withdrawEnabled: process.env.CREATOR_WITHDRAW_ENABLED === 'true',
    // 最低提现金额
    minWithdrawAmount: parseFloat(process.env.CREATOR_MIN_WITHDRAW_AMOUNT) || 10,
    // 是否启用扩展收益计算（基于浏览、互动等）
    extendedEarningsEnabled: process.env.CREATOR_EXTENDED_EARNINGS_ENABLED === 'true',
    // 扩展收益计算配置
    earningsRates: {
      // 每次浏览获得的收益（石榴点）
      perView: parseFloat(process.env.CREATOR_EARNINGS_PER_VIEW) || 0.01,
      // 每次点赞获得的收益（石榴点）
      perLike: parseFloat(process.env.CREATOR_EARNINGS_PER_LIKE) || 0.05,
      // 每次收藏获得的收益（石榴点）
      perCollect: parseFloat(process.env.CREATOR_EARNINGS_PER_COLLECT) || 0.10,
      // 每次评论获得的收益（石榴点）
      perComment: parseFloat(process.env.CREATOR_EARNINGS_PER_COMMENT) || 0.02,
      // 每位新粉丝获得的收益（石榴点）
      perFollower: parseFloat(process.env.CREATOR_EARNINGS_PER_FOLLOWER) || 0.20
    },
    // 每日最大扩展收益上限（0表示无上限）
    dailyExtendedEarningsCap: parseFloat(process.env.CREATOR_DAILY_EXTENDED_EARNINGS_CAP) || 0
  },

  // 内容审核配置
  contentAudit: {
    // 是否启用内容审核
    enabled: process.env.CONTENT_AUDIT_ENABLED === 'true', // 默认不启用
    // Dify API地址
    apiUrl: process.env.DIFY_API_URL || 'http://aish.yuelk.com/v1/chat-messages',
    // Dify API密钥
    apiKey: process.env.DIFY_API_KEY || ''
  },

  // Redis 队列配置
  queue: {
    // 是否启用异步队列
    enabled: process.env.QUEUE_ENABLED === 'true', // 默认不启用
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0
    }
  },

  // 极验验证码 (GeetestV4) 配置
  geetest: {
    // 是否启用极验验证码
    enabled: process.env.GEETEST_ENABLED === 'true', // 默认不启用
    // 验证码ID
    captchaId: process.env.GEETEST_CAPTCHA_ID || '',
    // 验证码密钥（用于服务端签名）
    captchaKey: process.env.GEETEST_CAPTCHA_KEY || '',
    // 极验API服务器地址
    apiServer: 'https://gcaptcha4.geetest.com'
  },

  // 认证申请配置
  verification: {
    // 是否收集敏感信息（真实姓名、身份证号、机构名称、信用代码、联系人、联系电话）
    collectSensitiveInfo: process.env.VERIFICATION_COLLECT_SENSITIVE_INFO === 'true' // 默认不收集
  }
};

// 数据库连接池配置
const dbConfig = {
  ...config.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 导入 Prisma Client
const prisma = require('../utils/prisma');

module.exports = {
  ...config,
  pool,
  prisma
};