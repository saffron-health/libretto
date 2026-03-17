/**
 * Codex apply_patch format parser and applier.
 *
 * Ported from: https://github.com/openai/codex/tree/main/codex-rs/apply-patch
 *
 * The patch format:
 *   *** Begin Patch
 *   *** Add File: <path>        — create a new file, following lines prefixed with +
 *   *** Delete File: <path>     — remove a file
 *   *** Update File: <path>     — modify a file in place
 *   *** Move to: <new-path>     — (optional) rename after updating
 *   @@ [context header]         — hunk header, context lines, +/- diffs
 *   *** End of File             — (optional) marks end-of-file for matching
 *   *** End Patch
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

interface UpdateFileChunk {
	changeContext: string | null;
	oldLines: string[];
	newLines: string[];
	isEndOfFile: boolean;
}

type Hunk =
	| { type: "add"; path: string; contents: string }
	| { type: "delete"; path: string }
	| {
			type: "update";
			path: string;
			movePath: string | null;
			chunks: UpdateFileChunk[];
	  };

// ── Markers ──────────────────────────────────────────────────────────────

const BEGIN_PATCH = "*** Begin Patch";
const END_PATCH = "*** End Patch";
const ADD_FILE = "*** Add File: ";
const DELETE_FILE = "*** Delete File: ";
const UPDATE_FILE = "*** Update File: ";
const MOVE_TO = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT = "@@ ";
const EMPTY_CHANGE_CONTEXT = "@@";

// ── Parser ───────────────────────────────────────────────────────────────

function parsePatch(patch: string): Hunk[] {
	let lines = patch.trim().split("\n");

	// Lenient mode: strip heredoc wrapper if present
	if (
		lines.length >= 4 &&
		(lines[0] === "<<EOF" || lines[0] === "<<'EOF'" || lines[0] === '<<"EOF"') &&
		lines[lines.length - 1].endsWith("EOF")
	) {
		lines = lines.slice(1, -1);
	}

	const first = lines[0]?.trim();
	const last = lines[lines.length - 1]?.trim();

	if (first !== BEGIN_PATCH) {
		throw new Error(`Invalid patch: first line must be '${BEGIN_PATCH}', got '${first}'`);
	}
	if (last !== END_PATCH) {
		throw new Error(`Invalid patch: last line must be '${END_PATCH}', got '${last}'`);
	}

	const hunks: Hunk[] = [];
	let i = 1;
	const end = lines.length - 1;

	while (i < end) {
		const line = lines[i].trim();

		if (line.startsWith(ADD_FILE)) {
			const path = line.slice(ADD_FILE.length);
			let contents = "";
			i++;
			while (i < end && lines[i].startsWith("+")) {
				contents += lines[i].slice(1) + "\n";
				i++;
			}
			hunks.push({ type: "add", path, contents });
		} else if (line.startsWith(DELETE_FILE)) {
			hunks.push({ type: "delete", path: line.slice(DELETE_FILE.length) });
			i++;
		} else if (line.startsWith(UPDATE_FILE)) {
			const path = line.slice(UPDATE_FILE.length);
			i++;

			// Optional move
			let movePath: string | null = null;
			if (i < end && lines[i].startsWith(MOVE_TO)) {
				movePath = lines[i].slice(MOVE_TO.length);
				i++;
			}

			const chunks: UpdateFileChunk[] = [];
			while (i < end) {
				// Skip blank lines between chunks
				if (lines[i].trim() === "") {
					i++;
					continue;
				}
				// Stop if we hit the next file operation
				if (lines[i].startsWith("***")) break;

				const [chunk, linesConsumed] = parseUpdateChunk(lines, i, end, chunks.length === 0);
				chunks.push(chunk);
				i += linesConsumed;
			}

			if (chunks.length === 0) {
				throw new Error(`Update file hunk for '${path}' is empty`);
			}

			hunks.push({ type: "update", path, movePath, chunks });
		} else {
			throw new Error(`Unexpected line at position ${i + 1}: '${line}'`);
		}
	}

	return hunks;
}

function parseUpdateChunk(
	lines: string[],
	start: number,
	end: number,
	allowMissingContext: boolean,
): [UpdateFileChunk, number] {
	let i = start;
	let changeContext: string | null = null;

	if (lines[i] === EMPTY_CHANGE_CONTEXT) {
		i++;
	} else if (lines[i].startsWith(CHANGE_CONTEXT)) {
		changeContext = lines[i].slice(CHANGE_CONTEXT.length);
		i++;
	} else if (!allowMissingContext) {
		throw new Error(
			`Expected @@ context marker at line ${i + 1}, got: '${lines[i]}'`,
		);
	}

	const oldLines: string[] = [];
	const newLines: string[] = [];
	let isEndOfFile = false;
	let parsedDiffLines = 0;

	while (i < end) {
		const line = lines[i];

		if (line === EOF_MARKER) {
			if (parsedDiffLines === 0) {
				throw new Error(`Update hunk at line ${start + 1} has no diff lines before End of File`);
			}
			isEndOfFile = true;
			i++;
			break;
		}

		const ch = line[0];
		if (ch === " ") {
			oldLines.push(line.slice(1));
			newLines.push(line.slice(1));
		} else if (ch === "+") {
			newLines.push(line.slice(1));
		} else if (ch === "-") {
			oldLines.push(line.slice(1));
		} else if (line === "") {
			// Empty line treated as empty context
			oldLines.push("");
			newLines.push("");
		} else {
			if (parsedDiffLines === 0) {
				throw new Error(
					`Unexpected line in update hunk at line ${i + 1}: '${line}'. ` +
						`Lines must start with ' ', '+', or '-'`,
				);
			}
			// Start of next hunk or file op
			break;
		}
		parsedDiffLines++;
		i++;
	}

	return [{ changeContext, oldLines, newLines, isEndOfFile }, i - start];
}

// ── Sequence Matching ────────────────────────────────────────────────────

/**
 * Find `pattern` within `lines` starting at `start`.
 * Tries exact match, then trimmed match, then Unicode-normalized match.
 * When `eof` is true, starts searching from end of file.
 */
function seekSequence(
	lines: string[],
	pattern: string[],
	start: number,
	eof: boolean,
): number | null {
	if (pattern.length === 0) return start;
	if (pattern.length > lines.length) return null;

	const searchStart =
		eof && lines.length >= pattern.length ? lines.length - pattern.length : start;

	// Exact match
	for (let i = searchStart; i <= lines.length - pattern.length; i++) {
		if (pattern.every((p, j) => lines[i + j] === p)) return i;
	}

	// Trim-end match
	for (let i = searchStart; i <= lines.length - pattern.length; i++) {
		if (pattern.every((p, j) => lines[i + j].trimEnd() === p.trimEnd())) return i;
	}

	// Full trim match
	for (let i = searchStart; i <= lines.length - pattern.length; i++) {
		if (pattern.every((p, j) => lines[i + j].trim() === p.trim())) return i;
	}

	// Unicode-normalized match
	for (let i = searchStart; i <= lines.length - pattern.length; i++) {
		if (pattern.every((p, j) => normalise(lines[i + j]) === normalise(p))) return i;
	}

	return null;
}

function normalise(s: string): string {
	return s
		.trim()
		.replace(/[\u2010-\u2015\u2212]/g, "-")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C-\u201F]/g, '"')
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

// ── Applier ──────────────────────────────────────────────────────────────

function applyChunksToContent(
	originalContent: string,
	path: string,
	chunks: UpdateFileChunk[],
): string {
	let originalLines = originalContent.split("\n");
	// Drop trailing empty element from final newline (matches Codex behavior)
	if (originalLines[originalLines.length - 1] === "") {
		originalLines.pop();
	}

	const replacements: Array<[number, number, string[]]> = [];
	let lineIndex = 0;

	for (const chunk of chunks) {
		// Handle change_context: seek to the context line
		if (chunk.changeContext !== null) {
			const idx = seekSequence(
				originalLines,
				[chunk.changeContext],
				lineIndex,
				false,
			);
			if (idx === null) {
				throw new Error(
					`Failed to find context '${chunk.changeContext}' in ${path}`,
				);
			}
			lineIndex = idx + 1;
		}

		if (chunk.oldLines.length === 0) {
			// Pure addition — insert at end of file
			const insertionIdx =
				originalLines[originalLines.length - 1] === ""
					? originalLines.length - 1
					: originalLines.length;
			replacements.push([insertionIdx, 0, chunk.newLines]);
			continue;
		}

		// Try to find the old lines in the file
		let pattern = chunk.oldLines;
		let newSlice = chunk.newLines;
		let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

		// Retry without trailing empty line (like Codex does)
		if (
			found === null &&
			pattern.length > 0 &&
			pattern[pattern.length - 1] === ""
		) {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}

		if (found === null) {
			throw new Error(
				`Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`,
			);
		}

		replacements.push([found, pattern.length, newSlice]);
		lineIndex = found + pattern.length;
	}

	// Sort by position and apply in reverse order
	replacements.sort((a, b) => a[0] - b[0]);

	let resultLines = [...originalLines];
	for (const [startIdx, oldLen, newSegment] of [...replacements].reverse()) {
		resultLines.splice(startIdx, oldLen, ...newSegment);
	}

	// Ensure trailing newline
	if (resultLines[resultLines.length - 1] !== "") {
		resultLines.push("");
	}

	return resultLines.join("\n");
}

// ── Public API ───────────────────────────────────────────────────────────

export function applyPatch(patchText: string, cwd: string): string {
	const hunks = parsePatch(patchText);

	if (hunks.length === 0) {
		throw new Error("No files were modified.");
	}

	const added: string[] = [];
	const modified: string[] = [];
	const deleted: string[] = [];

	for (const hunk of hunks) {
		const absPath = resolve(cwd, hunk.path);

		switch (hunk.type) {
			case "add": {
				const dir = dirname(absPath);
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}
				writeFileSync(absPath, hunk.contents);
				added.push(hunk.path);
				break;
			}

			case "delete": {
				unlinkSync(absPath);
				deleted.push(hunk.path);
				break;
			}

			case "update": {
				const original = readFileSync(absPath, "utf-8");
				const newContent = applyChunksToContent(original, hunk.path, hunk.chunks);

				const dest = hunk.movePath ? resolve(cwd, hunk.movePath) : absPath;
				const destDir = dirname(dest);
				if (!existsSync(destDir)) {
					mkdirSync(destDir, { recursive: true });
				}

				writeFileSync(dest, newContent);
				if (hunk.movePath) {
					unlinkSync(absPath);
				}
				modified.push(hunk.movePath ?? hunk.path);
				break;
			}
		}
	}

	const lines = ["Updated the following files:"];
	for (const p of added) lines.push(`A ${p}`);
	for (const p of modified) lines.push(`M ${p}`);
	for (const p of deleted) lines.push(`D ${p}`);
	return lines.join("\n");
}
