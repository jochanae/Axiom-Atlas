import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { extractApiErrorMessage } from "../lib/atlas-utils";

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [createError, setCreateError] = useState<string | null>(null);

  const handleNew = () => {
    setCreateError(null);
    createProject.mutate({ data: { name: "New Operation " + Math.floor(Math.random()*1000) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
      onError: (err) => {
        setCreateError(extractApiErrorMessage(err));
      },
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <header className="flex justify-between items-center mb-12 max-w-5xl mx-auto">
        <div className="flex items-center space-x-4">
          <Link href="/" className="text-xl font-bold tracking-tight text-primary">ATLAS</Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-lg font-medium">Projects</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={handleNew} disabled={createProject.isPending} className="rounded-sm">
            Initialize Project
          </Button>
          {createError && (
            <p className="text-xs text-destructive font-mono">{createError}</p>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto">
        {isLoading ? (
          <div className="text-muted-foreground">Loading operations...</div>
        ) : projects?.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border text-muted-foreground">
            No projects initialized. What are we building?
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects?.map(p => (
              <Link key={p.id} href={`/project/${p.id}`} className="block">
                <div className="p-6 bg-card border border-border hover:border-primary/50 transition-colors rounded-sm h-full flex flex-col justify-between group">
                  <div>
                    <h3 className="font-medium text-lg mb-2 group-hover:text-primary transition-colors">{p.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{p.description || "No parameters specified."}</p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                    <span className="uppercase tracking-wider px-2 py-1 bg-muted rounded-sm">{p.status}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
