# Troubleshooting

![Logs Viewer](assets/screenshots/logs-viewer.png)

Troubleshooting works best when you narrow the problem before changing settings. Start with what you can see in the UI, collect one piece of evidence from logs or status pages, then test the smallest workflow that matches the symptom.

## What you can do here

- Narrow a problem to UI, server, runtime, provider, profile, workspace, or channel configuration.
- Use logs, health checks, and status pages to collect evidence.
- Fix common startup, authentication, provider, WebSocket, terminal, and Docker issues.

## Typical workflow

1. Reproduce the issue once and note the page, action, and time.
2. Check whether the whole web UI is unavailable or only one feature is failing.
3. Open logs and look for the first relevant error near the time of the failure.
4. Confirm the active profile, provider, channel, or workspace involved in the failing action.
5. Make one change, retry the same action, and compare the result.
6. If the issue affects automation or outbound delivery, pause the job or channel while investigating.

## Common symptoms

| Symptom | Check first | Next action |
| --- | --- | --- |
| The web page does not load | Service status, port, container state, health endpoint | Restart the service only after checking logs for startup errors. |
| Login or setup fails | Account settings, browser session, server logs | Retry in a clean browser session and inspect authentication errors. |
| Chat opens but no response arrives | Model/provider readiness, runtime status, WebSocket activity | Test a simple message with a known provider before changing profiles. |
| A model is missing | Provider configuration, model visibility, credentials | Refresh the model list after confirming credentials are present. |
| A job does not run | Job status, schedule, run history, script settings | Run the job manually if safe, then inspect the run output. |
| A channel does not deliver | Channel status, recipient, token, job delivery target | Send a low-risk test and confirm where the message should appear. |
| Files or terminal do not work | Workspace path, permissions, terminal availability | Try a read-only action before editing files or running commands. |
| Docker deployment behaves differently after restart | Persistent volumes, environment values, logs | Confirm data paths and environment values are the same as the intended deployment. |

## Key controls

| Control | Use it for |
| --- | --- |
| Logs viewer | Finds runtime, server, provider, and channel errors. |
| Settings overview | Confirms account, privacy, session, and security-related choices. |
| Models and providers | Checks whether model access is ready. |
| Jobs history | Shows previous scheduled job runs and failures. |
| Devices and version pages | Confirms connected devices and running version information. |

## Screenshots

![Logs Viewer](assets/screenshots/logs-viewer.png)

![Settings Overview](assets/screenshots/settings-overview.png)

## Current troubleshooting notes

When diagnosing issues, pay close attention to runtime setup states, model and provider refresh behavior, and any pending write approvals. You should also verify managed gateway shutdowns and bridge process cleanup. If a page appears correct but an action fails, refresh the relevant model, profile, or runtime status before editing configurations.

## Notes and limits

- Do not paste full logs publicly without checking for tokens, local paths, profile names, or private message content.
- Avoid changing multiple unrelated settings in one pass; it makes the real fix harder to identify.
- If an action can send messages, run commands, or modify files, pause it before experimenting.

## Related pages

- [Devices, Version, and Logs](17-Devices-Version-Logs.md)
- [Settings and Security](14-Settings-and-Security.md)
- [Models and Providers](05-Models-and-Providers.md)
- [Channels and Gateways](13-Channels-and-Gateways.md)
