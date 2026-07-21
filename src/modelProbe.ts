import {
  type ApiProfile,
  type ApiProtocol,
  createId,
  defaultModelProbeSettings,
  type ModelProbeDimensionValue,
  type ModelProbeGroup,
  type ModelProbeSettings,
} from "./domain";

export type ModelProbeCandidate = {
  groupId: string;
  modelId: string;
};

export type ModelProbeResult = {
  id: string;
  groupId: string;
  modelId: string;
  protocol: ApiProtocol;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
  createdAt: string;
};

const MODEL_NAME_TEMPLATE_KEY = "modelName";
const MODEL_NAME_TEMPLATE_TOKEN = "{modelName}";

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const syncModelProbeTemplateModelName = (
  template: string,
  modelName: string,
) => {
  const normalizedTemplate = String(template ?? "").trim();
  if (!normalizedTemplate) {
    return `${MODEL_NAME_TEMPLATE_TOKEN}-{version}{arg1}`;
  }

  if (normalizedTemplate.includes(MODEL_NAME_TEMPLATE_TOKEN)) {
    return normalizedTemplate;
  }

  const normalizedModelName = String(modelName ?? "").trim();
  if (!normalizedModelName) {
    return normalizedTemplate;
  }

  return normalizedTemplate.replace(
    new RegExp(`^${escapeRegExp(normalizedModelName)}(?=$|[-{])`),
    MODEL_NAME_TEMPLATE_TOKEN,
  );
};

const toInteger = (value: unknown, fallback: number) => {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) ? number : fallback;
};

const clampMinor = (value: number) => Math.max(0, Math.min(9, value));

const expandMinorTenths = (
  value: Extract<ModelProbeDimensionValue, { type: "minorTenths" }>,
) => {
  const from = clampMinor(toInteger(value.from, 0));
  const to = clampMinor(toInteger(value.to, 9));
  const separator = value.separator === "-" ? "-" : ".";
  const [start, end] = from <= to ? [from, to] : [to, from];

  return value.majors.flatMap((major) => {
    const prefix = String(major ?? "").trim();
    if (!prefix) {
      return [];
    }

    return Array.from({ length: end - start + 1 }, (_, index) => {
      const minor = start + index;
      return minor === 0 ? prefix : `${prefix}${separator}${minor}`;
    });
  });
};

const expandDimensionValues = (value: ModelProbeDimensionValue): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(expandDimensionValues);
  }

  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "minorTenths") {
      return expandMinorTenths(value);
    }
    if ("values" in value) {
      return value.values.flatMap(expandDimensionValues);
    }
  }

  return [String(value ?? "").trim()];
};

const cartesian = (entries: Array<[string, string[]]>) =>
  entries.reduce<Array<Record<string, string>>>(
    (rows, [key, values]) =>
      rows.flatMap((row) =>
        values.map((value) => ({
          ...row,
          [key]: value,
        })),
      ),
    [{}],
  );

const formatTemplateValue = (key: string, value: string) => {
  if (!/^arg\d+$/.test(key)) {
    return value;
  }

  const normalized = value.trim().replace(/^-+/, "");
  return normalized ? `-${normalized}` : "";
};

const expandTemplate = (
  template: string,
  dimensions: Record<string, ModelProbeDimensionValue>,
  modelName: string,
) =>
  cartesian([
    [MODEL_NAME_TEMPLATE_KEY, [modelName.trim()]] as [string, string[]],
    ...Object.entries(dimensions).map(
      ([key, value]) =>
        [key, expandDimensionValues(value)] as [string, string[]],
    ),
  ]).map((values) =>
    Object.entries(values).reduce(
      (text, [key, value]) =>
        text.replaceAll(`{${key}}`, formatTemplateValue(key, value)),
      template,
    ),
  );

export const expandModelProbeGroup = (
  group: ModelProbeGroup,
): ModelProbeCandidate[] => {
  const generated = group.rules
    .filter((rule) => rule.enabled)
    .flatMap((rule) =>
      expandTemplate(
        syncModelProbeTemplateModelName(rule.template, group.id),
        rule.dimensions,
        group.id,
      ),
    );

  return unique(generated.map((modelId) => modelId.trim())).map((modelId) => ({
    groupId: group.id,
    modelId,
  }));
};

export const expandModelProbeSettings = (
  settings: ModelProbeSettings,
  groupId: string,
) => {
  const group = settings.groups.find((candidate) => candidate.id === groupId);
  return group ? expandModelProbeGroup(group) : [];
};

export const createEmptyModelProbeGroup = (index: number): ModelProbeGroup => ({
  id: `model-${index}`,
  name: `探测 ${index}`,
  description: "",
  rules: [
    {
      id: createId("probe-rule"),
      template: "{modelName}-{version}{arg1}",
      dimensions: {
        version: { type: "minorTenths", majors: ["1"] },
        arg1: [""],
      },
      enabled: true,
      description: "",
    },
  ],
});

export const normalizeModelProbeSettings = (
  settings?: Partial<ModelProbeSettings>,
): ModelProbeSettings => {
  const groups =
    Array.isArray(settings?.groups) && settings.groups.length > 0
      ? settings.groups.map((group, index) => ({
          id: String(group.id || `probe-group-${index + 1}`),
          name: String(group.name || group.id || `探测 ${index + 1}`),
          description: String(group.description ?? ""),
          rules: Array.isArray(group.rules)
            ? group.rules.map((rule, ruleIndex) => ({
                id: String(rule.id || `probe-rule-${ruleIndex + 1}`),
                template: syncModelProbeTemplateModelName(
                  String(rule.template || ""),
                  String(group.id || `probe-group-${index + 1}`),
                ),
                dimensions:
                  rule.dimensions && typeof rule.dimensions === "object"
                    ? rule.dimensions
                    : {},
                enabled: rule.enabled !== false,
                description: String(rule.description ?? ""),
              }))
            : [],
        }))
      : defaultModelProbeSettings.groups;

  const editingGroupId = groups.some(
    (group) => group.id === settings?.editingGroupId,
  )
    ? String(settings?.editingGroupId)
    : (groups[0]?.id ?? defaultModelProbeSettings.editingGroupId);

  return {
    groups,
    editingGroupId,
    timeoutMs: Math.max(
      1000,
      Math.min(60000, Number(settings?.timeoutMs) || 3000),
    ),
  };
};

const normalizeBaseUrl = (baseUrl: string) =>
  baseUrl.trim().replace(/\/+$/, "");

const endpointForProtocol = (apiProfile: ApiProfile, protocol: ApiProtocol) =>
  `${normalizeBaseUrl(apiProfile.baseUrl)}${
    protocol === "openai-chat-completions" ? "/chat/completions" : "/responses"
  }`;

const createProbeBody = (modelId: string, protocol: ApiProtocol) =>
  JSON.stringify(
    protocol === "openai-chat-completions"
      ? {
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 4,
          temperature: 0,
          stream: false,
        }
      : {
          model: modelId,
          input: "ping",
          max_output_tokens: 4,
          store: false,
          stream: false,
        },
  );

const compactError = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return response.statusText || "request failed";
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object"
    ) {
      const error = parsed.error as Record<string, unknown>;
      return [error.message, error.type, error.code]
        .map((value) => (typeof value === "string" ? value : undefined))
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    // Keep bounded raw text below.
  }

  return text.slice(0, 240);
};

export const probeModelCandidate = async ({
  apiProfile,
  modelId,
  signal,
}: {
  apiProfile: ApiProfile;
  modelId: string;
  signal: AbortSignal;
}): Promise<Omit<ModelProbeResult, "id" | "groupId" | "createdAt">> => {
  const protocol = apiProfile.protocol;
  const startedAt = performance.now();

  try {
    const response = await fetch(endpointForProtocol(apiProfile, protocol), {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiProfile.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: createProbeBody(modelId, protocol),
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    return {
      modelId,
      protocol,
      ok: response.ok,
      status: response.status,
      latencyMs,
      error: response.ok ? undefined : await compactError(response),
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      modelId,
      protocol,
      ok: false,
      status: 0,
      latencyMs,
      error: error instanceof Error ? error.message : "network request failed",
    };
  }
};

export const runModelProbePool = async ({
  apiProfile,
  candidates,
  concurrency,
  timeoutMs,
}: {
  apiProfile: ApiProfile;
  candidates: ModelProbeCandidate[];
  concurrency: number;
  timeoutMs: number;
}) => {
  const results: ModelProbeResult[] = [];
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = candidates[index];
        if (!candidate) {
          continue;
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        try {
          results[index] = {
            id: createId("probe-result"),
            groupId: candidate.groupId,
            createdAt: new Date().toISOString(),
            ...(await probeModelCandidate({
              apiProfile,
              modelId: candidate.modelId,
              signal: controller.signal,
            })),
          };
        } finally {
          window.clearTimeout(timeout);
        }
      }
    },
  );

  await Promise.all(workers);
  return results.filter(Boolean);
};
