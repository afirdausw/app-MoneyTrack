CREATE TABLE `sessions` (
	`id` varchar(128) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(191) NOT NULL,
	`password_hash` varchar(255),
	`google_id` varchar(191),
	`avatar_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`),
	CONSTRAINT `uq_users_google_id` UNIQUE(`google_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`actor_user_id` bigint unsigned NOT NULL,
	`entity_type` varchar(60) NOT NULL,
	`entity_id` bigint unsigned NOT NULL,
	`action` enum('create','update','delete','settle') NOT NULL,
	`metadata_json` text,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_invites` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`invited_by_user_id` bigint unsigned NOT NULL,
	`email` varchar(191),
	`role` enum('admin','member','viewer') NOT NULL DEFAULT 'member',
	`token` varchar(128) NOT NULL,
	`expires_at` datetime NOT NULL,
	`accepted_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_workspace_invites_token` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`role` enum('owner','admin','member','viewer') NOT NULL DEFAULT 'member',
	`joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_workspace_member` UNIQUE(`workspace_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`type` enum('personal','shared','business') NOT NULL DEFAULT 'personal',
	`primary_currency` varchar(10) NOT NULL DEFAULT 'IDR',
	`created_by_user_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`category_id` bigint unsigned NOT NULL,
	`month_key` varchar(7) NOT NULL,
	`limit_minor` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `budgets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_budget_category_month` UNIQUE(`workspace_id`,`category_id`,`month_key`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`name` varchar(80) NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`color` varchar(20) NOT NULL DEFAULT '#0ea5e9',
	`icon` varchar(40) NOT NULL DEFAULT 'tag',
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`target_minor` bigint NOT NULL,
	`current_minor` bigint NOT NULL DEFAULT 0,
	`deadline_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `goals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`transaction_id` bigint unsigned NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`uploaded_by_user_id` bigint unsigned NOT NULL,
	`storage_path` varchar(255) NOT NULL,
	`mime_type` varchar(80) NOT NULL,
	`size_bytes` int unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_bills` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`wallet_id` bigint unsigned,
	`category_id` bigint unsigned,
	`title` varchar(140) NOT NULL,
	`type` enum('income','expense') NOT NULL DEFAULT 'expense',
	`amount_minor` bigint NOT NULL,
	`currency_code` varchar(10) NOT NULL DEFAULT 'IDR',
	`frequency` enum('weekly','monthly','yearly') NOT NULL DEFAULT 'monthly',
	`next_due_date` datetime NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recurring_bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `split_expenses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`transaction_id` bigint unsigned,
	`paid_by_user_id` bigint unsigned NOT NULL,
	`title` varchar(160) NOT NULL,
	`total_minor` bigint NOT NULL,
	`currency_code` varchar(10) NOT NULL DEFAULT 'IDR',
	`occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `split_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `split_participants` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`split_expense_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`owed_minor` bigint NOT NULL,
	`settled_minor` bigint NOT NULL DEFAULT 0,
	`is_settled` boolean NOT NULL DEFAULT false,
	`settled_at` datetime,
	CONSTRAINT `split_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_split_participant` UNIQUE(`split_expense_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`wallet_id` bigint unsigned NOT NULL,
	`transfer_target_wallet_id` bigint unsigned,
	`category_id` bigint unsigned,
	`created_by_user_id` bigint unsigned NOT NULL,
	`type` enum('income','expense','transfer') NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency_code` varchar(10) NOT NULL DEFAULT 'IDR',
	`exchange_rate_to_workspace` decimal(18,6) NOT NULL DEFAULT '1.000000',
	`converted_amount_minor` bigint NOT NULL,
	`title` varchar(160) NOT NULL,
	`notes` text,
	`occurred_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`project_id` bigint unsigned,
	`invoice_id` bigint unsigned,
	`recurring_bill_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`owner_user_id` bigint unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`wallet_kind` enum('cash','bank','ewallet','investment','other') NOT NULL DEFAULT 'bank',
	`currency_code` varchar(10) NOT NULL DEFAULT 'IDR',
	`balance_minor` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wallets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_wallets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`wallet_id` bigint unsigned NOT NULL,
	`visibility_mode` enum('workspace_only','full_transparent') NOT NULL DEFAULT 'workspace_only',
	`linked_by_user_id` bigint unsigned NOT NULL,
	`linked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_workspace_wallet` UNIQUE(`workspace_id`,`wallet_id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`name` varchar(140) NOT NULL,
	`email` varchar(191),
	`phone` varchar(40),
	`company` varchar(140),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`client_id` bigint unsigned,
	`project_id` bigint unsigned,
	`invoice_number` varchar(60) NOT NULL,
	`title` varchar(160) NOT NULL,
	`amount_minor` bigint NOT NULL,
	`paid_minor` bigint NOT NULL DEFAULT 0,
	`currency_code` varchar(10) NOT NULL DEFAULT 'IDR',
	`status` enum('draft','sent','partial','paid','overdue') NOT NULL DEFAULT 'draft',
	`due_date` datetime,
	`issued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`workspace_id` bigint unsigned NOT NULL,
	`client_id` bigint unsigned,
	`name` varchar(160) NOT NULL,
	`status` enum('active','completed','paused') NOT NULL DEFAULT 'active',
	`budget_minor` bigint NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invites` ADD CONSTRAINT `workspace_invites_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invites` ADD CONSTRAINT `workspace_invites_invited_by_user_id_users_id_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `categories` ADD CONSTRAINT `categories_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goals` ADD CONSTRAINT `goals_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_uploaded_by_user_id_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bills` ADD CONSTRAINT `recurring_bills_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bills` ADD CONSTRAINT `recurring_bills_wallet_id_wallets_id_fk` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bills` ADD CONSTRAINT `recurring_bills_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `split_expenses` ADD CONSTRAINT `split_expenses_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `split_expenses` ADD CONSTRAINT `split_expenses_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `split_expenses` ADD CONSTRAINT `split_expenses_paid_by_user_id_users_id_fk` FOREIGN KEY (`paid_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `split_participants` ADD CONSTRAINT `split_participants_split_expense_id_split_expenses_id_fk` FOREIGN KEY (`split_expense_id`) REFERENCES `split_expenses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `split_participants` ADD CONSTRAINT `split_participants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_wallet_id_wallets_id_fk` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_transfer_target_wallet_id_wallets_id_fk` FOREIGN KEY (`transfer_target_wallet_id`) REFERENCES `wallets`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_recurring_bill_id_recurring_bills_id_fk` FOREIGN KEY (`recurring_bill_id`) REFERENCES `recurring_bills`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_owner_user_id_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_wallets` ADD CONSTRAINT `workspace_wallets_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_wallets` ADD CONSTRAINT `workspace_wallets_wallet_id_wallets_id_fk` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_wallets` ADD CONSTRAINT `workspace_wallets_linked_by_user_id_users_id_fk` FOREIGN KEY (`linked_by_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE set null ON UPDATE no action;