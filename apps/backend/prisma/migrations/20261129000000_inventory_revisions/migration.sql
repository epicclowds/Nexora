-- AlterTable
ALTER TABLE `inventory_revisions` ADD COLUMN `result_message` VARCHAR(500) NULL,
    ADD COLUMN `rollback_of_id` VARCHAR(32) NULL,
    MODIFY `status` ENUM('SNAPSHOT', 'PENDING', 'APPLIED', 'CONFLICT', 'REJECTED', 'ROLLED_BACK', 'CANCELLED') NOT NULL;

