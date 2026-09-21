import type {
  CodeToTokensOptions,
  GrammarState,
  HighlighterCore,
} from 'shiki/core';

import { appendItems } from '../utils/appendItems';
import type {
  DiffsStreamTokenizer,
  DiffsStreamTokenizerEnqueueResult,
} from './tokenizer-types';
import type { ThemedToken } from './types';

/** Streams chunks through Shiki with options the backend already narrowed to one theme key. */
export class ShikiStreamTokenizer implements DiffsStreamTokenizer {
  #disposed = false;
  #stableOffset = 0;
  #unstable: ThemedToken[] = [];
  #tail = '';
  #grammarState: GrammarState | undefined;

  constructor(
    private readonly highlighter: HighlighterCore,
    private readonly options: CodeToTokensOptions
  ) {}

  enqueue(chunk: string): DiffsStreamTokenizerEnqueueResult {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    const source = this.#tail + chunk;
    const pendingCarriageReturn = source.endsWith('\r') ? '\r' : '';
    const chunkLines = (
      pendingCarriageReturn === '' ? source : source.slice(0, -1)
    ).split(/(\r\n|\r|\n)/);

    const stable: ThemedToken[] = [];
    let unstable: ThemedToken[] = [];
    const recall = this.#unstable.length;

    for (let i = 0; i < chunkLines.length; i += 2) {
      const line = chunkLines[i];
      const isLastLine = i === chunkLines.length - 1;

      const result = this.highlighter.codeToTokens(line, {
        ...this.options,
        grammarState: this.#grammarState,
      });
      const tokens = result.tokens[0].map((token) => ({
        ...token,
        offset: token.offset + this.#stableOffset,
      }));
      if (!isLastLine) {
        const lineBreak = chunkLines[i + 1];
        for (let index = 0; index < lineBreak.length; index++) {
          tokens.push({
            content: lineBreak[index],
            offset: this.#stableOffset + line.length + index,
          });
        }
        this.#grammarState = result.grammarState;
        this.#stableOffset += line.length + lineBreak.length;
        appendItems(stable, tokens);
      } else {
        unstable = tokens;
        this.#tail = line + pendingCarriageReturn;
        if (pendingCarriageReturn !== '')
          tokens.push({
            content: '\r',
            offset: this.#stableOffset + line.length,
          });
      }
    }

    this.#unstable = unstable;

    return { recall, stable, unstable };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.clear();
    this.#disposed = true;
  }

  close(): { stable: ThemedToken[] } {
    const stable = this.#unstable;
    this.dispose();
    return { stable };
  }

  clear(): void {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    this.#stableOffset = 0;
    this.#unstable = [];
    this.#tail = '';
    this.#grammarState = undefined;
  }

  clone(): ShikiStreamTokenizer {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    const clone = new ShikiStreamTokenizer(this.highlighter, this.options);
    clone.#stableOffset = this.#stableOffset;
    clone.#tail = this.#tail;
    clone.#unstable = this.#unstable.slice();
    clone.#grammarState = this.#grammarState;
    return clone;
  }
}
