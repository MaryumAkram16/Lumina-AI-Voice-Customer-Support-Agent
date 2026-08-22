# Lumina Provider-Free Demo

This directory provides a local demonstration of Lumina’s order-support behavior using synthetic data only. It makes no network calls, does not require Retell, n8n, Google, or a model-provider account, and never mutates an order.

## Run the demo

From the repository root:

```bash
python3 demo/lumina_demo.py --list
python3 demo/lumina_demo.py --scenario track_known_order
python3 demo/lumina_demo.py --scenario cancel_processing_order
python3 demo/lumina_demo.py --scenario unknown_order
```

You can also pipe a JSON request into the engine:

```bash
printf '%s\n' '{"event_id":"local-001","order_id":"ORD-TEST-001","intent":"track_order","email":"alex@example.test"}' \
  | python3 demo/lumina_demo.py
```

## Available scenarios

| Scenario | Demonstrates | Safety behavior |
|---|---|---|
| `track_known_order` | Successful lookup for a synthetic shipped order | Returns fixture data only |
| `cancel_processing_order` | Eligible cancellation path | Reports demo eligibility but performs no cancellation |
| `return_delivered_order` | Eligible return-review path | Reports demo eligibility but creates no return |
| `unknown_order` | Unknown order handling | Does not invent a status |
| `missing_order_id` | Input validation | Does not query an order |
| `identity_mismatch` | Contact verification | Does not disclose order data |

## Response contract

Every response includes `demo_mode: true` and `action_taken: false`. State-changing intents return either `demo_only` or `human_escalation`; they never call an external system. When an `event_id` is repeated in the same engine process, the second response is marked `duplicate` and no second action is taken.

The demo fixtures are intentionally fictional. The `.test` email domains, `555` phone numbers, test order IDs, and test tracking numbers must not be replaced with production data for a public demo.

## Run tests

The tests use only Python’s standard library:

```bash
python3 -m unittest discover -s demo -p 'test_*.py' -v
```

The demo is a local behavior harness, not a live provider integration test. Use `SETUP.md` and `OPERATIONS.md` for provider configuration and production-readiness checks.
