import {
  type CodeToTokensOptions as HighlightsOptions,
  LiveTokenizer,
  type LiveTokenizerUpdate,
} from '@pierre/highlights';

import type { TextDocumentChange } from '../editor/textDocument';
import type { HighlightedToken, RenderRange } from '../types';
import type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
} from './tokenizer-types';
import type { CodeToTokensOptions } from './types';

/** Adapts the native incremental lexer to the editor's document and viewport. */
export class HighlightsLiveTokenizer implements DiffsLiveTokenizer {
  #tokenizer: LiveTokenizer;
  #version: number;
  // Lines the in-progress tokenize call returns itself. A synchronous flush
  // must not also deliver them through onDeferTokenize, or the host patches
  // the same rows twice.
  #returnedRange: readonly [start: number, end: number] | undefined;

  constructor(
    private readonly options: DiffsLiveTokenizerOptions,
    private readonly resolveOptions: (
      options: CodeToTokensOptions
    ) => HighlightsOptions
  ) {
    this.#version = options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
  }

  #createTokenizer(): LiveTokenizer {
    return new LiveTokenizer({
      ...this.resolveOptions({
        lang: this.options.textDocument.languageId,
        theme: this.options.theme,
        tokenizeMaxLineLength: this.options.tokenizeMaxLineLength ?? 1000,
      }),
      code: this.options.textDocument.getText(),
      renderRange: [0, 0],
      onDeferTokenize: (lines) => this.#deliver(lines),
    });
  }

  // Forward background and off-range lines to the host, minus the rows the
  // current tokenize call already returns.
  #deliver(lines: Map<number, HighlightedToken[]>): void {
    const range = this.#returnedRange;
    if (range !== undefined) {
      for (const line of lines.keys()) {
        if (line >= range[0] && line < range[1]) lines.delete(line);
      }
      if (lines.size === 0) return;
    }
    this.options.onDeferTokenize(lines);
  }

  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
  ): Map<number, HighlightedToken[]> {
    const document = this.options.textDocument;
    const start = Math.min(renderRange?.startingLine ?? 0, document.lineCount);
    const end = Math.min(
      start + (renderRange?.totalLines ?? Infinity),
      document.lineCount
    );
    const returnedStart = Math.max(start, change.startLine);
    let lines: Map<number, HighlightedToken[]>;
    if (this.#version !== document.version) {
      lines = this.#syncDocument(change, [start, end]).lines;
      this.#version = document.version;
    } else if (this.#tokenizer.lineCount !== document.lineCount) {
      lines = this.#tokenizer.reset(document.getText(), {
        renderRange: [start, end],
      }).lines;
    } else {
      lines = new Map();
      this.#readLines(lines, returnedStart, end);
    }
    // Balanced insert/delete batches shift rows without triggering host realignment.
    // Other structural edits need the suffix only when the host does not move rows.
    if (
      change.lineDelta === 0
        ? (change.changedLineChanges?.some(
            ([, , lineDelta]) => lineDelta !== 0
          ) ?? false)
        : !hostRealignsRows
    ) {
      this.#readLines(lines, returnedStart, end);
    }
    return lines;
  }

  // Apply the editor's edits to the Wasm mirror, or reload the whole document
  // when the mirror cannot have tracked them. TextDocumentChange carries no
  // version, so a skipped or coalesced delivery would otherwise leave the
  // mirror describing another document and later reads would throw range
  // errors from the render path.
  #syncDocument(
    change: TextDocumentChange,
    renderRange: readonly [start: number, end: number]
  ): LiveTokenizerUpdate {
    const document = this.options.textDocument;
    const options = { renderRange };
    if (
      Math.abs(document.version - this.#version) === 1 &&
      change.changes.length > 0 &&
      this.#tokenizer.lineCount === change.previousLineCount
    ) {
      try {
        const update = this.#tokenizer.applyEdits(
          change.changes.map(({ range, text }) => ({ range, newText: text })),
          options
        );
        if (this.#tokenizer.lineCount === document.lineCount) return update;
      } catch (error) {
        // An edit past the mirror's lines is the desync signal; malformed
        // edits still surface as TypeErrors.
        if (!(error instanceof RangeError)) throw error;
      }
    }
    return this.#tokenizer.reset(document.getText(), options);
  }

  // Finish tokenizing [from, to) and add every line the map is missing. Lines
  // the flush completes outside that range still reach onDeferTokenize.
  #readLines(
    lines: Map<number, HighlightedToken[]>,
    from: number,
    to: number
  ): void {
    this.#returnedRange = [from, to];
    try {
      this.#tokenizer.flush(to);
    } finally {
      this.#returnedRange = undefined;
    }
    for (let line = from; line < to; line++) {
      if (lines.has(line)) continue;
      const { tokens } = this.#tokenizer.getLineTokens(line);
      lines.set(
        line,
        tokens.length === 0
          ? [[0, '', '']]
          : tokens.map((token) => [
              token.offset,
              token.color ?? '',
              token.content,
            ])
      );
    }
  }

  setTheme(themeName: string): void {
    if (themeName === this.options.theme) return;
    this.options.theme = themeName;
    this.#tokenizer.dispose();
    this.#version = this.options.textDocument.version;
    this.#tokenizer = this.#createTokenizer();
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    const document = this.options.textDocument;
    if (
      this.options.matchBrackets === false ||
      lineIndex < 0 ||
      lineIndex >= document.lineCount
    )
      return null;
    // Bracket matching runs between renders, so a desynced mirror is reloaded
    // here rather than read past its end. The mirror then matches the current
    // version, so the next render must not re-apply that version's edits.
    if (
      this.#version !== document.version ||
      this.#tokenizer.lineCount !== document.lineCount
    ) {
      this.#tokenizer.reset(document.getText(), {
        renderRange: [lineIndex, lineIndex + 1],
      });
      this.#version = document.version;
    }
    this.#tokenizer.flush(lineIndex + 1);
    return this.#tokenizer.getLineTokens(lineIndex).bracketIgnoredRanges;
  }

  prebuildStateStack(_renderRange?: RenderRange): void {
    this.#tokenizer.resume();
  }
  stopBackgroundTokenize(): void {
    this.#tokenizer.pause();
  }
  pauseBackgroundTokenize(): void {
    this.#tokenizer.pause();
  }
  resumeBackgroundTokenize(): void {
    this.#tokenizer.resume();
  }
  dispose(): void {
    this.#tokenizer.dispose();
  }
}
