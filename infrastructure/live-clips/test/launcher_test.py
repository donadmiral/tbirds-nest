import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("launcher", pathlib.Path(__file__).parents[1] / "launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
NOW = 1793707200  # fixed UTC daytime; no external service or credential.
CLUSTER = "arn:aws:ecs:us-east-2:111111111111:cluster/fixture"
TASK = CLUSTER.replace(":cluster/", ":task/") + "/" + "a" * 32
ENV = dict(AWS_REGION="us-east-2", AWS_ACCOUNT_ID="111111111111", SUPABASE_PROJECT_REF="a" * 20,
           LAUNCH_ENABLED="true", RENDERER_CLUSTER_ARN=CLUSTER,
           RENDERER_TASK_ARN="arn:aws:ecs:us-east-2:111111111111:task-definition/renderer:1",
           RENDERER_QUEUE_SECRET_ARN="arn:aws:secretsmanager:us-east-2:111111111111:secret:queue-123456",
           RENDERER_SECURITY_GROUP="sg-12345678", RENDERER_SUBNET_IDS="subnet-12345678,subnet-87654321")


class MemoryLedger:
    def __init__(self):
        self.current = None
        self.charged = 0
        self.reservations = []

    def slot(self):
        return copy.deepcopy(self.current)

    def reserve(self, reservation):
        if self.current and self.current.get("state") == "active" or self.charged + reservation["charge"] > launcher.DAY_BUDGET:
            return False
        self.charged += reservation["charge"]
        self.current = copy.deepcopy(reservation)
        self.reservations.append(copy.deepcopy(reservation))
        return True

    def task(self, reservation, arn):
        assert self.current["token"] == reservation["token"]
        self.current["task_arn"] = arn

    def settled(self, reservation):
        assert self.current["token"] == reservation["token"]
        self.current = dict(state="idle", last_kind=reservation["kind"])


class FakeEcs:
    def __init__(self, ledger):
        self.ledger, self.calls, self.status, self.lost_response, self.stop_calls = ledger, [], "RUNNING", False, []
        self.exit_code = 0

    def run_task(self, **request):
        assert self.ledger.current["state"] == "active", "unreserved launch"
        self.calls.append(copy.deepcopy(request))
        if self.lost_response:
            self.lost_response = False
            raise TimeoutError("accepted result lost")
        return {"tasks": [{"taskArn": TASK}]}

    def describe_tasks(self, **request):
        assert request["cluster"] == CLUSTER
        assert request["tasks"] == [TASK]
        return {"tasks": [{"taskArn": TASK, "lastStatus": self.status, "containers": [{"exitCode": self.exit_code}]}]}

    def stop_task(self, **request):
        self.stop_calls.append(request)


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.config = launcher.configuration(ENV)
        self.ledger = MemoryLedger()
        self.ecs = FakeEcs(self.ledger)
        self.queue_calls = []

    def queue(self, lane):
        self.queue_calls.append(lane["name"])
        return dict(enabled=True, due=True, active=0)

    def tick(self, now=NOW, **kwargs):
        return launcher.tick(self.config, self.ledger, self.ecs, kwargs.get("queue", self.queue), now, lambda: "1" * 32)

    def test_idle_or_disabled_queue_does_not_launch_or_spend(self):
        result = self.tick(queue=lambda _: dict(enabled=False, due=False, active=0))
        self.assertEqual(result["state"], "idle")
        self.assertEqual(self.ledger.charged, 0)
        self.assertEqual(self.ecs.calls, [])
        self.config["enabled"] = False
        self.assertEqual(self.tick()["state"], "disabled")
        self.assertEqual(self.queue_calls, [])

    def test_one_reservation_precedes_exact_pinned_task_with_absolute_deadline(self):
        result = self.tick()
        self.assertEqual(result["state"], "launched")
        self.assertEqual(self.ledger.charged, 720)
        request = self.ecs.calls[0]
        self.assertEqual(request["count"], 1)
        self.assertEqual(request["taskDefinition"], ENV["RENDERER_TASK_ARN"])
        self.assertEqual(request["overrides"]["containerOverrides"], [{"name": "renderer", "environment": [{"name": "LIVE_CLIP_TASK_DEADLINE_MS", "value": str((NOW + 600) * 1000)}]}])
        self.assertFalse(request["enableExecuteCommand"])
        self.assertNotIn("taskRoleArn", request["overrides"])
        self.assertEqual(self.tick(NOW + 60)["state"], "active")
        self.assertEqual(len(self.ecs.calls), 1)
        self.assertEqual(self.queue_calls, ["renderer"])

    def test_ambiguous_launch_replays_same_request_without_another_charge(self):
        self.ecs.lost_response = True
        with self.assertRaises(TimeoutError): self.tick()
        self.assertEqual(self.ledger.charged, 720)
        self.config["lanes"][0]["definition"] = ENV["RENDERER_TASK_ARN"].replace(":1", ":2")
        self.assertEqual(self.tick(NOW + 60)["state"], "launched")
        self.assertEqual(self.ecs.calls[0], self.ecs.calls[1])
        self.assertEqual(self.ledger.charged, 720)

    def test_unknown_expired_launch_is_not_released_or_restarted(self):
        self.ecs.lost_response = True
        with self.assertRaises(TimeoutError): self.tick()
        self.assertEqual(self.tick(NOW + 600)["state"], "manual_review")
        self.assertEqual(len(self.ecs.calls), 1)
        self.assertEqual(self.ledger.current["state"], "active")

    def test_deadline_stops_exact_task_but_slot_remains_until_stopped(self):
        self.tick()
        self.assertEqual(self.tick(NOW + 600)["state"], "deadline_stop")
        self.assertEqual(self.ecs.stop_calls[0]["task"], TASK)
        self.assertEqual(self.ledger.current["state"], "active")
        self.ecs.status = "STOPPED"
        self.assertEqual(self.tick(NOW + 660)["state"], "settled")
        self.assertEqual(self.ledger.charged, 720)
        self.assertEqual(self.ledger.current["state"], "idle")

    def test_daily_limit_and_midnight_boundary_fail_closed(self):
        self.ledger.charged = 7200
        self.assertEqual(self.tick()["state"], "budget_blocked")
        self.assertEqual(self.ecs.calls, [])
        self.ledger.charged = 0
        end_of_day = NOW - NOW % 86400 + 86400 - 700
        self.assertEqual(self.tick(end_of_day)["state"], "budget_blocked")
        self.assertEqual(self.ledger.charged, 0)

    def test_shared_asr_budget_and_fairness(self):
        asr = dict(self.config["lanes"][0], name="transcription", seconds=240, charge=180, window=360,
                   container="transcription", deadline_name="LIVE_TRANSCRIPTION_TASK_DEADLINE_MS")
        self.config["lanes"].append(asr)
        self.ledger.current = {"state": "idle", "last_kind": "renderer"}
        self.ledger.charged = 7020
        self.assertEqual(self.tick()["lane"], "transcription")
        self.assertEqual(self.ledger.charged, 7200)
        self.assertEqual(self.ecs.calls[0]["overrides"]["containerOverrides"][0]["environment"][0]["name"], "LIVE_TRANSCRIPTION_TASK_DEADLINE_MS")

    def test_queue_outage_or_existing_lease_does_not_claim_or_launch(self):
        def outage(_): raise TimeoutError("PRIVATE_CANARY")
        self.assertEqual(self.tick(queue=outage), {"state": "queue_unavailable"})
        self.assertEqual(self.tick(queue=lambda _: dict(enabled=True, due=True, active=1))["state"], "idle")
        self.assertEqual(self.ecs.calls, [])

    def test_task_start_failure_without_exit_code_is_reported_as_failure(self):
        self.tick()
        self.ecs.describe_tasks = lambda **_: {"tasks": [{"taskArn": TASK, "lastStatus": "STOPPED", "stopCode": "TaskFailedToStart", "containers": [{}]}]}
        self.assertEqual(self.tick(NOW + 60)["state"], "task_failed")
        self.assertEqual(self.ledger.charged, 720)

    def test_configuration_requires_exact_region_account_revision_and_network(self):
        for key, value in [("AWS_REGION", "us-east-1"), ("RENDERER_TASK_ARN", ENV["RENDERER_TASK_ARN"].rsplit(":", 1)[0]),
                           ("RENDERER_CLUSTER_ARN", CLUSTER.replace("111111111111", "222222222222")), ("RENDERER_SUBNET_IDS", "subnet-12345678,https://evil.invalid")]:
            with self.assertRaisesRegex(ValueError, "configuration_invalid"):
                launcher.configuration(dict(ENV, **{key: value}))

    def test_real_ledger_uses_atomic_budget_and_slot_conditions_without_refund(self):
        class Recorder:
            def __init__(self): self.transactions, self.updates = [], []
            def transact_write_items(self, **kwargs): self.transactions.append(kwargs)
            def update_item(self, **kwargs): self.updates.append(kwargs)
        self.tick()
        recorder = Recorder()
        ledger = launcher.Ledger(recorder, "fixture-ledger")
        reservation = self.ledger.reservations[0]
        self.assertTrue(ledger.reserve(reservation))
        transaction = recorder.transactions[0]
        self.assertEqual(transaction["ClientRequestToken"], reservation["token"])
        self.assertEqual(len(transaction["TransactItems"]), 2)
        budget = transaction["TransactItems"][1]["Update"]
        self.assertEqual(budget["ExpressionAttributeValues"][":maximum"], {"N": "6480"})
        self.assertIn("ConditionExpression", transaction["TransactItems"][0]["Put"])
        ledger.settled(reservation)
        self.assertEqual(recorder.updates[0]["Key"], {"id": {"S": "slot"}})
        self.assertNotIn("used_seconds", json_string := str(recorder.updates[0]))


if __name__ == "__main__": unittest.main()
