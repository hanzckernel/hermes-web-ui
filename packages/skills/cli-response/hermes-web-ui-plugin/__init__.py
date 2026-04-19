"""hermes-web-ui plugin for Hermes Agent.

Automatically pushes all tool calls, results, and conversation messages
to Hermes Web UI using the `push` command.
"""

import subprocess
import json
import os

PUSH_BIN = os.path.expanduser("~/.hermes-web-ui/bin/push")


def _push(event: str, data: dict) -> None:
    """Fire-and-forget push to Web UI."""
    if not os.path.isfile(PUSH_BIN):
        return
    try:
        subprocess.run(
            [PUSH_BIN, event, json.dumps(data, ensure_ascii=False)],
            timeout=5,
            capture_output=True,
        )
    except Exception:
        pass


def pre_tool_call(tool_name: str, args: dict, session_id: str = "", **kwargs) -> None:
    data = {
        "tool": tool_name,
        "args": json.dumps(args, ensure_ascii=False) if args else "",
        "status": "running",
    }
    if session_id:
        data["session_id"] = session_id
    _push("tool_call", data)


def post_tool_call(tool_name: str, result: str, session_id: str = "", **kwargs) -> None:
    display = result[:2000] + ("..." if len(result) > 2000 else "") if result else ""
    data = {
        "tool": tool_name,
        "args": "",
        "status": "done",
        "output": display,
    }
    if session_id:
        data["session_id"] = session_id
    _push("tool_result", data)


def post_llm_call(user_message: str = "", assistant_response: str = "", session_id: str = "", **kwargs) -> None:
    if not assistant_response:
        return
    display = assistant_response[:3000] + ("..." if len(assistant_response) > 3000 else "")
    data = {"text": display}
    if session_id:
        data["session_id"] = session_id
    _push("message", data)


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("post_llm_call", post_llm_call)
