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

from .tools.fs import (
    FileCreateTool, FileReadTool, FileEditTool, FileDeleteTool,
    DirectoryCreateTool, DirectoryDeleteTool, DirectoryListTool,
)
from .tools.todo import TodoAddTool, TodoListTool, TodoCompleteTool, TodoRemoveTool
from .tools.server import NPMInitTool, NPMStartTool, NPMStopTool, NPMStatusTool, NPMLogsTool
from .tools.supertest import SupertestInitTool, SupertestRunTool
from .tools.playwright import PlaywrightInitTool, PlaywrightRunTool


TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def all_tool_classes() -> List[type]:
    return [
        FileCreateTool, FileReadTool, FileEditTool, FileDeleteTool,
        DirectoryCreateTool, DirectoryDeleteTool, DirectoryListTool,
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
            return BedrockLanguageModel(model_name=model_name, api_key=api_key)
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

        prompt = f"""You are WAA (Web-App Agent), an autonomous software engineer. You build complete, working web applications inside a single working directory using the tools below. You work alone and nobody will answer questions, so make reasonable decisions yourself and keep going until the job is done.

# How to respond

Every response must do exactly ONE of the following:

1. **Call a tool.** Think briefly first, then emit exactly one tool call in this exact format:

<tool_call>{{"tool": "TOOL_NAME", "arguments": {{"arg1": "value1"}}}}</tool_call>

   - The content between the tags must be valid JSON (double quotes, escape newlines in strings as \\n).
   - One tool call per response. You will receive the result in the next message.

2. **Finish.** When the task is fully done and verified, respond with:

<terminate>

Never emit `<terminate>` and a tool call in the same response. If you respond with neither, you will simply be asked to continue, which wastes a turn.

# Thinking

Before each tool call, write one or two short sentences: what you learned from the last result and what you will do next. Keep it brief; the tool call is what matters.

# Available tools

{tool_docs}

# Strategy

1. **Plan first.** Read the instruction carefully. Use `todo.add` to break the work into concrete steps, then work through them, marking each with `todo.complete`.
2. **Initialize before coding.** Run `npm.init` first. If there are API tests run `supertest.init`; if there are UI tests run `playwright.init`. Do these once.
3. **Read the tests.** If test files exist under `tests/`, read them before writing code. They are the real spec: match element IDs, routes, status codes and response shapes exactly. Never modify provided tests or protected files.
4. **Structure files cleanly.** Backend in `index.js` (Express, port 3000). Frontend files in `public/` (or `views/` for Handlebars templates), with separate `.html`, `.css` and `.js` files. Keep code readable.
5. **Prefer `fs.edit` for small changes**, `fs.write` for new files or rewrites. Read a file before editing it so `old_text` matches exactly.
6. **Run and test.** Start the server with `npm.start`, check `npm.status` / `npm.logs` if something looks wrong, then run the tests. Fix failures and rerun until everything passes. Nodemon restarts the server on file changes, so you usually do not need to restart it.
7. **Handle errors calmly.** A failed tool call is information, not a disaster. Read the error, fix the cause, try again. Do not repeat the exact same failing call.
8. **Finish properly.** Only terminate when all required tests pass and the app matches the instruction. Stop the server with `npm.stop` before terminating. You have a limited number of turns, so do not waste them on unnecessary reads or restarts.
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
        return response

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
        return entry

    def run(self):
        self.initialize()
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
                        self.history.append(ToolCallResult(
                            "<parse_error>", {}, {"ok": False, "data": None, "error": str(e)}, str(e)))
                        continue
                    self.execute_tool(call)
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

    def _cleanup(self):
        """Best effort: make sure no dev server is left running."""
        if self.tool_registry and "npm.stop" in self.tool_registry.tools:
            try:
                self.tool_registry.get_tool("npm.stop").execute({})
            except Exception:
                pass
