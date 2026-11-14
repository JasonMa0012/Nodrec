import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core'

export { isTauri } from '@tauri-apps/api/core'

export async function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try { return await tauriInvoke<T>(command, args, options) }
  catch (error) {
    console.error(`Command ${command} failed`, error)
    throw error
  }
}
