-- AlterTable
ALTER TABLE `player_sessions` ADD COLUMN `session_key` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `player_sessions_session_key_key` ON `player_sessions`(`session_key`);

-- CreateIndex
CREATE INDEX `player_sessions_proxy_server_id_ended_at_idx` ON `player_sessions`(`proxy_server_id`, `ended_at`);

