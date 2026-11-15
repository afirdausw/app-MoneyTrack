ALTER TABLE `invoices` ADD CONSTRAINT `uq_invoice_number` UNIQUE(`workspace_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `idx_transactions_project` ON `transactions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_invoice` ON `transactions` (`invoice_id`);