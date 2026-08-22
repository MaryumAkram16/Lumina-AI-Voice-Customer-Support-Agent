import json
import unittest
from pathlib import Path

from lumina_demo import DemoEngine, load_orders


class DemoEngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.orders = load_orders(Path(__file__).with_name("orders.json"))

    def setUp(self):
        self.engine = DemoEngine(self.orders)

    def test_known_tracking_lookup_is_deterministic(self):
        request = {
            "event_id": "test-track-001",
            "order_id": "ORD-TEST-001",
            "intent": "track_order",
            "email": "alex@example.test",
        }
        first = self.engine.handle(request)
        second_engine = DemoEngine(self.orders)
        second = second_engine.handle(request)
        self.assertEqual(first, second)
        self.assertEqual(first["outcome"], "success")
        self.assertEqual(first["status"], "shipped")
        self.assertTrue(first["demo_mode"])
        self.assertFalse(first["action_taken"])

    def test_unknown_order_never_invents_status(self):
        response = self.engine.handle({"order_id": "ORD-TEST-999", "intent": "track_order"})
        self.assertEqual(response["outcome"], "not_found")
        self.assertNotIn("status", response)
        self.assertFalse(response["action_taken"])

    def test_missing_order_id_is_validation_error(self):
        response = self.engine.handle({"intent": "track_order"})
        self.assertEqual(response["outcome"], "validation_error")
        self.assertFalse(response["action_taken"])

    def test_identity_mismatch_does_not_disclose_order(self):
        response = self.engine.handle(
            {
                "order_id": "ORD-TEST-001",
                "intent": "track_order",
                "email": "wrong@example.test",
            }
        )
        self.assertEqual(response["outcome"], "verification_failed")
        self.assertNotIn("status", response)
        self.assertNotIn("customer_name", response)

    def test_state_changing_intents_are_demo_only(self):
        response = self.engine.handle(
            {
                "order_id": "ORD-TEST-002",
                "intent": "cancel_order",
                "email": "sam@example.test",
            }
        )
        self.assertEqual(response["outcome"], "demo_only")
        self.assertFalse(response["action_taken"])
        self.assertIn("no real cancellation", response["message"].lower())

    def test_duplicate_event_returns_no_second_action(self):
        request = {
            "event_id": "test-duplicate-001",
            "order_id": "ORD-TEST-001",
            "intent": "track_order",
        }
        first = self.engine.handle(request)
        duplicate = self.engine.handle(request)
        self.assertEqual(first["outcome"], "success")
        self.assertEqual(duplicate["outcome"], "duplicate")
        self.assertTrue(duplicate["duplicate"])
        self.assertFalse(duplicate["action_taken"])

    def test_aliases_are_normalized(self):
        response = self.engine.handle({"order_id": "ORD-TEST-003", "intent": "tracking"})
        self.assertEqual(response["outcome"], "success")
        self.assertEqual(response["intent"], "track_order")


if __name__ == "__main__":
    unittest.main()
