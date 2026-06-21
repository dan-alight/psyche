ALTER TABLE `conversation` DROP COLUMN `previous_response_id`;--> statement-breakpoint
ALTER TABLE `conversation_item` DROP COLUMN `provider_response_id`;
