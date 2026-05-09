import fs from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import path from 'node:path';

export interface SkillSummary {
  name: string;
  description: string;
  path: string; // absolute path to skill directory
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Only extracts name and description (the discovery fields).
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const frontmatter: Record<string, string> = {};
  let currentKey = '';

  for (const line of lines) {
    const keyVal = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (keyVal) {
      currentKey = keyVal[1];
      frontmatter[currentKey] = keyVal[2].trim();
    } else if (currentKey) {
      // continuation of previous key (multi-line, indented)
      const trimmed = line.trim();
      if (trimmed) frontmatter[currentKey] += ' ' + trimmed;
    }
  }

  if (!frontmatter.name || !frontmatter.description) return null;
  return { name: frontmatter.name, description: frontmatter.description };
}

/**
 * Scan the skills/ directory and return summaries of all discovered skills.
 * Returns empty array if skills/ doesn't exist.
 */
export async function discoverSkills(skillsDir: string): Promise<SkillSummary[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return []; // skills/ dir doesn't exist
  }

  const skills: SkillSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    try {
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (fm && fm.name) {
        skills.push({
          name: fm.name,
          description: fm.description,
          path: skillDir,
        });
      }
    } catch {
      // skip skills without readable SKILL.md
    }
  }

  return skills;
}

/**
 * Build the skills section of the system prompt.
 */
export function formatSkillsPrompt(skills: SkillSummary[], skillsDir: string): string {
  if (skills.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Agent Skills');
  lines.push('');
  lines.push('You have access to Agent Skills — portable, version-controlled folders that give you specialized knowledge and workflows. Skills follow the agentskills.io spec.');
  lines.push('');
  lines.push('### Available skills');
  lines.push('');
  for (const skill of skills) {
    lines.push(`- **${skill.name}**: ${skill.description}`);
  }
  lines.push('');
  lines.push('### How to use skills');
  lines.push('');
  lines.push(`Skills are located in \`${skillsDir}/\`. Each skill is a folder containing:`);
  lines.push('- `SKILL.md` — the full skill instructions (load this when the skill is activated)');
  lines.push('- `scripts/` — executable code the skill may use');
  lines.push('- `references/` — additional documentation');
  lines.push('- `assets/` — templates and resources');
  lines.push('');
  lines.push('When a task matches a skill\'s description, activate it by reading its `SKILL.md` file, then follow the instructions. Load other skill files as needed.');

  return lines.join('\n');
}
