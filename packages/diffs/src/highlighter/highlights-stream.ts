import { type CodeToTokensOptions, LiveTokenizer } from '@pierre/highlights';

import { appendItems } from '../utils/appendItems';
import type {
  DiffsStreamTokenizer,
  DiffsStreamTokenizerEnqueueResult,
} from './tokenizer-types';
import type { ThemedToken } from './types';

/** Keeps the unfinished line editable so new chunks can recall provisional tokens. */
export class HighlightsStreamTokenizer implements DiffsStreamTokenizer {
  #tokenizer: LiveTokenizer;
  #unstable: ThemedToken[] = [];
  #stableOffset = 0;
  #pendingCarriageReturn = '';
  #disposed = false;

  constructor(private readonly options: CodeToTokensOptions) {
    this.#tokenizer = new LiveTokenizer(options);
  }

  enqueue(chunk: string): DiffsStreamTokenizerEnqueueResult {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    chunk = this.#pendingCarriageReturn + chunk;
    this.#pendingCarriageReturn = chunk.endsWith('\r') ? '\r' : '';
    if (this.#pendingCarriageReturn !== '') chunk = chunk.slice(0, -1);
    const lineBreaks = [...chunk.matchAll(/\r\n|\r|\n/g)];
    const startLine = this.#tokenizer.lineCount - 1;
    const position = {
      line: startLine,
      character: this.#tokenizer.getLineLength(startLine),
    };
    this.#tokenizer.applyEdits([
      { range: { start: position, end: position }, newText: chunk },
    ]);
    const stable: ThemedToken[] = [];
    const lastLine = this.#tokenizer.lineCount - 1;
    const recall = this.#unstable.length;
    for (let line = startLine; line <= lastLine; line++) {
      const tokens = this.#tokenizer
        .getLineTokens(line)
        .tokens.map((token) => ({
          ...token,
          offset: token.offset + this.#stableOffset,
        }));
      if (line < lastLine) {
        appendItems(stable, tokens);
        const lineLength = this.#tokenizer.getLineLength(line);
        const lineBreak = lineBreaks[line - startLine][0];
        for (let index = 0; index < lineBreak.length; index++) {
          stable.push({
            content: lineBreak[index],
            offset: this.#stableOffset + lineLength + index,
          });
        }
        this.#stableOffset += lineLength + lineBreak.length;
      } else {
        this.#unstable = tokens;
      }
    }
    if (this.#pendingCarriageReturn !== '') {
      this.#unstable.push({
        content: '\r',
        offset: this.#stableOffset + this.#tokenizer.getLineLength(lastLine),
      });
    }
    return { recall, stable, unstable: this.#unstable };
  }

  close(): { stable: ThemedToken[] } {
    const stable = this.#unstable;
    this.dispose();
    return { stable };
  }

  clear(): void {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    this.#tokenizer.reset('');
    this.#unstable = [];
    this.#stableOffset = 0;
    this.#pendingCarriageReturn = '';
  }

  clone(): HighlightsStreamTokenizer {
    if (this.#disposed) throw new Error('stream tokenizer is disposed');
    const clone = new HighlightsStreamTokenizer(this.options);
    clone.#tokenizer.reset(this.#tokenizer.getText());
    clone.#unstable = this.#unstable.slice();
    clone.#stableOffset = this.#stableOffset;
    clone.#pendingCarriageReturn = this.#pendingCarriageReturn;
    return clone;
  }

  dispose(): void {
    this.#tokenizer.dispose();
    this.#unstable = [];
    this.#disposed = true;
  }
}
