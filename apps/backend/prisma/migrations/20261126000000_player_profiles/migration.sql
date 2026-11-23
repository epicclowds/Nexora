-- AlterTable
ALTER TABLE `players` ADD COLUMN `skin_model` VARCHAR(8) NULL,
    ADD COLUMN `skin_texture_url` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `player_connections` ADD COLUMN `asn` INTEGER NULL;

