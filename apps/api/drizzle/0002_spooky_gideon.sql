CREATE TABLE `conversation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_key` text NOT NULL,
	`previous_response_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversation_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`model_call_id` integer,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`role` text,
	`content` text,
	`tool_call_id` text,
	`tool_name` text,
	`tool_arguments` text,
	`tool_output` text,
	`provider_response_id` text,
	`provider_item_id` text,
	`raw_provider_item` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_call_id`) REFERENCES `conversation_model_call`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_item_conversation_idx` ON `conversation_item` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_item_conversation_sequence_idx` ON `conversation_item` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `conversation_model_call` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`provider_key` text NOT NULL,
	`model` text NOT NULL,
	`previous_response_id` text,
	`response_id` text,
	`status` text NOT NULL,
	`usage` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_model_call_conversation_idx` ON `conversation_model_call` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversation_model_call_tool` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_call_id` integer NOT NULL,
	`name` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`model_call_id`) REFERENCES `conversation_model_call`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_model_call_tool_call_idx` ON `conversation_model_call_tool` (`model_call_id`);