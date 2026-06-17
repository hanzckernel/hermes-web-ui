# Files and Workspaces

![Files Workspace Drawer](assets/screenshots/files-workspace-drawer.png)

Files and Workspaces lets you inspect project files without leaving the browser. Use it to browse folders, preview content, move files in or out of the workspace, and make small file changes when the deployment allows editing.

## What you can do here

- Browse workspace folders and files.
- Preview common text and document formats.
- Upload or download files.
- Edit, rename, copy, move, or delete supported files.
- Use files alongside Chat when a task needs project context.

## Typical workflow

1. Open Files from the sidebar or open the file drawer from Chat.
2. Navigate to the workspace and folder you need.
3. Preview the file before taking action.
4. Download or copy content if you only need to inspect it.
5. Use edit, rename, move, copy, upload, or delete only after confirming the path and intended result.
6. Return to Chat with the exact file context or outcome.

## Key controls

| Control | Use it for |
| --- | --- |
| File tree | Moves through folders and selects files. |
| Preview pane | Shows supported file content before you edit or download it. |
| Upload and download | Moves files into or out of the workspace. |
| Rename, copy, move, delete | Changes workspace structure. Use these actions carefully. |
| Chat file drawer | Keeps file context visible while you discuss or work through a task. |

## Action guide

| Action | Check before using it |
| --- | --- |
| Preview | Confirm the file is the one you expected. |
| Edit | Make sure the file is not generated, binary, or controlled by another process. |
| Upload | Confirm the destination folder and whether an existing file may be overwritten. |
| Download | Review whether the file contains private or credential-bearing content. |
| Delete or move | Confirm the path and that no running workflow depends on it. |

## Screenshots

![Files Workspace Drawer](assets/screenshots/files-workspace-drawer.png)

## Current file handling behavior

Workspace folders present direct actions directly from the user interface, simplifying the process of opening, managing, and using files without switching contexts. File handling incorporates strict validation for literal-dot paths and malformed import filenames to prevent errors, though destructive actions still require careful path verification.

## Notes and limits

- File actions mutate workspace data. Verify paths before editing or deleting.
- Do not expose private files in screenshots or shared manual examples.
- For risky edits, use a branch, copy, or backup outside the web UI before changing the file.

## Related pages

- [Chat and Sessions](03-Chat-and-Sessions.md)
- [Web Terminal](15-Web-Terminal.md)
- [Troubleshooting](19-Troubleshooting.md)
