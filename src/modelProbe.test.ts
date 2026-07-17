import { describe, expect, it } from "vitest";

import { defaultModelProbeSettings, type ModelProbeGroup } from "./domain";
import { expandModelProbeGroup, expandModelProbeSettings } from "./modelProbe";

describe("model probe expansion", () => {
  it("omits the decimal part when a minorTenths dimension expands minor 0", () => {
    const group: ModelProbeGroup = {
      id: "gemini",
      name: "Gemini",
      description: "",
      rules: [
        {
          id: "gemini-pro",
          template: "gemini-{version}{arg1}",
          dimensions: {
            version: {
              type: "minorTenths",
              majors: ["3"],
              from: 0,
              to: 2,
            },
            arg1: ["pro-preview"],
          },
          enabled: true,
          description: "",
        },
      ],
    };

    expect(
      expandModelProbeGroup(group).map((candidate) => candidate.modelId),
    ).toEqual([
      "gemini-3-pro-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.2-pro-preview",
    ]);
  });

  it("includes major-only Gemini and Grok aliases in the default probe rules", () => {
    const geminiModels = expandModelProbeSettings(
      defaultModelProbeSettings,
      "gemini",
    ).map((candidate) => candidate.modelId);
    const grokModels = expandModelProbeSettings(
      defaultModelProbeSettings,
      "grok",
    ).map((candidate) => candidate.modelId);

    expect(geminiModels).toContain("gemini-3-pro-preview");
    expect(geminiModels).toContain("gemini-3-flash-preview");
    expect(geminiModels).toContain("gemini-3-flash-lite-preview");
    expect(geminiModels).toContain("gemini-3-pro-preview-thinking");
    expect(geminiModels).not.toContain("gemini-3.0-pro-preview");
    expect(grokModels).toContain("grok-4");
    expect(grokModels).toContain("grok-4-fast");
    expect(grokModels).toContain("grok-4-fast-reasoning");
    expect(grokModels).toContain("grok-4-reasoning");
    expect(grokModels).toContain("grok-4.1");
    expect(grokModels).toContain("grok-4.1-thinking");
    expect(grokModels).toContain("grok-4.3");
    expect(grokModels).not.toContain("grok-4.0");
    expect(grokModels).not.toContain("grok-4.1:origin");
  });

  it("auto-prefixes suffix arguments while preserving empty suffixes and legacy leading dashes", () => {
    const group: ModelProbeGroup = {
      id: "suffix",
      name: "Suffix",
      description: "",
      rules: [
        {
          id: "suffix",
          template: "model{arg1}",
          dimensions: {
            arg1: ["", "fast", "-legacy", "flash-lite"],
          },
          enabled: true,
          description: "",
        },
      ],
    };

    expect(
      expandModelProbeGroup(group).map((candidate) => candidate.modelId),
    ).toEqual(["model", "model-fast", "model-legacy", "model-flash-lite"]);
  });

  it("supports hyphen-separated minor versions through minorTenths separator", () => {
    const group: ModelProbeGroup = {
      id: "claude",
      name: "Claude",
      description: "",
      rules: [
        {
          id: "claude-opus",
          template: "claude-opus-{version}",
          dimensions: {
            version: {
              type: "minorTenths",
              majors: ["4"],
              from: 8,
              to: 8,
              separator: "-",
            },
          },
          enabled: true,
          description: "",
        },
      ],
    };

    expect(
      expandModelProbeGroup(group).map((candidate) => candidate.modelId),
    ).toEqual(["claude-opus-4-8"]);
  });
});
