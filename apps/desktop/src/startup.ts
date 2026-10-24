declare global {
  interface Window {
    __nodrecStartupLog?: (stage: string) => void
  }
}

export function startupLog(stage: string) {
  window.__nodrecStartupLog?.(stage)
}
