ALTER TABLE `conversation_model_call_tool` RENAME TO `__old_conversation_model_call_tool`;--> statement-breakpoint
CREATE TABLE `tool_definition` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`definition_key` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_definition_key_idx` ON `tool_definition` (`definition_key`);--> statement-breakpoint
CREATE INDEX `tool_definition_name_idx` ON `tool_definition` (`name`);--> statement-breakpoint
CREATE TABLE `conversation_model_call_tool_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_call_id` integer NOT NULL,
	`tool_definition_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`model_call_id`) REFERENCES `conversation_model_call`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_definition_id`) REFERENCES `tool_definition`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `conversation_model_call_tool_usage_call_idx` ON `conversation_model_call_tool_usage` (`model_call_id`);--> statement-breakpoint
CREATE INDEX `conversation_model_call_tool_usage_definition_idx` ON `conversation_model_call_tool_usage` (`tool_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_model_call_tool_usage_unique_idx` ON `conversation_model_call_tool_usage` (`model_call_id`,`tool_definition_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `tool_definition` (`name`, `definition_key`, `definition_json`, `created_at`)
SELECT
	`name`,
	`definition_json`,
	`definition_json`,
	MIN(`created_at`)
FROM `__old_conversation_model_call_tool`
GROUP BY `name`, `definition_json`;--> statement-breakpoint
INSERT OR IGNORE INTO `conversation_model_call_tool_usage` (`model_call_id`, `tool_definition_id`, `created_at`)
SELECT
	old_tool.`model_call_id`,
	definition.`id`,
	old_tool.`created_at`
FROM `__old_conversation_model_call_tool` old_tool
INNER JOIN `tool_definition` definition
	ON definition.`definition_key` = old_tool.`definition_json`;--> statement-breakpoint
DROP TABLE `__old_conversation_model_call_tool`;
