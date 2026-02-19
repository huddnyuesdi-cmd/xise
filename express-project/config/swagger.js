/**
 * Swagger/OpenAPI 配置
 * 完全自动生成API文档，无需手动维护
 * 
 * 采用纯自动路由扫描机制：
 * - swaggerAutoGen: 自动扫描路由源码，从实际代码中提取所有参数和路由信息
 * - 参数始终与代码保持同步，不会出现文档与实际不一致的情况
 * - 新增/修改/删除路由时，文档自动更新，无需手动维护任何注解
 */

const path = require('path');
const { scanRoutes, generateSwaggerPath, detectRouteMounts, parseAppInlineRoutes, ROUTE_TAG_MAP } = require('../utils/swaggerAutoGen');

const port = require('./config').server.port;

// 复杂路径配置（与app.js保持一致）
const JWT_TEST_TOKEN_PATH = process.env.JWT_TEST_TOKEN_PATH || 'jwt-MYQD6LuH0heYgcK5DT10Al00dj6OW8Wc';
const SWAGGER_DOCS_PATH = process.env.SWAGGER_DOCS_PATH || 'swagger-MYQD6LuH0heYgcK5DT10Al00dj6OW8Wc';

// OpenAPI 3.0 基础规范定义（无需手动维护路由文档）
const baseSpec = {
  openapi: '3.0.0',
  info: {
    title: '汐社校园图文社区 API',
    version: '2.0.0',
    description: '汐社校园图文社区后端API接口文档，支持在线调试。\n\n' +
      '## 通用说明\n' +
      '- 所有接口统一返回 JSON 格式\n' +
      '- 需要认证的接口请在请求头中携带 `Authorization: Bearer <token>`\n' +
      '- 管理员接口需要使用管理员token\n' +
      '- 分页接口支持 `page` 和 `limit` 参数\n\n' +
      '## 调试说明\n' +
      '- 🔑 打开 [JWT测试令牌页面](/api/' + JWT_TEST_TOKEN_PATH + ') 生成测试令牌\n' +
      '- 点击右侧 **Authorize** 按钮输入JWT令牌\n' +
      '- 展开接口后点击 **Try it out** 进行在线调试\n' +
      '- 带 🔒 标记的接口需要先登录获取token\n\n' +
      '## 文档生成\n' +
      '- 📋 本文档由框架自动生成，参数直接从路由代码中提取\n' +
      '- 🔄 新增/修改路由后重启服务即可自动更新文档\n' +
      '- ⚡ 无需手动维护任何API注解',
    contact: {
      name: 'ZTMYO',
      url: 'https://github.com/ZTMYO'
    },
    license: {
      name: 'GPLv3',
      url: 'https://www.gnu.org/licenses/gpl-3.0.html'
    }
  },
  servers: [
    {
      url: '/',
      description: '当前服务器（相对路径，自动适配）'
    },
    {
      url: `http://localhost:${port}`,
      description: '本地开发服务器'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '用户JWT令牌，通过登录接口获取'
      }
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 200, description: '响应码' },
          message: { type: 'string', example: 'success', description: '响应消息' },
          data: { type: 'object', description: '响应数据' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 500, description: '错误码' },
          message: { type: 'string', example: '服务器内部错误', description: '错误消息' }
        }
      },
      PaginationResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 200 },
          message: { type: 'string', example: 'success' },
          data: {
            type: 'object',
            properties: {
              list: { type: 'array', items: { type: 'object' }, description: '数据列表' },
              pagination: {
                type: 'object',
                properties: {
                  page: { type: 'integer', example: 1, description: '当前页码' },
                  limit: { type: 'integer', example: 20, description: '每页数量' },
                  total: { type: 'integer', example: 100, description: '总数' },
                  totalPages: { type: 'integer', example: 5, description: '总页数' }
                }
              }
            }
          }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1, description: '用户自增ID' },
          user_id: { type: 'string', example: 'user_001', description: '用户ID' },
          nickname: { type: 'string', example: '汐社用户', description: '昵称' },
          avatar: { type: 'string', example: 'https://example.com/avatar.jpg', description: '头像URL' },
          bio: { type: 'string', example: '这是个人简介', description: '个人简介' },
          location: { type: 'string', example: '北京', description: '所在地' },
          verified: { type: 'integer', example: 0, description: '认证状态' }
        }
      },
      Post: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1, description: '帖子ID' },
          title: { type: 'string', example: '分享一下今天的美食', description: '标题' },
          content: { type: 'string', example: '今天去了一家新开的餐厅...', description: '内容' },
          images: { type: 'string', example: '["url1","url2"]', description: '图片列表JSON' },
          type: { type: 'integer', example: 1, description: '类型：1图文 2视频' },
          user_id: { type: 'string', description: '作者ID' },
          likes_count: { type: 'integer', example: 10, description: '点赞数' },
          comments_count: { type: 'integer', example: 5, description: '评论数' },
          collects_count: { type: 'integer', example: 3, description: '收藏数' },
          created_at: { type: 'string', format: 'date-time', description: '创建时间' }
        }
      },
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1, description: '评论ID' },
          content: { type: 'string', example: '很不错的分享！', description: '评论内容' },
          post_id: { type: 'integer', description: '帖子ID' },
          user_id: { type: 'string', description: '评论者ID' },
          parent_id: { type: 'integer', nullable: true, description: '父评论ID' },
          created_at: { type: 'string', format: 'date-time', description: '创建时间' }
        }
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1, description: '标签ID' },
          name: { type: 'string', example: '美食', description: '标签名称' },
          post_count: { type: 'integer', example: 100, description: '关联帖子数' }
        }
      },
      TokenResponse: {
        type: 'object',
        properties: {
          access_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: '访问令牌' },
          refresh_token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', description: '刷新令牌' },
          expires_in: { type: 'integer', example: 3600, description: '过期时间（秒）' }
        }
      }
    }
  },
  tags: [
    { name: '调试工具', description: 'JWT测试令牌生成，用于API调试' },
    { name: '认证', description: '用户注册、登录、令牌管理' },
    { name: '用户', description: '用户信息、关注、收藏等' },
    { name: '帖子', description: '帖子的增删改查' },
    { name: '评论', description: '评论的增删查' },
    { name: '点赞', description: '点赞与取消点赞' },
    { name: '标签', description: '标签查询' },
    { name: '搜索', description: '全文搜索' },
    { name: '上传', description: '文件上传（图片、视频、分片）' },
    { name: '统计', description: '全局统计数据' },
    { name: '余额', description: '用户余额与积分管理' },
    { name: '创作中心', description: '创作者数据分析与收益' },
    { name: '通知', description: '用户通知管理' },
    { name: '管理后台', description: '管理员专用接口' },
    { name: '应用', description: 'App版本更新与事件上报' }
  ],
  paths: {}
};

// 自动扫描路由文件，从实际代码生成所有API文档
const routesDir = path.join(__dirname, '..', 'routes');
const appJsPath = path.join(__dirname, '..', 'app.js');

// 自动检测app.js中的路由文件挂载关系
const { fileMap } = detectRouteMounts(appJsPath);

// 扫描所有路由文件，提取路由和参数
const allRoutes = scanRoutes(routesDir, fileMap);

// 扫描app.js中的内联业务路由（如 /api/app/check-update）
const inlineRoutes = parseAppInlineRoutes(appJsPath);
allRoutes.push(...inlineRoutes);

// 为每个路由生成Swagger文档
for (const route of allRoutes) {
  if (!baseSpec.paths[route.path]) {
    baseSpec.paths[route.path] = {};
  }
  baseSpec.paths[route.path][route.method] = generateSwaggerPath(route);
}

console.log(`● Swagger自动生成完成: 共 ${allRoutes.length} 个路由（纯代码扫描，含 ${inlineRoutes.length} 个app.js内联路由）`);

// 添加 app.js 中定义的内联路由文档
baseSpec.paths['/api/health'] = {
  get: {
    summary: '健康检查',
    description: '服务器健康检查接口，返回服务状态和运行时间',
    tags: ['调试工具'],
    responses: {
      '200': {
        description: '服务正常',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                code: { type: 'integer', example: 200 },
                message: { type: 'string', example: 'OK' },
                timestamp: { type: 'string', format: 'date-time', description: '当前时间' },
                uptime: { type: 'number', description: '服务运行时间（秒）' }
              }
            }
          }
        }
      }
    }
  }
};

baseSpec.paths[`/api/${SWAGGER_DOCS_PATH}.json`] = {
  get: {
    summary: 'Swagger JSON规范',
    description: '获取OpenAPI 3.0 JSON格式的API文档规范，可导入Postman等工具',
    tags: ['调试工具'],
    responses: {
      '200': {
        description: 'OpenAPI 3.0 JSON规范',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'OpenAPI 3.0规范对象'
            }
          }
        }
      }
    }
  }
};

baseSpec.paths[`/api/${JWT_TEST_TOKEN_PATH}`] = {
  get: {
    summary: '🔑 JWT测试令牌页面',
    description: '打开JWT测试令牌生成页面，可生成用户或管理员测试令牌用于API调试',
    tags: ['调试工具'],
    responses: {
      '200': {
        description: 'JWT测试令牌生成页面（HTML）'
      }
    }
  },
  post: {
    summary: '🔑 生成JWT测试令牌',
    description: '生成测试用JWT令牌，可用于Swagger Authorize认证后调试需要登录的接口。\n\n' +
      '**使用步骤：**\n' +
      '1. 选择令牌类型（普通用户/管理员）\n' +
      '2. 点击 Execute 生成令牌\n' +
      '3. 复制返回的 access_token\n' +
      '4. 点击页面上方 Authorize 按钮粘贴令牌',
    tags: ['调试工具'],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              userId: {
                type: 'integer',
                description: '用户数字ID',
                example: 1
              },
              user_id: {
                type: 'string',
                description: '用户标识（普通用户为user_id，管理员为username）',
                example: 'test_user'
              },
              type: {
                type: 'string',
                enum: ['user', 'admin'],
                description: '令牌类型：user=普通用户，admin=管理员',
                example: 'user'
              }
            }
          },
          examples: {
            '普通用户令牌': {
              summary: '生成普通用户测试令牌',
              value: { userId: 1, user_id: 'test_user', type: 'user' }
            },
            '管理员令牌': {
              summary: '生成管理员测试令牌',
              value: { userId: 1, user_id: 'admin', type: 'admin' }
            }
          }
        }
      }
    },
    responses: {
      '200': {
        description: '令牌生成成功',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                code: { type: 'integer', example: 200 },
                message: { type: 'string', example: '测试令牌生成成功' },
                data: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: '访问令牌，复制到Authorize使用' },
                    refresh_token: { type: 'string', description: '刷新令牌' },
                    payload: { type: 'object', description: '令牌载荷内容' },
                    usage: { type: 'string', description: '使用说明' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

// 检查并自动添加新检测到的tag
for (const [prefix, tagName] of Object.entries(ROUTE_TAG_MAP)) {
  const hasTag = baseSpec.tags.some(t => t.name === tagName);
  if (!hasTag) {
    baseSpec.tags.push({ name: tagName, description: `${tagName}相关接口` });
  }
}

module.exports = baseSpec;
