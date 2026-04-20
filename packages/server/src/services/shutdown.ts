export function bindShutdown(server: any): void {
  let isShuttingDown = false

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    console.log(`\n[${signal}] shutting down...`)

    try {
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => {
            console.log('✓ http server closed')
            resolve()
          })
        })
      }
    } catch (err) {
      console.error('shutdown error:', err)
    }

    process.exit(0)
  }

  process.once('SIGUSR2', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err)
    shutdown('uncaughtException')
  })

  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection:', err)
    shutdown('unhandledRejection')
  })
}
