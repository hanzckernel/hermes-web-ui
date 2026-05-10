# ADR 0001: Kanban canonical adapter boundary

## Status

Accepted for the current parity bridge stack.

## Context

The Web UI Kanban integration has been hardened in layers:

- every task action carries an explicit board context;
- server controllers validate request inputs before invoking Hermes;
- capability status is represented as `supported`, `partial`, or `missing`;
- events, relationships, bulk updates, and home notification subscriptions are now bridged through canonical Hermes CLI commands.

The remaining architecture problem is that the Web UI service still owns too much command-shape knowledge. It knows which CLI subcommand implements each canonical action, how to parse each response, and which semantics are only partial. That is acceptable for the bridge stage, but it should not become the final adapter architecture.

## Decision

Introduce an explicit Kanban backend adapter boundary in the server service layer.

For the current stack, the only concrete adapter is a CLI bridge:

- `kind = cli`
- `mode = bridge`
- `canonicalProxy = missing`

The service exposes this adapter metadata through the Kanban capabilities payload and begins centralizing CLI execution behind adapter methods. This preserves existing behavior while making the gap to a future plugin-native canonical proxy visible and testable.

## Consequences

### Now

- The public Web UI API remains stable.
- Existing route/controller/client-store behavior is unchanged.
- Capability metadata now states that the backend is a CLI bridge, not a canonical proxy.
- New bridge code should use the adapter execution boundary instead of directly calling `execFileAsync` or `spawn`. Existing direct calls can be migrated incrementally when their error contracts are covered by tests.

### Later

A plugin-native canonical proxy can replace or sit beside the CLI adapter without changing Web UI route contracts. The future adapter should own:

- canonical request/response schemas;
- typed event payloads beyond refresh invalidation;
- bulk patch/reprioritize semantics;
- runtime notification targets beyond static home channels;
- capability discovery from the canonical provider, not hardcoded Web UI tables.

## Non-goals

This ADR does not implement the plugin-native proxy. It also does not claim full parity for events, bulk updates, notification management, or arbitrary adapter discovery. Those remain explicitly partial or missing in capabilities.

## Verification contract

Changes to this boundary should keep these checks green:

```bash
git diff --check
npm test -- tests/client/kanban-api.test.ts tests/client/kanban-store.test.ts tests/client/kanban-view.test.ts tests/client/kanban-task-drawer.test.ts tests/server/hermes-kanban-service.test.ts tests/server/kanban-controller.test.ts tests/server/kanban-routes.test.ts
npm run build
```
