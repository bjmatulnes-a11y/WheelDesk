# API Design (MVP)

## Auth
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## Portfolio
- `GET /api/portfolio`
- `POST /api/portfolio/positions`
- `PATCH /api/portfolio/positions/:id`
- `DELETE /api/portfolio/positions/:id`

## Scans
- `POST /api/scan/calls`
- `POST /api/scan/puts`
- `GET /api/scan/history`

## Wheel lifecycle
- `GET /api/wheel/cycles`
- `POST /api/wheel/events`

## Roll assistant
- `POST /api/roll/evaluate`

## Alerts
- `GET /api/alerts`
- `POST /api/alerts/preferences`

## Waitlist
- `POST /api/waitlist`

## Billing
- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/webhook`
