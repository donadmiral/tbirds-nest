-- Permit an explicitly configured production budget while retaining the
-- existing disabled gate and small defaults. No reservation or VM is created.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
alter table media_renditions.sandbox_settings
  drop constraint sandbox_settings_daily_wall_seconds_check,
  drop constraint sandbox_settings_monthly_wall_seconds_check,
  drop constraint sandbox_settings_daily_cpu_seconds_check,
  drop constraint sandbox_settings_monthly_cpu_seconds_check,
  add constraint sandbox_settings_daily_wall_seconds_check
    check(daily_wall_seconds between 780 and 78000),
  add constraint sandbox_settings_monthly_wall_seconds_check
    check(monthly_wall_seconds between 780 and 1560000),
  add constraint sandbox_settings_daily_cpu_seconds_check
    check(daily_cpu_seconds between 1560 and 156000),
  add constraint sandbox_settings_monthly_cpu_seconds_check
    check(monthly_cpu_seconds between 1560 and 3120000);
-- The existing reservation function still serializes one active VM, charges
-- 780 wall/1560 CPU seconds before launch, never refunds, and checks both caps.
comment on table media_renditions.sandbox_settings is
  'Explicit bounded encode budget. Defaults remain 2 daily/8 monthly reservations; operator may choose up to 100 daily/2000 monthly. One active VM and full precharge remain enforced.';
commit;
