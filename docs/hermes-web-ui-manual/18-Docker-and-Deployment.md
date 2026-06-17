# Docker and Deployment

![Startup Login](assets/screenshots/startup-login.png)

Use this page when you are getting Hermes Web UI running in a local, server, or containerized environment. The goal of a deployment is simple: the web app opens, the login or setup screen appears, health checks respond, and logs do not show runtime or configuration errors.

## What you can do here

- Install dependencies and start the development or production server.
- Use Docker Compose when containerized deployment is preferred.
- Understand persistent storage and environment variables at a high level.
- Check health endpoints and logs after startup.

## Choose a deployment path

| Situation | Use |
| --- | --- |
| You are developing or testing changes locally | npm or the project setup script |
| You want repeatable service startup on a machine | Docker Compose |
| You are moving between machines | Docker Compose plus persistent volumes |
| The UI opens but features fail | Logs, health checks, profiles, and provider settings |

## Typical workflow

1. Choose the deployment path that matches your environment.
2. Configure required environment values and persistent storage before starting the service.
3. Start the server or containers.
4. Open the web UI and confirm that the login or setup screen appears.
5. Check the health endpoint and logs before adding providers, channels, or scheduled jobs.
6. If the page loads but runtime features fail, move to [Troubleshooting](19-Troubleshooting.md) rather than changing several settings at once.

## Key controls

| Control | Use it for |
| --- | --- |
| Startup command or service | Starts the web server and supporting runtime pieces. |
| Environment configuration | Supplies ports, paths, provider settings, and other deployment-specific values. |
| Persistent storage | Keeps profiles, history, jobs, and configuration across restarts. |
| Health endpoint | Confirms that the web service is responding. |
| Logs | Shows startup errors, missing configuration, and runtime failures. |

## Screenshots

![Startup Login](assets/screenshots/startup-login.png)

The login screen is the first visual confirmation that the web app is reachable. It does not prove that every provider, channel, job, or runtime bridge is ready, so follow it with a health and log check.

## Current deployment behavior

The runtime setup procedure first checks for an existing local runtime before presenting download-source choices. Static asset delivery is optimized for performance through packaged-file compression. Additionally, desktop builds gracefully shut down managed servers, bridges, and gateways, which minimizes the risk of orphaned processes after quitting or running updates.

## Notes and limits

- Do not put credentials in screenshots, shared compose files, or copied logs.
- Treat environment values and persistent paths as deployment-specific; do not assume another machine uses the same layout.
- After an update, verify the UI, health endpoint, and one simple chat or provider action before scheduling automated work.

## Related pages

- [Quick Start](01-Quick-Start.md)
- [Settings and Security](14-Settings-and-Security.md)
- [Devices, Version, and Logs](17-Devices-Version-Logs.md)
- [Troubleshooting](19-Troubleshooting.md)
