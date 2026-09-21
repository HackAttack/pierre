import type {
  CodeToTokensOptions,
  DiffsHighlighter,
} from '../highlighter/types';

export type { RecallToken } from '../highlighter/tokenizer-types';

export interface CodeToTokenTransformStreamOptions extends CodeToTokensOptions {
  highlighter: DiffsHighlighter;
  /** Emit provisional tokens and recalls while the final line is incomplete. */
  allowRecalls?: boolean;
}
