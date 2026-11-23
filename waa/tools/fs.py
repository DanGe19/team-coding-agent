import shutil
from pathlib import Path
from typing import Dict, Any, List

from ..tool import Tool, ToolArgument
from ..env import AgentEnvironment


def _ok(data: Any) -> Dict[str, Any]:
    return {"ok": True, "data": data, "error": None}


def _err(message: str) -> Dict[str, Any]:
    return {"ok": False, "data": None, "error": message}


class _FSToolBase(Tool):
    """Common state and checks for all file-system tools."""

    def __init__(self, name: str):
        super().__init__(name)
        self.working_dir: Path = Path(".").resolve()
        self.protected_files: List[str] = []

    def initialize(self, env: AgentEnvironment):
        self.working_dir = Path(env.get_working_dir()).resolve()
        self.protected_files = env.get_config_value("protected_files", []) or []

    def resolve_path(self, rel_path: str) -> Path:
        """Resolve a user-supplied path and make sure it stays inside working_dir.

        Raises ValueError if the path escapes the working directory.
        """
        full = (self.working_dir / rel_path).resolve()
        if full != self.working_dir and self.working_dir not in full.parents:
            raise ValueError(
                f"Path '{rel_path}' is outside the working directory and is not allowed"
            )
        return full

    def is_protected(self, full_path: Path) -> bool:
        """Check whether full_path matches one of the protected_files entries."""
        for protected in self.protected_files:
            protected_full = (self.working_dir / protected).resolve()
            if full_path == protected_full:
                return True
        return False

    def check_writable(self, rel_path: str) -> Path:
        """Resolve a path and ensure it is inside working_dir and not protected."""
        full = self.resolve_path(rel_path)
        if self.is_protected(full):
            raise PermissionError(f"File '{rel_path}' is protected and cannot be modified")
        return full



class FileCreateTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.write")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Path of the file to create or overwrite, relative to the project root", True, str))
        self.schema.register_argument(ToolArgument(
            "content", "The full text content to write into the file", True, str))


    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.write` - Create a new file or overwrite an existing one with the given content. \
Parent directories are created automatically. Use this to create source files such as \
index.js, index.html, style.css, or test files. \
Arguments: `path` (string, required) - file path relative to the project root; \
`content` (string, required) - the complete content of the file. \
Protected files (tests, .waa config) cannot be written."""


    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            content = input["content"]
            full = self.check_writable(rel_path)
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(content, encoding="utf-8")
            return _ok({
                "path": rel_path,
                "size": len(content.encode("utf-8")),
                "message": f"File '{rel_path}' written successfully",
            })
        except Exception as e:
            return _err(str(e))

class FileDeleteTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.delete")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Path of the file to delete, relative to the project root", True, str))


    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.delete` - Delete a single file. \
Arguments: `path` (string, required) - file path relative to the project root. \
Fails if the file does not exist, is a directory, or is protected. Use `fs.rmdir` for directories."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            full = self.check_writable(rel_path)
            if not full.exists():
                return _err(f"File '{rel_path}' does not exist")
            if full.is_dir():
                return _err(f"'{rel_path}' is a directory; use fs.rmdir instead")
            full.unlink()
            return _ok({"path": rel_path, "message": f"File '{rel_path}' deleted"})
        except Exception as e:
            return _err(str(e))

class FileReadTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.read")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Path of the file to read, relative to the project root", True, str))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.read` - Read the full content of a text file. \
Returns the content, its size in bytes, and the number of lines. \
Arguments: `path` (string, required) - file path relative to the project root. \
Use this to inspect existing files (for example the provided tests) before writing code."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            full = self.resolve_path(rel_path)
            if not full.exists():
                return _err(f"File '{rel_path}' does not exist")
            if full.is_dir():
                return _err(f"'{rel_path}' is a directory; use fs.ls to list it")
            content = full.read_text(encoding="utf-8")
            return _ok({
                "path": rel_path,
                "content": content,
                "size": len(content.encode("utf-8")),
                "lines": len(content.splitlines()),
            })
        except Exception as e:
            return _err(str(e))

class FileEditTool(_FSToolBase):
    def __init__(self):
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        super().__init__("fs.edit")
        self.schema.register_argument(ToolArgument(
            "path", "Path of the file to edit, relative to the project root", True, str))
        self.schema.register_argument(ToolArgument(
            "old_text", "Exact text to find in the file (first occurrence is replaced)", True, str))
        self.schema.register_argument(ToolArgument(
            "new_text", "Text that replaces old_text", True, str))


    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.edit` - Edit an existing file by replacing the FIRST occurrence of `old_text` \
with `new_text`. Use this for small targeted changes instead of rewriting the whole file. \
Arguments: `path` (string, required); `old_text` (string, required) - must match the file \
content exactly, including whitespace; `new_text` (string, required). \
Fails if the file does not exist, if old_text is not found, or if the file is protected."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            old_text = input["old_text"]
            new_text = input["new_text"]
            full = self.check_writable(rel_path)
            if not full.exists():
                return _err(f"File '{rel_path}' does not exist")
            if full.is_dir():
                return _err(f"'{rel_path}' is a directory")
            content = full.read_text(encoding="utf-8")
            if old_text not in content:
                return _err(f"old_text not found in '{rel_path}'. Make sure it matches exactly.")
            new_content = content.replace(old_text, new_text, 1)
            full.write_text(new_content, encoding="utf-8")
            return _ok({
                "path": rel_path,
                "message": f"Replaced first occurrence in '{rel_path}'",
                "size": len(new_content.encode("utf-8")),
            })
        except Exception as e:
            return _err(str(e))

class DirectoryCreateTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.mkdir")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Path of the directory to create, relative to the project root", True, str))

    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.mkdir` - Create a directory (and any missing parent directories). \
Succeeds silently if the directory already exists. \
Arguments: `path` (string, required) - directory path relative to the project root."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            full = self.resolve_path(rel_path)
            if full.exists() and not full.is_dir():
                return _err(f"'{rel_path}' exists and is not a directory")
            full.mkdir(parents=True, exist_ok=True)
            return _ok({"path": rel_path, "message": f"Directory '{rel_path}' created"})
        except Exception as e:
            return _err(str(e))

class DirectoryDeleteTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.rmdir")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Path of the directory to delete, relative to the project root", True, str))
        self.schema.register_argument(ToolArgument(
            "recursive", "If true, delete the directory and everything inside it (default false)", False, bool))


    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.rmdir` - Delete a directory. By default only empty directories can be deleted; \
pass `recursive: true` to delete a directory together with all of its contents. \
Arguments: `path` (string, required); `recursive` (boolean, optional, default false). \
Fails if the directory does not exist, is not empty (without recursive), or contains protected files."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input["path"]
            recursive = input.get("recursive", False)
            full = self.resolve_path(rel_path)
            if full == self.working_dir:
                return _err("Refusing to delete the project root directory")
            if not full.exists():
                return _err(f"Directory '{rel_path}' does not exist")
            if not full.is_dir():
                return _err(f"'{rel_path}' is not a directory; use fs.delete for files")

            # Never delete a protected file, even recursively.
            for child in full.rglob("*"):
                if self.is_protected(child):
                    return _err(f"Directory '{rel_path}' contains protected file '{child.relative_to(self.working_dir)}'")

            if recursive:
                shutil.rmtree(full)
            else:
                if any(full.iterdir()):
                    return _err(f"Directory '{rel_path}' is not empty; pass recursive=true to delete it")
                full.rmdir()
            return _ok({"path": rel_path, "message": f"Directory '{rel_path}' deleted"})
        except Exception as e:
            return _err(str(e))

class DirectoryListTool(_FSToolBase):
    def __init__(self):
        super().__init__("fs.ls")
        #########################################################
        # TODO: Initialize the schema                           #
        #########################################################
        self.schema.register_argument(ToolArgument(
            "path", "Directory to list, relative to the project root (default '.')", False, str))


    def description(self) -> str:
        #########################################################
        # TODO: Return the description of the tool              #
        #########################################################
        return """`fs.ls` - List the contents of a directory. Returns an array of entries, \
each with `name`, `type` ("file" or "directory") and `size` in bytes. \
Arguments: `path` (string, optional, default ".") - directory path relative to the project root."""

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        #########################################################
        # TODO: Execute the tool given the input arguments      #
        #########################################################
        try:
            rel_path = input.get("path", ".")
            full = self.resolve_path(rel_path)
            if not full.exists():
                return _err(f"Directory '{rel_path}' does not exist")
            if not full.is_dir():
                return _err(f"'{rel_path}' is not a directory")
            entries = []
            for child in sorted(full.iterdir(), key=lambda p: p.name):
                entries.append({
                    "name": child.name,
                    "type": "directory" if child.is_dir() else "file",
                    "size": child.stat().st_size if child.is_file() else 0,
                })
            return _ok({"path": rel_path, "entries": entries, "count": len(entries)})
        except Exception as e:
            return _err(str(e))



class DirectoryTreeTool(_FSToolBase):
    IGNORED = {"node_modules", ".git", ".waa", "__pycache__"}

    def __init__(self):
        super().__init__("fs.tree")
        self.schema.register_argument(ToolArgument(
            "path", "Directory to start from, relative to the project root (default '.')", False, str))
        self.schema.register_argument(ToolArgument(
            "max_depth", "Maximum depth to descend (default 3)", False, int))

    def description(self) -> str:
        return """`fs.tree` - Show the directory structure as a nested tree. \
Each node has `name`, `type` ("file" or "directory") and, for directories, `children`. \
Heavy folders such as node_modules and .git are skipped. \
Arguments: `path` (string, optional, default "."); `max_depth` (integer, optional, default 3)."""

    def _build(self, directory: Path, depth: int, max_depth: int) -> List[Dict[str, Any]]:
        nodes = []
        for child in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name)):
            if child.name in self.IGNORED:
                continue
            if child.is_dir():
                node = {"name": child.name, "type": "directory"}
                if depth < max_depth:
                    node["children"] = self._build(child, depth + 1, max_depth)
                nodes.append(node)
            else:
                nodes.append({"name": child.name, "type": "file", "size": child.stat().st_size})
        return nodes

    def execute(self, input: Dict[str, Any]) -> Dict[str, Any]:
        try:
            rel_path = input.get("path", ".")
            max_depth = input.get("max_depth", 3)
            full = self.resolve_path(rel_path)
            if not full.exists():
                return _err(f"Directory '{rel_path}' does not exist")
            if not full.is_dir():
                return _err(f"'{rel_path}' is not a directory")
            tree = self._build(full, 1, max_depth)
            return _ok({"path": rel_path, "tree": tree})
        except Exception as e:
            return _err(str(e))
