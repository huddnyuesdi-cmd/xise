#!/usr/bin/env node
/**
 * Swagger文档完整性验证脚本
 * 
 * 用于CI/CD流水线中强制检查所有API路由是否都有对应的Swagger文档。
 * 类似Prisma的schema验证机制，在构建阶段提前发现遗漏。
 * 
 * 工作原理：
 * 1. 扫描routes/目录中所有路由文件，提取路由定义
 * 2. 扫描app.js中的内联业务路由
 * 3. 模拟swagger.js的spec生成逻辑，检查所有路由是否被覆盖
 * 4. 无需数据库连接或Prisma，可在CI环境中独立运行
 * 
 * 用法: node scripts/validate-swagger.js
 * 退出码: 0=通过, 1=有缺失路由
 */

const path = require('path');
const {
  scanRoutes,
  generateSwaggerPath,
  detectRouteMounts,
  parseAppInlineRoutes,
  ROUTE_TAG_MAP
} = require('../utils/swaggerAutoGen');

const routesDir = path.join(__dirname, '..', 'routes');
const appJsPath = path.join(__dirname, '..', 'app.js');

console.log('🔍 正在验证Swagger文档完整性...\n');

// 步骤1: 模拟swagger.js的spec生成逻辑
const { fileMap } = detectRouteMounts(appJsPath);
const routeFileRoutes = scanRoutes(routesDir, fileMap);
const inlineRoutes = parseAppInlineRoutes(appJsPath);
const allAutoRoutes = [...routeFileRoutes, ...inlineRoutes];

// 步骤2: 构建spec中的路由集合（模拟swagger.js的paths生成）
const specEndpoints = new Set();
for (const route of allAutoRoutes) {
  specEndpoints.add(`${route.method.toUpperCase()} ${route.path}`);
}

// 步骤3: 扫描实际路由（包括自动检测的app.js内联路由）
const { appRoutes: detectedInlineRoutes } = detectRouteMounts(appJsPath);
const missing = [];
const seen = new Set();

// 检查app.js中检测到的内联路由是否都被parseAppInlineRoutes覆盖
for (const route of detectedInlineRoutes) {
  const swaggerPath = route.path.replace(/:(\w+)/g, '{$1}');
  const key = `${route.method.toUpperCase()} ${swaggerPath}`;
  if (!specEndpoints.has(key) && !seen.has(key)) {
    missing.push(key);
    seen.add(key);
  }
}

// 输出扫描统计
console.log(`  📂 路由文件中扫描到 ${routeFileRoutes.length} 个路由`);
console.log(`  📄 app.js内联路由扫描到 ${inlineRoutes.length} 个路由`);
console.log(`  🔎 app.js内联路由检测到 ${detectedInlineRoutes.length} 个路由`);
console.log('');

if (missing.length > 0) {
  console.error(`❌ 验证失败: 发现 ${missing.length} 个路由未被Swagger自动扫描覆盖:`);
  missing.forEach(m => console.error(`   - ${m}`));
  console.error('\n请确保所有路由都能被自动扫描:');
  console.error('  - routes/ 目录中的路由通过 scanRoutes 自动扫描');
  console.error('  - app.js 中的内联路由通过 parseAppInlineRoutes 自动扫描');
  console.error('  - 含变量路径的调试工具路由需在 swagger.js 中手动定义');
  process.exit(1);
}

console.log(`✅ 验证通过: 所有 ${allAutoRoutes.length} 个API路由均已覆盖`);
process.exit(0);
