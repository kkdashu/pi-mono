import type { SiteSkillCatalogEntry, SiteSkillDocument } from "./catalog.js";
import { normalizeDomain } from "./template.js";

export interface SiteSkillMatch {
	entry: SiteSkillCatalogEntry;
	matchedDomains: string[];
	matchedAliases: string[];
	relevantTaskDocs: SiteSkillDocument[];
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);
}

function normalizePromptText(value: string): string {
	return value.toLowerCase().replace(/\s+/g, "");
}

export function extractPromptDomains(prompt: string): string[] {
	const domains = new Set<string>();

	const urlMatches = prompt.matchAll(/\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#\s]|$)/gi);
	for (const match of urlMatches) {
		domains.add(normalizeDomain(match[1]));
	}

	const domainMatches = prompt.matchAll(/\b([a-z0-9-]+\.[a-z]{2,})(?:[/?#:\s]|$)/gi);
	for (const match of domainMatches) {
		domains.add(normalizeDomain(match[1]));
	}

	return [...domains];
}

function scoreTaskDoc(doc: SiteSkillDocument, prompt: string): number {
	const promptTokens = new Set(tokenize(prompt));
	const filenameTokens = tokenize(doc.relativePath.replace(/\.md$/i, ""));
	const titleTokens = tokenize(doc.title);

	let score = 0;
	for (const token of [...filenameTokens, ...titleTokens]) {
		if (promptTokens.has(token)) {
			score += 1;
		}
	}

	return score;
}

export function matchSiteSkill(prompt: string, entries: SiteSkillCatalogEntry[]): SiteSkillMatch | undefined {
	const promptDomains = extractPromptDomains(prompt);
	const normalizedDomains = new Set(promptDomains.map((domain) => normalizeDomain(domain)));
	const promptText = normalizePromptText(prompt);
	const matchingEntries = entries.filter((entry) => {
		if (normalizedDomains.has(normalizeDomain(entry.domain))) {
			return true;
		}

		return entry.aliases.some((alias) => {
			const normalizedAlias = normalizePromptText(alias);
			return normalizedAlias.length > 0 && promptText.includes(normalizedAlias);
		});
	});
	if (matchingEntries.length === 0) {
		return undefined;
	}

	const bestEntry = matchingEntries.sort((a, b) => a.domain.localeCompare(b.domain))[0];
	const matchedAliases = bestEntry.aliases.filter((alias) => {
		const normalizedAlias = normalizePromptText(alias);
		return normalizedAlias.length > 0 && promptText.includes(normalizedAlias);
	});
	const scoredDocs = bestEntry.taskDocs
		.map((doc) => ({ doc, score: scoreTaskDoc(doc, prompt) }))
		.sort((a, b) => b.score - a.score || a.doc.relativePath.localeCompare(b.doc.relativePath))
		.slice(0, 3)
		.map((item) => item.doc);

	return {
		entry: bestEntry,
		matchedDomains: [...normalizedDomains],
		matchedAliases,
		relevantTaskDocs: scoredDocs,
	};
}
