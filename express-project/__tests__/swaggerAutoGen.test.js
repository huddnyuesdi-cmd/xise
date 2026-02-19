/**
 * swaggerAutoGen 工具函数测试
 * 验证自动路由扫描和Swagger文档生成功能
 */

const path = require('path');
const {
  scanRoutes,
  generateSwaggerPath,
  parseRouteFile,
  parseAppInlineRoutes,
  detectRouteMounts,
  validateSwaggerCompleteness,
  ROUTE_FILE_MAP,
  ROUTE_TAG_MAP
} = require('../utils/swaggerAutoGen');

const routesDir = path.join(__dirname, '..', 'routes');
const appJsPath = path.join(__dirname, '..', 'app.js');

describe('detectRouteMounts', () => {
  test('should detect route file mounts from app.js', () => {
    const { fileMap, appRoutes } = detectRouteMounts(appJsPath);
    expect(Object.keys(fileMap).length).toBeGreaterThan(0);
    expect(fileMap['auth.js']).toBe('/api/auth');
    expect(fileMap['posts.js']).toBe('/api/posts');
  });

  test('should detect inline routes from app.js', () => {
    const { appRoutes } = detectRouteMounts(appJsPath);
    const paths = appRoutes.map(r => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/health');
    expect(paths).toContain('GET /api/app/check-update');
    expect(paths).toContain('POST /api/app/report-event');
  });

  test('should skip template-literal paths', () => {
    const { appRoutes } = detectRouteMounts(appJsPath);
    const paths = appRoutes.map(r => r.path);
    // Template literal paths like ${SWAGGER_DOCS_PATH} should be excluded
    const hasTemplatePaths = paths.some(p => p.includes('${'));
    expect(hasTemplatePaths).toBe(false);
  });

  test('should return static fallback for non-existent file', () => {
    const { fileMap } = detectRouteMounts('/non/existent/path.js');
    expect(fileMap).toEqual(ROUTE_FILE_MAP);
  });
});

describe('parseAppInlineRoutes', () => {
  test('should parse check-update route with query parameters', () => {
    const routes = parseAppInlineRoutes(appJsPath);
    const checkUpdate = routes.find(r => r.path === '/api/app/check-update');

    expect(checkUpdate).toBeDefined();
    expect(checkUpdate.method).toBe('get');
    expect(checkUpdate.queryParams).toHaveProperty('platform');
    expect(checkUpdate.queryParams).toHaveProperty('version_name');
    expect(checkUpdate.queryParams).toHaveProperty('version_code');
  });

  test('should parse report-event route with body parameters', () => {
    const routes = parseAppInlineRoutes(appJsPath);
    const reportEvent = routes.find(r => r.path === '/api/app/report-event');

    expect(reportEvent).toBeDefined();
    expect(reportEvent.method).toBe('post');
    expect(reportEvent.bodyParams).toHaveProperty('device_id');
    expect(reportEvent.bodyParams).toHaveProperty('event_type');
    expect(reportEvent.bodyParams).toHaveProperty('platform');
  });

  test('should assign correct tags based on route prefix', () => {
    const routes = parseAppInlineRoutes(appJsPath);
    const appRoutes = routes.filter(r => r.path.startsWith('/api/app/'));
    appRoutes.forEach(r => {
      expect(r.tag).toBe('应用');
    });
  });

  test('should skip template-literal debug tool routes', () => {
    const routes = parseAppInlineRoutes(appJsPath);
    const paths = routes.map(r => r.path);
    const hasSwaggerPaths = paths.some(p => p.includes('swagger') || p.includes('jwt-'));
    expect(hasSwaggerPaths).toBe(false);
  });

  test('should return empty array for non-existent file', () => {
    const routes = parseAppInlineRoutes('/non/existent/path.js');
    expect(routes).toEqual([]);
  });
});

describe('scanRoutes', () => {
  test('should scan all route files', () => {
    const { fileMap } = detectRouteMounts(appJsPath);
    const routes = scanRoutes(routesDir, fileMap);
    expect(routes.length).toBeGreaterThan(0);
  });

  test('should parse auth routes', () => {
    const routes = scanRoutes(routesDir, { 'auth.js': '/api/auth' });
    expect(routes.length).toBeGreaterThan(0);
    routes.forEach(r => {
      expect(r.path).toMatch(/^\/api\/auth/);
    });
  });
});

describe('generateSwaggerPath', () => {
  test('should generate path with query parameters', () => {
    const route = {
      method: 'get',
      path: '/api/app/check-update',
      pathParams: [],
      queryParams: {
        platform: { type: 'string', required: false },
        version_code: { type: 'string', required: false }
      },
      bodyParams: {},
      authRequired: false,
      isAdmin: false,
      tag: '应用',
      summary: '检查App版本更新'
    };
    const result = generateSwaggerPath(route);
    expect(result.parameters).toBeDefined();
    expect(result.parameters.length).toBe(2);
    expect(result.parameters[0].in).toBe('query');
    expect(result.parameters[0].name).toBe('platform');
  });

  test('should add security for auth-required routes', () => {
    const route = {
      method: 'get',
      path: '/api/users/profile',
      pathParams: [],
      queryParams: {},
      bodyParams: {},
      authRequired: true,
      isAdmin: false,
      tag: '用户',
      summary: ''
    };
    const result = generateSwaggerPath(route);
    expect(result.security).toBeDefined();
    expect(result.security[0]).toHaveProperty('bearerAuth');
  });
});

describe('validateSwaggerCompleteness', () => {
  test('should return empty array when all routes are covered', () => {
    // Build a spec that covers all routes
    const { fileMap } = detectRouteMounts(appJsPath);
    const routes = scanRoutes(routesDir, fileMap);
    const inlineRoutes = parseAppInlineRoutes(appJsPath);
    const allRoutes = [...routes, ...inlineRoutes];

    const spec = { paths: {} };
    for (const route of allRoutes) {
      if (!spec.paths[route.path]) spec.paths[route.path] = {};
      spec.paths[route.path][route.method] = generateSwaggerPath(route);
    }

    const missing = validateSwaggerCompleteness(spec, routesDir, { appJsPath });
    expect(missing).toEqual([]);
  });

  test('should detect missing routes', () => {
    const emptySpec = { paths: {} };
    const missing = validateSwaggerCompleteness(emptySpec, routesDir, { appJsPath });
    expect(missing.length).toBeGreaterThan(0);
  });

  test('should throw in strict mode when routes are missing', () => {
    const emptySpec = { paths: {} };
    expect(() => {
      validateSwaggerCompleteness(emptySpec, routesDir, { appJsPath, strict: true });
    }).toThrow();
  });

  test('should not throw in strict mode when all routes covered', () => {
    const { fileMap } = detectRouteMounts(appJsPath);
    const routes = scanRoutes(routesDir, fileMap);
    const inlineRoutes = parseAppInlineRoutes(appJsPath);
    const allRoutes = [...routes, ...inlineRoutes];

    const spec = { paths: {} };
    for (const route of allRoutes) {
      if (!spec.paths[route.path]) spec.paths[route.path] = {};
      spec.paths[route.path][route.method] = generateSwaggerPath(route);
    }

    expect(() => {
      validateSwaggerCompleteness(spec, routesDir, { appJsPath, strict: true });
    }).not.toThrow();
  });
});
