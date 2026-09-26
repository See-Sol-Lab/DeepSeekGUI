/**
 * DeepSeekGUI: official Chat Completions roots saved by releases before the
 * Messages-only adapter (carried into the profile by the settings.yaml import,
 * or supplied through DEEPSEEK_BASE_URL) resolve to the Messages root; every
 * other endpoint is left exactly as configured.
 */
import { describe, expect, it } from 'vitest'
import { migrateLegacyBaseURL, PUBLIC_BASE_URL, resolveAdapterOptions } from '../src/config.ts'

describe('legacy official baseURL migration', () => {
  it.each([
    'https://api.deepseek.com',
    'https://api.deepseek.com/',
    'https://api.deepseek.com/v1',
    'https://api.deepseek.com/v1/',
    'https://api.deepseek.com/beta',
  ])('maps the Chat Completions root %s to the Messages root', (legacy) => {
    expect(migrateLegacyBaseURL(legacy)).toBe(PUBLIC_BASE_URL)
    expect(resolveAdapterOptions({ baseURL: legacy }).baseURL).toBe(PUBLIC_BASE_URL)
  })

  it.each([
    'https://api.deepseek.com/anthropic',
    'https://api.deepseek.com/anthropic/v1',
    'https://proxy.example.com/v1',
    'http://api.deepseek.com',
    'https://api.deepseek.com:8443',
    'https://api.deepseek.com/v2',
    'not a url',
  ])('leaves %s untouched', (endpoint) => {
    expect(migrateLegacyBaseURL(endpoint)).toBe(endpoint)
  })

  it('applies to the environment endpoint as well', () => {
    const environment = { get: (name: string) => (name === 'DEEPSEEK_BASE_URL' ? { value: 'https://api.deepseek.com' } : undefined) }
    expect(resolveAdapterOptions({}, environment as never).baseURL).toBe(PUBLIC_BASE_URL)
  })
})
