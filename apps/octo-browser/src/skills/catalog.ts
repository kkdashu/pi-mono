import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { inferDomainFromSkillName } from "./template.js";

export interface SiteSkillDocument {
	title: string;
	relativePath: string;
	absolutePath: string;
}

export interface SiteSkillCatalogEntry {
	name: string;
	domain: string;
	aliases: string[];
	rootDir: string;
	skillFile: string;
	description: string;
	skillContent: string;
	sharedDocs: SiteSkillDocument[];
	taskDocs: SiteSkillDocument[];
}

interface OctoFrontmatter {
	name?: string;
	description?: string;
	metadata?: {
		octo?: {
			domain?: string;
			aliases?: string[];
		};
	};
}

function readMarkdownTitle(content: string, fallback: string): string {
	const heading = content
		.split(/\r?\n/)
		.find((line) => line.trim().startsWith("# "))
		?.trim();
	return heading ? heading.replace(/^#\s+/, "") : fallback;
}

function readMarkdownDocuments(dir: string, relativePrefix: string): SiteSkillDocument[] {
	if (!existsSync(dir)) {
		return [];
	}

	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => {
			const absolutePath = join(dir, entry.name);
			const content = readFileSync(absolutePath, "utf8");
			return {
				title: readMarkdownTitle(content, entry.name.replace(/\.md$/, "")),
				relativePath: `${relativePrefix}/${entry.name}`,
				absolutePath,
			};
		});
}

function extractDomainsFromText(value: string): string[] {
	return [...value.matchAll(/\b([a-z0-9.-]+\.[a-z]{2,})(?:[/?#:\s)]|$)/gi)].map((match) => match[1].toLowerCase());
}

function inferDomainFromLegacyName(name: string): string | undefined {
	const normalized = name.trim().toLowerCase();
	const withoutPrefix = normalized.startsWith("site-") ? normalized.slice("site-".length) : normalized;
	if (!withoutPrefix.includes("-") || !/^[a-z0-9-]+$/.test(withoutPrefix)) {
		return undefined;
	}

	const parts = withoutPrefix.split("-").filter(Boolean);
	if (parts.length < 2) {
		return undefined;
	}

	const tld = parts[parts.length - 1];
	if (!/^[a-z]{2,10}$/.test(tld)) {
		return undefined;
	}

	return parts.join(".");
}

function buildAliases(
	domain: string,
	directoryName: string,
	skillTitle: string,
	explicitAliases: string[] | undefined,
): string[] {
	const aliases = new Set<string>();
	const title = skillTitle.trim();
	const titleWithoutParentheses = title
		.replace(/\([^)]*\)/g, " ")
		.replace(/（[^）]*）/g, " ")
		.trim();

	for (const value of [
		domain,
		...extractDomainsFromText(title),
		title,
		titleWithoutParentheses,
		...(explicitAliases ?? []),
	]) {
		const trimmed = value.trim();
		if (trimmed) {
			aliases.add(trimmed);
		}
	}

	const inferredFromDirectory = inferDomainFromSkillName(directoryName) ?? inferDomainFromLegacyName(directoryName);
	if (inferredFromDirectory) {
		aliases.add(inferredFromDirectory);
	}

	return [...aliases];
}

export function loadSiteSkillCatalog(generatedRoot: string): SiteSkillCatalogEntry[] {
	if (!existsSync(generatedRoot)) {
		return [];
	}

	const entries: SiteSkillCatalogEntry[] = [];

	for (const entry of readdirSync(generatedRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) {
			continue;
		}

		const rootDir = join(generatedRoot, entry.name);
		const skillFile = join(rootDir, "SKILL.md");
		if (!existsSync(skillFile)) {
			continue;
		}

		const skillContent = readFileSync(skillFile, "utf8");
		const { frontmatter } = parseFrontmatter<OctoFrontmatter>(skillContent);
		const name = frontmatter.name ?? entry.name;
		const skillTitle = readMarkdownTitle(skillContent, entry.name);
		const domain =
			frontmatter.metadata?.octo?.domain ??
			inferDomainFromSkillName(name) ??
			inferDomainFromSkillName(entry.name) ??
			inferDomainFromLegacyName(name) ??
			inferDomainFromLegacyName(entry.name) ??
			extractDomainsFromText(skillTitle)[0];

		if (!domain || !frontmatter.description) {
			continue;
		}

		entries.push({
			name,
			domain,
			aliases: buildAliases(domain, entry.name, skillTitle, frontmatter.metadata?.octo?.aliases),
			rootDir,
			skillFile,
			description: frontmatter.description,
			skillContent,
			sharedDocs: readMarkdownDocuments(join(rootDir, "shared"), "shared"),
			taskDocs: readMarkdownDocuments(join(rootDir, "tasks"), "tasks"),
		});
	}

	return entries;
}

export function formatSiteSkillDocList(docs: SiteSkillDocument[]): string {
	return docs.map((doc) => `- ${doc.relativePath} (${doc.title})`).join("\n");
}

export function getDefaultSharedDocNames(entry: SiteSkillCatalogEntry): string[] {
	const sharedNames = new Set(entry.sharedDocs.map((doc) => basename(doc.relativePath)));
	const defaults: string[] = [];
	if (sharedNames.has("navigation.md")) {
		defaults.push("shared/navigation.md");
	}
	if (sharedNames.has("auth.md")) {
		defaults.push("shared/auth.md");
	}
	return defaults;
}
