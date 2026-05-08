# Architecture

## Product shape

WheelDesk is a multi-tenant web application with:
1. Strategy setup (covered calls, cash-secured puts, wheel preferences)
2. Position ingestion + tracking
3. Decision engine (strike selection, roll/repair, assignment/opportunity-cost analysis)
4. Alerting + digest reports

## Stack decisions

- **Frontend:** Next.js App Router + React + server components for data-heavy pages
- **Backend:** Next.js route handlers for MVP, then split to dedicated services if needed
- **Database:** PostgreSQL + Prisma ORM
- **Queues/scheduling:** BullMQ or managed cron for scans and daily reports
- **Auth:** Email magic link + optional OAuth
- **Billing:** Stripe subscriptions + customer portal

## Data pipeline

1. Ingest options chains + underlying quotes from provider APIs.
2. Normalize chains into canonical contract records.
3. Compute analytics snapshots (delta, annualized yield, assignment probability proxy, IV rank context).
4. Join with account positions and strategy rules.
5. Generate ranked actions and alerts.

## Core services

- `chain-ingestion`: Pulls and normalizes chain/quote data.
- `analytics-engine`: Computes candidate scores and roll decisions.
- `portfolio-service`: Tracks open lots, wheel state, realized/unrealized income.
- `alerts-service`: Sends trigger alerts + daily/weekly digest.

## Non-functional requirements

- P95 dashboard load < 2 seconds for 50 symbols
- Deterministic scoring with versioned formulas
- Full audit log for generated recommendations
- Feature flags for gated rollout

## Security and compliance controls

- Role-based access for admin tooling
- Immutable recommendation logs (what signal, when, why)
- Global disclaimers + strategy-risk visibility before recommendations
- No “guaranteed return” language in UI copy
