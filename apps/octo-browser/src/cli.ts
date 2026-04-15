#!/usr/bin/env node

import { startOctoBrowser } from "./runtime.js";

async function main(): Promise<void> {
	await startOctoBrowser(process.cwd());
}

main().catch((error) => {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
});

