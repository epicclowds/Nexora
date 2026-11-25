-- Punishment reason presets with numeric IDs (additive; existing data is unchanged).

CREATE TABLE `punishment_presets` (
    `id` VARCHAR(32) NOT NULL,
    `category` ENUM('BAN', 'MUTE', 'KICK', 'WARN') NOT NULL,
    `numeric_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `duration_seconds` INTEGER NULL,
    `permanent` BOOLEAN NOT NULL DEFAULT false,
    `permission` VARCHAR(100) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `archived_at` DATETIME(3) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by_user_id` VARCHAR(32) NULL,
    `updated_by_name` VARCHAR(64) NULL,

    UNIQUE INDEX `punishment_presets_category_numeric_id_key`(`category`, `numeric_id`),
    INDEX `punishment_presets_category_enabled_archived_at_sort_order_idx`(`category`, `enabled`, `archived_at`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Snapshot of the preset used for a punishment.
ALTER TABLE `punishments`
    ADD COLUMN `preset_id` VARCHAR(32) NULL,
    ADD COLUMN `preset_category` ENUM('BAN', 'MUTE', 'KICK', 'WARN') NULL,
    ADD COLUMN `preset_numeric_id` INTEGER NULL,
    ADD COLUMN `preset_name` VARCHAR(100) NULL;

CREATE INDEX `punishments_preset_id_idx` ON `punishments`(`preset_id`);
ALTER TABLE `punishments` ADD CONSTRAINT `punishments_preset_id_fkey` FOREIGN KEY (`preset_id`) REFERENCES `punishment_presets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions. Owner has every permission; Administrator manages presets and may use every
-- reason; Moderator and Supporter receive the reason categories matching their punishments.
-- Custom roles are not changed. (The startup synchronisation registers the catalogue as well.)
INSERT IGNORE INTO `dashboard_permissions` (`key`) VALUES
    ('punishments.presets.manage'), ('integrations.manage'), ('nexora.punishment.*'), ('nexora.punishment.ban.*'),
    ('nexora.punishment.mute.*'), ('nexora.punishment.kick.*'), ('nexora.punishment.warn.*'), ('nexora.punishment.custom'),
    ('nexora.punishment.duration-override'), ('nexora.punishment.permanent');

INSERT IGNORE INTO `dashboard_role_permissions` (`role_id`, `permission`)
SELECT r.`id`, g.`permission`
FROM `dashboard_roles` r
JOIN (
    SELECT 'administrator' AS `role_key`, 'punishments.presets.manage' AS `permission`
    UNION ALL SELECT 'administrator', 'nexora.punishment.*'
    UNION ALL SELECT 'moderator', 'nexora.punishment.ban.*'
    UNION ALL SELECT 'moderator', 'nexora.punishment.mute.*'
    UNION ALL SELECT 'moderator', 'nexora.punishment.kick.*'
    UNION ALL SELECT 'moderator', 'nexora.punishment.warn.*'
    UNION ALL SELECT 'moderator', 'nexora.punishment.custom'
    UNION ALL SELECT 'supporter', 'nexora.punishment.mute.*'
    UNION ALL SELECT 'supporter', 'nexora.punishment.kick.*'
    UNION ALL SELECT 'supporter', 'nexora.punishment.warn.*'
) g ON g.`role_key` = r.`key`
WHERE r.`is_system` = 1;
