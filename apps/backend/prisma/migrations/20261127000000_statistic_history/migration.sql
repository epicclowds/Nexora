-- CreateIndex
CREATE UNIQUE INDEX `player_statistic_snapshots_player_uuid_scope_stat_key_captur_key` ON `player_statistic_snapshots`(`player_uuid`, `scope`, `stat_key`, `captured_at`);

