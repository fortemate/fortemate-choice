/** A deployment may bind only to its explicitly selected private API service. */
export function privateServiceId(value: string | undefined): string {
	if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		throw new Error('An explicit VPC service UUID is required');
	}
	return value;
}
