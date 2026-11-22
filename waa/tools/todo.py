import json
from pathlib import Path
from typing import Dict, Any, List
from datetime import datetime

from ..tool import Tool, ToolArgument
from ..env import AgentEnvironment


class _TodoBase(Tool):
    """Shared storage helpers. The list lives in `.waa/todo.json` as a JSON array."""

    def __init__(self, name: str):
        super().__init__(name)
        self.todo_path: Path = Path(".waa/todo.json")

    def initialize(self, env: AgentEnvironment):
        self.todo_path = Path(env.get_working_dir()) / ".waa" / "todo.json"

    def _load(self) -> List[Dict[str, Any]]:
        if not self.todo_path.exists():
            return []
        try:
            data = json.loads(self.todo_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _save(self, todos: List[Dict[str, Any]]):
        self.todo_path.parent.mkdir(parents=True, exist_ok=True)
        self.todo_path.write_text(json.dumps(todos, indent=2), encoding="utf-8")

    @staticmethod
    def _ok(data: Any) -> Dict[str, Any]:
        return {"ok": True, "data": data, "error": None}

    @staticmethod
    def _err(msg: str) -> Dict[str, Any]:
        return {"ok": False, "data": None, "error": msg}


class TodoAddTool(_TodoBase):
    def __init__(self):
        super().__init__("todo.add")
        self.schema.register_argument(ToolArgument("description", "What needs to be done", True, str))

    def description(self) -> str:
        return """`todo.add` - Add a TODO item. Arguments: `description` (string). \
Returns the new item with its `id`. Use TODOs to plan a task before coding and to track progress."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            desc = input.get("description")
            if not isinstance(desc, str) or not desc.strip():
                return self._err("description is required")
            todos = self._load()
            next_id = max((t.get("id", 0) for t in todos), default=0) + 1
            item = {
                "id": next_id,
                "description": desc.strip(),
                "status": "pending",
                "created_at": datetime.now().isoformat(),
            }
            todos.append(item)
            self._save(todos)
            return self._ok({"todo": item, "count": len(todos), "message": f"Added TODO #{next_id}"})
        except Exception as e:
            return self._err(str(e))


class TodoListTool(_TodoBase):
    def __init__(self):
        super().__init__("todo.list")
        self.schema.register_argument(ToolArgument("status", "Filter: 'pending', 'completed' or 'all' (default)", False, str))

    def description(self) -> str:
        return """`todo.list` - List TODO items. Arguments: `status` (optional: "pending", "completed", or "all"). \
Returns `todos` and `count`."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            status = input.get("status", "all") or "all"
            if status not in ("pending", "completed", "all"):
                return self._err(f"Invalid status '{status}'; use pending, completed or all")
            todos = self._load()
            if status != "all":
                todos = [t for t in todos if t.get("status") == status]
            return self._ok({"todos": todos, "count": len(todos), "status": status})
        except Exception as e:
            return self._err(str(e))


class TodoCompleteTool(_TodoBase):
    def __init__(self):
        super().__init__("todo.complete")
        self.schema.register_argument(ToolArgument("id", "ID of the TODO to mark completed", True, int))

    def description(self) -> str:
        return """`todo.complete` - Mark a TODO as completed. Arguments: `id` (integer)."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            todo_id = input["id"]
            todos = self._load()
            for t in todos:
                if t.get("id") == todo_id:
                    t["status"] = "completed"
                    t["completed_at"] = datetime.now().isoformat()
                    self._save(todos)
                    return self._ok({"todo": t, "message": f"Completed TODO #{todo_id}"})
            return self._err(f"TODO #{todo_id} not found")
        except Exception as e:
            return self._err(str(e))


class TodoRemoveTool(_TodoBase):
    def __init__(self):
        super().__init__("todo.remove")
        self.schema.register_argument(ToolArgument("id", "ID of the TODO to remove", True, int))

    def description(self) -> str:
        return """`todo.remove` - Remove a TODO item. Arguments: `id` (integer)."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            todo_id = input["id"]
            todos = self._load()
            remaining = [t for t in todos if t.get("id") != todo_id]
            if len(remaining) == len(todos):
                return self._err(f"TODO #{todo_id} not found")
            self._save(remaining)
            return self._ok({"removed_id": todo_id, "count": len(remaining), "message": f"Removed TODO #{todo_id}"})
        except Exception as e:
            return self._err(str(e))
