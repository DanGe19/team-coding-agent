import os
import re
from typing import Dict, Any, List, Optional
from pathlib import Path
import json

from .llm import LanguageModel, BedrockLanguageModel, MockLanguageModel
from .tool import ToolRegistry, Tool
from .history import HistoryEntry, SystemPrompt, UserInstruction, LLMResponse, ToolCallResult
from .logger import Logger
from .env import AgentEnvironment
from .events import EventLog

from .tools.fs import (
    FileCreateTool, FileReadTool, FileEditTool, FileDeleteTool,
    DirectoryCreateTool, DirectoryDeleteTool, DirectoryListTool, DirectoryTreeTool,
)
from .tools.todo import TodoAddTool, TodoListTool, TodoCompleteTool, TodoRemoveTool
from .tools.server import NPMInitTool, NPMStartTool, NPMStopTool, NPMStatusTool, NPMLogsTool
from .tools.supertest import SupertestInitTool, SupertestRunTool
from .tools.playwright import PlaywrightInitTool, PlaywrightRunTool


TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def all_tool_classes() -> List[type]:
    return [
        FileCreateTool, FileReadTool, FileEditTool, FileDeleteTool,
        DirectoryCreateTool, DirectoryDeleteTool, DirectoryListTool, DirectoryTreeTool,
        TodoAddTool, TodoListTool, TodoCompleteTool, TodoRemoveTool,
        NPMInitTool, NPMStartTool, NPMStopTool, NPMStatusTool, NPMLogsTool,
        SupertestInitTool, SupertestRunTool,
        PlaywrightInitTool, PlaywrightRunTool,
    ]


class Agent:
    working_dir: Path
    llm: LanguageModel
    tool_registry: ToolRegistry
    config: Dict[str, Any]
    max_turns: int
    history: List[HistoryEntry]
    logger: Logger
    env: AgentEnvironment
    debug: bool

    def __init__(
        self,
        working_dir: Path,
        debug: bool = False,
        *,
        role: Optional[str] = None,
        system_prompt: Optional[str] = None,
        instruction: Optional[str] = None,
        allowed_tools: Optional[List[str]] = None,
        max_turns: Optional[int] = None,
        log_name: Optional[str] = None,
        llm: Optional[LanguageModel] = None,
    ):
        """
        Plain HW3 usage: Agent(working_dir).run()

        Team usage (see waa/team.py): the keyword arguments turn this agent into a
        single role. Each override replaces what would otherwise be read from
        .waa/config.json / .waa/instruction.md:
          role           label used in logs ("planner", "coder", "reviewer")
          system_prompt  replaces the default WAA system prompt
          instruction    replaces .waa/instruction.md
          allowed_tools  replaces config "allowed_tools"
          max_turns      replaces config "max_turns"
          log_name       write to .waa/logs/<log_name>.log instead of .waa/agent.log
                         (and allow overwriting it)
          llm            reuse an existing LanguageModel instead of creating one
        """
        self.working_dir = working_dir
        self.config = None
        self.debug = debug
        self.llm = llm
        self.tool_registry = None
        self.max_turns = 0
        self.history = []
        self.logger = None
        self.env = None

        self.role = role
        self._system_prompt_override = system_prompt
        self._instruction_override = instruction
        self._allowed_tools_override = allowed_tools
        self._max_turns_override = max_turns
        self._log_name = log_name
        self.task_id: Optional[int] = None
        self.round: Optional[int] = None
        self.events: Optional[EventLog] = None

    # ------------------------------------------------------------------ setup

    def initialize_environment(self):
        config_path = self.working_dir / ".waa" / "config.json"
        if not config_path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")

        with open(config_path, 'r') as f:
            self.config = json.load(f)

        self.env = AgentEnvironment(self.working_dir, self.config)
        self.max_turns = self.env.get_config_value("max_turns", 50)
        if self._max_turns_override is not None:
            self.max_turns = self._max_turns_override

    def initialize_llm(self):
        llm_type = self.config.get("llm_type", "mock")
        if llm_type == "bedrock":
            model_name = self.config.get("model", "us.anthropic.claude-sonnet-4-6")
            api_key = self.config.get("api_key", os.getenv("AWS_BEARER_TOKEN_BEDROCK"))
            return BedrockLanguageModel(model_name=model_name, api_key=api_key,
                                        pricing=self.config.get("pricing"))
        elif llm_type == "mock":
            responses = self.config.get("mock_responses")
            return MockLanguageModel(responses=responses)
        else:
            raise ValueError(f"Unknown llm_type: {llm_type}. Use 'bedrock' or 'mock'.")

    def initialize_logger(self):
        if self._log_name:
            log_path = self.working_dir / ".waa" / "logs" / f"{self._log_name}.log"
        else:
            log_path = self.working_dir / ".waa" / "agent.log"
            if log_path.exists():
                raise RuntimeError(f"Log file already exists: {log_path}. Remove it to start a new run.")

        self.logger = Logger(log_path, self.debug)
        self.logger.log("Agent initialization started")
        if self.role:
            self.logger.log(f"Role: {self.role}")
        self.events = EventLog(self.working_dir)
        self.logger.log(f"Working directory: {self.working_dir}")
        self.logger.log(f"Debug mode: {self.debug}")
        self.logger.log(f"Max turns: {self.max_turns}")

    def initialize_tool_registry(self):
        self.tool_registry = ToolRegistry()
        allowed_tools = self.env.get_config_value("allowed_tools", None)
        if self._allowed_tools_override is not None:
            allowed_tools = self._allowed_tools_override
        for cls in all_tool_classes():
            tool: Tool = cls()
            if allowed_tools is not None and tool.name not in allowed_tools:
                continue
            tool.initialize(self.env)
            self.tool_registry.register_tool(tool)
        names = [t.name for t in self.tool_registry.list_tools()]
        self.logger.log(f"Registered tools: {', '.join(names) if names else '(none)'}")

    # ---------------------------------------------------------------- prompts

    def emit(self, type: str, **data):
        if self.events is not None:
            self.events.emit(type, role=self.role or "agent", task_id=self.task_id,
                             round=self.round, data=data)

    def tool_docs(self) -> str:
        tools = self.tool_registry.list_tools()
        return "\n\n".join(f"- {t.description()}" for t in tools) if tools else "(no tools available)"

    def load_system_prompt(self):
        if self._system_prompt_override is not None:
            prompt = self._system_prompt_override.replace("{TOOL_DOCS}", self.tool_docs())
            self.history.append(SystemPrompt(prompt))
            self.logger.log_system_prompt(prompt)
            return

        tool_docs = self.tool_docs()

        prompt = f"""You are WAA (Web-App Agent), an autonomous coding agent that builds web \
applications using Node.js and Express. You work inside a single project directory and \
interact with the world ONLY through the tools listed below.

## Tool Calling Protocol

To call a tool, output exactly one block in this format:

<tool_call>{{"tool": "TOOL_NAME", "arguments": {{"arg1": "value1", "arg2": "value2"}}}}</tool_call>

Rules:
- The content inside <tool_call> must be valid JSON with keys "tool" and "arguments".
- "arguments" must always be present, even if empty: {{}}.
- Emit EXACTLY ONE <tool_call> per response, and END your response immediately after the
  closing </tool_call> tag. Do not write anything after it.
- You will receive the real result of that tool call in the next message. NEVER predict,
  assume, or write out what a tool result will be. Never describe actions you have not
  yet performed as if they were done.
- Do not plan more than one step ahead in a single response. Think -> one tool call -> stop.
- Never write the literal text <terminate> unless you are actually finishing. Mentioning it
  in a plan will end the session immediately.
- Do not wrap the tool call in markdown code fences.
- File paths are always relative to the project root.

## Termination Protocol

When the task is fully complete (or cannot be completed), output:

<terminate>

Only terminate after you have verified your work (e.g. the server starts and the tests pass).

## Thinking Protocol

Before each tool call, briefly explain in one or two sentences what you have learned \
so far and why you are taking the next step. Keep this short. Then output the tool call.

## Available Tools

{tool_docs}

## High-Level Strategy

1. Read the user instruction carefully and inspect existing files (fs.ls, fs.read), \
especially any provided tests - they define exactly what must work.
2. Break the task into steps with todo.add, and mark them with todo.complete as you go.
3. Initialize the project first with npm.init before writing server code.
4. Keep a clean structure: index.js for the Express server, and a public/ folder \
(or the layout the instruction asks for) for index.html, style.css and script.js.
5. Write complete files with fs.write; use fs.edit for small targeted changes.
6. Start the server with npm.start, check npm.status and npm.logs, and fix errors.
7. Set up and run the tests (supertest.init / supertest.run for API tests, \
playwright.init / playwright.run for UI tests). Read failures carefully and iterate.
8. Never modify protected files such as the tests or the .waa configuration.
9. When everything works, stop the server with npm.stop and output <terminate>.
"""

        self.history.append(SystemPrompt(prompt))
        self.logger.log_system_prompt(prompt)

    def load_instruction(self):
        if self._instruction_override is not None:
            instruction = self._instruction_override
        else:
            instruction_path = self.working_dir / ".waa" / "instruction.md"
            if not instruction_path.exists():
                raise FileNotFoundError(f"Instruction file not found: {instruction_path}")
            instruction = instruction_path.read_text(encoding="utf-8")
        self.history.append(UserInstruction(instruction))
        self.logger.log_user_instruction(instruction)

    def initialize(self):
        self.initialize_environment()
        if self.llm is None:
            self.llm = self.initialize_llm()
        self.initialize_logger()
        self.initialize_tool_registry()

        self.load_system_prompt()
        self.load_instruction()

    # ------------------------------------------------------------------- loop

    def build_messages(self) -> List[Dict[str, Any]]:
        messages = []
        for entry in self.history:
            content = entry.get_content()
            if not isinstance(content, str):
                content = json.dumps(content)
            messages.append({"role": entry.role, "content": content})
        return messages

    def query_llm(self, turn: int) -> LLMResponse:
        messages = self.build_messages()
        self.logger.log_llm_query(turn, len(messages))
        self.emit("llm_query", turn=turn, message_count=len(messages))
        try:
            text = self.llm.generate(messages)
        except Exception as e:
            self.logger.log_error("LLM query failed", e)
            raise
        if text is None:
            text = ""
        response = LLMResponse(text)
        self.history.append(response)
        self.logger.log_llm_response(turn, text)
        last = getattr(self.llm, "usage", None) and self.llm.usage.last
        if last:
            self.logger.log(
                f"    usage: in={last['input_tokens']} out={last['output_tokens']} "
                f"latency={last['latency_ms']}ms cost~${last['cost_usd']}", "DEBUG")
        self.emit("llm_response", turn=turn, text=text,
                  is_tool_call=response.is_tool_call(), is_termination=response.is_termination(),
                  usage=last or {})
        return response

    def usage_report(self) -> Dict[str, Any]:
        """Tokens, latency and estimated cost consumed by THIS agent run."""
        if not hasattr(self.llm, "usage"):
            return {}
        return self.llm.usage.diff(self._usage_start)

    @staticmethod
    def parse_tool_call(text: str) -> Dict[str, Any]:
        """Extract the first <tool_call>...</tool_call> block and parse it as JSON.
        Raises ValueError on malformed input."""
        match = TOOL_CALL_RE.search(text)
        if not match:
            raise ValueError("No <tool_call> block found")
        raw = match.group(1).strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.DOTALL).strip()
        try:
            call = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"Tool call is not valid JSON: {e}")
        if not isinstance(call, dict) or "tool" not in call:
            raise ValueError("Tool call must be a JSON object with a 'tool' field")
        call.setdefault("arguments", {})
        if not isinstance(call["arguments"], dict):
            raise ValueError("'arguments' must be a JSON object")
        return call

    def execute_tool(self, tool_call: Dict[str, Any]) -> ToolCallResult:
        tool_name = tool_call.get("tool", "")
        arguments = tool_call.get("arguments", {}) or {}
        self.logger.log_tool_call(tool_name, arguments)
        self.emit("tool_call", tool=tool_name, arguments=arguments)

        error: Optional[str] = None
        result: Dict[str, Any]
        try:
            if tool_name not in self.tool_registry.tools:
                available = ", ".join(sorted(self.tool_registry.tools.keys()))
                raise KeyError(f"Unknown tool '{tool_name}'. Available tools: {available}")
            tool = self.tool_registry.get_tool(tool_name)
            tool.schema.validate(arguments)
            result = tool.execute(arguments)
            if not isinstance(result, dict) or "ok" not in result:
                result = {"ok": True, "data": result, "error": None}
            if not result.get("ok"):
                error = result.get("error") or "Tool reported failure"
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
            result = {"ok": False, "data": None, "error": error}

        entry = ToolCallResult(tool_name, arguments, result, error)
        self.history.append(entry)
        self.logger.log_tool_result(tool_name, result, error)
        self.emit("tool_result", tool=tool_name, ok=bool(result.get("ok")), error=error,
                  result=self._compact_result(tool_name, result))
        if tool_name in ("supertest.run", "playwright.run"):
            data = (result.get("data") or {}) if isinstance(result, dict) else {}
            self.emit("test_result", tool=tool_name, test_file=data.get("test_file"),
                      passed=bool(data.get("passed")), summary=data.get("summary") or {})
        return entry

    @staticmethod
    def _compact_result(tool_name: str, result: Dict[str, Any]) -> Dict[str, Any]:
        """Keep events readable: drop bulky stdout/content, keep the useful fields."""
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, dict):
            return {"data": data}
        keep = {}
        for k, v in data.items():
            if k in ("content", "stdout", "stderr", "logs", "install_stdout", "browsers_stdout"):
                keep[k + "_len"] = len(str(v))
            else:
                keep[k] = v
        return keep

    def run(self):
        self.initialize()
        self._usage_start = self.llm.usage.snapshot() if hasattr(self.llm, "usage") else {}
        self.emit("run_start", max_turns=self.max_turns,
                  tools=[t.name for t in self.tool_registry.list_tools()])
        turn = 0
        terminated = False
        try:
            for turn in range(1, self.max_turns + 1):
                response = self.query_llm(turn)

                if response.is_termination():
                    terminated = True
                    self.logger.log_termination(turn, "Agent terminated")
                    break

                if response.is_tool_call():
                    try:
                        call = self.parse_tool_call(response.response)
                    except ValueError as e:
                        self.logger.log_warning(f"Malformed tool call: {e}")
                        self.emit("parse_error", error=str(e))
                        self.history.append(ToolCallResult(
                            "<parse_error>", {}, {"ok": False, "data": None, "error": str(e)}, str(e)))
                        continue
                    entry = self.execute_tool(call)
                    n_calls = len(TOOL_CALL_RE.findall(response.response))
                    if n_calls > 1:
                        # HW3 behaviour: run only the first call, tell the model about the rest.
                        self.logger.log_warning(f"LLM emitted {n_calls} tool calls; executed only the first")
                        if isinstance(entry.result, dict):
                            entry.result["agent_note"] = (
                                f"WARNING: your response contained {n_calls} <tool_call> blocks. Only the FIRST "
                                f"was executed; the other {n_calls - 1} were ignored. Emit exactly ONE tool call "
                                f"per response, then stop and wait for its result.")
                    continue

                # Plain message: nudge the model to act.
                self.logger.log_warning("Response contained neither a tool call nor <terminate>")
                self.history.append(UserInstruction(
                    "Your last response had no <tool_call> and no <terminate>. "
                    "Please either call a tool or terminate."))

            if not terminated:
                self.logger.log_termination(turn, f"Max turns ({self.max_turns}) reached")
        finally:
            self._cleanup()
            self._write_usage(turn, terminated)

    def _write_usage(self, turns: int, terminated: bool):
        """Append this run's usage to .waa/usage.json (one entry per agent run)."""
        try:
            report = self.usage_report()
            if not report:
                return
            report.update({"role": self.role or "agent", "log": self._log_name or "agent",
                           "turns": turns, "terminated": terminated})
            self.emit("run_end", turns=turns, terminated=terminated, usage=report)
            self.logger.log(
                f"USAGE: calls={report['calls']} tokens={report['total_tokens']} "
                f"(in {report['input_tokens']} / out {report['output_tokens']}) "
                f"cost~${report['cost_usd']}")
            path = self.working_dir / ".waa" / "usage.json"
            entries = []
            if path.exists():
                try:
                    entries = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    entries = []
            entries.append(report)
            path.write_text(json.dumps(entries, indent=2), encoding="utf-8")
        except Exception as e:
            if self.logger:
                self.logger.log_warning(f"Could not write usage: {e}")

    def _cleanup(self):
        """Best effort: make sure no dev server is left running."""
        if self.tool_registry and "npm.stop" in self.tool_registry.tools:
            try:
                self.tool_registry.get_tool("npm.stop").execute({})
            except Exception:
                pass
