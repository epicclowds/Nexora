# LuckPerms integration, account linking and staff accounts

Nexora works without LuckPerms. When LuckPerms is installed on the Velocity proxy, Nexora can use it as the source of staff permissions: the same punishment permissions apply in-game and in the dashboard, staff can link their Minecraft account to a dashboard account, and dashboard access follows LuckPerms groups.

## Recommended LuckPerms setup

```
            LuckPerms (Velocity)  ── shared storage (MySQL/MariaDB) ──  LuckPerms (Paper, optional)
                   │
     Nexora Velocity plugin ── signed plugin API ──▶ Nexora backend ──▶ dashboard
```

- Install LuckPerms on the **Velocity proxy**. Moderation commands run on the proxy, so its LuckPerms instance is authoritative for punishment permissions.
- If you also run LuckPerms on the Paper servers, let all instances share one storage (MySQL/MariaDB) so groups are identical everywhere. Paper's LuckPerms is not needed for Nexora.
- **Context:** Nexora evaluates permissions in the proxy's *static* context (LuckPerms `getStaticQueryOptions()` – global permissions plus anything bound to the proxy's own `server` context). Grant moderation permissions globally (no `server=survival` context): a permission that only exists on one backend server never applies to global punishments.
- The Nexora plugin declares LuckPerms as an optional dependency and is never bundled with it. Nothing changes when LuckPerms is missing.

The CI smoke test starts Velocity with the current LuckPerms release and the Nexora plugin and waits for the first synchronisation with the backend.

## What the proxy synchronises

For every linked staff member and every online player, the proxy sends a snapshot:

| Field | Source |
| --- | --- |
| Primary group, group display name, weight | `User#getPrimaryGroup`, group display name/weight |
| Groups | all inherited groups (including temporary ones) |
| Prefix / suffix | LuckPerms meta (shown on player profiles as text with one validated colour – never as markup) |
| Permissions | the canonical Nexora permissions (every reason permission, `nexora.punishment.custom`, `.duration-override`, `.permanent`, `nexora.dashboard.register`) evaluated by LuckPerms: inheritance, wildcards and **negated nodes** (explicit denials) are respected; undefined permissions are omitted |
| Expiry | the earliest expiry of a temporary node – the snapshot is no longer trusted after it |

Synchronisation is **event-driven** (`UserDataRecalculateEvent`, `GroupDataRecalculateEvent`) with a **full reconciliation every five minutes** to recover from missed events, plus immediate resyncs requested by the backend (e.g. *Recheck* in User Management). Every snapshot increments a revision. All LuckPerms calls are asynchronous.

## Integration modes (Settings → Integrations → LuckPerms)

| Mode | Dashboard role | Punishment permissions of linked staff | Automatic access management |
| --- | --- | --- | --- |
| **Disabled** (default) | Nexora role | Nexora role | – |
| **Hybrid** | Nexora role (as assigned) | **LuckPerms** | – |
| **LuckPerms-managed staff** | from the **group mapping** (accounts created by linking) | **LuckPerms** | yes |

Precedence is strict – one source decides, never a union:

- For a linked account (mode not *Disabled*), the canonical `nexora.punishment.*` checks use **only** the LuckPerms snapshot. Permissions of the dashboard role do not add to it, and LuckPerms does not add dashboard permissions (such as `users.manage`).
- Unlinked accounts and the Owner always use their Nexora role.
- If the snapshot is missing, older than *Trust permissions for* (default 30 minutes) or past a temporary node's expiry, sensitive actions (issuing punishments with reasons) are **denied** until fresh data arrives. Typed reasons in *free text* mode only need the dashboard role, as before.

## Group → role mapping

Each mapping assigns a dashboard role to a LuckPerms group, with a priority. For a LuckPerms-managed account:

1. If the player is in a group mapped with **Deny access**, there is no dashboard access (explicit denial wins).
2. Otherwise the eligible mapping with the highest priority (then the higher role) decides the role. Inherited and temporary groups count.
3. No eligible group → the account is disabled.

The **Owner role can never be mapped**, so no LuckPerms group can create or grant the protected Owner.

## Account linking

1. The player runs `/nexora link` on the network. The proxy vouches for the authenticated game session (a username alone is never proof).
2. The backend checks eligibility (an eligible group mapping, the in-game permission `nexora.dashboard.register`, or an existing link) and returns a code such as `ABCD-1234`.
3. The code is shown only to that player (click to copy). It is random (31-symbol alphabet, 8 characters), valid for **5 minutes**, **single use**, stored only as a SHA-256 hash; requesting a new code invalidates the previous one; at most 3 codes per 10 minutes per player; invalid attempts are limited per client address.
4. The player enters the code in **Settings → General → Minecraft account** (existing dashboard account), or on **/register** to create a staff account (only when *Staff registration* is enabled; the role comes from the group mapping, and the account is LuckPerms-managed).

Once linked, **Settings → General → Minecraft account** shows the player head, Minecraft name, UUID, rank, link date and status, and the player head becomes the account's avatar in the sidebar, User Management and staff details. Avatars are resolved by the linked **UUID** (never the name) through Nexora's server-side skin cache – browsers never contact Mojang or a third-party skin service, and custom skins work. Rendered heads are cached in the browser for an hour (failed lookups for five minutes); when no valid skin is available the default Nexora avatar (the account's initial) is shown instead of a broken image. Accounts without a link keep the default avatar.

A Minecraft account can be linked to one dashboard account. Administrators can unlink accounts in User Management (a LuckPerms-managed account is disabled when unlinked).

## Automatic deactivation and reactivation

When a snapshot for a LuckPerms-managed account arrives:

- **No eligible group left** → the account is disabled, **all sessions are revoked** (the next request is rejected) and the change is recorded in the account history and the audit log (`users.disabled_by_luckperms`).
- **Another eligible group remains** → only the role changes (`users.role_changed_by_luckperms`); permissions apply on the next request.
- **A reason permission was removed** → the account stays active; the next dashboard request and the next in-game command are rejected for that reason.
- **Eligible again** → an account that LuckPerms disabled is re-enabled (`users.reactivated_by_luckperms`). Old sessions stay revoked – the user signs in again. Accounts disabled manually by an administrator are never re-enabled by LuckPerms.
- Missing or outdated data never disables an account (a proxy or LuckPerms outage must not lock staff out); it only blocks sensitive actions.

## Protected Owner

The Owner account created by the setup wizard never depends on LuckPerms: no mapping can grant or remove it, its permissions always come from the Owner role, LuckPerms outages do not affect it, and only the Owner (`integrations.manage`) can change the integration settings – so it can always repair a broken configuration. Enable two-factor authentication for it.

## Staff management

User Management shows each account's linked Minecraft account, rank, effective role, status (*Active*, *Disabled*, *Pending link*, *Synchronisation warning*), permission source and last synchronisation. **Staff details** show the per-reason permission matrix (allowed / not allowed for every ban, mute, kick and warning reason, plus typed reasons, duration and permanent overrides) and the account history, with *Recheck LuckPerms*, *Revoke sessions* and *Unlink*. When LuckPerms manages a permission, the dashboard explains that it must be changed in LuckPerms instead of offering a local edit.

## Permissions

| Permission | Where | Purpose |
| --- | --- | --- |
| `integrations.manage` | dashboard | LuckPerms settings and role mappings (Owner by default) |
| `nexora.dashboard.register` | in-game | May create/link a dashboard account without a mapped group |
| `nexora.punishment.<category>.<id>`, `.custom`, `.duration-override`, `.permanent` | both | Punishment reasons ([Punishments](punishments.md#reason-presets-and-the-command-mode)) |
