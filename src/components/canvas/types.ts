// Shared types for the canvas: the change log, undo entries, gestures, props.
import { type ReactNode } from 'react';
import { api, type Item, type Project, type View } from '../../api';
import { type Settings } from '../../settings';

export interface CanvasApi {
  zoom: number;
  textTool: boolean;
  setTextTool: (on: boolean) => void;
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  zoomToFit: () => void;
}

export type Change = Record<string, Item | null>;
export interface Entry {
  before: Change;
  after: Change;
}
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

export type Mode =
  | {
      type: 'pan';
      sx: number;
      sy: number;
      vx: number;
      vy: number;
      started: boolean;
    }
  | {
      type: 'move';
      sx: number;
      sy: number;
      wx: number;
      wy: number;
      origIds: string[];
      ids: string[];
      base: Record<string, Item>;
      before: Change;
      moved: boolean;
      alt: boolean;
      reduceTo: string[] | null;
    }
  | {
      type: 'resize';
      id: string;
      before: Item;
      ax: number;
      ay: number;
      dirX: number;
      dirY: number;
      ratio: number;
    }
  | {
      type: 'rotate';
      id: string;
      cx: number;
      cy: number;
      start: number;
      before: Item;
    }
  | {
      type: 'groupResize';
      ax: number;
      ay: number;
      dirX: number;
      dirY: number;
      bw: number;
      bh: number;
      base: Record<string, Item>;
    }
  | { type: 'marquee'; wx: number; wy: number; base: Set<string> };

export interface Props {
  project: Project;
  onViewSaved: (view: View) => void;
  toast: (text: string, tone?: 'info' | 'error') => void;
  chrome: (api: CanvasApi, interacting: boolean) => ReactNode;
  settings: Settings;
  /** Bumped by the parent when items changed elsewhere (e.g. restored from Recently deleted). */
  reloadSignal?: number;
}
