import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(CURRENT_DIR, "..");
const BUNDLED_SKILLS_ROOT = join(APP_ROOT, "skills");

export function getAppRoot(): string {
	return APP_ROOT;
}

export function getBundledSkillsRoot(): string {
	return BUNDLED_SKILLS_ROOT;
}

export function getOctoBrowserRoot(agentDir: string = getAgentDir()): string {
	return join(agentDir, "octo-browser");
}

export function getGeneratedSkillsRoot(agentDir: string = getAgentDir()): string {
	return join(getOctoBrowserRoot(agentDir), "skills", "generated");
}

export async function ensureGeneratedSkillsRoot(agentDir?: string): Promise<string> {
	const generatedRoot = getGeneratedSkillsRoot(agentDir);
	await mkdir(generatedRoot, { recursive: true });
	return generatedRoot;
}

