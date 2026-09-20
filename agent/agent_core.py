from __future__ import annotations

"""MCP-backed agent turns and the unified streaming event schema.

Every emitted event has exactly ``{type, data, ts}``, where ``type`` is one of
``token``, ``activity``, ``finding``, ``diff``, ``decision``, ``status``, or
``error`` and ``ts`` is an ISO8601 UTC timestamp. Token data is always JSON-safe
and contains string text.
"""

import json
import logging
import os
import re
import shlex
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp import StdioServerParameters
from mcp.client.stdio import stdio_client
from strands import Agent, tool
from strands.tools.mcp import MCPClient

from .session import Session, get_session

logger = logging.getLogger("kepler.agent")

_AGENT_DIR = Path(__file__).resolve().parent
DEFAULT_MCP_COMMAND = "npx -y @emfirge/mcp"
ALLOWED_EVENT_TYPES = {"token", "activity", "finding", "diff", "decision", "status", "error", "attackpaths", "compliance", "beforeafter"}
SYSTEM_PROMPT = (
    "You are Kepler, a branch-native cloud agent. Kepler forks the user's live cloud into "
    "an isolated branch, applies proposed changes on that branch, and measures consequences "
    "before they are real, including security, reachability, cost, and blast radius. "
    "Kepler never touches production: it is read-only against the real cloud and can always "
    "state 0 cloud writes. The human makes the final decision. Emfirge is only the "
    "harness/engine used through MCP to read the cloud and run the branch; Kepler is the "
    "agent and product. Frame every response around branch/fork, consequence-before-it's-real, "
    "human decision, and nothing touching production. For a new session, open with one short "
    "line introducing Kepler as the agent that works on a branch of the user's cloud, then "
    "ask for the AWS role ARN and region. If the user supplies both, call set_connection and "
    "then emfirge_scan. If they do not have a role or ask for help, call emfirge_setup_help, "
    "give them its returned CloudFormation quick-create URL, and ask them to paste the "
    "RoleArn. The local agent does not assume the role; the hosted Emfirge backend does."
)

_ROLE_ARN_PATTERN = re.compile(
    r"^arn:(?:aws|aws-us-gov|aws-cn):iam::(\d{12}):role/(?:[^/\s]+(?:/[^/\s]+)*)$"
)


def _account_from_role_arn(role_arn: str) -> str | None:
    match = _ROLE_ARN_PATTERN.fullmatch(role_arn.strip())
    return match.group(1) if match else None


def _connection_tool(session: Session) -> Any:
    @tool(description="Connect this session to an AWS account using a role ARN and region.")
    def set_connection(role_arn: str, region: str) -> str:
        """Store the user's AWS role ARN and region for this session."""
        normalized_arn = role_arn.strip()
        normalized_region = region.strip()
        account = _account_from_role_arn(normalized_arn)
        if account is None:
            return (
                "Connection rejected: role_arn must be a valid AWS IAM role ARN "
                "with a 12-digit account ID."
            )
        if not normalized_region or not re.fullmatch(r"[a-z0-9-]+", normalized_region):
            return "Connection rejected: region must be a valid AWS region name."
        session.role_arn = normalized_arn
        session.region = normalized_region
        session.connected = True
        return f"Connected to account {account} in {normalized_region} (read-only)."

    return set_connection


def _load_bedrock_env() -> None:
    """Load only the bearer token from the local file when the env var is unset."""
    key = "AWS_BEARER_TOKEN_BEDROCK"
    if os.environ.get(key):
        return
    env_file = _AGENT_DIR / ".env.bedrock"
    if not env_file.is_file():
        return
    try:
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == key and value.strip():
                os.environ[key] = value.strip().strip("'\"")
                return
    except OSError as exc:
        logger.warning("Could not read agent-local Bedrock environment file: %s", exc)


def mcp_command() -> list[str]:
    configured = os.environ.get("EMFIRGE_MCP_COMMAND", DEFAULT_MCP_COMMAND)
    command = shlex.split(configured)
    if not command:
        raise ValueError("EMFIRGE_MCP_COMMAND must not be empty")
    return command


def _server_parameters() -> Any:
    command = mcp_command()
    if command == shlex.split(DEFAULT_MCP_COMMAND):
        logger.info("Using MCP command: %s", DEFAULT_MCP_COMMAND)
    else:
        logger.warning("Using configured MCP command: %s", " ".join(command))
    return stdio_client(StdioServerParameters(command=command[0], args=command[1:]))


def _model() -> Any:
    provider = os.environ.get("MODEL_PROVIDER", "bedrock").lower()
    if provider == "openai":
        from strands.models.openai import OpenAIModel

        return OpenAIModel(
            client_args={"api_key": os.environ.get("OPENAI_API_KEY")},
            model_id=os.environ.get("OPENAI_MODEL_ID", "gpt-4o-mini"),
        )

    _load_bedrock_env()
    from strands.models import BedrockModel

    return BedrockModel(
        model_id=os.environ.get("BEDROCK_MODEL_ID", "openai.gpt-oss-120b-1:0"),
        region_name=os.environ.get("AWS_REGION", "ap-south-1"),
        streaming=False,
        additional_request_fields={
            "reasoning_effort": os.environ.get("BEDROCK_REASONING_EFFORT", "medium")
        },
    )


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def _event(event_type: str, data: Any) -> dict[str, Any]:
    if event_type not in ALLOWED_EVENT_TYPES:
        raise ValueError(f"unsupported event type: {event_type}")
    return {
        "type": event_type,
        "data": _json_safe(data),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


def _tool_name(tool: Any) -> str:
    if hasattr(tool, "tool_name"):
        return str(tool.tool_name)
    if hasattr(tool, "name"):
        return str(tool.name)
    if isinstance(tool, dict):
        return str(tool.get("name", "unknown"))
    return "unknown"


def _short_args(value: Any, limit: int = 180) -> str:
    text = _text(value)
    return text if len(text) <= limit else text[: limit - 3] + "..."


def _current_tool_activity(raw: dict[str, Any]) -> str | None:
    tool = raw.get("current_tool_use")
    if not isinstance(tool, dict) or not tool.get("name"):
        return None
    args = tool.get("input", tool.get("args", tool.get("arguments", {})))
    return f"{tool['name']}({_short_args(args)})"


def _result_text(raw: dict[str, Any]) -> str:
    result = raw.get("result")
    if result is None:
        return ""
    if isinstance(result, dict):
        for key in ("text", "message", "output"):
            if result.get(key):
                return _text(result[key])
    else:
        output = getattr(result, "output", None)
        if output:
            return _text(output)
    return _text(result)


def _get(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _message_events(raw: Any) -> list[Any]:
    message = _get(raw, "message")
    if message is not None:
        return [message]
    event = _get(raw, "event")
    if event is not None:
        nested = _message_events(event)
        if nested:
            return nested
    return [raw] if _get(raw, "role") is not None else []


def _content(message: Any) -> list[Any]:
    return _as_list(_get(message, "content"))


def _tool_uses(raw: Any) -> list[Any]:
    uses: list[Any] = []
    current = _get(raw, "current_tool_use")
    if current is not None:
        uses.append(current)
    for message in _message_events(raw):
        for block in _content(message):
            use = _get(block, "toolUse")
            if use is None:
                use = _get(block, "tool_use")
            if use is not None:
                uses.append(use)
    return uses


def _tool_results(raw: Any) -> list[Any]:
    results: list[Any] = []
    for message in _message_events(raw):
        if _get(message, "role") != "user":
            continue
        for block in _content(message):
            result = _get(block, "toolResult")
            if result is None:
                result = _get(block, "tool_result")
            if result is not None:
                results.append(result)
    return results


def _tool_result_payload(result: Any) -> str:
    content = _get(result, "content")
    for block in _as_list(content):
        text = _get(block, "text")
        if isinstance(text, str):
            return text
    return content if isinstance(content, str) else ""


def _loads_object(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, str):
        return None
    try:
        parsed = json.loads(payload)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _number(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _finding_events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    categories = ("critical_risks", "moderate_risks", "cost_findings")
    selected = [item for key in categories for item in _as_list(payload.get(key))]
    if not selected and not any(key in payload for key in categories):
        selected = _as_list(payload.get("best_practices"))
    events: list[dict[str, Any]] = []
    for item in selected[:20]:
        if not isinstance(item, dict):
            continue
        confidence = item.get("confidence")
        data: dict[str, Any] = {
            "label": "issue",
            "value": item.get("resource_id") or item.get("aws_service") or "",
            "severity": item.get("severity", "info"),
        }
        if confidence is not None:
            data["confidence"] = confidence
        events.append(_event("finding", data))
    return events


def _scan_events(tool_name: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    if tool_name not in {"emfirge_scan", "emfirge_get_findings"}:
        return []
    events = _finding_events(payload)
    data: dict[str, Any] = {"state": "scanned", "cloud_writes": 0}
    for key in ("score", "security_score", "resources"):
        value = _number(payload.get(key))
        if value is not None:
            data[key] = value
    events.append(_event("status", data))
    return events


def _branch_diff_event(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    def value(*keys: str) -> Any:
        for key in keys:
            if key in payload:
                return payload[key]
        return 0

    before = _number(payload.get("score_before", payload.get("before_score")))
    after = _number(payload.get("score_after", payload.get("after_score")))
    delta = _number(payload.get("delta"))
    if delta is None and before is not None and after is not None:
        delta = after - before
    score = f"{before}->{after}"
    if delta is not None:
        score += f" (delta {delta:+g})"
    lines = [
        f"nodes +{value('added_nodes')} / -{value('removed_nodes')}",
        f"findings +{value('added_findings')} / -{value('removed_findings')}",
        f"score {score}",
        f"newly_internet_reachable: {_text(value('newly_internet_reachable'))}",
    ]
    return _event("diff", {"branch": session.active_branch, "text": "\n".join(lines)[:1000]})


def _branch_verdict_event(payload: dict[str, Any]) -> dict[str, Any]:
    verdict = str(payload.get("verdict", payload.get("status", ""))).lower()
    severity = {"pass": "info", "warn": "warning", "block": "critical"}.get(verdict, verdict or "info")
    data: dict[str, Any] = {"label": "summary", "value": "", "severity": severity}
    if payload.get("confidence") is not None:
        data["confidence"] = payload["confidence"]
    return _event("finding", data)


def _attack_paths_event(payload: dict) -> dict:
    return _event("attackpaths", {
        "paths": payload.get("paths", []),
        "critical_resources": payload.get("critical_resources", []),
    })


def _compliance_event(payload: dict) -> dict:
    fw = payload
    frameworks = payload.get("frameworks")
    if isinstance(frameworks, list) and frameworks:
        fw = frameworks[0]
    controls = fw.get("controls") if isinstance(fw.get("controls"), list) else []
    return _event("compliance", {
        "framework": "CIS AWS Foundations",
        "version": str(fw.get("version", "1.5")),
        "passed": _number(fw.get("passedControls")) or 0,
        "failed": _number(fw.get("failedControls")) or 0,
        "total": _number(fw.get("totalControls")) or 0,
        "controls": controls,
    })


def _before_after_event(payload: dict) -> dict:
    return _event("beforeafter", {
        "score_before": _number(payload.get("score_before")),
        "score_after": _number(payload.get("score_after")),
        "removed_findings": payload.get("removed_findings", []),
        "added_findings": payload.get("added_findings", []),
        "no_longer_internet_reachable": payload.get("no_longer_internet_reachable", []),
        "newly_internet_reachable": payload.get("newly_internet_reachable", []),
    })


def _decision_event(payload: dict) -> dict:
    verdict = str(payload.get("verdict", payload.get("status", ""))).lower()
    removed = [f for f in payload.get("native_removed", []) if str(f.get("severity", "")).lower() in {"critical", "high"}]
    return _event("decision", {
        "verdict": verdict,
        "removed_criticals": removed,
        "no_longer_internet_reachable": payload.get("no_longer_internet_reachable", []),
        "score_before": _number(payload.get("score_before")),
        "score_after": _number(payload.get("score_after")),
    })


def _demo_narrate(tool: str, payload: dict | None):
    p = payload or {}
    if tool == "set_connection": return ("-> assuming read-only role . us-east-1", "<- connected . 0 cloud writes")
    if tool == "emfirge_scan": return ("-> scanning live account...", "<- graph built . read-only")
    if tool == "emfirge_attack_paths":
        paths = p.get("paths", []); crit = sum(1 for x in paths if str(x.get("severity", "")).lower() == "critical")
        cr = p.get("critical_resources", []); jewel = cr[0].get("label") if cr else "-"
        return ("-> tracing attack paths...", f"<- {crit} critical . crown jewel {jewel}")
    if tool == "emfirge_check_compliance":
        fw = p; fr = p.get("frameworks")
        if isinstance(fr, list) and fr: fw = fr[0]
        return ("-> checking CIS AWS 1.5...", f"<- {fw.get('passedControls', 0)}/{fw.get('totalControls', 0)} pass . {fw.get('failedControls', 0)} fail")
    if tool == "emfirge_create_branch": return ("-> forking branch seal-ssh-sg", "<- branch ready")
    if tool == "emfirge_apply_change": return ("-> applying fix . restrict SSH on NAME_132", None)
    if tool == "emfirge_verify_fix": return ("-> verifying fix holds...", "<- fix verified")
    if tool == "emfirge_branch_diff":
        sealed = p.get("no_longer_internet_reachable", [])
        return ("-> diffing branch...", ("<- sealed " + ", ".join(sealed)) if sealed else "<- diff computed")
    if tool == "emfirge_branch_verdict":
        return ("-> re-running rules on branch...", f"<- verdict: {str(p.get('verdict', '')).lower()}")
    return (tool, None)


async def run_turn(prompt: str, session_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """Run an isolated read-only turn using the unified event schema."""
    session = get_session(session_id)
    if session is None:
        yield _event("error", {"message": "Session not found"})
        return

    if os.environ.get("KEPLER_DEMO") == "1":
        import asyncio
        from pathlib import Path
        fixture = json.loads((Path(__file__).parent / "demo_fixture.json").read_text())
        yield _event("status", {"state": "connected", "region": "us-east-1", "account": "000000000000", "cloud_writes": 0})
        await asyncio.sleep(0.3)
        for entry in fixture.get("tools", []):
            tool = entry.get("tool") or ""
            payload = entry.get("payload")
            call_line, result_line = _demo_narrate(tool, payload)
            if call_line:
                yield _event("activity", {"line": call_line})
                await asyncio.sleep(0.5)
            if payload is not None:
                if tool in ("emfirge_scan", "emfirge_get_findings"):
                    for ev in _scan_events(tool, payload):
                        yield ev
                elif tool == "emfirge_attack_paths":
                    yield _attack_paths_event(payload)
                elif tool == "emfirge_check_compliance":
                    yield _compliance_event(payload)
                elif tool == "emfirge_branch_diff":
                    yield _branch_diff_event(session, payload)
                    yield _before_after_event(payload)
                elif tool == "emfirge_branch_verdict":
                    yield _branch_verdict_event(payload)
                    yield _decision_event(payload)
            if result_line:
                yield _event("activity", {"line": result_line})
                await asyncio.sleep(0.5)
        reply = fixture.get("reply") or ""
        if reply:
            yield _event("token", {"text": reply})
        yield _event("status", {"state": "done", "cloud_writes": 0})
        return
    emitted_token = False
    connection_status_emitted = session.connected
    tool_names_by_id: dict[str, str] = {}
    processed_tool_results: set[str] = set()
    emitted_tool_use_ids: set[str] = set()
    try:
        # The client remains open for discovery, Agent construction, and streaming.
        with MCPClient(lambda: _server_parameters()) as mcp_client:
            discovered_tools = mcp_client.list_tools_sync()
            tool_names = [_tool_name(tool) for tool in discovered_tools]
            logger.info("MCP tools loaded: %s", json.dumps(tool_names, ensure_ascii=False))
            tools = [_connection_tool(session), *discovered_tools]
            active_prompt = SYSTEM_PROMPT
            if session.connected and session.role_arn and session.region:
                active_prompt += (
                    "\nActive connection: every emfirge_* call MUST use exactly role_arn="
                    f"{session.role_arn!r} and region={session.region!r}."
                )
            agent = Agent(model=_model(), tools=tools, system_prompt=active_prompt)
            async for raw in agent.stream_async(prompt):
                if not isinstance(raw, dict):
                    text = _text(raw)
                    if text:
                        emitted_token = True
                        yield _event("token", {"text": text})
                    continue
                for use in _tool_uses(raw):
                    use_id = _get(use, "toolUseId", _get(use, "tool_use_id"))
                    name = _get(use, "name")
                    if use_id and name:
                        tool_names_by_id[str(use_id)] = str(name)
                activity = _current_tool_activity(raw)
                if activity:
                    yield _event("activity", {"line": activity})
                for result_index, result in enumerate(_tool_results(raw)):
                    use_id = _get(result, "toolUseId", _get(result, "tool_use_id"))
                    result_key = f"{use_id}:{result_index}" if use_id else f"raw:{id(raw)}:{result_index}"
                    if result_key in processed_tool_results:
                        continue
                    processed_tool_results.add(result_key)
                    tool_name = tool_names_by_id.get(str(use_id), "") if use_id else ""
                    payload_text = _tool_result_payload(result)
                    payload = _loads_object(payload_text)
                    if str(_get(result, "status", "")).lower() == "error":
                        continue
                    if tool_name in {"emfirge_scan", "emfirge_get_findings", "emfirge_branch_diff", "emfirge_branch_verdict", "emfirge_attack_paths", "emfirge_check_compliance"}:
                        if payload is None:
                            continue
                        if tool_name in {"emfirge_scan", "emfirge_get_findings"}:
                            for emitted in _scan_events(tool_name, payload):
                                yield emitted
                            if use_id:
                                emitted_tool_use_ids.add(str(use_id))
                        elif tool_name == "emfirge_branch_diff":
                            yield _branch_diff_event(session, payload)
                            yield _before_after_event(payload)
                            if use_id:
                                emitted_tool_use_ids.add(str(use_id))
                        elif tool_name == "emfirge_branch_verdict":
                            yield _branch_verdict_event(payload)
                            yield _decision_event(payload)
                            if use_id:
                                emitted_tool_use_ids.add(str(use_id))
                        elif tool_name == "emfirge_attack_paths":
                            yield _attack_paths_event(payload)
                            if use_id:
                                emitted_tool_use_ids.add(str(use_id))
                        elif tool_name == "emfirge_check_compliance":
                            yield _compliance_event(payload)
                            if use_id:
                                emitted_tool_use_ids.add(str(use_id))
                if not connection_status_emitted and session.connected:
                    account = _account_from_role_arn(session.role_arn or "")
                    yield _event(
                        "status",
                        {
                            "state": "connected",
                            "region": session.region,
                            "account": account,
                            "cloud_writes": 0,
                        },
                    )
                    connection_status_emitted = True
                data = raw.get("data")
                if data:
                    text = _text(data)
                    emitted_token = True
                    yield _event("token", {"text": text})
                if "result" in raw and not emitted_token:
                    final_text = _result_text(raw)
                    if final_text:
                        emitted_token = True
                        yield _event("token", {"text": final_text})
            for message in agent.messages:
                for use in _tool_uses(message):
                    use_id = _get(use, "toolUseId", _get(use, "tool_use_id"))
                    name = _get(use, "name")
                    if use_id and name:
                        tool_names_by_id[str(use_id)] = str(name)
            for message in agent.messages:
                for result in _tool_results(message):
                    use_id = _get(result, "toolUseId", _get(result, "tool_use_id"))
                    tool_name = tool_names_by_id.get(str(use_id), "")
                    payload = _loads_object(_tool_result_payload(result))
                    if not use_id or str(use_id) in emitted_tool_use_ids:
                        continue
                    if str(_get(result, "status", "")).lower() == "error":
                        continue
                    if payload is None:
                        continue
                    if tool_name in {"emfirge_scan", "emfirge_get_findings"}:
                        for emitted in _scan_events(tool_name, payload):
                            yield emitted
                    elif tool_name == "emfirge_branch_diff":
                        yield _branch_diff_event(session, payload)
                        yield _before_after_event(payload)
                    elif tool_name == "emfirge_branch_verdict":
                        yield _branch_verdict_event(payload)
                        yield _decision_event(payload)
                    elif tool_name == "emfirge_attack_paths":
                        yield _attack_paths_event(payload)
                    elif tool_name == "emfirge_check_compliance":
                        yield _compliance_event(payload)
                    else:
                        continue
                    emitted_tool_use_ids.add(str(use_id))
            if not emitted_token:
                final_text = ""
                for message in reversed(agent.messages):
                    if _get(message, "role") != "assistant":
                        continue
                    text_parts = []
                    for block in _content(message):
                        text = _get(block, "text")
                        if text is not None:
                            text_parts.append(_text(text))
                    final_text = "".join(text_parts)
                    if final_text:
                        break
                if final_text:
                    emitted_token = True
                    yield _event("token", {"text": final_text})
                else:
                    logger.warning("no assistant text found in messages")
        yield _event("status", {"state": "done", "cloud_writes": 0})
    except Exception as exc:
        logger.exception("Agent turn failed")
        yield _event("error", {"message": str(exc)})
