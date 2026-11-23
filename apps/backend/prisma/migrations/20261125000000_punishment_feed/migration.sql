-- AlterTable
ALTER TABLE `punishments` ADD COLUMN `target_ip` VARCHAR(45) NULL;

-- CreateTable
CREATE TABLE `punishment_changes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `punishment_id` VARCHAR(32) NOT NULL,
    `kind` ENUM('CREATED', 'REVOKED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `punishment_changes_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `punishments_target_ip_type_status_idx` ON `punishments`(`target_ip`, `type`, `status`);

-- AddForeignKey
ALTER TABLE `punishment_changes` ADD CONSTRAINT `punishment_changes_punishment_id_fkey` FOREIGN KEY (`punishment_id`) REFERENCES `punishments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

