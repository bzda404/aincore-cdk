import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AinCoreClient } from '../client.js'

// Mock the UDS transport
vi.mock('../transports/uds', () => {
  return {
    UDSTransport: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(true),
      call: vi.fn().mockResolvedValue({}),
      disconnect: vi.fn(),
      isConnected: true,
    })),
  }
})

describe('AinCoreClient', () => {
  let client: AinCoreClient
  let transport: {
    connect: ReturnType<typeof vi.fn>
    call: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    client = new AinCoreClient({ name: 'TestApp', vendor: 'TestVendor' })
    // Access the mocked transport via the private field
    transport = (client as unknown as { transport: typeof transport }).transport
  })

  describe('discover', () => {
    it('should call app.ping and return discovery result', async () => {
      transport.call.mockResolvedValueOnce({ status: 'ok', version: '1.0.0' })
      const result = await client.discover()
      expect(transport.connect).toHaveBeenCalled()
      expect(transport.call).toHaveBeenCalledWith('app.ping')
      expect(result).toEqual({ status: 'ok', version: '1.0.0' })
    })

    it('should return null when connect fails', async () => {
      transport.connect.mockResolvedValueOnce(false)
      const result = await client.discover()
      expect(result).toBeNull()
    })

    it('should return null when call throws', async () => {
      transport.call.mockRejectedValueOnce(new Error('timeout'))
      const result = await client.discover()
      expect(result).toBeNull()
    })
  })

  describe('register', () => {
    it('should call app.register and store appId', async () => {
      transport.call.mockResolvedValueOnce({ app_id: 'test-app-123' })
      const appId = await client.register()
      expect(appId).toBe('test-app-123')
      expect(transport.call).toHaveBeenCalledWith('app.register', {
        name: 'TestApp',
        icon: '',
        vendor: 'TestVendor',
      })
    })
  })

  describe('requestAuth (legacy)', () => {
    it('should auto-register if no appId', async () => {
      transport.call
        .mockResolvedValueOnce({ app_id: 'auto-reg-123' })
        .mockResolvedValueOnce({ granted: true, session_token: 'tok-abc' })

      const result = await client.requestAuth({ models: ['qwen-0.5b'] })
      expect(result.granted).toBe(true)
      expect(transport.call).toHaveBeenCalledTimes(2)
    })

    it('should store session token on grant', async () => {
      transport.call
        .mockResolvedValueOnce({ app_id: 'reg-1' })
        .mockResolvedValueOnce({ granted: true, session_token: 'my-token' })

      await client.requestAuth({ models: ['model-1'] })

      // Now chat should use the session token
      transport.call.mockResolvedValueOnce({ content: 'Hello!', usage: {} })
      await client.chat({ messages: [{ role: 'user', content: 'hi' }] })
      expect(transport.call).toHaveBeenCalledWith(
        'chat.completions',
        expect.objectContaining({ session_token: 'my-token' })
      )
    })
  })

  describe('chat', () => {
    it('should send chat completion request with session token', async () => {
      // Setup session
      transport.call
        .mockResolvedValueOnce({ app_id: 'reg-1' })
        .mockResolvedValueOnce({ granted: true, session_token: 'tok-1' })
      await client.requestAuth({ models: ['model-x'] })

      transport.call.mockResolvedValueOnce({
        content: 'Hello world!',
        model: 'qwen-0.5b',
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })

      const result = await client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
      })

      expect(result.content).toBe('Hello world!')
      expect(result.model).toBe('qwen-0.5b')
      expect(result.usage?.total_tokens).toBe(8)
    })

    it('should throw if not authorized', async () => {
      await expect(
        client.chat({ messages: [{ role: 'user', content: 'test' }] })
      ).rejects.toThrow()
    })

    it('should normalize OpenAI-style response format', async () => {
      transport.call
        .mockResolvedValueOnce({ app_id: 'reg-2' })
        .mockResolvedValueOnce({ granted: true, session_token: 'tok-2' })
      await client.requestAuth({ models: ['m'] })

      // Simulate OpenAI-style response
      transport.call.mockResolvedValueOnce({
        choices: [{ message: { role: 'assistant', content: 'OpenAI reply' } }],
        model: 'llama',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }] })
      expect(result.content).toBe('OpenAI reply')
    })
  })

  describe('search', () => {
    it('should call search_notes with query', async () => {
      transport.call
        .mockResolvedValueOnce({ app_id: 'reg-3' })
        .mockResolvedValueOnce({ granted: true, session_token: 'tok-3' })
      await client.requestAuth({ models: ['m'] })

      const mockResults = [{ path: '/note1.md', score: 0.95, snippet: 'match' }]
      transport.call.mockResolvedValueOnce(mockResults)

      const results = await client.search('test query')
      expect(transport.call).toHaveBeenCalledWith('search_notes', expect.objectContaining({
        query: 'test query',
        session_token: 'tok-3',
      }))
      expect(results).toEqual(mockResults)
    })
  })

  describe('listModels', () => {
    it('should list available models', async () => {
      transport.call
        .mockResolvedValueOnce({ app_id: 'reg-4' })
        .mockResolvedValueOnce({ granted: true, session_token: 'tok-4' })
      await client.requestAuth({ models: ['m'] })

      const models = [
        { id: 'qwen-0.5b', name: 'Qwen 0.5B', parameterSize: '0.5B' },
      ]
      transport.call.mockResolvedValueOnce(models)

      const result = await client.listModels()
      expect(result).toEqual(models)
    })
  })

  describe('disconnect', () => {
    it('should disconnect transport and clear session', () => {
      client.disconnect()
      expect(transport.disconnect).toHaveBeenCalled()
    })
  })

  describe('PKCE generation', () => {
    it('should return verifier and challenge', () => {
      const { verifier, challenge } = client.generatePKCE()
      expect(typeof verifier).toBe('string')
      expect(typeof challenge).toBe('string')
      expect(verifier.length).toBeGreaterThan(0)
      expect(challenge.length).toBeGreaterThan(0)
    })
  })

  describe('getStatus', () => {
    it('should call status method', async () => {
      const mockStatus = { running: true, version: '1.0.0', transport: 'uds' }
      transport.call.mockResolvedValueOnce(mockStatus)
      const status = await client.getStatus()
      expect(status).toEqual(mockStatus)
      expect(transport.call).toHaveBeenCalledWith('status')
    })
  })

  describe('getProfile', () => {
    it('should call profile.get and return profile', async () => {
      const mockProfile = {
        display_name: '小明',
        language: 'zh-CN',
        communication_style: 'concise',
        custom_instructions: '',
        preferences: {},
        updated_at: '2026-06-11T00:00:00Z',
      }
      transport.call.mockResolvedValueOnce(mockProfile)
      const result = await client.getProfile()
      expect(result).toEqual(mockProfile)
      expect(transport.call).toHaveBeenCalledWith('profile.get')
    })
  })

  describe('updateProfile', () => {
    it('should call profile.update with partial profile', async () => {
      const partial = { display_name: 'Alex', language: 'en' }
      const updated = {
        display_name: 'Alex',
        language: 'en',
        communication_style: '',
        custom_instructions: '',
        preferences: {},
        updated_at: '2026-06-11T00:01:00Z',
      }
      transport.call.mockResolvedValueOnce(updated)
      const result = await client.updateProfile(partial)
      expect(result).toEqual(updated)
      expect(transport.call).toHaveBeenCalledWith('profile.update', partial)
    })
  })
})
