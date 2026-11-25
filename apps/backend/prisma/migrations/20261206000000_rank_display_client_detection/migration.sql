-- Rank display customisation and client detection metadata.
-- Additive only: existing players, connections and their client brands are kept.

ALTER TABLE `player_connections`
    ADD COLUMN `client_name` VARCHAR(32) NULL,
    ADD COLUMN `client_source` VARCHAR(16) NULL,
    ADD COLUMN `client_detected_at` DATETIME(3) NULL;

CREATE TABLE `rank_displays` (
    `id` VARCHAR(32) NOT NULL,
    `group_name` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `display_source` VARCHAR(32) NOT NULL DEFAULT 'CUSTOM',
    `display_name` VARCHAR(64) NULL,
    `text_color` CHAR(7) NULL,
    `background_color` CHAR(7) NULL,
    `bold` BOOLEAN NOT NULL DEFAULT false,
    `icon_text` VARCHAR(16) NULL,
    `icon_image` MEDIUMBLOB NULL,
    `icon_mime_type` VARCHAR(32) NULL,
    `fallback_text` VARCHAR(64) NULL,
    `tooltip` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rank_displays_group_name_key`(`group_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
