const express = require('express')
const router = express.Router()
const { HTTP_STATUS, RESPONSE_CODES } = require('../constants')
const { prisma } = require('../config/config')
const { adminAuth } = require('../utils/uploadHelper')
const { auditComment } = require('../utils/contentAudit')
const { batchCleanupFiles } = require('../utils/fileCleanup')
const { getQueueStats, getQueueJobs, getJobDetails, retryJob, cleanQueue, isQueueEnabled, QUEUE_NAMES } = require('../utils/queueService')
const crypto = require('crypto')
const settingsService = require('../utils/settingsService')
const { notifySystemNotification, DEFAULT_TEMPLATES, loadCustomTemplates, updateCustomTemplate, clearCustomTemplates, renderTemplate, sendDiscordNotification } = require('../utils/notificationChannels')
const { sendMail } = require('../utils/email')
const { email: emailConfig, notificationChannels: notifChannelsConfig } = require('../config/config')
const sessionService = require('../utils/sessionService')

// ===================== AI审核设置 =====================
// 使用 Redis 持久化的设置服务

// 兼容旧接口：获取整体AI审核状态
router.get('/ai-review-status', adminAuth, (req, res) => {
  const usernameEnabled = settingsService.isAiUsernameReviewEnabled()
  const contentEnabled = settingsService.isAiContentReviewEnabled()
  res.json({ 
    code: RESPONSE_CODES.SUCCESS, 
    data: { 
      enabled: usernameEnabled || contentEnabled,
      username_enabled: usernameEnabled,
      content_enabled: contentEnabled
    }, 
    message: 'success' 
  })
})

// 兼容旧接口：切换整体AI审核（同时切换用户名和内容审核）
router.post('/ai-review-toggle', adminAuth, async (req, res) => {
  const { enabled } = req.body
  const newValue = Boolean(enabled)
  await settingsService.setAiUsernameReviewEnabled(newValue)
  await settingsService.setAiContentReviewEnabled(newValue)
  res.json({ code: RESPONSE_CODES.SUCCESS, message: `AI自动审核已${newValue ? '开启' : '关闭'}` })
})

// 导出函数供其他模块使用（使用 settingsService）
const isAiUsernameReviewEnabled = () => settingsService.isAiUsernameReviewEnabled()
const isAiContentReviewEnabled = () => settingsService.isAiContentReviewEnabled()
// 兼容旧的函数名
const isAiAutoReviewEnabled = () => settingsService.isAiAutoReviewEnabled()

// ===================== 游客访问限制设置 =====================

// 获取游客访问限制状态
router.get('/guest-access-status', adminAuth, (req, res) => {
  const restricted = settingsService.isGuestAccessRestricted()
  res.json({ 
    code: RESPONSE_CODES.SUCCESS, 
    data: { restricted }, 
    message: 'success' 
  })
})

// 切换游客访问限制
router.post('/guest-access-toggle', adminAuth, async (req, res) => {
  const { restricted } = req.body
  const newValue = Boolean(restricted)
  await settingsService.setGuestAccessRestricted(newValue)
  res.json({ code: RESPONSE_CODES.SUCCESS, message: `游客访问限制已${newValue ? '开启' : '关闭'}` })
})

// ===================== 系统设置 (System Settings) =====================

// 获取所有系统设置（用于管理后台显示）
router.get('/settings', adminAuth, async (req, res) => {
  try {
    const allSettings = await settingsService.getAllSettings()
    res.json({ 
      code: RESPONSE_CODES.SUCCESS, 
      data: allSettings, 
      message: 'success' 
    })
  } catch (error) {
    console.error('获取设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取设置失败' })
  }
})

// 获取系统设置（分类展示）
router.get('/system-settings', adminAuth, async (req, res) => {
  try {
    const settings = {
      // 访问控制设置
      access_control: {
        label: '访问控制',
        settings: {
          guest_access_restricted: {
            label: '禁止游客访问',
            description: '启用后，未登录用户无法访问笔记、评论、搜索、标签等内容',
            value: settingsService.isGuestAccessRestricted(),
            type: 'boolean'
          }
        }
      },
      // AI审核设置
      ai_review: {
        label: 'AI审核',
        settings: {
          ai_username_review_enabled: {
            label: '用户名AI审核',
            description: '启用后，用户昵称将通过AI进行内容审核',
            value: settingsService.isAiUsernameReviewEnabled(),
            type: 'boolean'
          },
          ai_content_review_enabled: {
            label: '内容AI审核',
            description: '启用后，评论等内容将通过AI进行审核',
            value: settingsService.isAiContentReviewEnabled(),
            type: 'boolean'
          }
        }
      },
      // 初始设置页面配置
      onboarding: {
        label: '初始设置',
        settings: {
          onboarding_interest_options: {
            label: '兴趣爱好选项',
            description: '配置用户初始设置页面和个人资料中的兴趣爱好选项，同步到前端初始页面和用户页面显示',
            value: settingsService.getOnboardingInterestOptions(),
            type: 'json_array'
          },
          onboarding_custom_fields: {
            label: '自定义字段',
            description: '配置初始设置页面的自定义字段（如身高、体重等），支持选项和填空类型',
            value: settingsService.getOnboardingCustomFields(),
            type: 'json_array'
          },
          onboarding_allow_skip: {
            label: '允许跳过初始页',
            description: '启用后，用户可以跳过初始设置页面',
            value: settingsService.isOnboardingSkipAllowed(),
            type: 'boolean'
          }
        }
      }
    }
    
    res.json({ 
      code: RESPONSE_CODES.SUCCESS, 
      data: settings, 
      message: 'success' 
    })
  } catch (error) {
    console.error('获取系统设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取系统设置失败' })
  }
})

// 更新系统设置（批量更新）
router.put('/system-settings', adminAuth, async (req, res) => {
  try {
    const { settings } = req.body
    const messages = []
    
    if (settings) {
      // 处理访问控制设置
      if (settings.guest_access_restricted !== undefined) {
        await settingsService.setGuestAccessRestricted(Boolean(settings.guest_access_restricted))
        messages.push(`游客访问限制已${settings.guest_access_restricted ? '开启' : '关闭'}`)
      }
      
      // 处理AI审核设置
      if (settings.ai_username_review_enabled !== undefined) {
        await settingsService.setAiUsernameReviewEnabled(Boolean(settings.ai_username_review_enabled))
        messages.push(`用户名AI审核已${settings.ai_username_review_enabled ? '开启' : '关闭'}`)
      }
      
      if (settings.ai_content_review_enabled !== undefined) {
        await settingsService.setAiContentReviewEnabled(Boolean(settings.ai_content_review_enabled))
        messages.push(`内容AI审核已${settings.ai_content_review_enabled ? '开启' : '关闭'}`)
      }

      // 处理初始设置页面配置
      if (settings.onboarding_interest_options !== undefined) {
        const options = Array.isArray(settings.onboarding_interest_options) ? settings.onboarding_interest_options : []
        await settingsService.setOnboardingInterestOptions(options)
        messages.push(`兴趣爱好选项已更新（${options.length}个）`)
      }

      // 处理自定义字段配置
      if (settings.onboarding_custom_fields !== undefined) {
        const fields = Array.isArray(settings.onboarding_custom_fields) ? settings.onboarding_custom_fields : []
        await settingsService.setOnboardingCustomFields(fields)
        messages.push(`自定义字段已更新（${fields.length}个）`)
      }

      // 处理是否允许跳过初始设置
      if (settings.onboarding_allow_skip !== undefined) {
        await settingsService.setOnboardingAllowSkip(Boolean(settings.onboarding_allow_skip))
        messages.push(`允许跳过初始页已${settings.onboarding_allow_skip ? '开启' : '关闭'}`)
      }
    }
    
    // 返回更新后的设置
    const updatedSettings = {
      guest_access_restricted: settingsService.isGuestAccessRestricted(),
      ai_username_review_enabled: settingsService.isAiUsernameReviewEnabled(),
      ai_content_review_enabled: settingsService.isAiContentReviewEnabled(),
      onboarding_interest_options: settingsService.getOnboardingInterestOptions(),
      onboarding_custom_fields: settingsService.getOnboardingCustomFields(),
      onboarding_allow_skip: settingsService.isOnboardingSkipAllowed()
    }
    
    res.json({ 
      code: RESPONSE_CODES.SUCCESS, 
      message: messages.length > 0 ? messages.join('，') : '设置已更新',
      data: updatedSettings
    })
  } catch (error) {
    console.error('更新系统设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新系统设置失败' })
  }
})

// 重置全部用户初始设置（将所有用户的profile_completed标记为false）
router.post('/reset-all-onboarding', adminAuth, async (req, res) => {
  try {
    const result = await prisma.user.updateMany({
      where: { profile_completed: true },
      data: { profile_completed: false }
    })
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: `已重置 ${result.count} 个用户的初始设置状态，所有用户需重新完成初始设置`,
      data: { affected_count: result.count }
    })
  } catch (error) {
    console.error('重置全部初始设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重置全部初始设置失败' })
  }
})

// ===================== 笔记管理 =====================
router.get('/posts', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { title, user_display_id, category_id, type, is_draft, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (title) where.title = { contains: title }
    if (category_id) {
      if (category_id === 'null') {
        where.category_id = null
      } else {
        where.category_id = parseInt(category_id)
      }
    }
    if (type !== undefined && type !== '') where.type = parseInt(type)
    if (is_draft !== undefined && is_draft !== '') where.is_draft = parseInt(is_draft) === 1
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }

    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          category: { select: { name: true } },
          images: { select: { image_url: true } },
          tags: { include: { tag: { select: { id: true, name: true } } } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedPosts = posts.map(post => ({
      id: Number(post.id),
      user_id: Number(post.user_id),
      title: post.title,
      content: post.content,
      category_id: post.category_id,
      category: post.category?.name,
      type: post.type,
      view_count: Number(post.view_count),
      like_count: post.like_count,
      collect_count: post.collect_count,
      comment_count: post.comment_count,
      created_at: post.created_at,
      is_draft: post.is_draft,
      user_display_id: post.user?.user_id,
      nickname: post.user?.nickname,
      images: post.images.map(img => img.image_url),
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name }))
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取笔记列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        category: { select: { name: true } },
        images: { select: { id: true, image_url: true, is_free_preview: true } },
        videos: { select: { id: true, video_url: true, cover_url: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        paymentSettings: true
      }
    })

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const result = {
      id: Number(post.id),
      user_id: Number(post.user_id),
      title: post.title,
      content: post.content,
      type: post.type,
      category_id: post.category_id,
      category: post.category?.name,
      view_count: Number(post.view_count),
      like_count: post.like_count,
      collect_count: post.collect_count,
      comment_count: post.comment_count,
      is_draft: post.is_draft,
      created_at: post.created_at,
      nickname: post.user?.nickname,
      user_display_id: post.user?.user_id,
      tags: post.tags.map(pt => ({ id: pt.tag.id, name: pt.tag.name })),
      images: post.type === 2 
        ? (post.videos.length > 0 ? [post.videos[0].video_url] : [])
        : post.images.map(img => img.image_url),
      video_url: post.videos.length > 0 ? post.videos[0].video_url : null,
      cover_url: post.videos.length > 0 ? post.videos[0].cover_url : null
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: result, message: 'success' })
  } catch (error) {
    console.error('获取笔记详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/posts', adminAuth, async (req, res) => {
  try {
    const { user_id, title, content, category_id, images, image_urls, tags, type, is_draft, video_url, cover_url } = req.body

    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少用户ID' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.create({
      data: {
        user_id: BigInt(user_id),
        title: title || '',
        content: content || '',
        category_id: category_id ? parseInt(category_id) : null,
        type: type || 1,
        is_draft: is_draft !== undefined ? Boolean(is_draft) : true
      }
    })

    const allImages = []
    if (images && Array.isArray(images)) {
      for (const image of images) {
        if (typeof image === 'string') {
          allImages.push(image)
        } else if (image && typeof image === 'object') {
          const possibleProps = ['url', 'preview', 'src', 'path', 'link']
          for (const prop of possibleProps) {
            if (image[prop] && typeof image[prop] === 'string') {
              allImages.push(image[prop])
              break
            }
          }
        }
      }
    }
    if (image_urls && Array.isArray(image_urls)) {
      allImages.push(...image_urls.filter(url => url && typeof url === 'string'))
    }

    if (allImages.length > 0) {
      await prisma.postImage.createMany({
        data: allImages.map(url => ({
          post_id: post.id,
          image_url: url.trim().replace(/\`/g, '').replace(/\s+/g, '')
        }))
      })
    }

    if (tags && tags.length > 0) {
      for (const tag of tags) {
        let tagId
        let tagName = typeof tag === 'string' ? tag : tag.name

        const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
        if (existingTag) {
          tagId = existingTag.id
        } else {
          const newTag = await prisma.tag.create({ data: { name: tagName } })
          tagId = newTag.id
        }

        await prisma.postTag.create({ data: { post_id: post.id, tag_id: tagId } })
        await prisma.tag.update({ where: { id: tagId }, data: { use_count: { increment: 1 } } })
      }
    }

    // Handle video for video posts
    if (video_url && video_url.trim() !== '') {
      await prisma.postVideo.create({
        data: {
          post_id: post.id,
          video_url: video_url.trim(),
          cover_url: cover_url || ''
        }
      })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(post.id) }, message: '笔记创建成功' })
  } catch (error) {
    console.error('创建笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const { title, content, category_id, view_count, is_draft, images, image_urls, tags, video_url, cover_url, video } = req.body

    const existingPost = await prisma.post.findUnique({ where: { id: postId }, include: { videos: true } })
    if (!existingPost) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const updateData = {}
    if (title !== undefined) updateData.title = title
    if (content !== undefined) updateData.content = content
    if (category_id !== undefined) updateData.category_id = category_id ? parseInt(category_id) : null
    if (view_count !== undefined) updateData.view_count = BigInt(Math.max(0, parseInt(view_count) || 0))
    if (is_draft !== undefined) updateData.is_draft = Boolean(is_draft)

    await prisma.post.update({ where: { id: postId }, data: updateData })

    if (images !== undefined || image_urls !== undefined) {
      await prisma.postImage.deleteMany({ where: { post_id: postId } })

      const allImagesSet = new Set()
      if (image_urls && Array.isArray(image_urls)) {
        image_urls.forEach(url => { if (url && typeof url === 'string') allImagesSet.add(url) })
      }
      if (images && Array.isArray(images)) {
        for (const image of images) {
          if (typeof image === 'string') {
            allImagesSet.add(image)
          } else if (image && typeof image === 'object') {
            const possibleProps = ['url', 'preview', 'src', 'path', 'link']
            for (const prop of possibleProps) {
              if (image[prop] && typeof image[prop] === 'string') {
                allImagesSet.add(image[prop])
                break
              }
            }
          }
        }
      }

      const allImages = Array.from(allImagesSet)
      if (allImages.length > 0) {
        await prisma.postImage.createMany({
          data: allImages.map(url => ({
            post_id: postId,
            image_url: url.trim().replace(/\`/g, '').replace(/\s+/g, '')
          }))
        })
      }
    }

    const hasVideoUpdate = video_url !== undefined || cover_url !== undefined || video !== undefined
    if (hasVideoUpdate) {
      const oldVideoUrls = existingPost.videos.map(v => v.video_url).filter(Boolean)
      const oldCoverUrls = existingPost.videos.map(v => v.cover_url).filter(Boolean)

      await prisma.postVideo.deleteMany({ where: { post_id: postId } })

      let newVideoUrl = null
      let newCoverUrl = null
      if (video && video.url) {
        newVideoUrl = video.url
        newCoverUrl = video.coverUrl || ''
      } else if (video_url && video_url.trim() !== '') {
        newVideoUrl = video_url
        newCoverUrl = cover_url || ''
      }

      if (newVideoUrl) {
        await prisma.postVideo.create({
          data: { post_id: postId, video_url: newVideoUrl, cover_url: newCoverUrl }
        })
      }

      batchCleanupFiles(oldVideoUrls, oldCoverUrls).catch(err => console.error('清理废弃视频文件失败:', err))
    }

    if (tags !== undefined) {
      const oldTags = await prisma.postTag.findMany({ where: { post_id: postId } })
      await prisma.postTag.deleteMany({ where: { post_id: postId } })

      for (const oldTag of oldTags) {
        await prisma.tag.update({
          where: { id: oldTag.tag_id },
          data: { use_count: { decrement: 1 } }
        })
      }

      if (tags && tags.length > 0) {
        for (const tag of tags) {
          let tagId
          let tagName = typeof tag === 'string' ? tag : tag.name

          if (typeof tag !== 'string' && (tag.is_new || String(tag.id).startsWith('temp_'))) {
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            tagId = existingTag ? existingTag.id : (await prisma.tag.create({ data: { name: tagName } })).id
          } else if (typeof tag === 'string') {
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            tagId = existingTag ? existingTag.id : (await prisma.tag.create({ data: { name: tagName } })).id
          } else {
            tagId = tag.id
          }

          await prisma.postTag.create({ data: { post_id: postId, tag_id: parseInt(tagId) } })
          await prisma.tag.update({ where: { id: parseInt(tagId) }, data: { use_count: { increment: 1 } } })
        }
      }
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '笔记更新成功' })
  } catch (error) {
    console.error('更新笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/posts/:id', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, videos: true, tags: true }
    })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    for (const pt of post.tags) {
      await prisma.tag.update({ where: { id: pt.tag_id }, data: { use_count: { decrement: 1 } } })
    }

    const filesToDelete = []
    post.images.forEach(img => filesToDelete.push(img.image_url))
    post.videos.forEach(v => { if (v.video_url) filesToDelete.push(v.video_url); if (v.cover_url) filesToDelete.push(v.cover_url) })

    await prisma.post.delete({ where: { id: postId } })
    batchCleanupFiles(filesToDelete)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/posts', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const postIds = ids.map(id => BigInt(id))

    const postTags = await prisma.postTag.findMany({ where: { post_id: { in: postIds } } })
    for (const pt of postTags) {
      await prisma.tag.update({ where: { id: pt.tag_id }, data: { use_count: { decrement: 1 } } })
    }

    await prisma.post.deleteMany({ where: { id: { in: postIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 评论管理 =====================
router.get('/comments', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, post_id, content, audit_status, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (post_id) where.post_id = BigInt(post_id)
    if (content) where.content = { contains: content }
    if (audit_status !== undefined && audit_status !== '') where.audit_status = parseInt(audit_status)

    const [total, comments] = await Promise.all([
      prisma.comment.count({ where }),
      prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          post: { select: { id: true, title: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedComments = comments.map(c => ({
      id: Number(c.id),
      post_id: Number(c.post_id),
      user_id: Number(c.user_id),
      parent_id: c.parent_id ? Number(c.parent_id) : null,
      content: c.content,
      like_count: c.like_count,
      audit_status: c.audit_status,
      is_public: c.is_public,
      created_at: c.created_at,
      user_display_id: c.user?.user_id,
      nickname: c.user?.nickname,
      post_title: c.post?.title
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedComments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取评论列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        post: { select: { id: true, title: true } }
      }
    })

    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: comment, message: 'success' })
  } catch (error) {
    console.error('获取评论详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/comments', adminAuth, async (req, res) => {
  try {
    const { user_id, post_id, content, parent_id } = req.body

    if (!user_id || !post_id || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    if (parent_id) {
      const parent = await prisma.comment.findUnique({ where: { id: BigInt(parent_id) } })
      if (!parent) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '父评论不存在' })
      }
    }

    const comment = await prisma.comment.create({
      data: {
        user_id: BigInt(user_id),
        post_id: BigInt(post_id),
        content,
        parent_id: parent_id ? BigInt(parent_id) : null
      }
    })

    await prisma.post.update({ where: { id: BigInt(post_id) }, data: { comment_count: { increment: 1 } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(comment.id) }, message: '评论创建成功' })
  } catch (error) {
    console.error('创建评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const { content } = req.body

    const comment = await prisma.comment.findUnique({ where: { id: commentId } })
    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    await prisma.comment.update({ where: { id: commentId }, data: { content } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/comments/:id', adminAuth, async (req, res) => {
  try {
    const commentId = BigInt(req.params.id)
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { post_id: true } })
    if (!comment) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
    }

    await prisma.comment.delete({ where: { id: commentId } })
    await prisma.post.update({ where: { id: comment.post_id }, data: { comment_count: { decrement: 1 } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/comments', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const commentIds = ids.map(id => BigInt(id))
    await prisma.comment.deleteMany({ where: { id: { in: commentIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除评论失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 标签管理 =====================
router.get('/tags', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { name, sortField = 'use_count', sortOrder = 'desc' } = req.query

    const where = name ? { name: { contains: name } } : {}

    const [total, tags] = await Promise.all([
      prisma.tag.count({ where }),
      prisma.tag.findMany({
        where,
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: tags, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取标签列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    const tag = await prisma.tag.findUnique({ where: { id: tagId } })

    if (!tag) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '标签不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: tag, message: 'success' })
  } catch (error) {
    console.error('获取标签详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/tags', adminAuth, async (req, res) => {
  try {
    const { name } = req.body
    if (!name) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '标签名不能为空' })
    }

    const existing = await prisma.tag.findUnique({ where: { name } })
    if (existing) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '标签已存在' })
    }

    const newTag = await prisma.tag.create({ data: { name } })
    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newTag.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    const { name } = req.body

    const tag = await prisma.tag.findUnique({ where: { id: tagId } })
    if (!tag) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '标签不存在' })
    }

    const updateData = {}
    if (name !== undefined) updateData.name = name

    await prisma.tag.update({ where: { id: tagId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/tags/:id', adminAuth, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id)
    await prisma.postTag.deleteMany({ where: { tag_id: tagId } })
    await prisma.tag.delete({ where: { id: tagId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/tags', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.postTag.deleteMany({ where: { tag_id: { in: ids } } })
    await prisma.tag.deleteMany({ where: { id: { in: ids } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除标签失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 点赞管理 =====================
router.get('/likes', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, target_type, target_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (target_type) where.target_type = parseInt(target_type)
    if (target_id) where.target_id = BigInt(target_id)

    const [total, likes] = await Promise.all([
      prisma.like.count({ where }),
      prisma.like.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedLikes = likes.map(l => ({
      id: Number(l.id),
      user_id: Number(l.user_id),
      target_type: l.target_type,
      target_id: Number(l.target_id),
      created_at: l.created_at,
      user_display_id: l.user?.user_id,
      nickname: l.user?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedLikes, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取点赞列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    const like = await prisma.like.findUnique({
      where: { id: likeId },
      include: { user: { select: { id: true, user_id: true, nickname: true } } }
    })

    if (!like) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '点赞记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: like, message: 'success' })
  } catch (error) {
    console.error('获取点赞详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/likes', adminAuth, async (req, res) => {
  try {
    const { user_id, target_type, target_id } = req.body

    if (!user_id || !target_type || !target_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    // Check target exists
    if (parseInt(target_type) === 1) {
      const post = await prisma.post.findUnique({ where: { id: BigInt(target_id) } })
      if (!post) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
      }
    } else {
      const comment = await prisma.comment.findUnique({ where: { id: BigInt(target_id) } })
      if (!comment) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '评论不存在' })
      }
    }

    const like = await prisma.like.create({
      data: {
        user_id: BigInt(user_id),
        target_type: parseInt(target_type),
        target_id: BigInt(target_id)
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(like.id) }, message: '点赞创建成功' })
  } catch (error) {
    console.error('创建点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    const { target_type, target_id } = req.body

    const like = await prisma.like.findUnique({ where: { id: likeId } })
    if (!like) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '点赞记录不存在' })
    }

    const updateData = {}
    if (target_type !== undefined && target_type !== '') updateData.target_type = parseInt(target_type)
    if (target_id !== undefined && target_id !== '') updateData.target_id = BigInt(target_id)

    await prisma.like.update({ where: { id: likeId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/likes/:id', adminAuth, async (req, res) => {
  try {
    const likeId = BigInt(req.params.id)
    await prisma.like.delete({ where: { id: likeId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/likes', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const likeIds = ids.map(id => BigInt(id))
    await prisma.like.deleteMany({ where: { id: { in: likeIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除点赞失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 收藏管理 =====================
router.get('/collections', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_display_id, post_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (post_id) where.post_id = BigInt(post_id)

    const [total, collections] = await Promise.all([
      prisma.collection.count({ where }),
      prisma.collection.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          post: { select: { id: true, title: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedCollections = collections.map(c => ({
      id: Number(c.id),
      user_id: Number(c.user_id),
      post_id: Number(c.post_id),
      created_at: c.created_at,
      user_display_id: c.user?.user_id,
      nickname: c.user?.nickname,
      post_title: c.post?.title
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedCollections, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取收藏列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: {
        user: { select: { id: true, user_id: true, nickname: true } },
        post: { select: { id: true, title: true } }
      }
    })

    if (!collection) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '收藏记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: collection, message: 'success' })
  } catch (error) {
    console.error('获取收藏详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/collections', adminAuth, async (req, res) => {
  try {
    const { user_id, post_id } = req.body

    if (!user_id || !post_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    const existing = await prisma.collection.findFirst({
      where: { user_id: BigInt(user_id), post_id: BigInt(post_id) }
    })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '已经收藏过该笔记' })
    }

    const collection = await prisma.collection.create({
      data: { user_id: BigInt(user_id), post_id: BigInt(post_id) }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(collection.id) }, message: '收藏创建成功' })
  } catch (error) {
    console.error('创建收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    const { post_id } = req.body

    const collection = await prisma.collection.findUnique({ where: { id: collectionId } })
    if (!collection) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '收藏记录不存在' })
    }

    if (post_id) {
      const post = await prisma.post.findUnique({ where: { id: BigInt(post_id) } })
      if (!post) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
      }
      await prisma.collection.update({ where: { id: collectionId }, data: { post_id: BigInt(post_id) } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/collections/:id', adminAuth, async (req, res) => {
  try {
    const collectionId = BigInt(req.params.id)
    await prisma.collection.delete({ where: { id: collectionId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/collections', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const collectionIds = ids.map(id => BigInt(id))
    await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除收藏失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 关注管理 =====================
router.get('/follows', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { follower_display_id, following_display_id, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (follower_display_id) where.follower = { user_id: follower_display_id }
    if (following_display_id) where.following = { user_id: following_display_id }

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where }),
      prisma.follow.findMany({
        where,
        include: {
          follower: { select: { id: true, user_id: true, nickname: true } },
          following: { select: { id: true, user_id: true, nickname: true } }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedFollows = follows.map(f => ({
      id: Number(f.id),
      follower_id: Number(f.follower_id),
      following_id: Number(f.following_id),
      created_at: f.created_at,
      follower_display_id: f.follower?.user_id,
      follower_nickname: f.follower?.nickname,
      following_display_id: f.following?.user_id,
      following_nickname: f.following?.nickname
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedFollows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取关注列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    const follow = await prisma.follow.findUnique({
      where: { id: followId },
      include: {
        follower: { select: { id: true, user_id: true, nickname: true } },
        following: { select: { id: true, user_id: true, nickname: true } }
      }
    })

    if (!follow) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: follow, message: 'success' })
  } catch (error) {
    console.error('获取关注详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/follows', adminAuth, async (req, res) => {
  try {
    const { follower_id, following_id } = req.body

    if (!follower_id || !following_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    if (follower_id === following_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' })
    }

    const follower = await prisma.user.findUnique({ where: { id: BigInt(follower_id) } })
    if (!follower) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注者不存在' })
    }

    const following = await prisma.user.findUnique({ where: { id: BigInt(following_id) } })
    if (!following) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '被关注者不存在' })
    }

    const existing = await prisma.follow.findFirst({
      where: { follower_id: BigInt(follower_id), following_id: BigInt(following_id) }
    })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '已经关注过了' })
    }

    const follow = await prisma.follow.create({
      data: { follower_id: BigInt(follower_id), following_id: BigInt(following_id) }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(follow.id) }, message: '关注创建成功' })
  } catch (error) {
    console.error('创建关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    const { following_id } = req.body

    const follow = await prisma.follow.findUnique({ where: { id: followId } })
    if (!follow) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '关注记录不存在' })
    }

    if (following_id) {
      if (BigInt(following_id) === follow.follower_id) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '不能关注自己' })
      }
      await prisma.follow.update({ where: { id: followId }, data: { following_id: BigInt(following_id) } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/follows/:id', adminAuth, async (req, res) => {
  try {
    const followId = BigInt(req.params.id)
    await prisma.follow.delete({ where: { id: followId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/follows', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const followIds = ids.map(id => BigInt(id))
    await prisma.follow.deleteMany({ where: { id: { in: followIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除关注失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 会话管理（从 Redis 获取） =====================
router.get('/sessions', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const { user_display_id, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query

    // 解析活跃状态过滤（空字符串视为不过滤）
    let isActiveFilter
    if (is_active !== undefined && is_active !== '') {
      isActiveFilter = is_active === 'true' || is_active === '1'
    }

    // 获取用户信息的辅助函数（用于按汐社号过滤）
    const getUserInfo = async (userId) => {
      try {
        const user = await prisma.user.findUnique({
          where: { id: BigInt(userId) },
          select: { id: true, user_id: true, nickname: true }
        })
        return user
      } catch {
        return null
      }
    }

    const { sessions, total } = await sessionService.listSessions({
      page,
      limit,
      user_display_id,
      is_active: isActiveFilter,
      sortField,
      sortOrder: sortOrder.toLowerCase(),
      getUserInfo
    })

    // 格式化会话数据，批量获取用户信息
    const userIdsToFetch = [...new Set(sessions.filter(s => !s._userInfo).map(s => s.user_id))]
    const userInfoMap = {}
    if (userIdsToFetch.length > 0) {
      try {
        const users = await prisma.user.findMany({
          where: { id: { in: userIdsToFetch.map(id => BigInt(id)) } },
          select: { id: true, user_id: true, nickname: true }
        })
        for (const u of users) {
          userInfoMap[String(u.id)] = u
        }
      } catch {}
    }

    const formattedSessions = sessions.map(s => {
      const userInfo = s._userInfo || userInfoMap[String(s.user_id)]
      return {
        id: Number(s.id),
        user_id: Number(s.user_id),
        refresh_token: s.refresh_token,
        user_agent: s.user_agent,
        is_active: s.is_active,
        expires_at: s.expires_at,
        created_at: s.created_at,
        user_display_id: userInfo?.user_id,
        nickname: userInfo?.nickname
      }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedSessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取会话列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = req.params.id
    const session = await sessionService.findSessionById(sessionId)

    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '会话不存在' })
    }

    // 获取用户信息
    let userInfo = null
    try {
      userInfo = await prisma.user.findUnique({
        where: { id: BigInt(session.user_id) },
        select: { id: true, user_id: true, nickname: true }
      })
    } catch {}

    const formattedSession = {
      ...session,
      id: Number(session.id),
      user_id: Number(session.user_id),
      user: userInfo ? { id: Number(userInfo.id), user_id: userInfo.user_id, nickname: userInfo.nickname } : null
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: formattedSession, message: 'success' })
  } catch (error) {
    console.error('获取会话详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/sessions', adminAuth, async (req, res) => {
  try {
    const { user_id, user_agent, is_active } = req.body

    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const refresh_token = crypto.randomBytes(32).toString('hex')
    const expires_at = new Date()
    expires_at.setDate(expires_at.getDate() + 30)

    const session = await sessionService.createSession({
      user_id: BigInt(user_id),
      token,
      refresh_token,
      user_agent: user_agent || '',
      is_active: is_active !== undefined ? Boolean(is_active) : true,
      expires_at
    })

    if (!session) {
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(session.id) }, message: '会话创建成功' })
  } catch (error) {
    console.error('创建会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = req.params.id
    const { user_agent, is_active } = req.body

    const session = await sessionService.findSessionById(sessionId)
    if (!session) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '会话不存在' })
    }

    const updateData = {}
    if (user_agent !== undefined) updateData.user_agent = user_agent
    if (is_active !== undefined) updateData.is_active = Boolean(is_active)

    await sessionService.updateSession(sessionId, updateData)
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/sessions/:id', adminAuth, async (req, res) => {
  try {
    const sessionId = req.params.id
    await sessionService.deleteSessionById(sessionId)
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/sessions', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await sessionService.deleteSessionsByIds(ids)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除会话失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 用户管理 =====================
router.get('/users', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_id, nickname, location, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (user_id) where.user_id = { contains: user_id }
    if (nickname) where.nickname = { contains: nickname }
    if (location) where.location = { contains: location }
    if (is_active !== undefined && is_active !== '') where.is_active = parseInt(is_active) === 1

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, user_id: true, nickname: true, avatar: true, bio: true,
          location: true, email: true, follow_count: true, fans_count: true,
          like_count: true, is_active: true, created_at: true, verified: true
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedUsers = users.map(u => ({ ...u, id: Number(u.id) }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedUsers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, user_id: true, nickname: true, avatar: true, bio: true,
        location: true, email: true, follow_count: true, fans_count: true,
        like_count: true, is_active: true, created_at: true, verified: true,
        gender: true, zodiac_sign: true, mbti: true, education: true, major: true
      }
    })

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { ...user, id: Number(user.id) }, message: 'success' })
  } catch (error) {
    console.error('获取用户详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/users', adminAuth, async (req, res) => {
  try {
    const { user_id, nickname, avatar, bio, location, is_active, password, gender, zodiac_sign, mbti, education, major, interests, verified } = req.body

    if (!user_id || !nickname) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const existing = await prisma.user.findUnique({ where: { user_id } })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: 'user_id已存在' })
    }

    // Hash password using SHA256
    const hashedPassword = password 
      ? crypto.createHash('sha256').update(password).digest('hex')
      : crypto.createHash('sha256').update('123456').digest('hex')

    const user = await prisma.user.create({
      data: {
        user_id,
        nickname,
        password: hashedPassword,
        avatar: avatar || '',
        bio: bio || '',
        location: location || '',
        is_active: is_active !== undefined ? Boolean(is_active) : true,
        gender: gender || null,
        zodiac_sign: zodiac_sign || null,
        mbti: mbti || null,
        education: education || null,
        major: major || null,
        interests: interests || null,
        verified: verified !== undefined ? parseInt(verified) || 0 : 0
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(user.id) }, message: '用户创建成功' })
  } catch (error) {
    console.error('创建用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const { user_id, nickname, avatar, bio, location, is_active, gender, zodiac_sign, mbti, education, major, interests, verified } = req.body

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    const updateData = {}
    if (user_id !== undefined) updateData.user_id = user_id
    if (nickname !== undefined) updateData.nickname = nickname
    if (avatar !== undefined) updateData.avatar = avatar
    if (bio !== undefined) updateData.bio = bio
    if (location !== undefined) updateData.location = location
    if (is_active !== undefined) updateData.is_active = Boolean(is_active)
    if (gender !== undefined) updateData.gender = gender
    if (zodiac_sign !== undefined) updateData.zodiac_sign = zodiac_sign
    if (mbti !== undefined) updateData.mbti = mbti
    if (education !== undefined) updateData.education = education
    if (major !== undefined) updateData.major = major
    if (interests !== undefined) updateData.interests = interests
    if (verified !== undefined) updateData.verified = parseInt(verified) || 0

    await prisma.user.update({ where: { id: userId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const userId = BigInt(req.params.id)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }

    await prisma.user.delete({ where: { id: userId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/users', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const userIds = ids.map(id => BigInt(id))
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除用户失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 管理员管理 =====================
router.get('/admins', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { username, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = username ? { username: { contains: username } } : {}

    const [total, admins] = await Promise.all([
      prisma.admin.count({ where }),
      prisma.admin.findMany({
        where,
        select: { id: true, username: true, created_at: true },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedAdmins = admins.map(a => ({ ...a, id: Number(a.id) }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedAdmins, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取管理员列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.get('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true, created_at: true }
    })

    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { ...admin, id: Number(admin.id) }, message: 'success' })
  } catch (error) {
    console.error('获取管理员详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/admins', adminAuth, async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const existing = await prisma.admin.findUnique({ where: { username } })
    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '用户名已存在' })
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex')

    const admin = await prisma.admin.create({
      data: { username, password: hashedPassword }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(admin.id) }, message: '管理员创建成功' })
  } catch (error) {
    console.error('创建管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    const { password } = req.body

    const admin = await prisma.admin.findUnique({ where: { id: adminId } })
    if (!admin) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '管理员不存在' })
    }

    if (password) {
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex')
      await prisma.admin.update({ where: { id: adminId }, data: { password: hashedPassword } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/admins/:id', adminAuth, async (req, res) => {
  try {
    const adminId = BigInt(req.params.id)
    await prisma.admin.delete({ where: { id: adminId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/admins', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const adminIds = ids.map(id => BigInt(id))
    await prisma.admin.deleteMany({ where: { id: { in: adminIds } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除管理员失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 监控动态 =====================
router.get('/monitor/activities', adminAuth, async (req, res) => {
  try {
    const activities = []

    const [newUsers, newPosts, newComments] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, user_id: true, nickname: true, avatar: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 10
      }),
      prisma.post.findMany({
        where: { is_draft: false },
        select: { id: true, title: true, created_at: true, user: { select: { user_id: true, nickname: true, avatar: true } } },
        orderBy: { created_at: 'desc' },
        take: 10
      }),
      prisma.comment.findMany({
        select: { 
          id: true, content: true, post_id: true, created_at: true,
          user: { select: { user_id: true, nickname: true, avatar: true } },
          post: { select: { title: true } }
        },
        orderBy: { created_at: 'desc' },
        take: 10
      })
    ])

    newUsers.forEach(user => {
      activities.push({
        id: 'user_' + user.id,
        type: 'user_register',
        user_id: user.user_id,
        nickname: user.nickname,
        avatar: user.avatar,
        title: '新用户注册',
        content: '用户 ' + user.nickname + ' (' + user.user_id + ') 注册了账号',
        target_id: Number(user.id),
        created_at: user.created_at
      })
    })

    newPosts.forEach(post => {
      activities.push({
        id: 'post_' + post.id,
        type: 'post_publish',
        user_id: post.user?.user_id,
        nickname: post.user?.nickname,
        avatar: post.user?.avatar,
        title: post.title,
        content: post.user?.nickname + ' 发布了笔记《' + post.title + '》',
        target_id: Number(post.id),
        created_at: post.created_at
      })
    })

    newComments.forEach(comment => {
      activities.push({
        id: Number(comment.id),
        type: 'comment_publish',
        user_id: comment.user?.user_id,
        nickname: comment.user?.nickname,
        avatar: comment.user?.avatar,
        title: comment.post?.title,
        content: comment.content,
        description: comment.user?.nickname + ' 在《' + comment.post?.title + '》中发表了评论',
        target_id: Number(comment.post_id),
        created_at: comment.created_at
      })
    })

    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '获取动态成功', data: activities })
  } catch (error) {
    console.error('获取监控动态失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取动态失败', error: error.message })
  }
})

// ===================== 测试用户接口 =====================
router.get('/test-users', adminAuth, async (req, res) => {
  try {
    const likes = await prisma.like.findMany({ select: { user_id: true }, distinct: ['user_id'], take: 10 })
    const userIds = likes.map(l => l.user_id)
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, user_id: true, nickname: true }
    })
    res.json({ code: RESPONSE_CODES.SUCCESS, data: users.map(u => ({ ...u, id: Number(u.id) })) })
  } catch (error) {
    console.error('测试用户数据失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '服务器错误' })
  }
})

// ===================== 分类管理 =====================
router.get('/categories', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { name, category_title, sortField = 'id', sortOrder = 'asc' } = req.query

    const where = {}
    if (name) where.name = { contains: name }
    if (category_title) where.category_title = { contains: category_title }

    const [total, categories] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        include: { _count: { select: { posts: true } } },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formatted = categories.map(c => ({
      id: c.id,
      name: c.name,
      category_title: c.category_title,
      created_at: c.created_at,
      post_count: c._count.posts
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: formatted,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      message: '获取成功'
    })
  } catch (error) {
    console.error('获取分类列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取分类列表失败' })
  }
})

router.get('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { posts: true } } }
    })

    if (!category) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: category, message: 'success' })
  } catch (error) {
    console.error('获取分类详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

router.post('/categories', adminAuth, async (req, res) => {
  try {
    const { name, category_title } = req.body

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
    }

    if (!category_title || !category_title.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类英文标题不能为空' })
    }

    const existingName = await prisma.category.findUnique({ where: { name: name.trim() } })
    if (existingName) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
    }

    const existingTitle = await prisma.category.findUnique({ where: { category_title: category_title.trim() } })
    if (existingTitle) {
      return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类英文标题已存在' })
    }

    const newCategory = await prisma.category.create({
      data: { name: name.trim(), category_title: category_title.trim() }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newCategory.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)
    const { name, category_title } = req.body

    const category = await prisma.category.findUnique({ where: { id: categoryId } })
    if (!category) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    const updateData = {}

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
      }
      const existingName = await prisma.category.findFirst({ where: { name: name.trim(), NOT: { id: categoryId } } })
      if (existingName) {
        return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
      }
      updateData.name = name.trim()
    }

    if (category_title !== undefined) {
      if (!category_title.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类英文标题不能为空' })
      }
      const existingTitle = await prisma.category.findFirst({ where: { category_title: category_title.trim(), NOT: { id: categoryId } } })
      if (existingTitle) {
        return res.status(HTTP_STATUS.CONFLICT).json({ code: RESPONSE_CODES.CONFLICT, message: '分类英文标题已存在' })
      }
      updateData.category_title = category_title.trim()
    }

    await prisma.category.update({ where: { id: categoryId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)

    const postCount = await prisma.post.count({ where: { category_id: categoryId } })
    if (postCount > 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '该分类下还有 ' + postCount + ' 篇笔记，无法删除' })
    }

    await prisma.category.delete({ where: { id: categoryId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.delete('/categories', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const posts = await prisma.post.groupBy({
      by: ['category_id'],
      where: { category_id: { in: ids } },
      _count: true
    })

    if (posts.length > 0) {
      const categoryIds = posts.map(p => p.category_id).join(', ')
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '分类 ' + categoryIds + ' 下还有笔记，无法删除' })
    }

    await prisma.category.deleteMany({ where: { id: { in: ids } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 内容审核管理 (type 3,4) =====================
router.get('/content-review', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { user_id, user_display_id, type, status, sortBy = 'created_at', sortOrder = 'DESC' } = req.query

    const where = { type: { in: [3, 4] } }
    if (user_id) where.user_id = BigInt(user_id)
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }
    if (type) where.type = parseInt(type)
    if (status !== undefined && status !== '') where.status = parseInt(status)

    const [total, audits] = await Promise.all([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } },
        orderBy: { [sortBy]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedAudits = audits.map(a => ({
      id: Number(a.id),
      user_id: Number(a.user_id),
      type: a.type,
      target_id: a.target_id ? Number(a.target_id) : null,
      content: a.content,
      risk_level: a.risk_level,
      categories: a.categories,
      reason: a.reason,
      status: a.status,
      created_at: a.created_at,
      audit_time: a.audit_time,
      user_display_id: a.user?.user_id,
      nickname: a.user?.nickname,
      avatar: a.user?.avatar
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取审核列表成功',
      data: { data: formattedAudits, total, page, limit }
    })
  } catch (error) {
    console.error('获取审核列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取审核列表失败', error: error.message })
  }
})

// 获取AI审核设置 - 必须在 /:id 路由之前定义，避免被匹配
router.get('/content-review/settings', adminAuth, async (req, res) => {
  const usernameEnabled = settingsService.isAiUsernameReviewEnabled()
  const contentEnabled = settingsService.isAiContentReviewEnabled()
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    message: '获取设置成功',
    data: { 
      ai_auto_review: usernameEnabled || contentEnabled,
      ai_username_review: usernameEnabled,
      ai_content_review: contentEnabled
    }
  })
})

// 更新AI审核设置 - 必须在 /:id 路由之前定义，避免被匹配
router.put('/content-review/settings', adminAuth, async (req, res) => {
  try {
    const { ai_auto_review, ai_username_review, ai_content_review } = req.body
    
    // 支持分开设置用户名审核和内容审核
    if (ai_username_review !== undefined) {
      await settingsService.setAiUsernameReviewEnabled(!!ai_username_review)
    }
    if (ai_content_review !== undefined) {
      await settingsService.setAiContentReviewEnabled(!!ai_content_review)
    }
    // 兼容旧接口：如果只传了ai_auto_review，则同时设置两个开关
    if (ai_auto_review !== undefined && ai_username_review === undefined && ai_content_review === undefined) {
      const newValue = !!ai_auto_review
      await settingsService.setAiUsernameReviewEnabled(newValue)
      await settingsService.setAiContentReviewEnabled(newValue)
    }

    // 获取更新后的值
    const usernameEnabled = settingsService.isAiUsernameReviewEnabled()
    const contentEnabled = settingsService.isAiContentReviewEnabled()

    const messages = []
    if (ai_username_review !== undefined) {
      messages.push(`用户名AI审核已${usernameEnabled ? '开启' : '关闭'}`)
    }
    if (ai_content_review !== undefined) {
      messages.push(`内容AI审核已${contentEnabled ? '开启' : '关闭'}`)
    }
    if (messages.length === 0 && ai_auto_review !== undefined) {
      messages.push(`AI自动审核已${usernameEnabled ? '开启' : '关闭'}`)
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: messages.join('，') || '设置已更新',
      data: { 
        ai_auto_review: usernameEnabled || contentEnabled,
        ai_username_review: usernameEnabled,
        ai_content_review: contentEnabled
      }
    })
  } catch (error) {
    console.error('更新设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新设置失败', error: error.message })
  }
})

router.get('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [3, 4] } },
      include: { user: { select: { id: true, user_id: true, nickname: true, avatar: true } } }
    })

    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '获取审核记录成功', data: audit })
  } catch (error) {
    console.error('获取审核记录失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取审核记录失败', error: error.message })
  }
})

router.post('/content-review', adminAuth, async (req, res) => {
  try {
    const { user_id, type, content, target_id } = req.body

    if (!user_id || !type || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const audit = await prisma.audit.create({
      data: {
        user_id: BigInt(user_id),
        type: parseInt(type),
        content,
        target_id: target_id ? BigInt(target_id) : null,
        status: 0
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(audit.id) }, message: '创建成功' })
  } catch (error) {
    console.error('创建内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

router.put('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const { type, content, status, audit_time } = req.body

    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '审核记录不存在' })
    }

    const updateData = {}
    if (type !== undefined && type !== '') updateData.type = parseInt(type)
    if (content !== undefined) updateData.content = content
    if (status !== undefined && status !== '') updateData.status = parseInt(status)
    if (audit_time !== undefined && audit_time !== '') updateData.audit_time = new Date(audit_time)

    await prisma.audit.update({ where: { id: auditId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

router.delete('/content-review/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)

    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    // If comment review and has target_id, delete the comment first
    if (audit.type === 3 && audit.target_id) {
      await prisma.like.deleteMany({ where: { target_type: 2, target_id: audit.target_id } })
      await prisma.comment.deleteMany({ where: { id: audit.target_id } })
    }

    await prisma.audit.delete({ where: { id: auditId } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除审核记录失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败', error: error.message })
  }
})

router.delete('/content-review', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    const auditIds = ids.map(id => BigInt(id))
    await prisma.audit.deleteMany({ where: { id: { in: auditIds }, type: { in: [3, 4] } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除内容审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

router.put('/content-review/:id/approve', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 1, audit_time: new Date() }
    })

    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 1, is_public: true } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '审核通过成功' })
  } catch (error) {
    console.error('审核通过失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '审核通过失败', error: error.message })
  }
})

router.put('/content-review/:id/reject', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [3, 4] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 2, audit_time: new Date() }
    })

    if (audit.type === 3 && audit.target_id) {
      await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 2, is_public: false } })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '拒绝成功' })
  } catch (error) {
    console.error('拒绝失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '拒绝失败', error: error.message })
  }
})

router.put('/content-review/:id/retry', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)

    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [3, 4] } }
    })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '审核记录不存在' })
    }

    const retryCount = audit.retry_count || 0
    if (retryCount >= 5) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '已达到最大重试次数（5次）' })
    }

    if (audit.status !== 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '只有待审核状态的记录可以重试' })
    }

    const aiResult = await auditComment(audit.content, Number(audit.user_id))

    let detailedReason = ''
    let newStatus = 0
    if (aiResult) {
      const parts = []
      if (aiResult.reason) parts.push('AI审核结果: ' + aiResult.reason)
      if (aiResult.suggestion) parts.push('建议: ' + aiResult.suggestion)
      if (aiResult.passed !== undefined) parts.push('是否通过: ' + (aiResult.passed ? '是' : '否'))
      if (aiResult.score !== undefined) parts.push('风险分数: ' + aiResult.score)
      if (aiResult.matched_keywords && aiResult.matched_keywords.length > 0) {
        parts.push('匹配关键词: ' + aiResult.matched_keywords.join(', '))
      }
      if (aiResult.problem_sentences && aiResult.problem_sentences.length > 0) {
        parts.push('问题句子: ' + aiResult.problem_sentences.join('; '))
      }
      detailedReason = parts.join(' | ')

      if (aiResult.passed === true) {
        newStatus = 1
        detailedReason = '[AI重试审核通过 第' + (retryCount + 1) + '次] ' + detailedReason
        if (audit.type === 3 && audit.target_id) {
          await prisma.comment.update({ where: { id: audit.target_id }, data: { audit_status: 1, is_public: true } })
        }
      } else if (aiResult.passed === false) {
        newStatus = 2
        detailedReason = '[AI重试审核拒绝 第' + (retryCount + 1) + '次] ' + detailedReason
        if (audit.type === 3 && audit.target_id) {
          await prisma.comment.delete({ where: { id: audit.target_id } })
          await prisma.audit.update({ where: { id: auditId }, data: { target_id: null } })
        }
      } else {
        detailedReason = '[AI重试审核 第' + (retryCount + 1) + '次] ' + detailedReason
      }
    } else {
      detailedReason = '[AI重试审核失败 第' + (retryCount + 1) + '次] AI服务无响应'
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: {
        audit_result: aiResult || undefined,
        risk_level: aiResult?.risk_level || 'unknown',
        categories: aiResult?.categories || [],
        reason: detailedReason,
        status: newStatus,
        retry_count: retryCount + 1,
        audit_time: newStatus !== 0 ? new Date() : audit.audit_time
      }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: newStatus === 1 ? 'AI重试审核通过' : (newStatus === 2 ? 'AI重试审核拒绝' : 'AI重试完成，仍待审核'),
      data: { status: newStatus, retry_count: retryCount + 1, ai_result: aiResult }
    })
  } catch (error) {
    console.error('重试AI审核失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重试AI审核失败', error: error.message })
  }
})

// ===================== 统计信息 =====================
router.get('/stats/overview', adminAuth, async (req, res) => {
  try {
    const [usersCount, postsCount, commentsCount, likesCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.like.count()
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { users: usersCount, posts: postsCount, comments: commentsCount, likes: likesCount },
      message: 'success'
    })
  } catch (error) {
    console.error('获取统计信息失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// ===================== 队列管理 =====================

// 获取队列统计信息
router.get('/queues', adminAuth, async (req, res) => {
  try {
    const stats = await getQueueStats()
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: stats,
      message: 'success'
    })
  } catch (error) {
    console.error('获取队列统计失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取队列统计失败' })
  }
})

// 获取队列任务列表
router.get('/queues/:name/jobs', adminAuth, async (req, res) => {
  try {
    const { name } = req.params
    const { status = 'waiting', start = 0, end = 20 } = req.query

    const result = await getQueueJobs(name, status, parseInt(start), parseInt(end))
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: result,
      message: 'success'
    })
  } catch (error) {
    console.error('获取队列任务列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取队列任务列表失败' })
  }
})

// 获取单个任务详情（包含完整的返回结果数据）
router.get('/queues/:name/jobs/:jobId', adminAuth, async (req, res) => {
  try {
    const { name, jobId } = req.params

    const result = await getJobDetails(name, jobId)
    if (result.error) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: result.error })
    } else {
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: result,
        message: 'success'
      })
    }
  } catch (error) {
    console.error('获取任务详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取任务详情失败' })
  }
})

// 重试失败的任务
router.post('/queues/:name/jobs/:jobId/retry', adminAuth, async (req, res) => {
  try {
    const { name, jobId } = req.params

    const result = await retryJob(name, jobId)
    if (result.success) {
      res.json({ code: RESPONSE_CODES.SUCCESS, message: result.message })
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: result.message })
    }
  } catch (error) {
    console.error('重试任务失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重试任务失败' })
  }
})

// 清空队列
router.delete('/queues/:name', adminAuth, async (req, res) => {
  try {
    const { name } = req.params

    const result = await cleanQueue(name)
    if (result.success) {
      res.json({ code: RESPONSE_CODES.SUCCESS, message: result.message })
    } else {
      res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: result.message })
    }
  } catch (error) {
    console.error('清空队列失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '清空队列失败' })
  }
})

// 获取队列名称列表
router.get('/queue-names', adminAuth, (req, res) => {
  res.json({
    code: RESPONSE_CODES.SUCCESS,
    data: {
      enabled: isQueueEnabled(),
      names: Object.values(QUEUE_NAMES)
    },
    message: 'success'
  })
})

// ===================== 违禁词管理 =====================
const { forceRefreshCache } = require('../utils/bannedWordsChecker')

// 获取违禁词列表
router.get('/banned-words', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 50
    const skip = (page - 1) * limit
    const { word, category_id, enabled, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (word) where.word = { contains: word }
    if (category_id !== undefined && category_id !== '' && category_id !== 'all') {
      where.category_id = category_id === 'null' ? null : parseInt(category_id)
    }
    if (enabled !== undefined && enabled !== '') where.enabled = enabled === 'true' || enabled === '1'

    const [total, words] = await Promise.all([
      prisma.bannedWord.count({ where }),
      prisma.bannedWord.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true }
          }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: words, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取违禁词列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取单个违禁词
router.get('/banned-words/:id', adminAuth, async (req, res) => {
  try {
    const wordId = parseInt(req.params.id)
    const word = await prisma.bannedWord.findUnique({ 
      where: { id: wordId },
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    })

    if (!word) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '违禁词不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: word, message: 'success' })
  } catch (error) {
    console.error('获取违禁词详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建违禁词
router.post('/banned-words', adminAuth, async (req, res) => {
  try {
    const { word, category_id, is_regex, enabled } = req.body

    if (!word || !word.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '违禁词不能为空' })
    }

    const newWord = await prisma.bannedWord.create({
      data: {
        word: word.trim(),
        category_id: category_id ? parseInt(category_id) : null,
        is_regex: !!is_regex,
        enabled: enabled !== false
      }
    })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newWord.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新违禁词
router.put('/banned-words/:id', adminAuth, async (req, res) => {
  try {
    const wordId = parseInt(req.params.id)
    const { word, category_id, is_regex, enabled } = req.body

    const existing = await prisma.bannedWord.findUnique({ where: { id: wordId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '违禁词不存在' })
    }

    const updateData = {}
    if (word !== undefined) updateData.word = word.trim()
    if (category_id !== undefined) updateData.category_id = category_id ? parseInt(category_id) : null
    if (is_regex !== undefined) updateData.is_regex = !!is_regex
    if (enabled !== undefined) updateData.enabled = !!enabled

    await prisma.bannedWord.update({ where: { id: wordId }, data: updateData })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除违禁词
router.delete('/banned-words/:id', adminAuth, async (req, res) => {
  try {
    const wordId = parseInt(req.params.id)
    await prisma.bannedWord.delete({ where: { id: wordId } })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除违禁词
router.delete('/banned-words', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.bannedWord.deleteMany({ where: { id: { in: ids.map(id => parseInt(id)) } } })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量导入违禁词
router.post('/banned-words/import', adminAuth, async (req, res) => {
  try {
    const { words, category_id, isRegex } = req.body

    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要导入的违禁词列表' })
    }

    // 过滤空值和重复值
    const uniqueWords = [...new Set(words.filter(w => w && w.trim()).map(w => w.trim()))]

    // 批量创建，如果指定了isRegex则使用该值，否则自动检测通配符
    const created = await prisma.bannedWord.createMany({
      data: uniqueWords.map(word => ({
        word,
        category_id: category_id ? parseInt(category_id) : null,
        is_regex: isRegex || word.includes('*') || word.includes('?'),
        enabled: true
      })),
      skipDuplicates: true
    })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { count: created.count }, message: `成功导入 ${created.count} 个违禁词` })
  } catch (error) {
    console.error('批量导入违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '导入失败' })
  }
})

// 导出违禁词
router.get('/banned-words/export', adminAuth, async (req, res) => {
  try {
    const { category_id } = req.query

    const where = { enabled: true }
    if (category_id && category_id !== 'all') {
      where.category_id = category_id === 'null' ? null : parseInt(category_id)
    }

    const words = await prisma.bannedWord.findMany({
      where,
      select: { word: true, is_regex: true },
      orderBy: { word: 'asc' }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        category_id: category_id || 'all',
        words: words.map(w => w.word),
        count: words.length
      },
      message: 'success'
    })
  } catch (error) {
    console.error('导出违禁词失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '导出失败' })
  }
})

// ===================== 违禁词分类管理 =====================

// 获取违禁词分类列表
router.get('/banned-word-categories', adminAuth, async (req, res) => {
  try {
    const categories = await prisma.bannedWordCategory.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { words: true }
        }
      }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: categories.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        word_count: c._count.words,
        created_at: c.created_at,
        updated_at: c.updated_at
      })),
      message: 'success'
    })
  } catch (error) {
    console.error('获取违禁词分类列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建违禁词分类
router.post('/banned-word-categories', adminAuth, async (req, res) => {
  try {
    const { name, description } = req.body

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
    }

    // 检查名称是否已存在
    const existing = await prisma.bannedWordCategory.findUnique({ where: { name: name.trim() } })
    if (existing) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
    }

    const newCategory = await prisma.bannedWordCategory.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newCategory.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建违禁词分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新违禁词分类
router.put('/banned-word-categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)
    const { name, description } = req.body

    const existing = await prisma.bannedWordCategory.findUnique({ where: { id: categoryId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    const updateData = {}
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '分类名称不能为空' })
      }
      // 检查名称是否与其他分类冲突
      const nameConflict = await prisma.bannedWordCategory.findFirst({
        where: { name: name.trim(), id: { not: categoryId } }
      })
      if (nameConflict) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.CONFLICT, message: '分类名称已存在' })
      }
      updateData.name = name.trim()
    }
    if (description !== undefined) updateData.description = description?.trim() || null

    await prisma.bannedWordCategory.update({ where: { id: categoryId }, data: updateData })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新违禁词分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除违禁词分类
router.delete('/banned-word-categories/:id', adminAuth, async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id)

    const existing = await prisma.bannedWordCategory.findUnique({ where: { id: categoryId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '分类不存在' })
    }

    // 删除分类（关联的违禁词的category_id会被设为null）
    await prisma.bannedWordCategory.delete({ where: { id: categoryId } })

    // 刷新缓存
    await forceRefreshCache(prisma)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除违禁词分类失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 批量上传管理 =====================
const fs = require('fs')
const pathModule = require('path')

// 支持的文件扩展名常量
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']

// 获取 /uploads/plsc 目录下的所有图片和视频文件
router.get('/batch-upload/files', adminAuth, async (req, res) => {
  try {
    const plscDir = pathModule.join(process.cwd(), 'uploads', 'plsc')
    
    // 检查目录是否存在
    if (!fs.existsSync(plscDir)) {
      // 创建目录
      fs.mkdirSync(plscDir, { recursive: true })
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: { images: [], videos: [] },
        message: '目录为空'
      })
    }
    
    const files = fs.readdirSync(plscDir)
    const images = []
    const videos = []
    
    for (const file of files) {
      const ext = pathModule.extname(file).toLowerCase()
      const filePath = pathModule.join(plscDir, file)
      const stat = fs.statSync(filePath)
      
      if (stat.isFile()) {
        const fileInfo = {
          name: file,
          size: stat.size,
          path: `/uploads/plsc/${file}`,
          createdAt: stat.birthtime
        }
        
        if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
          images.push(fileInfo)
        } else if (SUPPORTED_VIDEO_EXTENSIONS.includes(ext)) {
          videos.push(fileInfo)
        }
      }
    }
    
    // 按创建时间排序
    images.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { images, videos },
      message: '获取成功'
    })
  } catch (error) {
    console.error('获取批量上传文件列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取文件列表失败' })
  }
})

// 批量创建笔记（从plsc目录）
router.post('/batch-upload/create', adminAuth, async (req, res) => {
  try {
    const { user_id, type, images_per_note, title, content, tags, is_draft, files } = req.body
    
    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少用户ID' })
    }
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有选择文件' })
    }
    
    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }
    
    const config = require('../config/config')
    const baseUrl = config?.upload?.image?.local?.baseUrl || config?.api?.baseUrl || 'http://localhost:3001'
    const imagesPerNote = parseInt(images_per_note) || 4
    const postType = parseInt(type) || 1
    const createdPosts = []
    
    if (postType === 1) {
      // 图文笔记：按images_per_note分组
      for (let i = 0; i < files.length; i += imagesPerNote) {
        const groupFiles = files.slice(i, i + imagesPerNote)
        
        // 创建笔记
        const post = await prisma.post.create({
          data: {
            user_id: BigInt(user_id),
            title: title || '',
            content: content || '',
            type: 1,
            is_draft: is_draft !== undefined ? Boolean(is_draft) : false
          }
        })
        
        // 添加图片
        const imageUrls = groupFiles.map(file => `${baseUrl}${file.path}`)
        if (imageUrls.length > 0) {
          await prisma.postImage.createMany({
            data: imageUrls.map(url => ({
              post_id: post.id,
              image_url: url
            }))
          })
        }
        
        // 添加标签
        if (tags && tags.length > 0) {
          for (const tag of tags) {
            let tagId
            let tagName = typeof tag === 'string' ? tag : tag.name
            
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            if (existingTag) {
              tagId = existingTag.id
            } else {
              const newTag = await prisma.tag.create({ data: { name: tagName } })
              tagId = newTag.id
            }
            
            await prisma.postTag.create({ data: { post_id: post.id, tag_id: tagId } })
            await prisma.tag.update({ where: { id: tagId }, data: { use_count: { increment: 1 } } })
          }
        }
        
        createdPosts.push({ id: Number(post.id), imageCount: groupFiles.length })
      }
    } else {
      // 视频笔记：每个视频一个笔记
      for (const file of files) {
        const post = await prisma.post.create({
          data: {
            user_id: BigInt(user_id),
            title: title || '',
            content: content || '',
            type: 2,
            is_draft: is_draft !== undefined ? Boolean(is_draft) : false
          }
        })
        
        // 添加视频
        await prisma.postVideo.create({
          data: {
            post_id: post.id,
            video_url: `${baseUrl}${file.path}`,
            cover_url: ''
          }
        })
        
        // 添加标签
        if (tags && tags.length > 0) {
          for (const tag of tags) {
            let tagId
            let tagName = typeof tag === 'string' ? tag : tag.name
            
            const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
            if (existingTag) {
              tagId = existingTag.id
            } else {
              const newTag = await prisma.tag.create({ data: { name: tagName } })
              tagId = newTag.id
            }
            
            await prisma.postTag.create({ data: { post_id: post.id, tag_id: tagId } })
            await prisma.tag.update({ where: { id: tagId }, data: { use_count: { increment: 1 } } })
          }
        }
        
        createdPosts.push({ id: Number(post.id) })
      }
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { posts: createdPosts, count: createdPosts.length },
      message: `成功创建 ${createdPosts.length} 条笔记`
    })
  } catch (error) {
    console.error('批量创建笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '批量创建失败' })
  }
})

// 删除plsc目录中的文件
router.delete('/batch-upload/files', adminAuth, async (req, res) => {
  try {
    const { files } = req.body
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有选择文件' })
    }
    
    const plscDir = pathModule.join(process.cwd(), 'uploads', 'plsc')
    let deletedCount = 0
    
    for (const file of files) {
      const fileName = pathModule.basename(file.path || file.name || file)
      const filePath = pathModule.join(plscDir, fileName)
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        deletedCount++
      }
    }
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { deletedCount },
      message: `成功删除 ${deletedCount} 个文件`
    })
  } catch (error) {
    console.error('删除文件失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除文件失败' })
  }
})

// 异步批量创建笔记（使用队列，点击后自动上传无需等待）
router.post('/batch-upload/async-create', adminAuth, async (req, res) => {
  try {
    const { user_id, type, images_per_note, tags, is_draft, notes } = req.body
    
    if (!user_id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少用户ID' })
    }
    
    if (!notes || !Array.isArray(notes) || notes.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '没有笔记数据' })
    }
    
    const user = await prisma.user.findUnique({ where: { id: BigInt(user_id) } })
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '用户不存在' })
    }
    
    const postType = parseInt(type) || 1
    const { addBatchNoteCreateTask } = require('../utils/queueService')
    
    // 尝试使用队列进行异步处理
    const queueResult = await addBatchNoteCreateTask(notes, user_id, postType, tags || [], is_draft || false)
    
    if (queueResult.queueEnabled && queueResult.jobs) {
      // 队列成功添加任务，立即返回
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: {
          batchId: queueResult.batchId,
          totalNotes: notes.length,
          async: true,
          message: '笔记创建任务已加入队列，正在后台处理'
        },
        message: `已将 ${notes.length} 条笔记加入创建队列`
      })
    } else {
      // 队列未启用，使用同步处理
      const config = require('../config/config')
      const baseUrl = config?.upload?.image?.local?.baseUrl || config?.api?.baseUrl || 'http://localhost:3001'
      const createdPosts = []
      const failedNotes = []
      
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i]
        try {
          const post = await prisma.post.create({
            data: {
              user_id: BigInt(user_id),
              title: note.title || '',
              content: note.content || '',
              type: postType,
              is_draft: is_draft !== undefined ? Boolean(is_draft) : false
            }
          })
          
          if (postType === 1 && note.files && note.files.length > 0) {
            // 图文笔记
            const imageUrls = note.files.map(file => `${baseUrl}${file.path}`)
            await prisma.postImage.createMany({
              data: imageUrls.map(url => ({
                post_id: post.id,
                image_url: url
              }))
            })
          } else if (postType === 2 && note.files && note.files.length > 0) {
            // 视频笔记
            const file = note.files[0]
            const videoPath = pathModule.join(process.cwd(), file.path)
            const videoUrl = `${baseUrl}${file.path}`
            let coverUrl = note.coverUrl || ''
            
            // 如果没有封面图，尝试生成
            if (!coverUrl) {
              try {
                const { generateVideoThumbnail } = require('../utils/videoThumbnailHelper')
                if (fs.existsSync(videoPath)) {
                  const thumbnailResult = await generateVideoThumbnail(videoPath, user_id)
                  if (thumbnailResult.success) {
                    coverUrl = thumbnailResult.url
                  }
                }
              } catch (thumbnailError) {
                console.warn(`视频封面生成失败: ${thumbnailError.message}`)
              }
            }
            
            await prisma.postVideo.create({
              data: {
                post_id: post.id,
                video_url: videoUrl,
                cover_url: coverUrl
              }
            })
            
            // 添加视频到转码队列（走正常上传流程）
            if (config.videoTranscoding && config.videoTranscoding.enabled && 
                config.upload && config.upload.video && config.upload.video.strategy === 'local') {
              try {
                if (fs.existsSync(videoPath)) {
                  const transcodingQueue = require('../utils/transcodingQueue')
                  const taskId = transcodingQueue.addTask(
                    videoPath,
                    user_id,
                    videoUrl
                  )
                  console.log(`✅ 视频已加入转码队列 - 笔记ID: ${post.id}, 任务ID: ${taskId}`)
                }
              } catch (transcodingError) {
                console.warn(`⚠️ 添加转码任务失败: ${transcodingError.message}`)
                // 转码失败不影响笔记创建
              }
            }
          }
          
          // 添加标签
          if (tags && tags.length > 0) {
            for (const tag of tags) {
              let tagId
              let tagName = typeof tag === 'string' ? tag : tag.name
              
              const existingTag = await prisma.tag.findUnique({ where: { name: tagName } })
              if (existingTag) {
                tagId = existingTag.id
              } else {
                const newTag = await prisma.tag.create({ data: { name: tagName } })
                tagId = newTag.id
              }
              
              await prisma.postTag.create({ data: { post_id: post.id, tag_id: tagId } })
              await prisma.tag.update({ where: { id: tagId }, data: { use_count: { increment: 1 } } })
            }
          }
          
          createdPosts.push({ id: Number(post.id), noteIndex: i })
        } catch (noteError) {
          console.error(`笔记 ${i + 1} 创建失败:`, noteError)
          failedNotes.push({ noteIndex: i, error: noteError.message })
        }
      }
      
      res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: {
          posts: createdPosts,
          count: createdPosts.length,
          failed: failedNotes,
          async: false
        },
        message: failedNotes.length === 0 
          ? `成功创建 ${createdPosts.length} 条笔记` 
          : `成功 ${createdPosts.length} 条，失败 ${failedNotes.length} 条`
      })
    }
  } catch (error) {
    console.error('异步批量创建笔记失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '批量创建失败' })
  }
})

// 查询批量创建任务状态
router.get('/batch-upload/status/:batchId', adminAuth, async (req, res) => {
  try {
    const { batchId } = req.params
    
    if (!batchId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少批次ID' })
    }
    
    const { getBatchNoteCreateStatus, isQueueEnabled } = require('../utils/queueService')
    
    if (!isQueueEnabled()) {
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: { enabled: false, message: '队列服务未启用' },
        message: '队列服务未启用'
      })
    }
    
    const status = await getBatchNoteCreateStatus(batchId)
    
    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: status,
      message: 'success'
    })
  } catch (error) {
    console.error('查询批量创建状态失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '查询状态失败' })
  }
})

// ===================== 用户工具栏管理 =====================

// 检查UserToolbar模型是否可用（数据库迁移后才能使用）
const isUserToolbarAvailable = () => {
  return prisma.userToolbar !== undefined
}

// 获取工具栏列表
router.get('/user-toolbar', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移: npx prisma generate && npx prisma db push' 
      })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { name, is_active, sortField = 'sort_order', sortOrder = 'asc' } = req.query

    const where = {}
    if (name) where.name = { contains: name }
    if (is_active !== undefined && is_active !== '') where.is_active = is_active === 'true' || is_active === '1'

    const [total, toolbars] = await Promise.all([
      prisma.userToolbar.count({ where }),
      prisma.userToolbar.findMany({
        where,
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: toolbars, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取工具栏列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取单个工具栏项
router.get('/user-toolbar/:id', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const toolbarId = parseInt(req.params.id)
    const toolbar = await prisma.userToolbar.findUnique({ where: { id: toolbarId } })

    if (!toolbar) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '工具栏项不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: toolbar, message: 'success' })
  } catch (error) {
    console.error('获取工具栏项详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建工具栏项
router.post('/user-toolbar', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const { name, icon, url, sort_order, is_active } = req.body

    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '工具名称不能为空' })
    }

    if (!icon || !icon.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '图标名称不能为空' })
    }

    if (!url || !url.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '跳转链接不能为空' })
    }

    const newToolbar = await prisma.userToolbar.create({
      data: {
        name: name.trim(),
        icon: icon.trim(),
        url: url.trim(),
        sort_order: parseInt(sort_order) || 0,
        is_active: is_active === undefined ? true : Boolean(is_active)
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newToolbar.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建工具栏项失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新工具栏项
router.put('/user-toolbar/:id', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const toolbarId = parseInt(req.params.id)
    const { name, icon, url, sort_order, is_active } = req.body

    const existing = await prisma.userToolbar.findUnique({ where: { id: toolbarId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '工具栏项不存在' })
    }

    const updateData = {}
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '工具名称不能为空' })
      }
      updateData.name = name.trim()
    }
    if (icon !== undefined) {
      if (!icon.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '图标名称不能为空' })
      }
      updateData.icon = icon.trim()
    }
    if (url !== undefined) {
      if (!url.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '跳转链接不能为空' })
      }
      updateData.url = url.trim()
    }
    if (sort_order !== undefined) updateData.sort_order = parseInt(sort_order) || 0
    if (is_active !== undefined) updateData.is_active = is_active === true || is_active === 'true'

    await prisma.userToolbar.update({ where: { id: toolbarId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新工具栏项失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除工具栏项
router.delete('/user-toolbar/:id', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const toolbarId = parseInt(req.params.id)
    
    const existing = await prisma.userToolbar.findUnique({ where: { id: toolbarId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '工具栏项不存在' })
    }

    await prisma.userToolbar.delete({ where: { id: toolbarId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除工具栏项失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除工具栏项
router.delete('/user-toolbar', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.userToolbar.deleteMany({ where: { id: { in: ids.map(id => parseInt(id)) } } })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除工具栏项失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 切换工具栏项启用状态
router.put('/user-toolbar/:id/toggle-active', adminAuth, async (req, res) => {
  try {
    if (!isUserToolbarAvailable()) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '工具栏功能暂不可用，请先运行数据库迁移' 
      })
    }

    const toolbarId = parseInt(req.params.id)
    
    const toolbar = await prisma.userToolbar.findUnique({ where: { id: toolbarId } })
    if (!toolbar) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '工具栏项不存在' })
    }

    await prisma.userToolbar.update({
      where: { id: toolbarId },
      data: { is_active: !toolbar.is_active }
    })

    res.json({ 
      code: RESPONSE_CODES.SUCCESS, 
      message: toolbar.is_active ? '已禁用' : '已启用',
      data: { is_active: !toolbar.is_active }
    })
  } catch (error) {
    console.error('切换工具栏项状态失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '操作失败' })
  }
})

// ===================== 笔记质量管理 =====================

// 检查质量奖励设置功能是否可用
let isQualityRewardAvailable = null
const checkQualityRewardAvailable = async () => {
  if (isQualityRewardAvailable !== null) return isQualityRewardAvailable
  try {
    await prisma.postQualityRewardSetting.findFirst()
    isQualityRewardAvailable = true
  } catch (error) {
    isQualityRewardAvailable = false
  }
  return isQualityRewardAvailable
}

// 获取质量奖励设置列表
router.get('/quality-reward-settings', adminAuth, async (req, res) => {
  try {
    const available = await checkQualityRewardAvailable()
    if (!available) {
      // 返回默认设置
      return res.json({
        code: RESPONSE_CODES.SUCCESS,
        data: {
          data: [
            { id: 1, quality_level: 'low', reward_amount: 1.00, description: '低质量奖励', is_active: true },
            { id: 2, quality_level: 'medium', reward_amount: 3.00, description: '中质量奖励', is_active: true },
            { id: 3, quality_level: 'high', reward_amount: 5.00, description: '高质量奖励', is_active: true }
          ]
        },
        message: 'success'
      })
    }

    let settings = await prisma.postQualityRewardSetting.findMany({
      orderBy: { id: 'asc' }
    })

    // 如果没有设置，创建默认设置
    if (settings.length === 0) {
      const defaultSettings = [
        { quality_level: 'low', reward_amount: 1.00, description: '低质量奖励', is_active: true },
        { quality_level: 'medium', reward_amount: 3.00, description: '中质量奖励', is_active: true },
        { quality_level: 'high', reward_amount: 5.00, description: '高质量奖励', is_active: true }
      ]
      for (const setting of defaultSettings) {
        await prisma.postQualityRewardSetting.create({ data: setting })
      }
      settings = await prisma.postQualityRewardSetting.findMany({ orderBy: { id: 'asc' } })
    }

    const formattedSettings = settings.map(s => ({
      id: s.id,
      quality_level: s.quality_level,
      reward_amount: parseFloat(s.reward_amount),
      description: s.description,
      is_active: s.is_active,
      created_at: s.created_at,
      updated_at: s.updated_at
    }))

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { data: formattedSettings }, message: 'success' })
  } catch (error) {
    console.error('获取质量奖励设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 更新质量奖励设置
router.put('/quality-reward-settings/:id', adminAuth, async (req, res) => {
  try {
    const available = await checkQualityRewardAvailable()
    if (!available) {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE || 503).json({ 
        code: RESPONSE_CODES.ERROR, 
        message: '质量奖励功能暂不可用，请先运行数据库迁移' 
      })
    }

    const settingId = parseInt(req.params.id)
    const { reward_amount, description, is_active } = req.body

    const existing = await prisma.postQualityRewardSetting.findUnique({ where: { id: settingId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '设置不存在' })
    }

    const updateData = {}
    if (reward_amount !== undefined) updateData.reward_amount = parseFloat(reward_amount) || 0
    if (description !== undefined) updateData.description = description
    if (is_active !== undefined) updateData.is_active = is_active === true || is_active === 'true'

    await prisma.postQualityRewardSetting.update({ where: { id: settingId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新质量奖励设置失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 获取笔记质量等级（带筛选）
router.get('/posts-quality', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { title, user_display_id, type, quality_level, is_draft, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (title) where.title = { contains: title }
    if (type !== undefined && type !== '') where.type = parseInt(type)
    if (quality_level !== undefined && quality_level !== '') where.quality_level = quality_level
    if (is_draft !== undefined && is_draft !== '') where.is_draft = parseInt(is_draft) === 1
    if (user_display_id) where.user = { user_id: { contains: user_display_id } }

    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        include: {
          user: { select: { id: true, user_id: true, nickname: true } },
          category: { select: { name: true } },
          images: { select: { image_url: true }, take: 1 },
          videos: { select: { cover_url: true }, take: 1 }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    const formattedPosts = posts.map(post => ({
      id: Number(post.id),
      user_id: Number(post.user_id),
      title: post.title,
      content: post.content ? post.content.substring(0, 100) : '',
      type: post.type,
      view_count: Number(post.view_count),
      like_count: post.like_count,
      collect_count: post.collect_count,
      comment_count: post.comment_count,
      created_at: post.created_at,
      is_draft: post.is_draft,
      user_display_id: post.user?.user_id,
      nickname: post.user?.nickname,
      quality_level: post.quality_level || 'none',
      quality_marked_at: post.quality_marked_at,
      quality_reward: post.quality_reward ? parseFloat(post.quality_reward) : null,
      cover: post.type === 2 
        ? (post.videos[0]?.cover_url || null)
        : (post.images[0]?.image_url || null)
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: formattedPosts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取笔记质量列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 设置笔记质量等级并发放奖励
router.put('/posts/:id/quality', adminAuth, async (req, res) => {
  try {
    const postId = BigInt(req.params.id)
    const { quality_level } = req.body

    if (!quality_level || !['none', 'low', 'medium', 'high'].includes(quality_level)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的质量等级'
      })
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { user: true }
    })

    if (!post) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '笔记不存在' })
    }

    // 如果设置为none，清除质量标记
    if (quality_level === 'none') {
      await prisma.post.update({
        where: { id: postId },
        data: {
          quality_level: 'none',
          quality_marked_at: null,
          quality_reward: null
        }
      })
      return res.json({ code: RESPONSE_CODES.SUCCESS, message: '已清除质量标记' })
    }

    // 检查是否已经标记过质量（仅允许标记一次）
    if (post.quality_level && post.quality_level !== 'none') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '该笔记已标记过质量等级，每篇笔记仅可标记一次'
      })
    }

    // 获取奖励金额
    let rewardAmount = 0
    try {
      const available = await checkQualityRewardAvailable()
      if (available) {
        const rewardSetting = await prisma.postQualityRewardSetting.findUnique({
          where: { quality_level: quality_level }
        })
        if (rewardSetting && rewardSetting.is_active) {
          rewardAmount = parseFloat(rewardSetting.reward_amount) || 0
        }
      } else {
        // 使用默认奖励
        const defaultRewards = { low: 1.00, medium: 3.00, high: 5.00 }
        rewardAmount = defaultRewards[quality_level] || 0
      }
    } catch (e) {
      console.log('获取奖励设置失败，使用默认值')
      const defaultRewards = { low: 1.00, medium: 3.00, high: 5.00 }
      rewardAmount = defaultRewards[quality_level] || 0
    }

    // 更新笔记质量等级
    await prisma.post.update({
      where: { id: postId },
      data: {
        quality_level: quality_level,
        quality_marked_at: new Date(),
        quality_reward: rewardAmount
      }
    })

    // 如果有奖励金额，添加到创作者收益
    if (rewardAmount > 0) {
      const userId = post.user_id
      
      // 获取或创建创作者收益账户
      let earnings = await prisma.creatorEarnings.findUnique({
        where: { user_id: userId }
      })
      
      if (!earnings) {
        earnings = await prisma.creatorEarnings.create({
          data: {
            user_id: userId,
            balance: 0.00,
            total_earnings: 0.00,
            withdrawn_amount: 0.00
          }
        })
      }

      const newBalance = parseFloat(earnings.balance) + rewardAmount
      const newTotalEarnings = parseFloat(earnings.total_earnings) + rewardAmount

      // 更新收益余额
      await prisma.creatorEarnings.update({
        where: { user_id: userId },
        data: { 
          balance: newBalance,
          total_earnings: newTotalEarnings
        }
      })

      // 记录收益日志
      const qualityLabels = { low: '低质量', medium: '中质量', high: '高质量' }
      await prisma.creatorEarningsLog.create({
        data: {
          user_id: userId,
          earnings_id: earnings.id,
          amount: rewardAmount,
          balance_after: newBalance,
          type: 'quality_reward',
          source_id: postId,
          source_type: 'post',
          reason: `笔记质量奖励: ${qualityLabels[quality_level]}`,
          platform_fee: 0
        }
      })

      console.log(`笔记 ${postId} 质量标记为 ${quality_level}，发放奖励 ${rewardAmount} 给用户 ${userId}`)
    }

    res.json({ 
      code: RESPONSE_CODES.SUCCESS, 
      message: `质量等级已设置为${quality_level}${rewardAmount > 0 ? '，已发放' + rewardAmount + '石榴点奖励' : ''}`,
      data: { quality_level, reward_amount: rewardAmount }
    })
  } catch (error) {
    console.error('设置笔记质量失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '设置失败' })
  }
})

// 批量设置笔记质量等级
router.put('/posts-quality/batch', adminAuth, async (req, res) => {
  try {
    const { ids, quality_level } = req.body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '请提供要设置的笔记ID列表'
      })
    }

    if (!quality_level || !['none', 'low', 'medium', 'high'].includes(quality_level)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        code: RESPONSE_CODES.VALIDATION_ERROR,
        message: '无效的质量等级'
      })
    }

    // 获取奖励金额
    let rewardAmount = 0
    if (quality_level !== 'none') {
      try {
        const available = await checkQualityRewardAvailable()
        if (available) {
          const rewardSetting = await prisma.postQualityRewardSetting.findUnique({
            where: { quality_level: quality_level }
          })
          if (rewardSetting && rewardSetting.is_active) {
            rewardAmount = parseFloat(rewardSetting.reward_amount) || 0
          }
        } else {
          const defaultRewards = { low: 1.00, medium: 3.00, high: 5.00 }
          rewardAmount = defaultRewards[quality_level] || 0
        }
      } catch (e) {
        const defaultRewards = { low: 1.00, medium: 3.00, high: 5.00 }
        rewardAmount = defaultRewards[quality_level] || 0
      }
    }

    let successCount = 0
    let totalReward = 0
    let skippedCount = 0

    for (const id of ids) {
      try {
        const postId = BigInt(id)
        const post = await prisma.post.findUnique({
          where: { id: postId },
          include: { user: true }
        })

        if (!post) continue

        // 如果不是清除操作，检查是否已经标记过（仅允许标记一次）
        if (quality_level !== 'none' && post.quality_level && post.quality_level !== 'none') {
          skippedCount++
          continue
        }

        // 更新笔记质量
        await prisma.post.update({
          where: { id: postId },
          data: {
            quality_level: quality_level,
            quality_marked_at: quality_level === 'none' ? null : new Date(),
            quality_reward: quality_level === 'none' ? null : rewardAmount
          }
        })

        // 发放奖励
        if (quality_level !== 'none' && rewardAmount > 0) {
          const userId = post.user_id
          
          let earnings = await prisma.creatorEarnings.findUnique({
            where: { user_id: userId }
          })
          
          if (!earnings) {
            earnings = await prisma.creatorEarnings.create({
              data: {
                user_id: userId,
                balance: 0.00,
                total_earnings: 0.00,
                withdrawn_amount: 0.00
              }
            })
          }

          const newBalance = parseFloat(earnings.balance) + rewardAmount
          const newTotalEarnings = parseFloat(earnings.total_earnings) + rewardAmount

          await prisma.creatorEarnings.update({
            where: { user_id: userId },
            data: { 
              balance: newBalance,
              total_earnings: newTotalEarnings
            }
          })

          const qualityLabels = { low: '低质量', medium: '中质量', high: '高质量' }
          await prisma.creatorEarningsLog.create({
            data: {
              user_id: userId,
              earnings_id: earnings.id,
              amount: rewardAmount,
              balance_after: newBalance,
              type: 'quality_reward',
              source_id: postId,
              source_type: 'post',
              reason: `笔记质量奖励: ${qualityLabels[quality_level]}`,
              platform_fee: 0
            }
          })

          totalReward += rewardAmount
        }

        successCount++
      } catch (e) {
        console.error(`处理笔记 ${id} 失败:`, e)
      }
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: `成功设置 ${successCount} 篇笔记${skippedCount > 0 ? '，跳过 ' + skippedCount + ' 篇已标记笔记' : ''}${totalReward > 0 ? '，共发放 ' + totalReward.toFixed(2) + ' 石榴点奖励' : ''}`,
      data: { success_count: successCount, skipped_count: skippedCount, total_reward: totalReward }
    })
  } catch (error) {
    console.error('批量设置笔记质量失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '操作失败' })
  }
})

// ===================== 系统通知管理 =====================

// 检查 SystemNotification 模型是否可用
const isSystemNotificationAvailable = () => {
  return prisma.systemNotification !== undefined
}

// 获取系统通知列表
router.get('/system-notifications', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用，请先运行数据库迁移' })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { type, is_active, title } = req.query
    const allowedSortFields = ['id', 'title', 'type', 'is_active', 'start_time', 'end_time', 'created_at', 'updated_at']
    const sortField = allowedSortFields.includes(req.query.sortField) ? req.query.sortField : 'created_at'
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc'

    const where = {}
    if (type) where.type = type
    if (is_active !== undefined && is_active !== '') where.is_active = is_active === 'true' || is_active === '1'
    if (title) where.title = { contains: title }

    const [total, notifications, totalUsers] = await Promise.all([
      prisma.systemNotification.count({ where }),
      prisma.systemNotification.findMany({
        where,
        include: {
          _count: {
            select: { confirmations: true }
          }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip
      }),
      prisma.user.count()
    ])

    // 附加已读/未读统计
    const data = notifications.map(n => ({
      ...n,
      confirmed_count: n._count.confirmations,
      unread_count: Math.max(0, totalUsers - n._count.confirmations),
      _count: undefined
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取系统通知列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取单个系统通知
router.get('/system-notifications/:id', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const notification = await prisma.systemNotification.findUnique({
      where: { id },
      include: { confirmations: { select: { id: true, user_id: true, confirmed_at: true } } }
    })

    if (!notification) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '系统通知不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: notification, message: 'success' })
  } catch (error) {
    console.error('获取系统通知详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建系统通知
router.post('/system-notifications', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const { title, content, type, content_format, image_url, link_url, show_popup, is_active, start_time, end_time } = req.body

    if (!title || !title.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '通知标题不能为空' })
    }
    if (!content || !content.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '通知内容不能为空' })
    }

    const data = {
      title: title.trim(),
      content: content.trim(),
      type: type || 'system',
      content_format: content_format || 'text',
      show_popup: show_popup === undefined ? false : Boolean(show_popup),
      is_active: true
    }
    if (image_url) data.image_url = image_url.trim()
    if (link_url) data.link_url = link_url.trim()

    const notification = await prisma.systemNotification.create({ data })

    // 异步发送邮件和Discord通知（不阻塞响应）
    try {
      const users = await prisma.user.findMany({
        where: { is_active: true, email: { not: null } },
        select: { email: true }
      });
      const emails = users.map(u => u.email).filter(Boolean);
      notifySystemNotification({
        type: data.type,
        title: data.title,
        content: data.content,
        emails
      }).catch(err => console.error('系统通知推送失败:', err.message));
    } catch (pushError) {
      console.error('系统通知推送准备失败:', pushError);
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: notification.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建系统通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新系统通知
router.put('/system-notifications/:id', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const existing = await prisma.systemNotification.findUnique({ where: { id } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '系统通知不存在' })
    }

    const { title, content, type, content_format, image_url, link_url, show_popup } = req.body
    const data = {}
    if (title !== undefined) data.title = title.trim()
    if (content !== undefined) data.content = content.trim()
    if (type !== undefined) data.type = type
    if (content_format !== undefined) data.content_format = content_format
    if (image_url !== undefined) data.image_url = image_url ? image_url.trim() : null
    if (link_url !== undefined) data.link_url = link_url ? link_url.trim() : null
    if (show_popup !== undefined) data.show_popup = Boolean(show_popup)

    await prisma.systemNotification.update({ where: { id }, data })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新系统通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除单个系统通知
router.delete('/system-notifications/:id', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const existing = await prisma.systemNotification.findUnique({ where: { id } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '系统通知不存在' })
    }

    await prisma.systemNotification.delete({ where: { id } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除系统通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除系统通知
router.delete('/system-notifications', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.systemNotification.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: `成功删除 ${ids.length} 条系统通知` })
  } catch (error) {
    console.error('批量删除系统通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '批量删除失败' })
  }
})

// 重新发送通知给未读用户（清除所有确认记录）
router.post('/system-notifications/:id/resend', adminAuth, async (req, res) => {
  try {
    if (!isSystemNotificationAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '系统通知功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const existing = await prisma.systemNotification.findUnique({ where: { id } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '系统通知不存在' })
    }

    // 删除所有确认记录，使通知对所有用户重新变为未读
    const deleted = await prisma.systemNotificationConfirmation.deleteMany({
      where: { notification_id: id }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: `已重新发送，清除了 ${deleted.count} 条已读记录` })
  } catch (error) {
    console.error('重新发送系统通知失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '重新发送失败' })
  }
})

// ===================== 通知模板管理 =====================

// 检查 NotificationTemplate 模型是否可用
const isNotificationTemplateAvailable = () => {
  return prisma.notificationTemplate !== undefined
}

// 获取通知模板列表
router.get('/notification-templates', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用，请先运行数据库迁移' })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { template_key, name } = req.query

    const where = {}
    if (template_key) where.template_key = template_key
    if (name) where.name = { contains: name }

    const [total, templates] = await Promise.all([
      prisma.notificationTemplate.count({ where }),
      prisma.notificationTemplate.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: templates, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取通知模板列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取默认模板列表（供参考）
router.get('/notification-templates/defaults', adminAuth, async (req, res) => {
  try {
    const defaults = Object.entries(DEFAULT_TEMPLATES).map(([key, tpl]) => ({
      template_key: key,
      system_template: tpl.system || '',
      email_subject: tpl.email?.subject || '',
      email_body: tpl.email?.body || ''
    }))
    res.json({ code: RESPONSE_CODES.SUCCESS, data: defaults, message: 'success' })
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取单个通知模板
router.get('/notification-templates/:id', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const template = await prisma.notificationTemplate.findUnique({ where: { id } })

    if (!template) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知模板不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: template, message: 'success' })
  } catch (error) {
    console.error('获取通知模板详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建/保存通知模板
router.post('/notification-templates', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const { template_key, name, description, system_template, email_subject, email_body, is_active } = req.body

    if (!template_key || !template_key.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '模板键名不能为空' })
    }
    if (!name || !name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '模板名称不能为空' })
    }

    // 使用 upsert 支持同 template_key 更新
    const template = await prisma.notificationTemplate.upsert({
      where: { template_key: template_key.trim() },
      update: {
        name: name.trim(),
        description: description?.trim() || null,
        system_template: system_template || null,
        email_subject: email_subject || null,
        email_body: email_body || null,
        is_active: is_active !== undefined ? Boolean(is_active) : true
      },
      create: {
        template_key: template_key.trim(),
        name: name.trim(),
        description: description?.trim() || null,
        system_template: system_template || null,
        email_subject: email_subject || null,
        email_body: email_body || null,
        is_active: is_active !== undefined ? Boolean(is_active) : true
      }
    })

    // 更新内存缓存
    if (template.is_active) {
      updateCustomTemplate(template.template_key, {
        system: template.system_template || '',
        email: {
          subject: template.email_subject || '',
          body: template.email_body || ''
        }
      })
    } else {
      clearCustomTemplates(template.template_key)
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: template.id }, message: '保存成功' })
  } catch (error) {
    console.error('保存通知模板失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '保存失败' })
  }
})

// 更新通知模板
router.put('/notification-templates/:id', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const existing = await prisma.notificationTemplate.findUnique({ where: { id } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知模板不存在' })
    }

    const { name, description, system_template, email_subject, email_body, is_active } = req.body
    const data = {}
    if (name !== undefined) data.name = name.trim()
    if (description !== undefined) data.description = description ? description.trim() : null
    if (system_template !== undefined) data.system_template = system_template || null
    if (email_subject !== undefined) data.email_subject = email_subject || null
    if (email_body !== undefined) data.email_body = email_body || null
    if (is_active !== undefined) data.is_active = Boolean(is_active)

    const updated = await prisma.notificationTemplate.update({ where: { id }, data })

    // 更新内存缓存
    if (updated.is_active) {
      updateCustomTemplate(updated.template_key, {
        system: updated.system_template || '',
        email: {
          subject: updated.email_subject || '',
          body: updated.email_body || ''
        }
      })
    } else {
      clearCustomTemplates(updated.template_key)
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新通知模板失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除通知模板
router.delete('/notification-templates/:id', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const id = BigInt(req.params.id)
    const existing = await prisma.notificationTemplate.findUnique({ where: { id } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知模板不存在' })
    }

    await prisma.notificationTemplate.delete({ where: { id } })
    clearCustomTemplates(existing.template_key)
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除通知模板失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除通知模板
router.delete('/notification-templates', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.notificationTemplate.deleteMany({
      where: { id: { in: ids.map(id => BigInt(id)) } }
    })
    clearCustomTemplates()

    res.json({ code: RESPONSE_CODES.SUCCESS, message: `成功删除 ${ids.length} 条通知模板` })
  } catch (error) {
    console.error('批量删除通知模板失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '批量删除失败' })
  }
})

// 获取测试用示例变量
function getTestSampleVariables() {
  return {
    siteName: notifChannelsConfig.discord?.siteName || '汐社校园图文社区',
    senderName: '测试用户',
    postTitle: '这是一篇测试笔记标题',
    commentContent: '这是一条测试评论内容，用于测试模板的展示效果。',
    title: '测试通知标题',
    content: '这是测试通知的正文内容，用于测试模板效果。'
  }
}

// 预览通知模板（渲染HTML返回）
router.post('/notification-templates/preview', adminAuth, async (req, res) => {
  try {
    const { template_key, email_subject, email_body, system_template } = req.body

    const sampleVariables = getTestSampleVariables()

    const renderedSubject = renderTemplate(email_subject || '', sampleVariables)
    const renderedBody = renderTemplate(email_body || '', sampleVariables)
    const renderedSystem = renderTemplate(system_template || '', sampleVariables)

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        subject: renderedSubject,
        body: renderedBody,
        system: renderedSystem,
        variables: sampleVariables
      },
      message: 'success'
    })
  } catch (error) {
    console.error('预览通知模板失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '预览失败' })
  }
})

// 测试发送邮件
router.post('/notification-templates/:id/test-email', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const { email: testEmail } = req.body
    if (!testEmail || !testEmail.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供测试邮箱地址' })
    }

    if (!emailConfig.enabled) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '邮件服务未启用，请先在.env中配置 EMAIL_ENABLED=true 并配置SMTP' })
    }

    const id = BigInt(req.params.id)
    const template = await prisma.notificationTemplate.findUnique({ where: { id } })
    if (!template) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知模板不存在' })
    }

    const sampleVariables = getTestSampleVariables()

    // 优先使用自定义模板，回退到默认模板
    const emailSubject = template.email_subject || DEFAULT_TEMPLATES[template.template_key]?.email?.subject || '测试邮件'
    const emailBody = template.email_body || DEFAULT_TEMPLATES[template.template_key]?.email?.body || '<p>测试邮件内容</p>'

    const renderedSubject = renderTemplate(emailSubject, sampleVariables)
    const renderedBody = renderTemplate(emailBody, sampleVariables)

    await sendMail({
      to: testEmail.trim(),
      subject: `[测试] ${renderedSubject}`,
      html: renderedBody
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: `测试邮件已发送至 ${testEmail.trim()}` })
  } catch (error) {
    console.error('测试发送邮件失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: `发送失败: ${error.message}` })
  }
})

// 测试发送Discord通知
router.post('/notification-templates/:id/test-discord', adminAuth, async (req, res) => {
  try {
    if (!isNotificationTemplateAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '通知模板功能暂不可用' })
    }

    const { discord } = notifChannelsConfig
    if (!discord.enabled || !discord.webhookUrl) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: 'Discord Webhook未启用，请先在.env中配置 DISCORD_WEBHOOK_ENABLED=true 和 DISCORD_WEBHOOK_URL' })
    }

    const id = BigInt(req.params.id)
    const template = await prisma.notificationTemplate.findUnique({ where: { id } })
    if (!template) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '通知模板不存在' })
    }

    const sampleVariables = getTestSampleVariables()
    const siteName = sampleVariables.siteName

    const systemTemplate = template.system_template || DEFAULT_TEMPLATES[template.template_key]?.system || '测试通知'
    const text = renderTemplate(systemTemplate, sampleVariables)

    const embed = {
      title: `🧪 [测试] ${siteName}`,
      description: text,
      color: 16776960,
      footer: { text: `模板: ${template.name} (${template.template_key})` },
      timestamp: new Date().toISOString()
    }

    await sendDiscordNotification(null, embed)

    res.json({ code: RESPONSE_CODES.SUCCESS, message: 'Discord测试通知已发送' })
  } catch (error) {
    console.error('测试发送Discord失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: `发送失败: ${error.message}` })
  }
})

// 服务启动时从数据库加载自定义通知模板到内存缓存
async function initNotificationTemplates() {
  try {
    if (isNotificationTemplateAvailable()) {
      const templates = await prisma.notificationTemplate.findMany({ where: { is_active: true } })
      loadCustomTemplates(templates)
      console.log(`📋 已加载 ${templates.length} 个自定义通知模板`)
    }
  } catch (error) {
    console.log('通知模板加载跳过（表可能不存在）')
  }
}
initNotificationTemplates()

// ===================== 认证管理 (审核 type 1,2) =====================

// 获取认证申请列表
router.get('/audit', adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const sortField = req.query.sortField || 'created_at'
    const sortOrder = req.query.sortOrder || 'desc'

    const where = { type: { in: [1, 2] } }

    // 搜索条件
    if (req.query.user_display_id) {
      const user = await prisma.user.findFirst({
        where: { xise_id: req.query.user_display_id },
        select: { id: true }
      })
      if (user) {
        where.user_id = user.id
      } else {
        return res.json({ code: RESPONSE_CODES.SUCCESS, data: { data: [], total: 0, page, limit } })
      }
    }
    if (req.query.type) where.type = parseInt(req.query.type)
    if (req.query.status !== undefined && req.query.status !== '') where.status = parseInt(req.query.status)

    const [audits, total] = await Promise.all([
      prisma.audit.findMany({
        where,
        include: {
          user: {
            select: { id: true, user_id: true, nickname: true, avatar: true, xise_id: true }
          }
        },
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip
      }),
      prisma.audit.count({ where })
    ])

    const formattedAudits = audits.map(a => ({
      id: Number(a.id),
      user_id: Number(a.user_id),
      user_display_id: a.user?.xise_id || a.user?.user_id,
      nickname: a.user?.nickname,
      avatar: a.user?.avatar,
      type: a.type,
      content: a.content,
      status: a.status,
      reason: a.reason,
      created_at: a.created_at,
      audit_time: a.audit_time
    }))

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      message: '获取认证申请列表成功',
      data: { data: formattedAudits, total, page, limit }
    })
  } catch (error) {
    console.error('获取认证申请列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取认证申请列表失败' })
  }
})

// 获取认证申请详情
router.get('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({
      where: { id: auditId, type: { in: [1, 2] } },
      include: {
        user: {
          select: { id: true, user_id: true, nickname: true, avatar: true, xise_id: true }
        }
      }
    })

    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '认证记录不存在' })
    }

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        id: Number(audit.id),
        user_id: Number(audit.user_id),
        user_display_id: audit.user?.xise_id || audit.user?.user_id,
        nickname: audit.user?.nickname,
        type: audit.type,
        content: audit.content,
        status: audit.status,
        reason: audit.reason,
        created_at: audit.created_at,
        audit_time: audit.audit_time
      }
    })
  } catch (error) {
    console.error('获取认证详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取认证详情失败' })
  }
})

// 创建认证申请（管理员手动创建）
router.post('/audit', adminAuth, async (req, res) => {
  try {
    const { user_id, type, content, status } = req.body

    if (!user_id || !type || !content) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '缺少必填字段' })
    }

    const audit = await prisma.audit.create({
      data: {
        user_id: BigInt(user_id),
        type: parseInt(type),
        content,
        status: status !== undefined ? parseInt(status) : 0
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: Number(audit.id) }, message: '创建成功' })
  } catch (error) {
    console.error('创建认证申请失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新认证申请
router.put('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const { type, content, status } = req.body

    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [1, 2] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '认证记录不存在' })
    }

    const updateData = {}
    if (type !== undefined && type !== '') updateData.type = parseInt(type)
    if (content !== undefined) updateData.content = content
    if (status !== undefined && status !== '') {
      updateData.status = parseInt(status)
      updateData.audit_time = new Date()
    }

    await prisma.audit.update({ where: { id: auditId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新认证申请失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 认证审核通过
router.put('/audit/:id/approve', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [1, 2] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '认证记录不存在' })
    }

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 1, audit_time: new Date() }
    })

    // 从audit_result JSON中读取认证名称
    let verifiedName = null
    if (audit.audit_result && typeof audit.audit_result === 'object' && audit.audit_result.verifiedName) {
      verifiedName = audit.audit_result.verifiedName
    }

    // 更新用户认证状态：type 1=官方认证, type 2=个人认证
    await prisma.user.update({
      where: { id: audit.user_id },
      data: {
        verified: audit.type,
        verified_name: verifiedName
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '认证审核通过' })
  } catch (error) {
    console.error('认证审核通过失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '认证审核通过失败' })
  }
})

// 认证审核拒绝
router.put('/audit/:id/reject', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [1, 2] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '认证记录不存在' })
    }

    const { reason } = req.body

    await prisma.audit.update({
      where: { id: auditId },
      data: { status: 2, audit_time: new Date(), reason: reason || null }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, message: '认证申请已拒绝' })
  } catch (error) {
    console.error('认证审核拒绝失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '认证审核拒绝失败' })
  }
})

// 删除认证申请
router.delete('/audit/:id', adminAuth, async (req, res) => {
  try {
    const auditId = BigInt(req.params.id)
    const audit = await prisma.audit.findFirst({ where: { id: auditId, type: { in: [1, 2] } } })
    if (!audit) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.ERROR, message: '认证记录不存在' })
    }

    // 如果已通过的认证被删除，重置用户认证状态
    if (audit.status === 1) {
      await prisma.user.update({
        where: { id: audit.user_id },
        data: { verified: 0, verified_name: null }
      })
    }

    await prisma.audit.delete({ where: { id: auditId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除认证申请失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除认证申请
router.delete('/audit', adminAuth, async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.ERROR, message: '请选择要删除的项' })
    }

    const bigIntIds = ids.map(id => BigInt(id))

    // 查找已通过的认证，需要重置用户状态
    const approvedAudits = await prisma.audit.findMany({
      where: { id: { in: bigIntIds }, type: { in: [1, 2] }, status: 1 }
    })

    if (approvedAudits.length > 0) {
      const userIds = approvedAudits.map(a => a.user_id)
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { verified: 0, verified_name: null }
      })
    }

    await prisma.audit.deleteMany({ where: { id: { in: bigIntIds }, type: { in: [1, 2] } } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '批量删除成功' })
  } catch (error) {
    console.error('批量删除认证申请失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// ===================== 应用版本管理 (App Version Management) =====================

// 检查AppVersion模型是否可用
const isAppVersionAvailable = () => {
  return prisma.appVersion !== undefined
}

// 获取应用版本列表
router.get('/app-versions', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({
        code: RESPONSE_CODES.ERROR,
        message: '应用版本功能暂不可用，请先运行数据库迁移: npx prisma generate && npx prisma db push'
      })
    }

    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const skip = (page - 1) * limit
    const { app_name, platform, is_active, sortField = 'created_at', sortOrder = 'desc' } = req.query

    const where = {}
    if (app_name) where.app_name = { contains: app_name }
    if (platform) where.platform = platform
    if (is_active !== undefined && is_active !== '') where.is_active = is_active === 'true' || is_active === '1'

    const [total, versions] = await Promise.all([
      prisma.appVersion.count({ where }),
      prisma.appVersion.findMany({
        where,
        orderBy: { [sortField]: sortOrder.toLowerCase() },
        take: limit,
        skip: skip
      })
    ])

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: { data: versions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
      message: 'success'
    })
  } catch (error) {
    console.error('获取应用版本列表失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 获取应用统计信息
router.get('/app-versions/stats', adminAuth, async (req, res) => {
  try {
    if (!prisma.appUsageLog) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '使用记录功能暂不可用' })
    }

    // 总使用用户数（唯一设备数）
    const totalDevicesResult = await prisma.appUsageLog.findMany({
      where: { event_type: 'app_open' },
      distinct: ['device_id'],
      select: { device_id: true }
    })
    const totalUsers = totalDevicesResult.length

    // 各版本更新人数统计
    const versionUpdateStats = await prisma.appUsageLog.groupBy({
      by: ['version_code'],
      where: { event_type: 'update_complete', version_code: { not: null } },
      _count: { device_id: true }
    })

    // 获取版本名称映射
    let versionNames = {}
    if (isAppVersionAvailable()) {
      const versions = await prisma.appVersion.findMany({
        select: { version_code: true, version_name: true, platform: true }
      })
      versions.forEach(v => {
        versionNames[v.version_code] = v.version_name
      })
    }

    const versionUpdates = versionUpdateStats.map(stat => ({
      version_code: stat.version_code,
      version_name: versionNames[stat.version_code] || `v${stat.version_code}`,
      update_count: stat._count.device_id
    })).sort((a, b) => b.version_code - a.version_code)

    // 使用时长统计
    const durationStats = await prisma.appUsageLog.aggregate({
      where: { event_type: 'usage_duration', duration: { not: null } },
      _sum: { duration: true },
      _avg: { duration: true },
      _count: { id: true }
    })

    // 今日活跃用户数
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayActiveResult = await prisma.appUsageLog.findMany({
      where: { event_type: 'app_open', created_at: { gte: today } },
      distinct: ['device_id'],
      select: { device_id: true }
    })
    const todayActiveUsers = todayActiveResult.length

    // 各平台用户数
    const platformStats = await prisma.appUsageLog.groupBy({
      by: ['platform'],
      where: { event_type: 'app_open' },
      _count: { device_id: true }
    })

    res.json({
      code: RESPONSE_CODES.SUCCESS,
      data: {
        total_users: totalUsers,
        today_active_users: todayActiveUsers,
        version_updates: versionUpdates,
        usage_duration: {
          total_seconds: durationStats._sum.duration || 0,
          avg_seconds: Math.round(durationStats._avg.duration || 0),
          report_count: durationStats._count.id
        },
        platform_stats: platformStats.map(s => ({
          platform: s.platform,
          user_count: s._count.device_id
        }))
      },
      message: 'success'
    })
  } catch (error) {
    console.error('获取应用统计信息失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取统计失败' })
  }
})

// 获取单个应用版本
router.get('/app-versions/:id', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '应用版本功能暂不可用' })
    }

    const versionId = parseInt(req.params.id)
    const version = await prisma.appVersion.findUnique({ where: { id: versionId } })

    if (!version) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '应用版本不存在' })
    }

    res.json({ code: RESPONSE_CODES.SUCCESS, data: version, message: 'success' })
  } catch (error) {
    console.error('获取应用版本详情失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '获取失败' })
  }
})

// 创建应用版本
router.post('/app-versions', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '应用版本功能暂不可用' })
    }

    const { app_name, version_code, version_name, platform, download_url, update_log, force_update, is_active } = req.body

    if (!app_name || !app_name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '应用名称不能为空' })
    }
    if (version_code === undefined || version_code === null) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '版本号不能为空' })
    }
    if (!version_name || !version_name.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '版本名称不能为空' })
    }
    if (!platform || !platform.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '平台不能为空' })
    }
    if (!download_url || !download_url.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '下载地址不能为空' })
    }

    const newVersion = await prisma.appVersion.create({
      data: {
        app_name: app_name.trim(),
        version_code: parseInt(version_code),
        version_name: version_name.trim(),
        platform: platform.trim(),
        download_url: download_url.trim(),
        update_log: update_log ? update_log.trim() : null,
        force_update: force_update === true || force_update === 'true',
        is_active: is_active === undefined ? true : (is_active === true || is_active === 'true')
      }
    })

    res.json({ code: RESPONSE_CODES.SUCCESS, data: { id: newVersion.id }, message: '创建成功' })
  } catch (error) {
    console.error('创建应用版本失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '创建失败' })
  }
})

// 更新应用版本
router.put('/app-versions/:id', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '应用版本功能暂不可用' })
    }

    const versionId = parseInt(req.params.id)
    const { app_name, version_code, version_name, platform, download_url, update_log, force_update, is_active } = req.body

    const existing = await prisma.appVersion.findUnique({ where: { id: versionId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '应用版本不存在' })
    }

    const updateData = {}
    if (app_name !== undefined) {
      if (!app_name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '应用名称不能为空' })
      }
      updateData.app_name = app_name.trim()
    }
    if (version_code !== undefined) updateData.version_code = parseInt(version_code)
    if (version_name !== undefined) {
      if (!version_name.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '版本名称不能为空' })
      }
      updateData.version_name = version_name.trim()
    }
    if (platform !== undefined) {
      if (!platform.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '平台不能为空' })
      }
      updateData.platform = platform.trim()
    }
    if (download_url !== undefined) {
      if (!download_url.trim()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '下载地址不能为空' })
      }
      updateData.download_url = download_url.trim()
    }
    if (update_log !== undefined) updateData.update_log = update_log ? update_log.trim() : null
    if (force_update !== undefined) updateData.force_update = force_update === true || force_update === 'true'
    if (is_active !== undefined) updateData.is_active = is_active === true || is_active === 'true'

    await prisma.appVersion.update({ where: { id: versionId }, data: updateData })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '更新成功' })
  } catch (error) {
    console.error('更新应用版本失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '更新失败' })
  }
})

// 删除应用版本
router.delete('/app-versions/:id', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '应用版本功能暂不可用' })
    }

    const versionId = parseInt(req.params.id)

    const existing = await prisma.appVersion.findUnique({ where: { id: versionId } })
    if (!existing) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ code: RESPONSE_CODES.NOT_FOUND, message: '应用版本不存在' })
    }

    await prisma.appVersion.delete({ where: { id: versionId } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '删除成功' })
  } catch (error) {
    console.error('删除应用版本失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

// 批量删除应用版本
router.delete('/app-versions', adminAuth, async (req, res) => {
  try {
    if (!isAppVersionAvailable()) {
      return res.status(503).json({ code: RESPONSE_CODES.ERROR, message: '应用版本功能暂不可用' })
    }

    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ code: RESPONSE_CODES.VALIDATION_ERROR, message: '请提供要删除的ID列表' })
    }

    await prisma.appVersion.deleteMany({ where: { id: { in: ids.map(id => parseInt(id)) } } })
    res.json({ code: RESPONSE_CODES.SUCCESS, message: '成功删除 ' + ids.length + ' 条记录' })
  } catch (error) {
    console.error('批量删除应用版本失败:', error)
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ code: RESPONSE_CODES.ERROR, message: '删除失败' })
  }
})

module.exports = router
module.exports.isAiAutoReviewEnabled = isAiAutoReviewEnabled
module.exports.isAiUsernameReviewEnabled = isAiUsernameReviewEnabled
module.exports.isAiContentReviewEnabled = isAiContentReviewEnabled
