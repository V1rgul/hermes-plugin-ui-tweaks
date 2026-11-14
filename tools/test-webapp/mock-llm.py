"""Scripted OpenAI-compatible model for reproducing Desktop rendering races without provider credentials.

Every reply is invented and deterministic per conversation step; the gateway, tools and renderer are real.
"""
import json
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18080
# Slow enough that gateway ticks, sessions.changed and tail refreshes interleave with streaming.
CHUNK_DELAY = 0.04
BG = '[IMPORTANT: Background process '


def text(s):
	return s if isinstance(s, str) else ''.join(p.get('text', '') for p in s or [] if isinstance(p, dict))


def call(name, args):
	return {'name': name, 'arguments': json.dumps(args)}


def responses_messages(body):
	"""Map Responses `input` items to chat-like roles; one model response (reasoning, commentary, calls) is one step."""
	items = body.get('input') or []
	if isinstance(items, str):
		items = [{'role': 'user', 'content': items}]
	messages, in_step = [], False
	for item in items:
		kind, role = item.get('type'), item.get('role')
		if role == 'user':
			messages.append({'role': 'user', 'content': text(item.get('content'))})
			in_step = False
		elif kind == 'function_call_output':
			messages.append({'role': 'tool'})
			in_step = False
		elif kind in ('function_call', 'reasoning') or role == 'assistant':
			if not in_step:
				messages.append({'role': 'assistant'})
			in_step = True
	return messages


def plan(messages, tools):
	"""Return (prose, [tool calls]) for the next assistant step."""
	names = {t.get('name') or t.get('function', {}).get('name') for t in tools or []}
	users = [i for i, m in enumerate(messages) if m.get('role') == 'user']
	last = users[-1] if users else 0
	prompt = text(messages[last].get('content')) if users else ''
	step = sum(1 for m in messages[last + 1:] if m.get('role') == 'assistant')
	tag = f'[{uuid.uuid4().hex[:8]}]'
	if not names:
		# Auxiliary request: a short title, or a substantial summary so compaction counts as effective.
		if len(json.dumps(messages)) < 6000:
			return f'Mock {uuid.uuid4().hex[:6]}', []
		return 'Summary of the mock conversation so far: the user asked for scripted scenarios; the assistant ran background jobs, workspace listings and batch reads, all of which completed. No open questions remain.', []
	with open('/opt/data/mock-last-tools.json', 'w') as f:
		json.dump(sorted(n for n in names if n), f)
	if prompt.startswith(BG):
		script = [
			(f'The background job reported back {tag}. I will read its output before summarising.', [call('terminal', {'command': 'echo checked-notification'})]),
			(f'The background job finished cleanly {tag}; nothing else is pending.', []),
		]
	elif 'parallel' in prompt:
		script = [
			(f'Running two inspections side by side {tag}.', [call('terminal', {'command': 'ls /opt/data | head -5'}), call('terminal', {'command': 'uname -a'})]),
			('', [call('todo', {'todos': [{'id': '1', 'content': 'Inspect results', 'status': 'completed'}]})] if 'todo' in names else []),
			(f'Both inspections completed {tag}. The data directory and kernel look normal.', []),
		]
	elif 'many' in prompt:
		# Grows a session past the 120-row tail page with small folded tool turns.
		script = [(f'Step {i} of 6 {tag}: checking the next item.', [call('terminal', {'command': f'echo item-{i}'})]) for i in range(6)] + [(f'Six items checked {tag}.', [])]
	elif 'slow' in prompt:
		# Narrated steps around one long foreground tool call, the window in which the user switches away and back.
		script = [(f'Quick check {i} {tag}.', [call('terminal', {'command': f'echo quick-{i}'})]) for i in range(3)]
		script += [(f'Now the slow setup step {tag}.', [call('terminal', {'command': 'sleep 25; echo setup-done'})])]
		# `steps=N` in the prompt lengthens the turn after the slow tool, e.g. past the 120-row tail page.
		extra = int(prompt.split('steps=')[1].split()[0]) if 'steps=' in prompt else 1
		script += [(f'Follow-up {i} {tag}; verifying.', [call('terminal', {'command': f'echo verify-{i}'})]) for i in range(extra)] + [(f'Slow run complete {tag}.', [])]
	elif 'away' in prompt:
		# A background job that finishes while the user is in another session.
		script = [
			(f'Starting a background job that will finish later {tag}.', [call('terminal', {'command': 'sleep 12; echo away-done', 'background': True, 'notify_on_complete': True})]),
			(f'The job runs in the background {tag}; I will report when it notifies me.', []),
		]
	elif 'silent' in prompt:
		# Anthropic-style: tool calls with no interim prose, then one answer.
		script = [('', [call('terminal', {'command': f'echo silent-{i}; sleep 1'})]) for i in range(4)] + [(f'Silent run done {tag}. Four checks passed.', [])]
	elif 'long' in prompt:
		# The historically heavy shape: narration before each of many tool calls.
		script = [(f'Batch {i} of 8 {tag}: reading the next files.', [call('terminal', {'command': f'sleep 0.5; head -c 12000 /dev/urandom | base64 -w 120 | head -n 120'})]) for i in range(8)] + [(f'All eight batches processed {tag}.\n\nSummary: every batch was read once.', [])]
	elif 'multi' in prompt:
		script = [
			(f'Starting two background jobs {tag}.', [call('terminal', {'command': 'sleep 5; echo first', 'background': True, 'notify_on_complete': True}), call('terminal', {'command': 'sleep 9; echo second', 'background': True, 'notify_on_complete': True})]),
			(f'Both jobs started {tag}. I will wait for their notifications.', []),
		]
	else:
		script = [
			(f'I will start a slow background job first {tag}, then keep working while it runs.', [call('terminal', {'command': 'sleep 7; echo bg-done', 'background': True, 'notify_on_complete': True})]),
			(f'The job is running in the background {tag}. Meanwhile I check the workspace.', [call('terminal', {'command': 'ls -la /opt/data | head -8'})]),
			(f'Updating the task list {tag}.', [call('todo', {'todos': [{'id': '1', 'content': 'Wait for background job', 'status': 'in_progress'}]})] if 'todo' in names else []),
			(f'Workspace inspected {tag}. The background job will notify me when it is done; here is the interim summary:\n\n- data directory listed\n- background sleep pending', []),
		]
	return script[min(step, len(script) - 1)]


class Handler(BaseHTTPRequestHandler):
	protocol_version = 'HTTP/1.1'

	def log_message(self, format, *args):
		pass

	def send_json(self, body):
		data = json.dumps(body).encode()
		self.send_response(200)
		self.send_header('Content-Type', 'application/json')
		self.send_header('Content-Length', str(len(data)))
		self.end_headers()
		self.wfile.write(data)

	def do_GET(self):
		self.send_json({'object': 'list', 'data': [{'id': 'mock', 'object': 'model', 'owned_by': 'mock', 'context_length': 200000}]})

	def do_POST(self):
		body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
		if self.path.rstrip('/').endswith('/responses'):
			self.stream_responses(body)
			return
		prose, calls = plan(body.get('messages', []), body.get('tools'))
		cid = 'chatcmpl-' + uuid.uuid4().hex
		# Report realistic usage; bulky tool output then makes a low compression threshold fire.
		prompt = len(json.dumps(body.get('messages', []))) // 4
		usage = {'prompt_tokens': prompt, 'completion_tokens': 20, 'total_tokens': prompt + 20}
		if not body.get('stream'):
			msg = {'role': 'assistant', 'content': prose or None}
			if calls:
				msg['tool_calls'] = [{'id': 'call_' + uuid.uuid4().hex[:12], 'type': 'function', 'function': c} for c in calls]
			self.send_json({'id': cid, 'object': 'chat.completion', 'model': 'mock', 'choices': [{'index': 0, 'message': msg, 'finish_reason': 'tool_calls' if calls else 'stop'}], 'usage': usage})
			return
		self.send_response(200)
		self.send_header('Content-Type', 'text/event-stream')
		self.send_header('Cache-Control', 'no-cache')
		self.send_header('Connection', 'close')
		self.end_headers()

		def chunk(delta, finish=None, extra=None):
			payload = {'id': cid, 'object': 'chat.completion.chunk', 'model': 'mock', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
			if extra:
				payload.update(extra)
			self.wfile.write(f'data: {json.dumps(payload)}\n\n'.encode())
			self.wfile.flush()

		chunk({'role': 'assistant'})
		words = prose.split(' ') if prose else []
		for i, word in enumerate(words):
			chunk({'content': word + (' ' if i < len(words) - 1 else '')})
			time.sleep(CHUNK_DELAY)
		for i, c in enumerate(calls):
			chunk({'tool_calls': [{'index': i, 'id': 'call_' + uuid.uuid4().hex[:12], 'type': 'function', 'function': {'name': c['name'], 'arguments': ''}}]})
			time.sleep(CHUNK_DELAY)
			chunk({'tool_calls': [{'index': i, 'function': {'arguments': c['arguments']}}]})
		chunk({}, 'tool_calls' if calls else 'stop', {'usage': usage})
		self.wfile.write(b'data: [DONE]\n\n')
		self.wfile.flush()
		self.close_connection = True

	def stream_responses(self, body):
		"""Codex-style Responses stream: reasoning summary, commentary before tools, final_answer otherwise."""
		messages = responses_messages(body)
		prose, calls = plan(messages, body.get('tools'))
		rid = 'resp_' + uuid.uuid4().hex
		prompt = len(json.dumps(body.get('input', []))) // 4
		usage = {'input_tokens': prompt, 'output_tokens': 20, 'total_tokens': prompt + 20}
		items = [{'type': 'reasoning', 'id': 'rs_' + uuid.uuid4().hex[:12], 'summary': [{'type': 'summary_text', 'text': '**Planning** the next scripted step.'}]}]
		if prose:
			items.append({'type': 'message', 'id': 'msg_' + uuid.uuid4().hex[:12], 'role': 'assistant', 'status': 'completed', 'phase': 'commentary' if calls else 'final_answer', 'content': [{'type': 'output_text', 'text': prose, 'annotations': []}]})
		for c in calls:
			items.append({'type': 'function_call', 'id': 'fc_' + uuid.uuid4().hex[:12], 'call_id': 'call_' + uuid.uuid4().hex[:12], 'name': c['name'], 'arguments': c['arguments'], 'status': 'completed'})
		if not body.get('stream'):
			self.send_json({'id': rid, 'object': 'response', 'status': 'completed', 'model': 'mock', 'output': items, 'usage': usage})
			return
		self.send_response(200)
		self.send_header('Content-Type', 'text/event-stream')
		self.send_header('Cache-Control', 'no-cache')
		self.send_header('Connection', 'close')
		self.end_headers()
		seq = iter(range(1_000_000))

		def event(kind, **fields):
			payload = {'type': kind, 'sequence_number': next(seq), **fields}
			self.wfile.write(f'event: {kind}\ndata: {json.dumps(payload)}\n\n'.encode())
			self.wfile.flush()

		event('response.created', response={'id': rid, 'object': 'response', 'status': 'in_progress', 'model': 'mock', 'output': []})
		for index, item in enumerate(items):
			if item['type'] == 'reasoning':
				event('response.output_item.added', output_index=index, item={**item, 'summary': []})
				for word in item['summary'][0]['text'].split(' '):
					event('response.reasoning_summary_text.delta', item_id=item['id'], output_index=index, summary_index=0, delta=word + ' ')
					time.sleep(CHUNK_DELAY)
			elif item['type'] == 'message':
				event('response.output_item.added', output_index=index, item={**item, 'status': 'in_progress', 'content': []})
				words = item['content'][0]['text'].split(' ')
				for i, word in enumerate(words):
					event('response.output_text.delta', item_id=item['id'], output_index=index, content_index=0, delta=word + (' ' if i < len(words) - 1 else ''))
					time.sleep(CHUNK_DELAY)
			else:
				event('response.output_item.added', output_index=index, item={**item, 'arguments': '', 'status': 'in_progress'})
				event('response.function_call_arguments.delta', item_id=item['id'], output_index=index, delta=item['arguments'])
				event('response.function_call_arguments.done', item_id=item['id'], output_index=index, arguments=item['arguments'])
			event('response.output_item.done', output_index=index, item=item)
		event('response.completed', response={'id': rid, 'object': 'response', 'status': 'completed', 'model': 'mock', 'output': items, 'usage': usage})
		self.close_connection = True


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
