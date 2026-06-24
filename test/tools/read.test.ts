import { describe, it, expect, vi, beforeEach } from "vitest";
import register from "../../index";
import {
	computeLineHash,
	computeLineHashAt,
	formatHashlineRegionFromFile,
} from "../../src/hashline";
import { formatHashlineReadPreview } from "../../src/read";
import { getText, makeFakePiRegistry, makeToolContext, withTempFile } from "../support/fixtures";

vi.mock("../../src/file-kind", () => ({
	loadFileKindAndText: vi.fn(),
}));

import * as fileKindMod from "../../src/file-kind";

describe("formatHashlineReadPreview", () => {
	it("refuses to emit a truncated hashline for an oversized first line", () => {
		const longLine = "x".repeat(70_000);
		const result = formatHashlineReadPreview(longLine, { offset: 1 });

		expect(result.text).toContain("Hashline output requires full lines");
		expect(result.truncation?.truncated).toBe(true);
		expect(result.truncation?.truncatedBy).toBe("bytes");
		expect(result.truncation?.firstLineExceedsLimit).toBe(true);
	});

	it("formats ordinary lines as full hashlines", () => {
		const result = formatHashlineReadPreview("alpha\nbeta", { offset: 1 });

		expect(result.text).toContain("1#");
		expect(result.text).toContain(":alpha");
	});

	it("pads line numbers to the same width within the returned block", () => {
		const text = Array.from(
			{ length: 10 },
			(_, index) => `line-${index + 1}`,
		).join("\n");
		const lines = text.split("\n");
		const result = formatHashlineReadPreview(text, { offset: 8 });

		expect(result.text.split("\n").slice(0, 3)).toEqual([
			` 8#${computeLineHashAt(lines, 8)}:line-8`,
			` 9#${computeLineHashAt(lines, 9)}:line-9`,
			`10#${computeLineHashAt(lines, 10)}:line-10`,
		]);
	});

	it("returns raw lines without hashline prefixes when raw is true", () => {
		const result = formatHashlineReadPreview("alpha\nbeta\ngamma", {
			offset: 2,
			limit: 2,
			raw: true,
		});

		expect(result.text).toBe("beta\ngamma");
		expect(result.text).not.toMatch(/^\s*\d+#/m);
	});

	it("returns an advisory for empty files instead of a synthetic empty-line anchor", () => {
		const result = formatHashlineReadPreview("", { offset: 1 });

		expect(result.text).toContain("File is empty");
		expect(result.text).toContain("prepend or append");
		expect(result.text).not.toContain("1#");
	});

	it("hides the terminal newline sentinel from preview output", () => {
		const result = formatHashlineReadPreview("alpha\nbeta\n", { offset: 1 });

		expect(result.text).toContain("1#");
		expect(result.text).toContain("2#");
		expect(result.text).toContain(":alpha");
		expect(result.text).toContain(":beta");
		expect(result.text).not.toContain("3#");
		expect(result.text).not.toContain("2 lines total");
	});

	it("keeps continuation hints for partial previews", () => {
		const result = formatHashlineReadPreview("alpha\nbeta", {
			offset: 1,
			limit: 1,
		});

		expect(result.text).toContain("Use offset=2 to continue");
	});

	it("reports when offset is beyond end of content", () => {
		const result = formatHashlineReadPreview("alpha\nbeta", { offset: 10 });

		expect(result.text).toContain("Offset 10 is beyond end of file");
		expect(result.text).toContain("2 lines total");
	});

	it("rejects fractional offsets", () => {
		expect(() =>
			formatHashlineReadPreview("alpha\nbeta", { offset: 1.5 }),
		).toThrow(/offset.*positive integer/i);
	});

	it("rejects non-positive limits", () => {
		expect(() =>
			formatHashlineReadPreview("alpha\nbeta", { limit: 0 }),
		).toThrow(/limit.*positive integer/i);
	});
});

describe("formatHashlineRegionFromFile", () => {
	it("formats lines with contextual LINE#HASH anchors", () => {
		const lines = ["zero", "one", "alpha", "beta", "gamma", "tail"];
		const result = formatHashlineRegionFromFile(lines, 3, 5);

		expect(result).toBe(
			`3#${computeLineHashAt(lines, 3)}:alpha\n` +
				`4#${computeLineHashAt(lines, 4)}:beta\n` +
				`5#${computeLineHashAt(lines, 5)}:gamma`,
		);
	});

	it("pads region line numbers to the widest line number", () => {
		const lines = [
			"line1",
			"line2",
			"line3",
			"line4",
			"line5",
			"line6",
			"line7",
			"alpha",
			"beta",
			"gamma",
		];
		const result = formatHashlineRegionFromFile(lines, 8, 10);

		expect(result).toBe(
			` 8#${computeLineHashAt(lines, 8)}:alpha\n` +
				` 9#${computeLineHashAt(lines, 9)}:beta\n` +
				`10#${computeLineHashAt(lines, 10)}:gamma`,
		);
	});

	it("handles a single line", () => {
		const lines = ["hello"];
		const result = formatHashlineRegionFromFile(lines, 1, 1);
		expect(result).toBe(`1#${computeLineHashAt(lines, 1)}:hello`);
	});

	it("handles empty range", () => {
		const result = formatHashlineRegionFromFile([], 1, 0);
		expect(result).toBe("");
	});
});

describe("read tool protocol", () => {
	beforeEach(() => {
		vi.mocked(fileKindMod.loadFileKindAndText).mockReset();
	});

	it("returns the empty-file advisory through the registered tool", async () => {
		await withTempFile("empty.txt", "", async ({ cwd }) => {
			vi.mocked(fileKindMod.loadFileKindAndText).mockResolvedValue({
				kind: "text",
				text: "",
			});

			const { pi, getTool } = makeFakePiRegistry();
			register(pi);
			const readTool = getTool("read");

			const result = await readTool.execute(
				"r1",
				{ path: "empty.txt" },
				undefined,
				undefined,
				makeToolContext(cwd),
			);

			expect(getText(result)).toContain("File is empty");
			expect(getText(result)).not.toContain("1#");
		});
	});

	it("omits the trailing newline sentinel through the registered tool", async () => {
		await withTempFile("sample.txt", "alpha\nbeta\n", async ({ cwd }) => {
			vi.mocked(fileKindMod.loadFileKindAndText).mockResolvedValue({
				kind: "text",
				text: "alpha\nbeta\n",
			});

			const { pi, getTool } = makeFakePiRegistry();
			register(pi);
			const readTool = getTool("read");

			const result = await readTool.execute(
				"r1",
				{ path: "sample.txt" },
				undefined,
				undefined,
				makeToolContext(cwd),
			);

			expect(getText(result)).toContain(":alpha");
			expect(getText(result)).toContain(":beta");
			expect(getText(result)).not.toContain("3#");
		});
	});

	it("reads text through the shared text loader", async () => {
		await withTempFile("sample.txt", "ignored\n", async ({ cwd }) => {
			vi.mocked(fileKindMod.loadFileKindAndText).mockResolvedValue({
				kind: "text",
				text: "alpha\nbeta\n",
			});

			const { pi, getTool } = makeFakePiRegistry();
			register(pi);
			const readTool = getTool("read");

			const result = await readTool.execute(
				"r1",
				{ path: "sample.txt" },
				undefined,
				undefined,
				makeToolContext(cwd),
			);

			expect(getText(result)).toContain(":alpha");
			expect(getText(result)).toContain(":beta");
		});
	});

	it("warns that editing rewrites a file containing non-utf-8 bytes", async () => {
		await withTempFile("legacy.c", "ignored\n", async ({ cwd }) => {
			// U+FFFD stands in for the bytes file-kind's non-fatal decode produced
			// from a CP1251 source. read should flag the lossy round-trip once.
			vi.mocked(fileKindMod.loadFileKindAndText).mockResolvedValue({
				kind: "text",
				text: "int � = 0;\n",
				hadUtf8DecodeErrors: true,
			});

			const { pi, getTool } = makeFakePiRegistry();
			register(pi);
			const readTool = getTool("read");

			const result = await readTool.execute(
				"r1",
				{ path: "legacy.c" },
				undefined,
				undefined,
				makeToolContext(cwd),
			);

			expect(getText(result)).toContain(
				"editing rewrites the file as UTF-8",
			);
		});
	});

	it("does not warn for clean utf-8 text", async () => {
		await withTempFile("clean.txt", "ignored\n", async ({ cwd }) => {
			vi.mocked(fileKindMod.loadFileKindAndText).mockResolvedValue({
				kind: "text",
				text: "alpha\nvalid � replacement character\n",
			});

			const { pi, getTool } = makeFakePiRegistry();
			register(pi);
			const readTool = getTool("read");

			const result = await readTool.execute(
				"r1",
				{ path: "clean.txt" },
				undefined,
				undefined,
				makeToolContext(cwd),
			);

			expect(getText(result)).not.toContain("Non-UTF-8");
		});
	});
});
