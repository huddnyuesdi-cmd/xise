-- 授权管理表
CREATE TABLE IF NOT EXISTS `authorizations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `domain` VARCHAR(255) NOT NULL COMMENT '授权域名',
  `ip_list` JSON NOT NULL COMMENT '绑定的IP列表',
  `status` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '授权状态',
  `note` VARCHAR(500) NULL COMMENT '备注信息',
  `expires_at` DATETIME(3) NULL COMMENT '授权过期时间',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_authorization_domain` (`domain` ASC),
  INDEX `idx_authorization_status` (`status` ASC),
  INDEX `idx_authorization_expires_at` (`expires_at` ASC)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
