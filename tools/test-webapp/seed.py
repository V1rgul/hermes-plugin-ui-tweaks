"""Invented history rendered by the real Hermes Webapp, not a simulated model response.

Run inside the isolated container only. Repeating the seed preserves existing test sessions;
canonical session IDs must not be reused after deletion.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, "/opt/hermes")
from hermes_state import SessionDB

HOME = Path("/opt/data")
if os.environ.get("HERMES_HOME") != str(HOME) or not Path("/opt/hermes").is_dir():
	raise SystemExit("This seed runs only inside the test container")
WORKSPACE = HOME / "workspace" / "ui-tweaks-demo"
WORKSPACE.mkdir(parents=True, exist_ok=True)
# An empty, test-only repo makes the real branch row available without credentials or commits.
if not (WORKSPACE / ".git").exists():
	subprocess.run(["git", "init", "--initial-branch=ui-tweaks-test", str(WORKSPACE)], check=True, capture_output=True)
(WORKSPACE / "example.txt").write_text("After the invented edit.\n")
(WORKSPACE / "preview.html").write_text('''<!doctype html><html><body>
<div style="border:1px solid var(--border);padding:16px;width:100%;box-sizing:border-box">
<strong>Real Desktop preview — invented test document</strong>
<p>This frame should fill the available message width.</p>
<button onclick="this.textContent = 'Clicks: ' + (++window.count)">Clicks: 0</button>
<script>window.count = 0</script></div></body></html>''')

db = SessionDB(HOME / "state.db")
suffixes = ("tools", "preview", "long-prompts", "long-output", "first-blocks")
for suffix in suffixes:
	sid = f"ui-tweaks-example-{suffix}"
	if db.get_session(sid) is not None:
		continue
	# A bare "local" row lacks a canonical route and cannot resume; Desktop history is natively adoptable.
	db.create_session(sid, "desktop", cwd=str(WORKSPACE), profile_name="default")
	db.set_session_title(sid, f"UI Tweaks — {suffix} (invented)")
	if suffix == "long-prompts":
		text = "Invented long history prompt — renderer test only\n" + "\n".join(f"Line {index}: this deliberately long example checks the native prompt clamp." for index in range(1, 13))
		db.append_message(sid, "user", content=text)
		db.append_message(sid, "assistant", content="Invented history for the long-prompt display check; no model was called.")
		continue
	if suffix == "long-output":
		# Long enough to overflow both the native and the tripled caps of an opened call.
		output = "\n".join(f"Invented output line {index}" for index in range(1, 81))
		# A TypeScript path takes the syntax-highlighted diff renderer used for code files.
		diff = "--- a/long.ts\n+++ b/long.ts\n@@ -1,40 +1,40 @@\n" + "\n".join(f"-const invented{index} = 'old line {index}'\n+const invented{index} = 'new line {index}'" for index in range(1, 41))
		calls = [
			("long-terminal", "terminal", {"command": "seq 80"}, {"output": output, "exit_code": 0, "error": None}),
			("long-patch", "patch", {"mode": "replace", "path": str(WORKSPACE / "long.ts"), "old_string": "old", "new_string": "new"}, {"success": True, "path": str(WORKSPACE / "long.ts"), "diff": diff}),
		]
		db.append_message(sid, "user", content="Show long invented tool output.")
		db.append_message(sid, "assistant", content="", tool_calls=[{"id": ident, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}} for ident, name, args, result in calls])
		for ident, name, args, result in calls:
			db.append_message(sid, "tool", content=json.dumps(result), tool_name=name, tool_call_id=ident)
		db.append_message(sid, "assistant", content="Invented history for the tool detail height check; no command ran.")
		continue
	if suffix == "first-blocks":
		# Blocks that open a text block sit beside its floated timestamp; each must still span the message width.
		long = "Invented wide line that runs past the reading column to check the block width. " * 3
		db.append_message(sid, "user", content="Show invented blocks that open a text block.")
		db.append_message(sid, "assistant", content=f"```text\nHello,\n\n{long}\n```\n\nInvented text after the code block.")
		db.append_message(sid, "user", content="Now a table first.")
		db.append_message(sid, "assistant", content="| Invented column | Another invented column |\n| --- | --- |\n| A | B |\n\nInvented text after the table.")
		db.append_message(sid, "user", content="Now a quote first.")
		db.append_message(sid, "assistant", content=f"> {long}\n\nInvented text after the quote.")
		db.append_message(sid, "user", content="Now a preview first.")
		db.append_message(sid, "assistant", content=f'::preview{{file="{WORKSPACE}/preview.html"}}\n\nInvented text after the preview.')
		db.append_message(sid, "user", content="Now display math first.")
		db.append_message(sid, "assistant", content="$$\n\\sum_{n=1}^{100} n = 5050\n$$\n\nInvented text after the math.")
		continue
	if suffix == "preview":
		db.append_message(sid, "user", content="Show the invented interactive preview.")
		db.append_message(sid, "assistant", content=f'This is a seeded test document, not a live model turn.\n\n::preview{{file="{WORKSPACE}/preview.html"}}')
		continue
	db.append_message(sid, "user", content="Show a tool group and an editable diff using invented data.")
	calls = [
		("read-demo", "read_file", {"path": str(WORKSPACE / "example.txt")}, {"content": "Before the invented edit.\n", "total_lines": 1}),
		("search-demo", "search_files", {"path": str(WORKSPACE), "pattern": "example"}, {"matches": ["example.txt"], "total_count": 1}),
		("edit-demo", "patch", {"mode": "replace", "path": str(WORKSPACE / "example.txt"), "old_string": "Before", "new_string": "After"}, {"success": True, "path": str(WORKSPACE / "example.txt"), "diff": "--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-Before the invented edit.\n+After the invented edit."}),
	]
	db.append_message(sid, "assistant", content="", tool_calls=[{"id": ident, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}} for ident, name, args, result in calls])
	for ident, name, args, result in calls:
		db.append_message(sid, "tool", content=json.dumps(result), tool_name=name, tool_call_id=ident)
	db.append_message(sid, "assistant", content="Invented history for testing only. Expand this group and reopen the example.txt diff using the native controls.")
db.close()
print(json.dumps({"sessions": [f"ui-tweaks-example-{suffix}" for suffix in suffixes], "workspace": str(WORKSPACE), "invented": True}))
