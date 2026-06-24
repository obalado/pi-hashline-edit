import * as Diff from "diff";
import { computeChangedLineRange } from "./hashline";

export type MergeResult =
	| {
			ok: true;
			content: string;
			firstChangedLine: number | undefined;
			lastChangedLine: number | undefined;
	  }
	| { ok: false; reason: string };

type Hunk = {
	baseStart: number;
	baseEnd: number;
	replacement: string[];
};

function splitPatchLines(text: string): string[] {
	return text.length === 0 ? [] : text.split("\n");
}

function buildHunks(baseLines: string[], targetLines: string[]): Hunk[] {
	const parts = Diff.diffArrays(baseLines, targetLines) as Array<{
		added?: boolean;
		removed?: boolean;
		value: string[];
	}>;
	const hunks: Hunk[] = [];
	let baseIndex = 0;

	for (let index = 0; index < parts.length; index++) {
		const part = parts[index]!;
		if (!part.added && !part.removed) {
			baseIndex += part.value.length;
			continue;
		}

		if (part.removed) {
			const next = parts[index + 1];
			if (next?.added) {
				hunks.push({
					baseStart: baseIndex,
					baseEnd: baseIndex + part.value.length,
					replacement: next.value,
				});
				baseIndex += part.value.length;
				index++;
				continue;
			}

			hunks.push({
				baseStart: baseIndex,
				baseEnd: baseIndex + part.value.length,
				replacement: [],
			});
			baseIndex += part.value.length;
			continue;
		}

		if (part.added) {
			hunks.push({
				baseStart: baseIndex,
				baseEnd: baseIndex,
				replacement: part.value,
			});
		}
	}

	return hunks;
}

function hunkOldLength(hunk: Hunk): number {
	return hunk.baseEnd - hunk.baseStart;
}

function conflicts(left: Hunk, right: Hunk): boolean {
	const leftOld = hunkOldLength(left);
	const rightOld = hunkOldLength(right);

	if (leftOld === 0 && rightOld === 0) {
		return left.baseStart === right.baseStart;
	}

	if (leftOld === 0) {
		return right.baseStart <= left.baseStart && left.baseStart < right.baseEnd;
	}
	if (rightOld === 0) {
		return left.baseStart <= right.baseStart && right.baseStart < left.baseEnd;
	}

	return left.baseStart < right.baseEnd && right.baseStart < left.baseEnd;
}

function transformBoundary(
	index: number,
	currentHunks: Hunk[],
	bias: "start" | "end",
): number | null {
	let transformed = index;
	for (const hunk of currentHunks) {
		const oldLength = hunkOldLength(hunk);
		const newLength = hunk.replacement.length;
		if (oldLength === 0) {
			if (hunk.baseStart < index || (hunk.baseStart === index && bias === "start")) {
				transformed += newLength;
			}
			continue;
		}

		if (hunk.baseEnd <= index) {
			transformed += newLength - oldLength;
			continue;
		}

		if (hunk.baseStart < index && index < hunk.baseEnd) {
			return null;
		}

		if (hunk.baseStart >= index) {
			break;
		}
	}
	return transformed;
}

export function threeWayMerge(
	base: string,
	baseEdited: string,
	current: string,
): MergeResult {
	if (base === current) {
		const changedRange = computeChangedLineRange(current, baseEdited);
		return {
			ok: true,
			content: baseEdited,
			firstChangedLine: changedRange?.firstChangedLine,
			lastChangedLine: changedRange?.lastChangedLine,
		};
	}
	if (base === baseEdited) {
		return {
			ok: true,
			content: current,
			firstChangedLine: undefined,
			lastChangedLine: undefined,
		};
	}

	const baseLines = splitPatchLines(base);
	const editedHunks = buildHunks(baseLines, splitPatchLines(baseEdited));
	const currentHunks = buildHunks(baseLines, splitPatchLines(current));

	for (const edited of editedHunks) {
		for (const currentHunk of currentHunks) {
			if (conflicts(edited, currentHunk)) {
				return {
					ok: false,
					reason: "edited and current changes overlap in base coordinates",
				};
			}
		}
	}

	let mergedLines = splitPatchLines(current);
	const applications = editedHunks.map((hunk) => {
		const start = transformBoundary(hunk.baseStart, currentHunks, "start");
		const end = transformBoundary(hunk.baseEnd, currentHunks, "end");
		if (start === null || end === null || start > end) {
			return null;
		}
		return { start, end, replacement: hunk.replacement };
	});
	if (applications.some((app) => app === null)) {
		return { ok: false, reason: "could not translate base edit into current" };
	}

	for (const app of [...applications].reverse()) {
		const nonNullApp = app!;
		mergedLines = [
			...mergedLines.slice(0, nonNullApp.start),
			...nonNullApp.replacement,
			...mergedLines.slice(nonNullApp.end),
		];
	}

	const content = mergedLines.join("\n");
	const changedRange = computeChangedLineRange(current, content);
	return {
		ok: true,
		content,
		firstChangedLine: changedRange?.firstChangedLine,
		lastChangedLine: changedRange?.lastChangedLine,
	};
}
