import { createRouter, createWebHistory } from 'vue-router'
import layout from '@/views/layout/index.vue'
import explore from '@/views/explore/index.vue'
import publish from '@/views/publish/index.vue'
import user from '@/views/user/index.vue'
import userProfile from '@/views/user/UserProfile.vue'
import FollowList from '@/views/user/FollowList.vue'
import BrowsingHistory from '@/views/user/BrowsingHistory.vue'
import ChannelPage from '@/views/explore/ChannelPage.vue'
import FollowingPage from '@/views/explore/FollowingPage.vue'
import FriendsPage from '@/views/explore/FriendsPage.vue'
import PostDetail from '@/views/PostDetail.vue'
import SearchResult from '@/views/search/SearchResult.vue'
import SearchPage from '@/views/search/SearchPage.vue'
import PostManagementPage from '@/views/post-management/index.vue'
import DraftBoxPage from '@/views/draft-box/index.vue'
import CreatorCenterPage from '@/views/creator-center/index.vue'
import MessagesPage from '@/views/messages/index.vue'
import OnboardingPage from '@/views/onboarding/OnboardingPage.vue'
import NotFound from '@/views/NotFound.vue'
import { getValidChannelPaths } from '@/config/channels'

// 后台管理系统组件
import AdminLogin from '@/views/admin/AdminLogin.vue'
import AdminLayout from '@/views/admin/AdminLayout.vue'
import AdminMonitor from '@/views/admin/AdminMonitor.vue'
import UserManagement from '@/views/admin/UserManagement.vue'
import PostManagement from '@/views/admin/PostManagement.vue'
import BatchUploadManagement from '@/views/admin/BatchUploadManagement.vue'
import CommentManagement from '@/views/admin/CommentManagement.vue'
import TagManagement from '@/views/admin/TagManagement.vue'
import LikeManagement from '@/views/admin/LikeManagement.vue'
import CollectionManagement from '@/views/admin/CollectionManagement.vue'
import FollowManagement from '@/views/admin/FollowManagement.vue'
import SessionManagement from '@/views/admin/SessionManagement.vue'
import AdminManagement from '@/views/admin/AdminManagement.vue'
import ContentReviewManagement from '@/views/admin/ContentReviewManagement.vue'
import QueueManagement from '@/views/admin/QueueManagement.vue'
import BannedWordsManagement from '@/views/admin/BannedWordsManagement.vue'
import NoteQualityManagement from '@/views/admin/NoteQualityManagement.vue'
import SystemSettingsManagement from '@/views/admin/SystemSettingsManagement.vue'
import NotificationManagement from '@/views/admin/NotificationManagement.vue'
import NotificationTemplateManagement from '@/views/admin/NotificationTemplateManagement.vue'
import AuditManagement from '@/views/admin/AuditManagement.vue'
import AppVersionManagement from '@/views/admin/AppVersionManagement.vue'
import AuthorizationManagement from '@/views/admin/AuthorizationManagement.vue'

// 登录鉴权守卫：未登录用户重定向到首页
const requireAuth = (to, from, next) => {
  const token = localStorage.getItem('token')
  if (!token) {
    next('/explore')
  } else {
    next()
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: layout,
      redirect: '/explore',
      children: [
        {
          path: '/explore',
          name: 'explore',
          component: explore,
          children: [
            {
              path: '',
              name: 'recommend',
              component: ChannelPage
            },
            {
              path: '/explore/friends',
              name: 'friends',
              component: FriendsPage
            },
            {
              path: '/explore/following',
              name: 'following',
              component: FollowingPage
            },
            {
              path: '/explore/:channel',
              name: 'channel',
              component: ChannelPage,
              beforeEnter: (to, from, next) => {
                // 验证频道是否有效
                const validChannelPaths = getValidChannelPaths()
                if (validChannelPaths.includes(to.params.channel)) {
                  to.name = to.params.channel
                  next()
                } else {
                  // 无效频道重定向到推荐页
                  next('/explore')
                }
              }
            }
          ]
        },
        {
          path: '/post',
          name: 'post_detail',
          component: PostDetail
        },
        {
          path: 'publish',
          name: 'publish',
          component: publish,
          beforeEnter: requireAuth
        },
        {
          path: 'user',
          name: 'user',
          component: user,
          beforeEnter: requireAuth
        },
        {
          path: 'user/:userId',
          name: 'user_profile',
          component: userProfile,
          beforeEnter: requireAuth
        },
        {
          path: 'follow/:type',
          name: 'follow_list',
          component: FollowList,
          beforeEnter: (to, from, next) => {
            const token = localStorage.getItem('token')
            if (!token) {
              next('/explore')
              return
            }
            // 验证type参数是否有效
            const validTypes = ['mutual', 'following', 'followers']
            if (validTypes.includes(to.params.type)) {
              next()
            } else {
              // 无效type重定向到following
              next({
                name: 'follow_list',
                params: { type: 'following' }
              })
            }
          }
        },
        {
          path: 'history',
          name: 'browsing_history',
          component: BrowsingHistory,
          beforeEnter: requireAuth
        },
        {
          path: 'search',
          name: 'search',
          component: SearchPage
        },
        {
          path: 'search_result',
          name: 'search_result',
          component: SearchResult,
          beforeEnter: (to, from, next) => {
            // 自动重定向到 "全部" tab
            next({
              name: 'search_result_tab',
              params: { tab: 'all' },
              query: to.query // 保持查询参数（如keyword）
            })
          }
        },
        {
          path: 'search_result/:tab',
          name: 'search_result_tab',
          component: SearchResult,
          beforeEnter: (to, from, next) => {
            // 验证tab参数是否有效
            const validTabs = ['all', 'post', 'video', 'user']
            if (validTabs.includes(to.params.tab)) {
              next()
            } else {
              // 无效tab重定向到all
              next({
                name: 'search_result_tab',
                params: { tab: 'all' },
                query: to.query
              })
            }
          }
        },
        {
          path: 'post-management',
          name: 'post_management',
          component: PostManagementPage,
          beforeEnter: requireAuth
        },
        {
          path: 'draft-box',
          name: 'draft_box',
          component: DraftBoxPage,
          beforeEnter: requireAuth
        },
        {
          path: 'creator-center',
          name: 'creator_center',
          component: CreatorCenterPage,
          beforeEnter: requireAuth
        },
        {
          path: 'messages',
          name: 'messages',
          component: MessagesPage,
          beforeEnter: requireAuth
        },
        // 404页面 - 捕获所有未匹配的路由
        {
          path: '/:pathMatch(.*)*',
          name: 'not_found',
          component: NotFound
        }
      ]
    },
    // 开始引导页面
    {
      path: '/onboarding',
      name: 'onboarding',
      component: OnboardingPage
    },
    // Admin登录页面
    {
      path: '/admin/login',
      name: 'admin_login',
      component: AdminLogin
    },
    // 后台管理系统路由
    {
      path: '/admin',
      component: AdminLayout,
      beforeEnter: (to, from, next) => {
        // 如果访问的是/admin根路径，重定向到monitor
        if (to.path === '/admin') {
          next('/admin/monitor')
        } else {
          next()
        }
      },
      children: [
        {
          path: 'monitor',
          name: 'admin_monitor',
          component: AdminMonitor
        },
        {
          path: 'users',
          name: 'admin_users',
          component: UserManagement
        },
        {
          path: 'posts',
          name: 'admin_posts',
          component: PostManagement
        },
        {
          path: 'batch-upload',
          name: 'admin_batch_upload',
          component: BatchUploadManagement
        },
        {
          path: 'comments',
          name: 'admin_comments',
          component: CommentManagement
        },
        {
          path: 'tags',
          name: 'admin_tags',
          component: TagManagement
        },
        {
          path: 'likes',
          name: 'admin_likes',
          component: LikeManagement
        },
        {
          path: 'collections',
          name: 'admin_collections',
          component: CollectionManagement
        },
        {
          path: 'follows',
          name: 'admin_follows',
          component: FollowManagement
        },
        {
          path: 'sessions',
          name: 'admin_sessions',
          component: SessionManagement
        },
        {
          path: 'admins',
          name: 'admin_admins',
          component: AdminManagement
        },
        {
          path: 'content-review',
          name: 'admin_content_review',
          component: ContentReviewManagement
        },
        {
          path: 'queues',
          name: 'admin_queues',
          component: QueueManagement
        },
        {
          path: 'banned-words',
          name: 'admin_banned_words',
          component: BannedWordsManagement
        },
        {
          path: 'user-toolbar',
          name: 'admin_user_toolbar',
          component: () => import('@/views/admin/ToolbarManagement.vue')
        },
        {
          path: 'note-quality',
          name: 'admin_note_quality',
          component: NoteQualityManagement
        },
        {
          path: 'system-settings',
          name: 'admin_system_settings',
          component: SystemSettingsManagement
        },
        {
          path: 'notifications',
          name: 'admin_notifications',
          component: NotificationManagement
        },
        {
          path: 'notification-templates',
          name: 'admin_notification_templates',
          component: NotificationTemplateManagement
        },
        {
          path: 'audit',
          name: 'admin_audit',
          component: AuditManagement
        },
        {
          path: 'app-versions',
          name: 'admin_app_versions',
          component: AppVersionManagement
        },
        {
          path: 'authorizations',
          name: 'admin_authorizations',
          component: AuthorizationManagement
        }
      ]
    }
  ],
})

// 全局前置守卫：未完成引导的已登录用户强制跳转到引导页
router.beforeEach((to, from, next) => {
  // 不拦截引导页本身、管理后台路由和用户个人主页（避免访问他人主页时被重定向）
  if (to.name === 'onboarding' || to.path.startsWith('/admin') || to.path.startsWith('/user/')) {
    return next()
  }

  const savedUserInfo = localStorage.getItem('userInfo')
  const token = localStorage.getItem('token')

  if (token && savedUserInfo) {
    try {
      const userInfo = JSON.parse(savedUserInfo)
      if (userInfo && userInfo.id && userInfo.profile_completed === false) {
        return next({ name: 'onboarding' })
      }
    } catch (e) {
      // 解析失败则不拦截
    }
  }

  next()
})

export default router
