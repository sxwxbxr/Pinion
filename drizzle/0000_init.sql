CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`external_user_id` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text,
	`token_expires_at` integer,
	`timezone` text DEFAULT 'Europe/Zurich' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_platform_user` ON `accounts` (`platform`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`parent_external_id` text NOT NULL,
	`author_handle` text NOT NULL,
	`text` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_platform_external` ON `inbox_items` (`platform`,`external_id`);--> statement-breakpoint
CREATE TABLE `posting_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`time` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text DEFAULT 'post' NOT NULL,
	`text` text NOT NULL,
	`title` text,
	`subreddit` text,
	`reply_to_external_id` text,
	`inbox_item_id` text,
	`status` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`next_attempt_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`external_id` text,
	`url` text,
	`last_error` text,
	`content_hash` text NOT NULL,
	`source` text DEFAULT 'mcp' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `posts_due` ON `posts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `posts_hash` ON `posts` (`content_hash`);