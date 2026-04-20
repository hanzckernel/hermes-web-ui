let gatewayManager: any = null

export function getGatewayManagerInstance(): any {
  return gatewayManager
}

export async function initGatewayManager(): Promise<void> {
  const { GatewayManager } = await import('./hermes/gateway-manager')
  const { getActiveProfileName } = await import('./hermes/hermes-profile')
  const { setGatewayManager } = await import('../routes/hermes/gateways')

  const activeProfile = getActiveProfileName()
  gatewayManager = new GatewayManager(activeProfile)
  setGatewayManager(gatewayManager)

  await gatewayManager.detectAllOnStartup()
  await gatewayManager.startAll()
}
