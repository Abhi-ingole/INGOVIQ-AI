import type { Analysis } from '../engine/analyse';
import type { Dataset, ManualInputs } from '../engine/types';

export interface PageCtx {
  a: Analysis;
  ds: Dataset;
  inp: ManualInputs;
  setInp: (p: Partial<ManualInputs>) => void;
  /** selected financial years (Filters pane); empty = all */
  fySel: string[];
  toggleFY: (fy: string) => void;
  themeKey: string;
  exporting?: boolean;
}

export const pickFYs = (all: string[], sel: string[]) => (sel.length ? all.filter((f) => sel.includes(f)) : all);
