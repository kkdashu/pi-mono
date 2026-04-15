import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	isToolCallEventType,
	type ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";
import {
	formatSiteSkillDocList,
	getDefaultSharedDocNames,
	loadSiteSkillCatalog,
} from "../../skills/catalog.js";
import { matchSiteSkill } from "../../skills/matcher.js";
import {
	getGeneratedSkillsRoot,
	getBundledSkillsRoot,
} from "../../paths.js";
import {
	validateGeneratedSkillWriteTarget,
	validateSiteSkillIndexContent,
} from "../../skills/template.js";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS_ROOT = getBundledSkillsRoot();
const GENERATED_SKILLS_ROOT = getGeneratedSkillsRoot();

export function buildSiteSkillContextMessage(prompt: string, generatedSkillsRoot: string = GENERATED_SKILLS_ROOT): string {
	const catalog = loadSiteSkillCatalog(generatedSkillsRoot);
	const match = matchSiteSkill(prompt, catalog);
	if (!match) {
		return "";
	}

	const skillIndex = readFileSync(match.entry.skillFile, "utf8").trim();
	const defaultSharedDocs = getDefaultSharedDocNames(match.entry);
	const sharedSection =
		defaultSharedDocs.length > 0
			? defaultSharedDocs.map((relativePath) => `- ${relativePath}`).join("\n")
			: "- None indexed yet";
	const taskSection =
		match.relevantTaskDocs.length > 0
			? formatSiteSkillDocList(match.relevantTaskDocs)
			: match.entry.taskDocs.length > 0
				? formatSiteSkillDocList(match.entry.taskDocs.slice(0, 3))
				: "- No task docs yet";

	return [
		`Matched website skill for domain ${match.entry.domain}.`,
		`Skill root: ${match.entry.rootDir}`,
		`Read ${match.entry.skillFile} first, then load the most relevant docs listed below with the read tool.`,
		"",
		"[Website Skill Index]",
		skillIndex,
		"",
		"[Suggested Shared Docs]",
		sharedSection,
		"",
		"[Suggested Task Docs]",
		taskSection,
	].join("\n");
}

export function buildOctoGuidance(generatedSkillsRoot: string = GENERATED_SKILLS_ROOT): string {
	return [
		"",
		"## Octo Browser Guidance",
		"- Use the bundled agent-browser skill for browser automation instead of inventing your own browser workflow.",
		"- Generated website skills live under the generated skills root below.",
		`- Generated skills root: ${generatedSkillsRoot}`,
		"- There is exactly one top-level skill directory per website domain, for example site-x-com/.",
		"- In each website skill directory, SKILL.md is only the entry point and index.",
		"- Put shared website knowledge in shared/*.md.",
		"- Put task-specific workflows in tasks/*.md.",
		"- Do not put every task's full instructions into SKILL.md.",
		"- After completing a complex website workflow, create or update the website skill files immediately using write/edit.",
		"- If an existing website skill is outdated, incomplete, or wrong, patch it in the same task.",
	].join("\n");
}

function validateGeneratedSkillWrite(eventPath: string, content: string): string | undefined {
	const pathError = validateGeneratedSkillWriteTarget(eventPath, GENERATED_SKILLS_ROOT);
	if (pathError) {
		return pathError;
	}

	if (eventPath.endsWith("/SKILL.md") || eventPath.endsWith("\\SKILL.md")) {
		return validateSiteSkillIndexContent(content);
	}

	return undefined;
}

export default function octoSiteSkillsExtension(pi: ExtensionAPI) {
	pi.on("resources_discover", () => {
		return {
			skillPaths: [BUNDLED_SKILLS_ROOT, GENERATED_SKILLS_ROOT],
		};
	});

	pi.on("before_agent_start", async (event) => {
		const contextMessage = buildSiteSkillContextMessage(event.prompt);
		return {
			message: contextMessage
				? {
						customType: "octo-site-skill",
						content: contextMessage,
						display: true,
					}
				: undefined,
			systemPrompt: event.systemPrompt + buildOctoGuidance(),
		};
	});

	pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
		if (isToolCallEventType("write", event)) {
			const error = validateGeneratedSkillWrite(event.input.path, event.input.content);
			if (error) {
				return { block: true, reason: error };
			}
		}

		if (isToolCallEventType("edit", event)) {
			const error = validateGeneratedSkillWriteTarget(event.input.path, GENERATED_SKILLS_ROOT);
			if (error) {
				return { block: true, reason: error };
			}
		}

		return undefined;
	});
}
