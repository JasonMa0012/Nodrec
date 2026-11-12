export type OutputStatus = { path: string; partialPath: string; finished: boolean; error: string | null }

export function outputStatusText(output: OutputStatus): string {
  if (output.error) return 'Failed'
  return output.finished ? 'Saved' : 'Writing'
}
