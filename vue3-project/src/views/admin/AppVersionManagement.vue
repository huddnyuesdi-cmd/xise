<template>
  <div class="app-version-management">
    <!-- 统计面板 -->
    <div class="stats-panel">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.total_users }}</div>
          <div class="stat-label">累计使用用户</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.today_active_users }}</div>
          <div class="stat-label">今日活跃用户</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatDuration(stats.usage_duration.total_seconds) }}</div>
          <div class="stat-label">累计使用时长</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ formatDuration(stats.usage_duration.avg_seconds) }}</div>
          <div class="stat-label">平均使用时长</div>
        </div>
      </div>

      <!-- 各平台用户统计 -->
      <div v-if="stats.platform_stats.length > 0" class="stats-section">
        <h3 class="section-title">平台分布</h3>
        <div class="platform-tags">
          <span v-for="p in stats.platform_stats" :key="p.platform" class="platform-tag">
            {{ p.platform === 'android' ? 'Android' : p.platform === 'ios' ? 'iOS' : p.platform }}:
            {{ p.user_count }} 人
          </span>
        </div>
      </div>

      <!-- 各版本更新统计 -->
      <div v-if="stats.version_updates.length > 0" class="stats-section">
        <h3 class="section-title">版本更新统计</h3>
        <div class="version-stats-list">
          <div v-for="v in stats.version_updates" :key="v.version_code" class="version-stat-item">
            <span class="version-name">{{ v.version_name }}</span>
            <div class="version-bar-wrapper">
              <div class="version-bar" :style="{ width: getBarWidth(v.update_count) + '%' }"></div>
            </div>
            <span class="version-count">{{ v.update_count }} 人更新</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 版本管理表格 -->
    <CrudTable 
      title="应用版本管理" 
      entity-name="应用版本" 
      api-endpoint="/admin/app-versions" 
      :columns="columns"
      :form-fields="formFields" 
      :search-fields="searchFields" 
    />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import CrudTable from '@/views/admin/components/CrudTable.vue'
import { adminApi } from '@/api'

const stats = ref({
  total_users: 0,
  today_active_users: 0,
  version_updates: [],
  usage_duration: { total_seconds: 0, avg_seconds: 0, report_count: 0 },
  platform_stats: []
})

const maxUpdateCount = computed(() => {
  if (stats.value.version_updates.length === 0) return 1
  return Math.max(...stats.value.version_updates.map(v => v.update_count), 1)
})

const getBarWidth = (count) => {
  return Math.round((count / maxUpdateCount.value) * 100)
}

const formatDuration = (seconds) => {
  if (!seconds || seconds === 0) return '0秒'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}小时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

const fetchStats = async () => {
  try {
    const response = await adminApi.getAppVersionStats()
    if (response && response.success && response.data) {
      stats.value = response.data
    }
  } catch (err) {
    console.error('获取应用统计失败:', err)
  }
}

onMounted(() => {
  fetchStats()
})

const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'app_name', label: '应用名称', sortable: false },
  { key: 'version_name', label: '版本名称', sortable: false },
  { key: 'version_code', label: '版本号', sortable: true },
  { key: 'platform', label: '平台', sortable: false },
  { key: 'download_url', label: '下载地址', type: 'link', maxLength: 30, sortable: false },
  { key: 'force_update', label: '强制更新', type: 'boolean', trueText: '是', falseText: '否', sortable: false },
  { key: 'is_active', label: '启用状态', type: 'boolean', trueText: '启用', falseText: '禁用', sortable: false },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true }
]

const formFields = [
  { key: 'app_name', label: '应用名称', type: 'text', required: true, placeholder: '请输入应用名称' },
  { key: 'version_name', label: '版本名称', type: 'text', required: true, placeholder: '请输入版本名称（如 1.0.0）' },
  { key: 'version_code', label: '版本号', type: 'number', required: true, placeholder: '请输入版本号（数字，用于比较大小）' },
  {
    key: 'platform',
    label: '平台',
    type: 'select',
    required: true,
    options: [
      { value: 'android', label: 'Android' },
      { value: 'ios', label: 'iOS' }
    ]
  },
  { key: 'download_url', label: '下载地址', type: 'text', required: true, placeholder: '请输入下载地址' },
  { key: 'update_log', label: '更新日志', type: 'textarea', required: false, placeholder: '请输入更新日志' },
  {
    key: 'force_update',
    label: '强制更新',
    type: 'select',
    required: false,
    options: [
      { value: false, label: '否' },
      { value: true, label: '是' }
    ]
  },
  {
    key: 'is_active',
    label: '启用状态',
    type: 'select',
    required: false,
    options: [
      { value: true, label: '启用' },
      { value: false, label: '禁用' }
    ]
  }
]

const searchFields = [
  { key: 'app_name', label: '应用名称', placeholder: '搜索应用名称' },
  {
    key: 'platform',
    label: '平台',
    type: 'select',
    placeholder: '选择平台',
    options: [
      { value: '', label: '全部平台' },
      { value: 'android', label: 'Android' },
      { value: 'ios', label: 'iOS' }
    ]
  },
  {
    key: 'is_active',
    label: '启用状态',
    type: 'select',
    placeholder: '启用状态',
    options: [
      { value: '', label: '全部状态' },
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' }
    ]
  }
]
</script>

<style scoped>
.app-version-management {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.stats-panel {
  padding: 24px 32px;
  background-color: var(--bg-color-primary);
  border-bottom: 1px solid var(--border-color-primary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  background-color: var(--bg-color-secondary);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  border: 1px solid var(--border-color-primary);
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--primary-color);
  margin-bottom: 6px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-color-secondary);
}

.stats-section {
  margin-top: 16px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin-bottom: 12px;
}

.platform-tags {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.platform-tag {
  display: inline-block;
  padding: 6px 16px;
  background-color: var(--bg-color-secondary);
  border: 1px solid var(--border-color-primary);
  border-radius: 20px;
  font-size: 13px;
  color: var(--text-color-primary);
}

.version-stats-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.version-stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-name {
  min-width: 80px;
  font-size: 13px;
  color: var(--text-color-primary);
  font-weight: 500;
}

.version-bar-wrapper {
  flex: 1;
  height: 8px;
  background-color: var(--bg-color-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.version-bar {
  height: 100%;
  background-color: var(--primary-color);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.version-count {
  min-width: 80px;
  text-align: right;
  font-size: 13px;
  color: var(--text-color-secondary);
}

@media (max-width: 768px) {
  .stats-panel {
    padding: 16px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .stat-card {
    padding: 14px;
  }

  .stat-value {
    font-size: 22px;
  }

  .version-stat-item {
    flex-wrap: wrap;
    gap: 6px;
  }

  .version-name {
    min-width: 60px;
  }

  .version-count {
    min-width: 60px;
    font-size: 12px;
  }
}
</style>
