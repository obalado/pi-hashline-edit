import { readFile, writeFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import register from "../../index";
import { getText, makeFakePiRegistry, makeToolContext, withTempFile } from "../support/fixtures";

function refForLine(text: string, needle: string): string {
	return text
		.split("\n")
		.find((line) => line.includes(`:${needle}`))!
		.split(":")[0]!;
}

describe("safe stale-anchor merge recovery", () => {
	it("merges stale anchors when external changes do not overlap", async () => {
		await withTempFile(
			"merge.txt",
			"one\ntwo\nthree\nfour\nfive\n",
			async ({ cwd, path }) => {
				const { pi, getTool } = makeFakePiRegistry();
				register(pi);
				const ctx = makeToolContext(cwd);
				const readTool = getTool("read");
				const editTool = getTool("edit");

				const readResult = await readTool.execute(
					"r1",
					{ path: "merge.txt" },
					undefined,
					undefined,
					ctx,
				);
				const fourRef = refForLine(getText(readResult), "four");

				// External change touches line 3, making line 4's contextual anchor stale,
				// but the requested edit itself targets line 4.
				await writeFile(path, "one\ntwo\nTHREE!\nfour\nfive\n", "utf-8");

				const editResult = await editTool.execute(
					"e1",
					{
						path: "merge.txt",
						edits: [{ op: "replace", pos: fourRef, lines: ["FOUR"] }],
					},
					undefined,
					undefined,
					ctx,
				);

				expect(await readFile(path, "utf-8")).toBe(
					"one\ntwo\nTHREE!\nFOUR\nfive\n",
				);
				expect(getText(editResult)).toContain("[W_MERGED_STALE_ANCHORS]");
			},
		);
	});

	it("keeps stale-anchor failure when external changes overlap", async () => {
		await withTempFile(
			"conflict.txt",
			"one\ntwo\nthree\nfour\n",
			async ({ cwd, path }) => {
				const { pi, getTool } = makeFakePiRegistry();
				register(pi);
				const ctx = makeToolContext(cwd);
				const readTool = getTool("read");
				const editTool = getTool("edit");

				const readResult = await readTool.execute(
					"r1",
					{ path: "conflict.txt" },
					undefined,
					undefined,
					ctx,
				);
				const threeRef = refForLine(getText(readResult), "three");

				await writeFile(path, "one\ntwo\nTHREE!\nfour\n", "utf-8");

				await expect(
					editTool.execute(
						"e1",
						{
							path: "conflict.txt",
							edits: [{ op: "replace", pos: threeRef, lines: ["THREE"] }],
						},
						undefined,
						undefined,
						ctx,
					),
				).rejects.toThrow(/^\[E_STALE_ANCHOR\]/);
			},
		);
	});
});
