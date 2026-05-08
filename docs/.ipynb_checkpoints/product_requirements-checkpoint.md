# Product Requirements Document (MVP)

## Product
WheelDesk — Decision Support for Covered Calls and Wheel Portfolios.

## Beachhead customer
Advanced DIY income-focused options traders managing $50k–$1M taxable accounts who run covered calls and cash-secured puts repeatedly and need workflow tooling (not hype signals).

## Problem
Broker platforms expose chains but do not provide workflow intelligence for:
- strike selection aligned to income + upside constraints
- roll timing and repair decisions
- assignment vs opportunity-cost tradeoff
- wheel lifecycle tracking and performance attribution

## Value proposition
"Plan, score, and manage covered calls/CSPs with a repeatable framework in under 15 minutes per session."

## V1 features (only)
1. Portfolio setup: tickers, lot size, cost basis, wheel preference profile.
2. Covered call candidate engine:
   - Inputs: target DTE range, min annualized yield, max delta, earnings window toggle.
   - Outputs: ranked contracts with rationale.
3. Cash-secured put candidate engine with similar ranking logic.
4. Wheel tracker:
   - state machine: cash -> short put -> assigned shares -> short call -> called away.
   - cycle-level income and drawdown view.
5. Roll assistant:
   - detects contracts inside configurable danger zones (high delta, near expiry, earnings event).
   - presents roll choices with tradeoffs.
6. Daily digest + in-app alerts.
7. Waitlist + onboarding questionnaire.

## Explicitly excluded from V1
- Brokerage trade execution
- Auto-trading
- Mobile app
- Complex multi-leg spreads
- Tax lot optimization automation
- Social feeds/community features

## First-value workflow
1. User signs up and completes strategy profile.
2. Adds 3–10 symbols and current positions.
3. Runs "Find Calls" or "Find Puts".
4. Reviews ranked candidates and “why” panel.
5. Saves a plan and receives digest alerts.

## Core success metrics
- Activation: >= 60% users run at least one scan within 24 hours.
- Time-to-first-value: <= 10 minutes.
- Week-4 retention: >= 35% for activated users.
- Paid conversion from trial: >= 10%.
