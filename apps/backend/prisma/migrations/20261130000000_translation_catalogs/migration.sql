-- CreateTable
CREATE TABLE `translation_catalogs` (
    `locale` VARCHAR(16) NOT NULL,
    `messages` JSON NOT NULL,
    `updated_by_user_id` VARCHAR(32) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`locale`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
