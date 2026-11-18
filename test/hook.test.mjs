// Unit checks for the llm/stream waterfall hook and the checkpoint watcher.
import assert from 'node:assert/strict'
import { apply, augmentCompactionRequest, carryOverInstruction, normalizeConfig } from '../index.js'

function makePlugin (config = {}) {
  const handlers = {}
  const warnings = []
  const ctx = {
    on (name, fn) { handlers[name] = fn },
    logger: { warn: (message) => warnings.push(message) },
  }
  apply(ctx, config)
  return { handlers, warnings }
}

function compactionOptions () {
  return {
    provider: 'p',
    model: 'm',
    purpose: 'compaction',
    messages: [
      { role: 'system', content: [{ type: 'system-prompt', text: 'sys' }] },
      { role: 'user', content: [{ type: 'text', text: 'ORIGINAL INSTRUCTION' }] },
    ],
  }
}

// 1. the compaction instruction is extended in place, the call still proceeds
{
  const { handlers } = makePlugin()
  const options = compactionOptions()
  let called = 0
  const result = handlers['llm/stream'](options, () => { called++; return { stream: true } })
  assert.equal(called, 1, 'next() is always called')
  assert.deepEqual(result, { stream: true })
  const last = options.messages.at(-1)
  assert.equal(last.role, 'user')
  assert.equal(last.content[0].text, 'ORIGINAL INSTRUCTION', 'the original instruction is kept')
  const added = last.content.map((block) => block.text).join('\n')
  assert.ok(added.includes('## Carry-over'), 'the carry-over section is requested')
  assert.ok(added.includes('Skills in effect'), 'skills are requested')
  assert.ok(added.includes('Subagents'), 'subagents are requested')
  assert.ok(added.includes('ids exactly'), 'exact ids are demanded')
  console.log('waterfall: compaction instruction extended')
}

// 2. every other call is untouched
{
  const { handlers } = makePlugin()
  const options = compactionOptions()
  options.purpose = 'chat'
  handlers['llm/stream'](options, () => ({ stream: true }))
  assert.equal(options.messages.at(-1).content.length, 1)
  assert.equal(augmentCompactionRequest({ purpose: 'compaction', messages: [] }, 'x'), false)
  console.log('waterfall: other purposes untouched')
}

// 3. a frozen request is left alone instead of throwing
{
  const { handlers } = makePlugin()
  const options = compactionOptions()
  options.messages = Object.freeze(options.messages)
  const snapshot = JSON.stringify(options)
  assert.doesNotThrow(() => handlers['llm/stream'](options, () => ({ stream: true })))
  assert.equal(JSON.stringify(options), snapshot, 'frozen request stays unchanged')
  console.log('waterfall: frozen requests are skipped safely')
}

// 4. disabled plugin changes nothing
{
  const { handlers } = makePlugin({ enabled: false })
  assert.deepEqual(handlers, {}, 'disabled plugin registers no listeners')
}

// 5. the checkpoint watcher reports a missing section and stays quiet otherwise
{
  const { handlers, warnings } = makePlugin()
  const session = { id: 'session-x' }
  const withSection = {
    type: 'compaction/summary',
    data: { compactionId: 'c1', summary: [{ type: 'text', text: '## Critical Context\n- x\n## Carry-over\n- agent-organizer' }] },
  }
  handlers['session/event'](session, withSection)
  assert.equal(warnings.length, 0, 'no warning when the section is present')

  const withoutSection = {
    type: 'compaction/summary',
    data: { compactionId: 'c2', summary: [{ type: 'text', text: '## Critical Context\n- x' }] },
  }
  handlers['session/event'](session, withoutSection)
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('no "## Carry-over" section'))
  assert.ok(warnings[0].includes('c2'))
  console.log('watcher: missing section is logged, present section stays silent')
}

// configuration
assert.equal(normalizeConfig({}).sectionTitle, '## Carry-over')
assert.equal(normalizeConfig({ sectionTitle: '## Carry' }).sectionTitle, '## Carry')
assert.ok(carryOverInstruction(normalizeConfig({})).includes('## Carry-over'))
assert.ok(carryOverInstruction(normalizeConfig({ extraInstructions: 'Be terse.' })).includes('Be terse.'))

console.log('OK: compaction instruction extended, other calls untouched, missing section logged')
