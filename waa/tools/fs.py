import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional

from ..tool import Tool, ToolArgument
from ..env import AgentEnvironment


class _FSBase(Tool):
    """Shared helpers for all file-system tools: path safety and protected files."""

    def __init__(self, name: str):
        super().__init__(name)
        self.main_folder: Path = Path(".")
        self.protected_files: List[str] = []

    def initialize(self, env: AgentEnvironment):
        self.main_folder = Path(env.get_working_dir()).resolve()
        self.protected_files = env.get_config_value("protected_files", []) or []

    def _resolve(self, rel_path: str) -> Path:
        """Resolve a path relative to the working directory.
        Raises ValueError if it escapes the working directory."""
        full = (self.main_folder / rel_path).resolve()
        if full != self.main_folder and self.main_folder not in full.parents:
            raise ValueError(f"Path '{rel_path}' is outside the working directory")
        return full

    def _is_protected(self, full: Path) -> bool:
        for p in self.protected_files:
            try:
                if (self.main_folder / p).resolve() == full:
                    return True
            except Exception:
                continue
        return False

    @staticmethod
    def _ok(data: Any) -> Dict[str, Any]:
        return {"ok": True, "data": data, "error": None}

    @staticmethod
    def _err(msg: str) -> Dict[str, Any]:
        return {"ok": False, "data": None, "error": msg}


class FileCreateTool(_FSBase):
    def __init__(self):
        super().__init__("fs.write")
        self.schema.register_argument(ToolArgument("path", "Path of the file to write, relative to the working directory", True, str))
        self.schema.register_argument(ToolArgument("content", "Full text content to write into the file", True, str))

    def description(self) -> str:
        return """`fs.write` - Create or overwrite a file with the given content. \
Parent directories are created automatically. \
Arguments: `path` (string, relative path), `content` (string, full file content). \
Use this to create new files or completely replace a file. For small changes prefer `fs.edit`."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            if self._is_protected(full):
                return self._err(f"File '{input['path']}' is protected and cannot be written")
            full.parent.mkdir(parents=True, exist_ok=True)
            content = input["content"]
            full.write_text(content, encoding="utf-8")
            return self._ok({
                "path": input["path"],
                "size": len(content.encode("utf-8")),
                "lines": content.count("\n") + (1 if content and not content.endswith("\n") else 0),
                "message": f"Wrote {input['path']}",
            })
        except Exception as e:
            return self._err(str(e))


class FileDeleteTool(_FSBase):
    def __init__(self):
        super().__init__("fs.delete")
        self.schema.register_argument(ToolArgument("path", "Path of the file to delete", True, str))

    def description(self) -> str:
        return """`fs.delete` - Delete a single file. Arguments: `path` (string). \
Fails if the file does not exist, is a directory, or is protected."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            if self._is_protected(full):
                return self._err(f"File '{input['path']}' is protected and cannot be deleted")
            if not full.exists():
                return self._err(f"File '{input['path']}' does not exist")
            if full.is_dir():
                return self._err(f"'{input['path']}' is a directory; use fs.rmdir")
            full.unlink()
            return self._ok({"path": input["path"], "message": f"Deleted {input['path']}"})
        except Exception as e:
            return self._err(str(e))


class FileReadTool(_FSBase):
    def __init__(self):
        super().__init__("fs.read")
        self.schema.register_argument(ToolArgument("path", "Path of the file to read", True, str))

    def description(self) -> str:
        return """`fs.read` - Read a text file. Arguments: `path` (string). \
Returns `content`, `size` (bytes) and `lines`. Use it before editing a file so your `old_text` matches exactly."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            if not full.exists():
                return self._err(f"File '{input['path']}' does not exist")
            if full.is_dir():
                return self._err(f"'{input['path']}' is a directory; use fs.ls")
            content = full.read_text(encoding="utf-8")
            return self._ok({
                "path": input["path"],
                "content": content,
                "size": full.stat().st_size,
                "lines": len(content.splitlines()),
            })
        except Exception as e:
            return self._err(str(e))


class FileEditTool(_FSBase):
    def __init__(self):
        super().__init__("fs.edit")
        self.schema.register_argument(ToolArgument("path", "Path of the file to edit", True, str))
        self.schema.register_argument(ToolArgument("old_text", "Exact text to find (first occurrence is replaced)", True, str))
        self.schema.register_argument(ToolArgument("new_text", "Replacement text", True, str))

    def description(self) -> str:
        return """`fs.edit` - Find-and-replace inside a file. Replaces the FIRST occurrence of `old_text` with `new_text`. \
Arguments: `path`, `old_text`, `new_text` (all strings). \
`old_text` must match exactly (including whitespace), so read the file first. \
Fails if the text is not found or the file is protected."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            if self._is_protected(full):
                return self._err(f"File '{input['path']}' is protected and cannot be edited")
            if not full.exists() or full.is_dir():
                return self._err(f"File '{input['path']}' does not exist")
            content = full.read_text(encoding="utf-8")
            old, new = input["old_text"], input["new_text"]
            idx = content.find(old)
            if idx < 0:
                return self._err(f"old_text not found in '{input['path']}'")
            content = content[:idx] + new + content[idx + len(old):]
            full.write_text(content, encoding="utf-8")
            return self._ok({
                "path": input["path"],
                "occurrences_remaining": content.count(old) if old else 0,
                "message": f"Edited {input['path']}",
            })
        except Exception as e:
            return self._err(str(e))


class DirectoryCreateTool(_FSBase):
    def __init__(self):
        super().__init__("fs.mkdir")
        self.schema.register_argument(ToolArgument("path", "Directory path to create", True, str))

    def description(self) -> str:
        return """`fs.mkdir` - Create a directory (and any missing parents). Arguments: `path` (string). \
Succeeds silently if it already exists."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            if full.exists() and not full.is_dir():
                return self._err(f"'{input['path']}' exists and is not a directory")
            full.mkdir(parents=True, exist_ok=True)
            return self._ok({"path": input["path"], "message": f"Created directory {input['path']}"})
        except Exception as e:
            return self._err(str(e))


class DirectoryDeleteTool(_FSBase):
    def __init__(self):
        super().__init__("fs.rmdir")
        self.schema.register_argument(ToolArgument("path", "Directory path to delete", True, str))
        self.schema.register_argument(ToolArgument("recursive", "Delete contents too (default false)", False, bool))

    def description(self) -> str:
        return """`fs.rmdir` - Delete a directory. Arguments: `path` (string), `recursive` (bool, default false). \
Without `recursive` the directory must be empty. Fails if it contains a protected file."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            full = self._resolve(input["path"])
            recursive = bool(input.get("recursive", False))
            if not full.exists():
                return self._err(f"Directory '{input['path']}' does not exist")
            if not full.is_dir():
                return self._err(f"'{input['path']}' is not a directory")
            if full == self.main_folder:
                return self._err("Cannot delete the working directory itself")
            for child in full.rglob("*"):
                if self._is_protected(child):
                    return self._err(f"Directory contains protected file '{child.relative_to(self.main_folder)}'")
            if recursive:
                shutil.rmtree(full)
            else:
                if any(full.iterdir()):
                    return self._err(f"Directory '{input['path']}' is not empty; pass recursive=true")
                full.rmdir()
            return self._ok({"path": input["path"], "message": f"Removed directory {input['path']}"})
        except Exception as e:
            return self._err(str(e))


class DirectoryListTool(_FSBase):
    def __init__(self):
        super().__init__("fs.ls")
        self.schema.register_argument(ToolArgument("path", "Directory to list (default '.')", False, str))

    def description(self) -> str:
        return """`fs.ls` - List a directory. Arguments: `path` (string, default "."). \
Returns `entries`, each with `name`, `type` ("file" or "dir") and `size`."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            rel = input.get("path", ".") or "."
            full = self._resolve(rel)
            if not full.exists():
                return self._err(f"Directory '{rel}' does not exist")
            if not full.is_dir():
                return self._err(f"'{rel}' is not a directory")
            entries = []
            for child in sorted(full.iterdir(), key=lambda p: (not p.is_dir(), p.name)):
                if child.name == "node_modules":
                    entries.append({"name": child.name, "type": "dir", "size": 0, "note": "omitted"})
                    continue
                entries.append({
                    "name": child.name,
                    "type": "dir" if child.is_dir() else "file",
                    "size": child.stat().st_size if child.is_file() else 0,
                })
            return self._ok({"path": rel, "entries": entries, "count": len(entries)})
        except Exception as e:
            return self._err(str(e))
