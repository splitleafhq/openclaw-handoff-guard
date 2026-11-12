import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type OutboundText, canonicalTool, outboundText } from '../src/rules.ts';

/** The text and target of a call the guard can read. */
function readable(...args: Parameters<typeof outboundText>): OutboundText {
  const out = outboundText(...args);
  assert.ok(out && 'text' in out);
  return out;
}

test('other tools are not agent text, channel posts included', () => {
  assert.equal(outboundText('read', { path: 'notes.md' }, 'main'), undefined);
  assert.equal(outboundText('message', { action: 'send', message: 'hi' }, 'main'), undefined);
});

test('ask_research hands its question to an unknown agent, and an unreadable question blocks', () => {
  assert.deepEqual(outboundText('ask_research', { question: 'q' }, 'coder'), { target: undefined, text: 'q' });
  assert.deepEqual(outboundText('ask_research', {}, 'coder'), { unreadable: true, tool: 'ask_research', field: 'question' });
});

test('sessions_send names its target by agentId or by an agent session key, and a label stays unknown', () => {
  assert.deepEqual(outboundText('sessions_send', { agentId: 'helper', message: 'm' }, 'main'), { target: 'helper', text: 'm' });
  assert.deepEqual(outboundText('sessions_send', { sessionKey: ['agent', 'helper', 'main'].join(':'), message: 'm' }, 'main'), {
    target: 'helper',
    text: 'm',
  });
  assert.deepEqual(outboundText('sessions_send', { label: 'helper', message: 'm' }, 'main'), { target: undefined, text: 'm' });
  assert.deepEqual(outboundText('sessions_send', { sessionKey: 'main', message: 'm' }, 'main'), { target: undefined, text: 'm' });
});

test('a sessionKey or label wins over agentId, as in OpenClaw, so agentId cannot borrow an exemption', () => {
  const key = ['agent', 'web', 'main'].join(':');
  assert.equal(readable('sessions_send', { agentId: 'safe', sessionKey: key, message: 'm' }, 'main').target, 'web');
  assert.equal(readable('sessions_send', { agentId: 'safe', label: 'x', message: 'm' }, 'main').target, undefined);
  assert.equal(readable('sessions_send', { agentId: 'safe', sessionKey: null, message: 'm' }, 'main').target, undefined);
});

test('every text field is checked: attachments raw and base64, the output schema, unknown fields', () => {
  const send = readable('sessions_send', { agentId: 'helper', message: 'm', extra: { note: 'n' } }, 'main');
  assert.equal(send.text, 'm\nn');
  const spawn = readable(
    'sessions_spawn',
    {
      task: 't',
      attachments: [
        { name: 'a.txt', content: 'plain' },
        { name: 'b.txt', content: Buffer.from('decoded').toString('base64'), encoding: 'base64', mimeType: 'text/plain' },
      ],
      outputSchema: { type: 'object', description: 'schema text' },
      model: 'not checked',
    },
    'main',
  );
  for (const part of ['t', 'a.txt', 'plain', 'decoded', 'schema text']) {
    assert.ok(spawn.text.split('\n').includes(part), part);
  }
  assert.ok(!spawn.text.includes('not checked'));
  assert.ok(!spawn.text.includes('text/plain'));
});

test('a namespaced, padded or mixed-case tool name is the same tool', () => {
  for (const name of ['openclaw:core:sessions_send', 'Sessions_Send', 'sessions_send ']) {
    assert.equal(canonicalTool(name), 'sessions_send', name);
    assert.ok(outboundText(name, { agentId: 'helper', message: 'm' }, 'main'), name);
  }
});

test('sessions_spawn runs under the requester unless agentId says otherwise, and its label is checked too', () => {
  assert.deepEqual(outboundText('sessions_spawn', { task: 't' }, 'main'), { target: 'main', text: 't' });
  assert.deepEqual(outboundText('sessions_spawn', { task: 't', agentId: 'helper', label: 'l' }, 'main'), {
    target: 'helper',
    text: 't\nl',
  });
  assert.deepEqual(outboundText('sessions_spawn', { task: 't', label: null }, 'main'), { target: 'main', text: 't' });
  assert.deepEqual(outboundText('sessions_spawn', { task: 't', agentId: '' }, 'main'), { target: undefined, text: 't' });
  assert.deepEqual(outboundText('sessions_spawn', { task: 't' }, undefined), { target: undefined, text: 't' });
});

test('unreadable agent text is marked, with the field when the text field is what is missing, so it can be blocked', () => {
  for (const [tool, params, field] of [
    ['sessions_send', undefined, undefined],
    ['sessions_send', 'text', undefined],
    ['sessions_send', { agentId: 'helper' }, 'message'],
    ['sessions_send', { message: ['m'] }, 'message'],
    ['sessions_spawn', {}, 'task'],
    ['sessions_spawn', { message: 'find papers' }, 'task'],
    ['sessions_spawn', { task: 't', label: 3 }, undefined],
    ['sessions_spawn', { task: 't', attachments: 'a.txt' }, undefined],
    ['sessions_spawn', { task: 't', attachments: ['a.txt'] }, undefined],
  ] as const) {
    const expected = field ? { unreadable: true, tool, field } : { unreadable: true, tool };
    assert.deepEqual(outboundText(tool, params, 'main'), expected, `${tool} ${JSON.stringify(params)}`);
  }
});
