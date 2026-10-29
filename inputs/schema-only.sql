--
-- PostgreSQL database dump
--

\restrict XBvW8sD2NPKiqvdUSwaPu4Fm5tIlrIUbR1u6m8m06rpzvtqlZmRnp7FOcfz5d6I

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg12+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg12+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: CardApplicationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CardApplicationStatus" AS ENUM (
    'SUBMITTED'
);


--
-- Name: CardProduct; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CardProduct" AS ENUM (
    'TITANIUM',
    'BLACK_SIGNATURE'
);


--
-- Name: KycStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."KycStatus" AS ENUM (
    'NOT_STARTED',
    'PENDING',
    'APPROVED',
    'REJECTED'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'USER',
    'ADMIN'
);


--
-- Name: SupportNotificationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportNotificationStatus" AS ENUM (
    'PENDING',
    'SENT',
    'FAILED'
);


--
-- Name: SupportSender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportSender" AS ENUM (
    'USER',
    'ADMIN'
);


--
-- Name: SupportSubject; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SupportSubject" AS ENUM (
    'TECHNICAL',
    'KYC',
    'CARD',
    'OTHER'
);


--
-- Name: admin_account_deletion_allowed(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_account_deletion_allowed(target text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(target = current_setting('voltex.delete_user', true), false)
    AND EXISTS (
      SELECT 1 FROM "AuditLog" a
      JOIN "User" admin ON admin.id = a.metadata->>'performedByAdminId' AND admin.role = 'ADMIN'
      JOIN "User" victim ON victim.id = target AND victim.role = 'USER'
      WHERE a.id = current_setting('voltex.delete_audit', true)
        AND a.action = 'USER_DELETED' AND a.metadata->>'deletedUserId' = target
        AND admin.id <> victim.id AND lower(trim(victim.email)) <> 'voltex.crypto@gmail.com'
    );
$$;


--
-- Name: native_demo_revision_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.native_demo_revision_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND admin_account_deletion_allowed(OLD."userId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Native demo revisions are immutable';
END;
$$;


--
-- Name: prevent_banking_ledger_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_banking_ledger_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND admin_account_deletion_allowed(OLD.user_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'banking ledger entries are immutable';
END;
$$;


--
-- Name: retained_account_transfer_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retained_account_transfer_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."deletedUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'Transfer belongs to a deleted account; historical record is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdminPasswordVault; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AdminPasswordVault" (
    "userId" text NOT NULL,
    "encryptedPassword" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ApiKey; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ApiKey" (
    id text NOT NULL,
    "userId" text NOT NULL,
    label text NOT NULL,
    "apiKey" text NOT NULL,
    "encryptedSecret" text NOT NULL,
    "canTrade" boolean DEFAULT false NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp(3) without time zone
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "userId" text,
    action text NOT NULL,
    metadata jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Balance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Balance" (
    id text NOT NULL,
    "userId" text NOT NULL,
    asset text NOT NULL,
    available numeric(36,18) DEFAULT 0 NOT NULL,
    locked numeric(36,18) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: BankingReferralReward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BankingReferralReward" (
    id text NOT NULL,
    "referrerId" text,
    "referredUserId" text,
    "placementId" text NOT NULL,
    "bankingRewardLedgerEntryId" text NOT NULL,
    asset text NOT NULL,
    "sourceProfitAmount" numeric(36,18) NOT NULL,
    "commissionRate" numeric(18,10) NOT NULL,
    amount numeric(36,18) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedReferrerId" text,
    "deletedReferredUserId" text,
    CONSTRAINT "BankingReferralReward_amount_nonnegative" CHECK ((amount >= (0)::numeric)),
    CONSTRAINT "BankingReferralReward_not_self" CHECK (("referrerId" <> "referredUserId")),
    CONSTRAINT "BankingReferralReward_source_positive" CHECK (("sourceProfitAmount" > (0)::numeric))
);


--
-- Name: CardApplication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CardApplication" (
    id text NOT NULL,
    "userId" text NOT NULL,
    product public."CardProduct" NOT NULL,
    status public."CardApplicationStatus" DEFAULT 'SUBMITTED'::public."CardApplicationStatus" NOT NULL,
    "submittedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "eligibilitySnapshot" jsonb NOT NULL
);


--
-- Name: CfdPosition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CfdPosition" (
    id text NOT NULL,
    "userId" text NOT NULL,
    symbol text NOT NULL,
    side text NOT NULL,
    size numeric(36,18) NOT NULL,
    "entryPrice" numeric(36,18) NOT NULL,
    leverage integer NOT NULL,
    "initialMargin" numeric(36,18) NOT NULL,
    "liquidationPrice" numeric(36,18) NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    "realizedPnl" numeric(36,18) DEFAULT 0 NOT NULL,
    "openedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "closedAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CopyPerformanceScenario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CopyPerformanceScenario" (
    id text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    "stateText" text NOT NULL,
    "simulatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CopyStrategyOwner; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CopyStrategyOwner" (
    "traderId" text NOT NULL,
    "publicName" text NOT NULL,
    "ownerUserId" text,
    premium boolean DEFAULT false NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DemoBalance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DemoBalance" (
    id text NOT NULL,
    "userId" text NOT NULL,
    asset text NOT NULL,
    available numeric(36,18) DEFAULT 0 NOT NULL,
    locked numeric(36,18) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DemoOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DemoOrder" (
    id text NOT NULL,
    "userId" text NOT NULL,
    pair text NOT NULL,
    side text NOT NULL,
    type text NOT NULL,
    price numeric(36,18),
    "originalQuantity" numeric(36,18) NOT NULL,
    "remainingQuantity" numeric(36,18) NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DemoTrade; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DemoTrade" (
    id text NOT NULL,
    pair text NOT NULL,
    "takerOrderId" text NOT NULL,
    "makerOrderId" text NOT NULL,
    "takerUserId" text NOT NULL,
    "makerUserId" text NOT NULL,
    price numeric(36,18) NOT NULL,
    quantity numeric(36,18) NOT NULL,
    side text NOT NULL,
    "executedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Deposit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Deposit" (
    id text NOT NULL,
    "userId" text,
    asset text NOT NULL,
    chain text NOT NULL,
    "txHash" text NOT NULL,
    amount numeric(36,18) NOT NULL,
    confirmations integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "recipientAddress" text,
    "blockNumber" bigint,
    "blockTimestamp" timestamp(3) without time zone,
    "verifiedAt" timestamp(3) without time zone,
    finalized boolean DEFAULT false NOT NULL,
    "verifyError" text,
    "verifyAttempts" integer DEFAULT 0 NOT NULL,
    "lastVerifyAttemptAt" timestamp(3) without time zone,
    source text,
    revision integer DEFAULT 0 NOT NULL,
    "creditedAt" timestamp(3) without time zone,
    "batchId" text,
    "ignoredAt" timestamp(3) without time zone,
    "ignoredReason" text,
    "ignoredNote" text,
    "ignoredByAdminId" text,
    "deletedUserId" text
);


--
-- Name: DepositAddressCopyEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DepositAddressCopyEvent" (
    id text NOT NULL,
    "eventId" text NOT NULL,
    "userId" text NOT NULL,
    asset text NOT NULL,
    network text NOT NULL,
    "destinationId" text,
    "addressSnapshot" text NOT NULL,
    "memoSnapshot" text,
    source text NOT NULL,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "clientCopiedAt" timestamp(3) without time zone
);


--
-- Name: DepositBatch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DepositBatch" (
    id text NOT NULL,
    "userId" text NOT NULL,
    chain text NOT NULL,
    asset text NOT NULL,
    "totalAmount" numeric(36,18) NOT NULL,
    "depositCount" integer NOT NULL,
    "usdValue" numeric(36,18) NOT NULL,
    "usdPolicy" text NOT NULL,
    "priceUsd" numeric(36,18),
    "pricedAt" timestamp(3) without time zone,
    "approvedByAdminId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: DepositClaim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DepositClaim" (
    id text NOT NULL,
    "userId" text NOT NULL,
    chain text NOT NULL,
    "txHash" text NOT NULL,
    asset text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: DepositWatchCursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DepositWatchCursor" (
    id text NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    contract text NOT NULL,
    asset text NOT NULL,
    "scannedThroughMs" bigint NOT NULL,
    "windowStartMs" bigint,
    "windowEndMs" bigint,
    "pageCursor" text,
    "pagesInWindow" integer DEFAULT 0 NOT NULL,
    "lastPageAt" timestamp(3) without time zone,
    "lastError" text,
    "lastErrorAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DepositWatchState; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DepositWatchState" (
    id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "leaseOwner" text,
    "leaseUntil" timestamp(3) without time zone,
    "lastRunStartedAt" timestamp(3) without time zone,
    "lastRunFinishedAt" timestamp(3) without time zone,
    "lastSuccessAt" timestamp(3) without time zone,
    "lastRunOk" boolean,
    "lastRunTrigger" text,
    "lastScheduledRunAt" timestamp(3) without time zone,
    "lastRunSummary" jsonb,
    "providerStatus" text,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lastAdminOpenRunAt" timestamp(3) without time zone
);


--
-- Name: EmailVerificationChallenge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EmailVerificationChallenge" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "codeHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "consumedAt" timestamp(3) without time zone,
    "lastSentAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FundingPayment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FundingPayment" (
    id text NOT NULL,
    "positionId" text NOT NULL,
    "userId" text NOT NULL,
    symbol text NOT NULL,
    amount numeric(36,18) NOT NULL,
    rate numeric(20,10) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FundingRateRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FundingRateRecord" (
    id text NOT NULL,
    symbol text NOT NULL,
    rate numeric(20,10) NOT NULL,
    "markPrice" numeric(36,18) NOT NULL,
    "indexPrice" numeric(36,18) NOT NULL,
    "appliedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FuturesBalance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FuturesBalance" (
    id text NOT NULL,
    "userId" text NOT NULL,
    asset text NOT NULL,
    available numeric(36,18) DEFAULT 0 NOT NULL,
    locked numeric(36,18) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: FuturesOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FuturesOrder" (
    id text NOT NULL,
    "userId" text NOT NULL,
    symbol text NOT NULL,
    side text NOT NULL,
    type text NOT NULL,
    price numeric(36,18),
    "originalQuantity" numeric(36,18) NOT NULL,
    "remainingQuantity" numeric(36,18) NOT NULL,
    status text NOT NULL,
    "reduceOnly" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    leverage integer NOT NULL,
    "marginType" text NOT NULL
);


--
-- Name: FuturesPosition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FuturesPosition" (
    id text NOT NULL,
    "userId" text NOT NULL,
    symbol text NOT NULL,
    side text NOT NULL,
    size numeric(36,18) NOT NULL,
    "entryPrice" numeric(36,18) NOT NULL,
    leverage integer NOT NULL,
    "marginType" text NOT NULL,
    "initialMargin" numeric(36,18) NOT NULL,
    "liquidationPrice" numeric(36,18) NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    "realizedPnl" numeric(36,18) DEFAULT 0 NOT NULL,
    "openedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "closedAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: FuturesPositionProtection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FuturesPositionProtection" (
    id text NOT NULL,
    "positionId" text NOT NULL,
    "userId" text NOT NULL,
    symbol text NOT NULL,
    kind text NOT NULL,
    "triggerPrice" numeric(36,18) NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    "lastError" text,
    attempts integer DEFAULT 0 NOT NULL,
    "triggeredAt" timestamp(3) without time zone,
    "resolvedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: IgnoredIncomingTransfer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."IgnoredIncomingTransfer" (
    id text NOT NULL,
    chain text NOT NULL,
    "txHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: InsuranceFund; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."InsuranceFund" (
    id text NOT NULL,
    asset text NOT NULL,
    balance numeric(36,18) DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: InsuranceFundLedger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."InsuranceFundLedger" (
    id text NOT NULL,
    asset text NOT NULL,
    amount numeric(36,18) NOT NULL,
    reason text NOT NULL,
    "positionId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: KycMaterialRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KycMaterialRequest" (
    id text NOT NULL,
    "submissionId" text NOT NULL,
    "userId" text NOT NULL,
    kind text NOT NULL,
    "documentReason" text,
    "documentReasonText" text,
    "selfieComment" text,
    status text DEFAULT 'OPEN'::text NOT NULL,
    "requestedBy" text NOT NULL,
    "clientRequestId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "documentDeliveryId" text,
    "documentReceivedAt" timestamp(3) without time zone,
    "documentMessageId" text,
    "documentMimeType" text,
    "documentSizeBytes" integer,
    "selfieDeliveryId" text,
    "selfieReceivedAt" timestamp(3) without time zone,
    "selfieMessageId" text,
    "selfieMimeType" text,
    "selfieSizeBytes" integer,
    "selfieConsentAt" timestamp(3) without time zone,
    "selfieConsentVersion" text,
    "acknowledgedAt" timestamp(3) without time zone,
    "acknowledgedBy" text,
    "closedAt" timestamp(3) without time zone,
    "closedBy" text,
    "closedOutcome" text
);


--
-- Name: KycSubmission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KycSubmission" (
    id text NOT NULL,
    "userId" text NOT NULL,
    country text NOT NULL,
    "fullName" text NOT NULL,
    "dateOfBirth" timestamp(3) without time zone NOT NULL,
    "documentType" text NOT NULL,
    "documentImagePath" text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "rejectionReason" text,
    "reviewedBy" text,
    "reviewedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "documentDelivery" text,
    "emailMessageId" text,
    "emailAcceptedAt" timestamp(3) without time zone,
    "documentMimeType" text,
    "documentSizeBytes" integer
);


--
-- Name: NativeDemoAccount; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NativeDemoAccount" (
    "userId" text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    payload jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: NativeDemoLiveProjection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NativeDemoLiveProjection" (
    "userId" text NOT NULL,
    revision integer NOT NULL,
    payload jsonb NOT NULL,
    digest text NOT NULL,
    "executionSession" jsonb,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: NativeDemoRevision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NativeDemoRevision" (
    "userId" text NOT NULL,
    revision integer NOT NULL,
    "requestKey" text NOT NULL,
    "requestHash" text NOT NULL,
    payload jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Order" (
    id text NOT NULL,
    "userId" text NOT NULL,
    pair text NOT NULL,
    side text NOT NULL,
    type text NOT NULL,
    price numeric(36,18),
    "originalQuantity" numeric(36,18) NOT NULL,
    "remainingQuantity" numeric(36,18) NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "ocoGroupId" text,
    "triggerPrice" numeric(36,18),
    "lockedAmount" numeric(36,18),
    "lockedAsset" text
);


--
-- Name: OtcCashCommand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashCommand" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "actorId" text NOT NULL,
    fingerprint text NOT NULL,
    result jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: OtcCashLedger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashLedger" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    kind text NOT NULL,
    asset text NOT NULL,
    quantity numeric(36,18) NOT NULL,
    "availableAfter" numeric(36,18) NOT NULL,
    "lockedAfter" numeric(36,18) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "OtcCashLedger_kind_check" CHECK ((kind = ANY (ARRAY['RESERVE'::text, 'RELEASE'::text, 'CONSUME'::text]))),
    CONSTRAINT "OtcCashLedger_quantity_check" CHECK ((quantity > (0)::numeric))
);


--
-- Name: OtcCashMessage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashMessage" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    "authorId" text NOT NULL,
    sender text NOT NULL,
    kind text DEFAULT 'TEXT'::text NOT NULL,
    text text NOT NULL,
    "idempotencyKey" text NOT NULL,
    fingerprint text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "OtcCashMessage_kind_check" CHECK ((kind = ANY (ARRAY['TEXT'::text, 'PICKUP'::text]))),
    CONSTRAINT "OtcCashMessage_sender_check" CHECK ((sender = ANY (ARRAY['USER'::text, 'ADMIN'::text]))),
    CONSTRAINT "OtcCashMessage_text_check" CHECK (((length(text) >= 1) AND (length(text) <= 3000)))
);


--
-- Name: OtcCashOffer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashOffer" (
    id text NOT NULL,
    "requestId" text NOT NULL,
    version integer NOT NULL,
    asset text NOT NULL,
    quantity numeric(36,18) NOT NULL,
    fiat text NOT NULL,
    rate numeric(36,18) NOT NULL,
    gross numeric(36,18) NOT NULL,
    fee numeric(36,18) NOT NULL,
    net numeric(36,18) NOT NULL,
    "cashPrecision" integer NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "acceptedAt" timestamp(3) without time zone,
    CONSTRAINT "OtcCashOffer_cashPrecision_check" CHECK ((("cashPrecision" >= 0) AND ("cashPrecision" <= 4))),
    CONSTRAINT "OtcCashOffer_check" CHECK (((net > (0)::numeric) AND (net = (gross - fee)))),
    CONSTRAINT "OtcCashOffer_fee_check" CHECK ((fee >= (0)::numeric)),
    CONSTRAINT "OtcCashOffer_rate_check" CHECK ((rate > (0)::numeric))
);


--
-- Name: OtcCashRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashRequest" (
    id text NOT NULL,
    number integer NOT NULL,
    "userId" text NOT NULL,
    "idempotencyKey" text NOT NULL,
    fingerprint text NOT NULL,
    country text NOT NULL,
    "cityId" text NOT NULL,
    asset text NOT NULL,
    quantity numeric(36,18) NOT NULL,
    fiat text NOT NULL,
    tier text NOT NULL,
    "policyVersion" text NOT NULL,
    status text DEFAULT 'RESERVED'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "offerVersion" integer DEFAULT 0 NOT NULL,
    "acceptedOfferVersion" integer,
    "acceptedAt" timestamp(3) without time zone,
    "cancelRequested" boolean DEFAULT false NOT NULL,
    "pickupRevision" integer DEFAULT 0 NOT NULL,
    "payoutReference" text,
    "completedBy" text,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "OtcCashRequest_quantity_check" CHECK ((quantity > (0)::numeric)),
    CONSTRAINT "OtcCashRequest_status_check" CHECK ((status = ANY (ARRAY['RESERVED'::text, 'OFFERED'::text, 'ACCEPTED'::text, 'PICKUP_READY'::text, 'PAYOUT_IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'REJECTED'::text])))
);


--
-- Name: OtcCashRequest_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."OtcCashRequest_number_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: OtcCashRequest_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."OtcCashRequest_number_seq" OWNED BY public."OtcCashRequest".number;


--
-- Name: OtcCashReservation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OtcCashReservation" (
    "requestId" text NOT NULL,
    asset text NOT NULL,
    quantity numeric(36,18) NOT NULL,
    status text DEFAULT 'HELD'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "settledAt" timestamp(3) without time zone,
    CONSTRAINT "OtcCashReservation_quantity_check" CHECK ((quantity > (0)::numeric)),
    CONSTRAINT "OtcCashReservation_status_check" CHECK ((status = ANY (ARRAY['HELD'::text, 'RELEASED'::text, 'CONSUMED'::text])))
);


--
-- Name: PortfolioSnapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PortfolioSnapshot" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "totalValueUsd" numeric(24,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PrivateTradingAccount; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PrivateTradingAccount" (
    "userId" text NOT NULL,
    available numeric(36,18) DEFAULT 0 NOT NULL,
    reserved numeric(36,18) DEFAULT 0 NOT NULL,
    principal numeric(36,18) DEFAULT 0 NOT NULL,
    realized numeric(36,18) DEFAULT 0 NOT NULL,
    state jsonb NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "PrivateTradingAccount_available_check" CHECK ((available >= (0)::numeric)),
    CONSTRAINT "PrivateTradingAccount_principal_check" CHECK ((principal >= (0)::numeric)),
    CONSTRAINT "PrivateTradingAccount_reserved_check" CHECK ((reserved >= (0)::numeric))
);


--
-- Name: PrivateTradingCard; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PrivateTradingCard" (
    id text NOT NULL,
    "userId" text NOT NULL,
    payload jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PrivateTradingCommand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PrivateTradingCommand" (
    "userId" text NOT NULL,
    key text NOT NULL,
    "requestHash" text NOT NULL,
    response jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PrivateTradingLedger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PrivateTradingLedger" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "eventId" text NOT NULL,
    "scenarioId" text,
    kind text NOT NULL,
    amount numeric(36,18) NOT NULL,
    metadata jsonb NOT NULL,
    "effectiveAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PrivateTradingPreview; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PrivateTradingPreview" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "requestKey" text NOT NULL,
    session jsonb NOT NULL,
    mode text NOT NULL,
    status text NOT NULL,
    request jsonb NOT NULL,
    result jsonb,
    progress integer DEFAULT 0 NOT NULL,
    error text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "confirmedAt" timestamp(3) without time zone
);


--
-- Name: Product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Product" (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    "priceAmount" numeric(36,18) NOT NULL,
    "priceAsset" text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Purchase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Purchase" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "productId" text NOT NULL,
    amount numeric(36,18) NOT NULL,
    asset text NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ReferralReward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ReferralReward" (
    id text NOT NULL,
    "referrerId" text,
    "referredUserId" text,
    "depositId" text NOT NULL,
    asset text NOT NULL,
    amount numeric(36,18) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedReferrerId" text,
    "deletedReferredUserId" text
);


--
-- Name: Session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Session" (
    id text NOT NULL,
    "userId" text NOT NULL,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    remembered boolean DEFAULT false NOT NULL
);


--
-- Name: SupportConversation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportConversation" (
    id text NOT NULL,
    "userId" text,
    "guestName" text NOT NULL,
    "guestEmail" text NOT NULL,
    subject public."SupportSubject" NOT NULL,
    "unreadByUser" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "unreadByAdmin" boolean DEFAULT false NOT NULL
);


--
-- Name: SupportMessage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportMessage" (
    id text NOT NULL,
    "conversationId" text NOT NULL,
    sender public."SupportSender" NOT NULL,
    body text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "externalId" text
);


--
-- Name: SupportNotification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportNotification" (
    id text NOT NULL,
    "conversationId" text NOT NULL,
    "messageId" text NOT NULL,
    recipient text,
    status public."SupportNotificationStatus" DEFAULT 'PENDING'::public."SupportNotificationStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastAttemptAt" timestamp(3) without time zone,
    "sentAt" timestamp(3) without time zone,
    "failureCategory" text,
    "failureCode" integer,
    "claimedUntil" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SyntheticCopyTradingState; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyntheticCopyTradingState" (
    id text NOT NULL,
    seed integer NOT NULL,
    "simulatedAt" timestamp(3) without time zone NOT NULL,
    mode text NOT NULL,
    state jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Trade; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Trade" (
    id text NOT NULL,
    pair text NOT NULL,
    "takerOrderId" text NOT NULL,
    "makerOrderId" text NOT NULL,
    "takerUserId" text NOT NULL,
    "makerUserId" text NOT NULL,
    price numeric(36,18) NOT NULL,
    quantity numeric(36,18) NOT NULL,
    side text NOT NULL,
    "executedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TreasuryAddressHistory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TreasuryAddressHistory" (
    id text NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    "firstSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TreasuryWallet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TreasuryWallet" (
    id text NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    "updatedByAdminId" text,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    "kycStatus" public."KycStatus" DEFAULT 'NOT_STARTED'::public."KycStatus" NOT NULL,
    "twoFactorSecret" text,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    "cardWaitlistJoinedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "twoFactorBackupCodes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "futuresRiskAckAt" timestamp(3) without time zone,
    role public."Role" DEFAULT 'USER'::public."Role" NOT NULL,
    "blockedAt" timestamp(3) without time zone,
    "blockedReason" text,
    "displayName" text,
    "referralCode" text NOT NULL,
    "referredById" text,
    country text,
    phone text,
    "avatarUrl" text,
    "emailVerifiedAt" timestamp(3) without time zone
);


--
-- Name: Wallet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Wallet" (
    id text NOT NULL,
    "userId" text NOT NULL,
    asset text NOT NULL,
    chain text NOT NULL,
    address text NOT NULL,
    "derivationPath" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Withdrawal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Withdrawal" (
    id text NOT NULL,
    "userId" text,
    asset text NOT NULL,
    "toAddress" text NOT NULL,
    amount numeric(36,18) NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    network text NOT NULL,
    "performedByAdminId" text,
    "rejectionReason" text,
    "txHash" text,
    "deletedUserId" text,
    "balanceHeld" boolean DEFAULT true NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: banking_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banking_commands (
    id text NOT NULL,
    user_id text NOT NULL,
    idempotency_key text NOT NULL,
    action text NOT NULL,
    request_hash text NOT NULL,
    result_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: banking_ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banking_ledger_entries (
    id text NOT NULL,
    user_id text NOT NULL,
    placement_id text,
    entry_type text NOT NULL,
    asset text NOT NULL,
    amount numeric(36,18) NOT NULL,
    period_index integer,
    effective_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT banking_ledger_entries_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: banking_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banking_placements (
    id text NOT NULL,
    user_id text NOT NULL,
    program_id text NOT NULL,
    asset text NOT NULL,
    principal numeric(36,18) NOT NULL,
    monthly_rate numeric(18,10) NOT NULL,
    term_months integer NOT NULL,
    compound boolean NOT NULL,
    payout_frequency text NOT NULL,
    lock_rule text NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    matures_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT banking_placements_monthly_rate_check CHECK ((monthly_rate >= (0)::numeric)),
    CONSTRAINT banking_placements_principal_check CHECK ((principal > (0)::numeric)),
    CONSTRAINT banking_placements_term_months_check CHECK ((term_months > 0))
);


--
-- Name: OtcCashRequest number; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest" ALTER COLUMN number SET DEFAULT nextval('public."OtcCashRequest_number_seq"'::regclass);


--
-- Name: AdminPasswordVault AdminPasswordVault_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminPasswordVault"
    ADD CONSTRAINT "AdminPasswordVault_pkey" PRIMARY KEY ("userId");


--
-- Name: ApiKey ApiKey_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ApiKey"
    ADD CONSTRAINT "ApiKey_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: Balance Balance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Balance"
    ADD CONSTRAINT "Balance_pkey" PRIMARY KEY (id);


--
-- Name: BankingReferralReward BankingReferralReward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_pkey" PRIMARY KEY (id);


--
-- Name: CardApplication CardApplication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CardApplication"
    ADD CONSTRAINT "CardApplication_pkey" PRIMARY KEY (id);


--
-- Name: CfdPosition CfdPosition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CfdPosition"
    ADD CONSTRAINT "CfdPosition_pkey" PRIMARY KEY (id);


--
-- Name: CopyPerformanceScenario CopyPerformanceScenario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CopyPerformanceScenario"
    ADD CONSTRAINT "CopyPerformanceScenario_pkey" PRIMARY KEY (id);


--
-- Name: CopyStrategyOwner CopyStrategyOwner_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CopyStrategyOwner"
    ADD CONSTRAINT "CopyStrategyOwner_pkey" PRIMARY KEY ("traderId");


--
-- Name: DemoBalance DemoBalance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DemoBalance"
    ADD CONSTRAINT "DemoBalance_pkey" PRIMARY KEY (id);


--
-- Name: DemoOrder DemoOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DemoOrder"
    ADD CONSTRAINT "DemoOrder_pkey" PRIMARY KEY (id);


--
-- Name: DemoTrade DemoTrade_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DemoTrade"
    ADD CONSTRAINT "DemoTrade_pkey" PRIMARY KEY (id);


--
-- Name: DepositAddressCopyEvent DepositAddressCopyEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositAddressCopyEvent"
    ADD CONSTRAINT "DepositAddressCopyEvent_pkey" PRIMARY KEY (id);


--
-- Name: DepositBatch DepositBatch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositBatch"
    ADD CONSTRAINT "DepositBatch_pkey" PRIMARY KEY (id);


--
-- Name: DepositClaim DepositClaim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositClaim"
    ADD CONSTRAINT "DepositClaim_pkey" PRIMARY KEY (id);


--
-- Name: DepositWatchCursor DepositWatchCursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositWatchCursor"
    ADD CONSTRAINT "DepositWatchCursor_pkey" PRIMARY KEY (id);


--
-- Name: DepositWatchState DepositWatchState_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositWatchState"
    ADD CONSTRAINT "DepositWatchState_pkey" PRIMARY KEY (id);


--
-- Name: Deposit Deposit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deposit"
    ADD CONSTRAINT "Deposit_pkey" PRIMARY KEY (id);


--
-- Name: EmailVerificationChallenge EmailVerificationChallenge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmailVerificationChallenge"
    ADD CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY (id);


--
-- Name: FundingPayment FundingPayment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FundingPayment"
    ADD CONSTRAINT "FundingPayment_pkey" PRIMARY KEY (id);


--
-- Name: FundingRateRecord FundingRateRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FundingRateRecord"
    ADD CONSTRAINT "FundingRateRecord_pkey" PRIMARY KEY (id);


--
-- Name: FuturesBalance FuturesBalance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesBalance"
    ADD CONSTRAINT "FuturesBalance_pkey" PRIMARY KEY (id);


--
-- Name: FuturesOrder FuturesOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesOrder"
    ADD CONSTRAINT "FuturesOrder_pkey" PRIMARY KEY (id);


--
-- Name: FuturesPositionProtection FuturesPositionProtection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesPositionProtection"
    ADD CONSTRAINT "FuturesPositionProtection_pkey" PRIMARY KEY (id);


--
-- Name: FuturesPosition FuturesPosition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesPosition"
    ADD CONSTRAINT "FuturesPosition_pkey" PRIMARY KEY (id);


--
-- Name: IgnoredIncomingTransfer IgnoredIncomingTransfer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IgnoredIncomingTransfer"
    ADD CONSTRAINT "IgnoredIncomingTransfer_pkey" PRIMARY KEY (id);


--
-- Name: InsuranceFundLedger InsuranceFundLedger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InsuranceFundLedger"
    ADD CONSTRAINT "InsuranceFundLedger_pkey" PRIMARY KEY (id);


--
-- Name: InsuranceFund InsuranceFund_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."InsuranceFund"
    ADD CONSTRAINT "InsuranceFund_pkey" PRIMARY KEY (id);


--
-- Name: KycMaterialRequest KycMaterialRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KycMaterialRequest"
    ADD CONSTRAINT "KycMaterialRequest_pkey" PRIMARY KEY (id);


--
-- Name: KycSubmission KycSubmission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KycSubmission"
    ADD CONSTRAINT "KycSubmission_pkey" PRIMARY KEY (id);


--
-- Name: NativeDemoAccount NativeDemoAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NativeDemoAccount"
    ADD CONSTRAINT "NativeDemoAccount_pkey" PRIMARY KEY ("userId");


--
-- Name: NativeDemoLiveProjection NativeDemoLiveProjection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NativeDemoLiveProjection"
    ADD CONSTRAINT "NativeDemoLiveProjection_pkey" PRIMARY KEY ("userId");


--
-- Name: NativeDemoRevision NativeDemoRevision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NativeDemoRevision"
    ADD CONSTRAINT "NativeDemoRevision_pkey" PRIMARY KEY ("userId", revision);


--
-- Name: Order Order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashCommand OtcCashCommand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashCommand"
    ADD CONSTRAINT "OtcCashCommand_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashCommand OtcCashCommand_requestId_idempotencyKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashCommand"
    ADD CONSTRAINT "OtcCashCommand_requestId_idempotencyKey_key" UNIQUE ("requestId", "idempotencyKey");


--
-- Name: OtcCashLedger OtcCashLedger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashLedger"
    ADD CONSTRAINT "OtcCashLedger_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashLedger OtcCashLedger_requestId_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashLedger"
    ADD CONSTRAINT "OtcCashLedger_requestId_kind_key" UNIQUE ("requestId", kind);


--
-- Name: OtcCashMessage OtcCashMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashMessage"
    ADD CONSTRAINT "OtcCashMessage_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashMessage OtcCashMessage_requestId_authorId_idempotencyKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashMessage"
    ADD CONSTRAINT "OtcCashMessage_requestId_authorId_idempotencyKey_key" UNIQUE ("requestId", "authorId", "idempotencyKey");


--
-- Name: OtcCashOffer OtcCashOffer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashOffer"
    ADD CONSTRAINT "OtcCashOffer_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashOffer OtcCashOffer_requestId_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashOffer"
    ADD CONSTRAINT "OtcCashOffer_requestId_version_key" UNIQUE ("requestId", version);


--
-- Name: OtcCashRequest OtcCashRequest_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest"
    ADD CONSTRAINT "OtcCashRequest_number_key" UNIQUE (number);


--
-- Name: OtcCashRequest OtcCashRequest_payoutReference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest"
    ADD CONSTRAINT "OtcCashRequest_payoutReference_key" UNIQUE ("payoutReference");


--
-- Name: OtcCashRequest OtcCashRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest"
    ADD CONSTRAINT "OtcCashRequest_pkey" PRIMARY KEY (id);


--
-- Name: OtcCashRequest OtcCashRequest_userId_idempotencyKey_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest"
    ADD CONSTRAINT "OtcCashRequest_userId_idempotencyKey_key" UNIQUE ("userId", "idempotencyKey");


--
-- Name: OtcCashReservation OtcCashReservation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashReservation"
    ADD CONSTRAINT "OtcCashReservation_pkey" PRIMARY KEY ("requestId");


--
-- Name: PortfolioSnapshot PortfolioSnapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PortfolioSnapshot"
    ADD CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY (id);


--
-- Name: PrivateTradingAccount PrivateTradingAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingAccount"
    ADD CONSTRAINT "PrivateTradingAccount_pkey" PRIMARY KEY ("userId");


--
-- Name: PrivateTradingCard PrivateTradingCard_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingCard"
    ADD CONSTRAINT "PrivateTradingCard_pkey" PRIMARY KEY (id);


--
-- Name: PrivateTradingCommand PrivateTradingCommand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingCommand"
    ADD CONSTRAINT "PrivateTradingCommand_pkey" PRIMARY KEY ("userId", key);


--
-- Name: PrivateTradingLedger PrivateTradingLedger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingLedger"
    ADD CONSTRAINT "PrivateTradingLedger_pkey" PRIMARY KEY (id);


--
-- Name: PrivateTradingPreview PrivateTradingPreview_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingPreview"
    ADD CONSTRAINT "PrivateTradingPreview_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: Purchase Purchase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Purchase"
    ADD CONSTRAINT "Purchase_pkey" PRIMARY KEY (id);


--
-- Name: ReferralReward ReferralReward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReferralReward"
    ADD CONSTRAINT "ReferralReward_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: SupportConversation SupportConversation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportConversation"
    ADD CONSTRAINT "SupportConversation_pkey" PRIMARY KEY (id);


--
-- Name: SupportMessage SupportMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportMessage"
    ADD CONSTRAINT "SupportMessage_pkey" PRIMARY KEY (id);


--
-- Name: SupportNotification SupportNotification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportNotification"
    ADD CONSTRAINT "SupportNotification_pkey" PRIMARY KEY (id);


--
-- Name: SyntheticCopyTradingState SyntheticCopyTradingState_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyntheticCopyTradingState"
    ADD CONSTRAINT "SyntheticCopyTradingState_pkey" PRIMARY KEY (id);


--
-- Name: Trade Trade_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Trade"
    ADD CONSTRAINT "Trade_pkey" PRIMARY KEY (id);


--
-- Name: TreasuryAddressHistory TreasuryAddressHistory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TreasuryAddressHistory"
    ADD CONSTRAINT "TreasuryAddressHistory_pkey" PRIMARY KEY (id);


--
-- Name: TreasuryWallet TreasuryWallet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TreasuryWallet"
    ADD CONSTRAINT "TreasuryWallet_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: Wallet Wallet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Wallet"
    ADD CONSTRAINT "Wallet_pkey" PRIMARY KEY (id);


--
-- Name: Withdrawal Withdrawal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Withdrawal"
    ADD CONSTRAINT "Withdrawal_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: banking_commands banking_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_commands
    ADD CONSTRAINT banking_commands_pkey PRIMARY KEY (id);


--
-- Name: banking_commands banking_commands_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_commands
    ADD CONSTRAINT banking_commands_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);


--
-- Name: banking_ledger_entries banking_ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_ledger_entries
    ADD CONSTRAINT banking_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: banking_placements banking_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_placements
    ADD CONSTRAINT banking_placements_pkey PRIMARY KEY (id);


--
-- Name: ApiKey_apiKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ApiKey_apiKey_key" ON public."ApiKey" USING btree ("apiKey");


--
-- Name: ApiKey_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ApiKey_userId_idx" ON public."ApiKey" USING btree ("userId");


--
-- Name: AuditLog_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_action_idx" ON public."AuditLog" USING btree (action);


--
-- Name: AuditLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_idx" ON public."AuditLog" USING btree ("userId");


--
-- Name: Balance_userId_asset_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Balance_userId_asset_key" ON public."Balance" USING btree ("userId", asset);


--
-- Name: Balance_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Balance_userId_idx" ON public."Balance" USING btree ("userId");


--
-- Name: BankingReferralReward_bankingRewardLedgerEntryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "BankingReferralReward_bankingRewardLedgerEntryId_key" ON public."BankingReferralReward" USING btree ("bankingRewardLedgerEntryId");


--
-- Name: BankingReferralReward_placementId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BankingReferralReward_placementId_idx" ON public."BankingReferralReward" USING btree ("placementId");


--
-- Name: BankingReferralReward_referredUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BankingReferralReward_referredUserId_idx" ON public."BankingReferralReward" USING btree ("referredUserId");


--
-- Name: BankingReferralReward_referrerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BankingReferralReward_referrerId_idx" ON public."BankingReferralReward" USING btree ("referrerId");


--
-- Name: CardApplication_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CardApplication_userId_key" ON public."CardApplication" USING btree ("userId");


--
-- Name: CfdPosition_symbol_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CfdPosition_symbol_status_idx" ON public."CfdPosition" USING btree (symbol, status);


--
-- Name: CfdPosition_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CfdPosition_userId_status_idx" ON public."CfdPosition" USING btree ("userId", status);


--
-- Name: DemoBalance_userId_asset_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DemoBalance_userId_asset_key" ON public."DemoBalance" USING btree ("userId", asset);


--
-- Name: DemoBalance_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DemoBalance_userId_idx" ON public."DemoBalance" USING btree ("userId");


--
-- Name: DemoOrder_pair_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DemoOrder_pair_status_idx" ON public."DemoOrder" USING btree (pair, status);


--
-- Name: DemoOrder_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DemoOrder_userId_idx" ON public."DemoOrder" USING btree ("userId");


--
-- Name: DemoTrade_pair_executedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DemoTrade_pair_executedAt_idx" ON public."DemoTrade" USING btree (pair, "executedAt");


--
-- Name: DepositAddressCopyEvent_receivedAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DepositAddressCopyEvent_receivedAt_id_idx" ON public."DepositAddressCopyEvent" USING btree ("receivedAt" DESC, id DESC);


--
-- Name: DepositAddressCopyEvent_userId_eventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DepositAddressCopyEvent_userId_eventId_key" ON public."DepositAddressCopyEvent" USING btree ("userId", "eventId");


--
-- Name: DepositAddressCopyEvent_userId_receivedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DepositAddressCopyEvent_userId_receivedAt_idx" ON public."DepositAddressCopyEvent" USING btree ("userId", "receivedAt" DESC);


--
-- Name: DepositBatch_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DepositBatch_idempotencyKey_key" ON public."DepositBatch" USING btree ("idempotencyKey");


--
-- Name: DepositBatch_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DepositBatch_userId_idx" ON public."DepositBatch" USING btree ("userId");


--
-- Name: DepositClaim_chain_txHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DepositClaim_chain_txHash_idx" ON public."DepositClaim" USING btree (chain, "txHash");


--
-- Name: DepositClaim_userId_chain_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DepositClaim_userId_chain_txHash_key" ON public."DepositClaim" USING btree ("userId", chain, "txHash");


--
-- Name: DepositWatchCursor_chain_address_contract_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DepositWatchCursor_chain_address_contract_key" ON public."DepositWatchCursor" USING btree (chain, address, contract);


--
-- Name: Deposit_batchId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Deposit_batchId_idx" ON public."Deposit" USING btree ("batchId");


--
-- Name: Deposit_chain_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Deposit_chain_txHash_key" ON public."Deposit" USING btree (chain, "txHash");


--
-- Name: Deposit_ignoredAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Deposit_ignoredAt_idx" ON public."Deposit" USING btree ("ignoredAt");


--
-- Name: Deposit_status_userId_chain_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Deposit_status_userId_chain_asset_idx" ON public."Deposit" USING btree (status, "userId", chain, asset);


--
-- Name: Deposit_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Deposit_userId_idx" ON public."Deposit" USING btree ("userId");


--
-- Name: EmailVerificationChallenge_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmailVerificationChallenge_expiresAt_idx" ON public."EmailVerificationChallenge" USING btree ("expiresAt");


--
-- Name: EmailVerificationChallenge_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "EmailVerificationChallenge_userId_idx" ON public."EmailVerificationChallenge" USING btree ("userId");


--
-- Name: FundingPayment_positionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FundingPayment_positionId_idx" ON public."FundingPayment" USING btree ("positionId");


--
-- Name: FundingPayment_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FundingPayment_userId_idx" ON public."FundingPayment" USING btree ("userId");


--
-- Name: FundingRateRecord_symbol_appliedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FundingRateRecord_symbol_appliedAt_idx" ON public."FundingRateRecord" USING btree (symbol, "appliedAt");


--
-- Name: FuturesBalance_userId_asset_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FuturesBalance_userId_asset_key" ON public."FuturesBalance" USING btree ("userId", asset);


--
-- Name: FuturesBalance_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesBalance_userId_idx" ON public."FuturesBalance" USING btree ("userId");


--
-- Name: FuturesOrder_symbol_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesOrder_symbol_status_idx" ON public."FuturesOrder" USING btree (symbol, status);


--
-- Name: FuturesOrder_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesOrder_userId_idx" ON public."FuturesOrder" USING btree ("userId");


--
-- Name: FuturesPositionProtection_positionId_kind_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FuturesPositionProtection_positionId_kind_key" ON public."FuturesPositionProtection" USING btree ("positionId", kind);


--
-- Name: FuturesPositionProtection_status_symbol_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesPositionProtection_status_symbol_idx" ON public."FuturesPositionProtection" USING btree (status, symbol);


--
-- Name: FuturesPositionProtection_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesPositionProtection_userId_idx" ON public."FuturesPositionProtection" USING btree ("userId");


--
-- Name: FuturesPosition_symbol_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesPosition_symbol_status_idx" ON public."FuturesPosition" USING btree (symbol, status);


--
-- Name: FuturesPosition_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FuturesPosition_userId_status_idx" ON public."FuturesPosition" USING btree ("userId", status);


--
-- Name: IgnoredIncomingTransfer_chain_txHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "IgnoredIncomingTransfer_chain_txHash_key" ON public."IgnoredIncomingTransfer" USING btree (chain, "txHash");


--
-- Name: InsuranceFundLedger_asset_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "InsuranceFundLedger_asset_createdAt_idx" ON public."InsuranceFundLedger" USING btree (asset, "createdAt");


--
-- Name: InsuranceFund_asset_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "InsuranceFund_asset_key" ON public."InsuranceFund" USING btree (asset);


--
-- Name: KycMaterialRequest_clientRequestId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "KycMaterialRequest_clientRequestId_key" ON public."KycMaterialRequest" USING btree ("clientRequestId");


--
-- Name: KycMaterialRequest_submissionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KycMaterialRequest_submissionId_idx" ON public."KycMaterialRequest" USING btree ("submissionId");


--
-- Name: KycMaterialRequest_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KycMaterialRequest_userId_status_idx" ON public."KycMaterialRequest" USING btree ("userId", status);


--
-- Name: KycSubmission_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KycSubmission_status_idx" ON public."KycSubmission" USING btree (status);


--
-- Name: KycSubmission_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KycSubmission_userId_idx" ON public."KycSubmission" USING btree ("userId");


--
-- Name: NativeDemoRevision_userId_requestKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NativeDemoRevision_userId_requestKey_key" ON public."NativeDemoRevision" USING btree ("userId", "requestKey");


--
-- Name: Order_ocoGroupId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Order_ocoGroupId_idx" ON public."Order" USING btree ("ocoGroupId");


--
-- Name: Order_pair_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Order_pair_status_idx" ON public."Order" USING btree (pair, status);


--
-- Name: Order_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Order_userId_idx" ON public."Order" USING btree ("userId");


--
-- Name: OtcCashMessage_requestId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OtcCashMessage_requestId_createdAt_id_idx" ON public."OtcCashMessage" USING btree ("requestId", "createdAt", id);


--
-- Name: OtcCashRequest_status_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OtcCashRequest_status_createdAt_id_idx" ON public."OtcCashRequest" USING btree (status, "createdAt", id);


--
-- Name: OtcCashRequest_userId_createdAt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OtcCashRequest_userId_createdAt_id_idx" ON public."OtcCashRequest" USING btree ("userId", "createdAt", id);


--
-- Name: PortfolioSnapshot_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PortfolioSnapshot_userId_createdAt_idx" ON public."PortfolioSnapshot" USING btree ("userId", "createdAt");


--
-- Name: PrivateTradingCard_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PrivateTradingCard_userId_createdAt_idx" ON public."PrivateTradingCard" USING btree ("userId", "createdAt");


--
-- Name: PrivateTradingLedger_userId_eventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PrivateTradingLedger_userId_eventId_key" ON public."PrivateTradingLedger" USING btree ("userId", "eventId");


--
-- Name: PrivateTradingLedger_userId_scenarioId_effectiveAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PrivateTradingLedger_userId_scenarioId_effectiveAt_idx" ON public."PrivateTradingLedger" USING btree ("userId", "scenarioId", "effectiveAt");


--
-- Name: PrivateTradingPreview_userId_requestKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PrivateTradingPreview_userId_requestKey_key" ON public."PrivateTradingPreview" USING btree ("userId", "requestKey");


--
-- Name: PrivateTradingPreview_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PrivateTradingPreview_userId_status_idx" ON public."PrivateTradingPreview" USING btree ("userId", status);


--
-- Name: Product_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Product_active_idx" ON public."Product" USING btree (active);


--
-- Name: Purchase_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Purchase_status_idx" ON public."Purchase" USING btree (status);


--
-- Name: Purchase_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Purchase_userId_idx" ON public."Purchase" USING btree ("userId");


--
-- Name: ReferralReward_depositId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ReferralReward_depositId_key" ON public."ReferralReward" USING btree ("depositId");


--
-- Name: ReferralReward_referrerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ReferralReward_referrerId_idx" ON public."ReferralReward" USING btree ("referrerId");


--
-- Name: Session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");


--
-- Name: SupportConversation_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportConversation_userId_idx" ON public."SupportConversation" USING btree ("userId");


--
-- Name: SupportMessage_conversationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON public."SupportMessage" USING btree ("conversationId", "createdAt");


--
-- Name: SupportMessage_externalId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SupportMessage_externalId_key" ON public."SupportMessage" USING btree ("externalId");


--
-- Name: SupportNotification_conversationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportNotification_conversationId_idx" ON public."SupportNotification" USING btree ("conversationId");


--
-- Name: SupportNotification_messageId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SupportNotification_messageId_key" ON public."SupportNotification" USING btree ("messageId");


--
-- Name: SupportNotification_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportNotification_status_nextAttemptAt_idx" ON public."SupportNotification" USING btree (status, "nextAttemptAt");


--
-- Name: Trade_makerUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Trade_makerUserId_idx" ON public."Trade" USING btree ("makerUserId");


--
-- Name: Trade_pair_executedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Trade_pair_executedAt_idx" ON public."Trade" USING btree (pair, "executedAt");


--
-- Name: Trade_takerUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Trade_takerUserId_idx" ON public."Trade" USING btree ("takerUserId");


--
-- Name: TreasuryAddressHistory_chain_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TreasuryAddressHistory_chain_address_key" ON public."TreasuryAddressHistory" USING btree (chain, address);


--
-- Name: TreasuryWallet_chain_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TreasuryWallet_chain_key" ON public."TreasuryWallet" USING btree (chain);


--
-- Name: User_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_email_idx" ON public."User" USING btree (email);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_referralCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_referralCode_key" ON public."User" USING btree ("referralCode");


--
-- Name: Wallet_asset_chain_address_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Wallet_asset_chain_address_key" ON public."Wallet" USING btree (asset, chain, address);


--
-- Name: Wallet_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Wallet_userId_idx" ON public."Wallet" USING btree ("userId");


--
-- Name: Withdrawal_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Withdrawal_status_idx" ON public."Withdrawal" USING btree (status);


--
-- Name: Withdrawal_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Withdrawal_userId_idx" ON public."Withdrawal" USING btree ("userId");


--
-- Name: banking_commands_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX banking_commands_user_created_idx ON public.banking_commands USING btree (user_id, created_at DESC);


--
-- Name: banking_ledger_period_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX banking_ledger_period_unique ON public.banking_ledger_entries USING btree (placement_id, entry_type, period_index) WHERE (period_index IS NOT NULL);


--
-- Name: banking_ledger_user_effective_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX banking_ledger_user_effective_idx ON public.banking_ledger_entries USING btree (user_id, effective_at DESC);


--
-- Name: banking_placements_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX banking_placements_user_created_idx ON public.banking_placements USING btree (user_id, created_at DESC);


--
-- Name: banking_ledger_entries banking_ledger_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER banking_ledger_no_delete BEFORE DELETE ON public.banking_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.prevent_banking_ledger_mutation();


--
-- Name: banking_ledger_entries banking_ledger_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER banking_ledger_no_update BEFORE UPDATE ON public.banking_ledger_entries FOR EACH ROW EXECUTE FUNCTION public.prevent_banking_ledger_mutation();


--
-- Name: NativeDemoRevision native_demo_revision_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER native_demo_revision_immutable BEFORE DELETE OR UPDATE ON public."NativeDemoRevision" FOR EACH ROW EXECUTE FUNCTION public.native_demo_revision_immutable();


--
-- Name: Deposit retained_deposit_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retained_deposit_immutable BEFORE DELETE OR UPDATE ON public."Deposit" FOR EACH ROW EXECUTE FUNCTION public.retained_account_transfer_immutable();


--
-- Name: Withdrawal retained_withdrawal_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER retained_withdrawal_immutable BEFORE DELETE OR UPDATE ON public."Withdrawal" FOR EACH ROW EXECUTE FUNCTION public.retained_account_transfer_immutable();


--
-- Name: AdminPasswordVault AdminPasswordVault_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AdminPasswordVault"
    ADD CONSTRAINT "AdminPasswordVault_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ApiKey ApiKey_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ApiKey"
    ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Balance Balance_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Balance"
    ADD CONSTRAINT "Balance_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: BankingReferralReward BankingReferralReward_referredUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BankingReferralReward BankingReferralReward_referrerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BankingReferralReward"
    ADD CONSTRAINT "BankingReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CardApplication CardApplication_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CardApplication"
    ADD CONSTRAINT "CardApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CfdPosition CfdPosition_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CfdPosition"
    ADD CONSTRAINT "CfdPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CopyStrategyOwner CopyStrategyOwner_ownerUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CopyStrategyOwner"
    ADD CONSTRAINT "CopyStrategyOwner_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: DemoBalance DemoBalance_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DemoBalance"
    ADD CONSTRAINT "DemoBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DemoOrder DemoOrder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DemoOrder"
    ADD CONSTRAINT "DemoOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DepositAddressCopyEvent DepositAddressCopyEvent_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DepositAddressCopyEvent"
    ADD CONSTRAINT "DepositAddressCopyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Deposit Deposit_batchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deposit"
    ADD CONSTRAINT "Deposit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."DepositBatch"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Deposit Deposit_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deposit"
    ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: EmailVerificationChallenge EmailVerificationChallenge_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EmailVerificationChallenge"
    ADD CONSTRAINT "EmailVerificationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FundingPayment FundingPayment_positionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FundingPayment"
    ADD CONSTRAINT "FundingPayment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES public."FuturesPosition"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FuturesBalance FuturesBalance_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesBalance"
    ADD CONSTRAINT "FuturesBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FuturesOrder FuturesOrder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesOrder"
    ADD CONSTRAINT "FuturesOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FuturesPositionProtection FuturesPositionProtection_positionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesPositionProtection"
    ADD CONSTRAINT "FuturesPositionProtection_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES public."FuturesPosition"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FuturesPositionProtection FuturesPositionProtection_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesPositionProtection"
    ADD CONSTRAINT "FuturesPositionProtection_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FuturesPosition FuturesPosition_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FuturesPosition"
    ADD CONSTRAINT "FuturesPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KycMaterialRequest KycMaterialRequest_submissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KycMaterialRequest"
    ADD CONSTRAINT "KycMaterialRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES public."KycSubmission"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: KycSubmission KycSubmission_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KycSubmission"
    ADD CONSTRAINT "KycSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NativeDemoAccount NativeDemoAccount_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NativeDemoAccount"
    ADD CONSTRAINT "NativeDemoAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: NativeDemoRevision NativeDemoRevision_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NativeDemoRevision"
    ADD CONSTRAINT "NativeDemoRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: Order Order_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Order"
    ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OtcCashCommand OtcCashCommand_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashCommand"
    ADD CONSTRAINT "OtcCashCommand_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."OtcCashRequest"(id) ON DELETE RESTRICT;


--
-- Name: OtcCashLedger OtcCashLedger_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashLedger"
    ADD CONSTRAINT "OtcCashLedger_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."OtcCashRequest"(id) ON DELETE RESTRICT;


--
-- Name: OtcCashMessage OtcCashMessage_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashMessage"
    ADD CONSTRAINT "OtcCashMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."OtcCashRequest"(id) ON DELETE RESTRICT;


--
-- Name: OtcCashOffer OtcCashOffer_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashOffer"
    ADD CONSTRAINT "OtcCashOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."OtcCashRequest"(id) ON DELETE RESTRICT;


--
-- Name: OtcCashRequest OtcCashRequest_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashRequest"
    ADD CONSTRAINT "OtcCashRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE RESTRICT;


--
-- Name: OtcCashReservation OtcCashReservation_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OtcCashReservation"
    ADD CONSTRAINT "OtcCashReservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."OtcCashRequest"(id) ON DELETE RESTRICT;


--
-- Name: PortfolioSnapshot PortfolioSnapshot_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PortfolioSnapshot"
    ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PrivateTradingAccount PrivateTradingAccount_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingAccount"
    ADD CONSTRAINT "PrivateTradingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: PrivateTradingCard PrivateTradingCard_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingCard"
    ADD CONSTRAINT "PrivateTradingCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: PrivateTradingCommand PrivateTradingCommand_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingCommand"
    ADD CONSTRAINT "PrivateTradingCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: PrivateTradingLedger PrivateTradingLedger_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingLedger"
    ADD CONSTRAINT "PrivateTradingLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: PrivateTradingPreview PrivateTradingPreview_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PrivateTradingPreview"
    ADD CONSTRAINT "PrivateTradingPreview_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id);


--
-- Name: Purchase Purchase_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Purchase"
    ADD CONSTRAINT "Purchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Purchase Purchase_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Purchase"
    ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ReferralReward ReferralReward_depositId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReferralReward"
    ADD CONSTRAINT "ReferralReward_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES public."Deposit"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ReferralReward ReferralReward_referredUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReferralReward"
    ADD CONSTRAINT "ReferralReward_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ReferralReward ReferralReward_referrerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ReferralReward"
    ADD CONSTRAINT "ReferralReward_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SupportConversation SupportConversation_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportConversation"
    ADD CONSTRAINT "SupportConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SupportMessage SupportMessage_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportMessage"
    ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."SupportConversation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SupportNotification SupportNotification_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportNotification"
    ADD CONSTRAINT "SupportNotification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."SupportConversation"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SupportNotification SupportNotification_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportNotification"
    ADD CONSTRAINT "SupportNotification_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."SupportMessage"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: User User_referredById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Wallet Wallet_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Wallet"
    ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Withdrawal Withdrawal_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Withdrawal"
    ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: banking_commands banking_commands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_commands
    ADD CONSTRAINT banking_commands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE RESTRICT;


--
-- Name: banking_ledger_entries banking_ledger_entries_placement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_ledger_entries
    ADD CONSTRAINT banking_ledger_entries_placement_id_fkey FOREIGN KEY (placement_id) REFERENCES public.banking_placements(id) ON DELETE RESTRICT;


--
-- Name: banking_ledger_entries banking_ledger_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_ledger_entries
    ADD CONSTRAINT banking_ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE RESTRICT;


--
-- Name: banking_placements banking_placements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banking_placements
    ADD CONSTRAINT banking_placements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict XBvW8sD2NPKiqvdUSwaPu4Fm5tIlrIUbR1u6m8m06rpzvtqlZmRnp7FOcfz5d6I

