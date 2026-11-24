-- Punishment editing, evidence management and change history.
-- Additive only: no existing rows are changed or deleted.

-- AlterTable: optimistic locking, modification time, internal staff note
ALTER TABLE `punishments` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `updated_at` DATETIME(3) NULL,
    ADD COLUMN `staff_note` TEXT NULL;

-- AlterTable: new feed kinds for the plugins
ALTER TABLE `punishment_changes` MODIFY `kind` ENUM('CREATED', 'REVOKED', 'UPDATED', 'REACTIVATED') NOT NULL;

-- AlterTable: evidence metadata, visibility, authorship and soft deletion
ALTER TABLE `punishment_evidence` ADD COLUMN `title` VARCHAR(200) NULL,
    ADD COLUMN `visibility` ENUM('STAFF', 'PUBLIC') NOT NULL DEFAULT 'STAFF',
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `created_by_type` ENUM('USER', 'PLAYER', 'CONSOLE', 'SERVER', 'SYSTEM') NULL,
    ADD COLUMN `created_by_user_id` VARCHAR(32) NULL,
    ADD COLUMN `created_by_name` VARCHAR(64) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL,
    ADD COLUMN `updated_by_name` VARCHAR(64) NULL,
    ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `deleted_by_name` VARCHAR(64) NULL;

-- The new composite index covers the foreign key, so the old one can go afterwards.
CREATE INDEX `punishment_evidence_punishment_id_deleted_at_idx` ON `punishment_evidence`(`punishment_id`, `deleted_at`);
CREATE INDEX `punishment_evidence_deleted_at_idx` ON `punishment_evidence`(`deleted_at`);
DROP INDEX `punishment_evidence_punishment_id_idx` ON `punishment_evidence`;

-- Existing (AntiCheat) evidence was created by the system.
UPDATE `punishment_evidence` SET `created_by_type` = 'SYSTEM', `created_by_name` = 'AntiCheat' WHERE `created_by_type` IS NULL;

-- CreateTable
CREATE TABLE `punishment_history` (
    `id` VARCHAR(32) NOT NULL,
    `punishment_id` VARCHAR(32) NOT NULL,
    `action` ENUM('CREATED', 'REASON_CHANGED', 'DURATION_EXTENDED', 'DURATION_SHORTENED', 'MADE_PERMANENT', 'MADE_TEMPORARY', 'NOTE_CHANGED', 'EVIDENCE_ADDED', 'EVIDENCE_UPDATED', 'EVIDENCE_REMOVED', 'REVOKED', 'REACTIVATED') NOT NULL,
    `previous_values` JSON NULL,
    `new_values` JSON NULL,
    `actor_type` ENUM('USER', 'PLAYER', 'CONSOLE', 'SERVER', 'SYSTEM') NOT NULL,
    `actor_user_id` VARCHAR(32) NULL,
    `actor_uuid` CHAR(36) NULL,
    `actor_name` VARCHAR(64) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `punishment_history_punishment_id_created_at_idx`(`punishment_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `punishment_history` ADD CONSTRAINT `punishment_history_punishment_id_fkey` FOREIGN KEY (`punishment_id`) REFERENCES `punishments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing punishment gets its creation entry …
INSERT INTO `punishment_history` (`id`, `punishment_id`, `action`, `previous_values`, `new_values`, `actor_type`, `actor_user_id`, `actor_uuid`, `actor_name`, `note`, `created_at`)
SELECT CONCAT('hc', SUBSTRING(SHA2(CONCAT(p.`id`, ':created'), 256), 1, 30)), p.`id`, 'CREATED', NULL,
       JSON_OBJECT('type', p.`type`, 'reason', p.`reason`,
                   'expiresAt', IF(p.`expires_at` IS NULL, NULL, DATE_FORMAT(p.`expires_at`, '%Y-%m-%dT%H:%i:%s.%fZ'))),
       p.`issuer_type`, p.`issuer_user_id`, p.`issuer_uuid`, p.`issuer_name`, NULL, p.`created_at`
FROM `punishments` p;

-- … and revoked ones their revocation entry.
INSERT INTO `punishment_history` (`id`, `punishment_id`, `action`, `previous_values`, `new_values`, `actor_type`, `actor_user_id`, `actor_uuid`, `actor_name`, `note`, `created_at`)
SELECT CONCAT('hr', SUBSTRING(SHA2(CONCAT(p.`id`, ':revoked'), 256), 1, 30)), p.`id`, 'REVOKED',
       JSON_OBJECT('status', 'ACTIVE'), JSON_OBJECT('status', 'REVOKED'),
       COALESCE(p.`revoked_by_type`, 'SYSTEM'), p.`revoked_by_user_id`, p.`revoked_by_uuid`, COALESCE(p.`revoked_by_name`, 'unknown'),
       LEFT(p.`revoked_reason`, 1000), COALESCE(p.`revoked_at`, p.`created_at`)
FROM `punishments` p
WHERE p.`status` = 'REVOKED';

-- Permissions for the new features. The startup synchronisation registers the
-- catalogue as well; here the built-in roles receive their defaults once.
-- Custom roles are not changed (administrators grant the permissions explicitly).
INSERT IGNORE INTO `dashboard_permissions` (`key`) VALUES
    ('punishments.edit'), ('punishments.edit.reason'), ('punishments.edit.duration'), ('punishments.edit.permanent'),
    ('punishments.reactivate'), ('punishments.evidence.view'), ('punishments.evidence.add'), ('punishments.evidence.edit'),
    ('punishments.evidence.delete'), ('punishments.history.view');

INSERT IGNORE INTO `dashboard_role_permissions` (`role_id`, `permission`)
SELECT r.`id`, g.`permission`
FROM `dashboard_roles` r
JOIN (
    SELECT 'administrator' AS `role_key`, 'punishments.edit' AS `permission`
    UNION ALL SELECT 'administrator', 'punishments.edit.reason'
    UNION ALL SELECT 'administrator', 'punishments.edit.duration'
    UNION ALL SELECT 'administrator', 'punishments.edit.permanent'
    UNION ALL SELECT 'administrator', 'punishments.reactivate'
    UNION ALL SELECT 'administrator', 'punishments.evidence.view'
    UNION ALL SELECT 'administrator', 'punishments.evidence.add'
    UNION ALL SELECT 'administrator', 'punishments.evidence.edit'
    UNION ALL SELECT 'administrator', 'punishments.evidence.delete'
    UNION ALL SELECT 'administrator', 'punishments.history.view'
    UNION ALL SELECT 'moderator', 'punishments.edit'
    UNION ALL SELECT 'moderator', 'punishments.edit.reason'
    UNION ALL SELECT 'moderator', 'punishments.edit.duration'
    UNION ALL SELECT 'moderator', 'punishments.evidence.view'
    UNION ALL SELECT 'moderator', 'punishments.evidence.add'
    UNION ALL SELECT 'moderator', 'punishments.evidence.edit'
    UNION ALL SELECT 'moderator', 'punishments.history.view'
    UNION ALL SELECT 'supporter', 'punishments.evidence.view'
    UNION ALL SELECT 'supporter', 'punishments.evidence.add'
    UNION ALL SELECT 'supporter', 'punishments.history.view'
) g ON g.`role_key` = r.`key`
WHERE r.`is_system` = 1;
