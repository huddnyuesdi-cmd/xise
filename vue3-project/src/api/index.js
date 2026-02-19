import request from './request.js'

// 用户相关API
export const userApi = {
  // 获取用户信息
  getUserInfo(userId) {
    return request.get(`/users/${userId}`)
  },

  // 获取用户个性标签
  getUserPersonalityTags(userId) {
    return request.get(`/users/${userId}/personality-tags`)
  },

  // 更新用户信息
  updateUserInfo(userId, data) {
    return request.put(`/users/${userId}`, data)
  },

  // 关注用户
  followUser(userId) {
    return request.post(`/users/${userId}/follow`)
  },

  // 取消关注用户
  unfollowUser(userId) {
    return request.delete(`/users/${userId}/follow`)
  },

  // 搜索用户
  searchUsers(keyword, params = {}) {
    return request.get('/users/search', { params: { keyword, ...params } })
  },

  // 获取互相关注列表
  getMutualFollows(userId, params = {}) {
    return request.get(`/users/${userId}/mutual-follows`, { params })
  },

  // 获取关注列表
  getFollowing(userId, params = {}) {
    return request.get(`/users/${userId}/following`, { params })
  },

  // 获取粉丝列表
  getFollowers(userId, params = {}) {
    return request.get(`/users/${userId}/followers`, { params })
  },

  // 获取关注状态
  getFollowStatus(userId) {
    return request.get(`/users/${userId}/follow-status`)
  },

  // 获取用户统计信息
  getUserStats(userId) {
    return request.get(`/users/${userId}/stats`)
  },

  // 修改密码
  changePassword(userId, data) {
    return request.put(`/users/${userId}/password`, data)
  },

  // 删除账号
  deleteAccount(userId) {
    return request.delete(`/users/${userId}`)
  },

  // 记录浏览历史
  recordHistory(postId) {
    return request.post('/users/history', { post_id: postId })
  },

  // 获取浏览历史列表
  getHistory(params = {}) {
    return request.get('/users/history', { params })
  },

  // 删除单条浏览历史
  deleteHistoryItem(postId) {
    return request.delete(`/users/history/${postId}`)
  },

  // 清空所有浏览历史
  clearHistory() {
    return request.delete('/users/history')
  },

  // 获取用户工具栏配置
  getToolbarItems() {
    return request.get('/users/toolbar/items')
  },

  // 拉黑用户
  blockUser(userId) {
    return request.post(`/users/${userId}/block`)
  },

  // 取消拉黑
  unblockUser(userId) {
    return request.delete(`/users/${userId}/block`)
  },

  // 获取黑名单状态
  getBlockStatus(userId) {
    return request.get(`/users/${userId}/block-status`)
  },

  // 完成开始页面引导
  submitOnboarding(data) {
    return request.post('/users/onboarding', data)
  },

  // 获取隐私设置
  getPrivacySettings() {
    return request.get('/users/privacy-settings')
  },

  // 更新隐私设置
  updatePrivacySettings(data) {
    return request.put('/users/privacy-settings', data)
  },

  // 获取初始设置页面配置
  getOnboardingConfig() {
    return request.get('/users/onboarding-config')
  },

  // 获取引导页草稿
  getOnboardingDraft() {
    return request.get('/users/onboarding-draft')
  },

  // 保存引导页草稿
  saveOnboardingDraft(data) {
    return request.put('/users/onboarding-draft', data)
  },

  // 获取API密钥列表
  getApiKeys() {
    return request.get('/users/api-keys')
  },

  // 创建API密钥
  createApiKey(data) {
    return request.post('/users/api-keys', data)
  },

  // 删除API密钥
  deleteApiKey(id) {
    return request.delete(`/users/api-keys/${id}`)
  }
}

// 笔记相关API
export const postApi = {
  // 获取笔记列表
  getPosts(params = {}) {
    return request.get('/posts', { params })
  },

  // 获取笔记详情
  getPostDetail(postId) {
    return request.get(`/posts/${postId}`)
  },

  // 搜索笔记
  searchPosts(keyword, params = {}) {
    return request.get('/search/posts', { params: { keyword, ...params } })
  },

  // 创建笔记
  createPost(data) {
    return request.post('/posts', data)
  },

  // 更新笔记
  updatePost(postId, data) {
    return request.put(`/posts/${postId}`, data)
  },

  // 删除笔记
  deletePost(postId) {
    return request.delete(`/posts/${postId}`)
  },

  // 点赞笔记
  likePost(postId) {
    return request.post('/likes', { target_type: 1, target_id: postId })
  },

  // 取消点赞笔记
  unlikePost(postId) {
    return request.delete('/likes', { data: { target_type: 1, target_id: postId } })
  },

  // 收藏笔记
  collectPost(postId) {
    return request.post(`/posts/${postId}/collect`)
  },

  // 取消收藏笔记
  uncollectPost(postId) {
    return request.delete(`/posts/${postId}/collect`)
  },

  // 获取用户笔记
  getUserPosts(userId, params = {}) {
    return request.get(`/users/${userId}/posts`, { params })
  },

  // 获取用户收藏
  getUserCollections(userId, params = {}) {
    return request.get(`/users/${userId}/collections`, { params })
  }
}

// 评论相关API
export const commentApi = {
  // 获取评论列表
  getComments(postId, params = {}) {
    // 确保postId是有效的
    if (!postId) {
      console.error('获取评论失败: 笔记ID无效')
      return Promise.reject(new Error('笔记ID无效'))
    }

    // 构建正确的API路径
    // 注意：后端API路由是 /api/posts/:id/comments
    // 但axios实例已配置baseURL为http://localhost:3001/api
    // 所以这里只需要/posts/:id/comments部分
    const url = `/posts/${postId}/comments`

    return request.get(url, { params })
      .then(response => {
        // 响应已经在拦截器中被处理成 {success, data, message} 格式
        return response
      })
      .catch(error => {
        console.error(`获取笔记[${postId}]评论失败:`, error.message)
        // 返回一个格式化的错误对象，与成功响应格式一致
        return {
          success: false,
          data: null,
          message: error.message || '获取评论失败'
        }
      })
  },

  // 获取子评论列表
  getReplies(commentId, params = {}) {
    // 确保commentId是有效的
    if (!commentId) {
      console.error('获取回复失败: 评论ID无效')
      return Promise.reject(new Error('评论ID无效'))
    }

    const url = `/comments/${commentId}/replies`

    return request.get(url, { params })
      .then(response => {
        return response
      })
      .catch(error => {
        console.error(`获取评论[${commentId}]回复失败:`, error.message)
        // 返回一个格式化的错误对象，与成功响应格式一致
        return {
          success: false,
          data: null,
          message: error.message || '获取回复失败'
        }
      })
  },

  // 创建评论
  createComment(data) {
    return request.post('/comments', data)
  },

  // 删除评论
  deleteComment(commentId) {
    return request.delete(`/comments/${commentId}`)
  },

  // 点赞评论
  likeComment(commentId) {
    return request.post('/likes', { target_type: 2, target_id: commentId })
  },

  // 取消点赞评论
  unlikeComment(commentId) {
    return request.delete('/likes', { data: { target_type: 2, target_id: commentId } })
  }
}

// 认证相关API
export const authApi = {
  // 用户登录
  login(data) {
    return request.post('/auth/login', data)
  },

  // 用户注册
  register(data) {
    return request.post('/auth/register', data)
  },

  // 退出登录
  logout() {
    return request.post('/auth/logout')
  },

  // 刷新token
  refreshToken() {
    return request.post('/auth/refresh')
  },

  // 获取当前用户信息
  getCurrentUser() {
    return request.get('/auth/me')
  },

  // 发送邮箱验证码
  sendEmailCode(data) {
    return request.post('/auth/send-email-code', data)
  },

  // 获取邮件功能配置
  getEmailConfig() {
    return request.get('/auth/email-config')
  },

  // 获取认证配置（包括邮件和OAuth2）
  getAuthConfig() {
    return request.get('/auth/auth-config')
  },

  // 绑定邮箱
  bindEmail(data) {
    return request.post('/auth/bind-email', data)
  },

  // 解除邮箱绑定
  unbindEmail() {
    return request.delete('/auth/unbind-email')
  },

  // 发送找回密码验证码
  sendResetCode(data) {
    return request.post('/auth/send-reset-code', data)
  },

  // 验证找回密码验证码
  verifyResetCode(data) {
    return request.post('/auth/verify-reset-code', data)
  },

  // 重置密码
  resetPassword(data) {
    return request.post('/auth/reset-password', data)
  },

  // OAuth2登录 - 获取登录URL（前端重定向）
  getOAuth2LoginUrl() {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api'
    return `${baseUrl}/auth/oauth2/login`
  },

  // 通过API密钥置换JWT令牌
  exchangeApiKey(data) {
    return request.post('/auth/token', data)
  }
}

// 导入新的图片上传API
import * as imageUploadApi from './upload.js'
import * as videoUploadApi from './video.js'

// 图片上传API（保持向后兼容）
export const uploadApi = {
  // 上传图片（后端接口）
  uploadImage(file) {
    const formData = new FormData()
    formData.append('image', file)
    return request.post('/upload/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },

  // 批量上传图片（后端接口）
  uploadImages(files, options = {}) {
    const formData = new FormData()
    files.forEach(file => {
      formData.append('files', file)
    })
    // 传递水印参数（仅在显式开启时发送）
    if (options.watermark === true) {
      formData.append('watermark', 'true')
    }
    if (options.watermarkOpacity !== undefined) {
      formData.append('watermarkOpacity', String(options.watermarkOpacity))
    }
    return request.post('/upload/multiple', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })
  },

  // 视频上传
  uploadVideo(file, onProgress) {
    return videoUploadApi.videoApi.uploadVideo(file, onProgress)
  },

  // 上传图片到图床（新接口）
  uploadToImageHost: imageUploadApi.uploadImage,

  // 批量上传图片到图床（新接口）
  uploadMultipleToImageHost: imageUploadApi.uploadImages,

  // 上传裁剪后的图片（新接口）
  uploadCroppedImage: imageUploadApi.uploadCroppedImage,

  // 验证图片文件（新接口）
  validateImageFile: imageUploadApi.validateImageFile,

  // 格式化文件大小（新接口）
  formatFileSize: imageUploadApi.formatFileSize,

  // 生成图片预览（新接口）
  createImagePreview: imageUploadApi.createImagePreview,

  // 视频上传相关方法
  validateVideoFile: videoUploadApi.videoApi.validateVideoFile,
  createVideoPreview: videoUploadApi.videoApi.createVideoPreview,
  revokeVideoPreview: videoUploadApi.videoApi.revokeVideoPreview
}

// 导出图片上传API（推荐使用）
export { imageUploadApi, videoUploadApi }

// 搜索相关API
export const searchApi = {
  // 统一搜索接口
  search(params = {}) {
    return request.get('/search', { params })
  },

  // 搜索笔记（支持关键词和标签）
  searchPosts(keyword = '', tag = '', params = {}) {
    return request.get('/search', {
      params: {
        keyword,
        tag,
        type: 'posts',
        ...params
      }
    })
  },

  // 搜索用户
  searchUsers(keyword = '', params = {}) {
    return request.get('/search', {
      params: {
        keyword,
        type: 'users',
        ...params
      }
    })
  }
}

// 管理员相关API
export const adminApi = {
  // 管理员登录
  login(data) {
    return request.post('/auth/admin/login', data)
  },

  // 获取当前管理员信息
  getCurrentAdmin() {
    return request.get('/auth/admin/me')
  },

  // 管理员退出登录
  logout() {
    return request.post('/auth/admin/logout')
  },

  // ========== 用户管理 ==========
  // 获取用户列表
  getUsers(params = {}) {
    return request.get('/admin/users', { params })
  },

  // 创建用户
  createUser(data) {
    return request.post('/admin/users', data)
  },

  // 更新用户信息
  updateUser(userId, data) {
    return request.put(`/admin/users/${userId}`, data)
  },

  // 删除用户
  deleteUser(userId) {
    return request.delete(`/admin/users/${userId}`)
  },

  // 批量删除用户
  batchDeleteUsers(ids) {
    return request.delete('/admin/users', { data: { ids } })
  },

  // 获取单个用户详情
  getUserDetail(userId) {
    return request.get(`/admin/users/${userId}`)
  },

  // ========== 笔记管理 ==========
  // 获取笔记列表
  getPosts(params = {}) {
    return request.get('/admin/posts', { params })
  },

  // 创建笔记
  createPost(data) {
    return request.post('/admin/posts', data)
  },

  // 更新笔记
  updatePost(postId, data) {
    return request.put(`/admin/posts/${postId}`, data)
  },

  // 删除笔记
  deletePost(postId) {
    return request.delete(`/admin/posts/${postId}`)
  },

  // 批量删除笔记
  batchDeletePosts(ids) {
    return request.delete('/admin/posts', { data: { ids } })
  },

  // 获取单个笔记详情
  getPostDetail(postId) {
    return request.get(`/admin/posts/${postId}`)
  },

  // ========== 评论管理 ==========
  // 获取评论列表
  getComments(params = {}) {
    return request.get('/admin/comments', { params })
  },

  // 创建评论
  createComment(data) {
    return request.post('/admin/comments', data)
  },

  // 更新评论
  updateComment(commentId, data) {
    return request.put(`/admin/comments/${commentId}`, data)
  },

  // 删除评论
  deleteComment(commentId) {
    return request.delete(`/admin/comments/${commentId}`)
  },

  // 批量删除评论
  batchDeleteComments(ids) {
    return request.delete('/admin/comments', { data: { ids } })
  },

  // 获取单个评论详情
  getCommentDetail(commentId) {
    return request.get(`/admin/comments/${commentId}`)
  },

  // ========== 标签管理 ==========
  // 获取标签列表
  getTags(params = {}) {
    return request.get('/admin/tags', { params })
  },

  // 创建标签
  createTag(data) {
    return request.post('/admin/tags', data)
  },

  // 更新标签
  updateTag(tagId, data) {
    return request.put(`/admin/tags/${tagId}`, data)
  },

  // 删除标签
  deleteTag(tagId) {
    return request.delete(`/admin/tags/${tagId}`)
  },

  // 批量删除标签
  batchDeleteTags(ids) {
    return request.delete('/admin/tags', { data: { ids } })
  },

  // 获取单个标签详情
  getTagDetail(tagId) {
    return request.get(`/admin/tags/${tagId}`)
  },

  // ========== 点赞管理 ==========
  // 获取点赞列表
  getLikes(params = {}) {
    return request.get('/admin/likes', { params })
  },

  // 创建点赞
  createLike(data) {
    return request.post('/admin/likes', data)
  },

  // 更新点赞
  updateLike(likeId, data) {
    return request.put(`/admin/likes/${likeId}`, data)
  },

  // 删除点赞
  deleteLike(likeId) {
    return request.delete(`/admin/likes/${likeId}`)
  },

  // 批量删除点赞
  batchDeleteLikes(ids) {
    return request.delete('/admin/likes', { data: { ids } })
  },

  // 获取单个点赞详情
  getLikeDetail(likeId) {
    return request.get(`/admin/likes/${likeId}`)
  },

  // ========== 收藏管理 ==========
  // 获取收藏列表
  getCollections(params = {}) {
    return request.get('/admin/collections', { params })
  },

  // 创建收藏
  createCollection(data) {
    return request.post('/admin/collections', data)
  },

  // 更新收藏
  updateCollection(collectionId, data) {
    return request.put(`/admin/collections/${collectionId}`, data)
  },

  // 删除收藏
  deleteCollection(collectionId) {
    return request.delete(`/admin/collections/${collectionId}`)
  },

  // 批量删除收藏
  batchDeleteCollections(ids) {
    return request.delete('/admin/collections', { data: { ids } })
  },

  // 获取单个收藏详情
  getCollectionDetail(collectionId) {
    return request.get(`/admin/collections/${collectionId}`)
  },

  // ========== 关注管理 ==========
  // 获取关注列表
  getFollows(params = {}) {
    return request.get('/admin/follows', { params })
  },

  // 创建关注
  createFollow(data) {
    return request.post('/admin/follows', data)
  },

  // 更新关注
  updateFollow(followId, data) {
    return request.put(`/admin/follows/${followId}`, data)
  },

  // 删除关注
  deleteFollow(followId) {
    return request.delete(`/admin/follows/${followId}`)
  },

  // 批量删除关注
  batchDeleteFollows(ids) {
    return request.delete('/admin/follows', { data: { ids } })
  },

  // 获取单个关注详情
  getFollowDetail(followId) {
    return request.get(`/admin/follows/${followId}`)
  },

  // ========== 会话管理 ==========
  // 获取会话列表
  getSessions(params = {}) {
    return request.get('/admin/sessions', { params })
  },

  // 创建会话
  createSession(data) {
    return request.post('/admin/sessions', data)
  },

  // 更新会话
  updateSession(sessionId, data) {
    return request.put(`/admin/sessions/${sessionId}`, data)
  },

  // 删除会话
  deleteSession(sessionId) {
    return request.delete(`/admin/sessions/${sessionId}`)
  },

  // 批量删除会话
  batchDeleteSessions(ids) {
    return request.delete('/admin/sessions', { data: { ids } })
  },

  // 获取单个会话详情
  getSessionDetail(sessionId) {
    return request.get(`/admin/sessions/${sessionId}`)
  },

  // ========== 管理员管理 ==========
  // 获取管理员列表（两个路由都支持）
  getAdmins(params = {}) {
    return request.get('/admin/admins', { params })
  },

  // 获取管理员列表（认证路由）
  getAdminsAuth(params = {}) {
    return request.get('/auth/admin/admins', { params })
  },

  // 创建管理员
  createAdmin(data) {
    return request.post('/admin/admins', data)
  },

  // 创建管理员（认证路由）
  createAdminAuth(data) {
    return request.post('/auth/admin/admins', data)
  },

  // 更新管理员信息
  updateAdmin(adminId, data) {
    return request.put(`/admin/admins/${adminId}`, data)
  },

  // 更新管理员信息（认证路由）
  updateAdminAuth(adminId, data) {
    return request.put(`/auth/admin/admins/${adminId}`, data)
  },

  // 删除管理员
  deleteAdmin(adminId) {
    return request.delete(`/admin/admins/${adminId}`)
  },

  // 删除管理员（认证路由）
  deleteAdminAuth(adminId) {
    return request.delete(`/auth/admin/admins/${adminId}`)
  },

  // 批量删除管理员
  batchDeleteAdmins(ids) {
    return request.delete('/admin/admins', { data: { ids } })
  },

  // 批量删除管理员（认证路由）
  batchDeleteAdminsAuth(ids) {
    return request.delete('/auth/admin/admins', { data: { ids } })
  },

  // 获取单个管理员详情
  getAdminDetail(adminId) {
    return request.get(`/admin/admins/${adminId}`)
  },

  // 获取单个管理员详情（认证路由）
  getAdminDetailAuth(adminId) {
    return request.get(`/auth/admin/admins/${adminId}`)
  },

  // 获取动态
  getMonitorActivities() {
    return request.get('/admin/monitor/activities')
  },

  // ========== 队列管理 ==========
  // 获取队列统计信息
  getQueueStats() {
    return request.get('/admin/queues')
  },

  // 获取队列名称列表
  getQueueNames() {
    return request.get('/admin/queue-names')
  },

  // 获取队列任务列表
  getQueueJobs(queueName, params = {}) {
    return request.get(`/admin/queues/${queueName}/jobs`, { params })
  },

  // 重试失败的任务
  retryJob(queueName, jobId) {
    return request.post(`/admin/queues/${queueName}/jobs/${jobId}/retry`)
  },

  // 清空队列
  clearQueue(queueName) {
    return request.delete(`/admin/queues/${queueName}`)
  },

  // ========== 用户工具栏管理 ==========
  // 获取工具栏列表
  getUserToolbars(params = {}) {
    return request.get('/admin/user-toolbar', { params })
  },

  // 创建工具栏项
  createUserToolbar(data) {
    return request.post('/admin/user-toolbar', data)
  },

  // 更新工具栏项
  updateUserToolbar(toolbarId, data) {
    return request.put(`/admin/user-toolbar/${toolbarId}`, data)
  },

  // 删除工具栏项
  deleteUserToolbar(toolbarId) {
    return request.delete(`/admin/user-toolbar/${toolbarId}`)
  },

  // 批量删除工具栏项
  batchDeleteUserToolbars(ids) {
    return request.delete('/admin/user-toolbar', { data: { ids } })
  },

  // 获取单个工具栏项详情
  getUserToolbarDetail(toolbarId) {
    return request.get(`/admin/user-toolbar/${toolbarId}`)
  },

  // 切换工具栏项启用状态
  toggleUserToolbarActive(toolbarId) {
    return request.put(`/admin/user-toolbar/${toolbarId}/toggle-active`)
  },

  // ========== 系统通知管理 ==========
  // 获取系统通知列表
  getSystemNotifications(params = {}) {
    return request.get('/admin/system-notifications', { params })
  },

  // 创建系统通知
  createSystemNotification(data) {
    return request.post('/admin/system-notifications', data)
  },

  // 更新系统通知
  updateSystemNotification(notificationId, data) {
    return request.put(`/admin/system-notifications/${notificationId}`, data)
  },

  // 删除系统通知
  deleteSystemNotification(notificationId) {
    return request.delete(`/admin/system-notifications/${notificationId}`)
  },

  // 批量删除系统通知
  batchDeleteSystemNotifications(ids) {
    return request.delete('/admin/system-notifications', { data: { ids } })
  },

  // 获取单个系统通知详情
  getSystemNotificationDetail(notificationId) {
    return request.get(`/admin/system-notifications/${notificationId}`)
  },

  // ========== 应用版本管理 ==========
  // 获取应用版本列表
  getAppVersions(params = {}) {
    return request.get('/admin/app-versions', { params })
  },

  // 创建应用版本
  createAppVersion(data) {
    return request.post('/admin/app-versions', data)
  },

  // 更新应用版本
  updateAppVersion(versionId, data) {
    return request.put(`/admin/app-versions/${versionId}`, data)
  },

  // 删除应用版本
  deleteAppVersion(versionId) {
    return request.delete(`/admin/app-versions/${versionId}`)
  },

  // 批量删除应用版本
  batchDeleteAppVersions(ids) {
    return request.delete('/admin/app-versions', { data: { ids } })
  },

  // 获取单个应用版本详情
  getAppVersionDetail(versionId) {
    return request.get(`/admin/app-versions/${versionId}`)
  }
}

// 余额中心API
export const balanceApi = {
  // 获取余额中心配置
  getConfig() {
    return request.get('/balance/config')
  },

  // 获取用户外部余额
  getUserBalance() {
    return request.get('/balance/user-balance')
  },

  // 兑入余额（从用户中心转入本站）
  exchangeIn(amount) {
    return request.post('/balance/exchange-in', { amount })
  },

  // 兑出余额（从本站转出到用户中心）
  exchangeOut(amount) {
    return request.post('/balance/exchange-out', { amount })
  },

  // 购买付费内容
  purchaseContent(postId) {
    console.log('🛒 [API] 调用购买接口, postId:', postId)
    return request.post('/balance/purchase-content', { postId })
  },

  // 检查是否已购买
  checkPurchase(postId) {
    console.log('🔍 [API] 检查购买状态, postId:', postId)
    return request.get(`/balance/check-purchase/${postId}`)
  }
}

// 通知相关API
export const notificationApi = {
  // 获取通知列表
  getNotifications(params = {}) {
    return request.get('/notifications', { params })
  },

  // 获取未读通知数量
  getUnreadCount() {
    return request.get('/notifications/unread-count')
  },

  // 标记通知为已读
  markAsRead(notificationId) {
    return request.put(`/notifications/${notificationId}/read`)
  },

  // 标记所有通知为已读
  markAllAsRead() {
    return request.put('/notifications/read-all')
  },

  // 删除通知
  deleteNotification(notificationId) {
    return request.delete(`/notifications/${notificationId}`)
  },

  // 获取系统通知列表
  getSystemNotifications(params = {}) {
    return request.get('/notifications/system', { params })
  },

  // 获取需要弹窗显示的系统通知
  getPopupNotifications() {
    return request.get('/notifications/system/popup')
  },

  // 确认系统通知（标记已读）
  confirmSystemNotification(notificationId) {
    return request.post(`/notifications/system/${notificationId}/confirm`)
  },

  // 删除（dismiss）系统通知
  dismissSystemNotification(notificationId) {
    return request.delete(`/notifications/system/${notificationId}/dismiss`)
  }
}

// 创作者中心API
export const creatorCenterApi = {
  // 获取创作者中心配置
  getConfig() {
    return request.get('/creator-center/config')
  },

  // 获取创作者收益概览
  getOverview() {
    return request.get('/creator-center/overview')
  },

  // 获取趋势数据（过去7天的每日统计）
  getTrends() {
    return request.get('/creator-center/trends')
  },

  // 获取收益明细列表
  getEarningsLog(params = {}) {
    return request.get('/creator-center/earnings-log', { params })
  },

  // 获取付费内容列表及销售统计
  getPaidContent(params = {}) {
    return request.get('/creator-center/paid-content', { params })
  },

  // 收益提现到石榴点余额
  withdraw(amount) {
    return request.post('/creator-center/withdraw', { amount })
  },

  // 领取今日激励奖励
  claimIncentive() {
    return request.post('/creator-center/claim-incentive')
  },

  // 获取质量奖励收益详情
  getQualityRewards(params = {}) {
    return request.get('/creator-center/quality-rewards', { params })
  }
}
