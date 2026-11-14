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
for suffix in ("tools", "preview", "long-prompts"):
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
print(json.dumps({"sessions": [f"ui-tweaks-example-{suffix}" for suffix in ("tools", "preview", "long-prompts")], "workspace": str(WORKSPACE), "invented": True}))
