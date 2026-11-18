/**
 * dsh-compaction-carryover
 *
 * The compaction summarizer is the only participant that still sees the whole
 * conversation. Its instruction is a hardcoded constant, but every model call
 * passes through the `llm/stream` waterfall, and `compaction-basic` marks its
 * call with `purpose: "compaction"`. This plugin appends one paragraph to that
 * instruction, asking for a `## Carry-over` section: the skills still in
 * effect and the subagents still worth reusing, with their exact ids.
 *
 * It changes nothing else: no extra model call, no injected messages, no
 * dependencies on compaction internals beyond the documented purpose marker.
 */

import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-compaction-carryover'

/** No services are required; the plugin only listens to events. */
export const inject = []

const DEFAULTS = {
  enabled: true,
  sectionTitle: '## Carry-over',
  extraInstructions: '',
  debug: false,
}

/**
 * Normalize raw plugin configuration.
 * @param raw - loader configuration.
 * @returns resolved configuration.
 */
export function normalizeConfig (raw = {}) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const title = typeof input.sectionTitle === 'string' && input.sectionTitle.trim() !== '' ? input.sectionTitle.trim() : DEFAULTS.sectionTitle
  return {
    enabled: input.enabled !== false,
    sectionTitle: title,
    extraInstructions: typeof input.extraInstructions === 'string' ? input.extraInstructions : DEFAULTS.extraInstructions,
    debug: input.debug === true,
  }
}

/**
 * Build the paragraph appended to the summarizer instruction.
 * @param config - resolved configuration.
 * @returns instruction text.
 */
export function carryOverInstruction (config) {
  const lines = [
    '',
    `Additionally, extend the checkpoint with one more section after the last one: ${config.sectionTitle}`,
    '- Skills in effect: one bullet `name` — one clause on why its instructions still matter. Omit skills whose work is finished.',
    '- Subagents: one bullet `id` — its role in one clause and whether it finished, for every subagent whose result is still needed or that can be reused for follow-up work. Omit subagents that are no longer needed.',
    'Copy skill names and subagent ids exactly; they are used verbatim later. Write "(none)" when a part is empty.',
  ]
  if (config.extraInstructions.trim() !== '') {
    lines.push('', config.extraInstructions.trim())
  }
  return lines.join('\n')
}

/** Append a diagnostic line when `debug` is on. */
function debug (config, message) {
  if (!config.debug) return
  try {
    appendFileSync(join(homedir(), '.dsh', 'compaction-carryover.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* diagnostics must never break a model call */
  }
}

/** Report without breaking anything. */
function warn (ctx, message) {
  try {
    if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  } catch {
    /* logging must never break a model call */
  }
}

/**
 * Append the carry-over paragraph to a compaction request in place.
 * @param options - request options of the LLM call.
 * @param instruction - paragraph to append.
 * @returns whether the request was changed.
 */
export function augmentCompactionRequest (options, instruction) {
  if (options === null || options === undefined || options.purpose !== 'compaction') return false
  const messages = options.messages
  if (!Array.isArray(messages) || Object.isFrozen(messages) || messages.length === 0) return false
  const index = messages.length - 1
  const last = messages[index]
  if (last === null || typeof last !== 'object' || last.role !== 'user') return false
  if (!Array.isArray(last.content)) return false
  // Replace the array slot instead of mutating the frozen message object.
  messages[index] = {
    ...last,
    content: [...last.content, { type: 'text', text: instruction }],
  }
  return true
}

/** Register the plugin. */
export function apply (ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  if (!config.enabled) return

  const instruction = carryOverInstruction(config)

  ctx.on('llm/stream', (options, next) => {
    try {
      if (augmentCompactionRequest(options, instruction)) {
        debug(config, `instruction extended for a compaction call (model=${String(options?.model)})`)
      }
    } catch (error) {
      // Never break a model call: fall back to the unmodified request.
      warn(ctx, `[dsh-compaction-carryover] could not extend the compaction instruction: ${error instanceof Error ? error.message : String(error)}`)
    }
    return next()
  })

  // Watch the result: the summarizer is instructed, not forced. A checkpoint
  // without the section is logged, nothing is injected.
  ctx.on('session/event', (session, event) => {
    if (!config.enabled || event?.type !== 'compaction/summary') return
    try {
      const text = (Array.isArray(event.data?.summary) ? event.data.summary : [])
        .map((block) => (block !== null && typeof block === 'object' && typeof block.text === 'string' ? block.text : ''))
        .join('\n')
      const checklist = text.toLowerCase()
      const present = checklist.includes(config.sectionTitle.toLowerCase())
      if (present) {
        debug(config, `carry-over present in compaction ${String(event.data?.compactionId)} (${text.length} chars)`)
        return
      }
      const message = `[dsh-compaction-carryover] checkpoint ${String(event.data?.compactionId)} (session ${String(session?.id)}) has no "${config.sectionTitle}" section; the summarizer ignored the instruction`
      warn(ctx, message)
      debug(config, message)
    } catch (error) {
      warn(ctx, `[dsh-compaction-carryover] could not inspect the checkpoint: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}
