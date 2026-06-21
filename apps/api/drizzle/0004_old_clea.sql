CREATE TABLE `conversation_transcript_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`model_call_id` integer,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text,
	`tool_call_id` text,
	`tool_name` text,
	`tool_arguments` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`model_call_id`) REFERENCES `conversation_model_call`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_transcript_item_conversation_idx` ON `conversation_transcript_item` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `conversation_transcript_item_model_call_idx` ON `conversation_transcript_item` (`model_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_transcript_item_conversation_sequence_idx` ON `conversation_transcript_item` (`conversation_id`,`sequence`);
