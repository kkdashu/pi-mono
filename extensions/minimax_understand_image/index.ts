import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ImageUnderstandingInput } from "./mcp-client.js";
import {
	MiniMaxUnderstandImageMcpClient,
	resolveMiniMaxUnderstandImageMcpConfig,
} from "./mcp-client.js";

type ImageBlock = {
	type: "image";
	data: string;
	mimeType: string;
};

const STATUS_KEY = "minimax-understand-image";
const DEFAULT_EMPTY_USER_REQUEST = "Please use the image understanding results above to continue.";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

function imageExtensionForMimeType(mimeType: string): string {
	switch (mimeType.toLowerCase()) {
		case "image/jpeg":
		case "image/jpg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		case "image/bmp":
			return "bmp";
		default:
			return "bin";
	}
}

async function writeImageToTempFile(image: ImageBlock): Promise<string> {
	const fileName = `pi-minimax-understand-${randomUUID()}.${imageExtensionForMimeType(image.mimeType)}`;
	const filePath = join(tmpdir(), fileName);
	await writeFile(filePath, Buffer.from(image.data, "base64"));
	return filePath;
}

async function removeTempFile(filePath: string): Promise<void> {
	await rm(filePath, { force: true }).catch(() => undefined);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function isImagePathCandidate(text: string): boolean {
	return IMAGE_EXTENSIONS.has(extname(text).toLowerCase());
}

async function extractImagePathsFromText(
	text: string,
	cwd: string,
): Promise<{ imagePaths: string[]; remainingText: string }> {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const imagePaths: string[] = [];
	const remainingLines: string[] = [];

	for (const line of lines) {
		if (!isImagePathCandidate(line)) {
			remainingLines.push(line);
			continue;
		}

		const resolvedPath = isAbsolute(line) ? line : resolve(cwd, line);
		if (!(await fileExists(resolvedPath))) {
			remainingLines.push(line);
			continue;
		}

		imagePaths.push(resolvedPath);
	}

	return {
		imagePaths,
		remainingText: remainingLines.join("\n").trim(),
	};
}

function buildUnderstandImagePrompt(userText: string, index: number, total: number): string {
	const trimmedUserText = userText.trim();
	const baseInstructions = [
		"You are preprocessing an image for a coding agent that cannot directly accept image input.",
		"Describe exactly what is visible in the image.",
		"Extract all readable text verbatim when possible.",
		"Call out UI structure, code, errors, warnings, logs, charts, diagrams, filenames, and anything actionable.",
		"If something is unclear or partially occluded, say so instead of guessing.",
	];

	if (!trimmedUserText) {
		return `${baseInstructions.join("\n")}\n\nThis is image ${index} of ${total}.`;
	}

	return `${baseInstructions.join("\n")}\n\nThis is image ${index} of ${total}.\n\nThe user's request is:\n${trimmedUserText}`;
}

function buildTransformedText(userText: string, results: string[]): string {
	const sections = [
		"[Image preprocessing]",
		"The current model does not support direct image input.",
		"The following image understanding results were generated before this request:",
	];

	for (const [index, result] of results.entries()) {
		sections.push("");
		sections.push(`Image ${index + 1}:`);
		sections.push(result.trim());
	}

	sections.push("");
	sections.push("[User request]");
	sections.push(userText.trim() || DEFAULT_EMPTY_USER_REQUEST);

	return sections.join("\n");
}

export default function (pi: ExtensionAPI) {
	const config = resolveMiniMaxUnderstandImageMcpConfig();
	const client = new MiniMaxUnderstandImageMcpClient(config);
	let missingConfigWarned = false;

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}

		if (!ctx.model || ctx.model.input.includes("image")) {
			return { action: "continue" };
		}

		const attachments = event.images ?? [];
		const extracted = await extractImagePathsFromText(event.text, ctx.cwd);
		const fileImagePaths = extracted.imagePaths;
		const userText = extracted.remainingText;

		if (attachments.length === 0 && fileImagePaths.length === 0) {
			return { action: "continue" };
		}

		if (!config.apiKey) {
			if (!missingConfigWarned) {
				missingConfigWarned = true;
				const message =
					"MINIMAX_API_KEY is not set. The minimax_understand_image extension skipped image preprocessing.";
				console.warn(`[${STATUS_KEY}] ${message}`);
				if (ctx.hasUI) {
					ctx.ui.notify(message, "warning");
				}
			}
			return { action: "continue" };
		}

		const imagePaths: string[] = [];

		try {
			if (ctx.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, "Understanding images with MiniMax MCP...");
			}

			const results: string[] = [];
			const totalImages = attachments.length + fileImagePaths.length;

			for (const [index, image] of attachments.entries()) {
				const filePath = await writeImageToTempFile(image);
				imagePaths.push(filePath);

				const input: ImageUnderstandingInput = {
					imagePath: filePath,
					prompt: buildUnderstandImagePrompt(userText, index + 1, totalImages),
				};

				results.push(await client.understandImage(input));
			}

			for (const [index, imagePath] of fileImagePaths.entries()) {
				const input: ImageUnderstandingInput = {
					imagePath,
					prompt: buildUnderstandImagePrompt(userText, attachments.length + index + 1, totalImages),
				};

				results.push(await client.understandImage(input));
			}

			return {
				action: "transform",
				text: buildTransformedText(userText, results),
				images: [],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[${STATUS_KEY}] Failed to preprocess images: ${message}`);
			if (ctx.hasUI) {
				ctx.ui.notify(`MiniMax image preprocessing failed: ${message}`, "warning");
			}
			return { action: "continue" };
		} finally {
			await Promise.all(imagePaths.map((imagePath) => removeTempFile(imagePath)));
			if (ctx.hasUI) {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		}
	});

	pi.on("session_shutdown", async () => {
		await client.close();
	});
}
