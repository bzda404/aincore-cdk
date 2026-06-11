import { AinCoreClient } from '../src/index'

async function main(): Promise<void> {
  const client = new AinCoreClient({
    name: 'AinCore SDK Example',
    vendor: 'AinCore',
    icon: 'SDK',
  })

  const discovery = await client.discover()
  if (!discovery) {
    throw new Error('AinCore 未运行。请先启动 pnpm run dev:hub')
  }
  console.log(`Core 已连接: ${discovery.name} (${discovery.transport || 'uds'})`)

  await client.registerOAuth()
  const { verifier, challenge } = client.generatePKCE()
  const auth = await client.authorize('inference:read offline_access', challenge, 'sdk-example')
  await client.exchangeCode(auth.authorizationCode, verifier)

  const before = await client.getStatus()
  console.log(`Core 当前模型: ${before.loadedModel || '未加载'} · 状态: ${before.status}`)

  if (process.argv.includes('--revoke')) {
    await client.revokeAuth()
    try {
      await client.chat({
        messages: [{ role: 'user', content: '这次调用应该失败。' }],
        max_tokens: 16,
      })
      throw new Error('撤销后调用仍然成功')
    } catch (err) {
      console.log(`授权已撤销，后续调用被 Core 拒绝: ${String(err)}`)
      client.disconnect()
      return
    }
  }

  const result = await client.chat({
    messages: [{ role: 'user', content: '用一句话介绍 AinCore。' }],
    max_tokens: 80,
    temperature: 0.2,
  })

  console.log(`Chat 使用模型: ${result.model || before.loadedModel || 'Core 当前模型'}`)
  console.log(`回复: ${result.content}`)
  client.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
