import { describe, expect, it } from "vitest";
import { formatSiteSkillDocList, loadSiteSkillCatalog } from "../src/skills/catalog.js";
import { buildOctoGuidance, buildSiteSkillContextMessage } from "../src/extensions/site-skills/index.js";
import { extractPromptDomains, matchSiteSkill } from "../src/skills/matcher.js";
import {
	buildSiteSkillIndexTemplate,
	getSiteSkillName,
	getSiteSkillPaths,
	validateGeneratedSkillWriteTarget,
	validateSiteSkillIndexContent,
} from "../src/skills/template.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("site skill templates", () => {
	it("builds a single site skill name from a domain", () => {
		expect(getSiteSkillName("https://www.x.com/settings/security")).toBe("site-x-com");
	});

	it("creates a skill index template that keeps tasks outside SKILL.md", () => {
		const template = buildSiteSkillIndexTemplate("x.com");
		expect(template).toContain("name: site-x-com");
		expect(template).toContain("shared/navigation.md");
		expect(template).toContain("tasks/");
	});

	it("validates generated write targets", () => {
		const root = join(tmpdir(), "octo-browser-generated");
		const valid = validateGeneratedSkillWriteTarget(
			join(root, "site-x-com", "tasks", "change-password.md"),
			root,
		);
		const invalid = validateGeneratedSkillWriteTarget(join(root, "site-x-com", "tasks", "change-password.txt"), root);
		expect(valid).toBeUndefined();
		expect(invalid).toContain("Markdown");
	});

	it("validates SKILL.md frontmatter", () => {
		expect(validateSiteSkillIndexContent("## Missing frontmatter")).toContain("frontmatter");
		expect(
			validateSiteSkillIndexContent(`---
name: site-x-com
description: x.com skill
---
# x.com`),
		).toBeUndefined();
	});
});

describe("site skill catalog and matcher", () => {
	it("loads a site skill directory with shared and task docs", () => {
		const generatedRoot = mkdtempSync(join(tmpdir(), "octo-browser-skills-"));
		const { rootDir, skillFile, sharedDir, tasksDir } = getSiteSkillPaths(generatedRoot, "x.com");
		mkdirSync(sharedDir, { recursive: true });
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(
			skillFile,
			`---
name: site-x-com
description: x.com 网站操作 skill
metadata:
  octo:
    domain: x.com
---
# x.com
`,
		);
		writeFileSync(join(sharedDir, "navigation.md"), "# 导航\n");
		writeFileSync(join(tasksDir, "change-password.md"), "# 修改密码\n");

		const catalog = loadSiteSkillCatalog(generatedRoot);
		expect(catalog).toHaveLength(1);
		expect(catalog[0].domain).toBe("x.com");
		expect(catalog[0].aliases).toContain("x.com");
		expect(formatSiteSkillDocList(catalog[0].taskDocs)).toContain("tasks/change-password.md");
		expect(rootDir).toContain("site-x-com");
	});

	it("extracts domains and matches the relevant site skill", () => {
		const entry = {
			name: "site-x-com",
			domain: "x.com",
			aliases: ["x.com", "X"],
			rootDir: "/tmp/site-x-com",
			skillFile: "/tmp/site-x-com/SKILL.md",
			description: "x.com 网站操作 skill",
			skillContent: "# x.com",
			sharedDocs: [],
			taskDocs: [
				{
					title: "修改密码",
					relativePath: "tasks/change-password.md",
					absolutePath: "/tmp/site-x-com/tasks/change-password.md",
				},
			],
		};

		expect(extractPromptDomains("请去 https://x.com/settings/security 修改我的密码")).toContain("x.com");
		const match = matchSiteSkill("请去 x.com 修改我的密码", [entry]);
		expect(match?.entry.name).toBe("site-x-com");
		expect(match?.relevantTaskDocs[0]?.relativePath).toBe("tasks/change-password.md");
	});

	it("loads a legacy generated site skill and matches it by brand name", () => {
		const generatedRoot = mkdtempSync(join(tmpdir(), "octo-browser-legacy-"));
		const rootDir = join(generatedRoot, "site-xiaohongshu-com");
		const tasksDir = join(rootDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(
			join(rootDir, "SKILL.md"),
			`---
name: xiaohongshu-com
description: 小红书网站自动化操作技能沉淀
---

# 小红书 (xiaohongshu.com)
`,
		);
		writeFileSync(join(tasksDir, "like-post.md"), "# 点赞帖子\n");

		const catalog = loadSiteSkillCatalog(generatedRoot);
		expect(catalog).toHaveLength(1);
		expect(catalog[0].domain).toBe("xiaohongshu.com");
		expect(catalog[0].aliases).toContain("小红书");

		const match = matchSiteSkill("打开小红书网站，然后搜索 成都露营，第一个帖子 点赞", catalog);
		expect(match?.entry.domain).toBe("xiaohongshu.com");
		expect(match?.matchedAliases).toContain("小红书");
		expect(match?.relevantTaskDocs[0]?.relativePath).toBe("tasks/like-post.md");
	});
});

describe("site skill extension helpers", () => {
	it("builds a context message for a matched website skill", () => {
		const generatedRoot = mkdtempSync(join(tmpdir(), "octo-browser-extension-"));
		const { skillFile, sharedDir, tasksDir } = getSiteSkillPaths(generatedRoot, "x.com");
		mkdirSync(sharedDir, { recursive: true });
		mkdirSync(tasksDir, { recursive: true });
		writeFileSync(
			skillFile,
			`---
name: site-x-com
description: x.com 网站操作 skill
metadata:
  octo:
    domain: x.com
---
# x.com
`,
		);
		writeFileSync(join(sharedDir, "auth.md"), "# 登录\n");
		writeFileSync(join(tasksDir, "change-password.md"), "# 修改密码\n");

		const message = buildSiteSkillContextMessage("请去 x.com 修改我的密码", generatedRoot);
		expect(message).toContain("Matched website skill for domain x.com");
		expect(message).toContain("tasks/change-password.md");
		expect(buildOctoGuidance(generatedRoot)).toContain(generatedRoot);
	});
});
