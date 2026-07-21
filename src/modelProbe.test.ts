import { describe, expect, it } from "vitest";

import { defaultModelProbeSettings, type ModelProbeGroup } from "./domain";
import {
  expandModelProbeGroup,
  expandModelProbeSettings,
  normalizeModelProbeSettings,
} from "./modelProbe";

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
    const gptModels = expandModelProbeSettings(
      defaultModelProbeSettings,
      "gpt",
    ).map((candidate) => candidate.modelId);
    const geminiModels = expandModelProbeSettings(
      defaultModelProbeSettings,
      "gemini",
    ).map((candidate) => candidate.modelId);
    const grokModels = expandModelProbeSettings(
      defaultModelProbeSettings,
      "grok",
    ).map((candidate) => candidate.modelId);

    expect(gptModels).toContain("gpt-5.4");
    expect(gptModels).toContain("gpt-5.4-mini");
    expect(gptModels).toContain("gpt-5.4-codex-high");
    expect(gptModels).toContain("gpt-5.6-codex-low");
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

  it("uses the probe model name placeholder when expanding candidates", () => {
    const group: ModelProbeGroup = {
      id: "custom",
      name: "Custom",
      description: "",
      rules: [
        {
          id: "custom",
          template: "{modelName}-{version}{arg1}",
          dimensions: {
            version: {
              type: "minorTenths",
              majors: ["2"],
              from: 0,
              to: 1,
            },
            arg1: ["", "fast"],
          },
          enabled: true,
          description: "",
        },
      ],
    };

    expect(
      expandModelProbeGroup(group).map((candidate) => candidate.modelId),
    ).toEqual(["custom-2", "custom-2-fast", "custom-2.1", "custom-2.1-fast"]);
  });

  it("normalizes legacy templates so the model name stays synchronized", () => {
    const settings = normalizeModelProbeSettings({
      groups: [
        {
          id: "legacy",
          name: "Legacy",
          description: "",
          rules: [
            {
              id: "legacy",
              template: "legacy-{version}{arg1}",
              dimensions: {
                version: { type: "minorTenths", majors: ["1"], from: 0, to: 0 },
                arg1: [""],
              },
              enabled: true,
              description: "",
            },
          ],
        },
      ],
      editingGroupId: "legacy",
      timeoutMs: 3000,
    });

    expect(settings.groups[0]?.rules[0]?.template).toBe(
      "{modelName}-{version}{arg1}",
    );
    expect(expandModelProbeSettings(settings, "legacy")).toEqual([
      {
        groupId: "legacy",
        modelId: "legacy-1",
      },
    ]);
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
