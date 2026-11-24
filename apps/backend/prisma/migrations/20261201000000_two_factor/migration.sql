-- AlterTable
ALTER TABLE `dashboard_users` ADD COLUMN `two_factor_last_step` INTEGER NULL,
    ADD COLUMN `two_factor_recovery_codes` JSON NULL;
