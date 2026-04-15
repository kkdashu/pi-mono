import { resolve } from "node:path";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InteractiveMode,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { ensureGeneratedSkillsRoot, getAppRoot } from "./paths.js";

const OCTO_EXTENSION_PATH = resolve(getAppRoot(), "src", "extensions", "site-skills", "index.ts");

export async function startOctoBrowser(cwd: string): Promise<void> {
	const agentDir = getAgentDir();
	await ensureGeneratedSkillsRoot(agentDir);

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd,
		sessionManager,
		sessionStartEvent,
	}) => {
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			resourceLoaderOptions: {
				additionalExtensionPaths: [OCTO_EXTENSION_PATH],
			},
		});

		return {
			...(await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent,
			})),
			services,
			diagnostics: services.diagnostics,
		};
	};

	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager: SessionManager.create(cwd),
	});

	await runtime.session.bindExtensions({});

	const mode = new InteractiveMode(runtime, {
		migratedProviders: [],
		modelFallbackMessage: undefined,
		initialMessage: "",
		initialImages: [],
		initialMessages: [],
	});

	await mode.run();
}

