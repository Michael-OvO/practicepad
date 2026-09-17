"""Runs user code the way `python main.py` would, inside Pyodide."""

import ast
import builtins
import importlib
import importlib.util
import linecache
import os
import sys
import traceback
import types

HOME = "/home/pyodide"
MAIN_NAME = "main.py"
DEFAULT_RECURSION_LIMIT = sys.getrecursionlimit()

# Import names whose PyPI package name differs.
PACKAGE_ALIASES = {
    "attr": "attrs",
    "bs4": "beautifulsoup4",
    "cv2": "opencv-python",
    "dateutil": "python-dateutil",
    "PIL": "pillow",
    "sklearn": "scikit-learn",
    "yaml": "pyyaml",
}


def _blocked_input(prompt=""):
    raise RuntimeError("input() is not supported in this playground")


def find_missing_imports(code):
    """Top-level module names imported by `code` that are not importable yet."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    missing = []
    for name in sorted(names):
        try:
            found = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(name)
    return missing


async def install_missing(names, report):
    """micropip-install each missing import, reporting progress through `report`."""
    import micropip

    for name in names:
        package = PACKAGE_ALIASES.get(name, name)
        report(f"Installing {package} from PyPI…")
        try:
            await micropip.install(package)
        except Exception as exc:
            lines = str(exc).strip().splitlines()
            report(f"Could not install {package}: {lines[0] if lines else type(exc).__name__}")
    importlib.invalidate_caches()


def run_main(code):
    """Execute `code` as a fresh __main__ module and return the exit code."""
    # Undo anything a previous run may have left behind, as a new process would.
    sys.stdout = sys.__stdout__
    sys.stderr = sys.__stderr__
    sys.setrecursionlimit(DEFAULT_RECURSION_LIMIT)
    sys.argv = [MAIN_NAME]
    builtins.input = _blocked_input
    os.chdir(HOME)

    with open(MAIN_NAME, "w", encoding="utf-8") as file:
        file.write(code)
    # mtime=None stops linecache from re-statting, so tracebacks always show this run's source.
    linecache.cache[MAIN_NAME] = (len(code), None, code.splitlines(True), MAIN_NAME)

    # A real module object, so unittest.main(), dataclasses and pickle can find __main__.
    main_module = types.ModuleType("__main__")
    main_module.__file__ = MAIN_NAME
    previous_main = sys.modules.get("__main__")
    sys.modules["__main__"] = main_module

    exit_code = 0
    try:
        try:
            compiled = compile(code, MAIN_NAME, "exec")
        except Exception as exc:
            traceback.print_exception(type(exc), exc, None)
            return 1
        try:
            exec(compiled, main_module.__dict__)
        except SystemExit as exc:
            if exc.code is None:
                exit_code = 0
            elif isinstance(exc.code, int):
                exit_code = exc.code
            else:
                print(exc.code, file=sys.stderr)
                exit_code = 1
        except BaseException as exc:
            # Drop this function's own frame so the traceback starts at main.py.
            traceback.print_exception(type(exc), exc, exc.__traceback__.tb_next)
            exit_code = 1
    finally:
        if previous_main is not None:
            sys.modules["__main__"] = previous_main
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
    return exit_code
