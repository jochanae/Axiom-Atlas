// Test-only stub so hooks that import from @workspace/api-client-react can
// be loaded under vitest without pulling the real generated client.
export type Message = any;
export type Session = { id: number };
export const createSession = async () => ({ id: 1 });
export const useCreateSession = () => ({
  mutateAsync: async () => ({ id: 1 }),
});
export const getListSessionsQueryKey = (projectId: number) => ["sessions", projectId];
export const getGetProjectQueryKey = (projectId: number) => ["project", projectId];
export const getListProjectsQueryKey = () => ["projects"];
export const useListMessages = () => ({ data: [], isLoading: false });
