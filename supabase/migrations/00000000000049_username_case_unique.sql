-- 0049: usernames unique regardless of case. profiles_username_key already
-- guarantees exact uniqueness; this closes the Don/don impersonation hole.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));