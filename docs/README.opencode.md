# Superpowers for OpenCode

Complete guide for using Superpowers with [OpenCode.ai](https://opencode.ai).

Superpowers supports both **OpenCode 2** and **OpenCode 1** from the same
package. The plugin default-exports a single definition carrying both the V2
`setup` entrypoint and the V1 `server` entrypoint, so one install works on
either runtime. This guide focuses on OpenCode 2; the only V1 difference is
the config key name (`plugin` instead of `plugins`).

## Installation

Add superpowers to the `plugins` array in your `opencode.json` (global or
project-level):

```json
{
  "plugins": ["superpowers@git+https://github.com/obra/superpowers.git"]
}
```

Restart OpenCode. The plugin installs through OpenCode's plugin manager and
registers all skills.

Verify by asking: "Tell me about your superpowers"

OpenCode uses its own plugin install. If you also use Claude Code, Codex, or
another harness, install Superpowers separately for each one.

### Migrating from the old symlink-based install

If you previously installed superpowers using `git clone` and symlinks, remove the old setup:

```bash
# Remove old symlinks
rm -f ~/.config/opencode/plugins/superpowers.js
rm -rf ~/.config/opencode/skills/superpowers

# Optionally remove the cloned repo
rm -rf ~/.config/opencode/superpowers

# Remove skills.paths from opencode.json if you added one for superpowers
```

Then follow the installation steps above.

## Usage

### Finding Skills

Use OpenCode's native `skill` tool to list all available skills:

```
use skill tool to list skills
```

### Loading a Skill

```
use skill tool to load brainstorming
```

### Personal Skills

Create your own skills in `~/.config/opencode/skills/`:

```bash
mkdir -p ~/.config/opencode/skills/my-skill
```

Create `~/.config/opencode/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: Use when [condition] - [what it does]
---

# My Skill

[Your skill content here]
```

### Project Skills

Create project-specific skills in `.opencode/skills/` within your project.

**Skill Priority:** Project skills > Personal skills > Superpowers skills

## Updating

OpenCode installs Superpowers through a git-backed package spec. Some OpenCode
and Bun versions pin that resolved git dependency in a lockfile or cache, so a
restart may not pick up the newest Superpowers commit. If updates do not appear,
clear OpenCode's package cache or reinstall the plugin.

To pin a specific version, use a branch or tag:

```json
{
  "plugins": ["superpowers@git+https://github.com/obra/superpowers.git#v5.0.3"]
}
```

## How It Works

The plugin does two things on OpenCode 2:

1. **Registers the skills** through the `ctx.skill.transform` hook. It reads
   every `skills/<name>/SKILL.md` and adds it to OpenCode's skill registry with
   its real path as the `location`, so each skill's base directory (and its
   `scripts/` and `references/` supporting files) resolve correctly when the
   skill is loaded.
2. **Injects the bootstrap** through the `ctx.session.hook("context", ...)`
   hook, prepending the `using-superpowers` skill content (plus an OpenCode
   tool mapping) to the first user message of each session. Using a user
   message instead of a system message avoids token bloat from a system message
   repeated every turn and sidesteps models that choke on multiple system
   messages. The hook fires on every agent-loop model request and the edit
   affects only the outgoing call, so the bootstrap is re-applied each request
   and survives compaction.

On OpenCode 1 the same package instead returns the legacy `config` hook (which
pushes the skills path into live config) and the
`experimental.chat.messages.transform` hook (which injects the bootstrap).

### Tool Mapping

Skills speak in actions rather than naming any one runtime's tools. On OpenCode
2 these resolve to:

- "Create or update todos" → OpenCode 2 has no dedicated todo tool; track progress in a plan file (e.g., `TODO.md`) or the model's task tracking
- `Subagent (general-purpose):` template → the `subagent` tool
- "Invoke a skill" → OpenCode's native `skill` tool
- "Read a file" → `read`
- "Create a file" → `write`
- "Edit a file" → `edit`
- "Delete a file" → `shell` (rm)
- "Run a shell command" → `shell`
- "Search file contents" / "find files by name" → `grep`, `glob`
- "Fetch a URL" → `webfetch`
- "Search the web" → `websearch`

(Verified against the installed OpenCode 2 CLI's tool inventory.)

## Troubleshooting

### Plugin not loading

1. Check OpenCode logs: `opencode run --print-logs "hello" 2>&1 | grep -i superpowers`
2. Verify the plugin line in your `opencode.json` is correct
3. Make sure you're running a recent version of OpenCode

On OpenCode 2 the plugin must export a default definition with an `id` and a
`setup` function. If you see "Plugin must export a default definition with an
id and an effect or setup function", you're loading an older (V1-only) build —
update Superpowers.

### Windows install issues

Some Windows OpenCode builds have upstream installer issues with git-backed
plugin specs, including cache paths for `git+https` URLs and Bun not finding
`git.exe` even when it works in a normal terminal. If OpenCode cannot install
the plugin, try installing with system npm and pointing OpenCode at the local
package:

```powershell
npm install superpowers@git+https://github.com/obra/superpowers.git --prefix "$HOME\.config\opencode"
```

Then use the installed package path in `opencode.json`:

```json
{
  "plugins": ["~/.config/opencode/node_modules/superpowers"]
}
```

### Skills not found

1. Use OpenCode's `skill` tool to list available skills
2. Check that the plugin is loading (see above)
3. Each skill needs a `SKILL.md` file with valid YAML frontmatter

### Bootstrap not appearing

1. Make sure you're on OpenCode 2 (the bootstrap uses the V2 `context` hook)
2. Restart OpenCode after config changes
3. The bootstrap is injected into the first user message; a brand-new session
   on a freshly started background service can miss it on the very first
   message and pick it up from the second message onward

## Getting Help

- Report issues: https://github.com/obra/superpowers/issues
- Main documentation: https://github.com/obra/superpowers
- OpenCode docs: https://opencode.ai/v2/docs/