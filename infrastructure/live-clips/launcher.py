"""Bounded ECS queue launcher. No broker, provider, media, or user credentials.

One durable reservation precedes every RunTask. Lost responses reuse the exact
request/clientToken. Uncertain reservations are never refunded or discarded.
"""
import datetime
import json
import os
import re
import time
import urllib.request
import uuid

DAY_BUDGET = 7200  # seconds of a 2-vCPU/4-GiB task; ASR uses half this rate.


def configuration(env):
    region = env.get("AWS_REGION", "")
    account = env.get("AWS_ACCOUNT_ID", "")
    project = env.get("SUPABASE_PROJECT_REF", "")
    if region != "us-east-2" or not re.fullmatch(r"\d{12}", account) or not re.fullmatch(r"[a-z0-9]{20}", project):
        raise ValueError("launcher_configuration_invalid")
    prefix = f"arn:aws:ecs:{region}:{account}:"
    lanes = []
    for name, upper, container, seconds, charge, endpoint, deadline_name in [
        ("renderer", "RENDERER", "renderer", 600, 720, "live-clip-scaler", "LIVE_CLIP_TASK_DEADLINE_MS"),
        ("transcription", "ASR", "transcription", 240, 180, "live-transcription-worker", "LIVE_TRANSCRIPTION_TASK_DEADLINE_MS"),
    ]:
        if name == "transcription" and env.get("ASR_ENABLED") != "true":
            continue
        cluster = env.get(upper + "_CLUSTER_ARN", "")
        definition = env.get(upper + "_TASK_ARN", "")
        secret = env.get(upper + "_QUEUE_SECRET_ARN", "")
        group = env.get(upper + "_SECURITY_GROUP", "")
        subnets = env.get(upper + "_SUBNET_IDS", "").split(",")
        if not re.fullmatch(re.escape(prefix) + r"cluster/[A-Za-z0-9_-]{1,255}", cluster):
            raise ValueError("launcher_configuration_invalid")
        if not re.fullmatch(re.escape(prefix) + r"task-definition/[A-Za-z0-9_-]{1,255}:[1-9][0-9]*", definition):
            raise ValueError("launcher_configuration_invalid")
        if not re.fullmatch(f"arn:aws:secretsmanager:{region}:{account}:secret:[A-Za-z0-9/_+=.@-]+", secret):
            raise ValueError("launcher_configuration_invalid")
        if not re.fullmatch(r"sg-[0-9a-f]{8,17}", group) or len(subnets) not in (1, 2, 3) or any(not re.fullmatch(r"subnet-[0-9a-f]{8,17}", item) for item in subnets):
            raise ValueError("launcher_configuration_invalid")
        lanes.append(dict(name=name, container=container, seconds=seconds, charge=charge,
                          window=720 if name == "renderer" else 360, cluster=cluster,
                          definition=definition, secret=secret, group=group, subnets=subnets,
                          endpoint=f"https://{project}.supabase.co/functions/v1/{endpoint}",
                          deadline_name=deadline_name))
    return dict(lanes=lanes, enabled=env.get("LAUNCH_ENABLED") == "true", account=account, region=region)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def peek(lane, secrets):
    value = secrets.get_secret_value(SecretId=lane["secret"]).get("SecretString", "")
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_+=./-]{32,256}", value):
        raise ValueError("queue_credential_invalid")
    request = urllib.request.Request(lane["endpoint"], data=b'{"action":"peek"}', method="POST",
                                     headers={"Authorization": "Bearer " + value, "Content-Type": "application/json", "Accept": "application/json"})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=4) as response:
        body = response.read(2049)
        if response.status != 200 or len(body) > 2048:
            raise ValueError("queue_unavailable")
    data = json.loads(body)
    if not isinstance(data, dict) or set(data) != {"enabled", "due", "active"} or type(data["enabled"]) is not bool or type(data["due"]) is not bool or type(data["active"]) is not int or not 0 <= data["active"] <= 2:
        raise ValueError("queue_response_invalid")
    return data


class Ledger:
    def __init__(self, client, table):
        self.client, self.table = client, table

    def slot(self):
        item = self.client.get_item(TableName=self.table, Key={"id": {"S": "slot"}}, ConsistentRead=True).get("Item")
        if not item:
            return None
        return json.loads(item["value"]["S"])

    def reserve(self, reservation):
        # Transaction serialization enforces both the shared slot and daily cap.
        day = reservation["day"]
        expiry = int(datetime.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()) + 90 * 86400
        try:
            self.client.transact_write_items(ClientRequestToken=reservation["token"], TransactItems=[
                {"Put": {"TableName": self.table, "Item": {"id": {"S": "slot"}, "state": {"S": "active"}, "token": {"S": reservation["token"]}, "value": {"S": json.dumps(reservation, separators=(",", ":"))}},
                         "ConditionExpression": "attribute_not_exists(#state) OR #state = :idle", "ExpressionAttributeNames": {"#state": "state"}, "ExpressionAttributeValues": {":idle": {"S": "idle"}}}},
                {"Update": {"TableName": self.table, "Key": {"id": {"S": "day#" + day}},
                            "UpdateExpression": "SET expires_at = :expires ADD used_seconds :charge, launches :one",
                            "ConditionExpression": "attribute_not_exists(used_seconds) OR used_seconds <= :maximum",
                            "ExpressionAttributeValues": {":expires": {"N": str(expiry)}, ":charge": {"N": str(reservation["charge"])}, ":one": {"N": "1"}, ":maximum": {"N": str(DAY_BUDGET - reservation["charge"])}}}},
            ])
            return True
        except Exception as error:
            # A transaction transport timeout may have committed. Never launch
            # on an uncertain result; the next tick re-reads the durable slot.
            if getattr(error, "response", {}).get("Error", {}).get("Code") == "TransactionCanceledException":
                return False
            raise

    def task(self, reservation, arn):
        saved = dict(reservation, task_arn=arn)
        self.client.update_item(TableName=self.table, Key={"id": {"S": "slot"}},
                                UpdateExpression="SET #value = :value", ConditionExpression="#token = :token AND #state = :active",
                                ExpressionAttributeNames={"#value": "value", "#token": "token", "#state": "state"},
                                ExpressionAttributeValues={":value": {"S": json.dumps(saved, separators=(",", ":"))}, ":token": {"S": reservation["token"]}, ":active": {"S": "active"}})

    def settled(self, reservation):
        # No refund, even when launch failed or the task stopped early.
        saved = {"state": "idle", "last_kind": reservation["kind"]}
        self.client.update_item(TableName=self.table, Key={"id": {"S": "slot"}}, UpdateExpression="SET #value = :value, #state = :idle REMOVE #token",
                                ConditionExpression="#token = :token AND #state = :active",
                                ExpressionAttributeNames={"#value": "value", "#token": "token", "#state": "state"},
                                ExpressionAttributeValues={":value": {"S": json.dumps(saved)}, ":idle": {"S": "idle"}, ":active": {"S": "active"}, ":token": {"S": reservation["token"]}})


def task_arn_valid(arn, cluster):
    return isinstance(arn, str) and re.fullmatch(re.escape(cluster.replace(":cluster/", ":task/")) + r"/[a-f0-9]{32}", arn) is not None


def launch_request(lane, token, deadline):
    return {"cluster": lane["cluster"], "taskDefinition": lane["definition"], "count": 1,
            "clientToken": token, "startedBy": "pc-live-" + token, "launchType": "FARGATE", "platformVersion": "1.4.0",
            "enableExecuteCommand": False, "enableECSManagedTags": False,
            "networkConfiguration": {"awsvpcConfiguration": {"assignPublicIp": "ENABLED", "subnets": lane["subnets"], "securityGroups": [lane["group"]]}},
            "overrides": {"containerOverrides": [{"name": lane["container"], "environment": [{"name": lane["deadline_name"], "value": str(deadline)}]}]}}


def dispatch(reservation, ledger, ecs):
    # The entire request is stored, including task revision, network and absolute
    # deadline. Reconfiguration cannot change an ambiguous RunTask retry.
    response = ecs.run_task(**reservation["request"])
    tasks = response.get("tasks", [])
    if not tasks and response.get("failures"):
        ledger.settled(reservation)
        return {"state": "launch_rejected", "lane": reservation["kind"]}
    if len(tasks) != 1 or not task_arn_valid(tasks[0].get("taskArn"), reservation["request"]["cluster"]):
        raise ValueError("launch_result_unknown")
    ledger.task(reservation, tasks[0]["taskArn"])
    return {"state": "launched", "lane": reservation["kind"], "reserved_seconds": reservation["charge"]}


def reconcile(slot, ledger, ecs, now):
    if not slot.get("task_arn"):
        if now * 1000 >= slot["deadline"]:
            # Do not start even an expired no-op task to recover an unknown ID.
            # Preserve the reservation and alert for an operator reconciliation.
            return {"state": "manual_review", "lane": slot["kind"]}
        return dispatch(slot, ledger, ecs)
    arn = slot["task_arn"]
    cluster = slot["request"]["cluster"]
    if not task_arn_valid(arn, cluster):
        raise ValueError("reservation_invalid")
    response = ecs.describe_tasks(cluster=cluster, tasks=[arn])
    tasks = response.get("tasks", [])
    if len(tasks) != 1 or tasks[0].get("taskArn") != arn:
        return {"state": "manual_review", "lane": slot["kind"]}
    if tasks[0].get("lastStatus") == "STOPPED":
        ledger.settled(slot)
        containers = tasks[0].get("containers", [])
        failed = tasks[0].get("stopCode") == "TaskFailedToStart" or not containers or any(
            type(container.get("exitCode")) is not int or container["exitCode"] != 0 for container in containers)
        return {"state": "task_failed" if failed else "settled", "lane": slot["kind"]}
    if now * 1000 >= slot["deadline"]:
        ecs.stop_task(cluster=cluster, task=arn, reason="Pre-reserved Live task deadline reached")
        return {"state": "deadline_stop", "lane": slot["kind"]}
    return {"state": "active", "lane": slot["kind"]}


def tick(config, ledger, ecs, queue, now=None, token_factory=lambda: uuid.uuid4().hex):
    now = int(time.time()) if now is None else int(now)
    slot = ledger.slot()
    if slot and slot.get("state") == "active":
        return reconcile(slot, ledger, ecs, now)
    if slot and slot.get("state") != "idle":
        raise ValueError("reservation_invalid")
    if not config["enabled"]:
        return {"state": "disabled"}
    lanes = sorted(config["lanes"], key=lambda lane: lane["name"] == (slot or {}).get("last_kind"))
    unavailable = False
    budget_blocked = False
    day = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%d")
    for lane in lanes:
        try:
            signal = queue(lane)
        except Exception:
            unavailable = True
            continue
        if not signal["enabled"] or not signal["due"] or signal["active"] > 0:
            continue
        # Do not assign one UTC day's reservation to compute in the next day.
        if now % 86400 + lane["window"] >= 86400:
            budget_blocked = True
            continue
        token = token_factory()
        deadline = (now + lane["seconds"]) * 1000
        reservation = {"state": "active", "kind": lane["name"], "token": token, "day": day,
                       "charge": lane["charge"], "deadline": deadline, "created_at": now,
                       "request": launch_request(lane, token, deadline)}
        if not ledger.reserve(reservation):
            budget_blocked = True
            continue
        return dispatch(reservation, ledger, ecs)
    return {"state": "budget_blocked" if budget_blocked else "queue_unavailable" if unavailable else "idle"}


def emit(result, deployment):
    states = {"disabled", "idle", "active", "launched", "settled", "task_failed", "launch_rejected", "deadline_stop", "manual_review", "budget_blocked", "queue_unavailable", "unavailable"}
    state = result.get("state") if result.get("state") in states else "unavailable"
    metrics = {"SchedulerHeartbeat": 1}
    metric = {"launched": "TaskLaunch", "task_failed": "TaskFailure", "launch_rejected": "LauncherUnavailable",
              "manual_review": "ManualReviewRequired", "deadline_stop": "DeadlineStop", "budget_blocked": "BudgetBlocked",
              "queue_unavailable": "LauncherUnavailable", "unavailable": "LauncherUnavailable"}.get(state)
    if metric:
        metrics[metric] = 1
    record = {"event": "live_task_launcher", "state": state, "deployment": deployment, **metrics,
              "_aws": {"Timestamp": int(time.time() * 1000), "CloudWatchMetrics": [{"Namespace": "PlatinumCircles/LiveLauncher", "Dimensions": [["deployment"]],
                       "Metrics": [{"Name": key, "Unit": "Count"} for key in metrics]}]}}
    if result.get("lane") in ("renderer", "transcription"):
        record["lane"] = result["lane"]
    print(json.dumps(record, separators=(",", ":")))


def handler(event, context):
    # Event contents never select a URL, credential, task, region or budget.
    import boto3
    from botocore.config import Config
    try:
        config = configuration(os.environ)
        client_config = Config(connect_timeout=3, read_timeout=5, retries={"mode": "standard", "total_max_attempts": 2})
        client = lambda name: boto3.client(name, region_name="us-east-2", config=client_config)
        ledger = Ledger(client("dynamodb"), os.environ["LEDGER_TABLE"])
        secrets = client("secretsmanager")
        result = tick(config, ledger, client("ecs"), lambda lane: peek(lane, secrets))
    except Exception:
        # Raw AWS/HTTP exceptions can contain request headers or provider data.
        result = {"state": "unavailable"}
    emit(result, os.environ.get("DEPLOYMENT", "live-launcher"))
    return result
