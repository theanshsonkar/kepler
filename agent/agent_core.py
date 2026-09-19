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
ALLOWED_EVENT_TYPES = {"token", "activity", "finding", "diff", "decision", "status", "error"}
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
    return _text(result)


async def run_turn(prompt: str, session_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """Run an isolated read-only turn using the unified event schema."""
    session = get_session(session_id)
    if session is None:
        yield _event("error", {"message": "Session not found"})
        return

    emitted_token = False
    connection_status_emitted = session.connected
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
                activity = _current_tool_activity(raw)
                if activity:
                    yield _event("activity", {"line": activity})
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
        yield _event("status", {"state": "done", "cloud_writes": 0})
    except Exception as exc:
        logger.exception("Agent turn failed")
        yield _event("error", {"message": str(exc)})
