-- Update notifications (additive; no existing data is changed).

-- Per-user dismissal of the dashboard update notification (by version).
ALTER TABLE `dashboard_users` ADD COLUMN `dismissed_update_version` VARCHAR(64) NULL;

-- Update permissions. The startup synchronisation registers the catalogue as
-- well; here the Administrator role receives its defaults once (the Owner has
-- every permission). Custom roles are not changed.
INSERT IGNORE INTO `dashboard_permissions` (`key`) VALUES
    ('updates.view'), ('updates.notify'), ('updates.check'), ('updates.manage');

INSERT IGNORE INTO `dashboard_role_permissions` (`role_id`, `permission`)
SELECT r.`id`, g.`permission`
FROM `dashboard_roles` r
JOIN (
    SELECT 'administrator' AS `role_key`, 'updates.view' AS `permission`
    UNION ALL SELECT 'administrator', 'updates.notify'
    UNION ALL SELECT 'administrator', 'updates.check'
) g ON g.`role_key` = r.`key`
WHERE r.`is_system` = TRUE;
