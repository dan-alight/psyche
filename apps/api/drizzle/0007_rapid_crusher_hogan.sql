ALTER TABLE `conversation_model_call` ADD `transport` text DEFAULT 'chat_completions' NOT NULL;--> statement-breakpoint
UPDATE `conversation_model_call` SET `transport` = 'responses' WHERE `provider_key` = 'openai';
