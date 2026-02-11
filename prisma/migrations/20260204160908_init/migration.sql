-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PRO', 'ADMIN');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignMarketplaceMode" AS ENUM ('PROCEDURES', 'AMAZON_DIRECT_LINK');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('TEXT', 'PHOTO', 'VIDEO', 'CHECKLIST', 'RATING');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SESSION_APPLIED', 'SESSION_ACCEPTED', 'SESSION_REJECTED', 'PURCHASE_SUBMITTED', 'TEST_SUBMITTED', 'TEST_VALIDATED', 'SESSION_CANCELLED', 'DISPUTE_CREATED', 'MESSAGE_RECEIVED', 'PAYMENT_RECEIVED', 'CAMPAIGN_CREATED', 'CAMPAIGN_ENDING_SOON', 'SYSTEM_ALERT', 'UGC_REQUESTED', 'UGC_SUBMITTED', 'TIP_RECEIVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PRICE_VALIDATED', 'PURCHASE_SUBMITTED', 'PURCHASE_VALIDATED', 'IN_PROGRESS', 'PROCEDURES_COMPLETED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "DistributionType" AS ENUM ('RECURRING', 'SPECIFIC_DATE');

-- CreateEnum
CREATE TYPE "UGCType" AS ENUM ('VIDEO', 'PHOTO', 'TEXT_REVIEW', 'EXTERNAL_REVIEW');

-- CreateEnum
CREATE TYPE "UGCStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'VALIDATED', 'REJECTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CAMPAIGN_PAYMENT', 'CAMPAIGN_REFUND', 'TEST_REWARD', 'COMMISSION', 'UGC_PAYMENT', 'UGC_COMMISSION', 'TIP', 'TIP_COMMISSION', 'CANCELLATION_FEE', 'WITHDRAWAL', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WithdrawalMethod" AS ENUM ('BANK_TRANSFER', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTH', 'USER', 'ADMIN', 'PRODUCT', 'CAMPAIGN', 'SESSION', 'WALLET', 'MESSAGE', 'SYSTEM', 'OTHER');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "UserRole",
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "device_token" TEXT,
    "stripe_connect_account_id" TEXT,
    "stripe_onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "birth_date" TIMESTAMP(3),
    "gender" TEXT,
    "location" TEXT,
    "country" TEXT,
    "average_rating" DECIMAL(3,2) DEFAULT 0,
    "completed_sessions_count" INTEGER NOT NULL DEFAULT 0,
    "preferred_categories" TEXT[],
    "cancelled_sessions_count" INTEGER NOT NULL DEFAULT 0,
    "total_sessions_count" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMP(3),
    "banned_until" TIMESTAMP(3),
    "cancellation_count" INTEGER NOT NULL DEFAULT 0,
    "last_cancellation_at" TIMESTAMP(3),
    "is_prime" BOOLEAN NOT NULL DEFAULT false,
    "company_name" TEXT,
    "siret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_onboarded" BOOLEAN NOT NULL DEFAULT true,
    "auth_provider" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "category_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "asin" TEXT,
    "product_url" TEXT,
    "images" JSONB,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "category_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "total_slots" INTEGER NOT NULL,
    "available_slots" INTEGER NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "auto_accept_applications" BOOLEAN NOT NULL DEFAULT false,
    "marketplace_mode" "CampaignMarketplaceMode" NOT NULL DEFAULT 'PROCEDURES',
    "marketplace" TEXT,
    "amazon_link" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escrow_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "expected_price" DECIMAL(10,2) NOT NULL,
    "shipping_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "price_range_min" DECIMAL(10,2) NOT NULL,
    "price_range_max" DECIMAL(10,2) NOT NULL,
    "is_price_revealed" BOOLEAN NOT NULL DEFAULT false,
    "reimbursed_price" BOOLEAN NOT NULL DEFAULT true,
    "reimbursed_shipping" BOOLEAN NOT NULL DEFAULT true,
    "max_reimbursed_price" DECIMAL(10,2),
    "max_reimbursed_shipping" DECIMAL(10,2),
    "bonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_criteria" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "min_rating" DECIMAL(3,2),
    "max_rating" DECIMAL(3,2),
    "min_completed_sessions" INTEGER,
    "required_gender" TEXT,
    "required_countries" TEXT[],
    "required_locations" TEXT[],
    "excluded_locations" TEXT[],
    "required_categories" TEXT[],
    "no_active_session_with_seller" BOOLEAN NOT NULL DEFAULT false,
    "max_sessions_per_week" INTEGER,
    "max_sessions_per_month" INTEGER,
    "min_completion_rate" DECIMAL(5,2),
    "max_cancellation_rate" DECIMAL(5,2),
    "min_account_age" INTEGER,
    "last_active_within_days" INTEGER,
    "require_verified" BOOLEAN NOT NULL DEFAULT false,
    "require_prime" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedures" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "steps" (
    "id" TEXT NOT NULL,
    "procedure_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "StepType" NOT NULL DEFAULT 'TEXT',
    "order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "checklist_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_templates" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procedure_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_templates" (
    "id" TEXT NOT NULL,
    "procedure_template_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "StepType" NOT NULL DEFAULT 'TEXT',
    "order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "checklist_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "step_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criteria_templates" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_age" INTEGER,
    "max_age" INTEGER,
    "min_rating" DECIMAL(3,2),
    "max_rating" DECIMAL(3,2),
    "min_completed_sessions" INTEGER,
    "required_gender" TEXT,
    "required_countries" TEXT[],
    "required_locations" TEXT[],
    "excluded_locations" TEXT[],
    "required_categories" TEXT[],
    "no_active_session_with_seller" BOOLEAN NOT NULL DEFAULT false,
    "max_sessions_per_week" INTEGER,
    "max_sessions_per_month" INTEGER,
    "min_completion_rate" DECIMAL(5,2),
    "max_cancellation_rate" DECIMAL(5,2),
    "min_account_age" INTEGER,
    "last_active_within_days" INTEGER,
    "require_verified" BOOLEAN NOT NULL DEFAULT false,
    "require_prime" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "criteria_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "type" "DistributionType" NOT NULL,
    "day_of_week" INTEGER,
    "specific_date" TIMESTAMP(3),
    "max_units" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_sessions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "tester_id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "application_message" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "scheduled_purchase_date" TIMESTAMP(3),
    "validated_product_price" DECIMAL(10,2),
    "price_validated_at" TIMESTAMP(3),
    "price_validation_attempts" INTEGER NOT NULL DEFAULT 0,
    "product_title_submitted" TEXT,
    "product_title_submitted_at" TIMESTAMP(3),
    "order_number" TEXT,
    "purchase_proof_url" TEXT,
    "purchased_at" TIMESTAMP(3),
    "order_number_validated_at" TIMESTAMP(3),
    "purchase_validated_at" TIMESTAMP(3),
    "purchase_validation_comment" TEXT,
    "purchase_rejected_at" TIMESTAMP(3),
    "purchase_rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "submission_data" JSONB,
    "completed_at" TIMESTAMP(3),
    "product_price" DECIMAL(10,2),
    "shipping_cost" DECIMAL(10,2),
    "reward_amount" DECIMAL(10,2),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "disputed_at" TIMESTAMP(3),
    "dispute_reason" TEXT,
    "dispute_resolved_at" TIMESTAMP(3),
    "dispute_resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_step_progress" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "submission_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_step_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ugcs" (
    "id" TEXT NOT NULL,
    "type" "UGCType" NOT NULL,
    "content_url" TEXT,
    "description" TEXT NOT NULL,
    "comment" TEXT,
    "requested_bonus" DECIMAL(10,2),
    "paid_bonus" DECIMAL(10,2),
    "deadline" TIMESTAMP(3),
    "status" "UGCStatus" NOT NULL DEFAULT 'REQUESTED',
    "validated_at" TIMESTAMP(3),
    "validated_by" TEXT,
    "validation_comment" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "session_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ugcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tips" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "giver_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "commission" DECIMAL(10,2) NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "message_type" TEXT DEFAULT 'TEXT',
    "is_system_message" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "is_sent" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "error" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "session_notifications" BOOLEAN NOT NULL DEFAULT true,
    "message_notifications" BOOLEAN NOT NULL DEFAULT true,
    "payment_notifications" BOOLEAN NOT NULL DEFAULT true,
    "campaign_notifications" BOOLEAN NOT NULL DEFAULT true,
    "system_notifications" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tester_id" TEXT NOT NULL,
    "product_rating" INTEGER NOT NULL,
    "seller_rating" INTEGER NOT NULL,
    "comment" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "republish_proposed" BOOLEAN,
    "republish_accepted" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pending_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "total_earned" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_withdrawn" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "last_credited_at" TIMESTAMP(3),
    "last_withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "session_id" TEXT,
    "campaign_id" TEXT,
    "withdrawal_id" TEXT,
    "ugc_id" TEXT,
    "tip_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_transfer_id" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "WithdrawalMethod" NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "payment_details" JSONB,
    "processed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "processed_by" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rules" (
    "id" TEXT NOT NULL,
    "tester_bonus" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    "supertry_commission" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    "ugc_video_price" DECIMAL(10,2) NOT NULL DEFAULT 20.00,
    "ugc_video_commission" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    "ugc_photo_price" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "ugc_photo_commission" DECIMAL(10,2) NOT NULL DEFAULT 3.00,
    "enable_tips" BOOLEAN NOT NULL DEFAULT true,
    "tip_commission_percent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "cancellation_grace_period_minutes" INTEGER NOT NULL DEFAULT 60,
    "cancellation_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "first_cancellation_ban_days" INTEGER NOT NULL DEFAULT 7,
    "second_cancellation_ban_days" INTEGER NOT NULL DEFAULT 14,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fr" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "region" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_countries" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lucia_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lucia_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_email_key" ON "profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_stripe_connect_account_id_key" ON "profiles"("stripe_connect_account_id");

-- CreateIndex
CREATE INDEX "profiles_email_idx" ON "profiles"("email");

-- CreateIndex
CREATE INDEX "profiles_role_idx" ON "profiles"("role");

-- CreateIndex
CREATE INDEX "profiles_is_onboarded_idx" ON "profiles"("is_onboarded");

-- CreateIndex
CREATE INDEX "profiles_stripe_connect_account_id_idx" ON "profiles"("stripe_connect_account_id");

-- CreateIndex
CREATE INDEX "profiles_banned_until_idx" ON "profiles"("banned_until");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_slug_idx" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE INDEX "products_seller_id_idx" ON "products"("seller_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_is_active_idx" ON "products"("is_active");

-- CreateIndex
CREATE INDEX "campaigns_seller_id_idx" ON "campaigns"("seller_id");

-- CreateIndex
CREATE INDEX "campaigns_category_id_idx" ON "campaigns"("category_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_start_date_idx" ON "campaigns"("start_date");

-- CreateIndex
CREATE INDEX "campaigns_end_date_idx" ON "campaigns"("end_date");

-- CreateIndex
CREATE INDEX "campaigns_marketplace_mode_idx" ON "campaigns"("marketplace_mode");

-- CreateIndex
CREATE INDEX "offers_campaign_id_idx" ON "offers"("campaign_id");

-- CreateIndex
CREATE INDEX "offers_product_id_idx" ON "offers"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_campaign_id_product_id_key" ON "offers"("campaign_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_criteria_campaign_id_key" ON "campaign_criteria"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_criteria_campaign_id_idx" ON "campaign_criteria"("campaign_id");

-- CreateIndex
CREATE INDEX "procedures_campaign_id_idx" ON "procedures"("campaign_id");

-- CreateIndex
CREATE INDEX "procedures_order_idx" ON "procedures"("order");

-- CreateIndex
CREATE INDEX "steps_procedure_id_idx" ON "steps"("procedure_id");

-- CreateIndex
CREATE INDEX "steps_order_idx" ON "steps"("order");

-- CreateIndex
CREATE INDEX "procedure_templates_seller_id_idx" ON "procedure_templates"("seller_id");

-- CreateIndex
CREATE INDEX "step_templates_procedure_template_id_idx" ON "step_templates"("procedure_template_id");

-- CreateIndex
CREATE INDEX "step_templates_order_idx" ON "step_templates"("order");

-- CreateIndex
CREATE INDEX "criteria_templates_seller_id_idx" ON "criteria_templates"("seller_id");

-- CreateIndex
CREATE INDEX "distributions_campaign_id_idx" ON "distributions"("campaign_id");

-- CreateIndex
CREATE INDEX "distributions_type_idx" ON "distributions"("type");

-- CreateIndex
CREATE INDEX "distributions_day_of_week_idx" ON "distributions"("day_of_week");

-- CreateIndex
CREATE INDEX "distributions_specific_date_idx" ON "distributions"("specific_date");

-- CreateIndex
CREATE INDEX "test_sessions_campaign_id_idx" ON "test_sessions"("campaign_id");

-- CreateIndex
CREATE INDEX "test_sessions_tester_id_idx" ON "test_sessions"("tester_id");

-- CreateIndex
CREATE INDEX "test_sessions_status_idx" ON "test_sessions"("status");

-- CreateIndex
CREATE INDEX "test_sessions_applied_at_idx" ON "test_sessions"("applied_at");

-- CreateIndex
CREATE INDEX "session_step_progress_session_id_idx" ON "session_step_progress"("session_id");

-- CreateIndex
CREATE INDEX "session_step_progress_step_id_idx" ON "session_step_progress"("step_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_step_progress_session_id_step_id_key" ON "session_step_progress"("session_id", "step_id");

-- CreateIndex
CREATE INDEX "ugcs_session_id_idx" ON "ugcs"("session_id");

-- CreateIndex
CREATE INDEX "ugcs_status_idx" ON "ugcs"("status");

-- CreateIndex
CREATE INDEX "ugcs_requested_by_idx" ON "ugcs"("requested_by");

-- CreateIndex
CREATE INDEX "ugcs_submitted_by_idx" ON "ugcs"("submitted_by");

-- CreateIndex
CREATE INDEX "tips_session_id_idx" ON "tips"("session_id");

-- CreateIndex
CREATE INDEX "tips_giver_id_idx" ON "tips"("giver_id");

-- CreateIndex
CREATE INDEX "tips_receiver_id_idx" ON "tips"("receiver_id");

-- CreateIndex
CREATE INDEX "messages_session_id_idx" ON "messages"("session_id");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "messages_is_read_idx" ON "messages"("is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_channel_idx" ON "notifications"("channel");

-- CreateIndex
CREATE INDEX "notifications_is_sent_idx" ON "notifications"("is_sent");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_session_id_key" ON "reviews"("session_id");

-- CreateIndex
CREATE INDEX "reviews_session_id_idx" ON "reviews"("session_id");

-- CreateIndex
CREATE INDEX "reviews_campaign_id_idx" ON "reviews"("campaign_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_idx" ON "reviews"("product_id");

-- CreateIndex
CREATE INDEX "reviews_tester_id_idx" ON "reviews"("tester_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripe_payment_intent_id_key" ON "transactions"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripe_transfer_id_key" ON "transactions"("stripe_transfer_id");

-- CreateIndex
CREATE INDEX "transactions_wallet_id_idx" ON "transactions"("wallet_id");

-- CreateIndex
CREATE INDEX "transactions_session_id_idx" ON "transactions"("session_id");

-- CreateIndex
CREATE INDEX "transactions_campaign_id_idx" ON "transactions"("campaign_id");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals"("user_id");

-- CreateIndex
CREATE INDEX "withdrawals_status_idx" ON "withdrawals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "countries_code_key" ON "countries"("code");

-- CreateIndex
CREATE INDEX "countries_is_active_idx" ON "countries"("is_active");

-- CreateIndex
CREATE INDEX "countries_code_idx" ON "countries"("code");

-- CreateIndex
CREATE INDEX "profile_countries_profile_id_idx" ON "profile_countries"("profile_id");

-- CreateIndex
CREATE INDEX "profile_countries_country_code_idx" ON "profile_countries"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "profile_countries_profile_id_country_code_key" ON "profile_countries"("profile_id", "country_code");

-- CreateIndex
CREATE INDEX "lucia_sessions_user_id_idx" ON "lucia_sessions"("user_id");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_id_key" ON "oauth_accounts"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_category_idx" ON "audit_logs"("category");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_criteria" ADD CONSTRAINT "campaign_criteria_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "steps" ADD CONSTRAINT "steps_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_templates" ADD CONSTRAINT "procedure_templates_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_templates" ADD CONSTRAINT "step_templates_procedure_template_id_fkey" FOREIGN KEY ("procedure_template_id") REFERENCES "procedure_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criteria_templates" ADD CONSTRAINT "criteria_templates_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributions" ADD CONSTRAINT "distributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_step_progress" ADD CONSTRAINT "session_step_progress_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_step_progress" ADD CONSTRAINT "session_step_progress_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugcs" ADD CONSTRAINT "ugcs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugcs" ADD CONSTRAINT "ugcs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugcs" ADD CONSTRAINT "ugcs_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tips" ADD CONSTRAINT "tips_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tips" ADD CONSTRAINT "tips_giver_id_fkey" FOREIGN KEY ("giver_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tips" ADD CONSTRAINT "tips_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tester_id_fkey" FOREIGN KEY ("tester_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "test_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_ugc_id_fkey" FOREIGN KEY ("ugc_id") REFERENCES "ugcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tip_id_fkey" FOREIGN KEY ("tip_id") REFERENCES "tips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_countries" ADD CONSTRAINT "profile_countries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_countries" ADD CONSTRAINT "profile_countries_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lucia_sessions" ADD CONSTRAINT "lucia_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
