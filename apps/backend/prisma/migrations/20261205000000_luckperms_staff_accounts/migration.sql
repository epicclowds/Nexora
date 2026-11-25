-- LuckPerms integration, Minecraft account linking and staff account management.
-- Additive only: existing users, roles, punishments and players are not changed.

ALTER TABLE `dashboard_users`
    ADD COLUMN `managed_by` ENUM('NONE', 'LUCKPERMS') NOT NULL DEFAULT 'NONE',
    ADD COLUMN `disabled_by_luckperms` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `linked_minecraft_accounts` (
    `id` VARCHAR(32) NOT NULL,
    `dashboard_user_id` VARCHAR(32) NOT NULL,
    `minecraft_uuid` CHAR(36) NOT NULL,
    `minecraft_username` VARCHAR(16) NOT NULL,
    `linked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_verified_at` DATETIME(3) NULL,

    UNIQUE INDEX `linked_minecraft_accounts_dashboard_user_id_key`(`dashboard_user_id`),
    UNIQUE INDEX `linked_minecraft_accounts_minecraft_uuid_key`(`minecraft_uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `account_link_tokens` (
    `id` VARCHAR(32) NOT NULL,
    `minecraft_uuid` CHAR(36) NOT NULL,
    `minecraft_username` VARCHAR(16) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `register_permission` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,

    UNIQUE INDEX `account_link_tokens_token_hash_key`(`token_hash`),
    INDEX `account_link_tokens_minecraft_uuid_consumed_at_idx`(`minecraft_uuid`, `consumed_at`),
    INDEX `account_link_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `luckperms_group_mappings` (
    `id` VARCHAR(32) NOT NULL,
    `group_name` VARCHAR(64) NOT NULL,
    `role_id` VARCHAR(32) NULL,
    `dashboard_access` BOOLEAN NOT NULL DEFAULT true,
    `deny` BOOLEAN NOT NULL DEFAULT false,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `luckperms_group_mappings_group_name_key`(`group_name`),
    INDEX `luckperms_group_mappings_role_id_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permission_sync_states` (
    `minecraft_uuid` CHAR(36) NOT NULL,
    `username` VARCHAR(16) NULL,
    `primary_group` VARCHAR(64) NULL,
    `group_display` VARCHAR(64) NULL,
    `groups` JSON NOT NULL,
    `prefix` VARCHAR(255) NULL,
    `suffix` VARCHAR(255) NULL,
    `weight` INTEGER NULL,
    `permissions` JSON NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'LUCKPERMS',
    `expires_at` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `synchronized_at` DATETIME(3) NOT NULL,
    `server_id` VARCHAR(32) NULL,

    INDEX `permission_sync_states_synchronized_at_idx`(`synchronized_at`),
    PRIMARY KEY (`minecraft_uuid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `staff_account_status_history` (
    `id` VARCHAR(32) NOT NULL,
    `dashboard_user_id` VARCHAR(32) NOT NULL,
    `previous_status` VARCHAR(32) NULL,
    `new_status` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `staff_account_status_history_dashboard_user_id_created_at_idx`(`dashboard_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `linked_minecraft_accounts` ADD CONSTRAINT `linked_minecraft_accounts_dashboard_user_id_fkey` FOREIGN KEY (`dashboard_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `luckperms_group_mappings` ADD CONSTRAINT `luckperms_group_mappings_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `dashboard_roles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `staff_account_status_history` ADD CONSTRAINT `staff_account_status_history_dashboard_user_id_fkey` FOREIGN KEY (`dashboard_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
