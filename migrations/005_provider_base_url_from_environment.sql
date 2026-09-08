-- The deployment environment owns the provider base URL. Removing this
-- legacy override lets AI_BASE_URL in the Liara panel take effect safely.
update app_settings
set value = value - 'baseUrl',
    updated_at = now()
where key = 'provider_config'
  and value ? 'baseUrl';
