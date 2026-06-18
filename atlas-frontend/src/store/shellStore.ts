import { create } from 'zustand';

// Loose ChatMessage shape — kept permissive so home/workspace can use their own types
// without forcing a refactor at the foundation stage.
export type ChatMessage = {
  id?: string;
  role?: string;
  content?: string;
  [key: string]: unknown;
};

export type ThreadSource = 'home' | 'project' | null;

// Shell mode: where the user is standing in the app surface.
//   ambient     = Nexus home, no active conversation yet
//   active      = Nexus home chat has started, shaping happening
//   operational = workspace / Forge / Map / build surfaces
//
// Independent of a project's own `status` (shaping | committed | archived)
// and `surface_mode` (ambient | operational). See .lovable/plan.md
// "Shaping → Committed: One Object, Two States (+ Shell Mode)".
export type ShellMode = 'ambient' | 'active' | 'operational';

// Shaping → Commit handoff state machine.
//   idle          = no commit in flight (baseline)
//   shaping       = commit endpoint in flight (Atlas synthesizing)
//   ready         = pendingWorkspaceId set, CommitPill glowing, waiting for tap
//   transitioning = user tapped, border-trace playing, header gate engaged
// Header MUST NOT render workspace title while isHandoff() === true.
export type ShapingStatus = 'idle' | 'shaping' | 'ready' | 'transitioning';

export interface ActiveThread {
  conversationId: string | null;
  projectId: number | null;
  source: ThreadSource;
  messages: ChatMessage[];
  draft: string;
  scrollPosition: number;
}

interface ShellStore {
  shellMode: ShellMode;
  setShellMode: (mode: ShellMode) => void;
  shapingStatus: ShapingStatus;
  pendingWorkspaceId: number | null;
  pendingWorkspaceTitle: string | null;
  setShapingStatus: (status: ShapingStatus) => void;
  setPendingWorkspace: (id: number | null, title?: string | null) => void;
  resetHandoff: () => void;
  isHandoff: () => boolean;
  activeThread: ActiveThread;
  setActiveThread: (thread: Partial<ActiveThread>) => void;
  setConversationId: (conversationId: string | null) => void;
  setProjectId: (projectId: number | null) => void;
  updateMessages: (messages: ChatMessage[]) => void;
  updateDraft: (draft: string) => void;
  updateScrollPosition: (pos: number) => void;
  clearThread: () => void;
}

const emptyThread: ActiveThread = {
  conversationId: null,
  projectId: null,
  source: null,
  messages: [],
  draft: '',
  scrollPosition: 0,
};

export const useShellStore = create<ShellStore>((set, get) => ({
  shellMode: 'ambient',
  setShellMode: (shellMode) => set({ shellMode }),
  shapingStatus: 'idle',
  pendingWorkspaceId: null,
  pendingWorkspaceTitle: null,
  setShapingStatus: (shapingStatus) => set({ shapingStatus }),
  setPendingWorkspace: (id, title = null) =>
    set({ pendingWorkspaceId: id, pendingWorkspaceTitle: title }),
  resetHandoff: () =>
    set({ shapingStatus: 'idle', pendingWorkspaceId: null, pendingWorkspaceTitle: null }),
  isHandoff: () => {
    const s = get().shapingStatus;
    return s === 'shaping' || s === 'ready' || s === 'transitioning';
  },
  activeThread: emptyThread,
  setActiveThread: (thread) =>
    set((state) => ({ activeThread: { ...state.activeThread, ...thread } })),
  setConversationId: (conversationId) =>
    set((state) => ({ activeThread: { ...state.activeThread, conversationId } })),
  setProjectId: (projectId) =>
    set((state) => ({ activeThread: { ...state.activeThread, projectId } })),
  updateMessages: (messages) =>
    set((state) => ({ activeThread: { ...state.activeThread, messages } })),
  updateDraft: (draft) =>
    set((state) => ({ activeThread: { ...state.activeThread, draft } })),
  updateScrollPosition: (pos) =>
    set((state) => ({ activeThread: { ...state.activeThread, scrollPosition: pos } })),
  clearThread: () => set({ activeThread: emptyThread, shellMode: 'ambient' }),
}));

