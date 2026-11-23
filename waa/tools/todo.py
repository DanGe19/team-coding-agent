import json
from pathlib import Path
from typing import Dict, Any, List
from datetime import datetime

from ..tool import Tool, ToolArgument
from ..env import AgentEnvironment

def _ok(data: Any) -> Dict[str, Any]:
    return {"ok": True, "data": data, "error": None}


def _err(message: str) -> Dict[str, Any]:
    return {"ok": False, "data": None, "error": message}



class _TodoToolBase(Tool):
    """Common state and JSON persistence for all TODO tools."""

    def __init__(self, name: str):
        super().__init__(name)
        self.todo_path: Path = Path(".waa") / "todo.json"

    def initialize(self, env: AgentEnvironment):
        self.todo_path = Path(env.get_working_dir()) / ".waa" / "todo.json"

    def load_todos(self) -> List[Dict[str, Any]]:
        if not self.todo_path.exists():
            return []
        with open(self.todo_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []

    def save_todos(self, todos: List[Dict[str, Any]]):
        self.todo_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.todo_path, "w", encoding="utf-8") as f:
            json.dump(todos, f, indent=2)

    @staticmethod
    def find_todo(todos: List[Dict[str, Any]], todo_id: int) -> Dict[str, Any]:
        for todo in todos:
            if todo["id"] == todo_id:
                return todo
        return None


class TodoAddTool(_TodoToolBase):
    def __init__(self):
        super().__init__("todo.add")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "description", "A short description of the task to do", True, str))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`todo.add` - Add a new TODO item to track a task. The item gets a unique integer \
`id` and starts with status "pending". Use this at the beginning to break the job into steps. \
Arguments: `description` (string, required)."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            description = input["description"]
            if not isinstance(description, str) or not description.strip():
                return _err("description must be a non-empty string")

            todos = self.load_todos()
            next_id = max((t["id"] for t in todos), default=0) + 1
            todo = {
                "id": next_id,
                "description": description.strip(),
                "status": "pending",
                "created_at": datetime.now().isoformat(),
            }
            todos.append(todo)
            self.save_todos(todos)
            return _ok({"todo": todo, "message": f"Added TODO #{next_id}"})
        except Exception as e:
            return _err(str(e))

class TodoListTool(_TodoToolBase):
    VALID_STATUS = ("all", "pending", "completed")

    def __init__(self):
        super().__init__("todo.list")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "status", 'Filter by status: "pending", "completed", or "all" (default)', False, str))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`todo.list` - List TODO items. Returns the matching items and their count. \
Arguments: `status` (string, optional) - "pending", "completed", or "all" (default). \
Use this to review what is left to do before deciding the next step."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            status = input.get("status", "all")
            if status not in self.VALID_STATUS:
                return _err(f"Invalid status '{status}'. Use one of: {', '.join(self.VALID_STATUS)}")

            todos = self.load_todos()
            if status != "all":
                todos = [t for t in todos if t["status"] == status]
            return _ok({"todos": todos, "count": len(todos), "filter": status})
        except Exception as e:
            return _err(str(e))

class TodoCompleteTool(_TodoToolBase):
    def __init__(self):
        super().__init__("todo.complete")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "id", "The integer id of the TODO item to mark as completed", True, int))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`todo.complete` - Mark a TODO item as completed by its `id`. \
Records the completion time. Arguments: `id` (integer, required). \
Fails if no item with that id exists."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            todo_id = input["id"]
            todos = self.load_todos()
            todo = self.find_todo(todos, todo_id)
            if todo is None:
                return _err(f"TODO #{todo_id} not found")
            if todo["status"] == "completed":
                return _ok({"todo": todo, "message": f"TODO #{todo_id} was already completed"})
            todo["status"] = "completed"
            todo["completed_at"] = datetime.now().isoformat()
            self.save_todos(todos)
            return _ok({"todo": todo, "message": f"Completed TODO #{todo_id}"})
        except Exception as e:
            return _err(str(e))

class TodoRemoveTool(_TodoToolBase):
    def __init__(self):
        super().__init__("todo.remove")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "id", "The integer id of the TODO item to remove", True, int))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`todo.remove` - Remove a TODO item by its `id` (for example a task that is no \
longer needed). Arguments: `id` (integer, required). Fails if no item with that id exists."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            todo_id = input["id"]
            todos = self.load_todos()
            todo = self.find_todo(todos, todo_id)
            if todo is None:
                return _err(f"TODO #{todo_id} not found")
            todos = [t for t in todos if t["id"] != todo_id]
            self.save_todos(todos)
            return _ok({"removed": todo, "remaining": len(todos), "message": f"Removed TODO #{todo_id}"})
        except Exception as e:
            return _err(str(e))