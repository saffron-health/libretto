#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any


def to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return to_jsonable(model_dump())
    dict_method = getattr(value, "dict", None)
    if callable(dict_method):
        return to_jsonable(dict_method())
    return str(value)


async def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--max-steps", type=int, default=40)
    parser.add_argument("--cdp-url")
    args = parser.parse_args()
    task = Path(args.task_file).read_text(encoding="utf8")

    try:
        from browser_use import Agent, Browser, ChatOpenAI
    except Exception as error:
        message = (
            "Browser Use is not installed for this Python. Install it with "
            "`python3 -m pip install browser-use` or set BROWSER_USE_EVAL_PYTHON "
            "to a Python executable that can import browser_use."
        )
        Path(args.output).write_text(
            json.dumps(
                {
                    "task": task,
                    "model": args.model,
                    "error": f"{message} Original error: {type(error).__name__}: {error}",
                    "history": None,
                    "usage_summary": None,
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf8",
        )
        print(message, file=sys.stderr)
        sys.exit(1)

    cwd = Path(args.cwd)
    if args.cdp_url:
        browser = Browser(cdp_url=args.cdp_url)
    else:
        profile_dir = cwd / ".browser-use-profile"
        profile_dir.mkdir(parents=True, exist_ok=True)
        browser = Browser(
            headless=True,
            user_data_dir=str(profile_dir),
            chromium_sandbox=False,
            enable_default_extensions=False,
            args=["--no-sandbox"],
        )
    llm = ChatOpenAI(model=args.model)
    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        calculate_cost=True,
    )

    history = None
    usage_summary = None
    error = None
    try:
        history = await agent.run(max_steps=args.max_steps)
        token_cost_service = getattr(agent, "token_cost_service", None)
        get_usage_summary = getattr(token_cost_service, "get_usage_summary", None)
        if callable(get_usage_summary):
            usage_summary = await get_usage_summary()
    except Exception as run_error:
        error = f"{type(run_error).__name__}: {run_error}"
    finally:
        close_agent = getattr(agent, "close", None)
        if callable(close_agent):
            await close_agent()
        else:
            stop_browser = getattr(browser, "stop", None)
            if callable(stop_browser):
                await stop_browser()

    result = {
        "task": task,
        "model": args.model,
        "error": error,
        "history": None,
        "usage_summary": to_jsonable(usage_summary),
    }
    if history is not None:
        result["history"] = {
            "final_result": to_jsonable(history.final_result()),
            "is_done": to_jsonable(history.is_done()),
            "is_successful": to_jsonable(history.is_successful()),
            "has_errors": to_jsonable(history.has_errors()),
            "number_of_steps": to_jsonable(history.number_of_steps()),
            "total_duration_seconds": to_jsonable(
                history.total_duration_seconds()
            ),
            "urls": to_jsonable(history.urls()),
            "action_names": to_jsonable(history.action_names()),
            "action_history": to_jsonable(history.action_history()),
            "extracted_content": to_jsonable(history.extracted_content()),
            "errors": to_jsonable(history.errors()),
            "usage": to_jsonable(getattr(history, "usage", None)),
        }

    Path(args.output).write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf8",
    )
    if error:
        print(error, file=sys.stderr)
        sys.exit(1)


asyncio.run(run())
