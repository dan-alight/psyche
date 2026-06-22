INSERT INTO `provider` (`key`, `name`, `base_url`)
VALUES ('openai', 'OpenAI', 'https://api.openai.com/v1')
ON CONFLICT(`key`) DO UPDATE SET
  `name` = excluded.`name`,
  `base_url` = excluded.`base_url`;
--> statement-breakpoint
UPDATE `oauth_config`
SET
  `authorize_url` = 'https://auth.openai.com/oauth/authorize',
  `token_url` = 'https://auth.openai.com/oauth/token',
  `client_id` = 'app_EMoamEEZ73f0CkXaXp7hrann',
  `scopes` = '["openid","profile","email","offline_access","api.connectors.read","api.connectors.invoke"]',
  `extra_authorize_params` = '{"codex_cli_simplified_flow":"true","id_token_add_organizations":"true","originator":"psyche"}',
  `redirect_uri` = 'http://localhost:1455/auth/callback'
WHERE `provider_id` = (SELECT `id` FROM `provider` WHERE `key` = 'openai');
--> statement-breakpoint
INSERT INTO `oauth_config` (
  `provider_id`,
  `authorize_url`,
  `token_url`,
  `client_id`,
  `scopes`,
  `extra_authorize_params`,
  `redirect_uri`
)
SELECT
  `id`,
  'https://auth.openai.com/oauth/authorize',
  'https://auth.openai.com/oauth/token',
  'app_EMoamEEZ73f0CkXaXp7hrann',
  '["openid","profile","email","offline_access","api.connectors.read","api.connectors.invoke"]',
  '{"codex_cli_simplified_flow":"true","id_token_add_organizations":"true","originator":"psyche"}',
  'http://localhost:1455/auth/callback'
FROM `provider`
WHERE `key` = 'openai'
  AND NOT EXISTS (
    SELECT 1
    FROM `oauth_config`
    WHERE `provider_id` = (SELECT `id` FROM `provider` WHERE `key` = 'openai')
  );
--> statement-breakpoint
INSERT INTO `model` (`provider_id`, `model_id`, `name`)
SELECT `id`, 'gpt-5.4-nano', 'gpt-5.4-nano'
FROM `provider`
WHERE `key` = 'openai'
ON CONFLICT(`provider_id`, `model_id`) DO UPDATE SET
  `name` = excluded.`name`;
--> statement-breakpoint
INSERT INTO `model` (`provider_id`, `model_id`, `name`)
SELECT `id`, 'gpt-5.4-mini', 'gpt-5.4-mini'
FROM `provider`
WHERE `key` = 'openai'
ON CONFLICT(`provider_id`, `model_id`) DO UPDATE SET
  `name` = excluded.`name`;
--> statement-breakpoint
INSERT INTO `model` (`provider_id`, `model_id`, `name`)
SELECT `id`, 'gpt-5.5', 'gpt-5.5'
FROM `provider`
WHERE `key` = 'openai'
ON CONFLICT(`provider_id`, `model_id`) DO UPDATE SET
  `name` = excluded.`name`;
