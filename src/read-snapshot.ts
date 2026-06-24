import { HASHLINE_HASH_VERSION, buildHashlineFile, computeLineHashes } from "./hashline";

export type ReadSnapshot = {
	canonicalPath: string;
	normalizedContent: string;
	visibleLines: string[];
	hashes: string[];
	snapshotId: string;
	hashVersion: typeof HASHLINE_HASH_VERSION;
	createdAt: number;
	bytes: number;
};

const MAX_ENTRIES = 32;
const MAX_BYTES = 16 * 1024 * 1024;

const snapshots = new Map<string, ReadSnapshot>();
let totalBytes = 0;

function snapshotBytes(normalizedContent: string): number {
	return Buffer.byteLength(normalizedContent, "utf8");
}

function touch(snapshot: ReadSnapshot): ReadSnapshot {
	snapshots.delete(snapshot.canonicalPath);
	snapshots.set(snapshot.canonicalPath, snapshot);
	return snapshot;
}

function evictIfNeeded(): void {
	while (snapshots.size > MAX_ENTRIES || totalBytes > MAX_BYTES) {
		const oldestKey = snapshots.keys().next().value as string | undefined;
		if (oldestKey === undefined) break;
		const oldest = snapshots.get(oldestKey);
		if (oldest) totalBytes -= oldest.bytes;
		snapshots.delete(oldestKey);
	}
}

export function rememberReadSnapshot(params: {
	canonicalPath: string;
	normalizedContent: string;
	snapshotId: string;
}): ReadSnapshot | null {
	const bytes = snapshotBytes(params.normalizedContent);
	if (bytes > MAX_BYTES) {
		forgetReadSnapshot(params.canonicalPath);
		return null;
	}

	const existing = snapshots.get(params.canonicalPath);
	if (existing) totalBytes -= existing.bytes;

	const file = buildHashlineFile(params.normalizedContent);
	const snapshot: ReadSnapshot = {
		canonicalPath: params.canonicalPath,
		normalizedContent: params.normalizedContent,
		visibleLines: file.visibleLines,
		hashes: computeLineHashes(file.visibleLines),
		snapshotId: params.snapshotId,
		hashVersion: HASHLINE_HASH_VERSION,
		createdAt: Date.now(),
		bytes,
	};
	snapshots.set(params.canonicalPath, snapshot);
	totalBytes += bytes;
	evictIfNeeded();
	return snapshot;
}

export function getReadSnapshot(canonicalPath: string): ReadSnapshot | undefined {
	const snapshot = snapshots.get(canonicalPath);
	if (!snapshot) return undefined;
	if (snapshot.hashVersion !== HASHLINE_HASH_VERSION) {
		forgetReadSnapshot(canonicalPath);
		return undefined;
	}
	return touch(snapshot);
}

export function forgetReadSnapshot(canonicalPath: string): void {
	const snapshot = snapshots.get(canonicalPath);
	if (snapshot) totalBytes -= snapshot.bytes;
	snapshots.delete(canonicalPath);
}

