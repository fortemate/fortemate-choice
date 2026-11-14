import { previewOrigin } from './preview-origin.ts';

/** Deployment coordinates are operator inputs, never live infrastructure defaults. */
export function closedPreviewSettings(env: Record<string, string | undefined>) {
	const origin = previewOrigin(env.CHOICE_PREVIEW_API_URL ?? '');
	if (!origin.startsWith('https://choice-preview-')) {
		throw new Error('Closed preview requires its dedicated HTTPS origin');
	}
	const serviceId = env.CHOICE_PREVIEW_VPC_SERVICE_ID ?? '';
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId)) {
		throw new Error('Closed preview requires an explicit VPC service UUID');
	}
	return { origin, serviceId };
}
