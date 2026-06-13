import { useState, useCallback } from "react";
import { parseZip, assembleContext } from "@/components/ZipImport";
import type { ZipEntry } from "@/components/ZipImport";

export function useComposerZip(
  _projectId: string | number | undefined,
  setFileContext: (v: string | null) => void
) {
  const [zipFiles, setZipFiles] = useState<ZipEntry[]>([]);
  const [zipName, setZipName] = useState("");
  const [zipTruncated, setZipTruncated] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const processZip = useCallback(async (file: File) => {
    try {
      const { entries: parsed, truncated } = await parseZip(file);
      setZipFiles(parsed);
      setZipName(file.name);
      setZipTruncated(truncated);
      setFileContext(assembleContext(file.name, parsed));
    } catch { /* ignore */ }
  }, [setFileContext]);

  const clearZip = useCallback(() => {
    setZipFiles([]);
    setZipName("");
    setZipTruncated(false);
    setFileContext(null);
  }, [setFileContext]);

  const toggleZipFile = useCallback((path: string) => {
    setZipFiles((prev) => {
      const next = prev.map((e) => e.path === path ? { ...e, selected: !e.selected } : e);
      setFileContext(assembleContext(zipName, next));
      return next;
    });
  }, [zipName, setFileContext]);

  const setAllZip = useCallback((selected: boolean) => {
    setZipFiles((prev) => {
      const next = prev.map((e) => ({ ...e, selected }));
      setFileContext(assembleContext(zipName, next));
      return next;
    });
  }, [zipName, setFileContext]);

  return {
    zipFiles,
    setZipFiles,
    zipName,
    setZipName,
    zipTruncated,
    setZipTruncated,
    isDragOver,
    setIsDragOver,
    processZip,
    clearZip,
    toggleZipFile,
    setAllZip,
  };
}
