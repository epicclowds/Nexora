-- CreateTable
CREATE TABLE `players` (
    `uuid` CHAR(36) NOT NULL,
    `username` VARCHAR(16) NOT NULL,
    `first_seen_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,
    `online` BOOLEAN NOT NULL DEFAULT false,
    `current_server_id` VARCHAR(32) NULL,
    `total_playtime_seconds` BIGINT NOT NULL DEFAULT 0,
    `active_playtime_seconds` BIGINT NULL,
    `afk_seconds` BIGINT NULL,
    `connection_count` INTEGER NOT NULL DEFAULT 0,
    `rank` VARCHAR(64) NULL,
    `gamemode` VARCHAR(16) NULL,
    `client_protocol` INTEGER NULL,
    `client_version` VARCHAR(32) NULL,
    `client_brand` VARCHAR(128) NULL,
    `locale` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `players_username_idx`(`username`),
    INDEX `players_online_idx`(`online`),
    INDEX `players_last_seen_at_idx`(`last_seen_at`),
    INDEX `players_first_seen_at_idx`(`first_seen_at`),
    PRIMARY KEY (`uuid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_names` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `player_uuid` CHAR(36) NOT NULL,
    `username` VARCHAR(16) NOT NULL,
    `first_seen_at` DATETIME(3) NOT NULL,
    `last_seen_at` DATETIME(3) NOT NULL,

    INDEX `player_names_username_idx`(`username`),
    UNIQUE INDEX `player_names_player_uuid_username_key`(`player_uuid`, `username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `player_uuid` CHAR(36) NOT NULL,
    `proxy_server_id` VARCHAR(32) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NULL,
    `afk_seconds` INTEGER NULL,

    INDEX `player_sessions_player_uuid_started_at_idx`(`player_uuid`, `started_at`),
    INDEX `player_sessions_started_at_idx`(`started_at`),
    INDEX `player_sessions_ended_at_idx`(`ended_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_connections` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `player_uuid` CHAR(36) NOT NULL,
    `session_id` BIGINT NULL,
    `ip_address` VARCHAR(45) NULL,
    `country_code` CHAR(2) NULL,
    `region` VARCHAR(128) NULL,
    `city` VARCHAR(128) NULL,
    `isp` VARCHAR(255) NULL,
    `virtual_host` VARCHAR(255) NULL,
    `client_protocol` INTEGER NULL,
    `client_brand` VARCHAR(128) NULL,
    `connected_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_connections_session_id_key`(`session_id`),
    INDEX `player_connections_player_uuid_connected_at_idx`(`player_uuid`, `connected_at`),
    INDEX `player_connections_ip_address_idx`(`ip_address`),
    INDEX `player_connections_connected_at_idx`(`connected_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_server_visits` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `player_uuid` CHAR(36) NOT NULL,
    `session_id` BIGINT NULL,
    `server_id` VARCHAR(32) NOT NULL,
    `joined_at` DATETIME(3) NOT NULL,
    `left_at` DATETIME(3) NULL,

    INDEX `player_server_visits_player_uuid_joined_at_idx`(`player_uuid`, `joined_at`),
    INDEX `player_server_visits_server_id_joined_at_idx`(`server_id`, `joined_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_notes` (
    `id` VARCHAR(32) NOT NULL,
    `player_uuid` CHAR(36) NOT NULL,
    `author_user_id` VARCHAR(32) NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `player_notes_player_uuid_created_at_idx`(`player_uuid`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_statistics` (
    `player_uuid` CHAR(36) NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT 'network',
    `stat_key` VARCHAR(191) NOT NULL,
    `value` BIGINT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `player_statistics_stat_key_value_idx`(`stat_key`, `value`),
    PRIMARY KEY (`player_uuid`, `scope`, `stat_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_statistic_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `player_uuid` CHAR(36) NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT 'network',
    `stat_key` VARCHAR(191) NOT NULL,
    `value` BIGINT NOT NULL,
    `captured_at` DATETIME(3) NOT NULL,

    INDEX `player_statistic_snapshots_player_uuid_stat_key_captured_at_idx`(`player_uuid`, `stat_key`, `captured_at`),
    INDEX `player_statistic_snapshots_captured_at_idx`(`captured_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_inventories` (
    `id` VARCHAR(32) NOT NULL,
    `player_uuid` CHAR(36) NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT 'network',
    `kind` ENUM('INVENTORY', 'ENDER_CHEST') NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `contents` JSON NOT NULL,
    `captured_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_inventories_player_uuid_scope_kind_key`(`player_uuid`, `scope`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_revisions` (
    `id` VARCHAR(32) NOT NULL,
    `inventory_id` VARCHAR(32) NOT NULL,
    `base_revision` INTEGER NOT NULL,
    `revision` INTEGER NULL,
    `status` ENUM('SNAPSHOT', 'PENDING', 'APPLIED', 'CONFLICT', 'REJECTED', 'ROLLED_BACK') NOT NULL,
    `changes` JSON NOT NULL,
    `actor_user_id` VARCHAR(32) NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_at` DATETIME(3) NULL,

    INDEX `inventory_revisions_inventory_id_created_at_idx`(`inventory_id`, `created_at`),
    INDEX `inventory_revisions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `punishments` (
    `id` VARCHAR(32) NOT NULL,
    `target_uuid` CHAR(36) NOT NULL,
    `type` ENUM('BAN', 'TEMP_BAN', 'MUTE', 'TEMP_MUTE', 'KICK', 'WARNING', 'BLACKLIST') NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `source` ENUM('COMMAND', 'DASHBOARD', 'ANTICHEAT', 'API', 'CONSOLE') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `issuer_type` ENUM('USER', 'PLAYER', 'CONSOLE', 'SERVER', 'SYSTEM') NOT NULL,
    `issuer_user_id` VARCHAR(32) NULL,
    `issuer_uuid` CHAR(36) NULL,
    `issuer_name` VARCHAR(64) NOT NULL,
    `server_id` VARCHAR(32) NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(500) NULL,
    `revoked_by_type` ENUM('USER', 'PLAYER', 'CONSOLE', 'SERVER', 'SYSTEM') NULL,
    `revoked_by_user_id` VARCHAR(32) NULL,
    `revoked_by_uuid` CHAR(36) NULL,
    `revoked_by_name` VARCHAR(64) NULL,

    UNIQUE INDEX `punishments_idempotency_key_key`(`idempotency_key`),
    INDEX `punishments_target_uuid_type_status_idx`(`target_uuid`, `type`, `status`),
    INDEX `punishments_status_type_expires_at_idx`(`status`, `type`, `expires_at`),
    INDEX `punishments_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `punishment_evidence` (
    `id` VARCHAR(32) NOT NULL,
    `punishment_id` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `content` TEXT NULL,
    `url` VARCHAR(2048) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `punishment_evidence_punishment_id_idx`(`punishment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `anticheat_events` (
    `id` VARCHAR(32) NOT NULL,
    `player_uuid` CHAR(36) NOT NULL,
    `server_id` VARCHAR(32) NULL,
    `provider` VARCHAR(64) NOT NULL,
    `cheat_type` VARCHAR(64) NOT NULL,
    `violation_level` DOUBLE NULL,
    `metadata` JSON NULL,
    `punishment_id` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `anticheat_events_player_uuid_created_at_idx`(`player_uuid`, `created_at`),
    INDEX `anticheat_events_cheat_type_created_at_idx`(`cheat_type`, `created_at`),
    INDEX `anticheat_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `servers` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `type` ENUM('VELOCITY', 'PAPER') NOT NULL,
    `status` ENUM('PENDING', 'ONLINE', 'OFFLINE', 'DISABLED') NOT NULL DEFAULT 'PENDING',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `minecraft_version` VARCHAR(32) NULL,
    `plugin_version` VARCHAR(32) NULL,
    `platform_version` VARCHAR(128) NULL,
    `online_players` INTEGER NULL,
    `max_players` INTEGER NULL,
    `tps` DOUBLE NULL,
    `mspt` DOUBLE NULL,
    `memory_used_bytes` BIGINT NULL,
    `memory_max_bytes` BIGINT NULL,
    `cpu_load` DOUBLE NULL,
    `last_heartbeat_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `servers_name_key`(`name`),
    INDEX `servers_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `server_credentials` (
    `id` VARCHAR(32) NOT NULL,
    `server_id` VARCHAR(32) NOT NULL,
    `key_id` VARCHAR(64) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `server_credentials_key_id_key`(`key_id`),
    INDEX `server_credentials_server_id_idx`(`server_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registration_tokens` (
    `id` VARCHAR(32) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `server_type` ENUM('VELOCITY', 'PAPER') NOT NULL,
    `server_name` VARCHAR(64) NOT NULL,
    `created_by_user_id` VARCHAR(32) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `server_id` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `registration_tokens_token_hash_key`(`token_hash`),
    INDEX `registration_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_users` (
    `id` VARCHAR(32) NOT NULL,
    `username` VARCHAR(32) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role_id` VARCHAR(32) NOT NULL,
    `locale` VARCHAR(16) NULL,
    `theme` VARCHAR(16) NULL,
    `timezone` VARCHAR(64) NULL,
    `disabled` BOOLEAN NOT NULL DEFAULT false,
    `two_factor_secret` VARCHAR(255) NULL,
    `two_factor_enabled` BOOLEAN NOT NULL DEFAULT false,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dashboard_users_username_key`(`username`),
    UNIQUE INDEX `dashboard_users_email_key`(`email`),
    INDEX `dashboard_users_role_id_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_roles` (
    `id` VARCHAR(32) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dashboard_roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_permissions` (
    `key` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_role_permissions` (
    `role_id` VARCHAR(32) NOT NULL,
    `permission` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`role_id`, `permission`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_sessions` (
    `id` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(32) NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `dashboard_sessions_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `dashboard_sessions_user_id_idx`(`user_id`),
    INDEX `dashboard_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_type` ENUM('USER', 'PLAYER', 'CONSOLE', 'SERVER', 'SYSTEM') NOT NULL,
    `actor_user_id` VARCHAR(32) NULL,
    `actor_name` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(32) NULL,
    `target_id` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_created_at_idx`(`created_at`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(128) NOT NULL,
    `value` JSON NOT NULL,
    `updated_by_user_id` VARCHAR(32) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `language_settings` (
    `locale` VARCHAR(16) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`locale`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `players` ADD CONSTRAINT `players_current_server_id_fkey` FOREIGN KEY (`current_server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_names` ADD CONSTRAINT `player_names_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_sessions` ADD CONSTRAINT `player_sessions_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_sessions` ADD CONSTRAINT `player_sessions_proxy_server_id_fkey` FOREIGN KEY (`proxy_server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_connections` ADD CONSTRAINT `player_connections_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_connections` ADD CONSTRAINT `player_connections_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `player_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_server_visits` ADD CONSTRAINT `player_server_visits_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_server_visits` ADD CONSTRAINT `player_server_visits_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `player_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_server_visits` ADD CONSTRAINT `player_server_visits_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_notes` ADD CONSTRAINT `player_notes_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_notes` ADD CONSTRAINT `player_notes_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_statistics` ADD CONSTRAINT `player_statistics_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_statistic_snapshots` ADD CONSTRAINT `player_statistic_snapshots_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_inventories` ADD CONSTRAINT `player_inventories_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_revisions` ADD CONSTRAINT `inventory_revisions_inventory_id_fkey` FOREIGN KEY (`inventory_id`) REFERENCES `player_inventories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_revisions` ADD CONSTRAINT `inventory_revisions_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `punishments` ADD CONSTRAINT `punishments_target_uuid_fkey` FOREIGN KEY (`target_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `punishments` ADD CONSTRAINT `punishments_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `punishments` ADD CONSTRAINT `punishments_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `punishments` ADD CONSTRAINT `punishments_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `punishment_evidence` ADD CONSTRAINT `punishment_evidence_punishment_id_fkey` FOREIGN KEY (`punishment_id`) REFERENCES `punishments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `anticheat_events` ADD CONSTRAINT `anticheat_events_player_uuid_fkey` FOREIGN KEY (`player_uuid`) REFERENCES `players`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `anticheat_events` ADD CONSTRAINT `anticheat_events_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `anticheat_events` ADD CONSTRAINT `anticheat_events_punishment_id_fkey` FOREIGN KEY (`punishment_id`) REFERENCES `punishments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `server_credentials` ADD CONSTRAINT `server_credentials_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registration_tokens` ADD CONSTRAINT `registration_tokens_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registration_tokens` ADD CONSTRAINT `registration_tokens_server_id_fkey` FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_users` ADD CONSTRAINT `dashboard_users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `dashboard_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_role_permissions` ADD CONSTRAINT `dashboard_role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `dashboard_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_sessions` ADD CONSTRAINT `dashboard_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `dashboard_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

