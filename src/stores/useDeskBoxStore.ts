import { create } from "zustand";
import type { AppData, ToastMessage } from "../types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface DeskBoxStore {
  data: AppData | null;
  toasts: ToastMessage[];
  saveState: SaveState;
  setData: (data: AppData | null) => void;
  setToasts: (update: ToastMessage[] | ((current: ToastMessage[]) => ToastMessage[])) => void;
  setSaveState: (saveState: SaveState) => void;
}

export const useDeskBoxStore = create<DeskBoxStore>((set) => ({
  data: null,
  toasts: [],
  saveState: "idle",
  setData: (data) => set({ data }),
  setToasts: (update) => set((state) => ({ toasts: typeof update === "function" ? update(state.toasts) : update })),
  setSaveState: (saveState) => set({ saveState }),
}));
