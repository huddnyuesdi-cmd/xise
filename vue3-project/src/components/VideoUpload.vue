<template>
  <div class="video-upload">
    <div class="upload-area" @click="!isUploading && !videoData && triggerFileInput()"
      :class="{ 'drag-over': isDragOver, 'uploading': isUploading, 'has-video': videoData }"
      @dragover.prevent="!isUploading && (isDragOver = true)" @dragleave.prevent="isDragOver = false"
      @drop.prevent="!isUploading && handleFileDrop($event)">

      <input ref="fileInput" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-ms-wmv,video/x-flv,video/webm" @change="handleFileSelect" style="display: none"
        :disabled="isUploading" />

      <!-- 隐藏的封面图片文件输入框 -->
      <input ref="coverInput" type="file" accept="image/jpeg,image/png,image/webp,image/jpg" @change="handleCoverSelect" style="display: none" />

      <!-- 视频上传成功状态 -->
      <div v-if="videoData && !isUploading" class="video-success" @click="triggerFileInput()">
        <!-- 缩略图 -->
        <div class="video-thumbnail" @click.stop="triggerCoverInput($event)" :class="{ 'custom-cover': customCover }">
          <img v-if="customCover || videoData.thumbnailDataUrl || videoData.coverUrl"
            :src="customCover || videoData.thumbnailDataUrl || videoData.coverUrl" alt="视频缩略图"
            class="thumbnail-image" />
          <div v-else class="thumbnail-placeholder">
            <SvgIcon name="publish" width="24" height="24" />
          </div>
          <!-- 自定义封面提示 -->
          <div class="cover-overlay">
            <SvgIcon name="edit" width="16" height="16" />
            <span>自定义封面</span>
          </div>
        </div>

        <div class="video-info">
          <div class="success-text">
            <div class="success-icon">
              <SvgIcon name="tick" width="14" height="14" />
            </div>
            上传成功
          </div>
          <div v-if="videoData.duration > 0" class="duration-status">
            <SvgIcon name="play" width="12" height="12" />
            时长：{{ formatDuration(videoData.duration) }}
          </div>
          <div v-if="customCover" class="cover-status">
            <SvgIcon name="image" width="12" height="12" />
            已设置自定义封面
          </div>
        </div>
      </div>

      <!-- 上传占位符 -->
      <div v-else-if="!isUploading" class="upload-placeholder">
        <SvgIcon name="publish" class="upload-icon" />
        <p>添加视频</p>
        <p class="upload-hint">支持 MP4、MOV、AVI 格式</p>
        <p class="upload-hint">文件大小不超过{{ maxSizeMB }}MB</p>
        <p class="drag-hint">或拖拽视频到此处</p>
      </div>

      <!-- 上传进度 -->
      <div v-if="isUploading" class="upload-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <p class="progress-text">{{ Math.floor(uploadProgress) }}%</p>
        <p v-if="uploadStatus" class="progress-status">{{ uploadStatus }}</p>
        <p v-if="chunkInfo.total > 0" class="chunk-info">分片 {{ chunkInfo.current }}/{{ chunkInfo.total }}</p>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div class="upload-tips">
      <p>• 支持 MP4、MOV、AVI 格式</p>
      <p>• 文件大小不超过{{ maxSizeMB }}MB</p>
      <p>• 支持断点续传和分片校验</p>
      <p v-if="videoData && !isUploading">• 点击缩略图可自定义封面</p>
    </div>

    <MessageToast v-if="showToast" :message="toastMessage" :type="toastType" @close="handleToastClose" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import SvgIcon from './SvgIcon.vue'
import MessageToast from './MessageToast.vue'
import { videoApi } from '@/api/video.js'
import { uploadImage } from '@/api/upload.js'
import { generateVideoThumbnail, blobToFile, generateThumbnailFilename } from '@/utils/videoThumbnail.js'

const props = defineProps({
  modelValue: {
    type: [String, Object], // 支持字符串和对象类型
    default: ''
  },
  maxSize: {
    type: Number,
    default: 100 * 1024 * 1024 // 100MB
  },
  useChunkedUpload: {
    type: Boolean,
    default: true // 默认启用分片上传
  }
})

const emit = defineEmits(['update:modelValue', 'error', 'change'])

// 响应式数据
const fileInput = ref(null)
const coverInput = ref(null)
const videoData = ref(null)
const customCover = ref(null) // 自定义封面图片URL
const customCoverFile = ref(null) // 自定义封面图片文件
const isUploading = ref(false)
const uploadProgress = ref(0)
const chunkInfo = ref({ current: 0, total: 0 }) // 分片信息
const uploadStatus = ref('') // 上传状态文字
const isDragOver = ref(false)
const error = ref('')
const showToast = ref(false)
const toastMessage = ref('')
const toastType = ref('success')
// 从服务器获取的配置
const serverMaxSize = ref(null)

// 计算实际使用的最大文件大小：优先使用服务器配置，如果未获取到则使用prop
const actualMaxSize = computed(() => {
  return serverMaxSize.value !== null ? serverMaxSize.value : props.maxSize
})

// 格式化显示的文件大小（MB）
const maxSizeMB = computed(() => {
  return Math.round(actualMaxSize.value / (1024 * 1024))
})

// 组件挂载时获取服务器配置
onMounted(async () => {
  try {
    const config = await videoApi.getChunkConfig()
    if (config.maxFileSize) {
      serverMaxSize.value = config.maxFileSize
    }
  } catch (error) {
    console.warn('Failed to get server video config, using default config:', error)
  }
})

// 监听外部值变化
watch(() => props.modelValue, (newValue) => {
  if (!newValue && videoData.value) {
    // 外部清空了值，重置组件
    videoData.value = null
    customCover.value = null
    customCoverFile.value = null
    error.value = ''
  } else if (newValue && !videoData.value) {
    // 外部设置了值，但组件没有数据，可能是从外部加载的视频
    if (typeof newValue === 'object' && newValue.url) {
      // 如果是对象，包含url和coverUrl
      videoData.value = {
        preview: newValue.url,
        url: newValue.url,
        coverUrl: newValue.coverUrl,
        uploaded: true,
        name: '已上传的视频',
        size: 0
      }
    } else if (typeof newValue === 'string') {
      // 如果是字符串，只有url
      videoData.value = {
        preview: newValue,
        url: newValue,
        uploaded: true,
        name: '已上传的视频',
        size: 0
      }
    }
  }
})

// 触发文件选择
const triggerFileInput = () => {
  if (fileInput.value) {
    fileInput.value.click()
  }
}

// 触发封面图片选择
const triggerCoverInput = (event) => {
  // 阻止事件冒泡和默认行为
  if (event) {
    event.preventDefault()
    event.stopPropagation()
  }

  if (coverInput.value) {
    coverInput.value.click()
  }
}

// 处理文件选择
const handleFileSelect = (event) => {
  const files = event.target.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
}

// 处理封面图片选择
const handleCoverSelect = async (event) => {
  const files = event.target.files
  if (files && files.length > 0) {
    await handleCoverFile(files[0])
  }
}

// 处理文件拖拽
const handleFileDrop = (event) => {
  isDragOver.value = false
  const files = event.dataTransfer.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
}

// 验证视频文件
const validateVideoFile = (file) => {
  // 验证文件类型
  if (!file.type.startsWith('video/')) {
    return { valid: false, message: '请选择视频文件' }
  }

  // 验证文件大小
  if (file.size > actualMaxSize.value) {
    return { valid: false, message: `文件大小不能超过${formatFileSize(actualMaxSize.value)}` }
  }

  return { valid: true }
}

// 验证封面图片文件
const validateCoverFile = (file) => {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    return { valid: false, message: '请选择图片文件' }
  }

  // 验证文件大小 (5MB)
  const maxCoverSize = 5 * 1024 * 1024
  if (file.size > maxCoverSize) {
    return { valid: false, message: `封面图片大小不能超过${formatFileSize(maxCoverSize)}` }
  }

  return { valid: true }
}

// 处理文件
const handleFile = async (file) => {
  if (!file) return

  // 验证文件
  const validation = validateVideoFile(file)
  if (!validation.valid) {
    error.value = validation.message
    emit('error', validation.message)
    return
  }

  // 创建预览
  const preview = URL.createObjectURL(file)

  // 保存当前的自定义封面状态
  const currentCustomCover = customCover.value
  const currentCustomCoverFile = customCoverFile.value

  videoData.value = {
    file: file,
    preview: preview,
    name: file.name,
    size: file.size,
    uploaded: false,
    url: null,
    thumbnail: null, // 缩略图数据
    thumbnailDataUrl: null, // 缩略图预览URL
    duration: 0 // 视频时长（秒）
  }
  
  // 获取视频时长
  await getVideoDuration(preview)

  // 清空错误，但保持自定义封面
  error.value = ''
  // 如果之前有自定义封面，保持不变
  if (!currentCustomCover) {
    customCover.value = null
    customCoverFile.value = null
  }

  // 传递文件名作为modelValue（字符串类型）
  emit('update:modelValue', file.name)

  // 触发change事件，通知父组件有变更
  emit('change', { type: 'video', hasChanges: true })

  // 生成缩略图
  await generateThumbnail(file)
}

// 处理封面图片文件
const handleCoverFile = async (file) => {
  if (!file) return

  // 验证封面图片文件
  const validation = validateCoverFile(file)
  if (!validation.valid) {
    error.value = validation.message
    showMessage(validation.message, 'error')
    return
  }

  try {
    // 创建预览URL
    const previewUrl = URL.createObjectURL(file)
    customCover.value = previewUrl
    customCoverFile.value = file

    // 触发change事件，通知父组件有变更
    emit('change', { type: 'cover', hasChanges: true })
  } catch (err) {
    console.error('处理封面图片失败:', err)
    error.value = '处理封面图片失败'
    showMessage('处理封面图片失败', 'error')
  }
}

// 获取视频时长
const getVideoDuration = (videoUrl) => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    
    // 只有blob URL才需要revoke
    const isBlobUrl = videoUrl && videoUrl.startsWith('blob:')
    
    video.onloadedmetadata = () => {
      if (videoData.value) {
        videoData.value.duration = Math.floor(video.duration)
      }
      if (isBlobUrl) {
        // 不要revoke，因为这个URL还在预览中使用
      }
      video.src = ''
      resolve()
    }
    
    video.onerror = () => {
      console.warn('获取视频时长失败')
      video.src = ''
      resolve()
    }
    
    video.src = videoUrl
  })
}

// 格式化视频时长
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// 生成视频缩略图
const generateThumbnail = async (file) => {
  try {
    const result = await generateVideoThumbnail(file, {
      useOriginalSize: true,
      quality: 0.8,
      seekTime: 1
    })

    if (result.success && videoData.value) {
      // 将Blob转换为File对象
      const thumbnailFile = blobToFile(result.blob, generateThumbnailFilename(file.name))

      videoData.value.thumbnail = thumbnailFile
      videoData.value.thumbnailDataUrl = result.dataUrl

      // 移除成功消息提示，避免误导用户
    } else {
      console.warn('⚠️ 视频缩略图生成失败:', result.error)
      showMessage('缩略图生成失败，但不影响视频上传', 'warning')
    }
  } catch (error) {
    console.error('❌ 生成视频缩略图异常:', error)
    showMessage('缩略图生成异常，但不影响视频上传', 'warning')
  }
}

// 上传自定义封面图片
const uploadCustomCover = async () => {
  if (!customCoverFile.value) return null

  try {
    const result = await uploadImage(customCoverFile.value)
    if (result.success) {
      return result.data.url
    } else {
      console.error('封面图片上传失败:', result.message)
      return null
    }
  } catch (error) {
    console.error('封面图片上传异常:', error)
    return null
  }
}

// 开始上传过程
const startUpload = async () => {
  if (!videoData.value || !videoData.value.file) {
    return { success: false, message: '没有视频文件' }
  }

  isUploading.value = true
  uploadProgress.value = 0
  chunkInfo.value = { current: 0, total: 0 }
  uploadStatus.value = '准备上传...'

  try {
    // 确定要传递的缩略图文件
    let thumbnailToUpload = null

    // 优先使用自定义封面
    if (customCoverFile.value) {
      thumbnailToUpload = customCoverFile.value
    } else if (videoData.value.thumbnail) {
      thumbnailToUpload = videoData.value.thumbnail
    }

    let result

    // 根据配置选择上传方式
    if (props.useChunkedUpload) {
      // 使用分片上传
      uploadStatus.value = '计算文件校验...'
      result = await videoApi.uploadVideoChunked(
        videoData.value.file,
        {
          onProgress: (progress) => {
            uploadProgress.value = progress
            if (progress < 100) {
              uploadStatus.value = `上传中 ${progress}%`
            } else {
              uploadStatus.value = '合并中...'
            }
          },
          onChunkProgress: (info) => {
            chunkInfo.value = { current: info.current, total: info.total }
            if (info.skipped) {
              uploadStatus.value = `分片 ${info.current}/${info.total} (已存在)`
            } else {
              uploadStatus.value = `分片 ${info.current}/${info.total}`
            }
          }
        }
      )
      
      // 分片上传成功后，单独上传缩略图
      if (result.success && thumbnailToUpload) {
        try {
          uploadStatus.value = '上传封面...'
          const thumbnailResult = await uploadImage(thumbnailToUpload)
          if (thumbnailResult.success) {
            result.data.coverUrl = thumbnailResult.data.url
            console.log('✅ 缩略图上传成功:', thumbnailResult.data.url)
          } else {
            console.warn('⚠️ 缩略图上传失败:', thumbnailResult.message)
          }
        } catch (e) {
          console.warn('⚠️ 缩略图上传异常:', e.message)
        }
      }
    } else {
      // 使用普通上传
      result = await videoApi.uploadVideo(
        videoData.value.file,
        (progress) => {
          uploadProgress.value = progress
          uploadStatus.value = `上传中 ${progress}%`
        },
        thumbnailToUpload
      )
    }

    if (result.success) {
      isUploading.value = false
      uploadStatus.value = ''
      if (videoData.value) {
        videoData.value.uploaded = true
        videoData.value.url = result.data.url
        videoData.value.coverUrl = result.data.coverUrl

        // 如果使用了自定义封面，更新显示
        if (customCoverFile.value && result.data.coverUrl) {
          customCover.value = result.data.coverUrl
        }

        emit('update:modelValue', videoData.value.url)
        showMessage('视频上传成功', 'success')
        return result // 返回上传结果
      }
    } else {
      isUploading.value = false
      uploadStatus.value = ''
      error.value = result.message || '视频上传失败'
      emit('error', error.value)
      showMessage(error.value, 'error')
      return result // 返回失败结果
    }
  } catch (err) {
    console.error('视频上传失败:', err)
    isUploading.value = false
    uploadStatus.value = ''
    error.value = '视频上传失败，请重试'
    emit('error', error.value)
    showMessage(error.value, 'error')
    return { success: false, message: '视频上传失败，请重试' }
  }
}

// 移除视频
const removeVideo = () => {
  if (videoData.value && videoData.value.preview) {
    URL.revokeObjectURL(videoData.value.preview)
  }
  if (customCover.value && customCover.value.startsWith('blob:')) {
    URL.revokeObjectURL(customCover.value)
  }

  videoData.value = null
  customCover.value = null
  customCoverFile.value = null
  error.value = ''
  uploadProgress.value = 0
  emit('update:modelValue', '')

  if (fileInput.value) {
    fileInput.value.value = ''
  }
  if (coverInput.value) {
    coverInput.value.value = ''
  }
}

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 显示消息提示
const showMessage = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  showToast.value = true
}

// 关闭消息提示
const handleToastClose = () => {
  showToast.value = false
}

// 获取视频数据
const getVideoData = () => {
  return {
    ...videoData.value,
    customCover: customCover.value,
    customCoverFile: customCoverFile.value
  }
}

// 重置组件
const reset = () => {
  removeVideo()
}

// 暴露方法给父组件
defineExpose({
  getVideoData,
  reset,
  removeVideo,
  startUpload,
  customCoverFile,
  uploadCustomCover
})
</script>

<style scoped>
.video-upload {
  width: 100%;
}

.upload-area {
  width: 100%;
  min-height: 200px;
  border: 2px dashed var(--border-color-primary);
  border-radius: 8px;
  background: var(--bg-color-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.upload-area:hover {
  border-color: var(--primary-color);
  background: var(--bg-color-secondary);
}

.upload-area.drag-over {
  border-color: var(--primary-color);
  background: var(--bg-color-secondary);
  transform: scale(1.02);
}


.upload-area.has-video {
  min-height: 100px;
  cursor: default;
  border: none;
  background: transparent;
}

.upload-area.has-video:hover {
  border: none;
  background: transparent;
}

.video-upload:has(.upload-area.has-video) .upload-tips {
  display: none;
}

.video-success {
  width: 90%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  background: var(--bg-color-secondary);
  border-radius: 4px;
  border: 1px solid var(--success-color);
  cursor: pointer;
}

.video-thumbnail {
  width: 60px;
  height: 60px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-color-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}

.video-thumbnail:hover {
  transform: scale(1.05);
}

.video-thumbnail:hover .cover-overlay {
  opacity: 1;
}


.cover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  color: white;
  font-size: 10px;
  gap: 2px;
}

.cover-overlay span {
  font-size: 10px;
  white-space: nowrap;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-placeholder {
  color: var(--text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-icon {
  width: 16px;
  height: 16px;
  background: #2abc3b;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  margin-right: 6px;
  vertical-align: middle;
}

.video-info {
  margin-left: 12px;
  flex: 1;
  color: var(--text-color-primary);
}

.success-text {
  font-size: 12px;
  margin: 0;
  color: var(--success-color);
  font-weight: 500;
  display: flex;
  align-items: center;
}

.cover-status {
  font-size: 10px;
  color: var(--primary-color);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.duration-status {
  font-size: 10px;
  color: var(--text-color-secondary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-color-secondary);
}

.upload-placeholder .upload-icon {
  width: 40px;
  height: 40px;
}

.upload-placeholder p {
  margin: 4px 0;
  font-size: 14px;
}

.upload-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.drag-hint {
  font-size: 12px;
  color: var(--text-color-quaternary);
  margin-top: 8px;
}

.upload-progress {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
  text-align: center;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-color-tertiary);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--success-color));
  transition: width 0.3s ease;
  border-radius: 3px;
}

.progress-text {
  font-size: 12px;
  color: var(--text-color-secondary);
  margin: 0;
}

.progress-status {
  font-size: 11px;
  color: var(--text-color-tertiary);
  margin: 4px 0 0 0;
}

.chunk-info {
  font-size: 10px;
  color: var(--primary-color);
  margin: 2px 0 0 0;
  font-weight: 500;
}

.error-message {
  color: var(--danger-color);
  font-size: 12px;
  margin-top: 8px;
}

.upload-tips {
  font-size: 12px;
  color: var(--text-color-secondary);
  line-height: 1.4;
  margin-top: 8px;
}

.upload-tips p {
  margin: 2px 0;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .upload-area {
    min-height: 150px;
  }

  .upload-area.has-video {
    min-height: 100px;
  }

  .video-player {
    max-height: 180px;
  }

}
</style>
