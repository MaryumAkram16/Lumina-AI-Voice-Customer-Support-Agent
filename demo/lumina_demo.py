#!/usr/bin/env python3
"""Provider-free Lumina demo engine.

This module is deliberately isolated from the Retell and n8n exports. It uses
synthetic fixtures only, performs no network calls, and never mutates orders.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_ORDERS = Path(__file__).with_name("orders.json")
SUPPORTED_INTENTS = {"track_order", "cancel_order", "return_item", "refund_order"}
INTENT_ALIASES = {
    "track": "track_order",
    "tracking": "track_order",
    "order_status": "track_order",
    "cancel": "cancel_order",
    "return": "return_item",
    "refund": "refund_order",
}


class DemoEngine:
    """Deterministic order-support behavior for demos and local tests."""

    def __init__(self, orders: list[dict[str, Any]]) -> None:
        self.orders = {str(order["order_id"]).upper(): order for order in orders}
        self.processed_events: dict[str, dict[str, Any]] = {}

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        event_id = self._clean(request.get("event_id"))
        if event_id and event_id in self.processed_events:
            previous = dict(self.processed_events[event_id])
            previous["outcome"] = "duplicate"
            previous["duplicate"] = True
            previous["message"] = "This demo event was already processed; no second action was taken."
            return previous

        intent = self._normalize_intent(request.get("intent"))
        order_id = self._clean(request.get("order_id"), uppercase=True)

        if not intent or intent not in SUPPORTED_INTENTS:
            response = self._response(
                request,
                outcome="validation_error",
                message="Provide one supported intent: track_order, cancel_order, return_item, or refund_order.",
            )
        elif not order_id:
            response = self._response(
                request,
                outcome="validation_error",
                intent=intent,
                message="Please provide a valid order ID so the demo can look up the order.",
            )
        else:
            order = self.orders.get(order_id)
            if not order:
                response = self._response(
                    request,
                    outcome="not_found",
                    intent=intent,
                    message="The demo could not find that order. No status or action was invented.",
                )
            elif not self._identity_matches(request, order):
                response = self._response(
                    request,
                    outcome="verification_failed",
                    intent=intent,
                    message="The demo could not verify the supplied customer details. No order data was disclosed.",
                )
            else:
                response = self._resolve(order, intent, request)

        if event_id:
            response["event_id"] = event_id
            self.processed_events[event_id] = dict(response)
        return response

    @staticmethod
    def _clean(value: Any, uppercase: bool = False) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        return text.upper() if uppercase else text

    @staticmethod
    def _normalize_intent(value: Any) -> str | None:
        cleaned = DemoEngine._clean(value, uppercase=False)
        if not cleaned:
            return None
        normalized = cleaned.lower().replace("-", "_").replace(" ", "_")
        return INTENT_ALIASES.get(normalized, normalized)

    @staticmethod
    def _identity_matches(request: dict[str, Any], order: dict[str, Any]) -> bool:
        supplied_email = DemoEngine._clean(request.get("email"), uppercase=False)
        supplied_phone = DemoEngine._clean(request.get("phone_no"), uppercase=False)
        if supplied_email and supplied_email.lower() == str(order.get("email", "")).lower():
            return True
        if supplied_phone and supplied_phone == str(order.get("phone_no", "")):
            return True
        # The demo allows order-ID-only lookups so the setup flow remains simple.
        return not supplied_email and not supplied_phone

    @staticmethod
    def _response(request: dict[str, Any], outcome: str, message: str, **fields: Any) -> dict[str, Any]:
        response: dict[str, Any] = {
            "success": outcome in {"success", "demo_only"},
            "demo_mode": True,
            "action_taken": False,
            "outcome": outcome,
            "message": message,
        }
        if request.get("intent"):
            response["requested_intent"] = str(request["intent"])
        response.update({key: value for key, value in fields.items() if value is not None})
        return response

    def _resolve(self, order: dict[str, Any], intent: str, request: dict[str, Any]) -> dict[str, Any]:
        common = {
            "order_id": order["order_id"],
            "customer_name": order["customer_name"],
        }
        if intent == "track_order":
            return self._response(
                request,
                outcome="success",
                intent=intent,
                message=f"Demo order {order['order_id']} is {order['status']}.",
                status=order["status"],
                carrier=order.get("carrier"),
                tracking_number=order.get("tracking_number"),
                delivery_date=order.get("delivery_date"),
                tracking_steps=order.get("tracking_steps", []),
                **common,
            )

        if intent == "cancel_order":
            if order["status"] == "processing":
                return self._response(
                    request,
                    outcome="demo_only",
                    intent=intent,
                    message="Demo cancellation is eligible, but no real cancellation was performed.",
                    status=order["status"],
                    **common,
                )
            return self._response(
                request,
                outcome="human_escalation",
                intent=intent,
                message="This demo order has progressed beyond automatic cancellation; no action was performed.",
                status=order["status"],
                **common,
            )

        if intent == "return_item":
            if order["status"] == "delivered":
                return self._response(
                    request,
                    outcome="demo_only",
                    intent=intent,
                    message="Demo return is eligible for review, but no real return was created.",
                    status=order["status"],
                    **common,
                )
            return self._response(
                request,
                outcome="human_escalation",
                intent=intent,
                message="This demo order is not eligible for the reference return path; no action was performed.",
                status=order["status"],
                **common,
            )

        # refund_order
        if order["status"] == "delivered":
            return self._response(
                request,
                outcome="demo_only",
                intent=intent,
                message="Demo refund is eligible for review, but no real refund was created.",
                status=order["status"],
                **common,
            )
        return self._response(
            request,
            outcome="human_escalation",
            intent=intent,
            message="The demo cannot confirm a refund for this order; no action was performed.",
            status=order["status"],
            **common,
        )


def load_orders(path: Path = DEFAULT_ORDERS) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        orders = json.load(handle)
    if not isinstance(orders, list) or not all(isinstance(item, dict) for item in orders):
        raise ValueError("orders.json must contain a JSON array of objects")
    return orders


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Lumina locally with synthetic data only.")
    parser.add_argument("--scenario", help="Scenario name from demo/scenarios.json")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--orders", type=Path, default=DEFAULT_ORDERS, help="Synthetic order fixture path")
    args = parser.parse_args()

    scenarios_path = Path(__file__).with_name("scenarios.json")
    scenarios = json.loads(scenarios_path.read_text(encoding="utf-8"))
    if args.list:
        for name, scenario in scenarios.items():
            print(f"{name}: {scenario['description']}")
        return 0

    if args.scenario:
        if args.scenario not in scenarios:
            parser.error(f"unknown scenario: {args.scenario}; use --list")
        request = scenarios[args.scenario]["request"]
    else:
        raw = sys.stdin.read().strip()
        if not raw:
            parser.error("provide --scenario or a JSON request on stdin")
        request = json.loads(raw)

    response = DemoEngine(load_orders(args.orders)).handle(request)
    print(json.dumps(response, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
