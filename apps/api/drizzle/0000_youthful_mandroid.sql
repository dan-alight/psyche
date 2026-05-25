CREATE TABLE `credential` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `model` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`model_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_provider_model_id_idx` ON `model` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `oauth_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`authorize_url` text NOT NULL,
	`token_url` text NOT NULL,
	`client_id` text NOT NULL,
	`scopes` text NOT NULL,
	`extra_authorize_params` text NOT NULL,
	`redirect_uri` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `provider`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provider` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_key_unique` ON `provider` (`key`);