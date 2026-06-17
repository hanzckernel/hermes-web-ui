# Channels and Gateways

![Channels Integrations](assets/screenshots/channels-integrations.png)

Channels and Gateways connect the web UI to external communication surfaces. Use this page to check which integrations are configured, where outbound messages may go, and whether a channel is safe to use for jobs, notifications, or interactive conversations.

## What you can do here

- Review connected channel status.
- Configure supported gateway settings.
- Understand where replies or job output may be delivered.
- Diagnose channel connection issues.

## Typical workflow

1. Open Channels and choose the integration you want to review.
2. Confirm the channel status and the destination that will receive messages.
3. Add or update the required configuration, such as a token, webhook, workspace, or recipient value.
4. Save the configuration.
5. Send a low-risk test message or run a safe test job.
6. Confirm the message arrives in the expected place before using the channel for real work.

## Key controls

| Control | Use it for |
| --- | --- |
| Channel list | Shows supported integrations and their current status. |
| Gateway configuration | Stores platform-specific connection details. |
| Status indicators | Shows whether a channel appears ready or needs attention. |
| Delivery target | Determines where job output or assistant messages may be sent. |
| Test action or safe job run | Confirms the channel works without exposing sensitive content. |

## Safe test checklist

- Use a short, non-sensitive message.
- Confirm the exact recipient, room, topic, or webhook destination.
- Check that the message appears once and in the expected channel.
- If a job uses the channel, inspect the job's delivery settings before enabling a schedule.

## Screenshots

![Channels Integrations](assets/screenshots/channels-integrations.png)

## Current gateway behavior

Managed gateways are configured to cleanly stop during application shutdown. If a gateway exits unexpectedly during a managed runtime session, it can automatically respawn to maintain connectivity. For channel delivery, always verify the active channel status and target destination after startup or profile changes.

## Notes and limits

- Channel settings can send messages outside the web UI. Confirm recipients and tokens before enabling delivery.
- Never publish screenshots that expose bot tokens, webhook URLs, private channel identifiers, or message recipients.
- If delivery fails, check both the channel configuration and the job or workflow that attempted to send the message.

## Related pages

- [Jobs and Cron](09-Jobs-and-Cron.md)
- [Settings and Security](14-Settings-and-Security.md)
- [Troubleshooting](19-Troubleshooting.md)
