import { relative, resolve, sep } from "node:path";

const MARKDOWN_EXTENSION = ".md";

function slugifyPart(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

export function normalizeDomain(input: string): string {
	const trimmed = input.trim().toLowerCase();
	const noProtocol = trimmed.replace(/^[a-z]+:\/\//, "");
	const noPath = noProtocol.split("/")[0];
	const noQuery = noPath.split("?")[0];
	return noQuery.replace(/^www\./, "");
}

export function getSiteSkillName(domain: string): string {
	return `site-${slugifyPart(normalizeDomain(domain).replace(/\./g, "-"))}`;
}

export function inferDomainFromSkillName(skillName: string): string | undefined {
	if (!skillName.startsWith("site-")) {
		return undefined;
	}

	const raw = skillName.slice("site-".length);
	if (!raw) {
		return undefined;
	}

	return raw.replace(/-/g, ".");
}

export function getSiteSkillPaths(generatedRoot: string, domain: string): {
	skillName: string;
	rootDir: string;
	skillFile: string;
	sharedDir: string;
	tasksDir: string;
} {
	const skillName = getSiteSkillName(domain);
	const rootDir = resolve(generatedRoot, skillName);
	return {
		skillName,
		rootDir,
		skillFile: resolve(rootDir, "SKILL.md"),
		sharedDir: resolve(rootDir, "shared"),
		tasksDir: resolve(rootDir, "tasks"),
	};
}

export function buildSiteSkillIndexTemplate(domain: string): string {
	const normalizedDomain = normalizeDomain(domain);
	const skillName = getSiteSkillName(normalizedDomain);

	return `---
name: ${skillName}
description: ${normalizedDomain} 网站操作 skill。适用于在 ${normalizedDomain} 上执行网页自动化任务。
metadata:
  octo:
    domain: ${normalizedDomain}
---
# ${normalizedDomain}

## 何时使用
- 用户要求在 ${normalizedDomain} 上执行网页操作

## 先读这些共享文档
- \`shared/navigation.md\`
- \`shared/auth.md\`

## 任务文档
- 在 \`tasks/\` 下为每个任务创建单独文档，例如 \`tasks/change-password.md\`

## 使用规则
- 先读本文件，再按需要读 \`shared/\` 和 \`tasks/\`
- 不要把所有任务细节都写进本文件
- 共享知识写进 \`shared/\`
- 具体任务步骤写进 \`tasks/\`
`;
}

export function buildSharedDocTemplate(domain: string, topic: "auth" | "navigation"): string {
	const normalizedDomain = normalizeDomain(domain);
	const title = topic === "auth" ? "认证与登录" : "导航与页面结构";
	return `# ${normalizedDomain} ${title}

## 适用范围
- ${normalizedDomain}

## 当前观察
- 待补充

## 常见失败信号
- 待补充
`;
}

export function isValidGeneratedSkillName(name: string): boolean {
	return /^site-[a-z0-9-]+$/.test(name);
}

export function validateGeneratedSkillWriteTarget(targetPath: string, generatedRoot: string): string | undefined {
	const resolvedRoot = resolve(generatedRoot);
	const resolvedTarget = resolve(targetPath);
	const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;

	if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootPrefix)) {
		return undefined;
	}

	const relPath = relative(resolvedRoot, resolvedTarget);
	if (!relPath || relPath.startsWith("..")) {
		return "Site skill writes must stay inside the generated skills root.";
	}

	const segments = relPath.split(sep);
	if (segments.length < 2 || segments.length > 3) {
		return "Generated site skills must use site-<domain>/(SKILL.md|shared/*.md|tasks/*.md).";
	}

	const [skillName, second, third] = segments;
	if (!isValidGeneratedSkillName(skillName)) {
		return `Invalid site skill directory "${skillName}". Expected site-<domain>.`;
	}

	if (segments.length === 2) {
		if (second !== "SKILL.md") {
			return "Only SKILL.md is allowed at the top level of a generated site skill.";
		}
		return undefined;
	}

	if (second !== "shared" && second !== "tasks") {
		return 'Only "shared" and "tasks" subdirectories are allowed in generated site skills.';
	}

	if (!third.endsWith(MARKDOWN_EXTENSION)) {
		return "Only Markdown files are allowed in generated site skills.";
	}

	return undefined;
}

export function validateSiteSkillIndexContent(content: string): string | undefined {
	const trimmed = content.trim();
	if (!trimmed.startsWith("---")) {
		return "SKILL.md must start with YAML frontmatter.";
	}
	if (!trimmed.includes("\nname:")) {
		return "SKILL.md frontmatter must include name.";
	}
	if (!trimmed.includes("\ndescription:")) {
		return "SKILL.md frontmatter must include description.";
	}
	return undefined;
}

