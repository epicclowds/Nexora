-- AlterTable
ALTER TABLE `anticheat_events` ADD COLUMN `event_key` VARCHAR(80) NULL,
    ADD COLUMN `explicit` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `outcome` VARCHAR(32) NOT NULL DEFAULT 'LOGGED',
    ADD COLUMN `reason` VARCHAR(500) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `anticheat_events_event_key_key` ON `anticheat_events`(`event_key`);

-- CreateIndex
CREATE INDEX `anticheat_events_player_uuid_cheat_type_outcome_created_at_idx` ON `anticheat_events`(`player_uuid`, `cheat_type`, `outcome`, `created_at`);

