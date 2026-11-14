import { previewOrigin } from './preview-origin.ts';
import { privateServiceId } from './service-id.ts';

/** Deployment coordinates are operator inputs, never live infrastructure defaults. */
export function closedPreviewSettings(env: Record<string, string | undefined>) {
	const origin = previewOrigin(env.CHOICE_PREVIEW_API_URL ?? '');
	if (!origin.startsWith('https://choice-preview-') || new URL(origin).port !== '') {
		throw new Error('Closed preview requires its dedicated HTTPS origin');
	}
	const serviceId = privateServiceId(env.CHOICE_PREVIEW_VPC_SERVICE_ID);
	return { origin, serviceId };
}
