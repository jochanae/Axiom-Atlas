import { describe, expect, it } from "vitest";
import { classifyTerminalCommand, evaluateTerminalRequest } from "../lib/terminalExecution";

describe("terminal command classification", () => {
  it("classifies safe read-only commands as tier 1", () => {
    expect(classifyTerminalCommand("git status")).toMatchObject({ tier: 1 });
    expect(classifyTerminalCommand("npm run typecheck")).toMatchObject({ tier: 1 });
    expect(classifyTerminalCommand("node --version")).toMatchObject({ tier: 1 });
  });

  it("classifies project-affecting commands as tier 2", () => {
    expect(classifyTerminalCommand("npm install")).toMatchObject({ tier: 2 });
    expect(classifyTerminalCommand("git commit -m test")).toMatchObject({ tier: 2 });
    expect(classifyTerminalCommand("mkdir tmp")).toMatchObject({ tier: 2 });
  });

  it("classifies destructive commands and writes as tier 3", () => {
    expect(classifyTerminalCommand("git push")).toMatchObject({ tier: 3 });
    expect(classifyTerminalCommand("git reset --hard")).toMatchObject({ tier: 3 });
    expect(classifyTerminalCommand("echo hello > file.txt")).toMatchObject({ tier: 3 });
  });

  it("keeps blocked patterns blocked", () => {
    expect(classifyTerminalCommand("rm -rf /")).toMatchObject({ tier: "blocked" });
  });

  it("requires confirmation for tier 2 and hard confirmation for tier 3", () => {
    expect(evaluateTerminalRequest("npm install").requiresConfirmation).toBe(true);
    expect(evaluateTerminalRequest("npm install", 2, "ok").requiresConfirmation).toBe(false);
    expect(evaluateTerminalRequest("git push", 3, "ok").requiresConfirmation).toBe(true);
    expect(evaluateTerminalRequest("git push", 3, "YES").requiresConfirmation).toBe(false);
  });
});
