import { describe, expect, it } from "vitest";
import {
	applyHashlineEdits,
	computeLineHash,
	computeLineHashAt,
	resolveEditAnchors,
	type HashlineEdit,
} from "../../src/hashline";

describe("computeLineHash", () => {
	it("returns a 2-character string from NIBBLE_STR alphabet", () => {
		const hash = computeLineHash(1, "hello");
		expect(hash).toHaveLength(2);
		expect(hash).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/);
	});

	it("trims trailing whitespace without collapsing internal spaces", () => {
		expect(computeLineHash(1, "a\t")).toBe(computeLineHash(1, "a"));
		expect(computeLineHash(1, "a  b")).not.toBe(computeLineHash(1, "a b"));
	});

	it("strips trailing CR", () => {
		expect(computeLineHash(1, "hello\r")).toBe(computeLineHash(1, "hello"));
	});

	it("mixes line number for all lines", () => {
		const h1 = computeLineHash(1, "}");
		const h10 = computeLineHash(10, "}");
		expect(h1).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/);
		expect(h10).toMatch(/^[ZPMQVRWSNKTXJBYH]{2}$/);
		expect(computeLineHash(1, "function foo()")).not.toBe(
			computeLineHash(99, "function foo()"),
		);
	});

	it("mixes neighboring lines in contextual hashes", () => {
		const before = ["alpha", "beta", "gamma"];
		const afterPrevChanged = ["ALPHA", "beta", "gamma"];
		const afterNextChanged = ["alpha", "beta", "GAMMA"];
		expect(computeLineHashAt(before, 2)).not.toBe(
			computeLineHashAt(afterPrevChanged, 2),
		);
		expect(computeLineHashAt(before, 2)).not.toBe(
			computeLineHashAt(afterNextChanged, 2),
		);
	});
});

describe("strict hashline contract", () => {
	it("preserves internal spaces when hashing", () => {
		expect(computeLineHash(1, "a b")).not.toBe(computeLineHash(1, "ab"));
	});

	it("trims trailing spaces when hashing", () => {
		expect(computeLineHash(1, "value  ")).toBe(computeLineHash(1, "value"));
	});

	it("preserves explicit blank trailing line in array input", () => {
		const [resolved] = resolveEditAnchors([{ op: "append", lines: ["alpha", ""] }]);
		expect(resolved).toMatchObject({ op: "append", lines: ["alpha", ""] });
	});

	it("rejects stale anchors instead of relocating by hash", () => {
		const content = ["a", "INSERTED", "b", "target", "c"].join("\n");
		// A structurally valid edit: only the anchor is stale.
		const stale: HashlineEdit = {
			op: "replace",
			pos: { line: 3, hash: computeLineHash(3, "target") },
			lines: ["updated"],
		};

		expect(() => applyHashlineEdits(content, [stale])).toThrow(
			/1 stale anchor\./,
		);
	});
});
