# Billing integration — Clinical Knowledge

- Partner income and professional tool spend are separated conceptually.
- Test/virtual balances remain non-withdrawable.
- Prices are configurable defaults: basic drug search free, extended Vidal 5 RUB, similar cases 20 RUB, analytic overview 50 RUB.
- Real charges disabled (feature flag false).
- Idempotency key prevents duplicate charge.
- Charge only after successful result; refund/reservation cancellation on error (prepared).
- Admin pricing configuration and audit history prepared via query log.
- No real partner payouts from test tokens.
