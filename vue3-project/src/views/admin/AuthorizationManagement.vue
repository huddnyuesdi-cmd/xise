<template>
  <div class="authorization-management">
    <CrudTable 
      title="授权管理" 
      entity-name="授权" 
      api-endpoint="/admin/authorizations" 
      :columns="columns"
      :form-fields="formFields" 
      :search-fields="searchFields"
    />
  </div>
</template>

<script setup>
import CrudTable from '@/views/admin/components/CrudTable.vue'

const columns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'domain', label: '授权域名', sortable: false },
  { key: 'ip_list', label: '绑定IP', type: 'json', sortable: false },
  { key: 'status', label: '状态', type: 'boolean', trueText: '启用', falseText: '禁用', sortable: false },
  { key: 'note', label: '备注', sortable: false, maxLength: 30 },
  { key: 'expires_at', label: '过期时间', type: 'date', sortable: true },
  { key: 'created_at', label: '创建时间', type: 'date', sortable: true },
  { key: 'updated_at', label: '更新时间', type: 'date', sortable: true }
]

const formFields = [
  { key: 'domain', label: '授权域名', type: 'text', required: true, placeholder: '请输入授权域名，如 example.com' },
  { key: 'ip_list', label: '绑定IP列表', type: 'textarea', required: false, placeholder: '请输入IP地址，多个IP用英文逗号分隔，如: 1.2.3.4, 5.6.7.8' },
  {
    key: 'status',
    label: '授权状态',
    type: 'select',
    required: false,
    options: [
      { value: true, label: '启用' },
      { value: false, label: '禁用' }
    ]
  },
  { key: 'note', label: '备注', type: 'textarea', required: false, placeholder: '请输入备注信息' },
  { key: 'expires_at', label: '过期时间', type: 'text', required: false, placeholder: '留空表示永久有效，格式: 2026-12-31' }
]

const searchFields = [
  { key: 'domain', label: '域名', placeholder: '搜索域名' },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    placeholder: '授权状态',
    options: [
      { value: '', label: '全部状态' },
      { value: 'true', label: '启用' },
      { value: 'false', label: '禁用' }
    ]
  }
]
</script>

<style scoped>
.authorization-management {
  display: flex;
  flex-direction: column;
  gap: 0;
}
</style>
