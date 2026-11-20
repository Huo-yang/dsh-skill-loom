/**
 * A debounced task that refuses to run after its owner is gone.
 *
 * This exists because of a real crash: a `setTimeout` callback touched a Cordis
 * service after the plugin unloaded, threw inside the timer, and took the whole
 * host process down. A timer is not tied to any plugin lifetime, so every timer
 * callback must (a) check that its owner is still alive and (b) never let an
 * exception escape into the event loop.
 *
 * @module dsh-skill-loom/scheduler
 */

/**
 * Build a debounced task.
 * @param {object} options - task definition.
 * @param {number} options.delay - debounce window in milliseconds.
 * @param {() => boolean} options.isActive - owner liveness probe.
 * @param {() => unknown} options.run - the work; may be async.
 * @param {(error: unknown) => void} [options.onError] - failure observer; never rethrows.
 * @param {(callback: () => void, delay: number) => unknown} [options.schedule] - timer injection for tests.
 * @param {(handle: unknown) => void} [options.cancel] - timer cancellation injection for tests.
 * @returns {{ trigger: () => void, cancel: () => void, pending: () => boolean }} the task.
 */
export function createDebouncedTask(options) {
  const {
    delay,
    isActive,
    run,
    onError,
    schedule = (callback, ms) => setTimeout(callback, ms),
    cancel = handle => clearTimeout(handle),
  } = options
  if (typeof isActive !== 'function') throw new TypeError('createDebouncedTask requires isActive')
  if (typeof run !== 'function') throw new TypeError('createDebouncedTask requires run')
  if (!Number.isFinite(delay) || delay < 0) throw new TypeError('createDebouncedTask requires a non-negative delay')

  let handle
  // A generation token makes a stale callback a no-op even if a timer fires
  // after cancelation — clearTimeout is a promise about the timer, not about
  // callbacks already queued in the event loop.
  let generation = 0

  const invoke = () => {
    // The owner may have unloaded between scheduling and firing.
    if (!isActive()) return
    try {
      const result = run()
      if (result !== null && typeof result?.then === 'function') {
        result.then(undefined, error => onError?.(error))
      }
    } catch (error) {
      onError?.(error)
    }
  }

  return {
    trigger() {
      // Scheduling on a dead owner is pointless and, worse, leaks a timer that
      // can outlive the context it would touch.
      if (!isActive()) return
      if (handle !== undefined) cancel(handle)
      generation += 1
      const mine = generation
      handle = schedule(() => {
        if (mine !== generation) return
        handle = undefined
        invoke()
      }, delay)
      handle?.unref?.()
    },
    cancel() {
      if (handle === undefined) return
      generation += 1
      cancel(handle)
      handle = undefined
    },
    pending() {
      return handle !== undefined
    },
  }
}
