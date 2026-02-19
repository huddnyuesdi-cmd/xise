<template>
  <CrudTable 
    title="应用版本管理" 
    entity-name="应用版本" 
    api-endpoint="/admin/app-versions" 
    :columns="columns"
    :form-fields="formFields" 
    :search-fields="searchFields" 
  />
</template>

<script setup>
import CrudTable from '@/views/admin/components/CrudTable.vue'

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
