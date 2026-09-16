/**
 * Superpowers plugin for OpenCode (V1 + V2)
 *
 * This single default export supports both OpenCode major versions, using the
 * documented dual-version pattern:
 *
 *   - OpenCode 2 (V2) calls `setup(ctx)`. It registers every superpowers skill
 *     through `ctx.skill.transform` and injects the bootstrap into the first
 *     user message through the `context` session hook.
 *   - OpenCode 1 (V1) calls `server(input)`, which returns the legacy hooks
 *     (`config` + `experimental.chat.messages.transform`).
 *
 * The V2 loader validates the default export against `{ id, setup }` (or
 * `effect`) and ignores the extra `server` key; the V1 loader resolves the
 * default export's `server` function. Keeping both in one default export is
 * what lets one package serve both runtimes.
 *
 * Zero npm dependencies — Node.js/Bun built-in modules only. `Plugin.define`
 * from @opencode/plugin is an identity function, so a plain object is the same
 * thing at runtime and we avoid the dependency entirely.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The skills ship at the package root, two levels above this plugin file
// (<package>/.opencode/plugins/superpowers.js -> <package>/skills).
const superpowersSkillsDir = path.resolve(__dirname, "../../skills");

// ---------------------------------------------------------------------------
// Shared helpers (used by both the V1 and V2 code paths)
// ---------------------------------------------------------------------------

// Simple frontmatter extraction (avoid a dependency on skills-core for the
// bootstrap). Returns the parsed top-level frontmatter fields and the body.
const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: body };
};

// Module-level cache for the using-superpowers skill body. The SKILL.md file
// does not change during a session, so reading + parsing it once eliminates
// redundant fs.existsSync + fs.readFileSync + regex work on every agent step.
let _bodyCache = undefined; // undefined = not yet loaded, null = file missing
const readUsingSuperpowersBody = () => {
  if (_bodyCache !== undefined) return _bodyCache;

  const skillPath = path.join(superpowersSkillsDir, "using-superpowers", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    _bodyCache = null;
    return null;
  }

  const fullContent = fs.readFileSync(skillPath, "utf8");
  const { content } = extractAndStripFrontmatter(fullContent);
  _bodyCache = content;
  return _bodyCache;
};

// Build the bootstrap block: the using-superpowers skill body plus a
// harness-specific tool mapping. The body is read once (cached); the tool
// mapping is a constant, so this is a cheap string concatenation.
const buildBootstrap = (toolMapping) => {
  const content = readUsingSuperpowersBody();
  if (!content) return null;

  return `<EXTREMELY_IMPORTANT>
You have superpowers.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-superpowers" again - that would be redundant.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
};

// Discover every superpowers skill under the skills directory. Each skill is a
// subdirectory containing a SKILL.md. We read them once here (before the skill
// transform) so the transform callback stays cheap and repeatable — transforms
// are replayed onto a fresh registry, so the callback must not do disk I/O.
const discoverSkills = (skillsDir) => {
  const skills = [];
  if (!fs.existsSync(skillsDir)) return skills;

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    let raw;
    try {
      raw = fs.readFileSync(skillMdPath, "utf8");
    } catch {
      continue;
    }

    const { frontmatter, content } = extractAndStripFrontmatter(raw);
    skills.push({
      // The path-derived ID is the directory name (matches OpenCode's skill
      // ID convention), so `skill` tool lookups line up with the folder.
      id: entry.name,
      name: frontmatter.name || entry.name,
      description: frontmatter.description || "",
      // Absolute path to the real SKILL.md. OpenCode derives the skill's base
      // directory from this, which is what makes supporting files (scripts/,
      // references/) resolvable when the skill is loaded.
      //
      // OpenCode 2.0.4 renamed the 2.0.3 `location` field to `path` in the
      // Skill.Info schema, so the V2 registration uses `path`.
      path: skillMdPath,
      // Body without frontmatter — what OpenCode appends to the conversation
      // when the skill is loaded.
      content,
    });
  }

  return skills;
};

// ---------------------------------------------------------------------------
// Tool mappings (differ between V1 and V2 because OpenCode 2 renamed tools)
// ---------------------------------------------------------------------------

// OpenCode 1 tool names: bash, task, apply_patch, todowrite.
const V1_TOOL_MAPPING = `**Tool Mapping for OpenCode:**
When skills request actions, substitute OpenCode equivalents:
- Create or update todos → \`todowrite\`
- \`Subagent (general-purpose):\` → \`task\` with \`subagent_type: "general"\`
- Invoke a skill → OpenCode's native \`skill\` tool
- Read files → \`read\`
- Create, edit, or delete files → \`apply_patch\`
- Run shell commands → \`bash\`
- Search files → \`grep\`, \`glob\`
- Fetch a URL → \`webfetch\`

Use OpenCode's native \`skill\` tool to list and load skills.`;

// OpenCode 2 tool names: shell (was bash), subagent (was task), write/edit
// (was apply_patch). OpenCode 2 has no dedicated todo tool, so task tracking
// falls back to a plan file.
const V2_TOOL_MAPPING = `**Tool Mapping for OpenCode:**
When skills request actions, substitute OpenCode equivalents:
- Create or update todos → OpenCode has no dedicated todo tool; track progress in a plan file (e.g., TODO.md) or the model's task tracking
- \`Subagent (general-purpose):\` → the \`subagent\` tool
- Invoke a skill → OpenCode's native \`skill\` tool
- Read a file → \`read\`
- Create a file → \`write\`
- Edit a file → \`edit\`
- Delete a file → \`shell\` (rm)
- Run a shell command → \`shell\`
- Search file contents / find files by name → \`grep\`, \`glob\`
- Fetch a URL → \`webfetch\`
- Search the web → \`websearch\`

Use OpenCode's native \`skill\` tool to list and load skills.`;

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  id: "superpowers",

  // =========================================================================
  // OpenCode 2 (V2)
  // =========================================================================
  async setup(ctx) {
    // 1. Register the superpowers skills so OpenCode discovers them without
    //    symlinks or manual config. Load them before the transform (see
    //    discoverSkills) so the callback is cheap and repeatable.
    const skills = discoverSkills(superpowersSkillsDir);
    await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill);
    });

    // 2. Inject the bootstrap into the first user message of each session.
    //    Using a user message instead of a system message avoids:
    //      1. Token bloat from a system message repeated every turn.
    //      2. Multiple system messages breaking some models.
    //
    //    The `context` hook fires on every agent-loop model request, and
    //    event.messages is reloaded from the DB each step (the edit affects
    //    only the outgoing call, not persisted history). So the bootstrap is
    //    re-applied on every request and survives compaction. The guard only
    //    protects against an already-transformed in-memory array being passed
    //    through the hook again.
    await ctx.session.hook("context", (event) => {
      const bootstrap = buildBootstrap(V2_TOOL_MAPPING);
      if (!bootstrap || !event.messages.length) return;
      const firstUser = event.messages.find((m) => m.role === "user");
      if (!firstUser || !firstUser.content.length) return;

      if (
        firstUser.content.some(
          (p) => p.type === "text" && p.text.includes("EXTREMELY_IMPORTANT"),
        )
      ) {
        return;
      }

      firstUser.content.unshift({ type: "text", text: bootstrap });
    });
  },

  // =========================================================================
  // OpenCode 1 (V1) — legacy, kept for backward compatibility
  // =========================================================================
  async server(_input) {
    // Inject skills path into live config so OpenCode discovers superpowers
    // skills without requiring manual symlinks or config file edits.
    const configHook = async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(superpowersSkillsDir)) {
        config.skills.paths.push(superpowersSkillsDir);
      }
    };

    // Inject bootstrap into the first user message of each session.
    const messagesTransformHook = async (_input, output) => {
      const bootstrap = buildBootstrap(V1_TOOL_MAPPING);
      if (!bootstrap || !output.messages.length) return;
      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser || !firstUser.parts.length) return;

      // Guard: skip if the first user message already contains the bootstrap.
      if (
        firstUser.parts.some(
          (p) => p.type === "text" && p.text.includes("EXTREMELY_IMPORTANT"),
        )
      ) {
        return;
      }

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: "text", text: bootstrap });
    };

    return {
      config: configHook,
      "experimental.chat.messages.transform": messagesTransformHook,
    };
  },
};
