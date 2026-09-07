// Points @monaco-editor/react at the monaco-editor package bundled with the
// app instead of its default behavior of fetching Monaco from a CDN
// (cdn.jsdelivr.net) at runtime. Loading Monaco from a third-party CDN means
// the editor — and anything that depends on its own clipboard handling,
// like paste — is at the mercy of that CDN being reachable; on a network
// that blocks it, Monaco can end up partially initialized in ways that
// break clipboard access without necessarily failing to render at all.
// Self-hosting removes that dependency entirely.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

self.MonacoEnvironment = {
  getWorker() {
    return new Worker(
      new URL('monaco-editor/editor/editor.worker.js', import.meta.url),
      { type: 'module' },
    )
  },
}

loader.config({ monaco })
