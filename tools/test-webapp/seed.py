"""Invented history rendered by the real Hermes Webapp, not a simulated model response.

Run inside the isolated container only. Repeating the seed preserves existing test sessions;
canonical session IDs must not be reused after deletion.
"""
import json
import os
import subprocess
import sys
import wave
from pathlib import Path

sys.path.insert(0, "/opt/hermes")
from persistence import SessionId
from persistence.conversation.messages import NewMessage
from persistence.conversation.sessions import NewSession
from persistence_assembly import open_persistence, profile_scope

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

store = open_persistence(profile_scope(home=HOME))


def append(sid, role, *, content, tool_calls=(), **fields):
	store.messages.append(sid, NewMessage(role=role, content=content, tool_calls=tuple(tool_calls), **fields))


suffixes = ("tools", "preview", "long-prompts", "long-output", "first-blocks", "wide-cards", "long-code")
for suffix in suffixes:
	sid = SessionId(f"ui-tweaks-example-{suffix}")
	if store.sessions.get(sid) is not None:
		continue
	# A bare "local" row lacks a canonical route and cannot resume; Desktop history is natively adoptable.
	store.sessions.create(NewSession(session_id=sid, source="desktop", cwd=str(WORKSPACE), profile_name="default"))
	store.sessions.set_title(sid, f"UI Tweaks — {suffix} (invented)")
	if suffix == "long-prompts":
		text = "Invented long history prompt — renderer test only\n" + "\n".join(f"Line {index}: this deliberately long example checks the native prompt clamp." for index in range(1, 13))
		append(sid, "user", content=text)
		append(sid, "assistant", content="Invented history for the long-prompt display check; no model was called.")
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
		append(sid, "user", content="Show long invented tool output.")
		append(sid, "assistant", content="", tool_calls=[{"id": ident, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}} for ident, name, args, result in calls])
		for ident, name, args, result in calls:
			append(sid, "tool", content=json.dumps(result), tool_name=name, tool_call_id=ident)
		append(sid, "assistant", content="Invented history for the tool detail height check; no command ran.")
		continue
	if suffix == "first-blocks":
		# Blocks that open a text block sit beside its floated timestamp; each must still span the message width.
		long = "Invented wide line that runs past the reading column to check the block width. " * 3
		append(sid, "user", content="Show invented blocks that open a text block.")
		append(sid, "assistant", content=f"```text\nHello,\n\n{long}\n```\n\nInvented text after the code block.")
		append(sid, "user", content="Now a table first.")
		append(sid, "assistant", content="| Invented column | Another invented column |\n| --- | --- |\n| A | B |\n\nInvented text after the table.")
		append(sid, "user", content="Now a quote first.")
		append(sid, "assistant", content=f"> {long}\n\nInvented text after the quote.")
		append(sid, "user", content="Now a preview first.")
		append(sid, "assistant", content=f'::preview{{file="{WORKSPACE}/preview.html"}}\n\nInvented text after the preview.')
		append(sid, "user", content="Now display math first.")
		append(sid, "assistant", content="$$\n\\sum_{n=1}^{100} n = 5050\n$$\n\nInvented text after the math.")
		continue
	if suffix == "wide-cards":
		# Capped native cards: a one-second silent clip for the audio player, a full HTML document that becomes an artifact card, and a settled delegation.
		with wave.open(str(WORKSPACE / "invented-clip.wav"), "wb") as clip:
			clip.setnchannels(1)
			clip.setsampwidth(2)
			clip.setframerate(8000)
			clip.writeframes(b"\0\0" * 8000)
		page = "<!doctype html>\n<html><head><title>Invented artifact with a deliberately long title that a narrow card cuts</title></head>\n<body><h1>Invented artifact</h1><p>Seeded test document for the artifact card width check; not a live model turn.</p></body></html>"
		goal = "Invented subagent goal long enough that a three-quarter-width card cuts it before the end of the line, renderer test only"
		append(sid, "user", content="Show invented capped cards.")
		append(sid, "assistant", content=f"Invented audio clip:\n\nMEDIA:{WORKSPACE}/invented-clip.wav\n\n```html\n{page}\n```")
		append(sid, "assistant", content="", tool_calls=[{"id": "delegate-demo", "type": "function", "function": {"name": "delegate_task", "arguments": json.dumps({"goal": goal})}}])
		append(sid, "tool", content=json.dumps({"results": [{"status": "completed", "summary": "Invented summary, no subagent ran.", "duration_seconds": 3}]}), tool_name="delegate_task", tool_call_id="delegate-demo")
		append(sid, "assistant", content="Invented history for the card width check; no model was called.")
		continue
	if suffix == "long-code":
		# Long enough to overflow both the native expanded cap (40% of the window) and the raised one, yet under the 48 lines that turn a code fence into an artifact card.
		# Code-like lines in a named language: Desktop renders a fence that looks like prose as plain text, without the expandable card.
		code = "\n".join(f"invented_{index} = 'code line {index}'" for index in range(1, 46))
		append(sid, "user", content="Show a long invented code block.")
		append(sid, "assistant", content=f"Invented history for the code block height check; no model was called.\n\n```python\n{code}\n```")
		continue
	if suffix == "preview":
		append(sid, "user", content="Show the invented interactive preview.")
		append(sid, "assistant", content=f'This is a seeded test document, not a live model turn.\n\n::preview{{file="{WORKSPACE}/preview.html"}}')
		continue
	append(sid, "user", content="Show a tool group and an editable diff using invented data.")
	calls = [
		("read-demo", "read_file", {"path": str(WORKSPACE / "example.txt")}, {"content": "Before the invented edit.\n", "total_lines": 1}),
		("search-demo", "search_files", {"path": str(WORKSPACE), "pattern": "example"}, {"matches": ["example.txt"], "total_count": 1}),
		("edit-demo", "patch", {"mode": "replace", "path": str(WORKSPACE / "example.txt"), "old_string": "Before", "new_string": "After"}, {"success": True, "path": str(WORKSPACE / "example.txt"), "diff": "--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-Before the invented edit.\n+After the invented edit."}),
	]
	append(sid, "assistant", content="", tool_calls=[{"id": ident, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}} for ident, name, args, result in calls])
	for ident, name, args, result in calls:
		append(sid, "tool", content=json.dumps(result), tool_name=name, tool_call_id=ident)
	append(sid, "assistant", content="Invented history for testing only. Expand this group and reopen the example.txt diff using the native controls.")
store.close()
print(json.dumps({"sessions": [f"ui-tweaks-example-{suffix}" for suffix in suffixes], "workspace": str(WORKSPACE), "invented": True}))
