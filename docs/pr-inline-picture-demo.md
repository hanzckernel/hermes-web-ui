# PR inline picture workflow demo

This is a disposable demo PR for Han's own WUI fork.

It demonstrates the revised workflow shape:

- deterministic HTML/CSS source
- browser-rendered PNG output
- PR body embeds a hosted PNG
- no SVG in the production path
- no local `/private/tmp` image path in the PR body

The committed asset is intentional for this demo only, so the PR body can reference a stable raw PNG URL from the demo branch. The durable workflow should still prefer a body-only hosted PNG unless Han explicitly scopes a repo asset.
